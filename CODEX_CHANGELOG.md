# Codex 修改日志

## 2026-11-06：初始化本地 Git 并发布 GitHub 公开仓库

- 用户目标：提交当前项目到本地仓库，并发布至 GitHub 公开仓库。
- 主要修改：原目录无 .git，初始化 main 分支；创建公开仓库 https://github.com/LEASE-2473/LEASE-VOICE-ESP32 并配置 origin，准备首次源码提交及推送。业务代码、部署和设备状态未修改。
- 修改文件：.gitignore、hardware/README.md、assets/README.md、PROJECT_CONTEXT.md、CODEX_CHANGELOG.md。纳入现有软件/固件源码、测试、协议及文档；data、凭据、依赖、缓存、构建/验收产物继续忽略，新增排除第三方硬件资料/工具包及用户 MP3 原件，均保留本机。
- 验证：software/dsh-voice 下 npm.cmd run check 通过46个JS/MJS检查；npm.cmd test通过51项、0失败/0跳过。git grep --cached 扫描常见 GitHub/OpenAI 密钥与私钥标记无命中，并检查配置/工具中的凭据引用为默认空值或运行时读取。暂存126个文件，最大单文件约74KB，无大文件。GitHub API确认创建结果private=false。
- 格式检查：git diff --cached --check 发现原有 firmware/esp32-s3/docs/M2_PCM_PLAYBACK.md 末尾空行及 software/dsh-voice/client/sounds.js 行尾空格；未为发布任务改写业务源文件。PROJECT_CONTEXT.md新增尾部空行已清理。
- 未完成与风险：本轮不做固件重编译、现场硬件或完整浏览器复验；现有功能限制见上下文。公开克隆不含本机语音原件、第三方硬件资料及构建产物，需自行准备。未指定项目开源许可证，本轮未擅自增加授权。推送后将核对远程 main 与本地 HEAD 及工作区状态。

## 2026-11-04：VOICE 0.6.0按用户要求原位覆盖，等待用户重启

- 用户要求：直接覆盖已装0.2.0，不建独立插件目录，允许旧运行页暂时失效；用户自行重启，不由代理重启。备份沿用此前授权，位于D:/LEASE AI Software/Deepseek Harness/backups/voice-direct-0.6.0-20261104-1793722223707，含原插件及data。
- 部署：0.6.0发布包SHA256 d3cd70d1779916865118fabfb477ae5deffc42643426e4a6ecbcb6bcefa67836，168个发布文件覆盖现有junction解析目录并逐文件核对；含ws/playwright-core，不重新安装依赖树、不改profile包/锁/patch元数据。原config的providers哈希一致；只合并completion配置为ESP32、随机6段、音量75、enabled=false，保留手动TTS模式/原设备配置。迁入screen.json/sounds.json、sounds和media副本，原始用户文件不改。
- 验证：安装版host/index.js及依赖实际import通过、27个运行JS语法检查通过，6段WAV全部读取/校验成功。首次Python写包因Windows长路径在playwright-core文档处中断，随即用Windows扩展绝对路径重做全部168文件并校验通过，最终无缺失模块。未调用真实TTS、未刷固件、未重启DSH。
- 补丁检查：按宿主AGENTS运行apply-all（日志在源项目artifacts/deploy-0.6.0-patches.log），verify-core和其余12项通过；persona-read因旧lib/tools.js历史路径失效仍退出1，既有问题，未修WRX或Remote Server。测试服务4318后台已通过API停止，防止与日常插件占用同一显示流；测试服务本身仍在。
- 未完成与风险：磁盘版已0.6.0，运行态等待用户重启后验收；用户重启后刷新DSH，从设置→语音扩展进入屏幕页，开启回答完成提示后才自动随机提示。完成提示仍依赖当前可见主会话，动画可后台运行；工作/空闲/完成自动切换未实现。profile/pnpm来源元数据仍指旧0.1.0包，日后重装须先保留data并使用新包；本次按用户明确要求只覆盖程序，不改安装布局。

## 2026-11-04：0.6.0电脑后台画面播放，离开控制页仍推送

- 用户目标：离开屏幕播放页就断流，要求改为电脑端常态后台推送。读取根中文连续性文档、当前模块/配置/测试，git status确认非Git仓库；禁止subagent，全由主聊天完成。
- 主要修改：新增core/screen-background.js持有唯一后台运行实例、串行控制、状态/帧数、5fps单帧背压、暂停维持最后画面及停止/错误释放；新增core/screen-renderer.js使用已有Edge无头解码，复用ScreenPlayer的列表、缩放、背景/裁切、视频循环。私有请求路由仅提供入库媒体ID，无新HTTP端口，不将设备Token交给渲染器，不下载浏览器。
- 生命周期与界面：host和独立preview均创建后台控制器，新增owner认证screen-playback操作start/stop/pause/resume/next；设备配置变更先停止旧流，卸载/预览正常退出清理播放器和设备。屏幕页“开始后台播放”保存并应用当前列表/播放参数，返回页自动读状态，离页不停止后台；增加暂停/继续/下一项。普通预览和测试色块仍随页面关闭，色块主动先停后台。启动中停止不被页面busy挡住。
- 文件：新增software/dsh-voice/core/{screen-background,screen-renderer}.js、tests/{background.test,background.browser}.mjs；修改host/{index,routes}.js、scripts/preview.mjs、core/media-library.js、client/{screen.js,screen.html}、tests/dsh.test.mjs、package.json/package-lock.json及插件README，重建client/index.js；新增docs/BACKGROUND_SCREEN.md，更新根README、docs/{ARCHITECTURE,SCREEN_PLAYBACK,COMPLETION_SOUNDS}.md及根中文连续性文档。playwright-core从已安装/缓存中离线加入生产依赖并随包分发，开发playwright不用于运行时。未改固件/冻结交付、日常DSH、pet/meme原件、provider或设备配置。
- 验证：npm.cmd test最终51项通过/0跳过，npm.cmd run check通过46个JS/MJS，npm.cmd run build成功。test:background通过真实控制页切换和关闭后持续帧、RGB565红色中心/contain背景、返回控制、暂停保持帧/继续/下一项、停止释放，以及真实pet VP9多帧变化；test:screen/test:browser/test:sounds均通过，无JS/CSP错误，保留原语音、素材和提示顺序回归。新增单元验证启动中取消、首帧失败不死锁、运行中断网释放、不积压/无限重试与空列表/尺寸拒绝。
- 测试修正：后台首个像素断言误把contain留边视为红色，初次4259≠63488失败；改为同时断言中心红色0xf800和角落背景0x10a3后通过，未改变生产裁切行为。打包审计第一次Python默认GBK读JSON失败，明确UTF-8重跑通过，不把该次失败隐去。
- 本机启用：核实Node16604命令与4318监听后只停止本项目旧preview，以原data/screen-preview/DSH_HOME隐藏启动0.6.0 Node33920。重载前后config.json/screen.json/sounds.json SHA256一致。保留用户最新160×128、swapXY/mirrorX true、mirrorY false、cover/zoom1.1、黑底、8项列表，未恢复旧方向/缩放；收尾复核后台仍running、630帧、正在播写代码.webm、无错误。实际4318屏幕页载入6段素材无JS错误，API启动已保存的“三球抛接.webm”等列表，未改设置/未发音频。随后切至扩展页，关闭控制页和整个测试浏览器，额外30秒后台帧16→157、真实设备drawn3037→3178、同一streamId，约4.7fps；报告artifacts/background-0.6.0-hardware.json，截图background-0.6.0-live.png。当前保留后台运行供用户使用，不声称已获本轮视觉确认或长期稳定通过。
- 打包：npm.cmd install --package-lock-only --ignore-scripts --offline成功，无下载/0漏洞报告；npm.cmd pack --ignore-scripts --pack-destination artifacts --json成功，dsh-lease-voice-0.6.0.tgz为3278779字节/168项，SHA256 d3cd70d1779916865118fabfb477ae5deffc42643426e4a6ecbcb6bcefa67836。tarfile审核新增后台模块与ws/playwright-core存在，不含data/tests/artifacts/assets、个人音视频或.local-browsers。包/lock0.6.0、playwright-core非dev依赖已核对，22个本地文档链接核对通过。
- 未完成与风险：本次仅动画后台化，工作/空闲/完成素材分组和DSH事件联动、后台语音通知/朗读、日常DSH部署仍待做。必须保持电脑/本地软件运行；进程重启后需点开始，未做Windows开机自启、重启恢复或断网自动重连。网络/解码错误停止释放资源，检查后手动再开始。固件沿用M3.1，现有长期网络/音画并发/堆稳定待办保留。

