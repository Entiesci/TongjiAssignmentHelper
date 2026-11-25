Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
startup = shell.SpecialFolders("Startup")
linkPath = fso.BuildPath(startup, "TongjiHub.lnk")

If fso.FileExists(linkPath) Then
  answer = MsgBox("Tongji Hub startup is already enabled." & vbCrLf & vbCrLf & "Disable it?", vbYesNo + vbQuestion, "Tongji Hub")
  If answer = vbYes Then
    fso.DeleteFile linkPath, True
    MsgBox "Startup disabled.", vbInformation, "Tongji Hub"
  End If
Else
  Set link = shell.CreateShortcut(linkPath)
  link.TargetPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe"
  link.Arguments = """" & fso.BuildPath(root, "desktop\start-tray.vbs") & """"
  link.WorkingDirectory = root
  link.IconLocation = fso.BuildPath(root, "desktop\tray.ico")
  link.Description = "Tongji Hub"
  link.Save
  MsgBox "Startup enabled. Tongji Hub will start at login.", vbInformation, "Tongji Hub"
End If
