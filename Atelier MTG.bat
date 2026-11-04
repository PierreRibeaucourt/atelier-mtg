@echo off
rem Lance l'Atelier MTG et ouvre la page dans le navigateur. Fermer cette fenetre arrete l'Atelier.
rem Python : celui de l'installation (.venv, cree par installer.py), sinon celui du PC.
title Atelier MTG
cd /d "%~dp0"
set "PY=python"
where python >nul 2>nul || set "PY=py"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
"%PY%" outils\atelier\app.py
if errorlevel 1 pause
