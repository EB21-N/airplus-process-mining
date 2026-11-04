@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONUTF8=1
where py >nul 2>nul && (py -3 -m airplus serve & goto :fin)
where python >nul 2>nul && (python -m airplus serve & goto :fin)
echo Python 3.9 ou plus recent est requis : https://www.python.org/downloads/
:fin
pause
