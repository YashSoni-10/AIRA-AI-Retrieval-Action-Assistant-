@echo off
title AIRA Launcher
echo ========================================================
echo          Starting AIRA AI Assistant Services
echo ========================================================

echo [1/3] Launching Python AI Service (Port 8000)...
start "AIRA - AI Service (FastAPI :8000)" cmd /k "cd /d D:\Aira\Ai-Service && .\venv\Scripts\activate && uvicorn app.main:app --reload --port 8000"

echo [2/3] Launching Node.js Auth Backend (Port 5000)...
start "AIRA - Auth Backend (Node.js :5000)" cmd /k "cd /d D:\Aira\backend && npm run dev"

echo [3/3] Launching React Frontend (Port 5173)...
start "AIRA - Frontend (React Vite :5173)" cmd /k "cd /d D:\Aira\frontend && npm run dev"

echo.
echo ========================================================
echo All services started in separate terminal windows!
echo - Frontend UI:     http://localhost:5173
echo - Python AI API:   http://localhost:8000 (Docs: /docs)
echo - Node.js Auth:    http://localhost:5000 (Health: /api/health)
echo ========================================================
echo You can close this window now.
pause
