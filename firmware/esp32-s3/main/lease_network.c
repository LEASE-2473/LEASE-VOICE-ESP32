#include <stdio.h>
#include <string.h>
#include "lease_network.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "nvs.h"

static portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
static lease_network_status_t state = {.state = "starting"};
static QueueHandle_t configurations;
static bool configured;
static bool reset_association;
static int64_t retry_at, connect_started;
static unsigned backoff = 1;

static void status_set(const char *name, esp_err_t error)
{
    portENTER_CRITICAL(&lock);
    snprintf(state.state, sizeof(state.state), "%s", name);
    state.error = error;
    if (strcmp(name, "connected")) state.ip[0] = 0;
    portEXIT_CRITICAL(&lock);
}

lease_network_status_t lease_network_status(void)
{
    portENTER_CRITICAL(&lock);
    lease_network_status_t copy = state;
    portEXIT_CRITICAL(&lock);
    return copy;
}

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *event = data;
        char ip[16] = {0};
        snprintf(ip, sizeof(ip), IPSTR, IP2STR(&event->ip_info.ip));
        portENTER_CRITICAL(&lock);
        snprintf(state.state, sizeof(state.state), "connected");
        memcpy(state.ip, ip, sizeof(ip));
        state.error = ESP_OK;
        backoff = 1;
        portEXIT_CRITICAL(&lock);
        printf("{\"protocol\":1,\"event\":\"network\",\"state\":\"connected\",\"ip\":\"%s\"}\n", ip);
        fflush(stdout);
    } else if ((base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) ||
               (base == IP_EVENT && id == IP_EVENT_STA_LOST_IP)) {
        portENTER_CRITICAL(&lock);
        state.disconnects++;
        state.ip[0] = 0;
        snprintf(state.state, sizeof(state.state), "retry-wait");
        state.error = ESP_FAIL;
        if (base == IP_EVENT) reset_association = true;
        retry_at = esp_timer_get_time() + (int64_t)backoff * 1000000;
        backoff = backoff < 16 ? backoff * 2 : 30;
        portEXIT_CRITICAL(&lock);
    }
}

static void network_task(void *unused)
{
    (void)unused;
    wifi_config_t incoming;
    for (;;) {
        if (xQueueReceive(configurations, &incoming, pdMS_TO_TICKS(500)) == pdTRUE) {
            esp_wifi_disconnect();
            esp_err_t error = esp_wifi_set_config(WIFI_IF_STA, &incoming);
            portENTER_CRITICAL(&lock);
            memset(state.ssid, 0, sizeof(state.ssid));
            memcpy(state.ssid, incoming.sta.ssid, sizeof(incoming.sta.ssid));
            configured = error == ESP_OK;
            retry_at = 0;
            backoff = 1;
            portEXIT_CRITICAL(&lock);
            memset(&incoming, 0, sizeof(incoming));
            status_set(error == ESP_OK ? "retry-wait" : "failed", error);
        }
        lease_network_status_t snapshot = lease_network_status();
        int64_t now = esp_timer_get_time();
        portENTER_CRITICAL(&lock);
        bool should_connect = configured && strcmp(state.state, "connected") &&
                              strcmp(state.state, "connecting") && now >= retry_at;
        int64_t started = connect_started;
        bool reset_link = reset_association;
        reset_association = false;
        portEXIT_CRITICAL(&lock);
        if (reset_link) {
            /* Lost DHCP address while still associated: connect() alone would
             * return already-connected and never restart address acquisition. */
            esp_wifi_disconnect();
        } else if (!strcmp(snapshot.state, "connecting") && now - started > 30000000) {
            /* Includes DHCP timeout; don't wait forever for a disconnect event. */
            esp_wifi_disconnect();
            portENTER_CRITICAL(&lock);
            retry_at = now + (int64_t)backoff * 1000000;
            backoff = backoff < 16 ? backoff * 2 : 30;
            portEXIT_CRITICAL(&lock);
            status_set("retry-wait", ESP_ERR_TIMEOUT);
        } else if (should_connect) {
            status_set("connecting", ESP_OK);
            portENTER_CRITICAL(&lock);
            connect_started = now;
            portEXIT_CRITICAL(&lock);
            esp_err_t error = esp_wifi_connect();
            if (error != ESP_OK) {
                portENTER_CRITICAL(&lock);
                retry_at = now + (int64_t)backoff * 1000000;
                backoff = backoff < 16 ? backoff * 2 : 30;
                portEXIT_CRITICAL(&lock);
                status_set("retry-wait", error);
            }
        }
    }
}

