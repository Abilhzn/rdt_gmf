@echo off
REM Starts all 4 budgeting_gmf services, each in its own window, so you can see
REM their logs and close them individually. Double-click this file to run.
REM   data_user  -> http://localhost:4002
REM   auth       -> http://localhost:4001
REM   rdt/backend -> http://localhost:3000  (API only, no UI served here)
REM   rdt Angular dev-shell -> http://localhost:4200/rdt  (the frontend — open this one)

start "data_user (4002)"   cmd /k "cd /d %~dp0data_user && npm start"
start "auth (4001)"        cmd /k "cd /d %~dp0auth && npm start"
start "rdt backend (3000)" cmd /k "cd /d %~dp0rdt\backend && npm start"
start "rdt dev-shell (4200)" cmd /k "cd /d %~dp0rdt\frontend\dev-shell && npm start"

echo.
echo All 4 services are starting in separate windows.
echo Give them a few seconds, then open:
echo   http://localhost:4200/rdt/login   (the app)
echo.
pause
