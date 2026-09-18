# 快捷方式启动引导（由 start-hidden.vbs 调用，不要直接双击运行）
# 以可见窗口运行 start.bat --silent：启动进度实时可见，API 后端会弹出独立窗口
$root = Split-Path -Parent $PSScriptRoot
$bat  = Join-Path $root 'start.bat'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$bat`" --silent" -WorkingDirectory $root
