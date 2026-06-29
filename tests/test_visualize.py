"""Tests for the visualize subsystem (build pass + pure JSON API handlers).

These reuse the tiny synthetic Kalshi fixtures from ``conftest.py`` (2 markets / 2,100
trades). The markets fixture deliberately lacks ``title``/``open_time``/``close_time``/
``_fetched_at``, so this also exercises the DESCRIBE-probe optional-column fallback in the
build. The API is tested through ``dispatch`` directly — no socket is ever bound.
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import pandas as pd
import pytest

from src.visualize.build import build_site_dataset
from src.visualize.queries import build_connection, dispatch, load_summary


@pytest.fixture
def built(tmp_path: Path, kalshi_trades_dir: Path, kalshi_markets_dir: Path) -> Path:
    out = tmp_path / "data"
    build_site_dataset(
        trades_dir=kalshi_trades_dir,
        markets_dir=kalshi_markets_dir,
        out_dir=out,
        n_buckets=50,
    )
    return out


def test_build_creates_all_artifacts(built: Path) -> None:
    for name in ("category_lookup", "contracts", "events", "price_series"):
        assert (built / f"{name}.parquet").is_file()
    assert (built / "summary.json").is_file()


def test_contracts_and_title_fallback(built: Path) -> None:
    con = duckdb.connect()
    contracts = con.execute(f"SELECT * FROM '{built / 'contracts.parquet'}'").df()
    assert set(contracts["ticker"]) == {"MKT-A", "MKT-B"}
    assert {"event_ticker", "status", "result", "n_trades", "traded_volume"} <= set(contracts.columns)
    # The fixture has no `title` column -> it falls back to the ticker.
    assert (contracts["title"] == contracts["ticker"]).all()
    # Both contracts have trades, so n_trades > 0 and they survive the traded-only default.
    assert (contracts["n_trades"] > 0).all()


def test_events_category_join(built: Path) -> None:
    con = duckdb.connect()
    events = con.execute(f"SELECT event_ticker, \"group\" FROM '{built / 'events.parquet'}'").df()
    groups = dict(zip(events["event_ticker"], events["group"]))
    assert groups["INXD-24JAN01"] == "Finance"
    assert groups["NFLGAME-25FEB01"] == "Sports"


def test_price_series_downsample_cap(built: Path) -> None:
    con = duckdb.connect()
    counts = con.execute(
        f"SELECT ticker, COUNT(*) AS n, MIN(price) AS lo, MAX(price) AS hi "
        f"FROM '{built / 'price_series.parquet'}' GROUP BY ticker"
    ).df()
    assert (counts["n"] <= 50).all()
    assert (counts["lo"] >= 1).all()
    assert (counts["hi"] <= 99).all()


def test_summary_shape(built: Path) -> None:
    summary = load_summary(built)
    assert summary["n_events"] == 2
    assert summary["n_contracts"] == 2
    assert summary["total_volume"] > 0
    group_names = {g["group"] for g in summary["groups"]}
    assert {"Finance", "Sports"} <= group_names
    assert all("color" in g for g in summary["groups"])


def test_dispatch_summary_and_groups(built: Path) -> None:
    con = build_connection(built)
    summary = load_summary(built)
    status, body = dispatch(con, summary, "/api/summary", {})
    assert status == 200 and body["n_contracts"] == 2
    status, body = dispatch(con, summary, "/api/groups", {})
    assert status == 200 and len(body["groups"]) >= 2


def test_dispatch_events_pagination(built: Path) -> None:
    con = build_connection(built)
    summary = load_summary(built)
    status, body = dispatch(con, summary, "/api/events", {})
    assert status == 200
    assert body["total"] == 2
    assert body["page"] == 1
    assert {e["event_ticker"] for e in body["events"]} == {"INXD-24JAN01", "NFLGAME-25FEB01"}
    # Group filter narrows results.
    status, body = dispatch(con, summary, "/api/events", {"group": "Sports"})
    assert [e["event_ticker"] for e in body["events"]] == ["NFLGAME-25FEB01"]


def test_dispatch_event_and_contract(built: Path) -> None:
    con = build_connection(built)
    summary = load_summary(built)
    status, body = dispatch(con, summary, "/api/event/NFLGAME-25FEB01", {})
    assert status == 200
    assert any(c["ticker"] == "MKT-B" for c in body["contracts"])
    assert any(s["ticker"] == "MKT-B" and s["points"] for s in body["series"])

    status, body = dispatch(con, summary, "/api/contract/MKT-A", {})
    assert status == 200
    assert body["ticker"] == "MKT-A"
    assert len(body["points"]) > 0
    assert all(set(p) == {"t", "price", "volume"} for p in body["points"])

    status, body = dispatch(con, summary, "/api/contract/DOES-NOT-EXIST", {})
    assert status == 404


def test_dispatch_unknown_route(built: Path) -> None:
    con = build_connection(built)
    summary = load_summary(built)
    status, body = dispatch(con, summary, "/api/nope", {})
    assert status == 404


def test_search_is_injection_safe(built: Path) -> None:
    con = build_connection(built)
    summary = load_summary(built)
    # A malicious search term must not error or mutate anything.
    status, body = dispatch(con, summary, "/api/events", {"q": "'; DROP TABLE events;--"})
    assert status == 200
    assert body["total"] == 0
    # The dataset is intact afterwards.
    status, body = dispatch(con, summary, "/api/events", {})
    assert body["total"] == 2


def test_build_accepts_injected_connection(tmp_path: Path, kalshi_trades_dir: Path, kalshi_markets_dir: Path) -> None:
    con = duckdb.connect()
    paths = build_site_dataset(
        trades_dir=kalshi_trades_dir,
        markets_dir=kalshi_markets_dir,
        out_dir=tmp_path / "d",
        n_buckets=10,
        con=con,
    )
    # Connection stays usable (build must not close an injected connection).
    n = con.execute(f"SELECT COUNT(*) FROM '{paths['contracts']}'").fetchone()[0]
    assert n == 2
    counts = pd.read_parquet(paths["price_series"]).groupby("ticker").size()
    assert (counts <= 10).all()
