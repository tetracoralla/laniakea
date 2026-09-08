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
# Release builds must be a GUI app, without a second console window.
$pe = [IO.File]::ReadAllBytes($binary)
$peHeader = [BitConverter]::ToInt32($pe, 0x3c)
$subsystem = [BitConverter]::ToUInt16($pe, $peHeader + 24 + 68)
if ($subsystem -ne 2) { throw 'Windows release must use the GUI subsystem' }
$previousStartupArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
$runtimeOutput = Join-Path $env:RUNNER_TEMP 'laniakea-runtime'
New-Item -ItemType Directory -Force -Path $runtimeOutput | Out-Null
$appProcess = Start-Process -FilePath $binary -PassThru -RedirectStandardError (Join-Path $runtimeOutput 'windows-startup-stderr.log')
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
  if (!$appProcess.WaitForExit(30000)) {
    node scripts/checkWindowsRuntime.mjs inspect
    throw 'Closing the window left a background process'
  }
  if ($appProcess.ExitCode -ne 0) { throw 'Installed app exited unsuccessfully' }
  Write-Output 'PASS: installed resources and immediate native close during startup'
} catch {
  $startupFailure = $_
  $appProcess.Refresh()
  Write-Output ($appProcess | Select-Object Id, HasExited, MainWindowHandle, MainWindowTitle, Responding | ConvertTo-Json)
  Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $appProcess.Id -or $_.ParentProcessId -eq $appProcess.Id } |
    Select-Object Name, ProcessId, ParentProcessId, CommandLine | ConvertTo-Json | Write-Output
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = [Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Location, [Drawing.Point]::Empty, $bounds.Size)
      $bitmap.Save((Join-Path $runtimeOutput 'windows-native-startup-failure.png'))
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  } catch { Write-Warning "Could not capture the Windows desktop: $_" }
  throw $startupFailure
} finally {
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousStartupArguments
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
