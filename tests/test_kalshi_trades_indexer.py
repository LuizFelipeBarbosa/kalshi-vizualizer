from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd
import pytest

import src.common.client as client_mod
import src.indexers.kalshi.client as kalshi_client_mod
import src.indexers.kalshi.trades as trades_mod
from src.common.client import HttpClient, RateLimiter
from src.indexers.kalshi.client import KalshiClient
from src.indexers.kalshi.models import Trade
from src.indexers.kalshi.trades import KalshiTradesIndexer


def _trade_response(trade_id: str, ticker: str = "TEST") -> dict:
    return {
        "trade_id": trade_id,
        "ticker": ticker,
        "count_fp": "1.00",
        "yes_price_dollars": "0.5600",
        "no_price_dollars": "0.4400",
        "taker_outcome_side": "yes",
        "created_time": "2026-06-30T18:00:00Z",
    }


def _trade(trade_id: str, ticker: str = "TEST", created_time: datetime | None = None) -> Trade:
    return Trade(
        trade_id=trade_id,
        ticker=ticker,
        count=1,
        yes_price=56,
        no_price=44,
        taker_side="yes",
        created_time=created_time or datetime(2026, 6, 30, 18, 0, tzinfo=timezone.utc),
    )


def test_http_clients_can_share_rate_limiter(monkeypatch: pytest.MonkeyPatch) -> None:
    current_time = [100.0]
    sleep_calls = []

    monkeypatch.setattr(client_mod.time, "monotonic", lambda: current_time[0])

    def fake_sleep(seconds: float) -> None:
        sleep_calls.append(seconds)
        current_time[0] += seconds

    monkeypatch.setattr(client_mod.time, "sleep", fake_sleep)

    limiter = RateLimiter(rate_limit=2)
    first_client = HttpClient(rate_limiter=limiter)
    second_client = HttpClient(rate_limiter=limiter)
    try:
        first_client._throttle()
        second_client._throttle()
    finally:
        first_client.close()
        second_client.close()

    assert sleep_calls == [pytest.approx(0.5)]


def test_default_kalshi_clients_share_rate_limiter() -> None:
    first_client = KalshiClient()
    second_client = KalshiClient()
    try:
        assert first_client.http._rate_limiter is second_client.http._rate_limiter
    finally:
        first_client.close()
        second_client.close()


