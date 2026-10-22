# Lee en voz alta un paso de la guia (CodeTour).
# Uso:  hablar.ps1 <numero-de-tour> <numero-de-paso>
#       hablar.ps1 parar
param(
  [string]$Tour,
  [int]$Paso = 1
)

$ErrorActionPreference = 'Stop'

$carpeta = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $env:TEMP 'localsend-guia-voz.pid'
$txtFile = Join-Path $env:TEMP 'localsend-guia-voz.txt'

# Si ya habia un audio sonando, lo cortamos.
if (Test-Path $pidFile) {
  $anterior = Get-Content $pidFile
  Stop-Process -Id $anterior -ErrorAction SilentlyContinue
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}

if ($Tour -eq 'parar') {
  Write-Host 'Audio detenido.'
  return
}

$archivo = Get-ChildItem $carpeta -Filter "$Tour*.tour" | Select-Object -First 1
if (-not $archivo) {
  Write-Host "No encontre el tour $Tour"
  return
}

$json = Get-Content $archivo.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
$step = $json.steps[$Paso - 1]
$texto = "$($step.title). $($step.description)"

# Limpiamos el Markdown para que se lea natural.
$texto = $texto -replace '(?s)```.*?```', ' '
$texto = $texto -replace '(?m)^>>.*$', ' '
$texto = $texto -replace '(?m)^\s*\|?[\s:\-\|]+\|?\s*$', ' '
$texto = $texto -replace '\[([^\]]+)\]\([^\)]+\)', '$1'
$texto = $texto -replace '(?m)^\s*---+\s*$', ' '
$texto = $texto -replace '[\uD800-\uDFFF]', ''
$texto = $texto -replace '[\u2600-\u27BF\u2B00-\u2BFF\uFE0F]', ''
$texto = $texto -replace '\bL(\d+)\s*[\u2013-]\s*(\d+)', 'lineas $1 a $2'
$texto = $texto -replace '\bL(\d+)', 'linea $1'
$texto = $texto -replace '\{\.\.\.\}|\(\.\.\.\)|\.\.\.', ' '
$texto = $texto -replace '\u2192', ', '
$texto = $texto -replace '!==', ' distinto de '
$texto = $texto -replace '===', ' igual a '
$texto = $texto -replace '=>', ' '
$texto = $texto -replace '\|', ', '
$texto = $texto -replace '[`*#>]', ''
$texto = $texto -replace '_', ' '
$texto = $texto -replace '(?m)^\s*-\s+', '. '
$texto = $texto -replace '\s+', ' '

[IO.File]::WriteAllText($txtFile, $texto, [Text.Encoding]::UTF8)

# Hablamos en otro proceso para no bloquear la terminal
# y poder cortarlo con "parar" o al pedir otro paso.
$script = @"
Add-Type -AssemblyName System.Speech
`$voz = New-Object System.Speech.Synthesis.SpeechSynthesizer
`$es = `$voz.GetInstalledVoices() | Where-Object { `$_.Enabled -and `$_.VoiceInfo.Culture.Name -like 'es*' }
`$elegida = (`$es | Where-Object { `$_.VoiceInfo.Name -like '*Desktop*' } | Select-Object -First 1)
if (-not `$elegida) { `$elegida = `$es | Select-Object -First 1 }
if (`$elegida) { `$voz.SelectVoice(`$elegida.VoiceInfo.Name) }
`$voz.Rate = 0
`$voz.Speak([IO.File]::ReadAllText('$txtFile', [Text.Encoding]::UTF8))
"@

$proceso = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList @(
  '-NoProfile',
  '-Command',
  $script
)

Set-Content $pidFile $proceso.Id
Write-Host "Reproduciendo: $($step.title)  (para cortarlo: hablar.ps1 parar)"
