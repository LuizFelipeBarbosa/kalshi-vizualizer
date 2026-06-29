"""FastAPI app for the Kalshi contract explorer — the deployable replacement for serve.py.

This module is a thin HTTP adapter: it reuses the pure handlers in :mod:`src.visualize.queries`
unchanged and only maps them to routes, plus serves the static SPA. ``serve.py`` (stdlib)
remains in the tree as a zero-dependency fallback.

Import purity: constructing the app via :func:`create_app` registers routes and mounts the
static dir but does *not* open a DuckDB connection — that happens in the lifespan handler when
the server actually starts (see the note in ``__init__.py``).

Concurrency: the endpoints are sync ``def`` so FastAPI runs each in its threadpool; every
request opens its own ``con.cursor()``, the same per-request isolation serve.py already used.
Across worker processes each worker runs the lifespan once and holds its own connection; the
DuckDB views are ``read_parquet`` globs (lazy scans), so per-worker memory stays modest.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from src.visualize.queries import (
    build_connection,
    handle_contract,
    handle_event,
    handle_events,
    handle_groups,
    handle_summary,
    load_summary,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"


def create_app(data_dir: Path | str, static_dir: Path | str = STATIC_DIR) -> FastAPI:
    """Build the FastAPI app that serves the explorer over ``data_dir``."""
    data_dir = Path(data_dir)
    static_dir = Path(static_dir)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Opened on startup (never at import), torn down on shutdown.
        app.state.con = build_connection(data_dir)
        app.state.summary = load_summary(data_dir)
        try:
            yield
        finally:
            app.state.con.close()

    app = FastAPI(title="Kalshi Tape", lifespan=lifespan)

    @app.exception_handler(Exception)
    def api_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content={"error": str(exc)})

    @app.get("/api/summary")
    def api_summary(request: Request) -> dict[str, Any]:
        return handle_summary(request.app.state.summary)

    @app.get("/api/groups")
    def api_groups(request: Request) -> dict[str, Any]:
        return handle_groups(request.app.state.summary)

    @app.get("/api/events")
    def api_events(
        request: Request,
        group: str = "",
        q: str = "",
        sort: str = "volume",
        page: Annotated[int, Query(ge=1)] = 1,
        page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    ) -> dict[str, Any]:
        # handle_events re-parses/whitelists internally; empty strings read as "no filter",
        # matching the stdlib server (query.get("group") or None / (q or "").strip()).
        return handle_events(
            request.app.state.con.cursor(),
            {"group": group, "q": q, "sort": sort, "page": str(page), "page_size": str(page_size)},
        )

    @app.get("/api/event/{event_ticker:path}")
    def api_event(request: Request, event_ticker: str) -> Any:
        status, body = handle_event(request.app.state.con.cursor(), event_ticker)
        if status != 200:
            return JSONResponse(status_code=status, content=body)
        return body

    @app.get("/api/contract/{ticker:path}")
    def api_contract(request: Request, ticker: str) -> Any:
        status, body = handle_contract(request.app.state.con.cursor(), ticker)
        if status != 200:
            return JSONResponse(status_code=status, content=body)
        return body

    @app.get("/api/{_path:path}", include_in_schema=False)
    def api_not_found(_path: str) -> JSONResponse:
        return JSONResponse(status_code=404, content={"error": "not found"})

    # Mounted LAST so /api/* wins. html=True serves index.html at "/" and assets (js/, css/)
    # directly; StaticFiles guards path traversal, so serve.py's manual check is unneeded.
    # The SPA routes via the URL hash, so no client-route catch-all is required.
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
    return app


def run(
    data_dir: Path | str,
    host: str = "127.0.0.1",
    port: int = 8000,
    workers: int = 1,
    reload: bool = False,
    open_browser: bool = True,
) -> None:
    """Launch the explorer with uvicorn (used by ``main.py visualize serve``).

    Production deployments should instead point uvicorn at the factory import string
    ``src.visualize.asgi:create_app`` with ``--factory`` (see the Dockerfile).
    """
    import webbrowser

    import uvicorn

    url = f"http://{host}:{port}"
    print(f"Kalshi contract explorer serving at {url}")
    print("Press Ctrl+C to stop.")
    # Browser-open only makes sense for the single-process dev server.
    if open_browser and workers <= 1 and not reload:
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001 - opening a browser is best-effort
            pass

    if reload or workers > 1:
        import os

        # Reload/workers require an import string so child processes can import the app.
        os.environ["SITE_DATA_DIR"] = str(Path(data_dir))
        uvicorn.run(
            "src.visualize.asgi:create_app",
            host=host,
            port=port,
            workers=workers,
            reload=reload,
            factory=True,
        )
        return

    uvicorn.run(create_app(data_dir), host=host, port=port)
