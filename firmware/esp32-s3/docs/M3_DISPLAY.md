# M3 画面接收

2026-11-03实物进展：M3.1已仅烧录应用区并Hash验证，联网/缓存PCM重放终态通过；用户确认色块颜色、白框完整及横屏人物正立。最终配置为st7735-128x160、swapXY/mirrorX/mirrorY均true、逻辑160×128、xGap/yGap0、bgr/invert false。电脑cover/zoom1大小获用户认可；源芯片精确型号未读ID。实际浏览器连续两段120秒动画通过，尚未长期稳定验收；Python色块工具一次连接超时被如实记录，设备随后在线且断流清黑生效。

M3在M2.3基础上增加受现有设备Token保护的RGB565BE全帧接收和SPI显示。动画不写Flash，不解码WebM/MP4，CPU160MHz和原分区保持不变。声音仍走已有PCM协议。

启动只创建显示状态、队列和任务，profile为off，不启用候选屏幕GPIO。电脑明确选择配置后才初始化。SPI初始化成功、queued及drawn都只证明软件/SPI传输，不证明屏幕已接线或亮起。

## 候选硬件

只使用hardware/MK024758 扩展板/XZ-AI_KZBV1.8原理图.pdf的P7：3～8脚网络依次GPIO21/47/45/40/41/42。按常见8针SPI模块顺序推测为SCK/MOSI/RST/DC/CS/BL；图中没有信号名，所以这些角色及背光高有效仍须实物核实。P6为无CS的7针接口，**此版本仅按P7实现，不默认兼容P6**。图名V1.8与图内V1.7不一致。

候选profile为st7735-128x160、st7789-240x240、st7789-240x320；最后一种只提供控制器通用尺寸，不表示实装为该型号。基础初始化仅复位/退出睡眠/16bit颜色/MADCTL/反色/正常显示，不进行未经核实的模块电源或gamma调参，可能需要现场补充初始化序列。偏移、BGR、反色、镜像与swapXY可调，不支持网络任意改GPIO。

SPI2为20MHz，使用4096字节内部DMA缓冲，同步传输完成后复用；全帧在PSRAM、待显示队列仅保留最新一帧。显示任务优先级低于音频/网络。显示出错不主动重启、不破坏音频网络配置。

## 接口

- GET /lease-voice/v1/info：声明display-rgb565及display-config表示固件实现了接收能力，不表示ready或实物通过。
- GET /lease-voice/v1/display：返回protocol:1、ready、profile、width/height、format:rgb565be、streamId、lastSequence、received/drawn/dropped/timeouts及配置。displayError单独报告。
- POST同路径：protocol:1，action为configure/start/stop。configure参数profile、xGap/yGap（默认0）、swapXY/mirrorX/mirrorY/bgr/invert（默认false）；profile:off释放屏幕资源。运行中禁止configure，需先按streamId停止。start/stop必须带1～64字符字母数字_-的streamId。迟到stop不影响不同ID的新流。
- POST /lease-voice/v1/frame：Content-Type:application/octet-stream，头X-Lease-Stream-Id、X-Lease-Sequence（1～4294967295递增）、X-Lease-Width/Height。body为width×height×2字节，行优先，每像素RGB565高字节先发，无文件头/压缩。最大153600字节。必须匹配已配置尺寸和活动流，拒绝重复/倒序帧。
- 完整接收并进入显示队列返回202及state:queued、streamId/sequence；不等于drawn，更不等于用户看见画面。格式/长度错误400、流不匹配/占用409、体积超限413、接收超时408、资源不足503、鉴权失败401。拒绝上传会关闭连接，避免剩余body被当作新请求。

帧body由独立异步任务接收，显示和音频有独立上传预约，不在主HTTP线程长时间收图。接收循环预算2秒，单次socket接收最多受3秒超时约束；仅一项画面上传，不为旧帧无限排队。连续5秒没有完整有效帧则释放流并清黑；画面配置仍在RAM，重启恢复off。电脑端应串行发送并限制帧率，暂停画面时可继续发送最后一帧维持显示。

## 现场验收步骤与剩余项

先核对P7接线及屏幕型号，再烧录。先保持off回归联网/语音/取消，再选对应配置并发红绿蓝白黑色块，检查颜色、方向、偏移、背光及尺寸；之后才播动画。并发验证语音/停止、截断帧、断流清黑、错误Token、旧stop不误停新流以及长运行堆稳定。

本轮COM3/115200仅写0x10000应用944736字节，末地址0xf6a60，在已有首1MiB备份覆盖内；bootloader/分区未写，不整片擦除/eFuse。显示期间不完整音频上传可0.078秒取消，显示继续推进。长时间网络压力、实际音画同时播放及异常帧恢复仍需后续验证，不用短测代替长期保证。

实现依据：安装SDK5.3.1的driver/spi_master.h、spi_master.c及esp_lcd_panel_st7789.c；SPI生命周期参考[官方SPI文档](https://docs.espressif.com/projects/esp-idf/en/v5.3.2/esp32s3/api-reference/peripherals/spi_master.html)。通用寄存器与模块实际初始化分别验收。
