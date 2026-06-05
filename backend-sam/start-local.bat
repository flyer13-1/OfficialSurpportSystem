@echo off
cd /d I:\node-v22.19.0-win-x64\backend-sam
echo [INFO] ローカルサーバー起動中...
"I:\node-v22.19.0-win-x64\node.exe" --experimental-loader ./local-server/loader.mjs ./local-server/server.mjs
