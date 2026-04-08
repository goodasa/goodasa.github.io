@echo off
setlocal
cd /d "%~dp0"

echo.
echo CHUWI 스마트 현황판을 시작합니다.
echo.

where py >nul 2>nul
if %errorlevel%==0 (
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8426 .*LISTENING"') do taskkill /PID %%p /F >nul 2>nul
    start "CHUWI Dashboard Server" /min py -3 "%~dp0serve_dashboard.py"
    goto open_browser
)

where python >nul 2>nul
if %errorlevel%==0 (
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8426 .*LISTENING"') do taskkill /PID %%p /F >nul 2>nul
    start "CHUWI Dashboard Server" /min python "%~dp0serve_dashboard.py"
    goto open_browser
)

echo Python을 찾지 못했습니다.
echo 우선 index.html을 직접 열겠습니다.
echo 자세한 방법은 INSTRUCTION_MANUAL.md를 확인해주세요.
echo.
start "" "%~dp0index.html"
exit /b

:open_browser
timeout /t 2 /nobreak >nul
set URL=http://127.0.0.1:8426/index.html?reload=%RANDOM%

if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=%URL%
    exit /b
)

if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app=%URL%
    exit /b
)

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app=%URL%
    exit /b
)

if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --app=%URL%
    exit /b
)

start "" %URL%
exit /b
