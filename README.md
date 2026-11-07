# LEASE VOICE / ESP32

面向 DeepSeek Harness 的独立语音插件与 ESP32-S3 配套固件项目。

先实现「助手回复 → TTS → 浏览器播放」，再扩展「Wi-Fi 设备播放 → 屏幕动态表情」，未来支持 STT。无需提示词或额外对话模型。

当前开发版为 `dsh-lease-voice@0.6.0`，设备仍为已现场验收基础显示的 `0.1.0-m3.1`。电脑负责素材编排/RGB565推送和音频，固件只接收、短缓存及播放。本机已导入6段用户完成提示语音，可选择随机语音/固定语音/叮声，先提示再朗读，并支持保存或下载已有TTS缓存，详见[本地语音素材与保存](docs/COMPLETION_SOUNDS.md)。自动提示默认关闭。日常DSH磁盘插件已原位覆盖0.6.0，运行态版本待验收，安装来源仍指旧包；[关闭设置页仍持续的后台动画播放](docs/BACKGROUND_SCREEN.md)已实现；工作/空闲/完成动画自动切换、USB动画、BLE和STT未实现，长期稳定性待验收。

- [项目边界与部署审计](docs/DEPLOYMENT_AUDIT_2026-11-06.md)
- [当前项目上下文](PROJECT_CONTEXT.md)
- [架构与阶段验收](docs/ARCHITECTURE.md)
- [修改日志](CODEX_CHANGELOG.md)
- [Provider 配置说明](docs/PROVIDERS.md)
- [插件目录](software/dsh-voice/README.md)
- [固件目录](firmware/esp32-s3/README.md)
- [共享协议目录](shared/protocol/README.md)
- [素材目录](assets/README.md)
- [电脑端屏幕播放与完成提示](docs/SCREEN_PLAYBACK.md)

本机 DSH 已启用 LEASE-WRX 和宿主补丁，必须单列兼容测试，不能把本机行为直接当作原生 DSH 行为。其他工作区项目仅为只读参考。

开发与隔离预览命令见插件目录 README；预览使用模拟音频，不填写真实凭据。

## 0.7.0 公开发行
浏览器独立使用、可选 ESP32 和本地安装请见 [发行说明](docs/DISTRIBUTION.md)。
