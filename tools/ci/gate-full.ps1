# G2 full gate: fast checks, clean tree, then the tests run on an export of exactly this commit (never the working tree).
# There is no local build or deploy target: Tracket is hosted on Vercel (see docs/DEPLOYMENT.md).
. (Join-Path $PSScriptRoot 'lib.ps1')
$run = New-Run 'full'
[void](Invoke-Step $run 'syntax' { Test-Syntax })
[void](Invoke-Step $run 'no-secrets' { Test-NoSecrets })
[void](Invoke-Step $run 'docs' { Test-Docs })
[void](Invoke-Step $run 'clean-tree' { $d = Get-Dirty; if ($d) { throw "working tree not clean:`n$d" }; 'clean' })
[void](Invoke-Step $run 'export-tests' {
  $stage = Join-Path $script:Cfg.runsDir ('export-' + $run.sha.Substring(0, 7))
  if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
  New-Item -ItemType Directory -Force $stage | Out-Null
  $tar = Join-Path $env:TEMP ('tracket-ci-' + $run.sha.Substring(0, 7) + '.tar')
  & git -C $script:CiRoot archive --format=tar --output=$tar HEAD; if ($LASTEXITCODE) { throw 'git archive failed' }
  & "$env:SystemRoot\System32\tar.exe" -x -f $tar -C $stage; if ($LASTEXITCODE) { throw 'tar extract failed' }
  Remove-Item $tar -Force
  Push-Location $stage
  try {
    $ErrorActionPreference = 'Continue'
    & node --test test/*.test.js 2>&1 | Out-String | Write-Output
    if ($LASTEXITCODE) { throw "node --test failed (exit $LASTEXITCODE)" }
  } finally { Pop-Location }
  Set-Content "$stage\SHA.txt" $run.sha
  Remove-Item -Recurse -Force $stage
  'tests pass on export of ' + $run.sha.Substring(0, 7)
})
exit (Complete-Run $run)
