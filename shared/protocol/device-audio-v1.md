# 设备 PCM 音频传输 v1

2026-11-02 制定，目标 M2 固件和插件设备输出。调试 v1 接口保留。协议实现与实物结果分别记录，文档存在不代表已经验收。

## 固定格式

电脑端 TTS 直接请求单声道、有符号 PCM16LE，默认24000Hz；设备不将 MP3 当作 PCM，也不依赖浏览器访问设备。TTS 凭据留在电脑端。设备 Token 沿用本机 USB 配置，以 `Authorization: Bearer <token>` 认证；已配置 Token 时所有音频/状态/控制请求均验证。HTTP 无 Token 返回401。

GET `/lease-voice/v1/info` 的 capabilities 增加 `audio-pcm16` 与 `playback-status` 后，插件才能使用设备输出。仅调试 v1 的旧固件必须提示升级，不能误报可播放真实语音。

## 上传并开始播放

POST `/lease-voice/v1/audio`，请求头：

- Content-Type: application/octet-stream
- X-Lease-Audio-Id: 1至64个 ASCII 字母、数字、下划线或连字符；推荐每段生成新 UUID。
- X-Lease-Sample-Rate: 24000；设备可额外接受16000、32000，不静默转换未知值。

body 为原始PCM字节，不含RIFF/WAV头；非空、偶数字节、最多4194304字节。拒绝无效格式/采样率/任务ID，大小超限返回413；忙返回409。收齐且验证后才交给异步播放器，失败释放缓冲。单活动任务，不覆盖正在上传或播放的任务；网络上传不能阻塞停止控制或造成长时间无响应。

成功返回202：`{"protocol":1,"ok":true,"id":"<id>","state":"playing"}`。启动排队阶段也可返回queued。该响应只表示设备接收，不等于已经播放完成。客户端不因响应丢失直接重发以免重复播放，应先查询状态；此版不宣称完整上传幂等支持。

## 播放状态

GET `/lease-voice/v1/playback` 返回 `{"protocol":1,"id":"<id>","state":"playing"}`。

state 为 idle、queued、playing、completed、stopped、error。无任务时 id 为空字符串。最近任务的终态保留到下一任务，错误可带脱敏 error 字符串。插件确认同 id 的 completed 后才能推下一段；id 不匹配不能当成原任务完成，也不能无限等待。客户端轮询间隔约250至500ms，超时根据PCM时长加传输余量计算，并支持取消。

## 停止与音量

POST `/lease-voice/v1/command` 保留现有音量/测试音，并扩展停止请求：

- `{"protocol":1,"action":"stop"}`：停止当前任务，供明确的设备全局停止按钮使用。
- `{"protocol":1,"action":"stop","id":"<id>"}`：仅停止同 id 任务，供客户端取消使用；不匹配可成功无操作，不得误停新任务。
- `{"protocol":1,"action":"volume","value":50}`：PCM输出增益0至100，默认从适中值开始；不把测试音的额外幅度限制当作全部语音音量范围。

成功回应 `{"protocol":1,"ok":true}`。停止应清理DMA、代际取消并正确释放PCM缓冲；结束上一任务不得释放下一任务数据。鉴权、请求边界和音频状态在并发情况下仍须有效。

## 插件行为

输出目标为浏览器或ESP32，参与缓存键、自动任务去重与状态；默认继续浏览器播放。ESP32模式由宿主合成PCM、上传并等待设备播放完成，浏览器不再次播放同段。硬件分段建议约200字并再次检查字节上限；供应商不支持PCM时明确报错，不静默发送压缩数据。取消合成、上传和轮询，并发送带id的停止；只重试明确可重试的失败。
