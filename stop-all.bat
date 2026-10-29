@echo off
rem ===========================================================================
rem  PM_desk stopper  --  stops everything with one double-click
rem    * center : 研发推进中台 (port 8787)
rem    * bot    : 飞书长连接监听 (feishu-ws --env .env.prod)
rem    * web    : pmbot 网页聊天 (only if it was started; optional component)
rem  ASCII only on purpose -- see start-all.bat header.
rem ===========================================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PYEXE="
where python >nul 2>nul && set "PYEXE=python"
if not defined PYEXE where python3 >nul 2>nul && set "PYEXE=python3"
if not defined PYEXE (
  echo [ERROR] python not found in PATH.
  pause
  exit /b 1
)

"%PYEXE%" "%~dp0pmdesk.py" stop center bot web
echo.
"%PYEXE%" "%~dp0pmdesk.py" status
echo.
timeout /t 4 /nobreak >nul
exit /b 0