## 2026-11-03：修复本地新版控制页卡在读取配置

- 用户目标：原页面可连接，新页面停在“正在读取配置”，恢复测试入口。已读取根上下文/日志并检查实际源码与进程，不使用subagent。
- 根因：旧Node22984仍使用0.4.1内存路由，却从磁盘返回0.5.0新版ui.js；其静态导入audio-tools.js返回404，整个模块未执行，页面并未发起设备连接。实测config/ui.js均200，audio-tools.js/sounds为404。
- 修复：核对22984确为scripts/preview.mjs且持有4318后仅停止该项目预览；以原data/screen-preview和DSH_HOME素材来源隐藏启动Node16604/4318，新版路由加载成功。本轮命令均实际执行成功，解除了此前未完成的预览重载；日常DSH、固件、设备凭据/provider配置、播放列表均未修改，未烧录、未发播放命令。
- 文件：更新PROJECT_CONTEXT.md、docs/COMPLETION_SOUNDS.md当前部署状态和本日志；运行产生忽略的0.5.0预览stdout/stderr日志及screen-preview-0.5.0-live.png截图，未改生产源码。
- 验证：GET config/audio-tools.js/sounds.js/sounds均200；使用现有Edge/Playwright直接访问实际4318扩展页等待“配置已读取”，屏幕页确认6个提示素材，无页面JS错误。device-debug info实际HTTP200/online true，固件0.1.0-m3.1，具备PCM/显示能力；保存地址与Token和tools/data/device.json一致，不输出Token。仅服务重载/文档修正，未重复运行全套源码测试。
- 未完成与风险：用户需刷新浏览器加载新模块，并进行提示音实体听音。工作/空闲/完成画面自动切换、后台常驻调度及日常DSH升级仍待做；预览TTS仍模拟音，关闭页面后的持续画面不保证，沿用原有硬件长期稳定性待办。

## 2026-11-03：0.5.0完成提示语音素材、TTS缓存保存与播放优先顺序

- 用户目标：assets已放入语音素材，电脑负责提示音、TTS与画面编排；完成提示先于回复朗读，固件继续只接收/短缓存/播放。遵守禁止subagent，全由主聊天完成。开始已读取根连续性文档、源代码/配置/测试并检查Git状态，当前仍不是Git仓库。
- 素材：读取用户6段MP3，用现有Edge/OfflineAudioContext离线解码为24kHz/16bit单声道WAV，时长1.128～2.952秒，两个相近文件名内容不同均保留。副本入software/dsh-voice/data/screen-preview/sounds及sounds.json；assets/completion-sounds.manifest.json记录源哈希/副本PCM ID/时长。逐一核对6个原始文件SHA256、字节数与WAV PCM哈希一致，原件不改、不调用TTS、不写设备Flash。
- 功能：core/sounds.js持久化库、PCM内容去重、随机不紧邻重复、固定第一段、音量缩放、标准WAV格式校验和库上限（60秒/段、200项/64MiB）；owner接口导入/下载/删除独立副本。屏幕页选择叮声或语音、勾选、试听、下载/删除和MP3/WAV导入。预选6段随机，自动提示开关仍关闭，设备/provider与原4项画面列表保留。
- 保存与优先级：语音页保存最近已合成缓存为提示素材（≤60秒）或下载合并WAV（≤10分钟），支持完成的设备PCM封装导出，不重合成；停止/离页/缓存过期前须保存。同条新回复先完成提示后合成/朗读正文，自动提示优先尚未开始的正文队列，不硬打断当前声音；保持身份隔离和去重，排队窗口15分钟。
- 修改文件：新增software/dsh-voice/core/sounds.js、client/{audio-tools,sounds}.js、tests/{sounds.test,sounds.browser}.mjs和tools/import-completion-sounds.mjs；修改host/{index,routes,config}.js、core/tasks.js、client/{entry,index,player,screen,ui}.js、client/{screen,index}.html、client/ui.css、scripts/preview.mjs、tests/{dsh.test,ui.browser,screen.browser}.mjs、package.json/package-lock.json和插件README。更新assets/README并新增completion-sounds.manifest.json；新增docs/COMPLETION_SOUNDS.md，更新根README、docs/{ARCHITECTURE,SCREEN_PLAYBACK}.md、tools/README及根连续性文档。版本0.5.0；未改固件/冻结交付、用户MP3、pet/meme、日常DSH或provider凭据。
- 验证：npm.cmd test最终46项通过/0跳过；npm.cmd run check通过42个JS/MJS；npm.cmd run build通过；test:browser通过提示先于正文及原语音/多窗口/设备模拟回归；test:sounds通过真实用户MP3解码、保存/下载不重合成、WAV校验、导入/去重/随机/试听/持久化、错误文件和移动布局；test:screen通过实际pet VP9与原画面回归、视频完整HTTP字节和跨时长循环，无JS/CSP错误。已查看completion-sounds-desktop.png，布局正常。Node/浏览器模拟测试不等于新素材扬声器听音验收。
- 测试修正：首次新任务测试仅等一次setImmediate导致文件IO未完成，改成有界状态等待后通过。原screen.browser静态单色MediaRecorder短fixture曾连续解码失败；仅修测试为逐帧变化1像素、1500ms录制并写诊断fixture，增加媒体接口200/video-webm/完整字节断言和1800ms循环等待，最终通过；未放松生产视频解码检查。
- 打包：npm.cmd pack --ignore-scripts --pack-destination artifacts --json成功，artifacts/dsh-lease-voice-0.5.0.tgz为98301字节/51项，SHA256 622036079bdb0167cec0b19e1bb1952d87983174c7c89eb7beebcbec3d9bf358。Python tarfile审核3个新增运行模块存在，不含data/tests/artifacts/assets或原始音视频；19个本地文档链接有效。包与lock版本0.5.0。
- 部署受限：核实旧4318服务为Node22984/scripts/preview.mjs后，尝试仅刷新项目服务，被自动审批拒绝；随后尝试保留旧服务、在独立数据副本开4319，同样被拒绝。两次均仅给出blocked by policy，无更具体原因，命令均未执行。只读复核22984仍在、4319未监听、data/sound-preview-0.5.0不存在。旧服务内存路由尚无sounds，新页面模块需重载才能启用，勿刷新旧4318作新版验收；本轮没有声称常驻部署完成。
- 未完成与风险：常驻控制服务重载、日常DSH0.2.0升级、新素材实体听音、工作/空闲/完成动画分组/生命周期切换、后台常驻调度仍待做。预览TTS仍模拟音，真实provider缓存保存须日常插件升级后验证。以后只迁移sounds目录/索引并合并completion选择，不用预览config覆盖日常凭据；原有Wi-Fi长期稳定/音画并发及其他硬件待验收项仍保留。

## 2026-11-03：现场烧录M3.1、横屏人物方向确认与0.4.1缩放

