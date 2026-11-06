# 软件与设备共享协议

本目录是软件与设备的共享协议来源。已有[设备调试 v1 schema](device-debug-v1.schema.json)及[M2 PCM 音频传输 v1](device-audio-v1.md)；音频实现与实物验收状态以根上下文及验收记录为准。

协议应覆盖设备能力协商、配对、任务身份、音频描述、停止、音量、心跳、播放状态、错误、幂等与版本兼容。软件与固件不得各自维护不一致的协议副本。

当前调试通道由 DSH 宿主访问设备：

- `GET /lease-voice/v1/info`：返回 `protocol: 1`、`kind: "lease-voice-esp32"`、name、firmware、capabilities。
- `POST /lease-voice/v1/command`：请求为 `{"protocol":1,"action":"test-tone"}`、`{"protocol":1,"action":"stop"}` 或 `{"protocol":1,"action":"volume","value":50}`；成功返回 `{"protocol":1,"ok":true}`。
- 配置 Token 时发送 `Authorization: Bearer <device-token>`；设备必须验证凭据。超时 5 秒，拒绝重定向，响应上限 32 KiB。

M2使用同一局域网HTTP推送PCM并轮询播放，已有真实语音验收。M3增加[RGB565画面传输v1](device-display-v1.md)，M3.1已烧录并由用户确认当前1.8寸屏的色块/白框/横屏及pet动画，其他屏幕和长期稳定性未验收。设备主动连接、USB动画与BLE配网未实现。详见[完整架构](../../docs/ARCHITECTURE.md)。
