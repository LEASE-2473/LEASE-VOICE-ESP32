# LEASE VOICE / ESP32 项目上下文

## 2026-11-07 当前开发状态（优先于历史部署描述）

- 当前目录沿用原Git历史，origin为LEASE-2473/LEASE-VOICE-ESP32；fetch核对main基线同为dfdfb90，没有迁移造成的新仓库或远程分叉。公开范围为原126文件加18项发行说明、测试、USB工具和固定固件（共144文件），无删除。源码已通过3e6fe7f提交并推送origin/main；根tgz计划作为单独Release附件交付，不提交包历史。

- 仓库软件已开发至0.7.1，日常DSH磁盘安装及运行态未在本轮更新。设置分为语音、配置、设备；提示音管理可直接在语音页完成，同供应商支持多份命名配置，凭据仍只在宿主保存、公开API脱敏。
- 无设备时设备选择仅浏览器，认证检查发现audio-pcm16能力后显示ESP32；扩展details默认折叠，连接后出现画面管理入口。浏览器用户无需USB工具或硬件。
- 固件源码未改；firmware/esp32-s3/release保留既有M3.1三BIN及原manifest。插件device目录分发Windows配网/烧录脚本和镜像，不将WinForms编入固件。烧录依赖Python/esptool4.8.1、驱动，串口传给配网窗；沿用wifi-set/status协议。
- 配网工具枚举/刷新串口、联网状态反馈，显式导出仅name/endpoint/token的配对JSON，不再自动保存项目data。*.pairing.json忽略；设备页导入只填表，核对保存后检查连接。Token不得进Git/日志/发行包；device发行清单只允许固定脚本和镜像。
- 最新本地安装包放在项目根目录 `dsh-lease-voice-0.7.1.tgz`，与artifacts副本SHA256一致；根tgz已忽略，发布时作为GitHub Release附件，不加入源码历史。
- 发行方法与限制见docs/DISTRIBUTION.md；0.7.1修复宿主重复设置面板，唯一名称LEASE VOICE；根目录新tgz已审核，修复提交185232f已推送；v0.7.1已发布为最新Release并附新tgz，公开回下载SHA256一致，保留v0.7.0历史附件；未生产安装、未实际烧录/USB配网。开源许可证仍需用户确认。
- 验证：52项单测51通过，WRX请求钩子观测断言失败（dsh.test.mjs:124）；未修改外部WRX/宿主规避。新增页面/配对导入/模拟设备连接及提示音浏览器套件通过，48项静态检查通过，两个配网窗Check及固件离线哈希通过。实物端到端和长期联网仍待验收。


2026-11-04部署状态：用户要求直接覆盖现有VOICE0.2.0，磁盘版已原位更新0.6.0并迁入6段语音及屏幕设置，providers凭据哈希不变；备份 D:/LEASE AI Software/Deepseek Harness/backups/voice-direct-0.6.0-20261104-1793722223707。未重启DSH，运行态待用户重启加载。完成提示配置为ESP32/随机6段/75%，开关保留关闭，重启后用户在DSH设置中开启；4318测试后台已停止避免设备争抢。安装版27JS语法、host导入、6段WAV校验通过；apply-all仅persona-read历史旧路径失败，核心通过。原profile来源元数据未改，后续重装要保留data并使用新包。

## 2026-11-06 当前审计状态

- 当前仓库包含一个 DSH 插件（语音/TTS、完成提示音、屏幕编排）和独立烧录的 ESP32 固件，不包含 DSH 宿主或 WRX 源码。源码统一管理，插件与固件分别部署。
- 源码及日常磁盘安装均0.6.0，31个程序文件逐字节一致；profile来源仍指0.1.0 tgz，存在重装回退风险。生产进程是否加载新版本轮未认证验收，不再将磁盘版写成0.2.0。
- 4318预览仍由PID33920监听；预览与生产各有独立data，均manual/完成提示关闭。本轮未确认画面是否正在播放。历史实物版本M3.1，本轮未连接设备。
- Git仅初始化提交dfdfb90，无版本标签；旧tgz仅本机保存。详见[部署审计](docs/DEPLOYMENT_AUDIT_2026-11-06.md)。
- 本轮51项测试全过/0跳过、46项脚本与清单检查通过；固件SDK静态检查通过，未重编译/刷写/重启或改生产数据。

