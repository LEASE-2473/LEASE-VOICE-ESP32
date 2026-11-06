#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "lease_service.h"
#include "lease_network.h"
#include "lease_audio.h"
#include "lease_display.h"
#include "esp_timer.h"
#include "cJSON.h"
#include "esp_app_desc.h"
#include "esp_http_server.h"
#include "esp_heap_caps.h"
#include "lwip/sockets.h"
#include "nvs.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "driver/uart.h"

static portMUX_TYPE token_lock = portMUX_INITIALIZER_UNLOCKED;
static char device_token[97];
static bool can_audio;
static bool can_display;
static SemaphoreHandle_t display_upload_lock;
static StaticSemaphore_t upload_lock_storage;
static SemaphoreHandle_t upload_lock;
static struct { httpd_handle_t server; int fd; uint32_t ticket; char id[65]; bool active; } upload_session;
static void abort_upload(const char *id)
{
    if(!upload_lock)return;
    xSemaphoreTake(upload_lock,portMAX_DELAY);
    if(upload_session.active&&(!id||!strcmp(id,upload_session.id))) {
        /* Interrupt recv without recycling the session while async req owns it. */
        shutdown(upload_session.fd,SHUT_RDWR);
        upload_session.active=false;
    }
    xSemaphoreGive(upload_lock);
}

bool lease_service_has_token(void)
{
    portENTER_CRITICAL(&token_lock);
    bool result = device_token[0] != 0;
    portEXIT_CRITICAL(&token_lock);
    return result;
}

esp_err_t lease_service_set_token(const char *token)
{
    if (!token) return ESP_ERR_INVALID_ARG;
    size_t length = strnlen(token, sizeof(device_token));
    if (length > 96 || (length && length < 16)) return ESP_ERR_INVALID_ARG;
    for (size_t i = 0; i < length; ++i) if (token[i] < 33 || token[i] > 126) return ESP_ERR_INVALID_ARG;
    nvs_handle_t store;
    esp_err_t error = nvs_open("lease_voice", NVS_READWRITE, &store);
    if (error == ESP_OK) {
        error = nvs_set_str(store, "token", token);
        if (error == ESP_OK) error = nvs_commit(store);
        nvs_close(store);
    }
    if (error == ESP_OK) {
        portENTER_CRITICAL(&token_lock);
        memset(device_token, 0, sizeof(device_token));
        memcpy(device_token, token, length);
        portEXIT_CRITICAL(&token_lock);
    }
    return error;
}

static bool authorized(httpd_req_t *request)
{
    char expected[104] = "Bearer ";
    portENTER_CRITICAL(&token_lock);
    bool needed = device_token[0] != 0;
    memcpy(expected + 7, device_token, sizeof(device_token));
    portEXIT_CRITICAL(&token_lock);
    if (!needed) return true;
    char supplied[104] = {0};
    size_t length = httpd_req_get_hdr_value_len(request, "Authorization");
    if (length != strlen(expected) || length >= sizeof(supplied) ||
        httpd_req_get_hdr_value_str(request, "Authorization", supplied, sizeof(supplied)) != ESP_OK) {
        memset(expected, 0, sizeof(expected)); return false;
    }
    unsigned difference = 0;
    for (size_t i = 0; i < length; ++i) difference |= (unsigned char)expected[i] ^ (unsigned char)supplied[i];
    memset(expected, 0, sizeof(expected)); memset(supplied, 0, sizeof(supplied));
    return difference == 0;
}

static cJSON *response(const char *action, esp_err_t error)
{
    cJSON *json = cJSON_CreateObject();
    cJSON_AddNumberToObject(json, "protocol", 1);
    cJSON_AddBoolToObject(json, "ok", error == ESP_OK);
    if (action) cJSON_AddStringToObject(json, "action", action);
    if (error != ESP_OK) cJSON_AddStringToObject(json, "error", esp_err_to_name(error));
    return json;
}

static void add_status(cJSON *json)
{
    lease_network_status_t status = lease_network_status();
    cJSON_AddStringToObject(json, "state", status.state);
    cJSON_AddStringToObject(json, "ssid", status.ssid);
    cJSON_AddStringToObject(json, "ip", status.ip);
    cJSON_AddNumberToObject(json, "disconnects", status.disconnects);
    cJSON_AddStringToObject(json, "auth", lease_service_has_token() ? "token" : "lan-unpaired");
    cJSON_AddBoolToObject(json, "audio", can_audio);
}

