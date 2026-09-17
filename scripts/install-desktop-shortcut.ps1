# 在桌面创建“群像”快捷方式（无窗口静默启动 + 自动打开浏览器）
# 用法：powershell -ExecutionPolicy Bypass -File scripts\install-desktop-shortcut.ps1
$ErrorActionPreference = 'Stop'

$root     = Split-Path -Parent $PSScriptRoot
$vbs      = Join-Path $root 'start-hidden.vbs'
$iconPath = Join-Path $PSScriptRoot 'qunxiang.ico'

# ── 1. 生成图标（优先用 scripts\qunxiang-icon.png 源图；否则绘制圆角靛蓝底 + 白色“群”字） ──
$iconSrc = Join-Path $PSScriptRoot 'qunxiang-icon.png'
if ((-not (Test-Path $iconPath)) -and (Test-Path $iconSrc)) {
    & (Join-Path $PSScriptRoot 'build-icon-from-png.ps1') -Source $iconSrc
}
if (-not (Test-Path $iconPath)) {
    Add-Type -AssemblyName System.Drawing

    $size = 256
    $bmp  = New-Object System.Drawing.Bitmap($size, $size)
    $g    = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint  = [System.Drawing.Text.TextRenderingHint]::AntiAlias

    # 圆角矩形背景
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $inset = 8; $r = 56; $d = $r * 2
    $x = $inset; $y = $inset; $w = $size - $inset * 2; $h = $size - $inset * 2
    $gp.AddArc($x, $y, $d, $d, 180, 90)
    $gp.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $gp.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $gp.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $gp.CloseFigure()
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(79, 70, 229))
    $g.FillPath($brush, $gp)

    # 居中“群”字
    $font = New-Object System.Drawing.Font('Microsoft YaHei', 138, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf   = New-Object System.Drawing.StringFormat
    $sf.Alignment     = 'Center'
    $sf.LineAlignment = 'Center'
    $g.DrawString('群', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, 0, $size, $size)), $sf)

    $pngPath = Join-Path $env:TEMP 'qunxiang-icon.png'
    $bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $font.Dispose(); $brush.Dispose(); $gp.Dispose()

    # 把 PNG 包成 ICO 容器（Vista+ 支持 PNG 压缩图标）
    $png = [System.IO.File]::ReadAllBytes($pngPath)
    $fs  = [System.IO.File]::Create($iconPath)
    $bw  = New-Object System.IO.BinaryWriter($fs)
    $bw.Write([uint16]0)            # 保留
    $bw.Write([uint16]1)            # 类型：图标
    $bw.Write([uint16]1)            # 图片数量
    $bw.Write([byte]0)              # 宽（0 表示 256）
    $bw.Write([byte]0)              # 高
    $bw.Write([byte]0)              # 调色板
    $bw.Write([byte]0)              # 保留
    $bw.Write([uint16]1)            # 色平面
    $bw.Write([uint16]32)           # 位深
    $bw.Write([uint32]$png.Length)  # 数据大小
    $bw.Write([uint32]22)           # 数据偏移（6 + 16）
    $bw.Write($png)
    $bw.Close(); $fs.Close()
    Remove-Item $pngPath -ErrorAction SilentlyContinue
    Write-Host "已生成图标：$iconPath"
} else {
    Write-Host "图标已存在，跳过生成：$iconPath"
}

# ── 2. 创建桌面快捷方式 ──
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop '群像.lnk'
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnkPath)
$sc.TargetPath       = Join-Path $env:SystemRoot 'System32\wscript.exe'
$sc.Arguments        = "`"$vbs`""
$sc.WorkingDirectory = $root
$sc.IconLocation     = $iconPath
$sc.Description      = '群像 - 小说 IP 资产审核与交付工作台'
$sc.WindowStyle      = 1
$sc.Save()

Write-Host "已创建桌面快捷方式：$lnkPath"
Write-Host '双击即可静默启动群像并打开浏览器；停止服务请运行项目目录下的 stop.bat。'