## 项目目标与范围

- 开发独立的 DSH 语音插件，暂定包名 `dsh-lease-voice`：读取助手回复，调用用户配置的 TTS provider 合成语音并播放。
- 第一阶段：DSH 回复旁提供手动“转语音”按钮；UI 可选择手动或自动模式，配置 provider、模型和音色，在浏览器播放。
- 第二阶段：增加“扩展”页面，配对已烧录的个人 ESP32-S3，推送语音到板子播放；固件也在本项目管理。
- 第三阶段：电脑独立编排pet/meme/本地素材，不同步桌宠动作；已接入固件画面接收。动画/音频推送并短缓存，不存设备Flash；完成提示支持电脑语音素材或叮声，独立动画后台播放已实现，工作/空闲/完成动画分组和DSH事件调度待做。
- STT 是未来方向，当前只预留职责边界。不增加提示词、人设、记忆、对话模型或情绪分析 LLM 调用。

## 工作区与背景

- 项目根目录：`D:/LEASE AI Project/DSH LEASE Extensions/dsh-voice-esp32`，已初始化 Git 仓库，主分支 main；包含插件源码、测试与软件/固件/协议/素材目录。公开仓库为 https://github.com/LEASE-2473/LEASE-VOICE-ESP32。
- `D:/LEASE AI Project/LEASE-WRX`：独立 LEASE-WRX 插件源码，作为背景只读参考。
- `D:/LEASE AI Software/Deepseek Harness`：实际 DSH 安装与运行目录，用户已授权同步 VOICE 修正；用户已授权备份 VOICE、同步及重启；已完成。设备地址/Token/输出目标已保存，provider 凭据未改。
- `D:/LEASE AI Project/Remote Server`：服务与网络维护项目，本任务只读。
- 已阅读以上三个项目的连续性文档及近期日志。它们的历史验证结果不代表本项目已通过测试。

## 技术栈与环境

- 已核实本机 Node.js `v24.19.0`、npm `11.17.0`，安装版 DSH `0.2.1-rc.5`。
- 软件使用JavaScript ESM、Node内置模块、DSH/Cordis插件，客户端使用宿主React/slots。源码及日常磁盘安装0.6.0（运行态待验收）；客户端修改后运行npm.cmd run build，ws/playwright-core生产依赖随包分发；后台使用已安装Edge，不下载浏览器。
- 开发依赖 React/ReactDOM、Playwright、esbuild 用于真实 React/browser 测试；package-lock.json 固定版本。浏览器验收默认使用本机 Edge，可用 EDGE_PATH 覆盖。
- 固件 M0 `0.1.0-m0.2` 已使用用户 D:/Espressif 环境实际编译、打包和离线校验通过；SDK D:/Espressif/frameworks/esp-idf-v5.3.1，工具根 D:/Espressif，Python D:/Espressif/python_env/idf5.3_py3.11_env/Scripts/python.exe。实际 SDK v5.3.1-dirty、GCC13.2.0、Python3.11.2；dirty 为安装包展开 Git 符号链接，已逐项字节核对并归档审计，未修改 SDK。禁止自行下载安装，保留此前 C 盘下载文件。
- 实物为 42 脚 ESP32-S3 N16R8 核心板、智能音频扩展板、8Ω/3W 喇叭及 1.8 寸彩屏。芯片识别为 revision v0.2、16MB Flash、8MB PSRAM、40MHz 晶振。
- 对应原理图为 hardware/MK024758 扩展板/XZ-AI_KZBV1.8原理图.pdf；功放 DIN/BCLK/LRCLK 为 GPIO7/15/16，麦克风 WS/SCK/SD 为 GPIO4/5/6，按键为 GPIO0/38/39。原理图未给出完整音频器件型号；屏幕接口兼容多种控制器，不据此认定实装型号。文件名 V1.8 与图内 V1.7 标注不一致，待核对 PCB。原有教学扩展板资料不得混用。
- 用户确认屏幕为1.8寸、多针接口，首选按8针P7/ST7735S128×160候选开发。PDF视觉复核P7第3～8脚网络为21/47/45/40/41/42；SCK/MOSI/RST/DC/CS/BL角色是按常见模块顺序推断，图无信号名，须现场核实。P6为7针无CS候选，本版不默认兼容。屏幕off启动，明确配置后才驱动GPIO。
- 现场显示已证明当前P7映射/基础ST7735S配置兼容该屏，但未读控制器ID。色条方向确认后，动画仍倒立，最终增加mirrorX修正；完整设置为swapXY/mirrorX/mirrorY均true、160×128、xGap/yGap0、bgr/invert false。原始色条的上下/左右顺序不能单独判断人物是否正立。