static esp_err_t send_json(httpd_req_t *request, cJSON *json, const char *status)
{
    char *text = cJSON_PrintUnformatted(json);
    cJSON_Delete(json);
    if (!text) return httpd_resp_send_err(request, HTTPD_500_INTERNAL_SERVER_ERROR, "Out of memory");
    httpd_resp_set_type(request, "application/json");
    httpd_resp_set_hdr(request, "Cache-Control", "no-store");
    if (status) httpd_resp_set_status(request, status);
    esp_err_t error = httpd_resp_sendstr(request, text);
    free(text);
    return error;
}

static esp_err_t info_handler(httpd_req_t *request)
{
    if (!authorized(request)) return send_json(request, response(NULL, ESP_ERR_INVALID_STATE), "401 Unauthorized");
    cJSON *json = cJSON_CreateObject();
    cJSON_AddNumberToObject(json, "protocol", 1);
    cJSON_AddStringToObject(json, "kind", "lease-voice-esp32");
    cJSON_AddStringToObject(json, "name", "LEASE VOICE ESP32-S3");
    cJSON_AddStringToObject(json, "firmware", esp_app_get_description()->version);
    cJSON *caps = cJSON_AddArrayToObject(json, "capabilities");
    cJSON_AddItemToArray(caps, cJSON_CreateString("wifi"));
    if (can_audio) {
        cJSON_AddItemToArray(caps, cJSON_CreateString("test-tone"));
        cJSON_AddItemToArray(caps, cJSON_CreateString("volume"));
        cJSON_AddItemToArray(caps, cJSON_CreateString("stop"));
        cJSON_AddItemToArray(caps, cJSON_CreateString("audio-pcm16"));
        cJSON_AddItemToArray(caps, cJSON_CreateString("playback-status"));
    }
    if(can_display) {
        cJSON_AddItemToArray(caps,cJSON_CreateString("display-rgb565"));
        cJSON_AddItemToArray(caps,cJSON_CreateString("display-config"));
    }
    add_status(json);
    return send_json(request, json, NULL);
}

static esp_err_t audio_command(const cJSON *json, const char *action)
{
    if (!can_audio) return ESP_ERR_INVALID_STATE;
    if (!strcmp(action, "test-tone")) return lease_audio_test_tone();
    if (!strcmp(action, "stop")) {
        const cJSON *id = cJSON_GetObjectItemCaseSensitive(json, "id");
        if (id && (!cJSON_IsString(id) || !id->valuestring[0] || strlen(id->valuestring)>64)) return ESP_ERR_INVALID_ARG;
        esp_err_t error=lease_audio_stop_id(id ? id->valuestring : NULL);
        if(error==ESP_OK)abort_upload(id ? id->valuestring : NULL);
        return error;
    }
    if (!strcmp(action, "volume")) {
        const cJSON *value = cJSON_GetObjectItemCaseSensitive(json, "value");
        if (!cJSON_IsNumber(value) || value->valuedouble < 0 || value->valuedouble > 100 ||
            floor(value->valuedouble) != value->valuedouble) return ESP_ERR_INVALID_ARG;
        return lease_audio_set_volume((unsigned)value->valuedouble);
    }
    return ESP_ERR_NOT_SUPPORTED;
}

static bool only_fields(const cJSON *object, const char *allowed)
{
    const cJSON *field;
    cJSON_ArrayForEach(field, object) {
        if (!field->string) return false;
        char key[64];
        if (strlen(field->string) > 55) return false;
        snprintf(key, sizeof(key), "|%s|", field->string);
        if (!strstr(allowed, key)) return false;
        /* Reject duplicate keys rather than resolving an ambiguous request. */
        for (const cJSON *prior = object->child; prior != field; prior = prior->next)
            if (!strcmp(prior->string, field->string)) return false;
    }
    return true;
}

