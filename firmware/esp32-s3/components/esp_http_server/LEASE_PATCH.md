# 本地 ESP-IDF HTTP Server 修复

来源：用户已安装 ESP-IDF 5.3.1 的 components/esp_http_server，Apache-2.0。仅复制 src、include、CMakeLists.txt、Kconfig 与 LICENSE；未修改 SDK 安装目录。

M2.3 修正异步上传 socket 所有权：
- async begin 将未读 body 长度转交副本，原请求不得再次 drain。
- select fd set 与 request parse 跳过 for_async_req，避免两个任务同时读取 TCP socket。
- async complete 在 HTTP server task 排队释放会话，唤醒 select，并避免原 handler 还未返回时复用 socket。

现场验收应覆盖：不完整 PCM 上传时另一连接 GET playback/POST stop 能及时响应；随后普通完整上传仍完成；串口无 panic。离线编译通过不代替实物验收。
