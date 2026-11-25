Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
desktopDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(desktopDir)
shell.CurrentDirectory = rootDir
shell.Run "node server.mjs", 0, False