static esp_err_t command_handler(httpd_req_t *request)
{
    if (!authorized(request)) return send_json(request, response(NULL, ESP_ERR_INVALID_STATE), "401 Unauthorized");
    if (request->content_len < 2 || request->content_len > 256)
        return send_json(request, response(NULL, ESP_ERR_INVALID_SIZE), "400 Bad Request");
    char body[257] = {0};
    int used = 0;
    while (used < request->content_len) {
        int count = httpd_req_recv(request, body + used, request->content_len - used);
        if (count <= 0) return send_json(request, response(NULL, ESP_ERR_TIMEOUT), "408 Request Timeout");
        used += count;
    }
    if (memchr(body, 0, used))
        return send_json(request, response(NULL, ESP_ERR_INVALID_ARG), "400 Bad Request");
    cJSON *json = cJSON_ParseWithLengthOpts(body, used + 1, NULL, true);
    const cJSON *protocol = cJSON_GetObjectItemCaseSensitive(json, "protocol");
    const cJSON *action = cJSON_GetObjectItemCaseSensitive(json, "action");
    esp_err_t error = ESP_ERR_INVALID_ARG;
    if (cJSON_IsObject(json) && cJSON_IsNumber(protocol) && protocol->valuedouble == 1 && cJSON_IsString(action)) {
        bool volume = !strcmp(action->valuestring, "volume");
        if (only_fields(json, volume ? "|protocol||action||value|" : !strcmp(action->valuestring,"stop") ? "|protocol||action||id|" : "|protocol||action|"))
            error = audio_command(json, action->valuestring);
    }
    cJSON_Delete(json);
    return send_json(request, response(NULL, error), error == ESP_OK ? NULL : "400 Bad Request");
}


static cJSON *playback_json(void)
{
    lease_audio_status_t snapshot=lease_audio_status();
    cJSON *json=cJSON_CreateObject();
    cJSON_AddNumberToObject(json,"protocol",1);
    cJSON_AddStringToObject(json,"id",snapshot.id);
    cJSON_AddStringToObject(json,"state",snapshot.state);
    if(snapshot.error[0]) cJSON_AddStringToObject(json,"error",snapshot.error);
    return json;
}
static esp_err_t playback_handler(httpd_req_t *request)
{
    if(!authorized(request))return send_json(request,response(NULL,ESP_ERR_INVALID_STATE),"401 Unauthorized");
    return send_json(request,playback_json(),NULL);
}
/* Closing rejected upload requests prevents unread body data from being
 * interpreted as another request on a persistent HTTP connection. */
