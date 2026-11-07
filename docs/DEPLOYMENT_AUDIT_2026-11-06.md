# 项目边界与部署审计（2026-11-06）

## 结论

当前仓库是一个单仓库、多交付物项目：电脑端 DSH 插件 + ESP32-S3 固件 + 共享协议/配网工具/素材说明。不是完整 DSH 源码仓库，也不包含 WRX 的实现。语音没有丢失或拆到别处；屏幕播放也已经并入同一个 VOICE 插件。

部署关系：

```text
DSH 宿主（另行安装）
└─ dsh-lease-voice 插件（一个包）
   ├─ 回复正文 → TTS provider → 浏览器声音或 ESP32 音频
   ├─ 完成提示音素材 → 浏览器声音或 ESP32 音频
   └─ 电脑解码素材 → RGB565 画面 → ESP32
                                      └─ 独立烧录的固件：Wi-Fi/HTTP、喇叭、屏幕

另有开发预览服务 127.0.0.1:4318：独立进程、独立数据，不是生产 DSH 插件服务。
```

因此：源码放在一起；语音与屏幕功能作为一个 DSH 插件安装；固件单独烧录到设备。正常生产插件复用 DSH 路由，不需要另外启动 4318。可单独使用浏览器语音，不强制接 ESP32；设备端没有自行调用 TTS 或运行 DSH 的实现。

## 本轮核实的状态

| 对象 | 实际证据 | 判定 |
| --- | --- | --- |
| 开发源码 | software/dsh-voice/package.json | 0.6.0 |
| DSH 磁盘安装 | profiles/web/node_modules/dsh-lease-voice/package.json；host/client/core/providers/extensions 31 文件逐字节比较 | 0.6.0，31 文件与源码一致 |
| DSH 安装声明 | profiles/web/package.json 的依赖与 bundles | 插件已列入启用清单，但来源仍为 dsh-lease-voice-0.1.0.tgz |
| DSH 运行态 | 部分 Node 进程命令行不可读，本轮未进行已认证生产 API/页面验收 | 无法据磁盘状态断言已加载 0.6.0 |
| 固件源码 | firmware/esp32-s3/CMakeLists.txt 与 main 构建清单 | 0.1.0-m3.1；包含网络、服务、音频和屏幕 |
| 设备现刷版本 | 历史实物验收记录为 M3.1 | 本轮未连接设备复核，不能等同本轮实测 |
| 开发预览 | Node PID 33920，监听 127.0.0.1:4318，scripts/preview.mjs | 独立预览仍在；本轮未确认后台是否在播 |
| 配置与素材 | 安装 data 与源码 data/screen-preview 均存在 config/screen/sounds/media | 两份独立数据；两边均 manual，completion.enabled=false |
| Git | HEAD dfdfb90；git log 仅一条初始化提交，git tag 无输出；审计前工作区干净 | 过去开发版本没有分别形成 Git 提交/标签 |

实际 DSH 根目录：`D:/LEASE AI Software/Deepseek Harness`。插件安装入口是其 `profiles/web/node_modules/dsh-lease-voice`，解析到 pnpm 的真实包目录；它是安装副本，不是指向当前开发源码目录的链接。WRX、pet、meme 在 DSH 中各自独立安装；VOICE 只读发现可选素材，不把这些插件合并进本仓库。

## 源码依据与功能边界

- `host/index.js` 只注入 connection/sessionQuery，注册 VOICE 路由、回复跟踪、任务、声音库和后台画面服务；不启动独立生产 HTTP 服务。
- `providers/` 包含火山、OpenAI 兼容 Speech、MiniMax TTS 适配；`core/tasks.js` 编排合成与输出；`extensions/device-audio.js` 向设备上传 PCM 并轮询播放终态。
- `core/screen-background.js`、`screen-renderer.js` 由电脑持有后台画面播放，隐藏 Edge 解码，`extensions/display.js` 转发画面。离开屏幕页继续播放不代表电脑退出后设备还能独立播放。
- `client/entry.js` 的自动朗读/完成提示依赖可见会话；页面隐藏会停止自动播放。后台动画已经实现，后台语音通知没有同等实现。
- 固件 main 构建网络和 HTTP 服务，组件包含 lease_audio/lease_display；`next/lease_network` 不在当前主构建中，不是第二套部署。
- STT、BLE、工作/空闲/完成自动切换、断网自动重连及进程重启恢复尚未完成。

## 发现与优先级

1. **高：安装来源与安装内容不一致。** 依赖声明仍指 0.1.0 包，实际文件为 0.6.0。按旧声明重建安装可能恢复旧版，或被包管理器缓存行为影响；不能将原位覆盖当作可复现发布。后续应备份完整 data，统一 0.6.0 包、profile 声明和锁文件，再做生产验收。本轮仅审计，不修改外部宿主文件。
2. **中：文档把历史阶段当成当前状态。** 根 README、插件 README 与上下文仍混有“日常版 0.2.0/尚未部署”，但日志已记录 11 月 4 日覆盖。此次修正入口与上下文，历史日志保留，旧阶段说明需结合时间阅读。
3. **中：缺少可追溯发布基线。** 本地有 0.1.0～0.6.0 tgz，但 artifacts 被 Git 忽略；Git 只有当前快照，不能靠 Git 回到各历史阶段。应分别标识软件/固件版本，发布时记录 commit、包哈希、协议版本、验收与数据迁移说明。不要给当前提交补打旧版本标签来冒充历史。
4. **中：预览与生产并存，容易混用。** 两套数据独立；preview 的 TTS 默认模拟音频，但设备输出和画面可连接真实设备。预览成功不等于 DSH 正常，复制 preview config 还可能覆盖日常 provider。应明确日常只从 DSH 进入，预览仅用于开发，避免同时占用同一设备。
5. **中：运行态验收尚缺闭环。** 没有本轮已认证生产加载证据，也未做真实 TTS、音画并发、实体听音/看屏及长期稳定测试。不能把 51 项测试当作设备完整验收。
6. **低：公开仓库不是完整运行备份。** data、语音原件、固件产物、第三方硬件资料被忽略；克隆不会恢复密钥、配对、播放列表或烧录包。应单独备份私有数据和交付物。

## 本轮验证与变更范围

- `npm.cmd test`：51 通过，0 失败，0 跳过；含本机 DSH Session/Connection 与隔离 WRX 对照。
- `npm.cmd run check`：46 个 JS/MJS 语法与插件清单检查通过。
- 固件 `check_source.py --idf-path D:/Espressif/frameworks/esp-idf-v5.3.1`：SDK 5.3.1、19 项配置名、API/组件/文档静态检查通过；不是编译或实物测试。
- 安装程序 31 文件逐字节比较无差异；未比较生产依赖全部内容，不宣称完整安装供应链校验。
- 本轮只新增报告、修正文档；未修改业务代码、宿主安装元数据、运行数据；未重启、发音、刷写或改变设备播放。

建议收口顺序：统一安装来源 → 生产运行态验收 → 固定软件 0.6.0 / 固件 M3.1 的组合基线 → 备份私有 data 与产物 → 再开发下一版本。上述部署动作本轮未执行。
