# LEASE VOICE

DSH 输出侧语音与桌面播放插件，开发版本0.6.0。提供「设置 → 语音」「设置 → 语音扩展」两个独立入口和助手回复旁的「转语音」按钮；扩展页进入「屏幕播放」。日常安装仍为0.2.0，未同步/重启；M3.1既有方向/动画实物确认保留，本轮增加电脑端独立后台画面播放。

## 已实现

- 火山豆包 V3（默认双向 WebSocket，可选单向 HTTP SSE）：新版 API Key 或旧版 App ID + Access Token、Resource ID、音色与语速偏移。
- OpenAI 兼容 Audio Speech、MiniMax 同步 HTTP：各自配置接口、模型、音色、密钥与语速；浏览器输出 MP3，ESP32 输出 PCM24k 单声道，无提示词或额外聊天请求。
- 手动朗读、当前主会话新最终回复自动朗读、浏览器播放授权、停止、顺序队列、长文本分段及短期内存缓存。
- 多窗口自动播放租约、消息去重、取消代际校验，刷新不重播；不读思考、工具、子代理或定时/后台通知触发的回复。
- 扩展页保存一块 ESP32 的地址与凭据，按调试协议检查连接、音量、停止和测试音。支持 M2 固件的 PCM 音频推送、播放终态轮询和按任务停止。
- 独立的 pet/meme/本地素材库、播放列表、随机/顺序循环、屏幕尺寸/裁切/背景和电脑 canvas 预览；不改原插件、不跟随桌宠状态。
- M3画面接收对接：电脑合成RGB565BE，宿主保管Token并转发全帧；最多约5fps，单帧确认后才发送下一帧。支持1.8寸8针ST7735S配置、偏移/镜像/BGR/反色/横竖交换及测试色块。项目控制页到M3.1实物已完成看屏验证，日常DSH插件尚待升级；点击「开始后台播放」后由隐藏Edge持续解码推送，离开设置页不停止，支持后台暂停/继续/下一项/停止。详见[后台播放](../../docs/BACKGROUND_SCREEN.md)。
- 0.4.1增加0.5～3倍角色/画面缩放（默认1），与contain/cover叠加。放大可能裁边，不能保证完整动作不丢；保存后重新开始循环生效。当前实物预设为160×128、swapXY/mirrorX/mirrorY均true、xGap/yGap0、BGR/invert false、cover/zoom1，用户确认人物正立且大小合适。
- 完成提示可选叮声、随机勾选语音（不紧邻重复）或固定第一段语音；独立选择浏览器/ESP32和音量，自动提示默认关闭。同条回复先提示再朗读，不硬打断当前声音，仍依赖可见主会话。
- MP3/WAV导入、逐段试听/下载/删除独立副本；已有TTS缓存可保存为提示素材（≤60秒）或下载WAV（≤10分钟），不重新合成。详见[本地语音素材与保存](../../docs/COMPLETION_SOUNDS.md)。工作/空闲/完成动画分组与DSH生命周期调度尚未实现。

详细职责、使用方法和限制见 [屏幕播放说明](../../docs/SCREEN_PLAYBACK.md)。

## 配置与数据

默认写入插件根目录 `data/config.json`，可用 `LEASE_VOICE_DATA_DIR` 指定外部持久目录。升级前保留此目录。密钥宿主侧明文保存在本机配置文件，页面只返回是否已设置；不将此目录提交或打包，不宣称已经加密。

屏幕设置单独保存在 `data/screen.json`，本地导入文件在 `data/media/`；原插件素材只读、不复制。单文件 ≤32MiB，本地导入库 ≤256MiB/500 项，播放列表 ≤300 项。资源 ID 提供内容，视频支持 Range；不支持任意文件路径下载。更新时保留整个 data 目录。

每个 provider 保留一个独立配置档。空密钥保留原值，勾选清除后保存才删除。语音模式和 provider 在点击保存后生效；改变语音配置会取消自动合成任务。

未主动保存的合成音频仅在内存缓存，最多64MiB、15分钟；停止或离开页面前须保存。单次最多24000字，浏览器按800字、设备按200字分段，最多4个同时合成任务；设备同一时间只接受一个任务。重播相同文本与同配置可复用本窗口缓存。主动导入/保存的提示音持久化在data/sounds/和sounds.json，24kHz/16bit单声道WAV，每段≤60秒，库≤200项/64MiB，不随包分发。

## 安装边界