- 用户目标：已回到现场，继续实物联调；色条希望从左到右黑白蓝绿红，人物需正立并更大，同时担心放大会裁掉动作。全程主聊天独立完成，无subagent。
- 烧录前：重新读取根连续性文档及当前源码/协议，git status确认仍非Git仓库。COM3识别ESP32-S3/USB-SERIAL CH340，认证info为M2.3在线、playback completed。重新验证M3.1三镜像哈希、原首1MiB备份长度/SHA256、与M2.3 bootloader/分区逐字节一致及新应用最大末地址0xf6a60在备份内；不宣称全16MiB备份或恢复已验收。
- 烧录：D盘现有IDF Python/esptool4.8.1，COM3/115200，仅write_flash 0x10000 lease_voice.bin，944736字节（压缩582924），51.3秒，Hash of data verified；未写bootloader/分区/NVS、未整片擦除/eFuse。设备恢复联网，info为0.1.0-m3.1，audio及display能力正常，初始屏幕off。日志artifacts/acceptance/m3.1-flash-20261103.log，状态m3.1-post-flash.json。冻结manifest保留构建时hardware_tested:false，不改旧交付。
- 基础回归：node tools/test-device-tts.mjs --replay使用旧缓存PCM，经sending→playing→completed，不调用付费TTS；本轮用户没有单独确认声学效果，不将协议终态当听音验收。显示推送期间发起48000声明/1000实际字节的不完整音频上传，可在0.078秒按ID停止、状态stopped，display drawn继续增加；报告m3.1-audio-cancel-with-display.json。
- 现场看屏：首次128×160/无方向位色块已显示，用户反馈颜色正确但屏幕方向不符。先swapXY/mirrorY调整横屏，用户确认从左到右黑白蓝绿红、白框完整；随后pet动画暴露人物倒立且太小，再加mirrorX并将适配改cover。用户明确确认人物正立、大小合适，想稍大但担心裁切。最终预设st7735-128x160、逻辑160×128、swapXY/mirrorX/mirrorY均true、偏移0、bgr/invert false、cover/zoom1；未读芯片ID，不据此认定精确型号。证据m3.1-screen-orientation-confirmed.json（仅色条阶段）及m3.1-animation-visual-confirmed.json（最终人物阶段）分开保存。
- 动画实测：新增tools/test-device-animation.mjs，经本项目真实页面/浏览器解码→RGB565→宿主→Wi-Fi→M3.1，轮播三球抛接/下五子棋/东张西望。两次各120秒正常结束，12次状态采样/次，末次累计581和582帧，约4.8fps；无displayError、dropped0。首次人物倒立/小属于配置问题，不计视觉通过；第二次获用户确认。报告m3-animation-2026-11-03T13-18-08-381Z.json和13-21-24-132Z.json及同名截图。短测不等于长期保证。
- 连接异常如实记录：原Python色块工具逐帧新建连接，第一次461帧后URLError/连接超时，第二次478帧后WinError10053/连接被中止；设备随后可访问、disconnects0，断流清黑生效。未据此声称固件崩溃或已确定根因。工具改用http.client复用连接并完整读取响应，3秒实物13帧通过，transportLocalPorts仅一个端口，报告m3-display-20261103-213407.json；只证明短测和连接复用，尚未做更长压力回归。实际Node浏览器两段120秒未出现该错误。
- 软件修改：0.4.1新增playback.zoom（0.5～3，默认1）持久化/校验，ScreenPlayer按fit基准叠加缩放，屏幕页增加倍数输入及裁切提示，保存后重新开始循环；保留用户认可cover/zoom1，不擅自默认再放大。更新client状态提示为设备接收确认，不冒充每帧看屏。修改software/dsh-voice/core/media-library.js、client/{screen-player.js,screen.html,screen.js,frame-sender.js,index.html}、package与lock、README、tests/{media.test,screen.browser}.mjs；未改固件C/SDK/旧冻结文件。新增tools/test-device-display.py（色块/边框/方向，主动启用屏幕）及test-device-animation.mjs和工具说明。
- 验证：npm.cmd test为41项全部通过/0跳过；npm.cmd run build、check37个JS/MJS通过；test:screen通过缩放实际像素覆盖、保存/刷新及原媒体/模拟传输/移动布局，无JS/CSP错误。本轮语音逻辑未改，未为此重复上一轮完整语音浏览器套件。node --check动画工具、D盘Python py_compile色块工具通过，两个工具均有实际硬件执行证据。
- 控制页：只停止已核实的本项目旧预览35272，隐藏新进程22984在127.0.0.1:4318运行0.4.1。原4项列表保留，data/screen-preview保存设备地址/Token和实物方向/cover/zoom1，provider字段逐字节序列化对照未变；另存tools/data/display-preferences.json（无Token）及独立screen-acceptance数据。GET页面含缩放、media设置正确、screen-control访问实物ready true。已请求Codex右侧打开，工具返回queued，不能声称已可见。日常DSH安装仍0.2.0，未复制文件、未重启，也未改其连续性文档。
- 文档与交付：根PROJECT_CONTEXT/CODEX_CHANGELOG、README、docs/{SCREEN_PLAYBACK,ARCHITECTURE,DEVELOPMENT_HANDOFF}及shared协议说明更新现场状态；固件源码README/docs仅更新实物结论，冻结source.zip保留构建时文档快照，不再声称当前43个文件全一致。0.4.1 tgz最终92160字节/48项，SHA256 5301d5c8887b2765e6484ae75a2e605253a3f3c16706cd1e61f6c1dcf0d07c13；包审核含缩放页面，无data/tests/artifacts或原始图片视频。
- 未完成与风险：日常DSH升级/完整完成提示事件验收、实际音画同时播放、长期网络/堆稳定、异常帧恢复、更长复用连接压力、后台解码、USB/BLE/STT仍待。放大会裁切动作边缘，不能保证完整内容不丢。当前控制页无DSH登录保护，仅限回环，不公开服务或填provider凭据；真实设备凭据只在忽略的本机运行目录，不进包。

## 2026-11-03：M3.1屏幕接收固件与VOICE 0.4.0逐帧推送

- 用户目标：人在电脑之外仍继续固件开发，主体业务留电脑，板子只接收/短缓存/显示及播放。用户随后确认1.8寸、多针接口；按8针P7/ST7735S128×160设为首选候选，保留现场调整。全程无subagent，不访问串口、不烧录、不重启日常DSH。
- 硬件核对：使用PDF技能及已装pdftoppm渲染MK024758/XZ-AI_KZBV1.8原理图，目视确认P7第3～8脚网络21/47/45/40/41/42。SCK/MOSI/RST/DC/CS/BL角色依据常见8针模块顺序推断，图无信号名，不能当实物确认；P6为7针接口，本版不默认兼容。pdftotext不可用，改用完整页和局部高分辨率视觉检查；渲染有字体替代提示，数字/网络标签可读。中间图位于忽略的firmware artifacts/acceptance/screen-review。
- 固件：新增components/lease_display及display/frame HTTP接口，复用设备Token和M2.3异步HTTP组件。启动profile:off不驱动屏幕GPIO，电脑明确配置后才启用SPI2/20MHz；基础ST77xx初始化、尺寸/偏移/颜色/镜像调整。RGB565BE全帧最多153600字节，独立异步接收，与音频预约分开；PSRAM仅最新待显示帧，4096字节内部DMA缓冲同步复用，5秒断流清黑并释放流，迟到stop不误停新ID。无动画Flash、视频解码或TTS业务。M3.1较首个M3.0补资源初始化失败清理、清屏失败关闭显示驱动，旧冻结版本保留。
- 电脑端：0.4.0新增extensions/display.js和client/frame-sender.js，canvas生成RGB565BE、最多约5fps逐帧确认发送，宿主注入Token、检查固件能力/尺寸/序号、单窗口所有权和停止。屏幕页增加实体配置保存、能力检查、当前画面推送、红绿蓝白黑测试色块及停止。暂停时重复最后画面，关闭页尽力带ID停止；没有后台常驻解码器，后台页限速可能影响帧率。旧M2固件被拒绝，不假称显示成功。
- 修改文件：firmware/esp32-s3新增components/lease_display/{CMakeLists.txt,lease_display.c,include/lease_display.h}、docs/M3_DISPLAY.md；修改CMakeLists.txt、main/{CMakeLists.txt,main.c,lease_service.c,lease_service.h}、scripts/{build.ps1,package.py,verify.py}、README.md。软件新增extensions/display.js、client/frame-sender.js、tests/display.test.mjs、tests/helpers/display-device.mjs；修改host/{index,routes}.js、core/media-library.js、client/{screen.html,screen.js,index.html,ui.css}、scripts/preview.mjs、tests/{media.test,dsh.test,screen.browser}.mjs、package与lock、README。新增shared/protocol/device-display-v1.md，更新协议README、根README、docs/{SCREEN_PLAYBACK,ARCHITECTURE,DEVELOPMENT_HANDOFF}.md及根中文连续性文档。未改原pet/meme、SDK、旧冻结交付、日常安装/凭据。
- 固件验证：使用现有D:/Espressif IDF5.3.1、GCC13.2.0、Python3.11.2，build.ps1分别在D:/lease-voice-build/0.1.0-m3.0-1cb30b39和0.1.0-m3.1-fa1c58c5执行823步构建、package.py与verify.py全部通过，无下载安装。SDK已有idf_version.txt诊断/子模块跳过提示，不是本次编译错误。主聊天再独立verify.py通过，日志artifacts/acceptance/m3.1-offline-verify.log；逐字节检查source.zip内43个文件与当前固件源码一致。
- 固件交付：artifacts/0.1.0-m3.1为当前权威版本，manifest明确hardware_tested:false。应用944736字节，SHA256 5e656feefea1407e31fc2b2e8144846c3e869cb352786e81d1d9fbeac8b12530，0x10000起最大末地址0xf6a60，在原首1MiB备份覆盖内，但该备份仍不是全16MiB/恢复验收。bootloader与分区表哈希和M2.3一致，原分区/NVS布局不变；本轮没有写设备。
- 软件验证：npm.cmd test最终41项通过/0跳过，npm.cmd run check通过37个JS/MJS，npm.cmd run build通过；test:browser通过原语音/提示去重/模拟设备回归，test:screen通过原画面/VP9/移动布局及canvas色块→RGB565→宿主→Node模拟器全链路，校验色值、40960字节帧、单帧背压及停止。另测153600字节全帧、旧固件、坏确认、401、在途取消和迟到stop。首次新增2项因fixture误将含函数的模拟器对象作为设备配置导致DataCloneError，修为只含endpoint/token后通过。Node模拟器不执行ESP32 C/SPI，不能算固件运行或硬件显示验收。
- 软件交付：npm.cmd pack --ignore-scripts --pack-destination artifacts --json成功，dsh-lease-voice-0.4.0.tgz为91753字节/48项，SHA256 ca50d145696e068ac34a8f0796f9b057c00f0b304073ff6d11623010b5454985；tarfile审核必需新增文件存在，不含data/tests/artifacts或原始图片/视频。Python检查19个本地文档链接有效、PowerShell解析build.ps1通过；git status仍提示非Git仓库，不虚报提交。
- 预览更新：核实4318监听进程确为此前Node34808/scripts/preview.mjs后，仅停止并更新本项目隔离预览，隐藏新进程35272，原独立data/screen-preview和4项示例列表保留。GET页面验证含新推送入口，素材179项、首选st7735-128x160；日志artifacts/screen-preview-0.4.*.log。不复制日常凭据，不向板子发指令，真实DSH仍0.2.0，设备仍M2.3。
- 未完成与风险：M3烧录、实装控制器/引脚角色/背光和基础初始化效果、颜色方向偏移、真实Wi-Fi帧率/音频并发/截断帧/断流和长期堆稳定均待现场。基础ST77xx初始化可能需要实装模块特定参数，SPI成功/queued/drawn均不证明屏幕亮起。0.4.0日常部署、宿主后台解码推送、USB动画、BLE/STT未做。后续先off状态回归语音，再测试色块，确认后才播动画；不把本机回环预览开放到外网。

