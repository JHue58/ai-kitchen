@echo off
setlocal
cd /d "%~dp0"
if not exist config.yaml copy config.example.yaml config.yaml >nul
if not defined GOCACHE set "GOCACHE=%CD%\.cache\go-build"
if not defined GOMODCACHE set "GOMODCACHE=%CD%\.cache\go-mod"
pushd frontend
if not exist node_modules call npm ci
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
popd
pushd backend
go run ./cmd/server -config ../config.yaml %*
popd
