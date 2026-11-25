Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)

Set link = shell.CreateShortcut(root & "\启动同舟.lnk")
link.TargetPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe"
link.Arguments = """" & root & "\启动同舟.vbs"""
link.WorkingDirectory = root
link.IconLocation = root & "\desktop\tray.ico"
link.Description = "Tongji Hub"
link.Save

MsgBox "Shortcut created: " & root & "\启动同舟.lnk", 64, "Tongji Hub"