## 2026-11-03：VOICE 0.3.0 电脑端素材播放原型与完成叮声

- 用户目标：电脑负责 pet/meme/本地素材选择、独立播放和事件编排，固件只接收、短缓存及播放；不跟随桌宠动作、不移植原插件，先用「叮」替代语音提示。用户明确禁止 subagent，本轮全由主聊天完成。
- 主要修改：新增只读可选素材来源自动发现/目录设置、本地导入和删除、独立screen.json/media持久化、顺序/随机列表及重排、canvas预览、模拟尺寸/背景/适配/暂停/切换。视频通过浏览器解码并静音播完切换，素材走owner路由和ID，支持Range，限制类型/文件头/体积/目录边界，跳过符号链接。图片/视频不写入设备；尚未实现画面传输或固件显示。
- 完成提示：电脑生成24kHz/16bit/0.38秒叮声，无TTS调用，复用浏览器/ESP32 PCM任务与取消；独立开关/输出位置/强度，默认关闭。当前可见主会话的成功新回复触发，租约和消息去重；同窗口正文后排队，允许15分钟内等待长正文。隐藏/关闭聊天不通知，不做全局混音；设备占用时报错。
- 修改文件：software/dsh-voice新增core/{media-library,chime}.js、client/{screen.html,screen.js,screen-player.js}、tests/{media.test,screen.browser}.mjs；修改host/{index,routes,config}.js、core/tasks.js、client/{entry,index,player}.js、client/{index.html,ui.css}、scripts/preview.mjs、tests/{dsh.test,ui.browser}.mjs、package.json/package-lock.json和README.md。更新根README.md、PROJECT_CONTEXT.md、CODEX_CHANGELOG.md、docs/{ARCHITECTURE,DEVELOPMENT_HANDOFF}.md，新增docs/SCREEN_PLAYBACK.md。源码版本0.3.0；未修改原pet/meme、安装目录、固件、SDK或凭据。
- 验证：npm.cmd run build通过；npm.cmd test为37项全部通过、0跳过，包含本机真实Session/Connection鉴权与WRX编排开关隔离对照；npm.cmd run check通过33个JS/MJS语法及清单检查。npm.cmd run test:browser通过原语音/设备模拟回归，并新增手动模式叮声、双窗口提示去重、正文后叮、刷新和切会话不补播。npm.cmd run test:screen通过实际像素、列表持久化/重排/随机、背景/裁切/尺寸、暂停/视频循环、上传/删除/错误文件和390px浅色布局，无JS/CSP错误。实际浏览器测试发现旧预览尺寸未更新，已修复为开始时比对当前方案；通过后复测。
- 本机素材：以实际DSH_HOME自动发现179项（106个pet WebM、73张meme图片），原目录只读；Edge实际解码VP9透明pet视频并绘制canvas，桌面/移动截图在software/dsh-voice/artifacts/screen-*.png，已人工查看。浏览器测试不代表实体屏幕或日常宿主端到端验收。
- 打包：npm.cmd pack --ignore-scripts --pack-destination artifacts --json成功，dsh-lease-voice-0.3.0.tgz为86131字节/46项，SHA256 975136478b7f7c3265c2a41687332fed67de69c780a8ad4760367aac55e8bf8a。用D盘现有Python tarfile审核必须的screen/media/chime文件均存在，不含data、测试、artifacts或原始图片/视频。
- 文档收尾：D盘Python检查根README、插件README及屏幕说明中的10个本地链接全部有效，package与lock版本均0.3.0，中文连续性文档非空且包含本次记录；rg确认连续性文档仅在项目根目录。git status确认当前仍不是Git仓库，不虚报提交或差异状态。
- 预览：以隐藏Node进程34808启动现有scripts/preview.mjs，仅监听127.0.0.1:4318；DSH_HOME只作素材发现，独立数据目录software/dsh-voice/data/screen-preview，不复制日常凭据。GET screen返回200、媒体179项；保存4项示例播放列表成功。入口http://127.0.0.1:4318/api/lease-voice/screen，需点击开始。输出日志在忽略的artifacts/screen-preview.*.log；页面关闭即停止画面，Node进程仍提供预览，可按PID核实后停止。
- 未完成事项：0.3.0日常部署与完整宿主验收、后台画面推送、实体屏幕硬件确认/接收协议/驱动/现场验收、USB动画、语音提示素材、BLE/STT和长期运行验证。本轮未重启DSH、未访问串口/烧录/实物放音、未调用付费provider，日常仍0.2.0、设备仍M2.3。
- 风险与建议：当前画面依赖预览页运行，不是已完成的宿主后台推送；浏览器编码支持/透明效果与设备接收性能分开验证。配置的素材目录或插件更新可能使列表项目失效，需刷新并移出失效项。第三方素材未再分发，后续公开分发前另核对素材许可。新版本部署前保留整个data目录，并使用新tgz修正此前安装来源元数据；不把本地预览对外开放或填真实provider凭据。

## 2026-11-02：M2 真实语音、ESP32 接入与 VOICE 0.2.0 部署完成

