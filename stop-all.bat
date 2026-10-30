@echo off
rem ===========================================================================
rem  PM_desk stopper  --  stops everything with one double-click
rem    * center : R&D mid-platform service (port 8787)
rem    * bot    : Feishu long-connection listener (feishu-ws --env .env.prod)
rem    * web    : pmbot local web chat (optional component, only if running)
rem
rem  ASCII only + CRLF endings, on purpose -- see start-all.bat header.
rem  Python discovery lives in findpy.bat.
rem ===========================================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0"

call "%~dp0findpy.bat"
if not defined PYEXE (
  echo [ERROR] No usable Python interpreter found -- see findpy.bat.
  echo        Install Python 3 and add it to PATH, then try again.
  echo.
  pause
  exit /b 1
)

"%PYEXE%" "%~dp0pmdesk.py" stop center bot web
echo.
"%PYEXE%" "%~dp0pmdesk.py" status
echo.
timeout /t 4 /nobreak >nul
exit /b 0
