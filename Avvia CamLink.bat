@echo off
setlocal
title CamLink
cd /d "%~dp0"

echo.
echo   ====== CamLink ======
echo.

REM --- Trova Python ---
where py >nul 2>nul
if %errorlevel%==0 (
  set "PY=py -3"
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    set "PY=python"
  ) else (
    echo   Python non trovato.
    echo   Installalo da https://www.python.org/downloads/  ^(spunta "Add to PATH"^)
    echo.
    pause
    exit /b 1
  )
)

REM --- Crea l'ambiente virtuale alla prima esecuzione ---
if not exist ".venv\Scripts\python.exe" (
  echo   Primo avvio: preparazione in corso ^(un minuto^)...
  %PY% -m venv .venv
  ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo.
    echo   Installazione dipendenze fallita. Controlla la connessione e riprova.
    pause
    exit /b 1
  )
)

REM --- Avvio ---
".venv\Scripts\python.exe" server.py

pause