## 主要目录与职责

| 目录 | 职责与当前状态 |
| --- | --- |
| `software/dsh-voice/` | DSH 插件包：host 为认证 API/配置/生命周期，client 为单一LEASE VOICE设置入口/屏幕管理/播放器，core 为正文/事件/任务/叮声/素材库，providers 为三种 TTS 格式，extensions 为设备调试；scripts/tests 为开发工具 |
| `firmware/esp32-s3/` | 冻结交付保留；设备已M3.1，当前1.8寸屏现场色块/边框/人物方向和pet动画通过。启动off，须电脑明确启用；构建manifest保留当时hardware_tested:false，实物证据另存acceptance。next不参与构建 |
| `tools/` | 本机Windows配网窗device-setup.cmd/ps1，USB输入Wi-Fi并设置随机设备Token；仅在本机tools/data/device.json保存设备地址/Token，不保存Wi-Fi密码 |
| `shared/protocol/` | 调试schema、device-audio-v1.md及device-display-v1.md；画面为独立流ID/序号的RGB565BE全帧协议，不复用音频stop |
| `hardware/` | 用户提供的教程、板图、驱动、烧录工具和原理图；智能扩展板资料在 MK024758 扩展板，旧教学扩展板不是实装板 |
| `assets/` | 用户6段完成语音MP3原件、来源哈希与转换清单；原件不改、不随插件包分发，WAV副本保存在预览data |
| `docs/` | 架构、阶段验收与兼容性约定 |

根目录 README.md 为入口；运行数据、密钥、缓存、构建产物不得混入源码或发布包。

用户禁止subagent，主聊天独立完成。用户已回到现场并要求继续开发，本轮已执行应用区烧录、设备测试和看屏调整；不改pet/meme或日常DSH安装，不重启DSH。旧交接不构成委派授权。

## 核心设计约定