esp_err_t lease_network_configure(const char *ssid, const char *password)
{
    size_t sl = ssid ? strnlen(ssid, 33) : 0;
    size_t pl = password ? strnlen(password, 64) : 64;
    if (!sl || sl > 32 || pl > 63 || (pl && pl < 8)) return ESP_ERR_INVALID_ARG;
    if (!configurations) return ESP_ERR_INVALID_STATE;
    wifi_config_t config = {0};
    memcpy(config.sta.ssid, ssid, sl);
    memcpy(config.sta.password, password, pl);
    nvs_handle_t store;
    esp_err_t error = nvs_open("lease_voice", NVS_READWRITE, &store);
    if (error == ESP_OK) {
        error = nvs_set_str(store, "ssid", ssid);
        if (error == ESP_OK) error = nvs_set_str(store, "password", password);
        if (error == ESP_OK) error = nvs_commit(store);
        nvs_close(store);
    }
    if (error == ESP_OK && xQueueOverwrite(configurations, &config) != pdPASS) error = ESP_FAIL;
    memset(&config, 0, sizeof(config));
    return error;
}

esp_err_t lease_network_init(void)
{
    esp_err_t error = esp_netif_init();
    if (error != ESP_OK) goto failed;
    error = esp_event_loop_create_default();
    if (error != ESP_OK && error != ESP_ERR_INVALID_STATE) goto failed;
    if (!esp_netif_create_default_wifi_sta()) { error = ESP_ERR_NO_MEM; goto failed; }
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    error = esp_wifi_init(&init);
    if (error != ESP_OK) goto failed;
    /* Suppress driver info that could expose AP details; our status is explicit. */
    esp_log_level_set("wifi", ESP_LOG_WARN);
    error = esp_wifi_set_storage(WIFI_STORAGE_RAM);
    if (error != ESP_OK) goto failed;
    error = esp_wifi_set_mode(WIFI_MODE_STA);
    if (error != ESP_OK) goto failed;
    error = esp_event_handler_register(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, on_event, NULL);
    if (error != ESP_OK) goto failed;
    error = esp_event_handler_register(IP_EVENT, ESP_EVENT_ANY_ID, on_event, NULL);
    if (error != ESP_OK) goto failed;
    error = esp_wifi_start();
    if (error != ESP_OK) goto failed;
    configurations = xQueueCreate(1, sizeof(wifi_config_t));
    if (!configurations) { error = ESP_ERR_NO_MEM; goto failed; }
    status_set("needs-config", ESP_OK);
    if (xTaskCreate(network_task, "lease_wifi", 4096, NULL, 5, NULL) != pdPASS) {
        configurations = NULL; error = ESP_ERR_NO_MEM; goto failed;
    }
    nvs_handle_t store;
    error = nvs_open("lease_voice", NVS_READONLY, &store);
    if (error == ESP_ERR_NVS_NOT_FOUND) return ESP_OK;
    if (error != ESP_OK) goto failed;
    char ssid[33] = {0}, password[64] = {0};
    size_t sl = sizeof(ssid), pl = sizeof(password);
    error = nvs_get_str(store, "ssid", ssid, &sl);
    if (error == ESP_OK) error = nvs_get_str(store, "password", password, &pl);
    nvs_close(store);
    if (error == ESP_ERR_NVS_NOT_FOUND) return ESP_OK;
    if (error == ESP_OK) {
        wifi_config_t config = {0};
        memcpy(config.sta.ssid, ssid, strnlen(ssid, 32));
        memcpy(config.sta.password, password, strnlen(password, 63));
        xQueueOverwrite(configurations, &config);
        memset(&config, 0, sizeof(config));
    }
    memset(password, 0, sizeof(password));
    if (error == ESP_OK) return ESP_OK;
failed:
    status_set("failed", error);
    return error;
}
