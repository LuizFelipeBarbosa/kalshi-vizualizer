import os
from collections.abc import Generator
from typing import Optional

from dotenv import load_dotenv

from src.common.client import HttpClient, RateLimiter
from src.indexers.kalshi.models import Market, Trade

load_dotenv()

KALSHI_API_HOST = "https://api.elections.kalshi.com/trade-api/v2"
DEFAULT_KALSHI_API_RATE_LIMIT = 25.0


def _read_rate_limit_from_env() -> float:
    raw_value = os.getenv("KALSHI_API_RATE_LIMIT")
    if raw_value is None:
        return DEFAULT_KALSHI_API_RATE_LIMIT

    try:
        rate_limit = float(raw_value)
    except ValueError as exc:
        raise ValueError(f"KALSHI_API_RATE_LIMIT must be a number, got {raw_value!r}") from exc

    if rate_limit < 0:
        raise ValueError(f"KALSHI_API_RATE_LIMIT must be non-negative, got {rate_limit}")
    return rate_limit


KALSHI_API_RATE_LIMIT = _read_rate_limit_from_env()
_KALSHI_RATE_LIMITER = RateLimiter(KALSHI_API_RATE_LIMIT)


class KalshiClient:
    def __init__(
        self,
        host: str = KALSHI_API_HOST,
        rate_limit: float = KALSHI_API_RATE_LIMIT,
        rate_limiter: Optional[RateLimiter] = None,
    ):
        self.host = host
        if rate_limiter is None and host == KALSHI_API_HOST and rate_limit == KALSHI_API_RATE_LIMIT:
            rate_limiter = _KALSHI_RATE_LIMITER
        self.http = HttpClient(base_url=host, rate_limit=rate_limit, rate_limiter=rate_limiter)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.http.close()

    def close(self):
        self.http.close()

    def get_market(self, ticker: str) -> Market:
        data = self.http.get(f"/markets/{ticker}")
        return Market.from_dict(data["market"])

    def get_market_trades(
        self,
        ticker: str,
        limit: int = 1000,
        verbose: bool = True,
        min_ts: Optional[int] = None,
        max_ts: Optional[int] = None,
    ) -> list[Trade]:
        all_trades = []
        for trades, _ in self.iter_trades(
            ticker=ticker,
            limit=limit,
            min_ts=min_ts,
            max_ts=max_ts,
        ):
            if trades:
                all_trades.extend(trades)
                if verbose:
                    print(f"Fetched {len(trades)} trades (total: {len(all_trades)})")

        return all_trades

    def iter_trades(
        self,
        ticker: Optional[str] = None,
        limit: int = 1000,
        cursor: Optional[str] = None,
        min_ts: Optional[int] = None,
        max_ts: Optional[int] = None,
        historical: bool = False,
    ) -> Generator[tuple[list[Trade], Optional[str]], None, None]:
        endpoint = "/historical/trades" if historical else "/markets/trades"
        seen_cursors: set[str] = set()

        while True:
            params = {"limit": limit}
            if ticker:
                params["ticker"] = ticker
            if cursor:
                params["cursor"] = cursor
            if min_ts is not None:
                params["min_ts"] = min_ts
            if max_ts is not None:
                params["max_ts"] = max_ts

            data = self.http.get(endpoint, params=params)
            trades = [Trade.from_dict(t) for t in data.get("trades", [])]
            next_cursor = data.get("cursor")

            yield trades, next_cursor

            if not next_cursor:
                break
            if next_cursor in seen_cursors:
                scope = ticker if ticker else "global trades"
                raise RuntimeError(f"Kalshi returned a repeated trades cursor for {scope}")
            seen_cursors.add(next_cursor)
            cursor = next_cursor

    def list_markets(self, limit: int = 20, **kwargs) -> list[Market]:
        params = {"limit": limit, **kwargs}
        data = self.http.get("/markets", params=params)
        return [Market.from_dict(m) for m in data.get("markets", [])]

    def list_all_markets(self, limit: int = 200) -> list[Market]:
        all_markets = []
        cursor = None

        while True:
            params = {"limit": limit}
            if cursor:
                params["cursor"] = cursor

            data = self.http.get("/markets", params=params)

            markets = [Market.from_dict(m) for m in data.get("markets", [])]
            if markets:
                all_markets.extend(markets)
                print(f"Fetched {len(markets)} markets (total: {len(all_markets)})")

            cursor = data.get("cursor")
            if not cursor:
                break

        return all_markets

    def iter_markets(
        self,
        limit: int = 200,
        cursor: Optional[str] = None,
        min_close_ts: Optional[int] = None,
        max_close_ts: Optional[int] = None,
    ) -> Generator[tuple[list[Market], Optional[str]], None, None]:
        while True:
            params = {"limit": limit}
            if cursor:
                params["cursor"] = cursor
            if min_close_ts is not None:
                params["min_close_ts"] = min_close_ts
            if max_close_ts is not None:
                params["max_close_ts"] = max_close_ts

            data = self.http.get("/markets", params=params)

            markets = [Market.from_dict(m) for m in data.get("markets", [])]
            cursor = data.get("cursor")

            yield markets, cursor

            if not cursor:
                break

    def get_recent_trades(self, limit: int = 100) -> list[Trade]:
        trades, _ = next(self.iter_trades(limit=limit))
        return trades

    def get_historical_cutoff(self) -> dict:
        return self.http.get("/historical/cutoff")
