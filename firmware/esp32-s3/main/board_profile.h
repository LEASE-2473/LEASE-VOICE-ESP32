#pragma once

/* N16R8 core board; capacities from hardware identification in handoff.
 * Peripheral pins from MK024758/XZ-AI_KZBV1.8 schematic, pending PCB check.
 * M0 deliberately does not configure any of these peripheral GPIOs.
 */
#define LEASE_BOARD_NAME "ESP32-S3-N16R8 / MK024758 (PCB unverified)"
#define LEASE_FLASH_BYTES (16U * 1024U * 1024U)
#define LEASE_PSRAM_BYTES (8U * 1024U * 1024U)
#define LEASE_AMP_DIN_GPIO 7
#define LEASE_AMP_BCLK_GPIO 15
#define LEASE_AMP_LRCLK_GPIO 16
#define LEASE_MIC_WS_GPIO 4
#define LEASE_MIC_SCK_GPIO 5
#define LEASE_MIC_SD_GPIO 6
#define LEASE_BUTTON_BOOT_GPIO 0
#define LEASE_BUTTON_1_GPIO 38
#define LEASE_BUTTON_2_GPIO 39
