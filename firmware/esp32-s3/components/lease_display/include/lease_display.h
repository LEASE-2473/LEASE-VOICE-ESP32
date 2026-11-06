#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

#define LEASE_DISPLAY_MAX_BYTES (240U * 320U * 2U)
typedef struct {
    char profile[24];
    unsigned x_gap, y_gap;
    bool swap_xy, mirror_x, mirror_y, bgr, invert;
} lease_display_config_t;
typedef struct {
    lease_display_config_t config;
    bool ready;
    unsigned width, height;
    char stream[65];
    uint32_t last_sequence;
    uint32_t received, drawn, dropped, timeouts;
    esp_err_t error;
} lease_display_status_t;

/* init creates state only: no peripheral GPIO is driven until configure. */
esp_err_t lease_display_init(void);
esp_err_t lease_display_configure(const lease_display_config_t *config);
lease_display_status_t lease_display_status(void);
esp_err_t lease_display_start(const char *stream);
esp_err_t lease_display_stop(const char *stream);
esp_err_t lease_display_validate(const char *stream, uint32_t sequence, unsigned width, unsigned height, size_t bytes);
/* On ESP_OK ownership transfers to the display worker, otherwise caller frees. */
esp_err_t lease_display_submit(void *pixels, size_t bytes, const char *stream, uint32_t sequence, unsigned width, unsigned height);