- 用户目标：多代理加速完成硬件接入，减少重复等待；用户明确授权直接 COM3 烧录/测试，并选择备份 VOICE 后同步及重启 DSH。
- 软件：插件0.2.0增加浏览器/ESP32输出选择、PCM16LE/24kHz单声道provider结果、按200字串行推送与播放轮询、按任务ID取消、目标感知缓存/去重；默认浏览器MP3路径保留。31项测试全过、27JS语法检查、客户端build及浏览器回归通过，发布包software/dsh-voice/artifacts/dsh-lease-voice-0.2.0.tgz。涉及client、core/tasks、extensions/device-audio、host/config、providers及其测试/文档，准确清单见发布包。
- 固件：M2新增PSRAM PCM上传/动态采样率I2S/任务状态/停止。M2.2不完整上传回归触发pbuf_free panic；M2.3在项目components/esp_http_server本地副本修复SDK5.3.1的async剩余body转交、异步socket跳过select/parse、server工作队列释放。未改已安装SDK；本地来源/许可证见LEASE_PATCH.md/LICENSE。更新firmware main/lease_service.c、lease_audio组件、CMake、scripts/{package,verify,build}及文档，旧版本冻结保留。
- 构建：D盘现有IDF5.3.1，原staging因新增本地组件触发808步重编译成功，package.py/verify.py通过；主代理独立verify.py再次通过，bootloader/partition-table哈希与M2.2一致。M2.3 app910832字节，SHA256 5546db795e0ad1c1726e2a3e1ff5c1c41b75cbc98bc81869b8352f986127e2e1，最大末地址0xee5f0在原首1MiB备份内。
- 烧录：主代理COM3/115200仅写0x10000应用，49.7秒、Hash of data verified，未整片擦除/eFuse；Wi-Fi/NVS配置保留，M2.3自动联网。
- 实物：真实火山短句“你好呀，语音已经接到这个小喇叭上啦。”已合成163714字节/3.4107秒并播放，用户确认完整句子及合适音量。M2.3执行tools/test-device-cancel.py通过：发送48000字节声明但仅传1000，其他连接GET queued、stop0.078秒返回、状态stopped、设备仍在线；随后tools/test-device-tts.mjs --replay经过sending→playing→completed通过，无新付费合成。首次带串口捕获重放因打开串口触发启动、网络尚未就绪失败；另有Python默认GBK解码输出失败；改为等待info200/UTF-8后通过，不把失败删去或计为硬件通过。
- DSH部署：备份安装根backups/voice-hardware-20261102-0.2.0；离线依赖更新因其他插件tarball缺失失败且profile三文件未变，随后同步41发布文件，provider凭据保留，设备地址/Token/输出目标逐字段保存。运行原维护apply-all/verify-core，persona-read旧lib/tools.js路径失效，其他脚本存在幂等重应用；未手改WRX/Remote Server。按授权通过管理员原入口重启SUCCESS。最终认证config/device-debug均HTTP200，协议1、ESP32输出、M2.3在线。
- 其他文件：新增tools/test-device-tts.mjs、test-device-cancel.py及工具说明；node --check及Python py_compile通过；更新共享音频协议/schema、根README、PROJECT_CONTEXT.md、CODEX_CHANGELOG.md及DSH根连续性文档。验收证据位于忽略的firmware/esp32-s3/artifacts/acceptance，未打印Token/密码/cookie。
- 未完成及风险：屏幕/BLE/STT与长期稳定性未做；供应商原固件只有首1MiB备份、恢复未测试。安装文件已为0.2.0但profile来源元数据仍旧，后续重装须用新tgz保留data；旧persona-read维护脚本由对应项目后续适配。短回归不等于所有网络故障/长期可靠性保证。

## 2026-11-02：M1 实物联网、鉴权与喇叭短音通过

- 用户目标：完成本地Wi-Fi配置后快速验证联网和喇叭，减少重复检查。
- 操作与结果：用户在本机配网窗输入凭据，设备连接192.168.31.137。主代理直连局域网GET info得到200、版本0.1.0-m1.1、connected、auth:token；缺Token得到401。volume35/test-tone/stop均200/ok，但用户未听到；关闭本机配网窗释放COM3后，改volume100再发一次短音，用户明确确认听到、反馈音量很小。串口同期无音频错误、Wi-Fi disconnects0、心跳PASS。
- 修改文件与证据：PROJECT_CONTEXT.md、CODEX_CHANGELOG.md；新增忽略目录中的 artifacts/acceptance/m1-http-20261102.json、m1-audio-debug-20261102.log及m1-result-20261102.json。tools/data/device.json保存设备地址/随机Token，不保存Wi-Fi密码，未回显Token。未改冻结固件或重复构建/刷写。
- 验证命令：D盘Python以urllib ProxyHandler({})直连设备HTTP，断言info200/版本、缺Token401与三个命令ok；pyserial读取COM3/115200并通过HTTP设置100、发一次tone和stop。所有执行退出0，声响由用户确认。没有追加长观察或断电循环。
- 音量说明：当前测试音MAX_AMPLITUDE1600，volume100仍只有约4.9%数字满幅；volume35约1.7%，不等于功放/喇叭最大声压。后续真实语音时调整实用音量范围，不为测试音单独重刷。
- 未完成与风险：尚无真实TTS音频传输/播放、BLE、屏幕；重启重连和长期稳定未实测。Wi-Fi与Token设备本地NVS存储，测试通过不等于安全配对或出厂恢复验证。

## 2026-11-02：M1 Wi-Fi/设备调试/测试音集成并直接烧录

- 用户目标：两小时内加快进度、减少等待与重复验证；明确授权主代理直接烧录并测试，使用subagent开发，Wi-Fi密码仅本地输入。
- 主要修改：网络子代理集成M1本地UART JSON配置、独立NVS保存恢复、重连退避与DHCP超时、Token验证HTTP调试；音频子代理新增Philips I2S GPIO7/15/16、16kHz16bit双声道、800ms440Hz低幅测试音、音量/停止及代际取消，启动静音。主代理新增WinForms配网工具、配置超时提示、随机设备Token和本机地址文件，密码不记录。原M0交付保留，当前版本0.1.0-m1.1。
- 修改文件：firmware/esp32-s3下CMakeLists.txt、main/{CMakeLists.txt,main.c,lease_network.c,lease_network.h,lease_service.c,lease_service.h}、components/lease_audio/{CMakeLists.txt,lease_audio.c,include/lease_audio.h,README.md}、scripts/{build.ps1,package.py,verify.py}、README.md、docs/M1_SETUP_AND_ACCEPTANCE.md；新增tools/{device-setup.ps1,device-setup.cmd,README.md}，根连续性文档。准确源码快照见新交付source.zip，未改冻结M0或其他聊天软件修改。
- 构建验证：D盘IDF5.3.1工具链在D:/lease-voice-build/0.1.0-m1.1-c11cfcbc实际编译完成；聊天网络中断后本机bin仍保留。主代理运行package.py --source firmware/esp32-s3 --stage该目录 --output artifacts/0.1.0-m1.1，打包及verify.py全部通过，未重复完整构建。编译源码/staging一致性由打包脚本验证，镜像/哈希/分区/配置通过。音频代理另以真实GCC/SDK -fsyntax-only通过。没有下载安装依赖。
- 配网工具验证：PowerShell Parser及powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File tools/device-setup.ps1 -Check通过；创建销毁窗体，不开串口。PS1使用UTF-8 BOM兼容Windows PowerShell中文。实际配网窗已启动，等待用户配置；tools/data/device.json只含设备endpoint/token/port，受原.gitignore排除，尚未验证联网。
- 烧录验证：主代理比对M0/M1的bootloader和partition-table哈希一致，最大末地址0xed4e0仍在原首1MiB备份范围。实际仅write_flash 0x10000 lease_voice.bin，COM3/115200/DIO/40MHz/16MB，906464字节（压缩562054），49.5秒且设备报告Hash of data verified；应用SHA256 977a292d4f246cae04505a944d1e3ebaa0bb1f1ca7d1ef8679bba1d990eeb862。未整片擦除、未改eFuse。
- 实物启动验证：复位后短时捕获m1-boot-20261102.log；M1_MEMORY_READY、16MB/8MB/抽样PASS，NVS/audio/Wi-Fi/HTTP/UART初始化均ESP_OK，M1_READY；status响应needs-config、audio:true；test-tone响应ok:true，没有记录到音频错误。实际是否听到声音等待用户反馈，不把命令接受等同声学验证。网络密码尚未配置，HTTP未实测。
- 未完成与风险：联网和HTTP鉴权待配置、实际声音待反馈；屏幕/BLE/TTS推送未实现。功放型号未完全确认。保留冻结M0可供应用回退，但不承诺供应商出厂恢复；短测试不等于长期稳定。

## 2026-11-02：移除聊天播放器动态导入依赖

- 用户目标：处理截图中的 Failed to fetch dynamically imported module /api/lease-voice/player.js。
- 核对：真实已认证DSH页面中player.js/ui.js均200、正确JavaScript MIME，直接动态导入成功；本次未稳定复现原失败，不将网络/CSP/缓存中的某一种猜测写为确定原因。
- 修改：0.1.2新增client/entry.js与scripts/build-client.mjs，播放器由同一源码静态打入client/index.js，移除聊天入口对额外HTTP模块导入的依赖；更新清单/锁文件、README与回归断言。设置页面的普通模块仍保留。
- 验证：npm.cmd run build成功，npm.cmd run check 23个JS/MJS语法通过；npm.cmd test最终21项通过。首次新增bundle断言未兼容esbuild的匿名类写法，修正后通过。浏览器回归通过：真实React挂载、手动/自动播放、两设置页、设备模拟调试、多窗口与刷新均正常，无页面JS错误；0.1.2已重新打包。
- 同步：按用户此前不备份偏好，4个文件原位同步DSH安装副本，SHA256一致，data/config.json哈希不变；无宿主源码/WRX/预设变更，无服务重启。
- 未完成/风险：需要用户浏览器强制刷新，旧页面仍可能保留失败模块缓存；未触发新的真实合成。


