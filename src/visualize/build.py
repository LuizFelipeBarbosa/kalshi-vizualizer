"""Build the compact "site dataset" for the Kalshi contract explorer.

This is the heavy, one-time pass. It scans the raw ``data/kalshi/{markets,trades}``
parquet globs (tens of millions of trades) and distills them into a handful of small,
key-sorted parquet files plus a ``summary.json`` under ``output/site/data/``. The live
server (:mod:`src.visualize.serve`) then only ever touches this compact dataset, so
per-event / per-contract lookups stay fast via parquet row-group pruning.

Outputs (all under ``out_dir``):

* ``category_lookup.parquet`` — event-ticker prefix -> (group, category, subcategory, color)
* ``contracts.parquet`` — one row per contract, SORTED BY ``event_ticker``
* ``events.parquet`` — one row per event, SORTED BY (``group``, ``total_volume`` DESC)
* ``price_series.parquet`` — <= ``n_buckets`` points per contract, SORTED BY ``ticker``
* ``summary.json`` — global stats + per-group rollups

The same code runs against the full 36GiB dataset and against the tiny synthetic test
fixtures: optional market columns (``title``/``open_time``/``close_time``/``_fetched_at``)
are probed via ``DESCRIBE`` and filled with safe fallbacks when absent.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

from src.analysis.kalshi.util.categories import CATEGORY_SQL, GROUP_COLORS, get_hierarchy

if TYPE_CHECKING:
    import duckdb


def _default_data_dir() -> Path:
    # src/visualize/build.py -> repo root is three parents up.
    return Path(__file__).parent.parent.parent / "data" / "kalshi"


def _market_columns(con: duckdb.DuckDBPyConnection, markets_glob: str) -> set[str]:
    """Return the set of column names available in the markets parquet."""
    rows = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{markets_glob}')").fetchall()
    return {r[0] for r in rows}


def _markets_projection(cols: set[str]) -> tuple[str, str]:
    """Build the SELECT projection for the deduped markets CTE and its dedup ordering.

    Returns ``(projection_sql, dedup_order_sql)``. Columns that may be missing on minimal
    fixtures are emitted with NULL/derived fallbacks so the query binds either way.
    """
    title = "title" if "title" in cols else "ticker AS title"
    open_time = "open_time" if "open_time" in cols else "CAST(NULL AS TIMESTAMP) AS open_time"
    close_time = "close_time" if "close_time" in cols else "CAST(NULL AS TIMESTAMP) AS close_time"
    volume = "volume AS market_volume" if "volume" in cols else "CAST(NULL AS BIGINT) AS market_volume"
    projection = ",\n                ".join(
        [
            "ticker",
            "event_ticker",
            title,
            "status",
            "result",
            volume,
            open_time,
            close_time,
        ]
    )
    # Keep the freshest market row per ticker. Real data has _fetched_at; fixtures don't.
    dedup_order = "_fetched_at DESC" if "_fetched_at" in cols else "ticker"
    return projection, dedup_order


def _build_category_lookup(con: duckdb.DuckDBPyConnection, contracts_path: Path, out_path: Path) -> None:
    """Freeze the Python category mapping into a joinable parquet.

    The distinct event-ticker prefixes (a few thousand) are mapped once in Python via
    ``get_hierarchy`` so the (group, category, subcategory, color) tree never needs to be
    recomputed per-row or at serve time.
    """
    import pandas as pd

    prefixes = con.execute(f"SELECT DISTINCT {CATEGORY_SQL} AS prefix FROM read_parquet('{contracts_path}')").fetchall()
    rows = []
    for (prefix,) in prefixes:
        group, category, subcategory = get_hierarchy(prefix or "")
        rows.append(
            {
                "prefix": prefix,
                "group": group,
                "category": category,
                "subcategory": subcategory,
                "color": GROUP_COLORS.get(group, "#aaaaaa"),
            }
        )
    lookup_df = pd.DataFrame(rows, columns=["prefix", "group", "category", "subcategory", "color"])
    con.register("category_lookup_tmp", lookup_df)
    con.execute(f"COPY category_lookup_tmp TO '{out_path}' (FORMAT parquet)")
    con.unregister("category_lookup_tmp")


def build_site_dataset(
    trades_dir: Path | str | None = None,
    markets_dir: Path | str | None = None,
    out_dir: Path | str | None = None,
    n_buckets: int = 200,
    include_untraded: bool = False,
    con: duckdb.DuckDBPyConnection | None = None,
) -> dict[str, Path]:
    """Distill raw Kalshi trades + markets into the compact site dataset.

    Args:
        trades_dir: directory of ``trades_*.parquet`` (defaults to ``data/kalshi/trades``).
        markets_dir: directory of ``markets_*.parquet`` (defaults to ``data/kalshi/markets``).
        out_dir: destination for the built dataset (defaults to ``output/site/data``).
        n_buckets: max number of downsampled price points per contract.
        include_untraded: if True, keep markets that have zero trades (flat charts).
        con: optional DuckDB connection (injectable for tests).

    Returns:
        Mapping of artifact name -> written path.
    """
    import duckdb

    base = _default_data_dir()
    trades_dir = Path(trades_dir) if trades_dir is not None else base / "trades"
    markets_dir = Path(markets_dir) if markets_dir is not None else base / "markets"
    if out_dir is not None:
        out_dir = Path(out_dir)
    else:
        out_dir = Path(__file__).parent.parent.parent / "output" / "site" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)

    n_buckets = max(1, int(n_buckets))
    trades_glob = f"{trades_dir}/*.parquet"
    markets_glob = f"{markets_dir}/*.parquet"

    owns_con = con is None
    con = con or duckdb.connect()

    paths = {
        "category_lookup": out_dir / "category_lookup.parquet",
        "contracts": out_dir / "contracts.parquet",
        "events": out_dir / "events.parquet",
        "price_series": out_dir / "price_series.parquet",
        "summary": out_dir / "summary.json",
    }

    try:
        cols = _market_columns(con, markets_glob)
        projection, dedup_order = _markets_projection(cols)
        trade_filter = "" if include_untraded else "WHERE COALESCE(ta.n_trades, 0) > 0"

        # 1) contracts.parquet — markets LEFT JOIN trade aggregates, sorted by event_ticker.
        con.execute(
            f"""
            COPY (
                WITH trade_agg AS (
                    SELECT
                        ticker,
                        COUNT(*)                          AS n_trades,
                        SUM(count)                        AS traded_volume,
                        MIN(created_time)                 AS first_trade,
                        MAX(created_time)                 AS last_trade,
                        arg_max(yes_price, created_time)  AS last_yes_price
                    FROM read_parquet('{trades_glob}')
                    GROUP BY ticker
                ),
                m AS (
                    SELECT
                        {projection}
                    FROM read_parquet('{markets_glob}')
                    QUALIFY ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY {dedup_order}) = 1
                )
                SELECT
                    m.ticker,
                    m.event_ticker,
                    COALESCE(m.title, m.ticker)        AS title,
                    m.status,
                    m.result,
                    COALESCE(m.market_volume, 0)       AS market_volume,
                    m.open_time,
                    m.close_time,
                    COALESCE(ta.n_trades, 0)           AS n_trades,
                    COALESCE(ta.traded_volume, 0)      AS traded_volume,
                    ta.first_trade,
                    ta.last_trade,
                    ta.last_yes_price
                FROM m
                LEFT JOIN trade_agg ta ON m.ticker = ta.ticker
                {trade_filter}
                ORDER BY m.event_ticker
            ) TO '{paths["contracts"]}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)
            """
        )

        # 2) category_lookup.parquet — prefix -> (group, category, subcategory, color).
        _build_category_lookup(con, paths["contracts"], paths["category_lookup"])

        # 3) events.parquet — aggregate contracts by event, join the category tree.
        category_sql_c = CATEGORY_SQL.replace("event_ticker", "c.event_ticker")
        con.execute(
            f"""
            COPY (
                WITH ev AS (
                    SELECT
                        c.event_ticker,
                        {category_sql_c}                              AS prefix,
                        arg_max(c.title, c.traded_volume)             AS sample_title,
                        COUNT(*)                                      AS n_contracts,
                        COUNT(*) FILTER (WHERE c.n_trades > 0)        AS n_traded_contracts,
                        COALESCE(SUM(c.traded_volume), 0)             AS total_volume,
                        MIN(c.first_trade)                            AS first_trade,
                        MAX(c.last_trade)                             AS last_trade,
                        bool_or(c.status = 'open')                    AS has_open
                    FROM read_parquet('{paths["contracts"]}') c
                    WHERE c.event_ticker IS NOT NULL AND c.event_ticker <> ''
                    GROUP BY c.event_ticker, prefix
                )
                SELECT
                    ev.event_ticker,
                    cl."group",
                    cl.category,
                    cl.subcategory,
                    cl.color,
                    ev.sample_title,
                    ev.n_contracts,
                    ev.n_traded_contracts,
                    ev.total_volume,
                    ev.first_trade,
                    ev.last_trade,
                    ev.has_open,
                    lower(ev.event_ticker || ' ' || COALESCE(ev.sample_title, '')) AS search_blob
                FROM ev
                LEFT JOIN read_parquet('{paths["category_lookup"]}') cl ON ev.prefix = cl.prefix
                ORDER BY cl."group", ev.total_volume DESC
            ) TO '{paths["events"]}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 50000)
            """
        )

        # 4) price_series.parquet — equal-time downsample of each contract's lifetime.
        con.execute(
            f"""
            COPY (
                WITH bounds AS (
                    SELECT
                        ticker,
                        MIN(created_time)                                AS t0,
                        epoch(MAX(created_time)) - epoch(MIN(created_time)) AS span_s
                    FROM read_parquet('{trades_glob}')
                    GROUP BY ticker
                ),
                bucketed AS (
                    SELECT
                        t.ticker,
                        CASE
                            WHEN b.span_s <= 0 THEN 1
                            ELSE least(
                                {n_buckets},
                                1 + CAST(
                                    (epoch(t.created_time) - epoch(b.t0)) / (b.span_s / {n_buckets})
                                    AS INTEGER
                                )
                            )
                        END                              AS bucket_index,
                        t.yes_price,
                        t.count,
                        t.created_time
                    FROM read_parquet('{trades_glob}') t
                    JOIN bounds b ON t.ticker = b.ticker
                )
                SELECT
                    ticker,
                    bucket_index,
                    arg_max(yes_price, created_time)  AS price,
                    max(created_time)                 AS bucket_ts,
                    sum(count)                        AS volume
                FROM bucketed
                GROUP BY ticker, bucket_index
                ORDER BY ticker, bucket_index
            ) TO '{paths["price_series"]}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)
            """
        )

        # 5) summary.json — global stats + per-group rollups.
        _write_summary(con, paths)
    finally:
        if owns_con:
            con.close()

    return paths


def _write_summary(con: duckdb.DuckDBPyConnection, paths: dict[str, Path]) -> None:
    contracts = paths["contracts"]
    events = paths["events"]

    stats = con.execute(
        f"""
        SELECT
            (SELECT COUNT(*) FROM read_parquet('{events}'))                              AS n_events,
            (SELECT COUNT(*) FROM read_parquet('{contracts}'))                           AS n_contracts,
            (SELECT COUNT(*) FROM read_parquet('{contracts}') WHERE n_trades > 0)        AS n_traded_contracts,
            (SELECT COALESCE(SUM(traded_volume), 0) FROM read_parquet('{contracts}'))    AS total_volume,
            (SELECT COALESCE(SUM(n_trades), 0) FROM read_parquet('{contracts}'))         AS n_trades,
            (SELECT epoch(MIN(first_trade))::BIGINT FROM read_parquet('{contracts}'))    AS first_trade,
            (SELECT epoch(MAX(last_trade))::BIGINT FROM read_parquet('{contracts}'))     AS last_trade
        """
    ).fetchone()

    group_rows = con.execute(
        f"""
        SELECT
            "group",
            any_value(color)            AS color,
            COUNT(*)                    AS n_events,
            SUM(n_traded_contracts)     AS n_contracts,
            SUM(total_volume)           AS total_volume
        FROM read_parquet('{events}')
        GROUP BY "group"
        ORDER BY total_volume DESC
        """
    ).fetchall()

    summary = {
        "n_events": int(stats[0] or 0),
        "n_contracts": int(stats[1] or 0),
        "n_traded_contracts": int(stats[2] or 0),
        "total_volume": int(stats[3] or 0),
        "n_trades": int(stats[4] or 0),
        "first_trade": int(stats[5]) if stats[5] is not None else None,
        "last_trade": int(stats[6]) if stats[6] is not None else None,
        "groups": [
            {
                "group": g[0],
                "color": g[1],
                "n_events": int(g[2] or 0),
                "n_contracts": int(g[3] or 0),
                "total_volume": int(g[4] or 0),
            }
            for g in group_rows
        ],
    }
    paths["summary"].write_text(json.dumps(summary, indent=2))
