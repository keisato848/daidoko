# 実機スクリーンショット取得＋縮小（Claude の Read はおよそ 2000px 超を拒否するため）。
# 使い方: pwsh scripts/agent/device-shot.ps1 [-Out C:\tmp\s_small.png] [-Width 540]
# 出力: 縮小 PNG のパスを標準出力に表示。ロック画面等で空キャプチャなら exit 1。
param(
  [string]$Out = "C:\tmp\s_small.png",
  [int]$Width = 540,
  [string]$Raw = "C:\tmp\s.png"
)

$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) { $adb = "adb" }

& $adb exec-out screencap -p > $Raw
if (-not (Test-Path $Raw) -or (Get-Item $Raw).Length -lt 1000) {
  Write-Output "EMPTY_SCREENSHOT: 画面ロック中の可能性。ユーザーにロック解除を依頼してください。"
  exit 1
}

Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($Raw)
try {
  $h = [int]($img.Height * $Width / $img.Width)
  $bmp = New-Object System.Drawing.Bitmap $Width, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.DrawImage($img, 0, 0, $Width, $h)
  $bmp.Save($Out)
  $g.Dispose(); $bmp.Dispose()
} finally {
  $img.Dispose()
}

Write-Output $Out
