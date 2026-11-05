@echo off
rem Lance l'Atelier MTG et ouvre la page dans le navigateur. Il se range dans la barre d'etat, pres de l'horloge
rem (le chaudron) : clic droit, Quitter pour l'arreter. Sans pystray, il reste dans cette fenetre (la fermer l'arrete).
rem Python : celui de l'installation (.venv, cree par installer.py), sinon celui du PC.
title Atelier MTG
cd /d "%~dp0"
set "PY=python"
where python >nul 2>nul || set "PY=py"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
"%PY%" outils\atelier\app.py --barre
if errorlevel 1 pause
