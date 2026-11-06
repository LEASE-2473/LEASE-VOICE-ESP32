# ESP-IDF 5.3.1 兼容性核对

日期：2026-11-02。先完成源码级兼容核对，用户安装完成后已使用 D:/Espressif/frameworks/esp-idf-v5.3.1 和同属 D:/Espressif 的工具/Python 环境完成实际 C 编译、链接、镜像生成、打包与离线校验。实际版本 v5.3.1-dirty，详情及工作区审计见 README 和交付清单；未修改 SDK、未安装依赖、未实测。

| 项目 | 核对结果与限制 |
| --- | --- |
| esp_app_get_description / esp_get_idf_version | 5.3.1 公开头文件提供，组件为 esp_app_format / esp_system |
| esp_chip_info / esp_reset_reason | 公开 API 可用；revision 是编码数值，不能把日志 2 解释为 v2.0 |
| esp_flash_get_physical_size / esp_flash_get_size | 两者均存在，分别核对物理容量和镜像配置容量；物理容量按 Flash ID 推导，并非破坏性容量测试 |
| esp_psram_is_initialized / esp_psram_get_size | 5.3.1 提供；初始化失败时容量按 0 记录 |
| heap_caps_malloc / free / check_integrity_all | 公开 API 存在；PSRAM 抽样 64 KiB、两种互补模式；完整性检查只检查堆管理结构 |
| Flash/PSRAM/CPU 配置 | DIO、40MHz、16MB、SPIRAM_MODE_OCT、80MHz、MEMTEST、IGNORE_NOTFOUND、CPU160 最终配置已由真实 sdkconfig.json 核对；物理工作状态仍待实物验证 |
| 控制台 | UART0 主输出和 USB Serial/JTAG 次输出配置存在；次输出非阻塞，早期 ROM/boot 可见性依接线而定 |
| APP_REPRODUCIBLE_BUILD | 根 Kconfig 存在；此项不等于已证明两次构建镜像逐字节一致 |
| 工程描述与烧录 JSON | 5.3.1 project_description 的 IDF 字段是 git_revision；flasher_args 的 flash_files / flash_settings / extra_esptool_args 可用 |
| 构建与 Python | 已使用 5.3.1 版本检查、v5.3 本地约束和显式 Python/工具路径完成构建；修复 Windows PowerShell 将重定向 stderr 诊断误作终止异常的问题，按实际进程退出码判断 |

主要修正：不再隐式选择 C 盘残留环境；移除自动安装示例；不调用 export.ps1；组件管理器禁用；为每次构建创建新的 staging，防止旧 SDK 缓存；将脚本和文档也快照后打包；无 Git 元数据安装包可记录 commit=null；自动生成交付清单；校验固定 M0 分区设计与内存参数，禁止 Python -O 绕过断言。

另核对到 5.3.1 的 `tools/cmake/git_submodules.cmake` 在缺少子模块时会自行运行 Git 更新。工程与脚本都设置 `IDF_SKIP_CHECK_SUBMODULES=1`，跳过此自动补齐路径；不修改安装中的 SDK，缺少文件时等待用户补全环境。

构建前检查：SDK 版本为 5.3.1、目标 esp32s3；Python 与工具同属用户安装环境；本地 v5.3 约束存在；不混用旧 5.5.2 缓存。失败只报告缺少什么，不安装依赖，不擦除设备 NVS，不调整 eFuse。

已验证：C 编译/链接、实际 Kconfig 最终取值、PowerShell 导出工具路径、打包脚本与校验脚本对真实产物执行，镜像校验和与哈希有效。尚待验证：Flash Download Tool 实际写入、实物内存/稳定性及断电恢复；单次构建不证明逐字节可复现。

来源：

- [Flash 5.3.1 头文件](https://github.com/espressif/esp-idf/blob/v5.3.1/components/spi_flash/include/esp_flash.h)
- [PSRAM 5.3.1 头文件](https://github.com/espressif/esp-idf/blob/v5.3.1/components/esp_psram/include/esp_psram.h)
- [PSRAM S3 配置](https://github.com/espressif/esp-idf/blob/v5.3.1/components/esp_psram/esp32s3/Kconfig.spiram)
- [控制台配置](https://github.com/espressif/esp-idf/blob/v5.3.1/components/esp_system/Kconfig)
- [5.3.1 工程描述模板](https://github.com/espressif/esp-idf/blob/v5.3.1/tools/cmake/project_description.json.in)
- [5.3.1 烧录清单模板](https://github.com/espressif/esp-idf/blob/v5.3.1/components/esptool_py/flasher_args.json.in)
