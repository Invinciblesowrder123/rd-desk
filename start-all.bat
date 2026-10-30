@echo off
rem ===========================================================================
rem  PM_desk launcher  --  starts everything with one double-click
rem    * center : R&D mid-platform service (local/server.py, port 8787)
rem    * bot    : Feishu long-connection listener (optional, if pmbot present)
rem
rem  Two hard rules for this file:
rem    1) ASCII only. cmd.exe reads the batch file with the active code page
rem       (936 on a Chinese Windows). Non-ASCII bytes in comments get mangled
rem       into garbage and can even be parsed as commands. All Chinese output
rem       is produced by pmdesk.py instead.
rem    2) CRLF line endings. cmd.exe mis-parses LF-only batch files, especially
rem       around labels and parenthesised blocks.
rem
rem  Python discovery lives in findpy.bat -- see the header there for why
rem  "where python" is not good enough.
rem ===========================================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0"

call "%~dp0findpy.bat"
if not defined PYEXE (
  echo [ERROR] No usable Python interpreter found.
  echo.
  echo   Your PATH only contains the Microsoft Store placeholder
  echo     C:\Users\%USERNAME%\AppData\Local\Microsoft\WindowsApps\python.exe
  echo   which is a 0-byte stub and exits with code 9009.
  echo.
  echo   Fix: install Python 3 from https://www.python.org/downloads/
  echo   and tick "Add python.exe to PATH", then run this file again.
  echo.
  pause
  exit /b 1
)
echo [INFO] python = %PYEXE%
echo.

"%PYEXE%" "%~dp0pmdesk.py" start --python "%PYEXE%"
set "RC=%ERRORLEVEL%"

echo.
"%PYEXE%" "%~dp0pmdesk.py" status --python "%PYEXE%"

if not "%RC%"=="0" (
  echo.
  echo [WARN] something did not start. See logs\*.log
  echo        Diagnose with:  pmdesk.py doctor
  pause
  exit /b %RC%
)

start "" "http://127.0.0.1:8787/index.html"
timeout /t 3 /nobreak >nul
exit /b 0