- 数据链路：DSH 最终助手正文 → 确定性文本整理 → TTS provider → 音频产物 → 浏览器或设备输出。
- TTS provider 与播放输出分离；第二阶段复用合成服务和任务状态，不重写第一阶段。
- 默认手动模式。自动模式仅针对当前客户端选中的主会话新完成回复；不扫描历史自动朗读，不播报子代理、思考、工具或中断片段。
- 第一阶段先做整条回复完成后合成，必要时按 provider 限制分段并顺序播放；不做 token 级实时朗读。
- provider 凭据由宿主保存，客户端只读脱敏配置；提供商协议不能仅凭“OpenAI 兼容”宣传推定支持，实际适配需单独验证。
- 设置仅注册「LEASE VOICE」一个入口（lease-voice），删除lease-voice-extensions注册；面板内切换语音、配置、设备，旧extensions路由仅保留为内部设备页。消息旁手动按钮和会话顶部声音授权/停止控件通过原生 slots 注册，不扫描网页文字。
- 当前提供火山豆包 V3（默认双向 WebSocket，可选 SSE；新版 API Key、旧版 App ID/Access Token）、OpenAI 兼容 Speech、MiniMax HTTP 三种格式，每个 provider 一个独立配置档；浏览器输出 MP3；ESP32 输出 PCM16LE、24kHz、单声道。用户首选火山，已用保存的凭据真实验证一次双向短句合成。详见 docs/PROVIDERS.md。
- 页面及 API 统一注册到 DSH `connection.fetch` 的 `/api/lease-voice/*`，宿主验证 owner 身份与 Host/Origin；不另开生产端口。正文通过 `sessionQuery.readSession()` 读取，不直接依赖旧插件的 `.log` 用法。
- 默认配置在插件 `data/config.json`，可用 LEASE_VOICE_DATA_DIR 外置。凭据本机明文存储、UI 不回显；音频仅内存缓存，15 分钟/64 MiB 上限；重播同正文同配置可复用本窗口缓存。
- 多窗口自动任务按会话、消息与播放目标去重；模式切换、取消、失败重试与浏览器播放授权须有明确状态。
- ESP32 暂按 Wi-Fi 音频通道设计；BLE 配网作为候选，不作为普通蓝牙音箱协议使用。
- 已实现一台设备的地址/凭据保存、HTTP 调试 v1 连接检查、音量、停止和测试音；已通过实物调试与真实 PCM 播放，不包含自动发现与完整配对。
- 屏幕由电脑决定播什么/何时切换，固件只负责接收、短缓存及屏幕/喇叭驱动；不移植 pet/meme 插件。core/media-library.js 自动发现可选插件素材和 meme-packs，也可指定目录/导入本地文件；原目录只读。data/screen.json 与 data/media 独立保存设置及导入素材，不进发布包。
- 屏幕支持PNG/JPEG/GIF/WebP/WebM/MP4、列表重排/循环/背景/裁切及canvas预览；单文件32MiB、本地库256MiB/500项、列表300项。0.4通过frame-sender.js以最多约5fps串行推送RGB565BE，extensions/display.js保管Token、验证固件能力/尺寸/序号和单窗口所有权。普通预览和色块仍随本页关闭；0.6.0后台画面由core/screen-background.js与screen-renderer.js持有隐藏Edge复用ScreenPlayer，离开/关闭控制页不会停止；owner路由screen-playback提供start/stop/pause/resume/next，错误/停止/卸载释放。暂停发送最后画面、单帧背压；不新增HTTP端口，Token不交给渲染器。未实现断网自动重连、进程重启恢复/开机自启或USB动画。详见docs/BACKGROUND_SCREEN.md。详见docs/SCREEN_PLAYBACK.md。
- M3显示状态默认off，不保存屏幕配置或动画Flash；电脑明确configure/start后启用候选SPI2/20MHz。帧异步接收，与音频预约分开，PSRAM只保留最新待显示帧，4096字节内部DMA缓冲同步复用。5秒断流清黑释放流；旧stop不清新流。queued是接收、drawn是SPI完成，都不能代替现场看屏。协议与未验收项见shared/protocol/device-display-v1.md及固件docs/M3_DISPLAY.md。
- 0.4.1的playback.zoom默认1、范围0.5～3，与contain/cover叠加，保存后重新开始循环。用户认可当前cover/zoom1，想再大可小幅试1.1；放大可能裁切动作，不承诺完整内容不丢。已保存到本机控制页及tools/data/display-preferences.json；不是修改全局固件默认。
- completion默认关闭，独立选择浏览器/ESP32、音量和ding/random/selected；随机语音不紧邻重复，先完成提示再合成/朗读同条正文，不打断当前声音。自动提示仍沿用可见主会话事件和租约去重，隐藏/关闭聊天不通知。设备被其他客户端占用时报错，不抢占或混音。素材PCM24kHz/16bit单声道，每段≤60秒、库≤200项/64MiB，保存到data/sounds与sounds.json，不调用TTS播放已有素材。语音页可保存最近合成缓存为素材或下载WAV，停止/离页/15分钟缓存到期前须保存；预览TTS仍模拟音，真实provider保存需升级日常插件。详见docs/COMPLETION_SOUNDS.md。

## 原生 DSH 与 LEASE-WRX 的边界

- **必须区分原生接口、WRX 插件逻辑和本机宿主补丁。** 本机安装不是可直接视为上游原版的兼容性基线。
- 已在安装包声明中核实 DSH 的 `conversation.chat.assistant-actions`、`session/event`、`assistant/message`、`turn/end` 接口；助手消息事件可能是一轮中的中间 step，也可能带 `interrupted`，不能逐事件直接自动朗读。
- LEASE-WRX（安装目录名 `dsh-wrx-memory`）负责请求编排、历史选择与记忆注入；本机 agent-loop 已有 WRX 请求边界补丁。VOICE 不读取 WRX 数据库、预设、宏或请求快照，不注册请求改写钩子，不接管 `llm/stream`。
- 已在隔离进程使用本机真实 Session/Connection 运行插件注册、读取、鉴权与卸载测试；复制本机 agent-loop 到临时目录，并实际关闭/开启 WRX 编排，验证加载 VOICE 前后请求消息一致且只选最终输出，源文件未改。此为本机模块级证据，不等于干净原版完整宿主或日常配置端到端兼容保证。
- 后续必须分别验证隔离的原生 DSH、启用 LEASE-WRX 的宿主；检查最终正文一致、工具多步不误播、事件去重、取消/重试/压缩及多窗口，不把测试装进日常宿主后直接试错。

