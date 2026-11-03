@echo off
rem Lance l'Atelier MTG et ouvre la page dans le navigateur. Fermer cette fenetre arrete l'Atelier.
title Atelier MTG
cd /d "%~dp0"
python outils\atelier\app.py
if errorlevel 1 pause
