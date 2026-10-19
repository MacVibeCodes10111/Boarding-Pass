@echo off
rem Builds Boarding Pass for Windows (see windows-build.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-build.ps1"
