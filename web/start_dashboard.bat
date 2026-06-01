@echo off
cd /d "%~dp0"
echo Running Happy Investing dashboard launcher...
rem Use unbuffered output so logs appear live
python -u start_dashboard.py %*
if %ERRORLEVEL% neq 0 (
	echo Launcher exited with error %ERRORLEVEL%
	pause
)
