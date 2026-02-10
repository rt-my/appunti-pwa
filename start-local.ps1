param(
  [int]$Port = 5173
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$Port/")
$listener.Start()

Write-Host "Server avviato su http://localhost:$Port"
Write-Host "Per telefono usa: http://<IP-PC>:$Port"
Write-Host "Premi Ctrl+C per fermare"

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js' = 'application/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.svg' = 'image/svg+xml'
  '.png' = 'image/png'
  '.ico' = 'image/x-icon'
}

while ($listener.IsListening) {
  try {
    $context = $listener.GetContext()
    $requestPath = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = 'index.html' }

    $filePath = Join-Path $root $requestPath
    if ((Test-Path $filePath) -and -not (Get-Item $filePath).PSIsContainer) {
      $ext = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
      $bytes = [IO.File]::ReadAllBytes($filePath)
      $context.Response.StatusCode = 200
      $context.Response.ContentType = $mime[$ext]
      if (-not $context.Response.ContentType) { $context.Response.ContentType = 'application/octet-stream' }
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $context.Response.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch {
  } finally {
    if ($context -and $context.Response) {
      $context.Response.OutputStream.Close()
      $context.Response.Close()
    }
  }
}
