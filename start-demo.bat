@echo off
setlocal
cd /d "%~dp0"
title Aurora Report - Demo

echo.
echo  ==============================================
echo    Aurora Report for Playwright - Demo
echo  ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [x] Node.js was not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist "node_modules\@playwright\test" (
  echo  [1/3] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo  [x] npm install failed.
    pause
    exit /b 1
  )
) else (
  echo  [1/3] Dependencies already installed.
)

echo  [2/3] Making sure the Chromium browser is installed...
call npx playwright install chromium
if errorlevel 1 (
  echo  [x] Could not install Chromium.
  pause
  exit /b 1
)

echo  [3/3] Running the demo tests...
echo        Some tests fail on purpose so the report has failures to show.
echo.
call npx playwright test
set TEST_EXIT=%ERRORLEVEL%

if not exist "aurora-report\index.html" (
  echo.
  echo  [x] The report was not generated. Check the output above.
  pause
  exit /b 1
)

echo.
echo  Opening the report...
start "" "%~dp0aurora-report\index.html"

echo  Done. Test run exit code: %TEST_EXIT% (1 is expected for this demo).
echo.
pause
endlocal
