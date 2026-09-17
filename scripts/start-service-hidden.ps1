# 以隐藏窗口启动 pnpm dev，并把输出写入日志、进程 PID 写入 .pid 文件（供 stop.bat 停止）
# 由 start.bat --silent 调用；不要直接双击运行。
param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][string]$WorkDir,
    [Parameter(Mandatory=$true)][string]$LogDir
)

$outLog  = Join-Path $LogDir "$Name.log"
$errLog  = Join-Path $LogDir "$Name.err.log"
$pidFile = Join-Path $LogDir "$Name.pid"

$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'pnpm dev' `
    -WorkingDirectory $WorkDir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog

[System.IO.File]::WriteAllText($pidFile, $p.Id)
