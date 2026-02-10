@echo off
setlocal

cd /d "%~dp0"

echo Avvio Appunti Locali su http://localhost:5173 ...
start "" "http://localhost:5173"

npx --yes http-server@14.1.1 . -p 5173 -a 0.0.0.0 -c-1

endlocal
