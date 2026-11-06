#include <string.h>
#include <stdlib.h>
#include "lease_display.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"

/* MK024758 P7 pins 3..8, inferred signal roles from the usual 8-pin SPI module
 * order. Schematic proves net numbers, not the installed module or signal labels.
 * No automatic probing/boot-time enable. See docs/M3_DISPLAY.md. */
#define LCD_SCK 21
#define LCD_MOSI 47
#define LCD_RST 45
#define LCD_DC 40
#define LCD_CS 41
#define LCD_BL 42
#define CHUNK 4096
#define IDLE_US INT64_C(5000000)
typedef struct { void *pixels; size_t bytes; char stream[65]; uint32_t sequence; } frame_t;
static SemaphoreHandle_t lock;
static QueueHandle_t frames;
static lease_display_status_t state;
static spi_device_handle_t spi;
static bool bus_ready;
static uint8_t *dma;
static int64_t last_frame_at;

static bool valid_id(const char *id)
{
    if (!id || !id[0] || strlen(id) > 64) return false;
    for (const char *p=id; *p; p++) if (!((*p>='a'&&*p<='z')||(*p>='A'&&*p<='Z')||(*p>='0'&&*p<='9')||*p=='-'||*p=='_')) return false;
    return true;
}
static void flush(void)
{
    frame_t old;
    while (xQueueReceive(frames, &old, 0) == pdTRUE) { heap_caps_free(old.pixels); state.dropped++; }
}
static esp_err_t transfer(bool data, const void *bytes, size_t count)
{
    if (!count) return ESP_OK;
    gpio_set_level(LCD_DC, data);
    spi_transaction_t t = {.length = count * 8};
    if (count <= sizeof(t.tx_data)) { t.flags = SPI_TRANS_USE_TXDATA; memcpy(t.tx_data, bytes, count); }
    else t.tx_buffer = bytes;
    return spi_device_polling_transmit(spi, &t);
}
static esp_err_t command(uint8_t cmd, const void *bytes, size_t count)
{
    esp_err_t e = transfer(false, &cmd, 1);
    return e == ESP_OK ? transfer(true, bytes, count) : e;
}
static esp_err_t draw(const uint8_t *pixels, size_t bytes)
{
    unsigned x=state.config.x_gap, y=state.config.y_gap;
    unsigned xe=x+state.width-1, ye=y+state.height-1;
    uint8_t columns[]={x>>8,x,xe>>8,xe}, rows[]={y>>8,y,ye>>8,ye};
    esp_err_t e=command(0x2a, columns, 4);
    if(e==ESP_OK)e=command(0x2b, rows, 4);
    if(e==ESP_OK)e=command(0x2c, NULL, 0);
    for(size_t used=0;e==ESP_OK && used<bytes;used+=CHUNK) {
        size_t count=bytes-used; if(count>CHUNK)count=CHUNK;
        if(pixels)memcpy(dma,pixels+used,count); else memset(dma,0,count);
        e=transfer(true,dma,count); /* Synchronous DMA: buffer is safe to reuse on return. */
    }
    return e;
}
static void release_panel(void)
{
    if(bus_ready)gpio_set_level(LCD_BL,0);
    if(spi) {spi_bus_remove_device(spi);spi=NULL;}
    if(bus_ready) {spi_bus_free(SPI2_HOST);bus_ready=false;}
    if(dma) {heap_caps_free(dma);dma=NULL;}
    state.ready=false;
}
static esp_err_t panel_init(bool st7735)
{
    const spi_bus_config_t bus={.mosi_io_num=LCD_MOSI,.miso_io_num=-1,.sclk_io_num=LCD_SCK,
        .quadwp_io_num=-1,.quadhd_io_num=-1,.max_transfer_sz=CHUNK};
    esp_err_t e=spi_bus_initialize(SPI2_HOST,&bus,SPI_DMA_CH_AUTO);
    if(e!=ESP_OK)return e;
    bus_ready=true;
    gpio_config_t gpio={.pin_bit_mask=(1ULL<<LCD_RST)|(1ULL<<LCD_DC)|(1ULL<<LCD_BL),.mode=GPIO_MODE_OUTPUT};
    e=gpio_config(&gpio); if(e!=ESP_OK)return e;
    gpio_set_level(LCD_BL,0);
    const spi_device_interface_config_t device={.clock_speed_hz=20*1000*1000,.mode=0,.spics_io_num=LCD_CS,.queue_size=1};
    e=spi_bus_add_device(SPI2_HOST,&device,&spi);if(e!=ESP_OK)return e;
    dma=heap_caps_malloc(CHUNK,MALLOC_CAP_INTERNAL|MALLOC_CAP_DMA);
    if(!dma)return ESP_ERR_NO_MEM;
    gpio_set_level(LCD_RST,0);vTaskDelay(pdMS_TO_TICKS(20));
    gpio_set_level(LCD_RST,1);vTaskDelay(pdMS_TO_TICKS(120));
    e=command(0x01,NULL,0);vTaskDelay(pdMS_TO_TICKS(150));
    if(e==ESP_OK)e=command(0x11,NULL,0);
    vTaskDelay(pdMS_TO_TICKS(150));
    /* Minimal common ST77xx init, no unverified module-specific gamma/power
     * tuning. ST7735 COLMOD=05, ST7789 COLMOD=55. Visual validation is required. */
    uint8_t color=st7735?0x05:0x55;
    uint8_t madctl=(state.config.mirror_y?0x80:0)|(state.config.mirror_x?0x40:0)|
        (state.config.swap_xy?0x20:0)|(state.config.bgr?0x08:0);
    if(e==ESP_OK)e=command(0x3a,&color,1);
    if(e==ESP_OK)e=command(0x36,&madctl,1);
    if(e==ESP_OK)e=command(state.config.invert?0x21:0x20,NULL,0);
    if(e==ESP_OK)e=command(0x13,NULL,0);
    vTaskDelay(pdMS_TO_TICKS(10));
    if(e==ESP_OK)e=draw(NULL,(size_t)state.width*state.height*2);
    if(e==ESP_OK)e=command(0x29,NULL,0);
    if(e==ESP_OK)gpio_set_level(LCD_BL,1);
    return e;
}
static esp_err_t check_locked(const char *stream,uint32_t sequence,unsigned width,unsigned height,size_t bytes)
{
    if(!state.ready || !state.stream[0] || strcmp(stream,state.stream))return ESP_ERR_INVALID_STATE;
    if(width!=state.width || height!=state.height || bytes!=(size_t)width*height*2 || bytes>LEASE_DISPLAY_MAX_BYTES || !sequence)return ESP_ERR_INVALID_SIZE;
    if(sequence<=state.last_sequence)return ESP_ERR_INVALID_ARG;
    return ESP_OK;
}
static void worker(void *arg)
{
    (void)arg;
    for(;;) {
        frame_t frame={0}; bool have=xQueueReceive(frames,&frame,pdMS_TO_TICKS(100))==pdTRUE;
        xSemaphoreTake(lock,portMAX_DELAY);
        if(have) {
            if(state.ready && !strcmp(frame.stream,state.stream)) {
                state.error=draw(frame.pixels,frame.bytes);
                if(state.error==ESP_OK)state.drawn++;
                else {state.stream[0]=0;release_panel();flush();}
            } else state.dropped++;
        }
        if(state.stream[0] && esp_timer_get_time()-last_frame_at>IDLE_US) {
            state.stream[0]=0;state.timeouts++;flush();
            if(state.ready)state.error=draw(NULL,(size_t)state.width*state.height*2);
            if(state.error!=ESP_OK)release_panel();
        }
        xSemaphoreGive(lock);
        if(frame.pixels)heap_caps_free(frame.pixels);
    }
}
esp_err_t lease_display_init(void)
{
    if(lock)return ESP_OK;
    lock=xSemaphoreCreateMutex();
    if(!lock)return ESP_ERR_NO_MEM;
    frames=xQueueCreate(1,sizeof(frame_t));
    if(!frames) {vSemaphoreDelete(lock);lock=NULL;return ESP_ERR_NO_MEM;}
    strcpy(state.config.profile,"off");
    if(xTaskCreate(worker,"lease_display",4096,NULL,3,NULL)!=pdPASS) {
        vQueueDelete(frames);frames=NULL;vSemaphoreDelete(lock);lock=NULL;return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}
lease_display_status_t lease_display_status(void)
{
    lease_display_status_t result={0};
    if(!lock) {strcpy(result.config.profile,"off");result.error=ESP_ERR_INVALID_STATE;return result;}
    xSemaphoreTake(lock,portMAX_DELAY);result=state;xSemaphoreGive(lock);return result;
}
esp_err_t lease_display_configure(const lease_display_config_t *config)
{
    if(!lock||!config)return ESP_ERR_INVALID_STATE;
    bool off=!strcmp(config->profile,"off"),st7735=!strcmp(config->profile,"st7735-128x160");
    unsigned w=st7735?128:240,h=st7735?160:!strcmp(config->profile,"st7789-240x320")?320:240;
    if(!off&&!st7735&&strcmp(config->profile,"st7789-240x240")&&strcmp(config->profile,"st7789-240x320"))return ESP_ERR_INVALID_ARG;
    unsigned rw=st7735?132:240,rh=st7735?162:320;
    if(config->swap_xy) {unsigned t=w;w=h;h=t;t=rw;rw=rh;rh=t;}
    if(!off&&(config->x_gap>rw-w||config->y_gap>rh-h))return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(lock,portMAX_DELAY);
    if(state.stream[0]) {xSemaphoreGive(lock);return ESP_ERR_NOT_FINISHED;}
    flush();release_panel();state.config=*config;state.width=off?0:w;state.height=off?0:h;
    state.last_sequence=0;state.error=off?ESP_OK:panel_init(st7735);
    state.ready=!off&&state.error==ESP_OK;
    if(state.error!=ESP_OK)release_panel();
    esp_err_t e=state.error;xSemaphoreGive(lock);return e;
}
esp_err_t lease_display_start(const char *stream)
{
    if(!lock||!valid_id(stream))return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(lock,portMAX_DELAY);
    esp_err_t e=!state.ready?ESP_ERR_INVALID_STATE:state.stream[0]?ESP_ERR_NOT_FINISHED:ESP_OK;
    if(e==ESP_OK) {flush();strcpy(state.stream,stream);state.last_sequence=0;last_frame_at=esp_timer_get_time();}
    xSemaphoreGive(lock);return e;
}
esp_err_t lease_display_stop(const char *stream)
{
    if(!lock||!valid_id(stream))return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(lock,portMAX_DELAY);
    /* Stale stop cannot clear a newer stream. */
    if(!strcmp(stream,state.stream)) {
        state.stream[0]=0;flush();if(state.ready)state.error=draw(NULL,(size_t)state.width*state.height*2);
        if(state.error!=ESP_OK)release_panel();
    }
    xSemaphoreGive(lock);return ESP_OK;
}
esp_err_t lease_display_validate(const char *stream,uint32_t sequence,unsigned width,unsigned height,size_t bytes)
{
    if(!lock||!valid_id(stream))return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(lock,portMAX_DELAY);esp_err_t e=check_locked(stream,sequence,width,height,bytes);xSemaphoreGive(lock);return e;
}
esp_err_t lease_display_submit(void *pixels,size_t bytes,const char *stream,uint32_t sequence,unsigned width,unsigned height)
{
    if(!lock||!pixels||!valid_id(stream))return ESP_ERR_INVALID_ARG;
    xSemaphoreTake(lock,portMAX_DELAY);
    esp_err_t e=check_locked(stream,sequence,width,height,bytes);
    if(e==ESP_OK) {
        flush();frame_t frame={.pixels=pixels,.bytes=bytes,.sequence=sequence};strcpy(frame.stream,stream);
        if(xQueueSend(frames,&frame,0)!=pdTRUE)e=ESP_ERR_NOT_FINISHED;
        else {state.last_sequence=sequence;state.received++;last_frame_at=esp_timer_get_time();}
    }
    xSemaphoreGive(lock);return e;
}
