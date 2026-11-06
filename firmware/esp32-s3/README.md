# ESP32-S3 固件

当前源码版本 `0.1.0-m3.1`，使用用户已有ESP-IDF5.3.1。2026-11-03已COM3/115200仅烧录应用区，Hash校验通过，保留NVS；用户确认1.8寸屏兼容当前ST7735S配置、色块/边框/横屏和人物正立。实际方向为swapXY/mirrorX/mirrorY均true，逻辑160×128、偏移0，颜色不反转。未读取控制器ID，不能据此认定精确器件型号。冻结产物manifest保留构建时hardware_tested:false，实际证据位于artifacts/acceptance及根日志，不改冻结交付。

## 当前范围

- 保留 M0 的16MB Flash、8MB Octal PSRAM诊断、抽样和心跳，DIO/40MHz、CPU160MHz、UART115200。
- Wi-Fi站点模式：本地串口JSON配网、独立NVS命名空间保存/恢复、断连1至30秒退避、关联/DHCP超时重试。无配置时保持needs-config，不卡启动。
- GET /lease-voice/v1/info、POST /lease-voice/v1/command：连接、测试音、音量、停止；协议以shared/protocol为准。
- I2S功放测试音组件：DIN7、BCLK15、WS16，启动静音；音频失败不阻断联网。受Token保护的PCM16LE上传与播放状态查询；不包含MP3/视频解码、BLE或STT。
- M3显示组件启动off，不启用屏幕GPIO。电脑明确configure后，接收RGB565BE全帧，PSRAM最新帧短缓存、同步SPI DMA显示；不写素材Flash。原理图P7网络21/47/45/40/41/42对应信号角色为候选推断，非实物已确认。支持偏移/BGR/反色/镜像/横竖交换、独立帧接收、5秒断流清黑；queued/drawn不能代替看屏验收。详见[屏幕协议及验收](docs/M3_DISPLAY.md)。
- Token在本地USB配置；设置后HTTP必须验证Bearer Token。未设置时是未配对的局域网调试，不能称安全配对。Wi-Fi密码及Token在设备NVS明文保存，不写入发布包、不在日志回显。

详情见 [M1配置与验收](docs/M1_SETUP_AND_ACCEPTANCE.md)。M0历史说明见冻结产物source.zip；根目录[主聊天与子代理分工](../../docs/DEVELOPMENT_HANDOFF.md)继续适用。

## 构建

当前主聊天独立开发（禁止subagent）。用户回到现场后已授权继续联调，已执行仅应用区烧录；后续仍不整片擦除/eFuse，不自行下载安装依赖。构建只使用用户已安装环境：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/build.ps1 `
  -IdfPath 'D:/Espressif/frameworks/esp-idf-v5.3.1' `
  -IdfToolsPath 'D:/Espressif' `
  -PythonExe 'D:/Espressif/python_env/idf5.3_py3.11_env/Scripts/python.exe' `
  -StageRoot 'D:/lease-voice-build'
```

脚本使用全新无空格staging，禁用自动组件/子模块下载。包内含实际镜像、哈希、配置、ELF/MAP、构建日志、SDK审计与源码快照。产物目录拒绝覆盖。安装包SDK显示v5.3.1-dirty：示例脚本与NimBLE/RIOT头的Git符号链接被展开为普通文件，已核对与目标内容一致；未修改SDK，当前不包含BT。单次构建不代表逐字节可复现或实物通过。

## M2 PCM播放

POST /lease-voice/v1/audio 接收最多4MiB原始16位有符号小端单声道PCM，X-Lease-Audio-Id指定1至64字符任务ID，X-Lease-Sample-Rate为16000/24000/32000。收齐到PSRAM后返回202并异步播放；忙时409，非法字段400，过大413。GET /lease-voice/v1/playback查询当前ID和playing/completed/stopped/error/idle。stop可带id，仅停止匹配任务。默认PCM音量35%，测试音单独限幅8192。实际交付与实物状态以版本产物及根上下文为准。

M2.2补充异步上传worker：主HTTP线程可并发处理状态与停止；上传预留任务ID/代际，取消关闭对应上传连接，旧上传结束不能覆盖新任务。
