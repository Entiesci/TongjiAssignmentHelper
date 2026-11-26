# Build the Tongji Hub installer: pack app files into payload.zip and embed it in one exe.
# Keep this file ASCII-only so it does not depend on the script encoding.
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Version = (Get-Content (Join-Path $Root 'version.json') -Raw | ConvertFrom-Json).version
$Stage = Join-Path $Root 'installer\.stage'
$Payload = Join-Path $Root 'installer\payload.zip'
$Logo = Join-Path $Root 'installer\logo.png'
$Out = Join-Path $Root "releases\tongji-hub-setup-$Version.exe"
$Csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

foreach ($p in @($Stage, $Payload, $Out)) {
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

# Root-level .vbs launchers have non-ASCII names; copy them by pattern.
Get-ChildItem -LiteralPath $Root -Filter '*.vbs' -File | ForEach-Object {
  Copy-Item $_.FullName -Destination $Stage -Force
}

Copy-Item (Join-Path $Root 'assets\*') -Destination (Join-Path $Stage 'assets') -Recurse -Force

$desktopFiles = @(
  'README.md', 'TongjiTray.ps1', 'toast.ps1', 'node-missing.ps1',
  'start-tray.bat', 'start-tray.vbs', 'run-server.vbs',
  'install-autostart.bat', 'install-autostart.ps1',
  'uninstall-autostart.bat', 'uninstall-autostart.ps1',
  'open-ui.bat', 'tray.ico', 'tray.png',
  'SetShortcutAumid.exe', 'SetShortcutAumid.cs'
)
foreach ($f in $desktopFiles) {
  Copy-Item (Join-Path $Root "desktop\$f") -Destination (Join-Path $Stage 'desktop') -Force
}

Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $Payload -Force
Copy-Item (Join-Path $Root 'desktop\tray.png') -Destination $Logo -Force

& $Csc /nologo /target:winexe /codepage:65001 /optimize+ `
  "/out:$Out" `
  "/win32icon:$(Join-Path $Root 'desktop\tray.ico')" `
  /reference:System.dll `
  /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll `
  /reference:System.IO.Compression.dll `
  /reference:System.IO.Compression.FileSystem.dll `
  "/resource:$Payload,TongjiHub.Payload" `
  "/resource:$Logo,TongjiHub.Logo" `
  (Join-Path $Root 'installer\Setup.cs')

if ($LASTEXITCODE -ne 0) { throw "compile failed: $LASTEXITCODE" }

Remove-Item $Stage -Recurse -Force
Remove-Item $Payload -Force
Remove-Item $Logo -Force

Get-Item $Out | Select-Object FullName, @{n = 'SizeMB'; e = { [math]::Round($_.Length / 1MB, 2) } }
