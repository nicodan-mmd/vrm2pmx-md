# Local Run Guide

## Prerequisites
- Python 3.x and local `.venv`
- Node.js 22+ and npm

## Backend (FastAPI)
1. Activate virtual env
2. Install dependencies
3. Run server

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Health check:

```powershell
Invoke-WebRequest -Uri http://127.0.0.1:8000/health -UseBasicParsing
```

## Frontend (Vite + React)

```powershell
cd frontend
npm install
npm run dev
```

Open:
- http://127.0.0.1:5173/

## Convert flow
1. Select a `.vrm` file.
2. Click `Convert and Download PMX`.
3. Wait until conversion ends and file download starts.
4. Downloaded ZIP contains `result.pmx` and `tex/`.

## Current PoC contract
- API: `POST /api/convert`
- Upload field: `vrm_file`
- Optional fields: `bone_config`, `physics_config` (JSON string)
- Response: `application/zip` (`result.pmx` + `tex/`)
