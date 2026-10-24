@echo off
chcp 65001 >nul
echo Iniciando o programa Foco ^& Escolha localmente em http://localhost:8080 ...
start "" "http://localhost:8080"
python -m http.server 8080

