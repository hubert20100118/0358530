@echo off
:: localhost.run public tunnel via built-in Windows OpenSSH (zero download)
:: localhost.run requires ssh public key -> generate id_ed25519 next to this script and use it
:: Double-click to run. Keep window open = online, close = disconnect.
setlocal
cd /d "%~dp0"

:: Disable ssh-agent pipe to avoid Windows "Operation not supported on socket"
set "SSH_AUTH_SOCK="

:: Key lives next to this script (absolute path, no %USERPROFILE%, no Chinese)
set "KEY=%~dp0id_ed25519"

echo [tunnel-ssh v5] starting localhost.run tunnel
echo USERPROFILE=%USERPROFILE%
echo dp0=%~dp0
echo KEY=%KEY%

where ssh >nul 2>&1 || (
    echo [ERROR] ssh client not found. Install OpenSSH Client:
    echo   Settings - Apps - Optional features - Add - OpenSSH Client
    echo   or in admin PowerShell: Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
    pause
    exit /b
)

if "%KEY%"=="" (
    echo [ERROR] KEY path is empty, cannot continue.
    pause
    exit /b
)

if not exist "%KEY%" (
    echo Generating ed25519 key, no passphrase, tunnel auth only...
    ssh-keygen -t ed25519 -N "" -f "%KEY%"
    if errorlevel 1 (
        echo [ERROR] keygen failed. Run manually: ssh-keygen -t ed25519 -f "%KEY%"
        pause
        exit /b
    )
    echo Key generated.
)

if not exist "%KEY%.pub" (
    echo Rebuilding missing public key file...
    ssh-keygen -y -P "" -f "%KEY%" > "%KEY%.pub"
)

echo ============================================================
echo Tunnel to local http://localhost:8137
echo Phone opens the https address printed below, e.g. https://xxxx.lhrtunnel.link
echo Keep this window open. Closing it disconnects the tunnel.
echo ============================================================
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o IdentitiesOnly=yes -o IdentityAgent=none -i "%KEY%" -R 80:localhost:8137 localhost.run
pause
