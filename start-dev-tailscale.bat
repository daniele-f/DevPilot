@echo off
setlocal
call "%~dp0start-dev.bat" --tailscale %*
exit /b %errorlevel%
