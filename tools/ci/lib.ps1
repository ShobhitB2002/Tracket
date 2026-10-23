# Shared helpers for the local gates. Dot-source this file. Values live in ci.config.json.
$ErrorActionPreference = 'Stop'
$script:CiRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:Cfg = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'ci.config.json') | ConvertFrom-Json
$env:PATH = 'C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Program Files\Git\bin;' + $env:PATH

function Get-Git { param([Parameter(ValueFromRemainingArguments)]$a) $o = & git -C $script:CiRoot @a 2>&1; if ($LASTEXITCODE -ne 0) { throw "git $a failed: $o" }; ($o | Out-String).Trim() }
function Get-Sha { Get-Git rev-parse HEAD }
function Get-Branch { Get-Git rev-parse --abbrev-ref HEAD }
function Get-Dirty { Get-Git status --porcelain }

function New-Run { param([string]$Gate)
  $sha = Get-Sha
  $dir = Join-Path $script:Cfg.runsDir ("$Gate-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $sha.Substring(0, 7))
  New-Item -ItemType Directory -Force $dir | Out-Null
  @{ gate = $Gate; sha = $sha; branch = (Get-Branch); dir = $dir; steps = @(); start = (Get-Date) }
}
function Invoke-Step { param($Run, [string]$Name, [scriptblock]$Body)
  $t = Get-Date; $status = 'PASS'; $detail = ''
  try { $out = & $Body 2>&1 | Out-String; $detail = $out.Trim() } catch { $status = 'FAIL'; $detail = $_.Exception.Message }
  if ($detail -match '^SKIPPED') { $status = 'SKIPPED' }
  Set-Content -LiteralPath (Join-Path $Run.dir (($Name -replace '[^\w]', '_') + '.log')) $detail
  $Run.steps += @{ name = $Name; status = $status; seconds = [int]((Get-Date) - $t).TotalSeconds; detail = ($detail -split "`n" | Select-Object -Last 3) -join ' | ' }
  Write-Host ("[{0}] {1}" -f $status, $Name)
  if ($status -eq 'FAIL') { Write-Host $detail }
  $status -ne 'FAIL'
}
function Complete-Run { param($Run)
  $failed = @($Run.steps | Where-Object { $_.status -eq 'FAIL' }).Count
  $res = if ($failed -gt 0) { 'FAIL' } else { 'PASS' }
  $o = [ordered]@{ gate = $Run.gate; result = $res; sha = $Run.sha; branch = $Run.branch; finished = (Get-Date).ToString('s'); steps = $Run.steps }
  $json = $o | ConvertTo-Json -Depth 5
  Set-Content -LiteralPath (Join-Path $Run.dir 'RESULT.json') $json
  Set-Content -LiteralPath (Join-Path $script:Cfg.runsDir ($Run.gate + '-latest.json')) $json
  Write-Host ("GATE {0}: {1} ({2})" -f $Run.gate, $res, $Run.sha.Substring(0, 7))
  if ($res -eq 'PASS') { 0 } else { 1 }
}

function Test-Syntax {
  $files = (Get-Git ls-files) -split '\r?\n' | Where-Object { $_ }
  $bad = @()
  foreach ($f in $files) {
    $p = Join-Path $script:CiRoot $f
    if ($f -match '\.(js|cjs|mjs)$') { & node --check $p 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { $bad += $f } }
    elseif ($f -match '\.json$') { & node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" $p 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { $bad += $f } }
    elseif ($f -match '\.ps1$') { $e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($p, [ref]$null, [ref]$e); if ($e) { $bad += $f } }
  }
  if ($bad) { throw ('syntax errors: ' + ($bad -join ', ')) }
  "checked $($files.Count) tracked files"
}
function Test-NoSecrets {
  $files = (Get-Git ls-files) -split '\r?\n' | Where-Object { $_ }
  $hit = @($files | Where-Object { $_ -match $script:Cfg.forbiddenTracked })
  foreach ($f in $files) { $p = Join-Path $script:CiRoot $f; if ((Get-Item -LiteralPath $p).Length -lt 2MB -and (Select-String -LiteralPath $p -Pattern 'BEGIN [A-Z ]*PRIVATE KEY' -Quiet)) { $hit += "$f (private key text)" } }
  if ($hit) { throw ('secret-like tracked files: ' + ($hit -join ', ')) }
  'no secret-like tracked files'
}
function Test-Docs {
  $miss = @($script:Cfg.requiredDocs | Where-Object { -not (Test-Path -LiteralPath (Join-Path $script:CiRoot $_)) })
  if ($miss) { throw ('missing docs: ' + ($miss -join ', ')) }
  'docs present'
}
