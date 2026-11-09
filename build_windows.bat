@echo off
cd /d "%~dp0"
echo Installing project dependencies...
npm install
if errorlevel 1 goto error
echo Building Windows installer...
npm run dist
if errorlevel 1 goto error
echo.
echo Build completed. Check the dist folder.
pause
exit /b 0
:error
echo Build failed. Review the messages above.
pause
exit /b 1
