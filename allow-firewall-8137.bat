@echo off
:: 订餐后端 8137 端口防火墙放行（手机同 WiFi 访问需要）
:: 双击运行会自动请求管理员权限；若未弹窗，请右键本文件 -> 以管理员身份运行
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo 正在请求管理员权限...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)
netsh advfirewall firewall delete rule name="MealReservation_8137" >nul 2>&1
netsh advfirewall firewall add rule name="MealReservation_8137" dir=in action=allow protocol=TCP localport=8137
echo.
echo [OK] 已放行 TCP 8137 入站（手机同 WiFi 可访问 http://电脑IP:8137）
echo 当前局域网地址可在 cmd 用 ipconfig 查看（WLAN 的 IPv4）
echo.
pause
