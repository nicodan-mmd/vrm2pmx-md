@echo off
setlocal

if "%~1"=="" (
  echo Usage: %~nx0 ^<input.vrm^|input.glb^> [--replace-reference]
  echo.
  echo Example:
  echo   %~nx0 "D:\Users\maedashingo\Downloads\MMD\VRoid\original\AvatarSample_A.vrm"
  exit /b 1
)

set "MODEL_PATH=%~1"

python scripts\nim_safe_rebuild_check.py "%MODEL_PATH%" %2 %3 %4 %5 %6 %7 %8 %9
set "RC=%ERRORLEVEL%"

if "%RC%"=="0" (
  echo [OK] Candidate output matches reference output.
) else if "%RC%"=="2" (
  echo [WARN] Candidate output differs from reference output. Reference exe was not replaced.
) else (
  echo [ERROR] Safe rebuild check failed.
)

exit /b %RC%
