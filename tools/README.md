# 本机设备配网

另有离线音频导入工具：在项目根运行 `node tools/import-completion-sounds.mjs`，用现有Edge解码assets内MP3/WAV，将24kHz/16bit单声道WAV副本导入software/dsh-voice/data/screen-preview，并生成assets/completion-sounds.manifest.json。按PCM去重，原件不变、不调用TTS；预选全部素材随机播放，自动提示开关保持原值。可设置LEASE_VOICE_IMPORT_DATA指定已授权数据目录。需重载控制服务才能读取外部更新的索引，勿与正在修改素材的页面同时运行；详见[本地语音素材与保存](../docs/COMPLETION_SOUNDS.md)。

`device-setup.cmd` 打开本机 Windows 配网小窗口，配合 M1 固件使用，M0 不支持。先关闭烧录器和串口监视器，填 COM3、2.4GHz Wi-Fi 名称与密码，点击保存并连接。等待设备确认保存、连接并返回 IP；配置已保存不等于已经联网。

窗口通过 115200、8N1 USB 串口发送单行 wifi-set JSON，不打印或保存 Wi-Fi 密码，等待设备的 protocol:1 JSON 状态。串口日志不回显配置输入。每次窗口创建随机设备 Token，随配网请求发送；设备确认联网后，将地址和 Token 写入本机 `tools/data/device.json`，供主代理局域网调试使用。该文件含设备凭据，受根 .gitignore 的 `**/data/` 排除，不应分享。

窗口关闭会释放串口。打不开串口时先关闭其他串口工具；网络连接失败可以重新填写密码再保存。此工具只负责本地配置，不代替 BLE 配网或完整设备配对。

验证入口：`powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File tools/device-setup.ps1 -Check`，仅创建并销毁窗体，不显示界面、不打开串口或连接设备。

`node tools/test-device-tts.mjs` 使用已安装插件的本机配置，通过 TaskService 合成短句并推送至 ESP32；会调用真实服务。`node tools/test-device-tts.mjs --replay` 复用忽略目录中已保存的真实 PCM，只验证任务、传输与播放，不再次请求合成。报告不含凭据；音频与报告保存在固件 artifacts/acceptance 下。程序完成状态不能代替用户实际听音确认。

`python tools/test-device-cancel.py` 是实物回归：用本机设备配置发起不完整 PCM 上传，检查另一个连接能查询 queued 并按任务 ID 停止，保存无凭据的验收报告。仅在设备空闲时运行；不调用真实 TTS。需使用已安装的 D 盘 IDF Python。

`python tools/test-device-display.py --seconds 120 --swap --mirror-x --mirror-y --pattern border` 为当前实物横屏预设的色块/边框测试，读取tools/data/device.json，主动启用屏幕并推送，不调用TTS。仅在没有其他画面流时运行；默认不带方向参数时是原始竖屏。结束按流ID停止，报告保存到忽略的固件artifacts/acceptance。用户目视确认与received/drawn计数分开记录。

`node tools/test-device-animation.mjs` 启动独立回环预览及无界面浏览器，使用真实pet素材和已确认的160×128、swapXY/mirrorX/mirrorY配置，完整走页面→RGB565→宿主→设备。默认120秒；可用LEASE_ANIMATION_SECONDS、LEASE_ANIMATION_FIT、LEASE_ANIMATION_ZOOM调整时长/适配/缩放。运行数据独立存tools/data/screen-acceptance，只保存设备配置，不复制provider凭据。报告/截图在固件artifacts/acceptance；不重启DSH，结束停止画面并关闭临时服务器/浏览器。

长期手动控制使用本机 http://127.0.0.1:4318/api/lease-voice/screen。当前项目控制页已保存设备和实物方向，cover/zoom1为默认，预览设置支持0.5～3倍缩放。只在回环访问，不把这个无DSH认证的开发服务暴露出去；日常DSH插件仍需另行升级。
