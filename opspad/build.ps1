$ErrorActionPreference = "Stop"

$vsDevCmd = "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\Tools\\VsDevCmd.bat"
if (!(Test-Path $vsDevCmd)) {
  throw "VsDevCmd.bat not found at: $vsDevCmd"
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$cmd =
  'call "' + $vsDevCmd + '" -arch=x64 -host_arch=x64' +
  ' && set PATH=%USERPROFILE%\.cargo\bin;C:\Program Files\nodejs;%APPDATA%\npm;%PATH%' +
  ' && cd /d "' + $projectRoot + '"' +
  ' && pnpm i' +
  ' && pnpm tauri build'

cmd.exe /d /s /c $cmd
