# TTS provider 配置与验证范围

2026-11-02：0.1.1 已按用户提供的官方双向文档修正，并用已保存凭据真实合成短句成功（19629 字节、约2.448秒，浏览器解码非静音）；其他服务仍为模拟验证。

火山下拉选择两种独立协议：

- 默认双向 WebSocket：`wss://openspeech.bytedance.com/api/v3/tts/bidirection`。使用二进制事件帧，完成建连、建会话、发送文本、结束会话、结束连接；接收音频二进制分片。
- 单向 HTTP SSE：`https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse`，读取 Base64 音频。不能混用 wss 与 https 地址。

新版填语音服务 API Key；旧版填 App ID/Access Token。Resource ID 区分模型/计费资源，音色 ID 选择声音；可选模型 ID 用于复刻模型版本，普通音色可留空。不发送 context_texts、提示词或额外聊天请求。音频参数为 audio_params 内的 format=mp3、sample_rate=24000、speech_rate；不再硬编码旧版128000码率。

OpenAI兼容 Speech 和 MiniMax HTTP 保留各自格式，详见设置页。朗读仍在整条回复完成后触发，长文分段合成后播放，不承诺 token 级实时朗读。

旧配置仅在内存中适配已知官方旧地址，密钥和文件不自动改写；点击保存后持久化。自定义 SSE 地址保留。

来源：[火山双向官方文档及协议附件](https://docs.volcengine.com/docs/doubao-voice/bidirectional-streaming-text-to-speech-websocket?lang=zh)、[单向 SSE 官方文档](https://docs.volcengine.com/docs/doubao-voice/http-chunked-sse-unidirectional-streaming-v3?lang=zh)。6种请求帧与官方附件编码逐字节一致，6种服务端帧解析结果一致。
