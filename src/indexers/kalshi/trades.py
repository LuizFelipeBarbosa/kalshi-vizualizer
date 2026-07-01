"""Indexer for Kalshi trades data."""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

import duckdb
import pandas as pd
from dateutil.parser import isoparse
from tqdm import tqdm

from src.common.indexer import Indexer
from src.indexers.kalshi.client import KalshiClient

DATA_DIR = Path("data/kalshi/trades")
CURSOR_FILE = Path("data/kalshi/.backfill_trades_cursor")
TRADE_ID_INDEX_FILE = Path("data/kalshi/.trade_id_index.duckdb")
BATCH_SIZE = 10000
PAGE_LIMIT = 1000


@dataclass(frozen=True)
class TradeStream:
    name: str
    historical: bool
    min_ts: int | None
    max_ts: int | None

    def matches_state(self, state: dict) -> bool:
        return (
            state.get("stream") == self.name
            and state.get("historical") == self.historical
            and state.get("min_ts") == self.min_ts
            and state.get("max_ts") == self.max_ts
            and state.get("limit") == PAGE_LIMIT
        )

    def cursor_state(self, cursor: str) -> dict:
        return {
            "stream": self.name,
            "historical": self.historical,
            "min_ts": self.min_ts,
            "max_ts": self.max_ts,
            "limit": PAGE_LIMIT,
            "cursor": cursor,
        }


class TradeIdIndex:
    """On-disk trade_id index used to avoid duplicates while globally backfilling."""

    def __init__(self, db_path: Path, parquet_glob: str, min_ts: int | None = None):
        self._db_path = db_path
        self._parquet_glob = parquet_glob
        self._min_ts = min_ts
        self._connection: duckdb.DuckDBPyConnection | None = None

    def __enter__(self) -> TradeIdIndex:
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = duckdb.connect(str(self._db_path))

        print("Building trade_id index for existing Kalshi trades...")
        self._connection.execute("DROP TABLE IF EXISTS trade_ids")
        if self._min_ts is None:
            self._connection.execute(
                "CREATE TABLE trade_ids AS SELECT DISTINCT trade_id FROM read_parquet(?)",
                [self._parquet_glob],
            )
        else:
            self._connection.execute(
                """
                CREATE TABLE trade_ids AS
                SELECT DISTINCT trade_id
                FROM read_parquet(?)
                WHERE epoch(created_time) >= ?
                """,
                [self._parquet_glob, self._min_ts],
            )
        self._connection.execute("CREATE UNIQUE INDEX trade_ids_idx ON trade_ids(trade_id)")
        return self

    def __exit__(self, *args) -> None:
        if self._connection is not None:
            self._connection.close()

    def filter_new(self, df: pd.DataFrame) -> pd.DataFrame:
        assert self._connection is not None
        if df.empty:
            return df

        self._connection.register("incoming_trades", df)
        try:
            return self._connection.execute("""
                SELECT incoming_trades.*
                FROM incoming_trades
                ANTI JOIN trade_ids USING (trade_id)
            """).df()
        finally:
            self._connection.unregister("incoming_trades")

    def add(self, trade_ids: pd.Series) -> None:
        assert self._connection is not None
        if trade_ids.empty:
            return

        ids_df = pd.DataFrame({"trade_id": trade_ids})
        self._connection.register("new_trade_ids", ids_df)
        try:
            self._connection.execute("INSERT OR IGNORE INTO trade_ids SELECT trade_id FROM new_trade_ids")
        finally:
            self._connection.unregister("new_trade_ids")


