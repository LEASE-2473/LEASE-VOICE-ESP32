# M1 配置与验收

源码版本0.1.0-m1.1，沿用M0的分区布局和内存配置，M0冻结包保持不变。M1会写入NVS；原数据兼容性和备份范围由主聊天核对，不能自动擦除NVS或承诺出厂恢复。下面的配置入口和HTTP行为是本版实现目标，实际编译/离线结果见对应交付，实物验收另记。

## 烧录与启动

三个分离镜像的地址、大小、SHA256从实际flasher_args.json提取，见DELIVERY.md。沿用DIO/40MHz/16MB、日志115200；CH340高波特率此前出现短读，首次烧录采用115200，不整片擦除。若确认bootloader/分区表与设备上M0完全一致，主聊天可选择仅更新应用；本版仍交付完整三镜像以便核对。

启动日志应出现M1_MEMORY_READY、NVS/Wi-Fi/audio/HTTP/UART各自初始化结果及M1_READY。无保存Wi-Fi时network state=needs-config，无IP正常；音频init不自动发声。任一模块失败打印esp_err名称，不打印密码；内存诊断失败时不启动Wi-Fi/音频。

## 本地USB串口配置

只由主聊天占用COM3，115200/8N1，无流控。串口不回显输入，一行UTF-8 JSON，以LF或CRLF结尾，最多512字节。不要在聊天里粘贴真实密码；主聊天可用root tools/device-setup.ps1本地配置小窗。stdin不作为输入入口，直接读取UART0（CH340 USB桥）。

```json
{"action":"wifi-set","ssid":"本地填写","password":"本地填写","token":"本地随机生成的至少16字符Token"}
{"action":"status"}
{"action":"token-set","token":"本地随机生成的至少16字符Token"}
{"action":"volume","value":20}
{"action":"test-tone"}
{"action":"stop"}
```

wifi-set要求SSID为1..32字节，密码为空（开放网络）或8..63字节。token可选：省略保留已有Token；空串清除；非空为16..96个可见ASCII字符。Token更新、Wi-Fi保存是顺序动作，不是跨字段原子事务，后一步失败时前一步可能已保存，可用status确认auth状态。支持运行中改网；只配置2.4GHz网络。保存成功ack只代表NVS写入并接受连接任务，不代表连接成功。

成功响应独立JSON行：`{"protocol":1,"ok":true,"action":"wifi-set"}`。失败返回ok:false及ESP_ERR名称，不回显输入。状态响应含protocol/ok/action/state/ssid/ip/disconnects/auth/audio；auth为token或lan-unpaired，从不返回Token。

联网后输出独立事件：`{"protocol":1,"event":"network","state":"connected","ip":"192.168.x.x"}`。日志与JSON可能交错，本地工具应仅解析完整JSON行。错误JSON、重复字段、未知动作、非法值或超长输入返回错误，下一行仍可继续。超长行丢弃至换行，不将残余当新命令。

凭据只存设备本地NVS（未加密）；主机端不得把Wi-Fi密码写入文件或日志。生产配对和安全传输尚未实现。无Token时仅受当前局域网可达性限制，不将此状态宣称为安全。

## HTTP调试

GET http://<设备IP>/lease-voice/v1/info 返回protocol=1、kind=lease-voice-esp32、firmware及真实初始化能力。POST /lease-voice/v1/command接收共享协议的protocol/action/value。已设Token时两接口要求Authorization: Bearer <token>，错误或缺失返回401。只响应GET info和POST command，不提供浏览器跨域授权；由DSH宿主访问设备。

动作test-tone、stop或volume0..100；音频初始化失败时不声明音频能力并返回错误。HTTP请求正文上限256字节，解析/字段/整数范围检查失败返回400；读取超时返回408。成功回复protocol=1、ok=true。测试音为固定短音，默认音量20，不自动播放。

## 本轮实物检查顺序

1. 确认版本及内存PASS，启动静音，UART status可用；错误/超长JSON后下一条status仍可用。
2. 在本地小窗输入Wi-Fi及随机Token；等待connected/IP，验证GET info、错误Token401、正确Token200。
3. 音量20下发一次测试音，验证喇叭发声；检查停止、音量0静音及恢复20。
4. 断开/恢复网络，观察IP清空和重连；断电重启后恢复保存配置。用户要求加快时可先完成前3项，未做项明确记录。
5. DSH语音扩展页保存地址与同Token，检查连接、音量、测试音、停止。此时仍没有真实TTS音频推送、BLE或屏幕，不能声称完整语音设备完成。
