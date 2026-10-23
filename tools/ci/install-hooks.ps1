# Copies the hook shims into the repo's git hooks folder. Does not overwrite a hook it did not install (-Force does).
param([switch]$Force)
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$hooks = (& git -C $root rev-parse --git-path hooks).Trim()
if (-not [System.IO.Path]::IsPathRooted($hooks)) { $hooks = Join-Path $root $hooks }
foreach ($h in 'pre-push', 'post-merge') {
  $src = Join-Path $PSScriptRoot "hooks\$h.sh"; $dst = Join-Path $hooks $h
  if ((Test-Path $dst) -and -not $Force -and -not ((Get-Content -Raw $dst) -match 'tools/ci/install-hooks.ps1')) { Write-Host "SKIP $h (foreign hook exists; use -Force)"; continue }
  [System.IO.File]::WriteAllText($dst, ((Get-Content -Raw $src) -replace "`r`n", "`n"))
  Write-Host "installed $dst"
}