class KalshiTradesIndexer(Indexer):
    """Fetches and stores Kalshi trades data."""

    def __init__(
        self,
        min_ts: int | None = None,
        max_ts: int | None = None,
        max_workers: int | None = None,
    ):
        if max_workers is not None and max_workers < 1:
            raise ValueError("max_workers must be at least 1")
        super().__init__(
            name="kalshi_trades",
            description="Backfills Kalshi trades data to parquet files",
        )
        self._min_ts = min_ts
        self._max_ts = max_ts

    def run(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        CURSOR_FILE.parent.mkdir(parents=True, exist_ok=True)

        parquet_files = list(DATA_DIR.glob("trades_*.parquet"))
        cursor_state = self._load_cursor_state()
        run_min_ts = self._resolve_min_ts(parquet_files, cursor_state)
        run_max_ts = self._resolve_max_ts(cursor_state)
        next_chunk_idx = self._next_chunk_idx(parquet_files)
        trade_index = (
            TradeIdIndex(TRADE_ID_INDEX_FILE, f"{DATA_DIR}/trades_*.parquet", min_ts=run_min_ts)
            if parquet_files
            else None
        )

        all_trades: list[dict] = []
        total_fetched = 0
        total_saved = 0

        def save_batch(trades_batch: list[dict]) -> int:
            nonlocal next_chunk_idx
            if not trades_batch:
                return 0

            df = pd.DataFrame(trades_batch)
            if trade_index is not None:
                df = trade_index.filter_new(df)
            if df.empty:
                return 0

            chunk_path = DATA_DIR / f"trades_{next_chunk_idx}_{next_chunk_idx + BATCH_SIZE}.parquet"
            df.to_parquet(chunk_path)
            if trade_index is not None:
                trade_index.add(df["trade_id"])
            next_chunk_idx += BATCH_SIZE
            return len(df)

        def run_streams() -> None:
            nonlocal all_trades, cursor_state, total_fetched, total_saved
            with KalshiClient() as client:
                streams = self._build_streams(client, run_min_ts, run_max_ts)
                if not streams:
                    print("Nothing to process")
                    return

                resume_stream = cursor_state.get("stream") if cursor_state else None
                with tqdm(desc="Fetching trades", unit="trade") as pbar:
                    for stream in streams:
                        if resume_stream and stream.name != resume_stream:
                            continue

                        cursor = None
                        if cursor_state is not None:
                            if not stream.matches_state(cursor_state):
                                raise RuntimeError("Saved Kalshi trades cursor does not match this backfill query")
                            cursor = cursor_state.get("cursor")
                            print(f"Resuming Kalshi {stream.name} trades from cursor: {cursor[:20]}...")
                            cursor_state = None
                            resume_stream = None

                        pages = client.iter_trades(
                            limit=PAGE_LIMIT,
                            cursor=cursor,
                            min_ts=stream.min_ts,
                            max_ts=stream.max_ts,
                            historical=stream.historical,
                        )
                        for trades, next_cursor in pages:
                            fetched_at = datetime.utcnow()
                            records = [{**asdict(trade), "_fetched_at": fetched_at} for trade in trades]
                            total_fetched += len(records)
                            all_trades.extend(records)

                            while len(all_trades) >= BATCH_SIZE:
                                saved = save_batch(all_trades[:BATCH_SIZE])
                                total_saved += saved
                                all_trades = all_trades[BATCH_SIZE:]
                                self._save_cursor_state(stream, next_cursor)

                            if not records:
                                self._save_cursor_state(stream, next_cursor)

                            pbar.update(len(records))
                            pbar.set_postfix(buffer=len(all_trades), saved=total_saved, stream=stream.name)

                    if all_trades:
                        total_saved += save_batch(all_trades)
                        all_trades = []

                    if CURSOR_FILE.exists():
                        CURSOR_FILE.unlink()

        if trade_index is None:
            run_streams()
        else:
            with trade_index:
                run_streams()

        print(f"\nBackfill trades complete: {total_fetched} trades fetched, {total_saved} new trades saved")

    def _resolve_min_ts(self, parquet_files: list[Path], cursor_state: dict | None) -> int | None:
        if cursor_state is not None:
            if self._min_ts is not None and self._min_ts != cursor_state.get("min_ts"):
                raise RuntimeError("Saved Kalshi trades cursor min_ts does not match this backfill query")
            return cursor_state.get("min_ts")

        if self._min_ts is not None or not parquet_files:
            return self._min_ts

        result = duckdb.sql(f"SELECT epoch(MAX(created_time)) FROM '{DATA_DIR}/trades_*.parquet'").fetchone()
        if not result or result[0] is None:
            return None

        min_ts = int(result[0])
        print(f"Starting from local Kalshi trades watermark: min_ts={min_ts}")
        return min_ts

    def _resolve_max_ts(self, cursor_state: dict | None) -> int | None:
        if cursor_state is not None:
            if self._max_ts is not None and self._max_ts != cursor_state.get("max_ts"):
                raise RuntimeError("Saved Kalshi trades cursor max_ts does not match this backfill query")
            return cursor_state.get("max_ts")

        return self._max_ts if self._max_ts is not None else int(time.time())

    def _build_streams(self, client: KalshiClient, min_ts: int | None, max_ts: int | None) -> list[TradeStream]:
        cutoff = client.get_historical_cutoff()
        cutoff_ts = int(isoparse(cutoff["trades_created_ts"]).timestamp())

        streams = []
        if min_ts is None or min_ts < cutoff_ts:
            historical_max_ts = min(max_ts, cutoff_ts - 1) if max_ts is not None else cutoff_ts - 1
            if min_ts is None or historical_max_ts >= min_ts:
                streams.append(
                    TradeStream(
                        name="historical",
                        historical=True,
                        min_ts=min_ts,
                        max_ts=historical_max_ts,
                    )
                )

        if max_ts is None or max_ts >= cutoff_ts:
            live_min_ts = max(min_ts, cutoff_ts) if min_ts is not None else cutoff_ts
            streams.append(
                TradeStream(
                    name="live",
                    historical=False,
                    min_ts=live_min_ts,
                    max_ts=max_ts,
                )
            )

        return streams

    def _load_cursor_state(self) -> dict | None:
        if not CURSOR_FILE.exists():
            return None

        raw_cursor = CURSOR_FILE.read_text().strip()
        if not raw_cursor:
            return None

        try:
            return json.loads(raw_cursor)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                "Kalshi trades cursor is from an old format; remove it and restart the backfill"
            ) from exc

    def _save_cursor_state(self, stream: TradeStream, cursor: str | None) -> None:
        if cursor:
            CURSOR_FILE.write_text(json.dumps(stream.cursor_state(cursor)))

    def _next_chunk_idx(self, parquet_files: list[Path]) -> int:
        indices = []
        for path in parquet_files:
            parts = path.stem.split("_")
            if len(parts) >= 2:
                try:
                    indices.append(int(parts[1]))
                except ValueError:
                    pass
        return max(indices) + BATCH_SIZE if indices else 0
