#pragma once
#include <stdbool.h>
#include "esp_err.h"

typedef struct {
    char state[20];
    char ssid[33];
    char ip[16];
    unsigned disconnects;
    esp_err_t error;
} lease_network_status_t;

esp_err_t lease_network_init(void);
esp_err_t lease_network_configure(const char *ssid, const char *password);
lease_network_status_t lease_network_status(void);
