# Builds the signed Play bundle android/app-release-bundle.aab for the BodyArcade Trusted Web Activity (Windows / PowerShell).
# Prerequisites (one time): JDK 17 + Android SDK 36 registered in ~/.bubblewrap/config.json, Bubblewrap CLI (npm i @bubblewrap/cli),
# and the upload keystore + keystore.properties in the secrets folder. Passwords are read from there and never printed.
#   powershell -File android\build.ps1 [-Update]     (-Update regenerates the Android project from twa-manifest.json first)
param([switch]$Update)
$ErrorActionPreference = 'Stop'
# The agent shell sets this to 1, which makes "gradlew.bat" unfindable for Bubblewrap.
Remove-Item Env:NoDefaultCurrentDirectoryInExePath -ErrorAction SilentlyContinue
$sec = if ($env:BODYARCADE_SECRETS) { $env:BODYARCADE_SECRETS } else { Join-Path $env:USERPROFILE '.claude\skills\store-deploy\secrets\bodyarcade' }
$props = @{}
Get-Content (Join-Path $sec 'keystore.properties') | Where-Object { $_ -match '^[A-Za-z]+=' } | ForEach-Object { $k, $v = $_ -split '=', 2; $props[$k] = $v }
$env:BUBBLEWRAP_KEYSTORE_PASSWORD = $props['storePassword']
$env:BUBBLEWRAP_KEY_PASSWORD = $props['keyPassword']
$cfg = Get-Content (Join-Path $env:USERPROFILE '.bubblewrap\config.json') | ConvertFrom-Json
$env:JAVA_HOME = $cfg.jdkPath
# Bubblewrap signs the bundle by running "jarsigner" from the PATH.
$env:PATH = (Join-Path $cfg.jdkPath 'bin') + ';' + $env:PATH
$bw = if ($env:BUBBLEWRAP_JS) { $env:BUBBLEWRAP_JS } else { Join-Path $env:USERPROFILE 'apps\_tools\bubblewrap\node_modules\@bubblewrap\cli\bin\bubblewrap.js' }
Set-Location $PSScriptRoot
if ($Update) { 'y' | & node $bw update --skipVersionUpgrade --manifest=./twa-manifest.json }
# When a step fails Bubblewrap prints the whole jarsigner command, passwords included: every line goes through a filter that hides them.
$hide = { param($line) $s = "$line"; foreach ($p in @($props['storePassword'], $props['keyPassword'])) { if ($p) { $s = $s.Replace($p, '********') } }; $s }
$ErrorActionPreference = 'Continue'
& node $bw build --skipPwaValidation --manifest=./twa-manifest.json 2>&1 | ForEach-Object { & $hide $_ }
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($code -ne 0) { throw "bubblewrap build failed ($code)" }
Get-Item .\app-release-bundle.aab | Select-Object Name, Length, LastWriteTime
