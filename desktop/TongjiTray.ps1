$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Root = Split-Path -Parent $PSScriptRoot
$Base = 'http://127.0.0.1:4173'
$LogFile = Join-Path $PSScriptRoot 'TongjiTray.log'
$ToastScript = Join-Path $PSScriptRoot 'toast.ps1'

$script:syncPowerShell = $null
$script:syncAsync = $null
$script:syncTimer = $null
$script:syncItem = $null
$script:serverProcess = $null
$script:exiting = $false
$script:syncIsAuto = $false
$script:syncRetryCount = 0
$script:nodeMissing = $false
$script:retryTimer = $null
$script:retryRemaining = 0

function Write-Log([string]$Message) {
  try {
    $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $Message
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
  } catch {}
}

function Ensure-ToastIdentity {
  $helper = Join-Path $PSScriptRoot 'SetShortcutAumid.exe'
  if (-not (Test-Path $helper)) { return }

  $shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) '同舟.lnk'
  $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $startTray = Join-Path $PSScriptRoot 'start-tray.vbs'
  $icon = Join-Path $PSScriptRoot 'tray.ico'

  try {
    & $helper $shortcut $wscript ('"' + $startTray + '"') $icon 'TongjiHub.Desktop' $Root | Out-Null
  } catch {
    Write-Log ('toast identity failed: ' + $_.Exception.Message)
  }
}

function Show-Toast([string]$Title, [string]$Message) {
  Write-Log ('notify: ' + $Title + ' | ' + $Message)
  try {
    & $ToastScript -Title $Title -Message $Message
  } catch {
    Write-Log ('toast failed: ' + $_.Exception.Message)
  }
}

function Test-Health {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri ($Base + '/api/health') -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Resolve-Node {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return $null
}

function Ensure-Dependencies {
  $dependency = Join-Path $Root 'node_modules\playwright-core'
  if (Test-Path $dependency) { return $true }

  Write-Log 'dependencies missing; running npm install'
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) {
    Write-Log 'npm.cmd not found'
    return $false
  }

  try {
    $install = Start-Process -FilePath $npm.Source -ArgumentList 'install' `
      -WorkingDirectory $Root -WindowStyle Hidden -Wait -PassThru
    Write-Log ('npm install exit=' + $install.ExitCode)
  } catch {
    Write-Log ('npm install failed: ' + $_.Exception.Message)
    return $false
  }

  return (Test-Path $dependency)
}

function Show-NodeMissing {
  $script = Join-Path $PSScriptRoot 'node-missing.ps1'
  if (Test-Path $script) {
    & $script
    return
  }

  $result = [System.Windows.Forms.MessageBox]::Show(
    "未检测到 Node.js。`n`n请安装 Node.js 18 或更高版本：`nhttps://nodejs.org/zh-cn/download",
    '同舟 · 缺少 Node.js',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Warning
  )
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Start-Process 'https://nodejs.org/zh-cn/download'
  }
}

function Start-Server {
  if (Test-Health) {
    Write-Log 'server already running'
    return $true
  }

  if (-not (Resolve-Node)) {
    Write-Log 'node.exe not found'
    $script:nodeMissing = $true
    Show-NodeMissing
    return $false
  }

  $startBat = Join-Path $Root 'start.bat'
  if (Test-Path $startBat) {
    Write-Log 'starting via start.bat --tray'
    try {
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
      $psi.Arguments = "/c `"$startBat`" --tray"
      $psi.WorkingDirectory = $Root
      $psi.UseShellExecute = $false
      $psi.CreateNoWindow = $true
      $psi.WindowStyle = 'Hidden'
      [System.Diagnostics.Process]::Start($psi) | Out-Null
    } catch {
      Write-Log ('start.bat failed: ' + $_.Exception.Message)
      return $false
    }
  } else {
    $node = Resolve-Node
    if (-not $node) {
      Write-Log 'node.exe not found'
      return $false
    }
    Write-Log ('starting server with ' + $node)
    try {
      $stdout = Join-Path $PSScriptRoot 'server.out.log'
      $stderr = Join-Path $PSScriptRoot 'server.err.log'
      $script:serverProcess = Start-Process -FilePath $node -ArgumentList 'server.mjs' `
        -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    } catch {
      Write-Log ('server start failed: ' + $_.Exception.Message)
      return $false
    }
  }

  for ($i = 0; $i -lt 240; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Health) {
      Write-Log 'server started'
      return $true
    }
  }
  Write-Log 'server health timeout'
  return $false
}