## 2026-11-02：M0 实物启动通过，按用户要求缩短观察并推进 M1

- 用户目标：烧录完成后确认运行；用户随后要求两小时内加快进度、减少不必要等待及重复验证。
- 主要修改与操作：用户用Flash Download Tool写入三镜像并报告FINISH；关闭下载器后主代理成功打开COM3。初次监听15秒无数据，通过RTS进行一次复位后捕获完整启动与心跳。按用户要求终止剩余长观察，不再安排三次断电作为推进门槛；文档同步实际证据和待办。子代理分别负责M1网络/本地串口配置/HTTP与I2S测试音，主代理负责联调，不并发操作串口。
- 修改文件：PROJECT_CONTEXT.md、docs/DEVELOPMENT_HANDOFF.md、CODEX_CHANGELOG.md；新增忽略目录下 artifacts/acceptance/m0-boot-20261102-220628.log 与 .json。本记录不覆盖其他聊天的TTS源码与安装同步记录。
- 验证：D盘Python/pyserial以COM3、115200、8N1读取；bootloader和app版本匹配v5.3.1-dirty/0.1.0-m0.2，DIO/40MHz/16MB；物理/header Flash均16777216、PSRAM8388608、IDF SRAM自检及64KiB抽样PASS、M0_READY。共26条心跳，uptime10至260秒、status全部PASS、internal_free恒385951、psram_free恒8386308、仅出现一次应用启动。JSON统计由原始日志解析生成；串口进程已停止并释放COM3。
- 未完成：未执行完整5分钟/三次断电验收，不宣称完成；Wi-Fi/BLE/音频/屏幕尚未实测，M1正在开发。
- 风险与建议：当前证据支持基础启动与短时稳定，不等于全部内存长期可靠性；后续仅对变更和具体失败追加检查，优先完成联网与测试音。

## 2026-11-02：按火山官方双向协议修正并同步 DSH 安装副本

- 用户目标：核对官方双向 WebSocket TTS 文档，修正通用源码和已安装副本；用户明确选择不备份，只同步修正文件。
- 修改：版本0.1.1，新增 providers/volc-protocol.js、volc-websocket.js；更新 tts.js、host/config.js、client/index.html、ui.js、package.json/package-lock.json、相关测试与文档。默认双向 WebSocket，保留显式 SSE；采样率置于 audio_params，移除硬编码128000码率；完整二进制会话事件、取消、错误/截断/重定向处理。ws 8.22.1随包分发。
- 配置：识别旧官方 SSE 默认地址及误填的 https bidirection，在内存适配 wss，不改写用户配置文件或凭据；自定义SSE保留，点击保存才持久化。
- 官方核对：读取用户提供的官方文档及其 protocols.zip；scripts/verify-volc-reference.mjs 与官方Python编码器6种请求逐字节一致，6种响应解析一致。首次参考脚本受Windows stdin编码影响失败，改为显式UTF-8后通过。
- 验证：npm.cmd test 21项全通过、无跳过；npm.cmd run check 21个JS/MJS通过；npm.cmd run test:browser通过，包括协议下拉/地址联动、原有播放和多窗口。早期旧mock测试未指定SSE，曾使用占位key误发真实WS握手并得到401，随即改为明确本地/模拟协议；未用用户凭据执行该失败测试。
- 真实验证：仅用已保存凭据合成“你好，这是语音测试。”一次成功，19629字节，浏览器解码2.448秒、单声道、非静音；artifacts/volc-real-test.mp3。配置哈希前后相同，未打印密钥。
- 同步：向 profiles/web/node_modules/dsh-lease-voice 解析后的实际安装目录原位同步27个程序/依赖文件，逐文件SHA256一致；含ws及LICENSE，未重新安装依赖树、不改profile/pnpm锁文件、不碰data。安装版JS语法与独立导入通过，读取协议版本2、websocket/wss。
- 打包：npm.cmd pack --ignore-scripts --pack-destination artifacts --json通过，0.1.1包63869字节、37文件，bundled ws。旧0.1.0包作为历史产物保留。
- 运行态：认证GET /api/lease-voice/config为200，但仍报告旧后端版本1；磁盘同步没有令当前进程自动重载。未停止或重启DSH，需用户空闲时重载/按原入口重启后刷新。
- 未完成/风险：尚未在当前日常进程中验证新后端；旧版凭据及其他provider仅mock验证。安装来源元数据仍可能指0.1.0包，后续重新安装须保留data并使用新包。本轮不改硬件/固件和其他聊天正在维护的内容。


## 2026-11-02：子代理接手完成 M0 构建交付并备份原写入区域

- 用户目标：独立开发窗口完成本轮后，由主聊天统一联调，子代理使用用户已经装好的 D 盘环境编译，不再下载工具，不让用户在窗口之间转发。
- 主要修改：修复 build.ps1 在 Windows PowerShell 下将原生 stderr 提示当作异常的问题，按进程退出码判断；package.py 增加 SDK dirty/符号链接审计。更新固件 README、兼容性与烧录验收状态。交接文档改为主代理+子代理协作，根文档统一维护。未改 M0 逻辑和 Wi-Fi 草稿。
- 修改文件：firmware/esp32-s3/scripts/{build.ps1,package.py}、README.md、docs/{FLASH_AND_ACCEPTANCE.md,IDF_5_3_1_COMPATIBILITY.md}；docs/DEVELOPMENT_HANDOFF.md、PROJECT_CONTEXT.md、CODEX_CHANGELOG.md。生成忽略目录 artifacts/0.1.0-m0.2 交付及 artifacts/backups/original-20261102 备份/读取日志/backup-manifest.json。
- 构建验证：子代理实际执行 powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1 -IdfPath D:/Espressif/frameworks/esp-idf-v5.3.1 -IdfToolsPath D:/Espressif -PythonExe D:/Espressif/python_env/idf5.3_py3.11_env/Scripts/python.exe -StageRoot D:/lease-voice-build，499步构建成功并打包/verify通过，退出0；实际 staging 为 D:/lease-voice-build/0.1.0-m0.2-bf001f43。Python语法、PowerShell Parser 和 check_source.py 检查通过。主代理另用D盘Python执行 scripts/verify.py artifacts/0.1.0-m0.2，通过哈希、配置、分区、源码包与镜像校验；逐文件比较source.zip与当前源码字节一致。没有重复运行无改动的软件测试。
- 交付：版本0.1.0-m0.2，SDK v5.3.1-dirty commit c8fc5f643b7a7b0d3b182d3df610844e3dc9bd74、GCC13.2.0、Python3.11.2、esptool4.8.1。dirty项全部为安装包展开symlink且目标内容一致，审计归档；未修改SDK。bootloader.bin@0x0（21024字节）、partition-table.bin@0x8000（3072字节）、lease_voice.bin@0x10000（194976字节），DIO/40MHz/16MB，镜像最大末地址0x3f9a0；完整哈希见交付manifest，未实物验证。
- 备份验证：主代理 esptool5.6.0 --port COM3 --baud 921600 read-flash 0x0 0x1000000 在53%短帧失败；460800读取首1MiB也短帧失败；115200 read-flash 0x0 0x100000 最终成功，93.2秒、1048576字节。SHA-256 fe09dfa27f4d14a9f7884f259b759f1086dde12ab4d4e4357c40ffc9f11b6682；实际检查三镜像覆盖区域均位于备份内。仅首1MiB，不是完整Flash备份，失败记录保留，未测试恢复。读取会复位，未烧录、擦除或修改eFuse。
- 未完成事项：首次实际烧录、启动/内存/心跳和断电恢复验收；Wi-Fi/BLE/音频/屏幕仍未实现或未集成。没有下载安装依赖。
- 风险与建议：首版替换原分区，不能承诺兼容旧数据或恢复出厂；高速串口不稳定，使用115200。冻结交付不再覆盖；仅使用最终 artifacts/0.1.0-m0.2，不用staging中的first-package。原独立窗口不要与子代理并行写同一工程。

## 2026-11-02：适配 M0 至 ESP-IDF 5.3.1，完善验收并隔离 Wi-Fi 草稿

