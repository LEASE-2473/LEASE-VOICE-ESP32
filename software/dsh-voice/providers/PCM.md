# 设备 PCM 输出约定

仅宿主硬件输出路径在 provider 配置副本设置 `audioFormat: "pcm", sampleRate: 24000`。没有此选项时保留 MP3；不修改用户配置和浏览器音频行为。PCM 返回原始音频字节与 `mime: "audio/pcm", sampleRate: 24000, channels: 1, format: "pcm_s16le"`，不加 WAV 头。

- 火山双向 WebSocket 与 SSE：`req_params.audio_params.format=pcm`、`sample_rate=24000`，不传压缩比特率；复用原有二进制会话协议。依据[官方双向 V3 文档](https://www.volcengine.com/docs/6561/1329505)。不要与端到端实时语音模型的 Float32 输出混淆。
- OpenAI 兼容 Speech：`response_format=pcm`，不添加不存在的采样率请求字段。官方 Speech PCM 是 24kHz、16位有符号小端、无文件头；第三方兼容服务须支持该格式，返回明确压缩类型时拒绝。依据 [official OpenAI documentation](https://developers.openai.com/api/docs/guides/text-to-speech#supported-output-formats)。
- MiniMax HTTP：保留 hex 输出解码，请求 `audio_setting` 的 `format=pcm`、`sample_rate=24000`、`channel=1`，不传仅 MP3 生效的 bitrate。若响应 `extra_info` 存在格式、采样率或声道字段，逐项验证。依据[官方同步语音合成文档](https://platform.minimax.cn/docs/api-reference/speech-t2a-http)及同地址 `.md` 提供的完整 AudioSetting schema。

PCM 没有自描述头，不能仅凭字节证明位深和采样率。当前会拒绝空/奇数长度、已知 WAV/OGG/FLAC/ID3 容器签名及矛盾的响应元数据；这不等于任意第三方兼容服务都已实测。本轮采用模拟 HTTP 和本机 WebSocket 协议回归，不发送真实计费请求。真实硬件短句由主代理另行验收。
