@echo off
echo ============================================================
echo  ShieldBrowse Server - Starting on http://localhost:8000
echo ============================================================

cd /d "%~dp0\.."

:: Check Python
where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.11+
    pause
    exit /b 1
)

:: Install dependencies if needed
pip show fastapi >nul 2>&1
if errorlevel 1 (
    echo Installing dependencies...
    pip install -r server\requirements.txt
)

:: Start server
echo.
echo Server starting... Open http://localhost:8000/docs for API docs
echo Press Ctrl+C to stop.
echo.
python -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload

pause
