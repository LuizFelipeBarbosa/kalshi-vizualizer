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

# /api/highlights tuning. The candidate pool is the top-K contracts by traded volume —
# that ranking IS the volume floor, so tiny test fixtures (K >> n_contracts) still
# produce a non-empty pool while the real dataset only surfaces heavily traded tape.
# Thresholds were tuned against the real dataset: the story categories carry a 1-day
# duration floor (the top-5000 pool contains ~400 sub-hour crypto blitz markets that
# would otherwise dominate), and photo_finish is defined on lifetime VWAP because a
# settled tape virtually never *closes* near 50c — it converges before settlement.
_HIGHLIGHT_POOL_K = 5000
_HIGHLIGHTS_PER_CATEGORY = 8
_STORY_MIN_DURATION_S = 86_400  # 1 day; keeps 15-minute churn markets out of the stories
_LONG_SHOT_MAX_MIN_PRICE = 10  # settled YES that traded at <= 10c
_STUNNER_MIN_MAX_PRICE = 90  # settled NO that traded at >= 90c
_PHOTO_FINISH_LO, _PHOTO_FINISH_HI = 45, 55  # lifetime VWAP near the 50c rail
_ROLLERCOASTER_MIN_RANGE = 60  # bucketed price range in cents
_MARATHON_MIN_DURATION_S = 90 * 86_400  # 90 days on the tape
_SPARKLINE_POINTS = 60
_HIGHLIGHT_CATEGORIES = ["long_shot", "stunner", "photo_finish", "rollercoaster", "marathon", "whale"]


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


def handle_highlights(
    con: duckdb.DuckDBPyConnection,
    pool_k: int = _HIGHLIGHT_POOL_K,
    per_category: int = _HIGHLIGHTS_PER_CATEGORY,
) -> dict[str, Any]:
    """Pick a pool of "interesting" contracts for the frontend spotlight.

    Six categories, each a ranking over the top-``pool_k``-by-volume contracts (price
    extremes come from the bucketed price series, so an extreme is a *persisted* level,
    not one stray trade). A contract appears at most once, assigned by a greedy cascade
    in priority order: a category only claims a contract it will actually display, so a
    contract that qualifies for a story category at a deep rank falls through to the
    next category instead of being claimed-then-cut (the two most-traded contracts ever
    are ~200th by marathon duration — they must still surface as whales). ``whale`` is
    threshold-free, so the pool is non-empty whenever any contract traded.
    Deterministic: every ranking tiebreaks on ticker.

    The result is static per dataset; the FastAPI adapter caches it per process (the
    stdlib serve.py fallback recomputes per request, which is fine for dev use).
    """
    cur = con.execute(
        """
        WITH pool AS (
            SELECT ticker, event_ticker, title, status, result,
                   traded_volume::BIGINT AS traded_volume, n_trades,
                   first_trade, last_trade, last_yes_price
            FROM contracts
            WHERE n_trades > 0
            ORDER BY traded_volume DESC
            LIMIT ?
        ),
        ps AS (
            -- One aggregate pass over price_series, restricted to the pool's tickers
            -- (semi-join) so we never GROUP BY the full multi-million-row table.
            SELECT ticker,
                   MIN(price)                                AS min_price,
                   MAX(price)                                AS max_price,
                   arg_min(bucket_ts, price)                 AS min_price_ts,
                   arg_max(bucket_ts, price)                 AS max_price_ts,
                   arg_min(price, bucket_index)              AS first_price,
                   arg_max(price, bucket_index)              AS last_price,
                   SUM(price * volume) / NULLIF(SUM(volume), 0) AS vwap
            FROM price_series
            WHERE ticker IN (SELECT ticker FROM pool)
            GROUP BY ticker
        ),
        stats AS (
            SELECT p.*,
                   ps.min_price, ps.max_price, ps.min_price_ts, ps.max_price_ts,
                   ps.first_price, ps.last_price, ps.vwap,
                   ps.max_price - ps.min_price                            AS price_range,
                   (epoch(p.last_trade) - epoch(p.first_trade))::BIGINT   AS duration_s,
                   (p.status = 'finalized' AND p.result IN ('yes', 'no')) AS settled
            FROM pool p
            JOIN ps USING (ticker)
        ),
        scored AS (
                SELECT *, 'long_shot' AS category, 1 AS priority,
                       ROW_NUMBER() OVER (ORDER BY min_price ASC, traded_volume DESC, ticker) AS cat_rank
                FROM stats WHERE settled AND result = 'yes' AND min_price <= ? AND duration_s >= ?
            UNION ALL
                SELECT *, 'stunner', 2,
                       ROW_NUMBER() OVER (ORDER BY max_price DESC, traded_volume DESC, ticker)
                FROM stats WHERE settled AND result = 'no' AND max_price >= ? AND duration_s >= ?
            UNION ALL
                SELECT *, 'photo_finish', 3,
                       ROW_NUMBER() OVER (ORDER BY traded_volume DESC, ticker)
                FROM stats WHERE settled AND vwap BETWEEN ? AND ? AND duration_s >= ?
            UNION ALL
                SELECT *, 'rollercoaster', 4,
                       ROW_NUMBER() OVER (ORDER BY price_range DESC, traded_volume DESC, ticker)
                FROM stats WHERE price_range >= ? AND duration_s >= ?
            UNION ALL
                SELECT *, 'marathon', 5,
                       ROW_NUMBER() OVER (ORDER BY duration_s DESC, traded_volume DESC, ticker)
                FROM stats WHERE duration_s >= ?
            UNION ALL
                SELECT *, 'whale', 6,
                       ROW_NUMBER() OVER (ORDER BY traded_volume DESC, ticker)
                FROM stats
        )
        SELECT
            s.category, s.priority, s.cat_rank,
            s.ticker, s.event_ticker, s.title, s.status, s.result,
            s.traded_volume, s.n_trades,
            epoch(s.first_trade)::BIGINT  AS first_trade,
            epoch(s.last_trade)::BIGINT   AS last_trade,
            s.duration_s,
            s.min_price, s.max_price, s.price_range, s.vwap,
            epoch(s.min_price_ts)::BIGINT AS min_price_t,
            epoch(s.max_price_ts)::BIGINT AS max_price_t,
            s.first_price, s.last_price, s.last_yes_price,
            e."group", e.color
        FROM scored s
        LEFT JOIN events e ON s.event_ticker = e.event_ticker
        -- Depth cap: category N can lose at most (N-1) * per_category picks to
        -- higher-priority categories, so per_category * n_categories rows per
        -- category always suffice for the cascade below.
        WHERE s.cat_rank <= ?
        ORDER BY s.priority, s.cat_rank
        """,
        [
            pool_k,
            _LONG_SHOT_MAX_MIN_PRICE,
            _STORY_MIN_DURATION_S,
            _STUNNER_MIN_MAX_PRICE,
            _STORY_MIN_DURATION_S,
            _PHOTO_FINISH_LO,
            _PHOTO_FINISH_HI,
            _STORY_MIN_DURATION_S,
            _ROLLERCOASTER_MIN_RANGE,
            _STORY_MIN_DURATION_S,
            _MARATHON_MIN_DURATION_S,
            per_category * len(_HIGHLIGHT_CATEGORIES),
        ],
    )
    # Greedy cascade over rows already ordered by (priority, cat_rank): each category
    # takes its best per_category still-unclaimed contracts; everything else falls
    # through to lower-priority categories.
    chosen: list[dict[str, Any]] = []
    claimed: set = set()
    counts: dict[str, int] = {}
    for row in _rows(cur):
        cat = row["category"]
        if row["ticker"] in claimed or counts.get(cat, 0) >= per_category:
            continue
        claimed.add(row["ticker"])
        counts[cat] = counts.get(cat, 0) + 1
        row["rank"] = counts[cat]
        del row["priority"], row["cat_rank"]
        chosen.append(row)

    sparks = _sparklines_for(con, [r["ticker"] for r in chosen])
    return {
        "highlights": [dict(r, sparkline=sparks.get(r["ticker"], [])) for r in chosen],
        "categories": list(_HIGHLIGHT_CATEGORIES),
    }


