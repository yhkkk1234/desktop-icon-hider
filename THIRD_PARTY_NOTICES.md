# 第三方组件与许可 / Third-Party Notices

本应用（Desktop Icon Hider）自身以 MIT 许可发布（见 [LICENSE](LICENSE)）。
下面列出**随发行包一起分发**的第三方组件及其许可。构建脚本会把这些组件下载到
`native/hardware/`，再由 electron-builder 通过 `extraResources` 打进安装包。

## 随二进制分发

### LibreHardwareMonitorLib 0.9.4

- 用途：读取真实硬件传感器（CPU/GPU 温度、风扇转速、显存占用）
- 许可：**MPL-2.0**（Mozilla Public License 2.0）
- 上游：<https://github.com/LibreHardwareMonitor/LibreHardwareMonitor>
- 来源：NuGet 包 `LibreHardwareMonitorLib` 0.9.4，nuspec 声明 `<license type="expression">MPL-2.0</license>`
- 对应上游提交：`b8077435b898d57539956388cddf49f7dacb86f7`（取自该 NuGet 包 nuspec 的 `repository` 字段）
- 许可全文：<https://www.mozilla.org/en-US/MPL/2.0/>
- 修改情况：**未修改**。构建脚本从 NuGet 包中原样复制 `lib/net472/LibreHardwareMonitorLib.dll`，
  不打补丁、不重新编译。因此按 MPL-2.0 的要求，其源码可从上述上游地址与提交取得。

### HidSharp 2.1.0

- 用途：LibreHardwareMonitorLib 的传递依赖（USB HID 访问）
- 许可：**Apache-2.0**（Apache License 2.0）
- 版权：Copyright 2010-2019 James Bellinger
- 上游：<http://www.zer7.com/software/hidsharp>
- 来源：NuGet 包 `HidSharp` 2.1.0。该版本 2.0 的发布说明中明确写明
  “HIDSharp now uses the Apache open-source license”，nuspec 的 `licenseUrl` 指向
  <http://www.zer7.com/files/oss/hidsharp/LICENSE.txt>
- 许可全文：<https://www.apache.org/licenses/LICENSE-2.0>
- 修改情况：**未修改**（从 NuGet 包原样复制 `lib/net35/HidSharp.dll`）

## 经 npm 依赖分发

以下组件随 `node_modules` 一同打包进 `app.asar`，各自保留其原始许可（均可自由再分发）：

| 组件 | 许可 | 用途 |
|---|---|---|
| [Electron](https://github.com/electron/electron) / Chromium | MIT / BSD-3-Clause 等 | 应用运行时 |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | MIT | 只读 opencode / ZCode 会话库 |
| [electron-store](https://github.com/sindresorhus/electron-store) | MIT | 配置持久化 |

Electron 自身的许可全文由官方发行包提供，随应用一起分发在安装目录下：
`LICENSE.electron.txt` 与 `LICENSES.chromium.html`。

## 维护须知

- 升级 `build-native.ps1` 中 `Get-NugetLib` 的包版本时，**必须同步更新本文件**里的
  版本号、许可与上游提交号（提交号可从 `https://api.nuget.org/v3-flatcontainer/<包名小写>/<版本>/<包名小写>.nuspec`
  查到）。
- MPL-2.0 是文件级 copyleft：允许以二进制形式分发，但必须保留许可声明，并让接收者能够
  获得对应源码。上面对每个 MPL 组件都给出了上游地址与确切提交，正是为满足这一点；
  若将来对 DLL 打了补丁或重新编译，则必须一并提供修改后的源码。
