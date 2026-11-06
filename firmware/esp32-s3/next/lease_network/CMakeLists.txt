# M1 draft: only build when a future M1 project explicitly adds this directory.
idf_component_register(SRCS "lease_network.c" INCLUDE_DIRS "include"
    REQUIRES esp_wifi esp_event esp_netif nvs_flash freertos)
