# M2 PCM播放交付

版本0.1.0-m2.3，沿用已实测M1的网络、配网、Token和分区。请求与状态见项目shared/protocol/device-audio-v1.md；接收原始PCM，不在设备解码MP3。上传限制4MiB、偶数字节、16/24/32kHz；PSRAM收齐后202异步播放，单任务忙409，播放完成必须轮询，不将上传成功当作播放完成。stop可带id避免迟到取消停止下一任务。

检查项：实际编译/打包及离线镜像校验；主聊天烧录后检查M2_READY、原网络重连、audio-pcm16能力、上传短PCM、completed状态和声响，再验证停止。只在具体变更/失败时追加检查，不重复长观察和断电循环。当前不含BLE/屏幕/STT。准确地址/哈希以该版DELIVERY.md/manifest为准，不修改旧版本冻结产物。

M2.2通过ESP-IDF异步请求接口接收上传，预留queued任务与代际ticket，停止可关闭上传连接并取消该ticket；未读完请求体不交给播放器。

M2.3项目本地覆盖esp_http_server，修复IDF5.3.1异步请求的body重复读取和socket复用；安装SDK不变。完整修复说明见components/esp_http_server/LEASE_PATCH.md。必须由主代理完成实际上传中途停止和随后正常播放验收。

