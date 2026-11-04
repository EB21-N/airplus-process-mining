#!/bin/sh
cd "$(dirname "$0")" || exit 1
export PYTHONUTF8=1
if command -v python3 >/dev/null 2>&1; then exec python3 -m airplus serve; fi
echo "Python 3.9 ou plus recent est requis (paquet python3 de votre distribution)."
exit 1
