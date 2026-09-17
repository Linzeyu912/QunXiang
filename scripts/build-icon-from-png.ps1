# 把群像图标源图处理成 ICO：裁掉白边和阴影 → 圆角蒙版 → 256x256 PNG → 包成 ICO
# 用法：powershell -ExecutionPolicy Bypass -File scripts\build-icon-from-png.ps1 [源图路径]
param(
    [string]$Source = (Join-Path $PSScriptRoot 'qunxiang-icon.png')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$iconPath = Join-Path $PSScriptRoot 'qunxiang.ico'
$src = [System.Drawing.Bitmap]::FromFile($Source)

# 源图是 1254x1254：圆角贴片居中，四周有白边和下右方向的投影。
# 贴片真实边缘约在 left=115/top=110（投影造成的亮度凹陷之后），统一内缩到安全区。
$cropSize = 1000
$cropX = [int](($src.Width - $cropSize) / 2)    # 127
$cropY = [int](($src.Height - $cropSize) / 2)   # 127
$cropRect = New-Object System.Drawing.Rectangle($cropX, $cropY, $cropSize, $cropSize)

$size = 256
$out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($out)
$g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

# 圆角蒙版：半径约为贴片的 22%（与源图圆角一致，略收 1px 防止边缘白线）
$gp = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 56; $d = $r * 2
$gp.AddArc(0, 0, $d, $d, 180, 90)
$gp.AddArc($size - $d, 0, $d, $d, 270, 90)
$gp.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
$gp.AddArc(0, $size - $d, $d, $d, 90, 90)
$gp.CloseFigure()
$g.SetClip($gp)
$g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)), $cropRect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose(); $src.Dispose(); $gp.Dispose()

# PNG 打包成 ICO 容器
$pngPath = Join-Path $env:TEMP 'qunxiang-icon-new.png'
$out.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$out.Dispose()
$png = [System.IO.File]::ReadAllBytes($pngPath)
$fs  = [System.IO.File]::Create($iconPath)
$bw  = New-Object System.IO.BinaryWriter($fs)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]1)
$bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0)
$bw.Write([uint16]1); $bw.Write([uint16]32)
$bw.Write([uint32]$png.Length); $bw.Write([uint32]22)
$bw.Write($png)
$bw.Close(); $fs.Close()
Remove-Item $pngPath -ErrorAction SilentlyContinue
Write-Host "已生成图标：$iconPath（$($png.Length) 字节 PNG 负载）"
