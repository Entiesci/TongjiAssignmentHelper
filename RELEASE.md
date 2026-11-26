# 发布规则

## 什么时候生成

**只有用户明确说要生成时才生成。** 平时改代码、改文档都不要顺手打包。

## 生成什么

只生成安装程序：

```text
releases\tongji-hub-setup-ver.x.xx.exe
```

不再生成 zip 包。安装程序本身就是自动更新的更新包（带 `--extract` 静默解包模式）。

## 每次生成都要升版本号

生成安装程序时，同步修改这些地方的版本号：

1. `assets/app.js` 的 `APP_VERSION`
2. `index.html` 里 `#currentVersion`
3. `version.json`（`version`、`url`、`notes`）
4. `package.json` / `package-lock.json` 的 `version`（写成 `x.xx.0`）
5. `installer/Setup.cs` 的 `AppVersion`
6. `README.md` 的当前版本
7. `web/index.html` 的版本号和下载直链
8. `web/README.md` 里的版本说明

版本号规则：功能更新升 `ver.0.xx`，纯补丁不单独升版本。

## 怎么生成

```powershell
powershell -ExecutionPolicy Bypass -File installer\build.ps1
```

脚本会把应用文件打成 `payload.zip` 作为资源嵌进 exe，然后编译出安装程序。`payload.zip` 只是中间产物，会被自动删除，不进入 `releases/`。

## 自动更新怎么用这个 exe

1. 应用读取 `version.json` 拿到安装程序地址
2. 下载到 `.data\update\payload.bin`
3. 识别到 `MZ` 头，就用 `--extract` 静默解包到 `.data\update\stage`
4. `desktop\apply-update.mjs` 覆盖程序文件并重启
