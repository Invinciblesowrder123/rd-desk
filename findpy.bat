@echo off
rem ===========================================================================
rem  findpy.bat -- shared Python discovery for start-all.bat / stop-all.bat
rem
rem  Sets PYEXE to a Python interpreter that ACTUALLY RUNS, and returns 0.
rem  If nothing usable is found, PYEXE stays empty and it returns 1.
rem  Call it with:  call "%~dp0findpy.bat"
rem
rem  Why not just "where python"?
rem    On many Windows 10/11 boxes the only "python" on PATH is the Microsoft
rem    Store app-execution alias
rem      C:\Users\<u>\AppData\Local\Microsoft\WindowsApps\python.exe
rem    a 0-byte stub that exits with code 9009 and prints nothing.
rem    "where" finding it does NOT mean you have a working interpreter, so
rem    every candidate is smoke-tested with "-c import sys" before use.
rem
rem  ASCII only + CRLF endings, on purpose. See start-all.bat header.
rem  No setlocal here: the caller needs PYEXE to survive the call.
rem ===========================================================================

set "PYEXE="
call :fpy_scan "%USERPROFILE%\.workbuddy\binaries\python\versions\*"
call :fpy_scan "%LOCALAPPDATA%\Programs\Python\Python3*"
call :fpy_scan "C:\Python3*"
call :fpy_scan "D:\Python3*"
if not defined PYEXE call :fpy_scan_where
if not defined PYEXE exit /b 1
exit /b 0

rem --- scan a directory glob for a working python.exe --------------------------
:fpy_scan
for /d %%D in ("%~1") do (
  if not defined PYEXE (
    if exist "%%~fD\python.exe" (
      "%%~fD\python.exe" -c "import sys" >nul 2>&1
      if not errorlevel 1 set "PYEXE=%%~fD\python.exe"
    )
  )
)
exit /b 0

rem --- last resort: whatever "where python" reports, if it really works -------
:fpy_scan_where
for /f "delims=" %%P in ('where python 2^>nul') do (
  if not defined PYEXE (
    "%%P" -c "import sys" >nul 2>&1
    if not errorlevel 1 set "PYEXE=%%P"
  )
)
exit /b 0
