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
  Write-Output 'PASS: installed resources and immediate native close during startup'
} finally {
  if (!$appProcess.HasExited) { Stop-Process -Id $appProcess.Id }
}

function Test-InstalledEditor([string]$Mode) {
  # WebView2 supports process-local CDP for testing. The shipped app does not
  # enable a debugging endpoint, and this environment ends with the CI runner.
  $previousArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
  $editorProcess = Start-Process -FilePath $binary -PassThru
  try {
    node scripts/checkWindowsRuntime.mjs $Mode
    if ($LASTEXITCODE -ne 0) { throw "Installed editor check failed: $Mode" }
    $editorProcess.Refresh()
    if (!$editorProcess.CloseMainWindow()) { throw 'Could not close the installed editor' }
    if (!$editorProcess.WaitForExit(30000)) { throw 'Editor close left a background process' }
    if ($editorProcess.ExitCode -ne 0) { throw 'Editor exited unsuccessfully' }
    node scripts/checkWindowsRuntime.mjs disk
    if ($LASTEXITCODE -ne 0) { throw 'Saved Markdown did not preserve the final content' }
  } finally {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousArguments
    if (!$editorProcess.HasExited) { Stop-Process -Id $editorProcess.Id }
  }
}

Test-InstalledEditor edit
Test-InstalledEditor reopen
$reinstall = Start-Process -FilePath $Installer -ArgumentList "/S /D=$installDirectory" -PassThru -Wait
if ($reinstall.ExitCode -ne 0) { throw "Reinstallation failed: $($reinstall.ExitCode)" }
Test-InstalledEditor reinstall
Write-Output 'PASS: install, edit mind map and Flow, close with pending text, reopen, and reinstall preserving data'
Write-Output 'Scope: Windows CI/WebView2; publisher trust and other Windows versions are not established by this check.'
