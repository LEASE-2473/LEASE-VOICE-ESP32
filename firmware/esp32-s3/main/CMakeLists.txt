idf_component_register(SRCS "main.c" "lease_network.c" "lease_service.c" INCLUDE_DIRS "."
    REQUIRES esp_app_format esp_system esp_hw_support esp_psram spi_flash heap esp_timer
             esp_wifi esp_event esp_netif nvs_flash esp_http_server json esp_driver_uart lease_audio lease_display)
