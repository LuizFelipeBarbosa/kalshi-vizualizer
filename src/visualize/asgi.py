"""ASGI entrypoint for production servers.

Point uvicorn/gunicorn at ``src.visualize.asgi:app``; the dataset location comes from the
``SITE_DATA_DIR`` env var (default ``output/site/data``). Building the app here is import-pure
— it registers routes and mounts the static dir but opens no DuckDB connection until the
server triggers the lifespan handler.

Example:
    SITE_DATA_DIR=/data uvicorn src.visualize.asgi:app --host 0.0.0.0 --port 8000 --workers 4
"""

from __future__ import annotations

import os
from pathlib import Path

from src.visualize.app import create_app

app = create_app(Path(os.environ.get("SITE_DATA_DIR", "output/site/data")))
