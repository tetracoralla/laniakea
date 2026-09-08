param([Parameter(Mandatory = $true)][string]$Installer)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') {
  throw 'Run this install smoke only in a disposable Windows CI runner.'
}
# Process.MainWindowHandle can select Tao's zero-size, technically visible
# message-dispatch window before the real UI appears. WM_CLOSE to that helper
# destroys IPC instead of exercising a user's close action. Select the actual
# non-tool window with a caption and positive bounds; do not wait for JS.
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class LaniakeaNativeWindow {
  private delegate bool EnumWindow(IntPtr window, IntPtr state);
  [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow callback, IntPtr state);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder title, int count);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool PostMessageW(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  public static IntPtr Find(int process) {
    IntPtr result = IntPtr.Zero;
    EnumWindows((window, state) => {
      GetWindowThreadProcessId(window, out uint owner);
      if (owner != process || !IsWindowVisible(window) || (GetWindowLong(window, -20) & 0x80) != 0) return true;
      var title = new StringBuilder(256);
      GetWindowText(window, title, title.Capacity);
      if (title.ToString() != "Laniakea" || !GetWindowRect(window, out Rect rect) || rect.Right <= rect.Left || rect.Bottom <= rect.Top) return true;
      result = window;
      return false;
    }, IntPtr.Zero);
    return result;
  }
}
'@

function Request-VisibleWindowClose($Process) {
  $deadline = (Get-Date).AddSeconds(30)
  do {
    $Process.Refresh()
    if ($Process.HasExited) { throw 'Installed app exited before its window appeared' }
    $windowHandle = [LaniakeaNativeWindow]::Find($Process.Id)
    if ($windowHandle -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 50
  } until ((Get-Date) -gt $deadline)
  if ($windowHandle -eq [IntPtr]::Zero) { throw 'Installed app has no visible application window' }
  Write-Output "Native close target: Laniakea, process $($Process.Id), visible window $windowHandle"
  if (![LaniakeaNativeWindow]::PostMessageW($windowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
    throw 'Could not request application window close'
  }
}
# Hosted runners are elevated. WebView2 150+ ignores environment/HKCU
# debugging overrides for elevated hosts. Scope the documented HKLM override
# to this executable on the disposable runner and restore it on every exit.
# https://learn.microsoft.com/microsoft-edge/webview2/concepts/security
$debugPolicy = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'
New-Item -Path $debugPolicy -Force | Out-Null
$oldDebugArguments = (Get-Item -Path $debugPolicy).GetValue('laniakea.exe')
try {
  New-ItemProperty -Path $debugPolicy -Name 'laniakea.exe' -Value '--remote-debugging-port=9222' -PropertyType String -Force | Out-Null
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
    # Close as soon as a window exists, including before frontend readiness.
    # The native guard must retain the WebView until recovery/save can complete.
    Request-VisibleWindowClose $appProcess
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
    # The runner's temporary per-app WebView2 policy enables CDP for testing.
    # The shipped app does not enable a debugging endpoint.
    $previousArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
    $editorProcess = Start-Process -FilePath $binary -PassThru
    try {
      node scripts/checkWindowsRuntime.mjs $Mode
      if ($LASTEXITCODE -ne 0) { throw "Installed editor check failed: $Mode" }
      Request-VisibleWindowClose $editorProcess
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
} finally {
  if ($null -eq $oldDebugArguments) {
    Remove-ItemProperty -Path $debugPolicy -Name 'laniakea.exe' -ErrorAction SilentlyContinue
  } else {
    Set-ItemProperty -Path $debugPolicy -Name 'laniakea.exe' -Value $oldDebugArguments
  }
}

# Repeat early native close with the CI debugging override already restored.
$normalProcess = Start-Process -FilePath $binary -PassThru
try {
  Request-VisibleWindowClose $normalProcess
  if (!$normalProcess.WaitForExit(30000) -or $normalProcess.ExitCode -ne 0) {
    throw 'Normal startup close did not exit successfully'
  }
  node scripts/checkWindowsRuntime.mjs disk
  if ($LASTEXITCODE -ne 0) { throw 'Normal startup close did not preserve saved content' }
  Write-Output 'PASS: immediate native close without the CI debugging override'
} finally {
  if (!$normalProcess.HasExited) { Stop-Process -Id $normalProcess.Id }
}
