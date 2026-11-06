#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct { char id[65]; char state[12]; char error[40]; } lease_audio_status_t;
esp_err_t lease_audio_init(void);
esp_err_t lease_audio_set_volume(unsigned volume);
esp_err_t lease_audio_test_tone(void);
esp_err_t lease_audio_stop(void);
esp_err_t lease_audio_stop_id(const char *id);
bool lease_audio_busy(void);
lease_audio_status_t lease_audio_status(void);
/* Caller retains buffer on failure; successful call transfers ownership.
 * PCM signed little-endian 16-bit mono, even bytes <=4MiB. */
esp_err_t lease_audio_reserve_pcm(const char *id, uint32_t *ticket);
bool lease_audio_reservation_active(uint32_t ticket);
void lease_audio_abandon_pcm(uint32_t ticket, esp_err_t error);
esp_err_t lease_audio_play_pcm(void *owned_buffer, size_t bytes, unsigned rate, const char *id, uint32_t ticket);
#ifdef __cplusplus
}
#endif
