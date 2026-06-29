# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A framework for collecting and analyzing prediction market data from **Kalshi** and **Polymarket**. Two halves: *indexers* fetch raw market/trade data into Parquet files, and *analyses* run DuckDB queries over those Parquet files to produce figures (PNG/PDF/GIF), data tables (CSV), and chart configs (JSON). Python 3.9, managed with `uv`.

## Commands

All commands run through `uv` (and most are wrapped in the `Makefile`):

```bash
uv sync --group dev          # install deps including pytest/ruff
make setup                   # download + extract the 36GiB dataset to data/ (needs zstd, aria2c)

make analyze                 # interactive menu to run an analysis
make run win_rate_by_price   # run one analysis by its `name`
uv run main.py analyze all   # run every analysis
make index                   # interactive menu to run a data indexer

make lint                    # ruff check + ruff format --check
make format                  # ruff check --fix + ruff format
make test                    # uv run pytest tests/ -v
uv run pytest tests/test_compile.py -v                       # run one test file
uv run pytest "tests/test_analysis_run.py::test_analysis_run[WinRateByPriceAnalysis]"   # one parametrized case
uv run pytest -m "not slow"  # skip slow tests (the animated analysis)
```

CI (`.github/workflows/ci.yml`) runs `ruff check`, `ruff format --check`, and `pytest tests/ -v` on Python 3.9. Line length is 120; `E501` is intentionally ignored.

## Architecture

Two plugin systems built on abstract base classes that **auto-discover** subclasses by scanning directories — there is no central registry to update when adding a new analysis or indexer.

- **`src/common/analysis.py`** — `Analysis` ABC. `Analysis.load()` imports every non-underscore `*.py` under `src/analysis/` and collects concrete subclasses. `run()` returns an `AnalysisOutput(figure, data, chart, metadata)`; the base `save()` exports each field to the relevant formats (figure→png/pdf/svg/gif, `data` DataFrame→csv, `chart` ChartConfig→json).
- **`src/common/indexer.py`** — `Indexer` ABC, same `load()` discovery pattern over `src/indexers/`. `run()` fetches and persists data; no return value.
- **`src/common/storage.py`** — `ParquetStorage`, chunked Parquet writer (10k rows/chunk, `markets_<start>_<end>.parquet`) with ticker-based dedup.
- **`src/common/client.py`** — `HttpClient`, the shared httpx wrapper with token-bucket rate limiting, exponential-jitter retries (via tenacity) on 429/5xx + connection errors. Indexer-specific clients build on this.
- **`src/common/interfaces/chart.py`** — `ChartConfig` dataclass + `ChartType`/`UnitType` enums and helper constructors (`line_chart`, `bar_chart`, etc.). This serializes to JSON consumed by an external web "ResearchChart" component; it is separate from the matplotlib figure (analyses typically produce both — a matplotlib figure for papers and a ChartConfig for the web).

`main.py` is the entry point for the `analyze`/`index`/`package` subcommands; menus use `simple_term_menu`.

### Data flow

Indexers write Parquet → `data/{kalshi,polymarket}/{markets,trades,...}/`. Analyses read those Parquet globs directly with DuckDB (`SELECT ... FROM '<dir>/*.parquet'`) — DuckDB queries the files in place, nothing is loaded into a database. The `data/` dir is gitignored and produced by `make setup` or by running indexers. Schemas for every Parquet table are documented in `docs/SCHEMAS.md` — read it before writing queries.

### Polymarket specifics

Polymarket trades are indexed from the **Polygon blockchain** (not an API): `src/indexers/polymarket/blockchain.py` decodes `OrderFilled` events from the CTF Exchange + NegRisk contracts, and `fpmm_trades.py` handles legacy FPMM (pre-2022) `FPMMBuy`/`FPMMSell` events. This requires a `POLYGON_RPC` endpoint set in `.env` (see `.env.example`; loaded via `python-dotenv`). Prices are decimals 0–1. Kalshi by contrast uses its REST API and prices in integer cents 1–99 where `no_price = 100 - yes_price`.

## Conventions

- **Analyses take injectable data-dir paths.** Each analysis's `__init__` calls `super().__init__(name=..., description=...)` and accepts optional `trades_dir`/`markets_dir`/etc. params, defaulting to `Path(__file__).parent.parent.parent.parent / "data" / ...`. This injection is what lets the tests run every analysis against tiny synthetic fixtures instead of the real 36GiB dataset — preserve it. (Note: the template in `docs/ANALYSIS.md` is stale — it shows class-attribute `name`/`description` and a `tuple[Figure, dict]` return; follow the real pattern in `src/analysis/kalshi/win_rate_by_price.py` and the `AnalysisOutput` return type instead.)
- **Tests are generic, not per-analysis.** `tests/test_compile.py` imports/instantiates every discovered module; `tests/test_analysis_run.py` parametrizes over `Analysis.load()` and feeds fixtures from `tests/conftest.py` based on the module path (`.kalshi.`/`.polymarket.`) and param name. A new analysis is automatically covered — just make sure it instantiates with no args and its `__init__` param names match the fixture conventions in `_build_kwargs`.
- **Kalshi categorization** lives in `src/analysis/kalshi/util/categories.py` (`get_group`, `get_hierarchy`, `GROUP_COLORS`) — group markets by the prefix of their `event_ticker`.
- Files/dirs starting with `_` (e.g. `__init__.py`) are skipped by the discovery loaders.
- Output filenames are derived from the analysis `name`; everything lands in `output/` (gitignored).