function Open-Ui {
  Write-Log 'open UI'
  try {
    Start-Process -FilePath 'cmd.exe' `
      -ArgumentList '/c start "" "http://127.0.0.1:4173"' -WindowStyle Hidden
  } catch {
    Write-Log ('open UI failed: ' + $_.Exception.Message)
  }
}

function Start-Sync {
  param([bool]$IsAuto = $false)

  if ($script:syncPowerShell -or $script:retryTimer) { return }

  $script:syncIsAuto = $IsAuto
  if (-not $IsAuto) {
    $script:syncRetryCount = 0
  }

  $script:syncItem.Text = '正在同步…'
  $script:syncItem.Enabled = $false
  Write-Log ('sync start auto=' + $IsAuto)

  $script:syncPowerShell = [System.Management.Automation.PowerShell]::Create()
  $null = $script:syncPowerShell.AddScript({
    param($url)
    Invoke-RestMethod -Method Post -Uri ($url + '/api/desktop/sync') -TimeoutSec 180
  }).AddArgument($Base)
  $script:syncAsync = $script:syncPowerShell.BeginInvoke()

  $script:syncTimer.Start()
}

function Schedule-SyncRetry([string]$Reason) {
  if (-not $script:syncIsAuto) {
    $script:syncItem.Text = '立即同步作业'
    $script:syncItem.Enabled = $true
    Show-Toast '同舟 · 同步失败' $Reason
    return
  }

  if ($script:syncRetryCount -ge 3) {
    $script:syncItem.Text = '立即同步作业'
    $script:syncItem.Enabled = $true
    $script:syncIsAuto = $false
    Show-Toast '同舟 · 同步失败' ('已重试 3 次：' + $Reason)
    return
  }

  $script:syncRetryCount++
  $script:retryRemaining = 30
  $script:syncItem.Enabled = $false
  $script:syncItem.Text = "等待重试 $($script:retryRemaining)s ($($script:syncRetryCount)/3)"
  Show-Toast '同舟 · 同步失败' ("$Reason；30 秒后重试（$($script:syncRetryCount)/3）")

  $script:retryTimer = New-Object System.Windows.Forms.Timer
  $script:retryTimer.Interval = 1000
  $script:retryTimer.add_Tick({
    $script:retryRemaining--
    if ($script:retryRemaining -le 0) {
      $script:retryTimer.Stop()
      $script:retryTimer.Dispose()
      $script:retryTimer = $null
      Start-Sync -IsAuto $true
    } else {
      $script:syncItem.Text = "等待重试 $($script:retryRemaining)s ($($script:syncRetryCount)/3)"
    }
  })
  $script:retryTimer.Start()
}

function Complete-Sync {
  if (-not $script:syncAsync) { return }
  if (-not $script:syncAsync.IsCompleted) { return }

  $script:syncTimer.Stop()
  $ps = $script:syncPowerShell
  $async = $script:syncAsync
  $script:syncPowerShell = $null
  $script:syncAsync = $null
  $script:syncItem.Text = '立即同步作业'
  $script:syncItem.Enabled = $true

  try {
    $output = $ps.EndInvoke($async)
    $result = $output | Select-Object -Last 1
  } catch {
    Write-Log ('sync failed: ' + $_.Exception.Message)
    Schedule-SyncRetry $_.Exception.Message
    return
  } finally {
    try { $ps.Dispose() } catch {}
  }

  if (-not $result -or $result.ok -eq $false) {
    $message = if ($result.message) { $result.message } else { '同步失败' }
    if ($result.failures -and $result.failures.Count -gt 0) {
      $message = $message + '；' + (($result.failures | Select-Object -First 2) -join '；')
    }
    Schedule-SyncRetry $message
    return
  }

  $pending = [int]$result.pending
  if ($pending -gt 0) {
    $titles = @($result.pendingTitles | Where-Object { $_ })
    $suffix = if ($titles.Count -gt 0) { '：' + (($titles | Select-Object -First 3) -join '、') } else { '' }
    Show-Toast '同舟 · 作业提醒' ('还有 ' + $pending + ' 项作业没写' + $suffix)
  } else {
    Show-Toast '同舟 · 作业提醒' '作业都写完了'
  }

  if ($result.failures -and $result.failures.Count -gt 0) {
    Show-Toast '同舟 · 登录失败' (($result.failures | Select-Object -First 4) -join '；')
    Schedule-SyncRetry '部分平台登录失败'
    return
  }

  $script:syncRetryCount = 0
  $script:syncIsAuto = $false
  Write-Log ('sync done pending=' + $pending)
}

function Exit-App {
  $script:exiting = $true
  Write-Log 'exit'
  try { $notify.Visible = $false; $notify.Dispose() } catch {}
  try {
    if ($script:serverProcess -and -not $script:serverProcess.HasExited) {
      $script:serverProcess.Kill()
    }
  } catch {}
  try { $form.Close() } catch {}
  [System.Windows.Forms.Application]::Exit()
}

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'TongjiHub.Desktop.Tray', [ref]$created)
if (-not $created) {
  Write-Log 'another tray instance detected'
  if (-not (Test-Health)) {
    Write-Log 'existing tray has no service; starting service'
    Start-Server | Out-Null
  }
  exit
}

$form = New-Object System.Windows.Forms.Form
$form.Text = '同舟 · 校园手账'
$form.ShowInTaskbar = $false
$form.FormBorderStyle = 'None'
$form.WindowState = 'Minimized'
$form.Opacity = 0
$form.Size = New-Object System.Drawing.Size(1, 1)
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(-2000, -2000)

Ensure-ToastIdentity

$notify = New-Object System.Windows.Forms.NotifyIcon
$trayIcon = Join-Path $PSScriptRoot 'tray.ico'
if (Test-Path $trayIcon) {
  try {
    $notify.Icon = New-Object -TypeName System.Drawing.Icon -ArgumentList $trayIcon
  } catch {
    $notify.Icon = [System.Drawing.SystemIcons]::Information
  }
} else {
  $notify.Icon = [System.Drawing.SystemIcons]::Information
}
$notify.Text = '同舟 · 校园手账'
$notify.Visible = $true
Write-Log ('tray visible=' + $notify.Visible)

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menuOpen = $menu.Items.Add('打开界面')
$menuOpen.add_Click({ Open-Ui })
$script:syncItem = $menu.Items.Add('立即同步作业')
$script:syncItem.add_Click({ Start-Sync })
$menu.Items.Add('-') | Out-Null
$menuExit = $menu.Items.Add('退出')
$menuExit.add_Click({ Exit-App })
$notify.ContextMenuStrip = $menu
$notify.add_DoubleClick({ Open-Ui })

$script:syncTimer = New-Object System.Windows.Forms.Timer
$script:syncTimer.Interval = 800
$script:syncTimer.add_Tick({ Complete-Sync })

$form.add_Shown({
  $form.Hide()
  if (Start-Server) {
    Start-Sync -IsAuto $true
  } elseif (-not $script:nodeMissing) {
    Show-Toast '同舟 · 启动失败' '本地服务未能启动，请查看 desktop\server.err.log'
  }
})

$form.add_FormClosing({
  param($sender, $event)
  if (-not $script:exiting) {
    $event.Cancel = $true
    $form.Hide()
  }
})

Write-Log 'tray script start'
[System.Windows.Forms.Application]::Run($form)
