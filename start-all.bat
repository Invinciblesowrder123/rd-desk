@echo off
rem ===========================================================================
rem  PM_desk launcher  --  starts everything with one double-click
rem    * center : 研发推进中台 (local/server.py, port 8787)
rem    * bot    : 飞书长连接监听 (pmbot run_pmbot.py feishu-ws --env .env.prod)
rem  ASCII only on purpose: cmd.exe uses codepage 936/437, non-ASCII bytes here
rem  would break parsing. All Chinese output comes from pmdesk.py instead.
rem ===========================================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PYEXE="
where python >nul 2>nul && set "PYEXE=python"
if not defined PYEXE where python3 >nul 2>nul && set "PYEXE=python3"
if not defined PYEXE (
  echo [ERROR] python not found in PATH.
  echo Install Python 3 ^(or add pmbot\python-embed to PATH^) and try again.
  pause
  exit /b 1
)

"%PYEXE%" "%~dp0pmdesk.py" start
set "RC=%ERRORLEVEL%"

echo.
"%PYEXE%" "%~dp0pmdesk.py" status

if not "%RC%"=="0" (
  echo.
  echo [WARN] something did not start. See logs\*.log
  pause
  exit /b %RC%
)

start "" "http://127.0.0.1:8787/index.html"
timeout /t 3 /nobreak >nul
exit /b 0
