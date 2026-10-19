# ============================================================================
# Boarding Pass - build the Windows app
#
#   Double-click build-windows.bat (or run: powershell -ExecutionPolicy Bypass -File windows-build.ps1)
#
# Checks the tools, installs the game's packages, builds Boarding Pass and
# opens the folder with the .exe and the installer. Run it again after an
# update; your careers are kept.
# ============================================================================
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Say($t) { Write-Host "`n== $t" -ForegroundColor Yellow }
function Stop($t) { Write-Host "`n$t`n" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }

Say '1/4  Checking the tools'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Start-Process 'https://nodejs.org/en/download'
  Stop "Node.js isn't installed. Install the LTS version from nodejs.org (the page has opened), then run this again."
}
$nv = [version]((node -p 'process.versions.node').Trim())
if ($nv -lt [version]'20.19.0' -or ($nv.Major -eq 21) -or ($nv.Major -eq 22 -and $nv.Minor -lt 12)) {
  Start-Process 'https://nodejs.org/en/download'
  Stop "Node.js $nv is too old. Install the current LTS from nodejs.org (the page has opened), then run this again."
}
Write-Host "Node.js ${nv}: OK"

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vc = if (Test-Path $vswhere) { & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath } else { $null }
if (-not $vc) {
  Start-Process 'https://visualstudio.microsoft.com/visual-cpp-build-tools/'
  Stop "Microsoft C++ Build Tools aren't installed. Install them (the page has opened) and tick 'Desktop development with C++', then run this again."
}
Write-Host 'C++ Build Tools: OK'

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
  if (Test-Path (Join-Path $cargoBin 'cargo.exe')) { $env:Path = "$cargoBin;$env:Path" }
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Start-Process 'https://rustup.rs'
  Stop "Rust isn't installed. Download rustup-init.exe from rustup.rs (the page has opened), run it with the default choices, then open a new window and run this again."
}
Write-Host "Rust $((rustc --version).Split(' ')[1]): OK"

Say "2/4  Installing the game's packages (a few minutes the first time)"
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Stop "Installing the packages failed. Copy the last 30 lines above and send them to Claude." }

Say '3/4  Building Boarding Pass (5 to 15 minutes the first time, faster after)'
# The update files need the release key, which only GitHub has, so a home
# build skips them (src-tauri\tauri.local.conf.json).
npm run tauri build -- --bundles nsis --config src-tauri/tauri.local.conf.json
if ($LASTEXITCODE -ne 0) { Stop "The build failed. Copy the last 30 lines above and send them to Claude." }

Say '4/4  Done'
$exe = Get-ChildItem 'src-tauri\target\release\*.exe' | Where-Object { $_.Name -notlike '*build*' } | Select-Object -First 1
$setup = Get-ChildItem 'src-tauri\target\release\bundle\nsis\*-setup.exe' | Select-Object -First 1
if ($exe) { Write-Host "The game:      $($exe.FullName)  (runs on its own)" -ForegroundColor Green }
if ($setup) { Write-Host "The installer: $($setup.FullName)  (installs it with a Start menu entry)" -ForegroundColor Green }
Start-Process explorer.exe (Resolve-Path 'src-tauri\target\release').Path
Read-Host 'Press Enter to close'
