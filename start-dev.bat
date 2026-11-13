@echo off
setlocal
title DevPilot - Development
pushd "%~dp0" || exit /b 1

where.exe node.exe >nul 2>&1
if errorlevel 1 goto missing_node
where.exe npm.cmd >nul 2>&1
if errorlevel 1 goto missing_node

if not exist "node_modules\.bin\ng.cmd" (
    echo Installing DevPilot dependencies...
    call npm.cmd ci
    if errorlevel 1 goto failed
)

echo Starting DevPilot. The launcher will print the browser URL below.
echo Local development login: dev / dev
echo Keep this window open. Press Ctrl+C to stop the development server.
echo.
call npm.cmd start -- --open %*
if errorlevel 1 goto failed
popd
exit /b 0

:missing_node
echo Node.js and npm are required. Install Node.js 24 LTS, then try again.
goto failed

:failed
echo.
echo DevPilot could not start. Review the messages above.
pause
popd
exit /b 1
