' sunsNoteBook silent launcher for Windows.
' Starts the notebook server with NO console window, then opens the browser.
' Double-click start-windows.vbs directly, or use start-windows.bat (it calls this file).
Option Explicit
Dim sh, fso, dir, node, port, envPort
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
node = dir & "\runtime\win-x64\node.exe"
If Not fso.FileExists(node) Then node = "node"
port = "4173"
envPort = sh.ExpandEnvironmentStrings("%PORT%")
If envPort <> "" And envPort <> "%PORT%" Then port = envPort
' 0 = hidden window, False = do not wait
sh.Run """" & node & """ """ & dir & "\server.js""", 0, False
WScript.Sleep 1500
sh.Run "http://localhost:" & port
