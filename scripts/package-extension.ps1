param()
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$extension = Join-Path $project 'apps/extension'
$dist = Join-Path $extension 'dist'
$release = Join-Path $project 'releases/extension/1.0.1'
$manifest = Get-Content -Raw -LiteralPath (Join-Path $dist 'manifest.json') | ConvertFrom-Json
if ($manifest.version -ne '1.0.1' -or $manifest.name -ne '停一下 · 网页行为规则') { throw 'Build 1.0.1 before packaging.' }
$files = @('manifest.json','background.js','content.js','options.js','popup.js','options.html','popup.html','styles.css','icons/icon16.png','icons/icon32.png','icons/icon48.png','icons/icon128.png')
$actual = @(Get-ChildItem -LiteralPath $dist -Recurse -File | ForEach-Object { [IO.Path]::GetRelativePath($dist, $_.FullName).Replace('\','/') })
$delta = Compare-Object ($files | Sort-Object) ($actual | Sort-Object)
if ($delta) { throw "Unexpected dist files; no archive produced: $delta" }
if ($manifest.permissions -contains 'tabs') { throw 'Redundant tabs permission still present.' }
New-Item -ItemType Directory -Force -Path $release | Out-Null
$zip = Join-Path $release 'pause-web-rules-1.0.1.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($dist, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
    $entryNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\','/') })
    if (Compare-Object ($files | Sort-Object) ($entryNames | Sort-Object)) { throw 'Archive entry mismatch' }
    foreach ($entry in $archive.Entries) {
        $stream = $entry.Open()
        try {
            $hasher = [Security.Cryptography.SHA256]::Create()
            try { $entryHash = [Convert]::ToHexString($hasher.ComputeHash($stream)) }
            finally { $hasher.Dispose() }
        } finally { $stream.Dispose() }
        $expected = (Get-FileHash -LiteralPath (Join-Path $dist $entry.FullName) -Algorithm SHA256).Hash
        if ($entryHash -ne $expected) { throw "Archive bytes mismatch: $($entry.FullName)" }
    }
} finally { $archive.Dispose() }
$install = Join-Path $project 'chrome-install'
if (Test-Path -LiteralPath $install -PathType Container) {
    foreach ($file in $files) {
        $destination = Join-Path $install $file
        New-Item -ItemType Directory -Force -Path (Split-Path $destination -Parent) | Out-Null
        Copy-Item -LiteralPath (Join-Path $dist $file) -Destination $destination -Force
    }
}
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText((Join-Path $release 'EXTENSION-SHA256.txt'), "$hash  pause-web-rules-1.0.1.zip`n")
[pscustomobject]@{Zip=$zip;Files=$files.Count;Bytes=(Get-Item $zip).Length;SHA256=$hash} | ConvertTo-Json