param(
  [string]$Title = '同舟',
  [string]$Message = ''
)

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] | Out-Null

$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
  [Windows.UI.Notifications.ToastTemplateType]::ToastText02
)

$textNodes = $template.GetElementsByTagName('text')
$textNodes.Item(0).AppendChild($template.CreateTextNode($Title)) | Out-Null
$textNodes.Item(1).AppendChild($template.CreateTextNode($Message)) | Out-Null

$toastNode = [Windows.Data.Xml.Dom.XmlElement]$template.DocumentElement
$toastNode.SetAttribute('launch', 'http://127.0.0.1:4173/#/homework')
$toastNode.SetAttribute('activationType', 'protocol')

$actions = $template.CreateElement('actions')
$action = $template.CreateElement('action')
$action.SetAttribute('content', '打开作业页')
$action.SetAttribute('activationType', 'protocol')
$action.SetAttribute('arguments', 'http://127.0.0.1:4173/#/homework')
$actions.AppendChild($action) | Out-Null
$toastNode.AppendChild($actions) | Out-Null

$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('TongjiHub.Desktop').Show($toast)
