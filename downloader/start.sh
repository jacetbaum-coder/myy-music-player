#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Load R2 credentials and other config from .env if present
if [ -f .env ]; then
	set -a; source .env; set +a
fi

if [ -z "${PYTHON_BIN:-}" ]; then
	if [ -x "../.venv/bin/python" ]; then
		PYTHON_BIN="../.venv/bin/python"
	else
		PYTHON_BIN="python3"
	fi
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
	echo "Python is required to run the local downloader."
	exit 1
fi

if ! "$PYTHON_BIN" -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('yt_dlp') else 1)"; then
	echo "yt-dlp is required for YouTube search, preview, and downloads. Install downloader requirements first:"
	echo "  $PYTHON_BIN -m pip install -r downloader/requirements.txt"
	exit 1
fi

if ! "$PYTHON_BIN" -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('spotdl') else 1)"; then
	echo "Warning: spotdl is not installed. Spotify links will fail until you install downloader requirements:"
	echo "  $PYTHON_BIN -m pip install -r downloader/requirements.txt"
fi

echo "Starting music importer server on http://localhost:8765"
exec "$PYTHON_BIN" server.py
