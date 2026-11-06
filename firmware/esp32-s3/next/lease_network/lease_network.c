#include <stdbool.h>
#include <string.h>
#include "lease_network.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#define DISCONNECTED_BIT BIT0

static portMUX_TYPE status_lock = portMUX_INITIALIZER_UNLOCKED;
static lease_network_status_t status;
static bool claimed;
static bool replace_config;
static wifi_config_t pending_config;
static EventGroupHandle_t events;
static TickType_t connected_at;
static bool had_ip, reset_backoff;

static void set_state(lease_network_state_t state, esp_err_t error)
{
    portENTER_CRITICAL(&status_lock);
    status.state = state;
    status.error = error;
    if (state != LEASE_NET_CONNECTED) {
        status.ipv4 = 0;
    }
    portEXIT_CRITICAL(&status_lock);
}

lease_network_status_t lease_network_get_status(void)
{
    portENTER_CRITICAL(&status_lock);
    lease_network_status_t snapshot = status;
    portEXIT_CRITICAL(&status_lock);
    return snapshot;
}

static void network_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        portENTER_CRITICAL(&status_lock);
        if (had_ip && (TickType_t)(xTaskGetTickCount() - connected_at) >= pdMS_TO_TICKS(60000)) {
            reset_backoff = true;
        }
        had_ip = false;
        ++status.disconnects;
        status.state = LEASE_NET_RETRY_WAIT;
        status.ipv4 = 0;
        portEXIT_CRITICAL(&status_lock);
        xEventGroupSetBits(events, DISCONNECTED_BIT);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *ip = data;
        portENTER_CRITICAL(&status_lock);
        status.state = LEASE_NET_CONNECTED;
        status.error = ESP_OK;
        status.ipv4 = ip->ip_info.ip.addr;
        had_ip = true;
        connected_at = xTaskGetTickCount();
        portEXIT_CRITICAL(&status_lock);
    }
}

static void network_task(void *arg)
{
    (void)arg;
    esp_netif_t *netif = NULL;
    esp_event_handler_instance_t wifi_handler = NULL, ip_handler = NULL;
    bool wifi_initialized = false, wifi_started = false;
    esp_err_t error = nvs_flash_init();
    /* Never auto-erase legacy/default NVS on NO_FREE_PAGES or NEW_VERSION. */
    if (error != ESP_OK) { goto failed; }
    error = esp_netif_init();
    if (error != ESP_OK) { goto failed; }
    error = esp_event_loop_create_default();
    if (error != ESP_OK && error != ESP_ERR_INVALID_STATE) { goto failed; }
    netif = esp_netif_create_default_wifi_sta();
    if (netif == NULL) { error = ESP_ERR_NO_MEM; goto failed; }
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    error = esp_wifi_init(&init);
    if (error != ESP_OK) { goto failed; }
    wifi_initialized = true;
    error = esp_event_handler_instance_register(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED,
                                                network_event, NULL, &wifi_handler);
    if (error != ESP_OK) { goto failed; }
    error = esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                                network_event, NULL, &ip_handler);
    if (error != ESP_OK) { goto failed; }
    error = esp_wifi_set_storage(WIFI_STORAGE_FLASH);
    if (error != ESP_OK) { goto failed; }
    error = esp_wifi_set_mode(WIFI_MODE_STA);
    if (error != ESP_OK) { goto failed; }
    if (replace_config) {
        error = esp_wifi_set_config(WIFI_IF_STA, &pending_config);
    } else {
        error = esp_wifi_get_config(WIFI_IF_STA, &pending_config);
    }
    if (error != ESP_OK) { goto failed; }
    if (pending_config.sta.ssid[0] == 0) {
        error = ESP_ERR_NOT_FOUND;
        goto failed;
    }
    memset(&pending_config, 0, sizeof(pending_config));
    error = esp_wifi_start();
    if (error != ESP_OK) { goto failed; }
    wifi_started = true;
    uint32_t delay_seconds = 1;
    for (;;) {
        xEventGroupClearBits(events, DISCONNECTED_BIT);
        set_state(LEASE_NET_CONNECTING, ESP_OK);
        error = esp_wifi_connect();
        if (error == ESP_OK) {
            /* IP acquisition is reported by event; reconnect only after loss. */
            xEventGroupWaitBits(events, DISCONNECTED_BIT, pdTRUE, pdFALSE, portMAX_DELAY);
        }
        portENTER_CRITICAL(&status_lock);
        if (reset_backoff) {
            delay_seconds = 1;
            reset_backoff = false;
        }
        portEXIT_CRITICAL(&status_lock);
        set_state(LEASE_NET_RETRY_WAIT, error);
        vTaskDelay(pdMS_TO_TICKS(delay_seconds * 1000U));
        delay_seconds = delay_seconds < 16 ? delay_seconds * 2 : 30;
    }

failed:
    memset(&pending_config, 0, sizeof(pending_config));
    if (wifi_handler != NULL) {
        esp_event_handler_instance_unregister(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, wifi_handler);
    }
    if (ip_handler != NULL) {
        esp_event_handler_instance_unregister(IP_EVENT, IP_EVENT_STA_GOT_IP, ip_handler);
    }
    if (wifi_started) { esp_wifi_stop(); }
    if (wifi_initialized) { esp_wifi_deinit(); }
    if (netif != NULL) { esp_netif_destroy_default_wifi(netif); }
    set_state(error == ESP_ERR_NOT_FOUND ? LEASE_NET_NEEDS_CONFIG : LEASE_NET_FAILED, error);
    /* Keep events/default loop for process lifetime; restart requires reboot. */
    vTaskDelete(NULL);
}

esp_err_t lease_network_start(const char *ssid, const char *password)
{
    wifi_config_t config = {0};
    bool replace = ssid != NULL || password != NULL;
    if (replace) {
        if (ssid == NULL || password == NULL) { return ESP_ERR_INVALID_ARG; }
        size_t ssid_bytes = strnlen(ssid, 33);
        size_t password_bytes = strnlen(password, 64);
        if (ssid_bytes == 0 || ssid_bytes > 32 || password_bytes > 63 ||
            (password_bytes != 0 && password_bytes < 8)) { return ESP_ERR_INVALID_ARG; }
        memcpy(config.sta.ssid, ssid, ssid_bytes);
        memcpy(config.sta.password, password, password_bytes);
    }
    portENTER_CRITICAL(&status_lock);
    if (claimed) {
        portEXIT_CRITICAL(&status_lock);
        return ESP_ERR_INVALID_STATE;
    }
    claimed = true;
    status.state = LEASE_NET_STARTING;
    portEXIT_CRITICAL(&status_lock);
    pending_config = config;
    memset(&config, 0, sizeof(config));
    replace_config = replace;
    events = xEventGroupCreate();
    if (events == NULL) {
        memset(&pending_config, 0, sizeof(pending_config));
        set_state(LEASE_NET_FAILED, ESP_ERR_NO_MEM);
        return ESP_ERR_NO_MEM;
    }
    if (xTaskCreate(network_task, "lease_wifi", 4096, NULL, 5, NULL) != pdPASS) {
        memset(&pending_config, 0, sizeof(pending_config));
        vEventGroupDelete(events);
        events = NULL;
        set_state(LEASE_NET_FAILED, ESP_ERR_NO_MEM);
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}
