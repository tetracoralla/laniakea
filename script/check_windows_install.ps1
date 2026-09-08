param([Parameter(Mandatory = $true)][string]$Installer)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') {
  throw 'Run this install smoke only in a disposable Windows CI runner.'
}
$installDirectory = Join-Path $env:RUNNER_TEMP 'Laniakea installation'
# NSIS requires /D to be the last argument, with its path unquoted.
$setup = Start-Process -FilePath $Installer -ArgumentList "/S /D=$installDirectory" -PassThru -Wait
if ($setup.ExitCode -ne 0) { throw "Installer failed: $($setup.ExitCode)" }
$binary = Join-Path $installDirectory 'laniakea.exe'
if (!(Test-Path $binary)) { throw 'Installed executable is missing' }
node scripts/checkDesktopBundle.mjs $installDirectory windows
if ($LASTEXITCODE -ne 0) { throw 'Installed resources differ from build inputs' }
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
if ((Get-Item $binary).VersionInfo.ProductVersion -notlike "$version*") {
  throw 'Installed application version differs from the source version'
}
$appProcess = Start-Process -FilePath $binary -PassThru
try {
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 250
    $appProcess.Refresh()
    if ($appProcess.HasExited) { throw 'Installed app exited during startup' }
  } until ($appProcess.MainWindowHandle -ne 0 -or (Get-Date) -gt $deadline)
  if ($appProcess.MainWindowHandle -eq 0) { throw 'Installed app has no window' }
  # Close as soon as a window exists, including before frontend readiness.
  # The native guard must retain the WebView until recovery/save can complete.
  if (!$appProcess.CloseMainWindow()) { throw 'Could not request window close' }
  if (!$appProcess.WaitForExit(30000)) { throw 'Closing the window left a background process' }
  if ($appProcess.ExitCode -ne 0) { throw 'Installed app exited unsuccessfully' }
  Write-Output 'PASS: installed resources, window launch and close. Editing/save/reopen still need a Windows interaction review.'
} finally {
  if (!$appProcess.HasExited) { Stop-Process -Id $appProcess.Id }
}
