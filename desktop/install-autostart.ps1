$root = Split-Path -Parent $PSScriptRoot
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup '同舟.lnk'
$trayScript = Join-Path $root 'desktop\start-tray.vbs'
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $wscript
$shortcut.Arguments = '"' + $trayScript + '"'
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = (Join-Path $root 'desktop\tray.ico')
$shortcut.Description = '同舟 · 校园手账后台服务'
$shortcut.Save()

Write-Host "已创建开机启动快捷方式：$shortcutPath"
