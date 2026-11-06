# 电脑端播放素材

当前包含用户提供的6段完成提示MP3。原件保留，不重命名、不改写、不写入固件、不随插件包发布。未从pet/meme复制原始动画到此目录。

来源/哈希/时长/转换副本ID见[素材清单](completion-sounds.manifest.json)。浏览器本地解码生成24kHz/16bit单声道WAV，副本在当前电脑控制页的数据目录sounds/，索引sounds.json。六段约1.128～2.952秒；音量保持源素材，不自动归一化或增益。

`node tools/import-completion-sounds.mjs` 可重新导入，按PCM内容去重，不调用TTS。默认导入software/dsh-voice/data/screen-preview，可显式设置LEASE_VOICE_IMPORT_DATA；仅在已授权的数据目录使用。导入后预选全部素材随机播放，自动提示开关保持原状态。

详见[本地语音素材与保存](../docs/COMPLETION_SOUNDS.md)。未来其他图片/动画按来源另管理，不预先假设GIF/WebM能在设备直接解码。

详见[完整架构](../docs/ARCHITECTURE.md)。

公开源码仓库仅包含本说明与素材清单，六段 MP3 原件通过 .gitignore 排除，保留本机。克隆后如需语音提示，请导入自己有权使用的素材。
