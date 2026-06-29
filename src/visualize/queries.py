"""Pure, socket-free JSON API for the contract explorer.

Every handler here is a plain function over a DuckDB connection (and the prebuilt
``summary.json`` dict). They never touch sockets, so they are unit-testable directly
(see ``tests/test_visualize.py``); :mod:`src.visualize.serve` is the only place that
binds a port and adapts these to ``BaseHTTPRequestHandler``.

Security: every value that originates from the URL (``q``, ``event_ticker``, ``ticker``,
``page``) is passed through DuckDB parameter binding (``?`` placeholders), never string
interpolation. The single non-bindable knob — the ``/api/events`` ORDER BY — is chosen
from a fixed whitelist, so ``sort`` selects a clause, it can never inject SQL.
"""

from __future__ import annotations

import decimal
import json
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import unquote

if TYPE_CHECKING:
    import duckdb

# Whitelisted sort orders for /api/events. The key comes from the URL; the clause never does.
_EVENT_ORDER = {
    "volume": "total_volume DESC",
    "recent": "last_trade DESC NULLS LAST",
    "contracts": "n_contracts DESC",
    "ticker": "event_ticker ASC",
}

_DEFAULT_PAGE_SIZE = 50
_MAX_PAGE_SIZE = 200
_EVENT_CONTRACTS_LIMIT = 500  # contracts listed on an event page
_EVENT_SERIES_LIMIT = 40  # overlaid price lines on an event page


def build_connection(data_dir: Path | str) -> duckdb.DuckDBPyConnection:
    """Open a DuckDB connection with stable views over the built site dataset."""
    import duckdb

    data_dir = Path(data_dir)
    con = duckdb.connect(":memory:")
    for view in ("events", "contracts", "price_series"):
        path = data_dir / f"{view}.parquet"
        con.execute(f"CREATE VIEW {view} AS SELECT * FROM read_parquet({_sql_string(path)})")
    return con


def _sql_string(value: Path | str) -> str:
    """Return a DuckDB SQL string literal for statements that cannot be prepared."""
    return "'" + str(value).replace("'", "''") + "'"


def load_summary(data_dir: Path | str) -> dict[str, Any]:
    """Load the prebuilt global summary (stats + per-group rollups)."""
    return json.loads((Path(data_dir) / "summary.json").read_text())


def _jsonable(value: Any) -> Any:
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _rows(cur: duckdb.DuckDBPyConnection) -> list[dict[str, Any]]:
    columns = [d[0] for d in cur.description]
    return [{c: _jsonable(v) for c, v in zip(columns, row)} for row in cur.fetchall()]


def handle_summary(summary: dict[str, Any]) -> dict[str, Any]:
    return summary


def handle_groups(summary: dict[str, Any]) -> dict[str, Any]:
    return {"groups": summary.get("groups", [])}


