idf_component_register(SRCS "lease_audio.c" INCLUDE_DIRS "include"
                       REQUIRES esp_driver_i2s PRIV_REQUIRES freertos)
