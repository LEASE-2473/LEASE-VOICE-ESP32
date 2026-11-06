# M0 烧录交接与验收

适用版本：0.1.0-m0.2 / ESP-IDF v5.3.1-dirty。**已完成编译、打包和离线校验，尚未实物验收。实际镜像、地址和校验值见 artifacts/0.1.0-m0.2/DELIVERY.md 与 manifest.json。** 本页为联调流程，不是实测记录。开发侧不操作 COM3 或其他串口、不复位、不烧录、不擦除；实物操作由主聊天独占。

## 编译后交付门槛

交付目录必须包含 `DELIVERY.md`、`manifest.json`、`SHA256SUMS.txt`、三个 bin、`flasher_args.json`、配置、build.log、ELF/MAP、工具清单和 source.zip，构建脚本最后明确报告编译与离线校验通过。失败目录或只有源码不能烧录。验收记录应分别列出编译结果、离线校验结果、实物结果。

| 项目 | 本版设计（仅用于构建后对照） |
| --- | --- |
| 芯片 / 内存 | ESP32-S3；Flash 16MB；PSRAM Octal 8MB |
| Flash / CPU | DIO、40MHz；CPU160MHz；不启用 Flash 加密/Secure Boot |
| bootloader | 设计偏移 0x0，最终取实际 flasher_args.json |
| 分区表 | 设计偏移 0x8000，最终取实际 flasher_args.json |
| factory app | 设计偏移 0x10000，分区大小 0x400000，最终取实际构建清单 |
| NVS / PHY | nvs 0x9000，大小0x6000；phy_init 0xf000，大小0x1000 |
| 镜像方式 | 三个分离镜像，不是单个合并镜像；不能把应用 bin 当整片镜像写到0 |

开发侧会从实际构建 JSON 自动提取每个镜像的地址、字节数、SHA-256。若与表中设计不一致，先查构建配置，不能让用户自行猜地址。

## 联调侧烧录前后步骤

1. 核对版本和完整文件，对每个 bin 使用 `Get-FileHash -Algorithm SHA256 -LiteralPath '<镜像路径>'`，与 manifest/SHA256SUMS 对照。确认 app 与 bootloader 镜像头、芯片、DIO/40MHz/16MB 参数一致，不手动改头部。
2. 联调侧评估备份当前完整16MB Flash并保存校验值；已有供应商示例不等于实机备份。首版分区表可能改变原布局，不能保证原网络数据可用；没有备份或已验证旧版本时，不承诺恢复出厂固件。
3. 关闭串口监视器及其他串口工具。Flash Download Tool 选择 ESP32-S3、Develop、UART（具体界面由联调侧核对），逐项选择三个分离 bin 与交付清单地址并勾选。SPI SPEED 40MHz、SPI MODE DIO、Flash16MB（若有此项），禁用全片擦除；不操作 eFuse。遇到安全启动/加密限制先报告，不绕过。
4. 下载串口由联调侧识别，首次下载波特率可先115200；与日志波特率是两个独立设置。工具显示选项与交付要求不一致时先停止核对，不能勾选改变镜像头的功能硬改参数。
5. 仅联调侧执行写入及必要的按键/复位；完成后关闭下载器，再打开唯一日志工具，以115200、8N1、无流控读取日志。

不整片擦除并不等于没有数据影响：实际写入镜像会擦写所涉及扇区，替换 bootloader、分区表及应用覆盖区。M0 本身不写 NVS，但新分区对原数据的解释可能改变。后续同布局升级若仅写 app，须先核对分区、版本和旧固件；不得把未来 OTA 地址套用到本版。

## 日志与通过条件

主日志 UART0，应用同时向 USB Serial/JTAG 次通道输出；核心板 USB 插口的接线决定早期 ROM/boot 日志能否看到。USB 次日志非阻塞，监视器没及时连接可能丢失早期输出。以下是**预期模式，不是已获取的实物日志**：

```text
LEASE VOICE M0 firmware=0.1.0-m0.2 idf=v5.3.1...
chip model=9 cores=2 revision=2 reset_reason=...
flash_bytes=16777216 expected=16777216 query=ESP_OK
header_flash_bytes=16777216 query=ESP_OK
psram_bytes=8388608 expected=8388608
PSRAM sample 65536 bytes: PASS
M0_READY memory_check=PASS capabilities=[]
heartbeat uptime_s=... status=PASS internal_free=... psram_free=... min_free=...
```

revision=2 对应 v0.2 编码；复位原因随断电、按键和下载器行为不同，不固定为某一个数。IDF 输出版本字符串可能带 Git 后缀，须与 manifest 一致。堆字节数不预设固定值，PSRAM 可分配堆也不必等于芯片全部容量。

- 首次启动：物理与 header Flash 都为16MB、PSRAM8MB、抽样 PASS，并出现 M0_READY；不出现诊断失败、panic、watchdog 或反复启动。
- 稳定性：连续至少5分钟，约30条心跳，uptime 单调递增；稳定后的空闲内存无持续下降，status 始终 PASS。min_free 是历史低水位，不要求回升。
- 恢复：由联调侧做3次完整断电再上电，每次重新核对容量/抽样/READY/至少3条心跳。记录 USB 是否重枚举，不能由开发侧直接开串口检查。
- 功能边界：屏幕无显示、喇叭不发声、没有 IP/配置入口/HTTP 服务均符合 M0；不能用这些判断启动失败，也不能把 M0_READY 当网络或播放验收。

任一启动前错误、`M0_DIAGNOSTIC_FAILED`、`HEAP_INTEGRITY_FAILED`、心跳中断或循环复位均判未通过；保存最早错误至后续心跳/复位的完整脱敏日志。应用诊断失败不会主动重启，但 IDF 启动失败或 panic 可能在主程序之前重启，仍须报告。

反馈格式：版本与镜像哈希、下载工具/参数、供电/接线/按键操作、预期、实际、完整脱敏日志、复现次数。首次无已验证回退版本；有原机完整备份时由联调侧制定恢复方案，开发侧不自动执行。