def handle_events(con: duckdb.DuckDBPyConnection, query: dict[str, str]) -> dict[str, Any]:
    group = query.get("group") or None
    raw_q = (query.get("q") or "").strip()
    sort = query.get("sort") or "volume"
    order_sql = _EVENT_ORDER.get(sort, _EVENT_ORDER["volume"])

    try:
        page = max(1, int(query.get("page", 1) or 1))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(query.get("page_size", _DEFAULT_PAGE_SIZE) or _DEFAULT_PAGE_SIZE)
    except (TypeError, ValueError):
        page_size = _DEFAULT_PAGE_SIZE
    page_size = min(_MAX_PAGE_SIZE, max(1, page_size))

    q_like = None
    if raw_q:
        escaped = raw_q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        q_like = f"%{escaped}%"

    where = "WHERE (? IS NULL OR \"group\" = ?) AND (? IS NULL OR search_blob LIKE ? ESCAPE '\\')"
    filter_params = [group, group, q_like, q_like]

    total = con.execute(f"SELECT COUNT(*) FROM events {where}", filter_params).fetchone()[0]
    total = int(total or 0)
    total_pages = max(1, -(-total // page_size))  # ceil division

    cur = con.execute(
        f"""
        SELECT
            event_ticker,
            "group",
            category,
            subcategory,
            color,
            sample_title,
            n_contracts,
            n_traded_contracts,
            total_volume,
            epoch(first_trade)::BIGINT AS first_trade,
            epoch(last_trade)::BIGINT  AS last_trade,
            has_open
        FROM events
        {where}
        ORDER BY {order_sql}
        LIMIT ? OFFSET ?
        """,
        filter_params + [page_size, (page - 1) * page_size],
    )
    return {
        "events": _rows(cur),
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "total": total,
    }


def handle_event(con: duckdb.DuckDBPyConnection, event_ticker: str) -> tuple[int, dict[str, Any]]:
    header_rows = _rows(
        con.execute(
            """
            SELECT event_ticker, "group", category, subcategory, color, sample_title,
                   n_contracts, n_traded_contracts, total_volume,
                   epoch(first_trade)::BIGINT AS first_trade,
                   epoch(last_trade)::BIGINT  AS last_trade,
                   has_open
            FROM events WHERE event_ticker = ?
            """,
            [event_ticker],
        )
    )
    if not header_rows:
        return 404, {"error": "event not found"}
    header = header_rows[0]

    contracts = _rows(
        con.execute(
            """
            SELECT ticker, title, status, result, market_volume, traded_volume, n_trades,
                   epoch(open_time)::BIGINT   AS open_time,
                   epoch(close_time)::BIGINT  AS close_time,
                   epoch(first_trade)::BIGINT AS first_trade,
                   epoch(last_trade)::BIGINT  AS last_trade,
                   last_yes_price
            FROM contracts WHERE event_ticker = ?
            ORDER BY traded_volume DESC
            LIMIT ?
            """,
            [event_ticker, _EVENT_CONTRACTS_LIMIT],
        )
    )

    series_tickers = [c["ticker"] for c in contracts[:_EVENT_SERIES_LIMIT]]
    series = _series_for(con, series_tickers)

    return 200, {
        "event_ticker": header["event_ticker"],
        "group": header["group"],
        "category": header["category"],
        "subcategory": header["subcategory"],
        "color": header["color"],
        "title": header["sample_title"],
        "n_contracts": header["n_contracts"],
        "total_volume": header["total_volume"],
        "first_trade": header["first_trade"],
        "last_trade": header["last_trade"],
        "contracts": contracts,
        "series": series,
    }


def handle_contract(con: duckdb.DuckDBPyConnection, ticker: str) -> tuple[int, dict[str, Any]]:
    meta_rows = _rows(
        con.execute(
            """
            SELECT ticker, event_ticker, title, status, result, market_volume, traded_volume, n_trades,
                   epoch(open_time)::BIGINT   AS open_time,
                   epoch(close_time)::BIGINT  AS close_time,
                   epoch(first_trade)::BIGINT AS first_trade,
                   epoch(last_trade)::BIGINT  AS last_trade,
                   last_yes_price
            FROM contracts WHERE ticker = ?
            """,
            [ticker],
        )
    )
    if not meta_rows:
        return 404, {"error": "contract not found"}

    body = dict(meta_rows[0])
    # Enrich with the parent event's group/color so the view can theme the chart.
    event_ticker = body.get("event_ticker")
    if event_ticker:
        ev = _rows(con.execute('SELECT "group", color FROM events WHERE event_ticker = ?', [event_ticker]))
        if ev:
            body["group"] = ev[0]["group"]
            body["color"] = ev[0]["color"]
    body["points"] = _points_for(con, ticker)
    return 200, body


def _series_for(con: duckdb.DuckDBPyConnection, tickers: list[str]) -> list[dict[str, Any]]:
    if not tickers:
        return []
    placeholders = ",".join("?" for _ in tickers)
    cur = con.execute(
        f"""
        SELECT ticker, epoch(bucket_ts)::BIGINT AS t, price, volume
        FROM price_series
        WHERE ticker IN ({placeholders})
        ORDER BY ticker, bucket_index
        """,
        tickers,
    )
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in _rows(cur):
        grouped.setdefault(row["ticker"], []).append({"t": row["t"], "price": row["price"], "volume": row["volume"]})
    # Preserve the volume-ranked order the caller passed in.
    return [{"ticker": t, "points": grouped.get(t, [])} for t in tickers if t in grouped]


def _points_for(con: duckdb.DuckDBPyConnection, ticker: str) -> list[dict[str, Any]]:
    cur = con.execute(
        """
        SELECT epoch(bucket_ts)::BIGINT AS t, price, volume
        FROM price_series WHERE ticker = ?
        ORDER BY bucket_index
        """,
        [ticker],
    )
    return _rows(cur)


def dispatch(
    con: duckdb.DuckDBPyConnection,
    summary: dict[str, Any],
    path: str,
    query: dict[str, str],
) -> tuple[int, dict[str, Any]]:
    """Route an ``/api/...`` path to a handler. Returns ``(status, json_body)``."""
    if path == "/api/summary":
        return 200, handle_summary(summary)
    if path == "/api/groups":
        return 200, handle_groups(summary)
    if path == "/api/events":
        return 200, handle_events(con, query)
    if path.startswith("/api/event/"):
        event_ticker = unquote(path[len("/api/event/") :])
        return handle_event(con, event_ticker)
    if path.startswith("/api/contract/"):
        ticker = unquote(path[len("/api/contract/") :])
        return handle_contract(con, ticker)
    return 404, {"error": "not found"}
