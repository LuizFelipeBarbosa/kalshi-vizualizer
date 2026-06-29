# Prediction Market Analysis

A framework for analyzing prediction market data, including the largest publicly available dataset of Polymarket and Kalshi market and trade data. Provides tools for data collection, storage, and running analysis scripts that generate figures and statistics.

## Overview

This project enables research and analysis of prediction markets by providing:
- Pre-collected datasets from Polymarket and Kalshi
- Data collection indexers for gathering new data
- Analysis framework for generating figures and statistics

Currently supported features:
- Market metadata collection (Kalshi & Polymarket)
- Trade history collection via API and blockchain
- Parquet-based storage with automatic progress saving
- Extensible analysis script framework
- Interactive web explorer for browsing Kalshi contracts grouped by event, with per-contract price history

## Installation & Usage

Requires Python 3.9+. Install dependencies with [uv](https://github.com/astral-sh/uv):

```bash
uv sync
```

Download and extract the pre-collected dataset (36GiB compressed):

```bash
make setup
```

This downloads `data.tar.zst` from [Cloudflare R2 Storage](https://s3.jbecker.dev/data.tar.zst) and extracts it to `data/`.

### Data Collection

Collect market and trade data from prediction market APIs:

```bash
make index
```

This opens an interactive menu to select which indexer to run. Data is saved to `data/kalshi/` and `data/polymarket/` directories. Progress is saved automatically, so you can interrupt and resume collection.

### Running Analyses

```bash
make analyze
```

This opens an interactive menu to select which analysis to run. You can run all analyses or select a specific one. Output files (PNG, PDF, CSV, JSON) are saved to `output/`.

### Interactive Visualization

Explore Kalshi contracts in a web app — grouped by event, with each contract's price movement over its lifetime and a main overview page covering all contracts:

```bash
make visualize
```

This first distills the Kalshi trade data into a compact "site dataset" under `output/site/data/`, then serves the explorer — a [FastAPI](https://fastapi.tiangolo.com/) app fronting the static UI — at `http://127.0.0.1:8000` with three views: an overview of every event, an event view overlaying its contracts' price lines, and a per-contract price + volume chart. The API queries the distilled Parquet directly with DuckDB.

Build and serve can also be run separately:

```bash
make visualize-build                            # build output/site/data/ only
make visualize-serve                            # serve on the default port (8000)
uv run main.py visualize serve --port 9000      # custom port
uv run main.py visualize serve --reload         # auto-reload (development)
uv run main.py visualize serve --workers 4      # multiple uvicorn workers
```

By default the explorer covers the Kalshi contracts that have traded (the ones with a price history to show); the build distills the full ~72M trades in seconds.

#### Deploying as a web app

For production, point uvicorn (or gunicorn) at the ASGI entrypoint `src.visualize.asgi:app`; the dataset location comes from the `SITE_DATA_DIR` environment variable (default `output/site/data`):

```bash
SITE_DATA_DIR=/data/site uvicorn src.visualize.asgi:app --host 0.0.0.0 --port 8000 --workers 4
```

A `Dockerfile` is included that bakes the prebuilt site dataset into the image and serves it with four workers. Build the dataset first, then the image:

```bash
uv run main.py visualize build      # writes output/site/data/
docker build -t kalshi-tape .
docker run -p 8000:8000 kalshi-tape
```

DuckDB queries the Parquet files in place, so each worker holds its own read-only connection. For datasets too large to bake into the image, mount a volume at `SITE_DATA_DIR` or have the build read Parquet from object storage (`s3://…`) instead. The original stdlib server (`src/visualize/serve.py`) remains as a zero-dependency fallback.

### Packaging Data

To compress the data directory for storage/distribution:

```bash
make package
```

This creates a zstd-compressed tar archive (`data.tar.zst`) and removes the `data/` directory.

## Project Structure

```
├── src/
│   ├── analysis/           # Analysis scripts
│   │   ├── kalshi/         # Kalshi-specific analyses
│   │   └── polymarket/     # Polymarket-specific analyses
│   ├── indexers/           # Data collection indexers
│   │   ├── kalshi/         # Kalshi API client and indexers
│   │   └── polymarket/     # Polymarket API/blockchain indexers
│   ├── visualize/          # Interactive Kalshi contract explorer (build + server + web UI)
│   └── common/             # Shared utilities and interfaces
├── data/                   # Data directory (extracted from data.tar.zst)
│   ├── kalshi/
│   │   ├── markets/
│   │   └── trades/
│   └── polymarket/
│       ├── blocks/
│       ├── markets/
│       └── trades/
├── docs/                   # Documentation
└── output/                 # Analysis outputs (figures, CSVs) and the explorer dataset (output/site/)
```

## Documentation

- [Data Schemas](docs/SCHEMAS.md) - Parquet file schemas for markets and trades
- [Writing Analyses](docs/ANALYSIS.md) - Guide for writing custom analysis scripts

## Contributing

If you'd like to contribute to this project, please open a pull-request with your changes, as well as detailed information on what is changed, added, or improved.

For more information, see the [contributing guide](CONTRIBUTING.md).

## Issues

If you've found an issue or have a question, please open an issue [here](https://github.com/jon-becker/prediction-market-analysis/issues).

## Research & Citations

- Becker, J. (2026). _The Microstructure of Wealth Transfer in Prediction Markets_. Jbecker. https://jbecker.dev/research/prediction-market-microstructure
- Le, N. A. (2026). _Decomposing Crowd Wisdom: Domain-Specific Calibration Dynamics in Prediction Markets_. arXiv. https://arxiv.org/abs/2602.19520
- Akey P., Gregoire, V., Harvie, N., Martineau, C. (2026). _Who Wins and Who Loses In Prediction Markets? Evidence from Polymarket_. SSRN. https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6443103
- Vedova, J. (2026). _Who Profits from Prediction Markets? Execution, not Information_. SSRN. https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6191618
- Brown, A. (2026). _Cassandra Or the Boy Who Cried Wolf? Are Prediction Markets Effective Early Warning Systems?_. SSRN. https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6381538
- Reichenbach, F., Walther, M. (2025). _Exploring Decentralized Prediction Markets: Accuracy, Skill, and Bias on Polymarket_. SSRN. https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5910522

If you have used or plan to use this dataset in your research, please reach out via [email](mailto:jonathan@jbecker.dev) or [Twitter](https://x.com/BeckerrJon) -- i'd love to hear about what you're using the data for! Additionally, feel free to open a PR and update this section with a link to your paper.