本包使用 DSH `connection.fetch` 的 owner 认证路由，依赖宿主 `connection`、`sessionQuery`、客户端 settings/chat/conversation slots。所有页面/API 位于 `/api/lease-voice/`，不另开生产端口。

使用 `dsh plugin --profile web add <本地包路径>` 安装。本机 DSH 0.2.1-rc.5 的插件管理器会在安装成功后自动识别新依赖的 dsh.bundle，并加入 dsh.profile.bundles；已有依赖的禁用状态不会自动重启用。不应仅凭 CLI 帮助中的“pnpm 转发”推断它没有启用步骤。不要启动第二个 DSH 或在运行任务中直接重启。

本机 PowerShell 示例（本轮未执行安装）：

```powershell
$env:DSH_HOME = 'D:\LEASE AI Software\Deepseek Harness'
node "$env:DSH_HOME\node_modules\@deepseek-ai\dsh\lib\bin.js" plugin --profile web add 'D:\LEASE AI Project\LEASE-VOICE-ESP32\software\dsh-voice\artifacts\dsh-lease-voice-0.6.0.tgz'
```

安装成功后刷新 DSH 查看设置入口；若当前进程未加载新插件，在会话空闲时使用原有“重启DSH.cmd”，再刷新页面。不要另起 dsh web 实例。

本机已部署的0.2.0曾完成真实火山语音和ESP32实物验收；0.4.1完成M3.1屏幕联调。0.6.0开发与项目控制页验证，未修改安装目录或重启日常DSH；升级前备份并保留原配置，不能用预览config覆盖日常provider凭据。已验证本机0.2.1-rc.5的真实Session/Connection及隔离WRX编排对照，不将此视为干净原版完整宿主验收。

## 开发

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run check
npm.cmd run test:browser
npm.cmd run test:screen
npm.cmd run test:sounds
npm.cmd run test:background
npm.cmd run preview
```

运行时使用Node.js内置模块、宿主React和随包分发的ws/playwright-core。隐藏播放器使用电脑已安装的Edge，不下载浏览器，可用LEASE_VOICE_BROWSER_PATH指定。开发依赖仅用于测试。浏览器测试默认使用 Windows Edge，可通过 `EDGE_PATH` 指定可执行文件；DSH 模块测试可用 `DSH_ROOT` 和 `WRX_HOOK` 指定背景源码位置，找不到时相应测试会跳过，不能宣称兼容通过。

`preview` 只监听回环 `127.0.0.1:4318`，使用临时配置与模拟音频，无 DSH 登录保护，页面标记隔离预览；不要填写真实密钥。正常插件运行不使用该预览服务器。

预览屏幕访问 `/api/lease-voice/screen`。设置 `DSH_HOME` 可自动发现本机素材，设置 `LEASE_VOICE_PREVIEW_DATA_DIR` 可保留独立的预览素材和播放列表。关闭页面仅停止普通预览/测试色块；后台画面由电脑本地服务持续运行，需显式停止。软件退出/休眠/断网会中断，重启后需重新开始；网络失败当前不自动重连。完成提示目前只由当前可见聊天会话的新事件触发，需浏览器先启用声音；设备占用时明确报错。

0.1.1：旧版官方 SSE 默认地址、误填的 https bidirection 地址，在内存适配为 wss bidirection，凭据保留，保存后才写配置。自定义 SSE 地址保留。UI 检测旧后端时提示重载。

0.1.2：聊天客户端播放器直接随 client/index.js 打包，不再动态导入 API 播放器模块。开发修改 client/entry.js 或 player.js 后运行 npm.cmd run build；设置 Web UI 继续使用标准模块。


## ESP32 语音播放

先在语音扩展保存设备地址及 Token，连接检查确认设备声明 audio-pcm16 和 playback-status；M1 测试音固件不支持真实语音。然后在语音设置将播放位置选为 ESP32 桌面设备并保存，试听和消息旁按钮会使用已选设备。设备输出不依赖浏览器声音授权。

设备模式向 provider 显式请求原始 PCM16LE、24kHz、单声道，每段最多200字及4MiB；设备接收后，宿主轮询实际播放终态，再发送下一段。上传接受不是播放完成。停止携带本段任务ID，迟到停止不得中断后续任务。旧固件、非PCM响应、设备占用、网络/播放错误会显示明确失败，不自动回退浏览器。

目标、设备地址/凭据和provider配置参与缓存隔离，自动去重包含目标。PCM仅由宿主发送到设备，不将设备Token返回客户端。真实硬件与真实provider结果由根项目日志分别记录；本包模拟测试通过不能代替实物验收。
