#include <inttypes.h>
#include <stdbool.h>
#include <stdint.h>

#include "esp_app_desc.h"
#include "esp_chip_info.h"
#include "esp_flash.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_psram.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_idf_version.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "board_profile.h"
#include "nvs_flash.h"
#include "lease_network.h"
#include "lease_service.h"
#include "lease_audio.h"
#include "lease_display.h"

#if ESP_IDF_VERSION != ESP_IDF_VERSION_VAL(5, 3, 1)
#error "This M0 source targets ESP-IDF 5.3.1; review compatibility before changing SDK"
#endif

static const char *TAG = "lease_m3";

static bool psram_sample_test(void)
{
    /* IDF performs its own boot-time PSRAM test. This additionally exercises
     * a real 64 KiB external allocation without touching internal/flash data.
     */
    const size_t words = (64U * 1024U) / sizeof(uint32_t);
    volatile uint32_t *data = heap_caps_malloc(words * sizeof(uint32_t),
                                             MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (data == NULL) {
        ESP_LOGE(TAG, "PSRAM sample: allocation failed");
        return false;
    }
    bool ok = true;
    for (unsigned pass = 0; pass < 2 && ok; ++pass) {
        for (size_t i = 0; i < words; ++i) {
            uint32_t pattern = UINT32_C(0xa5a50000) ^ (uint32_t)i;
            data[i] = pass ? ~pattern : pattern;
        }
        for (size_t i = 0; i < words; ++i) {
            uint32_t pattern = UINT32_C(0xa5a50000) ^ (uint32_t)i;
            if (data[i] != (pass ? ~pattern : pattern)) {
                ESP_LOGE(TAG, "PSRAM sample mismatch: pass=%u word=%u", pass, (unsigned)i);
                ok = false;
                break;
            }
        }
    }
    heap_caps_free((void *)data);
    ESP_LOGI(TAG, "PSRAM sample 65536 bytes: %s", ok ? "PASS" : "FAIL");
    return ok;
}

void app_main(void)
{
    const esp_app_desc_t *app = esp_app_get_description();
    esp_chip_info_t chip;
    esp_chip_info(&chip);
    ESP_LOGI(TAG, "LEASE VOICE M3 firmware=%s idf=%s", app->version, esp_get_idf_version());
    ESP_LOGI(TAG, "board=%s", LEASE_BOARD_NAME);
    ESP_LOGI(TAG, "chip model=%d cores=%u revision=%u reset_reason=%d",
             (int)chip.model, chip.cores, chip.revision, (int)esp_reset_reason());
    ESP_LOGI(TAG, "M3: HTTP PCM16/RGB565 receiver; display OFF until explicit configuration; no BLE/STT; console 115200");

    uint32_t flash_bytes = 0;
    esp_err_t flash_result = esp_flash_get_physical_size(NULL, &flash_bytes);
    uint32_t header_flash_bytes = 0;
    esp_err_t header_result = esp_flash_get_size(NULL, &header_flash_bytes);
    size_t psram_bytes = esp_psram_is_initialized() ? esp_psram_get_size() : 0;
    ESP_LOGI(TAG, "flash_bytes=%" PRIu32 " expected=%u query=%s", flash_bytes,
             LEASE_FLASH_BYTES, esp_err_to_name(flash_result));
    ESP_LOGI(TAG, "header_flash_bytes=%" PRIu32 " query=%s", header_flash_bytes,
             esp_err_to_name(header_result));
    ESP_LOGI(TAG, "psram_bytes=%u expected=%u", (unsigned)psram_bytes, LEASE_PSRAM_BYTES);
    bool sample_ok = psram_bytes > 0 && psram_sample_test();
    bool ok = chip.model == CHIP_ESP32S3 && chip.cores == 2 &&
              flash_result == ESP_OK && flash_bytes == LEASE_FLASH_BYTES &&
              header_result == ESP_OK && header_flash_bytes == LEASE_FLASH_BYTES &&
              psram_bytes == LEASE_PSRAM_BYTES && sample_ok;
    if (ok) {
        ESP_LOGI(TAG, "M2_MEMORY_READY memory_check=PASS");
    } else {
        ESP_LOGE(TAG, "M2_DIAGNOSTIC_FAILED: inspect memory/chip; no automatic reboot");
    }
    /* Never erase legacy/default NVS automatically. Provisioning reports any
     * storage failure, leaving the previous data intact for diagnosis. */
    esp_err_t nvs_error = nvs_flash_init();
    ESP_LOGI(TAG, "NVS init=%s (no auto-erase)", esp_err_to_name(nvs_error));
    esp_err_t audio_error = ok ? lease_audio_init() : ESP_ERR_INVALID_STATE;
    ESP_LOGI(TAG, "audio init=%s (silent until explicit command)", esp_err_to_name(audio_error));
    esp_err_t network_error = nvs_error == ESP_OK && ok ? lease_network_init() : ESP_ERR_INVALID_STATE;
    ESP_LOGI(TAG, "Wi-Fi init=%s", esp_err_to_name(network_error));
    esp_err_t display_error = ok ? lease_display_init() : ESP_ERR_INVALID_STATE;
    ESP_LOGI(TAG, "display receiver init=%s (no GPIO enable until configured)", esp_err_to_name(display_error));
    esp_err_t service_error = lease_service_init(audio_error == ESP_OK, network_error == ESP_OK, display_error == ESP_OK);
    ESP_LOGI(TAG, "HTTP debug init=%s auth=%s", esp_err_to_name(service_error),
             lease_service_has_token() ? "token" : "lan-unpaired");
    esp_err_t serial_error = lease_serial_start();
    ESP_LOGI(TAG, "UART setup=%s; send one JSON line; credentials are not echoed", esp_err_to_name(serial_error));
    ESP_LOGI(TAG, "M3_READY memory=%s wifi=%s audio=%s http=%s serial=%s",
             ok ? "PASS" : "FAIL", esp_err_to_name(network_error), esp_err_to_name(audio_error),
             esp_err_to_name(service_error), esp_err_to_name(serial_error));
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(10000));
        bool heap_ok = heap_caps_check_integrity_all(false);
        if (!heap_ok) {
            ok = false;
            ESP_LOGE(TAG, "HEAP_INTEGRITY_FAILED");
        }
        ESP_LOGI(TAG, "heartbeat uptime_s=%" PRId64 " status=%s internal_free=%u psram_free=%u min_free=%u",
                 esp_timer_get_time() / INT64_C(1000000), ok ? "PASS" : "FAIL",
                 (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                 (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM),
                 (unsigned)esp_get_minimum_free_heap_size());
        lease_network_status_t network = lease_network_status();
        ESP_LOGI(TAG, "network state=%s ip=%s disconnects=%u error=%s", network.state,
                 network.ip[0] ? network.ip : "none", network.disconnects, esp_err_to_name(network.error));
    }
}
