# Wi-Fi 基础模块草稿（M1，未编译、未实测）

此目录不在 components/ 下，M0 顶层只构建 main，staging 与 source.zip 也不复制 next/。M0 不引用或调用这里的代码，仍可单独交付。此模块没有可交付镜像，不能标记 M1 完成。

当前草稿提供一次性启动接口与状态快照：

- `lease_network_start(NULL, NULL)`：尝试读取 IDF 默认 NVS 保存的 station 配置；没有 SSID 则进入 NEEDS_CONFIG，不启动连接。
- `lease_network_start(ssid, password)`：在运行时接收并复制凭据，交给 Wi-Fi 驱动保存；支持1..32字节SSID、空密码开放网络或8..63字节个人网络密码。不提供真实凭据示例，不把密码写入源码、构建配置或日志。
- 独立任务初始化 NVS、netif、Wi-Fi，监听拿到IP/断连事件；状态包括 STARTING/CONNECTING/CONNECTED/RETRY_WAIT/NEEDS_CONFIG/FAILED。start 返回ESP_OK只表示任务创建成功。
- 断连后按1、2、4、8、16、30秒间隔重试，之后上限30秒；已获取IP并持续60秒后发生的断连重置间隔。IP在断连时清零；快照不含SSID和密码。
- 遇到NVS空间/版本错误直接报告，不自动擦除默认NVS。保存依赖驱动自身NVS，当前未启用存储加密，不承诺凭据静态加密。

生命周期约定：未来M1主程序必须在其他网络使用者之前调用一次；不会接管现有Wi-Fi实例。不提供运行时改网、停止/反初始化或重新启动，失败后由联调侧安排重启。任务退出会尽量释放自己的Wi-Fi/handler/netif；默认事件循环和event group保留到本次上电结束。默认netif创建底层可能触发IDF断言，必须在集成时确认所有权。

尚缺：本地凭据输入入口（不能编译进镜像）、显式改网/清除、停止/恢复、DHCP超时和仅丢IP时的恢复、断连原因细分、BLE配网、配对Token、HTTP调试、音频。状态机与回退间隔未经实机或模拟验证。当前不是完整M1，也不声明提供普通蓝牙音箱能力。

集成方式仅供后续开发：创建独立M1版本/profile，显式加入此目录到EXTRA_COMPONENT_DIRS，由M1的main添加REQUIRES lease_network，并接入本地配置入口。不要修改M0版本标签或让M0自动启用网络。集成前需先编译模块、完善生命周期与DHCP恢复，再由联调侧验证正确密码/错误密码/无配置/重启恢复/路由器离线重连/NVS错误不擦除及日志无密码；未通过前不交付。
