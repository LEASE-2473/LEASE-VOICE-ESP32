#pragma once

#include <stdint.h>
#include "esp_err.h"

typedef enum {
    LEASE_NET_IDLE,
    LEASE_NET_STARTING,
    LEASE_NET_CONNECTING,
    LEASE_NET_CONNECTED,
    LEASE_NET_RETRY_WAIT,
    LEASE_NET_NEEDS_CONFIG,
    LEASE_NET_FAILED,
} lease_network_state_t;

typedef struct {
    lease_network_state_t state;
    uint32_t ipv4; /* network byte order; 0 until IP_EVENT_STA_GOT_IP */
    uint32_t disconnects;
    esp_err_t error;
} lease_network_status_t;

/* Draft, uncompiled. Call once before other network owners exist.
 * Both NULL: reuse saved station config. Otherwise SSID is 1..32 UTF-8 bytes,
 * password is empty for open AP or 8..63 bytes for WPA/WPA2 personal.
 * Credentials are copied, never logged, saved by IDF in default NVS.
 * ESP_OK means task accepted, NOT that Wi-Fi is connected. Poll status.
 * Runtime reconfiguration/stop/deinit are intentionally not yet provided.
 */
esp_err_t lease_network_start(const char *ssid, const char *password);
lease_network_status_t lease_network_get_status(void);
