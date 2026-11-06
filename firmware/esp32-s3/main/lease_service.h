#pragma once
#include <stdbool.h>
#include "esp_err.h"
esp_err_t lease_service_init(bool audio_ready, bool network_ready, bool display_ready);
esp_err_t lease_service_set_token(const char *token);
bool lease_service_has_token(void);
esp_err_t lease_serial_start(void);
