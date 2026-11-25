# 同舟 · 桌面托盘版

不依赖 Electron。界面仍然在浏览器里打开，后台是一个 PowerShell 托盘宿主。

## 运行

如果本机没有安装 Node.js，启动时会弹出提示框，并给出 Node.js 下载链接。

先安装依赖：

```bat
cd TongjiAssignmentHelper
npm install
```

然后双击：

```bat
desktop\start-tray.bat
```

或者直接运行：

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\TongjiTray.ps1
```

它会：

- 隐藏启动本地 Node 服务
- 在系统托盘显示图标
- 自动同步所有已登录平台的作业
- 同步完成后发 Windows 通知

启动后不会出现任何窗口，直接在系统托盘运行。

托盘启动时会执行 `start.bat --tray`：由 `start.bat` 检查依赖、必要时自动 `npm install`，然后通过 `desktop\run-server.vbs` 隐藏启动本地服务，不会出现 PowerShell 窗口。服务就绪后自动同步一次；如果失败，会等待 30 秒后重试，最多重试 3 次。等待期间托盘菜单会显示倒计时。

启动入口是 `start-tray.bat` → `start-tray.vbs`，不会出现 PowerShell 控制台窗口。不要直接双击 `TongjiTray.ps1`，那样会打开一个 PowerShell 窗口。

如果双击 `start-tray.bat` 出现 Windows 的「无法验证发布者」安全警告，这是系统对批处理文件的提示，不是程序错误。可以直接双击项目根目录的 `启动同舟.vbs`，或者双击 `desktop\start-tray.vbs`，都不会经过 `.bat` 的这层警告。

`启动同舟.vbs` 是按自身位置计算项目路径的，整个文件夹移动到别处也能用。想要开机自动启动，双击根目录的 `设置开机启动.vbs`；再次运行可以取消。

右键托盘图标：

- **打开界面**：用默认浏览器打开 `http://127.0.0.1:4173`
- **立即同步作业**：手动再同步一次
- **退出**：停止后台服务并退出

托盘点「立即同步作业」时，浏览器里的「同步作业」按钮也会同步显示「正在同步」并暂时禁用；同步结束后自动恢复并刷新作业。

## 找到图标

Windows 11 默认会把新托盘图标放进右下角的**隐藏图标区**，点任务栏右下角的 `^` 才能看到图标。想让它一直显示，可以把图标拖到任务栏，或到「设置 → 个性化 → 任务栏 → 其他系统托盘图标」里把「同舟」打开。

如果托盘图标始终不出现，可以直接双击 `desktop\open-ui.bat` 打开界面；后台服务仍在运行。

## 通知

同步完成会发两类通知：

- 还有 N 项作业没写
- 某些平台登录失败

点击通知本身或通知里的「打开作业页」按钮，会打开：

```text
http://127.0.0.1:4173/#/homework
```

通知会进入 Windows 操作中心。如果没有弹出横幅，检查：

1. Windows 设置 → 系统 → 通知 → 通知是否开启
2. **请勿打扰 / 专注助手是否开启**
3. 是否允许通知横幅

Windows 11 开启“请勿打扰”时，通知只会进入操作中心，不会弹横幅。

## 开机启动

双击：

```bat
desktop\install-autostart.bat
```

取消：

```bat
desktop\uninstall-autostart.bat
```

## 日志

```text
desktop\TongjiTray.log
```

## 说明

- 需要本机安装 Node.js 和 Edge
- 浏览器关闭后托盘和本地服务继续运行
- 首次启动自动同步可能需要 10–60 秒
- 数据仍保存在项目目录的 `.data`
- 托盘宿主是 PowerShell + WinForms，不是 Electron
