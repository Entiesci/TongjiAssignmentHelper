$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup '同舟.lnk'

if (Test-Path $shortcutPath) {
  Remove-Item $shortcutPath -Force
  Write-Host '已取消开机启动'
} else {
  Write-Host '没有找到开机启动快捷方式'
}
