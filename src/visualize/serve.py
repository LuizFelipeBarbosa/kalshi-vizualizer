"""Thin static + JSON server for the Kalshi contract explorer.

This is the only module that touches sockets. It binds a ``ThreadingHTTPServer`` on
localhost, serves the committed frontend from ``static/``, and delegates ``/api/*`` to
the pure handlers in :mod:`src.visualize.queries`. No web framework — stdlib only.
"""

from __future__ import annotations

import functools
import json
import mimetypes
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, urlparse

from src.visualize.queries import build_connection, dispatch, load_summary

if TYPE_CHECKING:
    import duckdb

STATIC_DIR = Path(__file__).resolve().parent / "static"


class _Handler(BaseHTTPRequestHandler):
    server_version = "KalshiExplorer/1.0"

    def __init__(
        self,
        *args: Any,
        con: duckdb.DuckDBPyConnection,
        summary: dict[str, Any],
        static_dir: Path,
        **kwargs: Any,
    ) -> None:
        # Attributes must be set before super().__init__, which dispatches the request.
        self._con = con
        self._summary = summary
        self._static_dir = static_dir
        super().__init__(*args, **kwargs)

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A002 - stdlib signature
        # Keep one terse line per request instead of the noisy default.
        return

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler name
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api(parsed.path, parsed.query)
        else:
            self._serve_static(parsed.path)

    def _handle_api(self, path: str, raw_query: str) -> None:
        query = {k: v[-1] for k, v in parse_qs(raw_query).items()}
        try:
            # A per-request cursor isolates concurrent threads sharing the same database.
            status, body = dispatch(self._con.cursor(), self._summary, path, query)
        except Exception as exc:  # noqa: BLE001 - surface any query error as 500 JSON
            status, body = 500, {"error": str(exc)}
        self._send_json(status, body)

    def _send_json(self, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _serve_static(self, url_path: str) -> None:
        rel = url_path.lstrip("/") or "index.html"
        target = (self._static_dir / rel).resolve()

        # Path-traversal guard: the resolved path must stay under the static root.
        if not str(target).startswith(str(self._static_dir)):
            self.send_error(403, "Forbidden")
            return

        if not target.is_file():
            # SPA fallback: unknown non-asset paths return the shell so client routing works.
            target = self._static_dir / "index.html"
            if not target.is_file():
                self.send_error(404, "Not found")
                return

        content = target.read_bytes()
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def run_server(
    port: int = 8000,
    data_dir: Path | str | None = None,
    host: str = "127.0.0.1",
    static_dir: Path | str | None = None,
    open_browser: bool = True,
) -> None:
    """Serve the explorer until interrupted.

    Args:
        port: TCP port to bind on localhost.
        data_dir: directory of the built site dataset (defaults to ``output/site/data``).
        host: interface to bind (localhost by default).
        static_dir: frontend assets dir (defaults to the packaged ``static/``).
        open_browser: open the default browser at startup.
    """
    if data_dir is None:
        data_dir = Path(__file__).parent.parent.parent / "output" / "site" / "data"
    data_dir = Path(data_dir)
    static_dir = Path(static_dir) if static_dir is not None else STATIC_DIR

    con = build_connection(data_dir)
    summary = load_summary(data_dir)

    handler = functools.partial(_Handler, con=con, summary=summary, static_dir=static_dir)
    httpd = ThreadingHTTPServer((host, port), handler)

    url = f"http://{host}:{port}"
    print(f"Kalshi contract explorer serving at {url}")
    print("Press Ctrl+C to stop.")
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001 - opening a browser is best-effort
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        httpd.server_close()
        con.close()
