param([string]$Path)
$b = [IO.File]::ReadAllBytes($Path)
$t = [IO.File]::ReadAllText($Path)
$hasBom = ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
$crlf = [regex]::Matches($t, "`r`n").Count
$loneLf = [regex]::Matches($t, "(?<!`r)`n").Count
$loneCr = [regex]::Matches($t, "`r(?!`n)").Count
Write-Output ("{0}: BOM={1} CRLF={2} 孤立LF={3} 孤立CR={4}" -f $Path, $hasBom, $crlf, $loneLf, $loneCr)