- 用户目标：用户自行在D盘安装ESP-IDF 5.3.1；开发侧继续兼容检查、完善烧录/验收，可编写Wi-Fi基础模块但保持M0独立；不下载安装、不操作COM3，未编译内容必须标明未验证。
- 主要修改：M0版本提升至 `0.1.0-m0.2`，工程及C代码限定5.3.1；构建显式使用用户SDK/工具/Python路径，移除5.5.2 commit限制与v5.5约束硬编码，使用全新staging避免旧缓存。禁用组件管理器及IDF的自动子模块拉取；缺依赖即停止，不调用安装/下载或export.ps1。打包兼容无Git安装包、记录编译器/Python、归档脚本文档、自动生成实际烧录地址/大小/哈希的DELIVERY.md；加强离线布局/配置校验，禁止Python -O跳过断言。
- 文档：新增5.3.1源码兼容性矩阵、分离镜像与原固件数据影响说明、Flash Download Tool参数核对、115200日志模式、5分钟观察和三次断电启动验收；明确设计地址不等于已生成镜像清单，当前无bin/哈希/已验证回退固件。
- Wi-Fi草稿：`next/lease_network/`提供一次性任务启动、默认NVS配置保存/恢复、IP/连接状态、断连后1至30秒退避；不记录凭据，NVS错误不自动擦除。默认不在M0组件搜索、staging和发布包中；缺本地输入入口、停止/改网、DHCP及仅丢IP恢复，不算M1完成。
- 修改文件：`firmware/esp32-s3/CMakeLists.txt`、`main/main.c`、`scripts/{build.ps1,package.py,verify.py,check_source.py}`、固件README、`docs/{IDF_5_3_1_COMPATIBILITY.md,FLASH_AND_ACCEPTANCE.md}`、`next/lease_network/{CMakeLists.txt,lease_network.c,include/lease_network.h,README.md}`；根PROJECT_CONTEXT/CODEX_CHANGELOG。未修改共享协议、交接文档、插件或背景项目。
- 验证：`git status --short`再次确认不是Git仓库；只读核对用户正在安装的D盘SDK及官方v5.3.1源码。`python firmware/esp32-s3/scripts/check_source.py --idf-path D:/Espressif/frameworks/esp-idf-v5.3.1`通过：19个配置名、公开API声明、所需组件目录、本地文档链接及M0隔离入口。静态检查初版误将esp_get_idf_version声明定位到esp_system.h，按实际esp_common/esp_idf_version.h更正后通过。`python -m py_compile`检查三个Python脚本、PowerShell Parser::ParseFile检查build.ps1通过。未激活用户安装环境、运行构建/镜像校验、模拟Wi-Fi、烧录或实物验收；没有执行下载安装。
- 未完成：等待安装完成与实际路径；编译/链接、最终配置取值、真实打包执行与镜像头校验均未验证。Wi-Fi只核对API声明，任务生命周期、事件时序、NVS保存和重连尚未模拟或实测，待后续独立M1版本集成。
- 风险与建议：SDK源码静态存在不表示工具链安装完成；新分区对旧数据影响未知，首版无已验证回退。不能把文档中的设计偏移当作烧录清单，也不能将Wi-Fi草稿混入M0版本声明。继续保留已有下载文件，开发侧不触碰串口。

## 2026-11-02：编写 M0 启动诊断源码，按用户要求停止工具链安装

- 用户目标：本聊天负责固件开发，先交付 M0；随后用户要求立即停止下载和安装，保留源码及下载文件，等待其自行安装 ESP-IDF 并提供路径，不得自行重新下载安装。全程禁止操作 COM3、烧录或擦除设备。
- 主要修改：新增 `0.1.0-m0.1` ESP-IDF 工程，配置 ESP32-S3、16MB DIO/40MHz Flash、Octal/80MHz PSRAM、单 factory 分区；输出版本/复位原因/物理及镜像 Flash 容量/PSRAM 容量，执行 64 KiB PSRAM 抽样检查与每 10 秒心跳/堆完整性检查。新增无空格路径 staging 构建、版本目录防覆盖、离线打包和校验脚本；提供后续验收、数据影响和首版无已验证回退的说明。以上为未编译源码，不是已验收固件。
- 修改文件：`firmware/esp32-s3/{CMakeLists.txt,sdkconfig.defaults,partitions.csv,README.md}`、`main/{CMakeLists.txt,board_profile.h,main.c}`、`scripts/{build.ps1,package.py,verify.py}`；更新根 `PROJECT_CONTEXT.md`、`CODEX_CHANGELOG.md`。未修改插件、共享协议、交接文档或背景项目。
- 验证：`git status --short` 确认不是 Git 仓库；阅读交接和共享协议，核对 ESP-IDF 官方文档及已下载源码 API/Kconfig。执行 `python -m py_compile firmware/esp32-s3/scripts/package.py firmware/esp32-s3/scripts/verify.py` 与 PowerShell `Parser::ParseFile` 检查，并在停止时对最终脚本复验，语法通过。进程查询确认无匹配的本任务下载安装进程，已有文件仍存在，artifacts 目录不存在。未运行 C 编译、镜像生成、离线交付校验或实物测试；不将脚本存在写为构建成功。
- 环境操作：此前启动 ESP-IDF v5.5.2 递归克隆、`idf_tools.py install --targets esp32s3`、`install-python-env`。用户叫停后按命令行与父子进程关系终止本任务仍运行的克隆/下载/安装进程及其子进程，未删除源码、SDK、缓存、Python 环境或下载文件；`.espressif/dist` 中已有 GDB 压缩包及未完成的编译器 `.zip.tmp` 文件保留。工具链安装完成状态未经确认，不得直接视为可用环境。
- 未完成事项：等待用户提供 ESP-IDF 路径；核对实际版本与脚本固定 commit 兼容性，再进行 M0 编译、修复、交付与准确烧录清单。未生成任何可交付 bin、SHA-256 清单或实物启动证据。
- 风险与建议：源码与交付脚本尚未经过完整编译执行；内存参数、自定义分区、控制台及候选引脚须后续核验。原固件分区和备份未知，不承诺保留原网络配置或恢复出厂固件。开发侧继续不触碰串口，不自行重启下载安装。

## 2026-11-02：设计固件开发与实物联调双聊天分工

- 用户目标：由一个窗口专门开发固件，当前聊天继续带用户做实物测试，明确技术边界和交接方式。
- 主要修改：新增双聊天职责、单一串口操作方、共享协议维护、M0 至 M4 验收、版本化固件交付和问题反馈格式；提供可直接交给开发聊天的启动任务。Wi-Fi/BLE 属于同一固件工程，先启动/联网/测试音，再设备调试、音频传输与易用性。同步此前实物识别及新原理图证据，区分旧教学板、实装智能板和待确认器件。
- 修改文件：docs/DEVELOPMENT_HANDOFF.md、firmware/esp32-s3/README.md、PROJECT_CONTEXT.md、CODEX_CHANGELOG.md。
- 验证：只读核对共享 schema、协议 README 与 extensions/esp32.js 的现有路径和命令；确认智能扩展板 PDF、Flash Download Tool 压缩包及临时识别工具存在。git status --short 再次提示当前不是 Git 仓库。PowerShell Test-Path/Get-Item 检查 4 份修改文档非空、正则提取并检查固件 README 两处相对链接有效、ConvertFrom-Json 解析共享协议成功，命令退出 0；rg 核对 COM3 所有权、M0/M1 与尚未创建聊天的状态表述。本轮未烧录、未构建固件，未重跑无代码改动的软件测试。
- 未完成事项：尚未创建独立开发聊天，尚无固件源码/构建产物、Wi-Fi/BLE/音频实物验收；音频器件型号与屏幕控制器、PCB 版本仍待确认。
- 风险与建议：同一工作目录没有 Git 隔离，限制源码写入范围并串行更新共享文档；开发侧不打开串口，产物交付后不覆盖待验收版本。原理图文件名 V1.8 与图内 V1.7 不一致，不将接口兼容标注当成实装器件确认。

## 2026-11-02：核对并补充本机 DSH 安装说明

- 用户目标：了解如何将插件安装到 DSH。
- 主要修改：核对真实插件管理器 reconcile 实现，纠正此前仅凭 CLI 帮助认为只处理依赖的表述；新依赖声明 dsh.bundle 时会自动加入 profile bundles。补充显式 DSH_HOME、本地 CLI 与现成 tgz 的 PowerShell 安装命令、刷新及必要时使用现有重启入口的步骤。
- 修改文件：software/dsh-voice/README.md、PROJECT_CONTEXT.md、CODEX_CHANGELOG.md。旧日志保留，其“只负责依赖管理”判断由本条更正。
- 验证：只读核对本机 plugin-BiveYA7h.js 与 dsh-plugin-manager/lib/index.js 的安装及 reconcile 调用链；Get-Item 确认原 tgz 存在。新增 PowerShell 安装示例经 Parser::ParseInput 检查无语法错误；npm.cmd pack --ignore-scripts --pack-destination artifacts --json 成功，重新打包包含更正后的 README，22531 字节、16 个文件。没有执行安装、付费模型、配置变更或服务重启；本次仅改文档，不重跑程序测试。
- 未完成事项：正式安装和加载、真实 provider 及日常 WRX 环境验收仍待执行。
- 风险与建议：示例的 DSH_HOME 只在当前 PowerShell 会话生效，避免误装旧用户目录；安装成功后先刷新检查入口，未加载时才在会话空闲时使用既有重启入口。未修改背景项目。

