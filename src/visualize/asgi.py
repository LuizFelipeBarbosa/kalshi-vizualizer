"""ASGI factory for production servers.

Point uvicorn at ``src.visualize.asgi:create_app`` with factory mode. The dataset
location comes from the ``SITE_DATA_DIR`` env var (default ``output/site/data``). Importing this
module does not build the app, open a DuckDB connection, or read the environment.

Example:
    SITE_DATA_DIR=/data uvicorn src.visualize.asgi:create_app --factory --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI

from src.visualize.app import create_app as _create_app

DEFAULT_DATA_DIR = Path("output/site/data")


def create_app() -> FastAPI:
    """Create the ASGI app from the production environment."""
    return _create_app(Path(os.environ.get("SITE_DATA_DIR", DEFAULT_DATA_DIR)))
