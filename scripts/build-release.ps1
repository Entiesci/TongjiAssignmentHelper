# Build the portable zip release. Keep this file ASCII-only.
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Version = (Get-Content (Join-Path $Root 'version.json') -Raw | ConvertFrom-Json).version
$Stage = Join-Path $Root 'releases\.stage'
$Out = Join-Path $Root "releases\tongji-hub-desktop-$Version.zip"

foreach ($p in @($Stage, $Out)) {
  if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}

New-Item -ItemType Directory -Force -Path (Join-Path $Stage 'assets') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage 'desktop') | Out-Null

$files = @(
  'index.html', 'README.md', 'PROMO.md', 'version.json', 'package.json', 'package-lock.json',
  'server.mjs', 'scrapers.mjs', 'auth-browser.mjs', 'start.bat', 'start.sh',
  'import-timetable.mjs', 'import-ketangpai.mjs', 'import-educoder.mjs', 'refresh-timetable.mjs',
  '.gitignore'
)
foreach ($f in $files) { Copy-Item (Join-Path $Root $f) -Destination $Stage -Force }

Get-ChildItem -LiteralPath $Root -Filter '*.vbs' -File | ForEach-Object {
  Copy-Item $_.FullName -Destination $Stage -Force
}

Copy-Item (Join-Path $Root 'assets\*') -Destination (Join-Path $Stage 'assets') -Recurse -Force

$desktopFiles = @(
  'README.md', 'TongjiTray.ps1', 'toast.ps1', 'node-missing.ps1',
  'start-tray.bat', 'start-tray.vbs', 'run-server.vbs', 'apply-update.mjs',
  'install-autostart.bat', 'install-autostart.ps1',
  'uninstall-autostart.bat', 'uninstall-autostart.ps1',
  'open-ui.bat', 'tray.ico', 'tray.png',
  'SetShortcutAumid.exe', 'SetShortcutAumid.cs'
)
foreach ($f in $desktopFiles) {
  Copy-Item (Join-Path $Root "desktop\$f") -Destination (Join-Path $Stage 'desktop') -Force
}

Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $Out -Force
Remove-Item $Stage -Recurse -Force

Get-Item $Out | Select-Object FullName, @{n = 'SizeMB'; e = { [math]::Round($_.Length / 1MB, 2) } }
