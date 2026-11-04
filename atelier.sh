#!/bin/sh
# Lance l'Atelier MTG (macOS, Linux) et ouvre la page dans le navigateur. Ctrl+C ou fermer le terminal l'arrête.
# Python : celui de l'installation (.venv, créé par installer.py), sinon python3.
cd "$(dirname "$0")" || exit 1
if [ -x .venv/bin/python ]; then PY=.venv/bin/python; else PY=python3; fi
exec "$PY" outils/atelier/app.py "$@"