def test_kalshi_api_rate_limit_env_parser(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("KALSHI_API_RATE_LIMIT", raising=False)
    assert kalshi_client_mod._read_rate_limit_from_env() == pytest.approx(25.0)

    monkeypatch.setenv("KALSHI_API_RATE_LIMIT", "40.5")
    assert kalshi_client_mod._read_rate_limit_from_env() == pytest.approx(40.5)


def test_iter_trades_paginates_global_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    client = KalshiClient()
    calls = []
    responses = [
        {"trades": [_trade_response("trade-1")], "cursor": "next"},
        {"trades": [_trade_response("trade-2")], "cursor": None},
    ]

    def fake_get(url: str, *, params: dict | None = None):
        calls.append((url, params))
        return responses.pop(0)

    monkeypatch.setattr(client.http, "get", fake_get)

    try:
        pages = list(client.iter_trades(limit=10, min_ts=100, max_ts=200))
    finally:
        client.close()

    assert [[trade.trade_id for trade in trades] for trades, _ in pages] == [["trade-1"], ["trade-2"]]
    assert calls == [
        ("/markets/trades", {"limit": 10, "min_ts": 100, "max_ts": 200}),
        ("/markets/trades", {"limit": 10, "cursor": "next", "min_ts": 100, "max_ts": 200}),
    ]


def test_iter_trades_supports_historical_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    client = KalshiClient()
    calls = []

    def fake_get(url: str, *, params: dict | None = None):
        calls.append((url, params))
        return {"trades": [_trade_response("trade-1")], "cursor": None}

    monkeypatch.setattr(client.http, "get", fake_get)

    try:
        pages = list(client.iter_trades(limit=10, historical=True))
    finally:
        client.close()

    assert pages[0][0][0].trade_id == "trade-1"
    assert calls == [("/historical/trades", {"limit": 10})]


def test_kalshi_client_rejects_repeated_trade_cursor(monkeypatch: pytest.MonkeyPatch) -> None:
    client = KalshiClient()
    responses = [
        {"trades": [_trade_response("trade-1")], "cursor": "same-cursor"},
        {"trades": [_trade_response("trade-2")], "cursor": "same-cursor"},
    ]

    def fake_get(*args, **kwargs):
        return responses.pop(0)

    monkeypatch.setattr(client.http, "get", fake_get)

    with pytest.raises(RuntimeError, match="repeated trades cursor"):
        list(client.iter_trades())

    client.close()


def test_kalshi_trades_indexer_uses_global_stream(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data_dir = tmp_path / "trades"

    class FakeKalshiClient:
        calls = []

        def __enter__(self):
            return self

        def __exit__(self, *args) -> None:
            pass

        def get_historical_cutoff(self) -> dict:
            return {"trades_created_ts": "2026-05-01T00:00:00Z"}

        def iter_trades(self, **kwargs):
            self.calls.append(kwargs)
            yield [_trade("trade-1"), _trade("trade-2")], "cursor-1"
            yield [_trade("trade-3")], None

    monkeypatch.setattr(trades_mod, "DATA_DIR", data_dir)
    monkeypatch.setattr(trades_mod, "CURSOR_FILE", tmp_path / ".backfill_trades_cursor")
    monkeypatch.setattr(trades_mod, "TRADE_ID_INDEX_FILE", tmp_path / ".trade_id_index.duckdb")
    monkeypatch.setattr(trades_mod, "BATCH_SIZE", 2)
    monkeypatch.setattr(trades_mod, "PAGE_LIMIT", 2)
    monkeypatch.setattr(trades_mod, "KalshiClient", FakeKalshiClient)

    KalshiTradesIndexer(min_ts=1_780_000_000, max_ts=1_780_000_100).run()

    rows = duckdb.sql(f"SELECT trade_id FROM '{data_dir}/trades_*.parquet' ORDER BY trade_id").fetchall()
    assert rows == [("trade-1",), ("trade-2",), ("trade-3",)]
    assert FakeKalshiClient.calls == [
        {
            "limit": 2,
            "cursor": None,
            "min_ts": 1_780_000_000,
            "max_ts": 1_780_000_100,
            "historical": False,
        }
    ]


def test_kalshi_trades_indexer_uses_existing_watermark_and_skips_duplicate_ids(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data_dir = tmp_path / "trades"
    data_dir.mkdir()
    existing_time = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    pd.DataFrame(
        [
            {
                "trade_id": "existing-trade",
                "ticker": "TEST",
                "count": 1,
                "yes_price": 50,
                "no_price": 50,
                "taker_side": "yes",
                "created_time": existing_time,
                "_fetched_at": existing_time,
            }
        ]
    ).to_parquet(data_dir / "trades_0_2.parquet")

    class FakeKalshiClient:
        calls = []

        def __enter__(self):
            return self

        def __exit__(self, *args) -> None:
            pass

        def get_historical_cutoff(self) -> dict:
            return {"trades_created_ts": "2026-05-01T00:00:00Z"}

        def iter_trades(self, **kwargs):
            self.calls.append(kwargs)
            yield [_trade("existing-trade"), _trade("new-trade")], None

    monkeypatch.setattr(trades_mod, "DATA_DIR", data_dir)
    monkeypatch.setattr(trades_mod, "CURSOR_FILE", tmp_path / ".backfill_trades_cursor")
    monkeypatch.setattr(trades_mod, "TRADE_ID_INDEX_FILE", tmp_path / ".trade_id_index.duckdb")
    monkeypatch.setattr(trades_mod, "BATCH_SIZE", 2)
    monkeypatch.setattr(trades_mod, "PAGE_LIMIT", 2)
    monkeypatch.setattr(trades_mod, "KalshiClient", FakeKalshiClient)

    KalshiTradesIndexer().run()

    rows = duckdb.sql(f"SELECT trade_id FROM '{data_dir}/trades_*.parquet' ORDER BY trade_id").fetchall()
    assert rows == [("existing-trade",), ("new-trade",)]
    assert FakeKalshiClient.calls[0]["min_ts"] == int(existing_time.timestamp())
