"""HTTP-level tests for the FastAPI adapter (src/visualize/app.py).

The pure handlers are already covered by ``test_visualize.py`` through ``dispatch``; this file
only exercises the HTTP layer added by the FastAPI migration: routing, 404 status mapping,
query-param validation (422), and that the static SPA is served. TestClient is used as a
context manager so the lifespan opens the DuckDB connection.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.visualize.app import create_app
from src.visualize.build import build_site_dataset


@pytest.fixture
def client(tmp_path: Path, kalshi_trades_dir: Path, kalshi_markets_dir: Path) -> TestClient:
    out = tmp_path / "data"
    build_site_dataset(
        trades_dir=kalshi_trades_dir,
        markets_dir=kalshi_markets_dir,
        out_dir=out,
        n_buckets=50,
    )
    with TestClient(create_app(out)) as c:
        yield c


def test_summary_and_groups(client: TestClient) -> None:
    r = client.get("/api/summary")
    assert r.status_code == 200 and r.json()["n_contracts"] == 2
    r = client.get("/api/groups")
    assert r.status_code == 200 and len(r.json()["groups"]) >= 2


def test_events_pagination_and_filter(client: TestClient) -> None:
    body = client.get("/api/events").json()
    assert body["total"] == 2 and body["page"] == 1
    assert {e["event_ticker"] for e in body["events"]} == {"INXD-24JAN01", "NFLGAME-25FEB01"}

    filtered = client.get("/api/events", params={"group": "Sports"}).json()
    assert [e["event_ticker"] for e in filtered["events"]] == ["NFLGAME-25FEB01"]


def test_events_rejects_bad_pagination(client: TestClient) -> None:
    # FastAPI validates before the handler runs -> 422, not a silent fallback.
    assert client.get("/api/events", params={"page": 0}).status_code == 422
    assert client.get("/api/events", params={"page_size": 9999}).status_code == 422


def test_event_and_contract(client: TestClient) -> None:
    body = client.get("/api/event/NFLGAME-25FEB01").json()
    assert any(c["ticker"] == "MKT-B" for c in body["contracts"])
    assert any(s["ticker"] == "MKT-B" and s["points"] for s in body["series"])

    contract = client.get("/api/contract/MKT-A").json()
    assert contract["ticker"] == "MKT-A" and len(contract["points"]) > 0

    missing_contract = client.get("/api/contract/DOES-NOT-EXIST")
    assert missing_contract.status_code == 404
    assert missing_contract.json() == {"error": "contract not found"}

    missing_event = client.get("/api/event/NOPE")
    assert missing_event.status_code == 404
    assert missing_event.json() == {"error": "event not found"}


def test_unknown_api_route_returns_json_error(client: TestClient) -> None:
    r = client.get("/api/nope")
    assert r.status_code == 404
    assert r.json() == {"error": "not found"}


def test_unexpected_api_errors_return_json(
    tmp_path: Path,
    kalshi_trades_dir: Path,
    kalshi_markets_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    out = tmp_path / "data"
    build_site_dataset(
        trades_dir=kalshi_trades_dir,
        markets_dir=kalshi_markets_dir,
        out_dir=out,
        n_buckets=50,
    )

    def raise_error(_summary: dict[str, object]) -> dict[str, object]:
        raise RuntimeError("boom")

    monkeypatch.setattr("src.visualize.app.handle_groups", raise_error)
    with TestClient(create_app(out), raise_server_exceptions=False) as c:
        r = c.get("/api/groups")

    assert r.status_code == 500
    assert r.json() == {"error": "boom"}


def test_search_is_injection_safe(client: TestClient) -> None:
    r = client.get("/api/events", params={"q": "'; DROP TABLE events;--"})
    assert r.status_code == 200 and r.json()["total"] == 0
    assert client.get("/api/events").json()["total"] == 2  # dataset intact


def test_serves_spa_index(client: TestClient) -> None:
    r = client.get("/")
    assert r.status_code == 200
    assert "KALSHI" in r.text  # index.html wordmark
