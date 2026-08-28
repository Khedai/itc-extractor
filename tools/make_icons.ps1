# Regenerates the PWA launcher icons (icons/icon-192.png, icons/icon-512.png).
# Style: navy (#102A5C) background, white "ITC" monogram, red (#C21F2F) accent bar.
# Replace icons/icon-192.png and icons/icon-512.png with your own artwork to override.
Add-Type -AssemblyName System.Drawing

function New-Icon {
  param([int]$Size, [string]$OutPath)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  # Navy background
  $g.Clear([System.Drawing.Color]::FromArgb(16, 42, 92))

  # "ITC" monogram
  $fontSize = [int]($Size * 0.40)
  $font = New-Object System.Drawing.Font('Arial', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, [int](-$Size * 0.10), $Size, $Size)
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.DrawString('ITC', $font, $white, $rect, $sf)

  # Red accent bar beneath the monogram
  $barW = [int]($Size * 0.44)
  $barH = [int]($Size * 0.04)
  $barX = [int](($Size - $barW) / 2)
  $barY = [int]($Size * 0.60)
  $red = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(194, 31, 47))
  $g.FillRectangle($red, $barX, $barY, $barW, $barH)

  $g.Dispose()
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "Wrote $OutPath ($Size x $Size)"
}

$root = Split-Path -Parent $PSScriptRoot
New-Icon 512 (Join-Path $root 'icons\icon-512.png')
New-Icon 192 (Join-Path $root 'icons\icon-192.png')
