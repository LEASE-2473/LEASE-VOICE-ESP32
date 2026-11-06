#include "lease_audio.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "driver/i2s_std.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#define CHUNK 128U
#define DMA_COUNT 2U
#define MAX_PCM (4U * 1024U * 1024U)
static const char *TAG = "lease_audio";
static StaticSemaphore_t lock_storage;
static SemaphoreHandle_t lock;
static portMUX_TYPE creation_lock = portMUX_INITIALIZER_UNLOCKED;
static i2s_chan_handle_t tx;
static TaskHandle_t worker;
static bool initialized, enabled, requested, busy;
static unsigned volume_level = 35;
static uint32_t generation;
static int16_t *pending_pcm;
static size_t pending_bytes;
static unsigned pending_rate;
static lease_audio_status_t status = {.state="idle"};
static const int16_t silence[DMA_COUNT * CHUNK * 2] = {0};
static SemaphoreHandle_t audio_lock(void)
{
    portENTER_CRITICAL(&creation_lock);
    if (!lock) lock = xSemaphoreCreateMutexStatic(&lock_storage);
    portEXIT_CRITICAL(&creation_lock);
    return lock;
}
static esp_err_t halt_locked(void)
{
    if (enabled) {
        esp_err_t error = i2s_channel_disable(tx);
        if (error != ESP_OK) return error;
        enabled = false;
    }
    size_t loaded = 0;
    esp_err_t error = i2s_channel_preload_data(tx, silence, sizeof(silence), &loaded);
    if (error == ESP_OK && loaded && loaded != sizeof(silence)) return ESP_FAIL;
    return error;
}
static bool valid_id(const char *id)
{
    if (!id) return false;
    size_t len = strnlen(id,65);
    if (!len || len > 64) return false;
    for (size_t i=0;i<len;i++)
        if (!((id[i]>='a'&&id[i]<='z')||(id[i]>='A'&&id[i]<='Z')||
              (id[i]>='0'&&id[i]<='9')||id[i]=='_'||id[i]=='-')) return false;
    return true;
}
static void audio_worker(void *unused)
{
    (void)unused;
    int16_t samples[CHUNK * 2];
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        xSemaphoreTake(lock,portMAX_DELAY);
        if (!requested) { xSemaphoreGive(lock); continue; }
        requested = false;
        uint32_t mine = generation;
        int16_t *pcm = pending_pcm;
        pending_pcm = NULL;
        unsigned rate = pcm ? pending_rate : 16000;
        size_t frames = pcm ? pending_bytes / 2 : rate * 800 / 1000;
        esp_err_t result = halt_locked();
        if (result == ESP_OK) {
            i2s_std_clk_config_t clock = I2S_STD_CLK_DEFAULT_CONFIG(rate);
            result = i2s_channel_reconfig_std_clock(tx,&clock);
        }
        if (result == ESP_OK) {
            result = i2s_channel_enable(tx);
            enabled = result == ESP_OK;
        }
        xSemaphoreGive(lock);
        for (size_t frame=0;result==ESP_OK && frame<frames;frame+=CHUNK) {
            xSemaphoreTake(lock,portMAX_DELAY);
            if (mine!=generation || !enabled) { xSemaphoreGive(lock); break; }
            size_t count = frames-frame < CHUNK ? frames-frame : CHUNK;
            for (size_t i=0;i<count;i++) {
                int32_t value;
                if (pcm) value = pcm[frame+i];
                else {
                    size_t n=frame+i;
                    float envelope = n<160 ? (float)n/160 :
                        (n>=frames-160 ? (float)(frames-n-1)/160 : 1);
                    value = (int32_t)(sinf(6.28318530718f*440*(float)n/rate)*8192*envelope);
                }
                int16_t sample = (int16_t)(value * (int32_t)volume_level / 100);
                samples[i*2]=sample; samples[i*2+1]=sample;
            }
            size_t written=0;
            result=i2s_channel_write(tx,samples,count*4,&written,20);
            if (result==ESP_OK && written!=count*4) result=ESP_FAIL;
            xSemaphoreGive(lock);
            taskYIELD();
        }
        /* Drain the bounded DMA tail while allowing immediate stop to acquire lock. */
        if (result==ESP_OK) vTaskDelay(pdMS_TO_TICKS(40));
        xSemaphoreTake(lock,portMAX_DELAY);
        if (mine==generation) {
            esp_err_t end=halt_locked();
            if (result==ESP_OK) result=end;
            busy=false;
            snprintf(status.state,sizeof(status.state),"%s",result==ESP_OK?"completed":"error");
            snprintf(status.error,sizeof(status.error),"%s",result==ESP_OK?"":esp_err_to_name(result));
        }
        xSemaphoreGive(lock);
        if (pcm) heap_caps_free(pcm);
        if (result!=ESP_OK) ESP_LOGE(TAG,"playback failed: %s",esp_err_to_name(result));
    }
}
esp_err_t lease_audio_init(void)
{
    SemaphoreHandle_t m=audio_lock(); if (!m) return ESP_ERR_NO_MEM;
    xSemaphoreTake(m,portMAX_DELAY);
    if (initialized) { xSemaphoreGive(m);return ESP_OK; }
    i2s_chan_config_t channel=I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_AUTO,I2S_ROLE_MASTER);
    channel.dma_desc_num=DMA_COUNT; channel.dma_frame_num=CHUNK;
    channel.auto_clear_after_cb=true;
    esp_err_t error=i2s_new_channel(&channel,&tx,NULL);
    if (error==ESP_OK) {
        i2s_std_config_t config={
            .clk_cfg=I2S_STD_CLK_DEFAULT_CONFIG(24000),
            .slot_cfg=I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,I2S_SLOT_MODE_STEREO),
            .gpio_cfg={.mclk=I2S_GPIO_UNUSED,.bclk=GPIO_NUM_15,.ws=GPIO_NUM_16,
                .dout=GPIO_NUM_7,.din=I2S_GPIO_UNUSED,
                .invert_flags={.mclk_inv=false,.bclk_inv=false,.ws_inv=false}}};
        error=i2s_channel_init_std_mode(tx,&config);
    }
    if (error==ESP_OK) error=halt_locked();
    if (error==ESP_OK && xTaskCreate(audio_worker,"lease_audio",4096,NULL,4,&worker)!=pdPASS)
        error=ESP_ERR_NO_MEM;
    if (error==ESP_OK) {
        initialized=true;
        ESP_LOGI(TAG,"ready: PCM16LE mono -> Philips stereo; DIN7 BCLK15 WS16; volume35; silent at boot");
    } else if (tx) { i2s_del_channel(tx);tx=NULL; }
    xSemaphoreGive(m);return error;
}
esp_err_t lease_audio_set_volume(unsigned volume)
{
    if (volume>100) return ESP_ERR_INVALID_ARG;
    SemaphoreHandle_t m=audio_lock();if(!m)return ESP_ERR_NO_MEM;
    xSemaphoreTake(m,portMAX_DELAY);
    esp_err_t error=initialized?ESP_OK:ESP_ERR_INVALID_STATE;
    if(error==ESP_OK)volume_level=volume;
    xSemaphoreGive(m);return error;
}
bool lease_audio_busy(void)
{
    SemaphoreHandle_t m=audio_lock();if(!m)return true;
    xSemaphoreTake(m,portMAX_DELAY);bool value=busy;xSemaphoreGive(m);return value;
}
lease_audio_status_t lease_audio_status(void)
{
    SemaphoreHandle_t m=audio_lock();
    if(!m) { lease_audio_status_t failure={.state="error",.error="ESP_ERR_NO_MEM"};return failure; }
    xSemaphoreTake(m,portMAX_DELAY);lease_audio_status_t copy=status;xSemaphoreGive(m);return copy;
}
esp_err_t lease_audio_reserve_pcm(const char *id,uint32_t *ticket)
{
    if(!valid_id(id)||!ticket)return ESP_ERR_INVALID_ARG;
    SemaphoreHandle_t m=audio_lock();if(!m)return ESP_ERR_NO_MEM;
    xSemaphoreTake(m,portMAX_DELAY);
    esp_err_t error=!initialized?ESP_ERR_INVALID_STATE:busy?ESP_ERR_NOT_FINISHED:ESP_OK;
    if(error==ESP_OK) {
        ++generation;*ticket=generation;busy=true;requested=false;
        snprintf(status.id,sizeof(status.id),"%s",id);
        snprintf(status.state,sizeof(status.state),"queued");status.error[0]=0;
    }
    xSemaphoreGive(m);return error;
}
bool lease_audio_reservation_active(uint32_t ticket)
{
    SemaphoreHandle_t m=audio_lock();if(!m)return false;
    xSemaphoreTake(m,portMAX_DELAY);
    bool active=busy&&generation==ticket&&!strcmp(status.state,"queued");
    xSemaphoreGive(m);return active;
}
void lease_audio_abandon_pcm(uint32_t ticket,esp_err_t error)
{
    SemaphoreHandle_t m=audio_lock();if(!m)return;
    xSemaphoreTake(m,portMAX_DELAY);
    if(busy&&generation==ticket&&!strcmp(status.state,"queued")) {
        busy=false;snprintf(status.state,sizeof(status.state),"error");
        snprintf(status.error,sizeof(status.error),"%s",esp_err_to_name(error));
    }
    xSemaphoreGive(m);
}
esp_err_t lease_audio_play_pcm(void *buffer,size_t bytes,unsigned rate,const char *id,uint32_t ticket)
{
    if (!buffer || !bytes || (bytes&1) || bytes>MAX_PCM ||
        (rate!=16000 && rate!=24000 && rate!=32000) || !valid_id(id)) return ESP_ERR_INVALID_ARG;
    SemaphoreHandle_t m=audio_lock();if(!m)return ESP_ERR_NO_MEM;
    xSemaphoreTake(m,portMAX_DELAY);
    esp_err_t error=initialized&&busy&&generation==ticket&&!strcmp(status.state,"queued")&&
        !strcmp(status.id,id)?ESP_OK:ESP_ERR_INVALID_STATE;
    if(error==ESP_OK) {
        requested=true;pending_pcm=buffer;pending_bytes=bytes;pending_rate=rate;
        snprintf(status.state,sizeof(status.state),"playing");status.error[0]=0;
        xTaskNotifyGive(worker);
    }
    xSemaphoreGive(m);return error;
}
esp_err_t lease_audio_test_tone(void)
{
    SemaphoreHandle_t m=audio_lock();if(!m)return ESP_ERR_NO_MEM;
    xSemaphoreTake(m,portMAX_DELAY);
    esp_err_t error=!initialized?ESP_ERR_INVALID_STATE:busy?ESP_ERR_NOT_FINISHED:ESP_OK;
    if(error==ESP_OK) {
        ++generation;busy=true;requested=true;pending_pcm=NULL;
        status.id[0]=0;snprintf(status.state,sizeof(status.state),"playing");status.error[0]=0;
        xTaskNotifyGive(worker);
    }
    xSemaphoreGive(m);return error;
}
esp_err_t lease_audio_stop_id(const char *id)
{
    SemaphoreHandle_t m=audio_lock();if(!m)return ESP_ERR_NO_MEM;
    xSemaphoreTake(m,portMAX_DELAY);
    esp_err_t error=initialized?ESP_OK:ESP_ERR_INVALID_STATE;
    if(error==ESP_OK && (!id || !strcmp(status.id,id))) {
        ++generation;requested=false;busy=false;
        if(pending_pcm) {heap_caps_free(pending_pcm);pending_pcm=NULL;}
        error=halt_locked();
        snprintf(status.state,sizeof(status.state),"stopped");
        snprintf(status.error,sizeof(status.error),"%s",error==ESP_OK?"":esp_err_to_name(error));
    }
    xSemaphoreGive(m);return error;
}
esp_err_t lease_audio_stop(void) { return lease_audio_stop_id(NULL); }
