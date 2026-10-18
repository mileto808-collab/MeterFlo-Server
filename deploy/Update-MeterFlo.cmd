@echo off
setlocal
cd /d "%~dp0.." || exit /b 1
node script/windows-update.mjs %*
exit /b %ERRORLEVEL%
