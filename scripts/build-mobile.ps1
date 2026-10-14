param([switch]$SkipChecks)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'mobile-env.ps1')
$project = Split-Path $PSScriptRoot -Parent
$mobile = Join-Path $project 'apps/mobile'
$delivery = Join-Path $project 'releases/mobile/1.0.0'
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
Push-Location $mobile
try {
    if (-not $SkipChecks) {
        Invoke-Checked 'flutter.bat' @('analyze')
        Invoke-Checked 'flutter.bat' @('test', '--concurrency=1')
    }
    Invoke-Checked 'flutter.bat' @('build', 'apk', '--debug', '--target-platform', 'android-arm64')
    if (-not $SkipChecks) {
        Push-Location (Join-Path $mobile 'android')
        try { Invoke-Checked '.\gradlew.bat' @('testDebugUnitTest', '-Ptarget-platform=android-arm64', '--no-daemon', '--max-workers=1') }
        finally { Pop-Location }
    }
    New-Item -ItemType Directory -Force -Path $delivery | Out-Null
    $apk = Join-Path $delivery 'behavior-rules-1.0.0-arm64-debug.apk'
    Copy-Item -LiteralPath (Join-Path $mobile 'build/app/outputs/flutter-apk/app-debug.apk') -Destination $apk -Force
    $hash = Get-FileHash -LiteralPath $apk -Algorithm SHA256
    [IO.File]::WriteAllText((Join-Path $delivery 'SHA256.txt'), "$($hash.Hash.ToLower())  behavior-rules-1.0.0-arm64-debug.apk`n")
    Write-Output "APK: $apk"
}
finally { Pop-Location }