## 运行、构建和测试

- 固件构建入口 firmware/esp32-s3/scripts/build.ps1 显式传入 -IdfPath、-IdfToolsPath、-PythonExe，使用无空格 staging，禁用自动依赖下载。真实构建499步成功；主代理独立运行 verify.py 通过哈希、地址、最终配置、分区和镜像验证，并逐文件核对 source.zip 与当前源码一致。交付路径 firmware/esp32-s3/artifacts/0.1.0-m0.2；准确三镜像地址见 DELIVERY.md，不使用草稿地址代替清单。
- 在 `software/dsh-voice/` 运行 `npm.cmd ci`、`npm.cmd run build`、`npm.cmd test`、`npm.cmd run check`、`npm.cmd run test:browser`、`npm.cmd run test:screen`、`npm.cmd run test:sounds`、`npm.cmd run test:background`。根目录node tools/import-completion-sounds.mjs用现有Edge离线导入assets，默认目标data/screen-preview；外部导入后须重载控制服务读取索引。
- `npm.cmd run preview` 仅监听回环 4318，临时配置、模拟音频、无 DSH 认证，界面标注隔离预览；不要填真实凭据。日常插件不使用该服务器。
- `DSH_HOME` 可为预览指定实际素材来源；`LEASE_VOICE_PREVIEW_DATA_DIR` 可指定独立预览数据目录，不指定则使用临时目录。屏幕预览路径为 /api/lease-voice/screen。
- 本机4318常驻预览已重载0.6.0，隐藏Node33920，仅回环；核实16604是原项目服务后仅重载该进程，原config.json/screen.json/sounds.json哈希不变，6段语音/设备/provider/画面设置保留。通过实际控制页加载、后台API与实体设备计数验证，当时后台保留真实pet循环播放（11月6日未复核播放状态），服务退出或断网后需重新开始。日常磁盘插件随后已于11月4日覆盖0.6.0，生产运行态待验收。
- `npm.cmd pack --ignore-scripts --pack-destination artifacts` 生成可审查的插件包；发布清单不包含开发依赖、测试、预览脚本、密钥、缓存或固件。
- 0.4.0已有41项自动测试通过、无跳过，保留真实本机Session/Connection和WRX隔离对照；新增RGB565色值、真实HTTP握手/153600字节帧、旧固件/坏确认/错误Token、背压/取消/旧stop测试。浏览器验证canvas→编码→宿主→Node协议模拟器的色块、单帧背压和停止，保留叮声/素材/移动布局回归，无JS/CSP错误。Node模拟器不执行ESP32 C/SPI；本机106个pet/73张meme及VP9解码已验证，不当作实物证据。
- 0.4.1本轮npm test仍41项全过/0跳过，check37个JS/MJS通过，build通过；test:screen增加缩放实际像素覆盖与保存/刷新验证并通过，无JS/CSP错误。实物另外完成两段120秒真实pet页面→固件推送，约4.8fps，用户确认方向/大小；显示时不完整音频上传0.078秒取消且drawn继续推进。语音缓存重放到completed，尚未再次获得本轮声学反馈。
- 0.5.0最新验证：npm test为46项通过/0跳过，check42个JS/MJS、build及test:browser/test:screen/test:sounds均通过。新增用户真实MP3解码、保存/下载无重合成、队列优先与完成PCM导出；屏幕录制fixture改为真实多帧，确认HTTP字节完整及跨时长循环。0.5.0包98301字节/51项，SHA256 622036079bdb0167cec0b19e1bb1952d87983174c7c89eb7beebcbec3d9bf358，审核无个人素材/运行数据。6段源MP3哈希与WAV副本ID、19个文档链接检查通过；未执行新素材实体听音。
- DSH_ROOT/WRX_HOOK 可指定隔离测试使用的背景模块。缺失时对应测试跳过，不能算兼容通过。完整验收边界见 docs/ARCHITECTURE.md。

