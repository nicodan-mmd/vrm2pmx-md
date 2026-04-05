@echo off
setlocal

powershell -ExecutionPolicy Bypass -File "%~dp0scripts\run_socket_scan.ps1" %*
exit /b %ERRORLEVEL%