def _sparklines_for(con: duckdb.DuckDBPyConnection, tickers: list[str]) -> dict[str, list[dict[str, Any]]]:
    """Fetch thinned {t, price} series for the highlight winners (volume omitted)."""
    if not tickers:
        return {}
    placeholders = ",".join("?" for _ in tickers)
    cur = con.execute(
        f"""
        SELECT ticker, epoch(bucket_ts)::BIGINT AS t, price
        FROM price_series
        WHERE ticker IN ({placeholders})
        ORDER BY ticker, bucket_index
        """,
        tickers,
    )
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in _rows(cur):
        grouped.setdefault(row["ticker"], []).append({"t": row["t"], "price": row["price"]})
    return {t: _thin_points(points) for t, points in grouped.items()}


def _thin_points(points: list[dict[str, Any]], max_points: int = _SPARKLINE_POINTS) -> list[dict[str, Any]]:
    """Stride-thin a point list to ~max_points, always keeping the final point."""
    if len(points) <= max_points:
        return points
    step = -(-len(points) // max_points)  # ceil division
    thinned = points[::step]
    if thinned[-1] is not points[-1]:
        thinned.append(points[-1])
    return thinned


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
    if path == "/api/highlights":
        return 200, handle_highlights(con)
    if path.startswith("/api/event/"):
        event_ticker = unquote(path[len("/api/event/") :])
        return handle_event(con, event_ticker)
    if path.startswith("/api/contract/"):
        ticker = unquote(path[len("/api/contract/") :])
        return handle_contract(con, ticker)
    return 404, {"error": "not found"}
