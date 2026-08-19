@echo off
cd /d "C:\Users\JING\WorkBuddy\2026-08-16-09-16-08\meal-reservation"
set PORT=8137
"C:\Users\JING\.workbuddy\binaries\node\versions\22.22.2\node.exe" --experimental-sqlite server/server.js
