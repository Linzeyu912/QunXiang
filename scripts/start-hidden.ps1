# 静默启动引导（由 start-hidden.vbs 调用，不要直接双击运行）
# 以隐藏窗口运行 start.bat --silent，输出写入 logs\startup.log
$root   = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$bat = Join-Path $root 'start.bat'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$bat`" --silent" `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'startup.log') `
    -RedirectStandardError  (Join-Path $logDir 'startup.err.log')
