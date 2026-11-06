# 设备画面传输 v1（M3）

2026-11-03：M3.1在当前1.8寸屏已完成色块、白框、横屏人物及pet动画的现场确认。固定为ST7735S配置兼容，不代表读取了控制器ID或其他模块已验证；长期与异常恢复测试仍有剩余项。

电脑负责解码、缩放、合成不透明画面并量化RGB565；固件只接收全帧、短缓存和SPI输出，不保存动画。音频继续使用device-audio-v1.md，不复用音频stop来停止画面。

所有设备请求携带原设备Bearer Token，拒绝重定向；电脑保留Token，浏览器只访问DSH已认证API，不直接访问设备。

## 控制与状态

info增加capabilities `display-rgb565`、`display-config`，不表示已启用或实物通过。`GET /lease-voice/v1/display` 返回protocol:1、ok、ready、profile、format:rgb565be、width/height、streamId、lastSequence及received/drawn/dropped/timeouts；有displayError时需处理。启动profile:off，不启用屏幕GPIO。

`POST /lease-voice/v1/display` 的三种请求：

```json
{"protocol":1,"action":"configure","profile":"st7735-128x160","xGap":0,"yGap":0,"swapXY":false,"mirrorX":false,"mirrorY":false,"bgr":false,"invert":false}
```

```json
{"protocol":1,"action":"start","streamId":"unique-stream-id"}
```

```json
{"protocol":1,"action":"stop","streamId":"unique-stream-id"}
```

profile支持off、st7735-128x160、st7789-240x240、st7789-240x320。默认偏移0、布尔false，未知/重复字段拒绝。偏移须满足控制器RAM边界（ST7735按132×162，ST7789按240×320），交换XY时同时交换边界。运行中禁止configure/start，先按ID停止；off释放屏幕资源。请求体≤768字节。streamId为1～64字符的字母数字_-，每次使用新ID；旧stop不能影响新流。

## 帧

`POST /lease-voice/v1/frame`：

| 头 | 值 |
| --- | --- |
| Content-Type | application/octet-stream |
| X-Lease-Stream-Id | 当前活动流ID |
| X-Lease-Sequence | 1～4294967295，严格递增，十进制数字 |
| X-Lease-Width / X-Lease-Height | 精确匹配当前配置，交换XY后为交换尺寸 |

body严格为width×height×2字节，最大153600字节。无容器、无文件头、无压缩，像素按从左到右、从上到下排列。每像素 `((R>>3)<<11)|((G>>2)<<5)|(B>>3)`，先高后低字节：红F8 00、绿07 E0、蓝00 1F、白FF FF、黑00 00。透明背景由电脑合成，不传alpha。

完整收帧并进入显示队列后返回HTTP202：

```json
{"protocol":1,"ok":true,"streamId":"unique-stream-id","sequence":1,"state":"queued"}
```

queued仅表示接收，不表示drawn；drawn仅表示SPI事务完成，不能代替屏幕目视验收。固件队列只保留最新待显示帧，不能无限积压。接收独立异步处理，与音频预约分开；截断帧不提交，拒绝请求关闭连接避免残余body污染后续解析。

连续5秒无有效完整帧则释放流并清黑，不关掉已配置的驱动；重启恢复off。电脑每次只发送一帧、等待确认，初版最多约5fps，暂停时继续发送最后画面维持显示。停止必须带ID，重启流生成新ID。

错误：400格式/尺寸/非法序号，401鉴权，408接收超时，409忙/过期流，413过大，503未初始化/内存不足。超时循环预算2秒但单次socket读可受3秒超时约束。客户端超时5秒、响应上限32KiB。

## DSH桥接

浏览器先POST `/api/lease-voice/screen-control`，action:start、clientId和config（与configure相同但不含protocol/action）启动，返回生成的streamId及尺寸。GET同路径检查能力与状态；POST action:stop、clientId、streamId停止。宿主只允许一个活动窗口，10秒无帧可回收旧会话。

帧经POST `/api/lease-voice/screen-frame`，Content-Type同上，X-Lease-Client-Id、X-Lease-Stream-Id、X-Lease-Sequence；宿主校验身份/序号/长度、注入设备Token及尺寸。Token不回传浏览器。页关闭尽力发送带ID停止；失败由设备断流超时清理。此版本仍需播放页运行，后台标签页限速会影响帧率，未实现宿主常驻解码器。

固件引脚/现场步骤见firmware/esp32-s3/docs/M3_DISPLAY.md。Node模拟器只验证电脑协议；实际ESP32/SPI及用户看屏证据单独保存在firmware artifacts/acceptance，不混为同一种验证。