- 0.6.0最新验证：npm test为51项通过/0跳过、check46个JS/MJS、build、test:browser/test:screen/test:sounds/test:background全过。新后台测试覆盖控制页切换/关闭仍推送、RGB565像素、暂停/继续/下一项/停止、真实pet VP9多帧、启动取消/断网释放；实物另完成30秒关闭整个测试浏览器后持续推送，约4.7fps，未替代长期稳定/视觉方向复核。包3278779字节/168项，SHA256 d3cd70d1779916865118fabfb477ae5deffc42643426e4a6ecbcb6bcefa67836，含ws/playwright-core，无个人数据/素材或浏览器下载。

## 当前状态、待办与风险

- 原 Flash 备份：921600 全16MiB与460800首1MiB读取均因短数据帧失败，不能当成功备份；115200读取首1MiB成功（1048576字节），SHA-256 fe09dfa27f4d14a9f7884f259b759f1086dde12ab4d4e4357c40ffc9f11b6682。备份及manifest位于 firmware/esp32-s3/artifacts/backups/original-20261102。仅覆盖本次三镜像擦写区域（最大末地址0x3f9a0），不是完整16MiB备份，恢复尚未验证；M2.3最大末地址0xee5f0仍在其覆盖内。不整片擦除，使用115200。

- 已完成：设置内双页面注册、三种 provider 适配、手动/自动朗读核心、取消/队列/缓存、设备调试页、协议说明、隔离与浏览器测试。
- M3.1已烧录：COM3/115200仅0x10000应用944736字节，51.3秒、Hash of data verified，最大末地址0xf6a60在原首1MiB备份内。bootloader/分区未写，NVS配网与Token保留，设备在线且display/frame能力可用。固件C/脚本本轮未改，不重编译；冻结source.zip保留构建时快照，当前固件README/docs仅更新实物结果，所以不再声称全部文档逐字节一致。manifest硬件false不改，acceptance另记录现场证据。
- DSH 历史（0.2.0阶段，后已覆盖0.6.0）：0.2.0 已备份至安装根 backups/voice-hardware-20261102-0.2.0、同步41个包文件并经授权原入口管理员重启成功；运行态 config 与 device-debug 均200，目标为 ESP32。provider 配置保留。离线依赖安装被其他插件缺失 tarball 阻断，profile 包/锁/patch 未变，安装来源元数据仍为旧包；后续重装须使用新 tgz 并保留 data。
- 未完成：0.6.0生产运行态验收与安装来源统一、工作/空闲/完成动画分组及DSH生命周期切换、后台语音事件调度、断网自动重连与进程重启恢复、实际音画同时播放、异常帧/长期堆稳定、USB动画、BLE/STT。Python每帧新连接的色块测试分别461帧后超时、478帧后WinError10053，设备仍在线且断流清黑；改用复用连接后3秒13帧/单端口短测通过，两段120秒浏览器无该错误，根因及长期表现未确定。
- 待确认：智能扩展板实际 PCB 版本、屏幕与音频器件型号；火山凭据由用户在正式 UI 填写，不在聊天中索取。固件先交付启动版本，再验收 Wi-Fi 与测试音，BLE 配网作为后续阶段。
- 风险：本机宿主存在定制补丁；浏览器限制自动播放；不同 provider 的请求/音频格式不同；远程浏览器与 ESP32 的网络可达性不同；第三方动画不能直接当 MCU 固件资源使用。详见架构文档。

客户端加载约定：client/entry.js为源码，npm.cmd run build通过esbuild生成自包含client/index.js；播放器不得从/api动态导入。0.2.0 已同步本机并重启加载；设备输出配置已保存，浏览器需强制刷新。

## 公开仓库约定（2026-11-06）

- GitHub：https://github.com/LEASE-2473/LEASE-VOICE-ESP32，公开仓库，main 分支。
- 不提交 data、凭据、依赖、缓存、构建及验收产物；hardware 第三方资料与 assets/*.mp3 原件留在本机，仅公开说明及素材清单。克隆后需自行准备硬件参考资料与完成提示语音。
- 本轮仅建立版本管理与公开发布，未修改业务代码、部署或设备状态。

## 固件下载（2026-11-06）

- M3.1完整交付ZIP已发布：https://github.com/LEASE-2473/LEASE-VOICE-ESP32/releases/tag/firmware-0.1.0-m3.1 。DELIVERY.md包含在ZIP内，不单独发布。
- 保持构建时19文件及原校验清单；离线verify与公开下载哈希核对通过。固件未重编译，设备未操作；原flasher_args路径需按解压目录核对，烧录地址以DELIVERY.md为准。
