Add-Type -AssemblyName System.Windows.Forms

$message = "未检测到 Node.js。`n`n同舟需要 Node.js 18 或更高版本。`n`n点击是打开下载页面：`nhttps://nodejs.org/zh-cn/download"
$result = [System.Windows.Forms.MessageBox]::Show(
  $message,
  '同舟 · 缺少 Node.js',
  [System.Windows.Forms.MessageBoxButtons]::YesNo,
  [System.Windows.Forms.MessageBoxIcon]::Warning
)

if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {
  Start-Process 'https://nodejs.org/zh-cn/download'
}