## 2026-11-02：实现设置 Web UI、三种 TTS provider 与 ESP32 调试页

- 用户目标：在 DSH 设置内注册语音 Web UI，配置 provider、手动/自动朗读；另设扩展页连接与调试 ESP32。用户指定火山引擎优先，并要求多种 provider 格式下拉选择；继续遵守原生 DSH 与 WRX 定制分层。
- 主要修改：实现 `dsh-lease-voice@0.1.0` 宿主/客户端 bundle；注册「语音」「语音扩展」两个 settings.section、助手消息转语音按钮和会话声音授权/停止控件。生产页面/API 走 DSH 已认证 connection.fetch，不另开端口。配置按 provider 保存、密钥脱敏、空值保留与显式清除；正文通过 sessionQuery 读取。
- 语音实现：火山 V3 SSE（新版 API Key 与旧版 App ID/Access Token）、OpenAI 兼容二进制 Speech、MiniMax HTTP hex 三种独立适配；不发送提示词。最终回复筛选、Markdown 整理、800 字分段、顺序播放、短期缓存、自动播放租约/去重、取消代际控制与 LAN HTTP 随机 ID 回退。修复迟到取消请求可能误停新一代任务的竞态，并添加回归。
- 扩展实现：保存一台设备地址/凭据；连接检查、音量、停止、测试音与调试反馈；设备调试 v1 schema。明确这只是 HTTP 调试通道，不代表已经实现音频推送、固件或实物兼容。
- 修改文件：新增插件 `package.json`、`package-lock.json`、`cordis.patch.yml`；`host/{index,config,routes}.js`、`client/{index.js,index.html,player.js,ui.js,ui.css}`、`core/{text,replies,tasks}.js`、`providers/tts.js`、`extensions/esp32.js`；`scripts/{check,preview}.mjs`、`tests/{core.test,dsh.test,ui.browser}.mjs`；新增 `shared/protocol/device-debug-v1.schema.json`、`docs/PROVIDERS.md`。更新根 README、PROJECT_CONTEXT、CODEX_CHANGELOG、.gitignore、架构文档、插件 README 与协议 README。
- 验证：`npm.cmd install --save-dev react@19 react-dom@19 esbuild playwright` 成功，安装 7 个开发包，npm 报告 0 漏洞；锁文件记录实际版本。`npm.cmd test` 最终 14 项全部通过、0 跳过。`npm.cmd run check` 16 个 JS/MJS 语法及清单检查通过。`npm.cmd run test:browser` 使用真实 React 与无头 Edge 验证双设置入口/iframe、provider 表单与配置、脱敏、试听音频实际播放、手动消息按钮、自动双窗口去重、刷新不重播、切换会话、设备模拟调试；另验证移动浅色布局不横向溢出及 randomUUID 缺失回退，无页面 JS 错误。浏览器结果仅代表隔离 harness，不是日常 DSH 安装验收。
- DSH/WRX 验证：真实本机 Session/Connection 模块中加载并释放插件，owner 200、非 owner 403、匿名 401、错误 Host 403；读取最终正文、未修改事件。将本机 agent-loop 副本放临时目录，实际关闭/开启 WRX 编排，加载 VOICE 前后请求消息一致，最终正文不含预设或思考，原安装文件内容未变。没有将本机 patched 分支当作干净上游完整宿主。初次生命周期探测误用 ctx.dispose 失败，已按实际 Cordis fiber.dispose 修正并通过真实卸载测试。
- 打包：`npm.cmd pack --ignore-scripts --pack-destination artifacts --json` 成功，16 个发布文件、约 22 KiB 压缩包，清单未包含运行数据、密钥、开发依赖、测试、预览服务或固件。产物 `software/dsh-voice/artifacts/dsh-lease-voice-0.1.0.tgz`；页面截图在同级 artifacts，均被 Git 忽略。CLI `plugin --help` 只读核实为 pnpm 参数转发，安装说明明确还需激活 profile bundle。
- 文档检查：根连续性文档与当前实现同步，已补 provider 来源及共享协议。PowerShell 检查 32 个源码/文档文件、12 个有效本地 Markdown 链接、3 份可解析 JSON，连续性文档只位于根目录。初次 ConvertFrom-Json 因 package-lock 的合法空字符串键失败，改用 -AsHashtable 后通过；最终 npm.cmd run check 再次通过。
- 未完成事项：未安装或重启日常 DSH；未填写真实密钥、调用付费 provider、运行干净原版完整宿主、连接实物、实现设备音频推送或固件；STT/屏幕素材仍后续阶段。
- 风险与建议：先在确认的目标 profile 加载并配置火山真实账号，再做日常 WRX 端到端验收；火山主文档抓取超时，本次根据字节官方示例及同系协议核对，国内旧凭据需实测。不同账号资源/音色授权可能不同；浏览器仍需声音手势授权；密钥为本机文件明文存储。背景项目均只读，未改日常数据库、配置、预设或 Remote Server。

## 2026-11-02：初始化语音插件与 ESP32 项目架构

- 用户目标：阅读其他工作区项目的连续性文档，为当前项目建立中文连续性文档与软件/固件目录架构；第一阶段纯 TTS，第二阶段连接 ESP32 播放，第三阶段动态表情，未来 STT。额外要求区分 DSH 原生功能与 LEASE-WRX 对上下文系统的定制，不能假定兼容。
- 主要修改：建立项目上下文、入口说明与架构文档；明确插件、固件、共享协议和素材的职责；规划手动/自动模式、provider 配置、最终回复选择、任务队列、取消与多窗口协调；增加原生 DSH/WRX 两组兼容性验收要求。建立四个主体目录说明与基础忽略规则，没有编写可执行程序或创建虚假构建入口。
- 修改文件：`PROJECT_CONTEXT.md`、`CODEX_CHANGELOG.md`、`README.md`、`docs/ARCHITECTURE.md`、`software/dsh-voice/README.md`、`firmware/esp32-s3/README.md`、`shared/protocol/README.md`、`assets/README.md`、`.gitignore`。
- 背景核对：只读阅读 LEASE-WRX、Deepseek Harness、Remote Server 的上下文与近期日志；核对实际 DSH 包版本、profile 依赖、消息操作栏/session 事件类型声明、WRX session/event 用法及本机 agent-loop 中的 request-transform-v2/compaction-boundary-v1 标记；核对 meme/pet 包清单与目录。未读取凭据或会话正文，未修改任何背景项目、安装配置或运行服务。
- 执行的验证命令及结果：`git status --short` 确认当前目录不是 Git 仓库；`Get-ChildItem -Force` 确认初始化前为空目录；`node --version` 为 v24.19.0，`npm.cmd --version` 为 11.17.0。PowerShell 使用 `Get-ChildItem -Recurse -File`、`Get-Content`、正则提取 Markdown 链接并逐个 `Test-Path` 检查非空文档、本地链接及连续性文档位置：首次检查因日志文件尚未创建发现 README 链接缺失，补齐本日志后复验结果见下方。使用 `rg -n` 核对宿主接口与补丁；首次猜测 agent-loop 位于 dsh-agent/lib 下未找到，按实际包 dsh-agent-loop/lib/index.js 重新定位并核对成功。官方硬件资料已查阅并在架构文档链接；未据此认定用户实物型号。
- 复验结果：PowerShell 文档检查退出 0；9 个文件中 8 份 Markdown 均非空，11 个本地相对链接有效，两份连续性文档只位于项目根目录。
- 未完成事项：全部插件/固件功能尚未实现；尚无项目运行、构建或自动测试命令，因此未运行功能测试。首个 TTS provider 和实际板级资料待确认；未进行真实 provider 调用、干净原生宿主运行对照、WRX 兼容性测试或实物播放。
- 已知风险与建议：本机宿主有 WRX 定制，包内接口存在不等于原生基线或兼容性通过；先在隔离环境验证消息接入。浏览器播放授权、多窗口去重、设备格式与网络可达性需实测；第三方素材需逐项记录来源与授权。未安装插件、未烧录设备、未自行重启 DSH。