static esp_err_t reject_upload(httpd_req_t *request,esp_err_t error,const char *status)
{
    httpd_resp_set_hdr(request,"Connection","close");
    send_json(request,response(NULL,error),status);
    return ESP_FAIL;
}
static bool valid_audio_id(const char *id)
{
    size_t length=strlen(id);
    if(!length || length>64)return false;
    for(size_t i=0;i<length;i++)
        if(!((id[i]>='a'&&id[i]<='z')||(id[i]>='A'&&id[i]<='Z')||
             (id[i]>='0'&&id[i]<='9')||id[i]=='_'||id[i]=='-'))return false;
    return true;
}
typedef struct { httpd_req_t *request; char id[65]; unsigned rate; size_t bytes; uint32_t ticket; } upload_work_t;
static void upload_worker(void *argument)
{
    upload_work_t *work=argument;
    httpd_req_t *request=work->request;
    httpd_handle_t server=request->handle;
    int fd=httpd_req_to_sockfd(request);
    esp_err_t error=ESP_OK;
    void *buffer=heap_caps_malloc(work->bytes,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    if(!buffer)error=ESP_ERR_NO_MEM;
    size_t used=0;
    while(error==ESP_OK&&used<work->bytes) {
        if(!lease_audio_reservation_active(work->ticket)) {error=ESP_ERR_INVALID_STATE;break;}
        size_t count_max=work->bytes-used;
        if(count_max>8192)count_max=8192;
        int count=httpd_req_recv(request,(char *)buffer+used,count_max);
        if(count<=0) {error=ESP_ERR_TIMEOUT;break;}
        used+=count;
    }
    if(error==ESP_OK)error=lease_audio_play_pcm(buffer,used,work->rate,work->id,work->ticket);
    if(error==ESP_OK) {
        buffer=NULL; /* Ownership now belongs exclusively to audio worker. */
        cJSON *json=cJSON_CreateObject();
        cJSON_AddNumberToObject(json,"protocol",1);
        cJSON_AddBoolToObject(json,"ok",true);
        cJSON_AddStringToObject(json,"id",work->id);
        cJSON_AddStringToObject(json,"state","playing");
        send_json(request,json,"202 Accepted");
    } else {
        lease_audio_abandon_pcm(work->ticket,error);
        httpd_resp_set_hdr(request,"Connection","close");
        send_json(request,response(NULL,error),error==ESP_ERR_NO_MEM?"503 Service Unavailable":
            error==ESP_ERR_INVALID_STATE?"409 Conflict":"408 Request Timeout");
    }
    if(buffer)heap_caps_free(buffer);
    xSemaphoreTake(upload_lock,portMAX_DELAY);
    if(upload_session.ticket==work->ticket)upload_session.active=false;
    xSemaphoreGive(upload_lock);
    httpd_req_async_handler_complete(request);
    if(error!=ESP_OK)httpd_sess_trigger_close(server,fd);
    free(work);
    vTaskDelete(NULL);
}
static esp_err_t upload_handler(httpd_req_t *request)
{
    if(!authorized(request))return reject_upload(request,ESP_ERR_INVALID_STATE,"401 Unauthorized");
    if(!can_audio)return reject_upload(request,ESP_ERR_INVALID_STATE,"503 Service Unavailable");
    char type[48]={0},id[65]={0},sample_rate[12]={0};
    if(httpd_req_get_hdr_value_str(request,"Content-Type",type,sizeof(type))!=ESP_OK ||
       strcmp(type,"application/octet-stream") ||
       httpd_req_get_hdr_value_str(request,"X-Lease-Audio-Id",id,sizeof(id))!=ESP_OK ||
       !valid_audio_id(id) ||
       httpd_req_get_hdr_value_str(request,"X-Lease-Sample-Rate",sample_rate,sizeof(sample_rate))!=ESP_OK)
        return reject_upload(request,ESP_ERR_INVALID_ARG,"400 Bad Request");
    unsigned rate=!strcmp(sample_rate,"24000")?24000:!strcmp(sample_rate,"16000")?16000:!strcmp(sample_rate,"32000")?32000:0;
    if(!rate)return reject_upload(request,ESP_ERR_INVALID_ARG,"400 Bad Request");
    if(request->content_len>4*1024*1024)return reject_upload(request,ESP_ERR_INVALID_SIZE,"413 Payload Too Large");
    if(!request->content_len || (request->content_len&1))return reject_upload(request,ESP_ERR_INVALID_SIZE,"400 Bad Request");
    upload_work_t *work=calloc(1,sizeof(*work));
    if(!work)return reject_upload(request,ESP_ERR_NO_MEM,"503 Service Unavailable");
    work->rate=rate;work->bytes=request->content_len;snprintf(work->id,sizeof(work->id),"%s",id);
    esp_err_t error=lease_audio_reserve_pcm(id,&work->ticket);
    if(error!=ESP_OK) {
        free(work);return reject_upload(request,error,error==ESP_ERR_NOT_FINISHED?"409 Conflict":"503 Service Unavailable");
    }
    error=httpd_req_async_handler_begin(request,&work->request);
    if(error!=ESP_OK) {
        lease_audio_abandon_pcm(work->ticket,error);free(work);
        return reject_upload(request,error,"503 Service Unavailable");
    }
    xSemaphoreTake(upload_lock,portMAX_DELAY);
    upload_session.server=request->handle;upload_session.fd=httpd_req_to_sockfd(request);
    upload_session.ticket=work->ticket;snprintf(upload_session.id,sizeof(upload_session.id),"%s",id);
    upload_session.active=true;
    xSemaphoreGive(upload_lock);
    if(xTaskCreate(upload_worker,"lease_upload",6144,work,4,NULL)!=pdPASS) {
        lease_audio_abandon_pcm(work->ticket,ESP_ERR_NO_MEM);
        xSemaphoreTake(upload_lock,portMAX_DELAY);upload_session.active=false;xSemaphoreGive(upload_lock);
        send_json(work->request,response(NULL,ESP_ERR_NO_MEM),"503 Service Unavailable");
        httpd_req_async_handler_complete(work->request);
        httpd_sess_trigger_close(request->handle,httpd_req_to_sockfd(request));
        free(work);
    }
    return ESP_OK;
}

static cJSON *display_json(void)
{
    lease_display_status_t s=lease_display_status();
    cJSON *json=response(NULL,ESP_OK);
    cJSON_AddBoolToObject(json,"ready",s.ready);
    cJSON_AddStringToObject(json,"profile",s.config.profile);
    cJSON_AddStringToObject(json,"format","rgb565be");
    cJSON_AddNumberToObject(json,"width",s.width);cJSON_AddNumberToObject(json,"height",s.height);
    cJSON_AddStringToObject(json,"streamId",s.stream);
    cJSON_AddNumberToObject(json,"lastSequence",s.last_sequence);
    cJSON_AddNumberToObject(json,"received",s.received);cJSON_AddNumberToObject(json,"drawn",s.drawn);
    cJSON_AddNumberToObject(json,"dropped",s.dropped);cJSON_AddNumberToObject(json,"timeouts",s.timeouts);
    cJSON_AddNumberToObject(json,"xGap",s.config.x_gap);cJSON_AddNumberToObject(json,"yGap",s.config.y_gap);
    cJSON_AddBoolToObject(json,"swapXY",s.config.swap_xy);cJSON_AddBoolToObject(json,"mirrorX",s.config.mirror_x);
    cJSON_AddBoolToObject(json,"mirrorY",s.config.mirror_y);cJSON_AddBoolToObject(json,"bgr",s.config.bgr);
    cJSON_AddBoolToObject(json,"invert",s.config.invert);
    if(s.error!=ESP_OK)cJSON_AddStringToObject(json,"displayError",esp_err_to_name(s.error));
    return json;
}
static bool bool_field(const cJSON *json,const char *name,bool *out)
{
    const cJSON *item=cJSON_GetObjectItemCaseSensitive(json,name);
    if(!item) {*out=false;return true;}
    if(!cJSON_IsBool(item))return false;
    *out=cJSON_IsTrue(item);return true;
}
static bool gap_field(const cJSON *json,const char *name,unsigned *out)
{
    const cJSON *item=cJSON_GetObjectItemCaseSensitive(json,name);
    if(!item) {*out=0;return true;}
    if(!cJSON_IsNumber(item)||item->valuedouble<0||item->valuedouble>80||floor(item->valuedouble)!=item->valuedouble)return false;
    *out=(unsigned)item->valuedouble;return true;
}
static esp_err_t display_handler(httpd_req_t *request)
{
    if(!authorized(request))return request->method==HTTP_POST?reject_upload(request,ESP_ERR_INVALID_STATE,"401 Unauthorized"):
        send_json(request,response(NULL,ESP_ERR_INVALID_STATE),"401 Unauthorized");
    if(!can_display)return reject_upload(request,ESP_ERR_INVALID_STATE,"503 Service Unavailable");
    if(request->method==HTTP_GET)return send_json(request,display_json(),NULL);
    if(request->content_len<2||request->content_len>768)return reject_upload(request,ESP_ERR_INVALID_SIZE,"400 Bad Request");
    char raw[769]={0};size_t used=0;
    while(used<request->content_len) {
        int n=httpd_req_recv(request,raw+used,request->content_len-used);
        if(n<=0)return reject_upload(request,ESP_ERR_TIMEOUT,"408 Request Timeout");
        used+=n;
    }
    if(memchr(raw,0,used))return reject_upload(request,ESP_ERR_INVALID_ARG,"400 Bad Request");
    cJSON *json=cJSON_ParseWithLengthOpts(raw,used+1,NULL,true);
    const cJSON *protocol=cJSON_GetObjectItemCaseSensitive(json,"protocol"),*action=cJSON_GetObjectItemCaseSensitive(json,"action");
    esp_err_t e=ESP_ERR_INVALID_ARG;
    if(cJSON_IsObject(json)&&cJSON_IsNumber(protocol)&&protocol->valuedouble==1&&cJSON_IsString(action)) {
        if(!strcmp(action->valuestring,"configure")&&only_fields(json,"|protocol||action||profile||xGap||yGap||swapXY||mirrorX||mirrorY||bgr||invert|")) {
            const cJSON *profile=cJSON_GetObjectItemCaseSensitive(json,"profile");
            lease_display_config_t cfg={0};
            if(cJSON_IsString(profile)&&strlen(profile->valuestring)<sizeof(cfg.profile)&&
                gap_field(json,"xGap",&cfg.x_gap)&&gap_field(json,"yGap",&cfg.y_gap)&&bool_field(json,"swapXY",&cfg.swap_xy)&&
                bool_field(json,"mirrorX",&cfg.mirror_x)&&bool_field(json,"mirrorY",&cfg.mirror_y)&&
                bool_field(json,"bgr",&cfg.bgr)&&bool_field(json,"invert",&cfg.invert)) {
                strcpy(cfg.profile,profile->valuestring);e=lease_display_configure(&cfg);
            }
        } else if((!strcmp(action->valuestring,"start")||!strcmp(action->valuestring,"stop"))&&only_fields(json,"|protocol||action||streamId|")) {
            const cJSON *stream=cJSON_GetObjectItemCaseSensitive(json,"streamId");
            if(cJSON_IsString(stream))e=!strcmp(action->valuestring,"start")?lease_display_start(stream->valuestring):lease_display_stop(stream->valuestring);
        }
    }
    cJSON_Delete(json);
    return send_json(request,e==ESP_OK?display_json():response(NULL,e),e==ESP_OK?NULL:e==ESP_ERR_NOT_FINISHED?"409 Conflict":"400 Bad Request");
}
typedef struct {httpd_req_t *request;char stream[65];uint32_t sequence;unsigned width,height;size_t bytes;} frame_work_t;
static void frame_worker(void *arg)
{
    frame_work_t *work=arg;httpd_req_t *r=work->request;
    httpd_handle_t server=r->handle;int fd=httpd_req_to_sockfd(r);
    void *pixels=heap_caps_malloc(work->bytes,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    esp_err_t e=pixels?ESP_OK:ESP_ERR_NO_MEM;size_t used=0;
    int64_t deadline=esp_timer_get_time()+INT64_C(2000000);
    while(e==ESP_OK&&used<work->bytes) {
        e=lease_display_validate(work->stream,work->sequence,work->width,work->height,work->bytes);
        if(e!=ESP_OK)break;
        if(esp_timer_get_time()>deadline) {e=ESP_ERR_TIMEOUT;break;}
        size_t count=work->bytes-used;if(count>8192)count=8192;
        int n=httpd_req_recv(r,(char *)pixels+used,count);
        if(n<=0) {e=ESP_ERR_TIMEOUT;break;}used+=n;
    }
    if(e==ESP_OK)e=lease_display_submit(pixels,work->bytes,work->stream,work->sequence,work->width,work->height);
    if(e==ESP_OK) {
        pixels=NULL;
        cJSON *json=response(NULL,ESP_OK);cJSON_AddStringToObject(json,"streamId",work->stream);
        cJSON_AddNumberToObject(json,"sequence",work->sequence);cJSON_AddStringToObject(json,"state","queued");
        send_json(r,json,"202 Accepted");
    } else {httpd_resp_set_hdr(r,"Connection","close");send_json(r,response(NULL,e),e==ESP_ERR_NO_MEM?"503 Service Unavailable":e==ESP_ERR_TIMEOUT?"408 Request Timeout":"409 Conflict");}
    if(pixels)heap_caps_free(pixels);
    xSemaphoreGive(display_upload_lock);
    httpd_req_async_handler_complete(r);
    if(e!=ESP_OK)httpd_sess_trigger_close(server,fd);
    free(work);vTaskDelete(NULL);
}
static bool uint_header(httpd_req_t *r,const char *name,uint32_t *value)
{
    char raw[12]={0};if(httpd_req_get_hdr_value_str(r,name,raw,sizeof(raw))!=ESP_OK||!raw[0])return false;
    uint64_t result=0;
    for(const char *p=raw;*p;p++) {if(*p<'0'||*p>'9')return false;result=result*10+(*p-'0');if(result>UINT32_MAX)return false;}
    *value=(uint32_t)result;return true;
}
static esp_err_t frame_handler(httpd_req_t *r)
{
    if(!authorized(r))return reject_upload(r,ESP_ERR_INVALID_STATE,"401 Unauthorized");
    if(!can_display)return reject_upload(r,ESP_ERR_INVALID_STATE,"503 Service Unavailable");
    if(r->content_len>LEASE_DISPLAY_MAX_BYTES)return reject_upload(r,ESP_ERR_INVALID_SIZE,"413 Payload Too Large");
    char type[48]={0};frame_work_t *work=calloc(1,sizeof(*work));
    if(!work)return reject_upload(r,ESP_ERR_NO_MEM,"503 Service Unavailable");
    uint32_t width=0,height=0;
    bool valid=httpd_req_get_hdr_value_str(r,"Content-Type",type,sizeof(type))==ESP_OK&&!strcmp(type,"application/octet-stream")&&
        httpd_req_get_hdr_value_str(r,"X-Lease-Stream-Id",work->stream,sizeof(work->stream))==ESP_OK&&valid_audio_id(work->stream)&&
        uint_header(r,"X-Lease-Sequence",&work->sequence)&&uint_header(r,"X-Lease-Width",&width)&&uint_header(r,"X-Lease-Height",&height);
    work->width=width;work->height=height;work->bytes=r->content_len;
    esp_err_t e=valid?lease_display_validate(work->stream,work->sequence,width,height,work->bytes):ESP_ERR_INVALID_ARG;
    if(e!=ESP_OK) {free(work);return reject_upload(r,e,e==ESP_ERR_INVALID_STATE?"409 Conflict":"400 Bad Request");}
    if(xSemaphoreTake(display_upload_lock,0)!=pdTRUE) {free(work);return reject_upload(r,ESP_ERR_NOT_FINISHED,"409 Conflict");}
    e=httpd_req_async_handler_begin(r,&work->request);
    if(e!=ESP_OK) {xSemaphoreGive(display_upload_lock);free(work);return reject_upload(r,e,"503 Service Unavailable");}
    if(xTaskCreate(frame_worker,"lease_frame",4096,work,3,NULL)!=pdPASS) {
        send_json(work->request,response(NULL,ESP_ERR_NO_MEM),"503 Service Unavailable");
        httpd_req_async_handler_complete(work->request);httpd_sess_trigger_close(r->handle,httpd_req_to_sockfd(r));
        xSemaphoreGive(display_upload_lock);free(work);
    }
    return ESP_OK;
}

esp_err_t lease_service_init(bool audio_ready, bool network_ready, bool display_ready)
{
    can_audio = audio_ready;
    can_display = display_ready;
    /* Reservation transfers from HTTP task to upload task: not an owned mutex. */
    display_upload_lock=xSemaphoreCreateCounting(1,1);
    if(!display_upload_lock)return ESP_ERR_NO_MEM;
    upload_lock=xSemaphoreCreateMutexStatic(&upload_lock_storage);
    if(!upload_lock)return ESP_ERR_NO_MEM;
    nvs_handle_t store;
    esp_err_t error = nvs_open("lease_voice", NVS_READONLY, &store);
    if (error == ESP_OK) {
        size_t length = sizeof(device_token);
        error = nvs_get_str(store, "token", device_token, &length);
        nvs_close(store);
        if (error == ESP_ERR_NVS_NOT_FOUND) error = ESP_OK;
    } else if (error == ESP_ERR_NVS_NOT_FOUND) error = ESP_OK;
    if (error != ESP_OK) return error;
    if (!network_ready) return ESP_ERR_INVALID_STATE;
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.stack_size = 6144;
    config.recv_wait_timeout = 3;
    config.send_wait_timeout = 3;
    config.max_uri_handlers = 8;
    config.lru_purge_enable = true;
    httpd_handle_t server = NULL;
    error = httpd_start(&server, &config);
    if (error != ESP_OK) return error;
    const httpd_uri_t info = {.uri="/lease-voice/v1/info", .method=HTTP_GET, .handler=info_handler};
    const httpd_uri_t command = {.uri="/lease-voice/v1/command", .method=HTTP_POST, .handler=command_handler};
    error = httpd_register_uri_handler(server, &info);
    if (error == ESP_OK) error = httpd_register_uri_handler(server, &command);
    const httpd_uri_t upload = {.uri="/lease-voice/v1/audio", .method=HTTP_POST, .handler=upload_handler};
    const httpd_uri_t playback = {.uri="/lease-voice/v1/playback", .method=HTTP_GET, .handler=playback_handler};
    if (error == ESP_OK) error = httpd_register_uri_handler(server, &upload);
    if (error == ESP_OK) error = httpd_register_uri_handler(server, &playback);
    const httpd_uri_t display_get={.uri="/lease-voice/v1/display",.method=HTTP_GET,.handler=display_handler};
    const httpd_uri_t display_post={.uri="/lease-voice/v1/display",.method=HTTP_POST,.handler=display_handler};
    const httpd_uri_t frame={.uri="/lease-voice/v1/frame",.method=HTTP_POST,.handler=frame_handler};
    if(error==ESP_OK)error=httpd_register_uri_handler(server,&display_get);
    if(error==ESP_OK)error=httpd_register_uri_handler(server,&display_post);
    if(error==ESP_OK)error=httpd_register_uri_handler(server,&frame);
    if (error != ESP_OK) httpd_stop(server);
    return error;
}

static void serial_line(char *line)
{
    cJSON *json = cJSON_ParseWithLengthOpts(line, strlen(line) + 1, NULL, true);
    const cJSON *action = cJSON_GetObjectItemCaseSensitive(json, "action");
    esp_err_t error = ESP_ERR_INVALID_ARG;
    const char *name = cJSON_IsString(action) ? action->valuestring : NULL;
    if (cJSON_IsObject(json) && name) {
        if (!strcmp(name, "wifi-set") && only_fields(json, "|action||ssid||password||token|")) {
            const cJSON *ssid = cJSON_GetObjectItemCaseSensitive(json, "ssid");
            const cJSON *password = cJSON_GetObjectItemCaseSensitive(json, "password");
            const cJSON *token = cJSON_GetObjectItemCaseSensitive(json, "token");
            if (cJSON_IsString(ssid) && cJSON_IsString(password) && (!token || cJSON_IsString(token))) {
                error = token ? lease_service_set_token(token->valuestring) : ESP_OK;
                if (error == ESP_OK) error = lease_network_configure(ssid->valuestring, password->valuestring);
            }
        } else if (!strcmp(name, "token-set") && only_fields(json, "|action||token|")) {
            const cJSON *token = cJSON_GetObjectItemCaseSensitive(json, "token");
            if (cJSON_IsString(token)) error = lease_service_set_token(token->valuestring);
        } else if (!strcmp(name, "status") && only_fields(json, "|action|")) {
            error = ESP_OK;
        } else if (only_fields(json, "|action||value||id|")) {
            error = audio_command(json, name);
        }
    }
    /* Echo only a known action, never any user-provided JSON or credential. */
    const char *known = name && (!strcmp(name,"wifi-set") || !strcmp(name,"token-set") ||
        !strcmp(name,"status") || !strcmp(name,"test-tone") || !strcmp(name,"stop") || !strcmp(name,"volume")) ? name : NULL;
    cJSON *reply = response(known, error);
    if (known && !strcmp(known, "status")) add_status(reply);
    char *text = cJSON_PrintUnformatted(reply);
    if (text) { printf("%s\n", text); fflush(stdout); free(text); }
    cJSON_Delete(reply);
    cJSON_Delete(json);
}

static void serial_task(void *unused)
{
    (void)unused;
    char line[513] = {0};
    size_t used = 0;
    bool overflow = false;
    for (;;) {
        uint8_t byte;
        if (uart_read_bytes(UART_NUM_0, &byte, 1, pdMS_TO_TICKS(100)) != 1) continue;
        if (byte == '\r') continue;
        if (byte == '\n') {
            if (overflow) {
                puts("{\"protocol\":1,\"ok\":false,\"error\":\"ESP_ERR_INVALID_SIZE\"}");
            } else if (used) {
                line[used] = 0;
                serial_line(line);
            }
            memset(line, 0, sizeof(line)); used = 0; overflow = false;
        } else if (!byte || used >= sizeof(line) - 1) {
            overflow = true;
        } else if (!overflow) {
            line[used++] = (char)byte;
        }
    }
}

esp_err_t lease_serial_start(void)
{
    esp_err_t error = uart_driver_install(UART_NUM_0, 2048, 0, 0, NULL, 0);
    if (error != ESP_OK) return error;
    return xTaskCreate(serial_task, "lease_setup", 6144, NULL, 4, NULL) == pdPASS ? ESP_OK : ESP_ERR_NO_MEM;
}
