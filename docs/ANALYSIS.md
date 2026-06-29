# Writing Analysis Scripts

Analysis scripts live in `src/analysis/{kalshi,polymarket,comparison}/` and extend the `Analysis` base class (`src/common/analysis.py`). Each analysis runs DuckDB queries against Parquet data, builds a matplotlib figure and/or a pandas DataFrame, and optionally a `ChartConfig` for the web frontend, then returns all of these wrapped in an `AnalysisOutput`.

Analyses are **discovered automatically** (there is no registry to edit) and are **tested automatically** by a generic test harness. To plug into both, an analysis just has to follow a few naming/structure rules described below.

## Running Analyses

```bash
make analyze
```

This opens an interactive menu to select which analysis to run. You can run all analyses or select a specific one. Output files (PNG, PDF, CSV, JSON, and GIF for animated analyses) are saved to `output/`, each named after the analysis (`{name}.{fmt}`).

## Discovery: no registry

`Analysis.load()` finds every concrete analysis class for you. You never register an analysis anywhere — you just drop a file in `src/analysis/` and it is picked up.

`Analysis.load(analysis_dir="src/analysis")`:

- Recursively globs `**/*.py` under `analysis_dir`.
- **Skips any file whose name starts with `_`** (so `__init__.py`, `_helpers.py`, etc. are ignored — put shared helpers in underscore-prefixed files or under a `util/` package imported by name).
- Imports each module as `src.analysis.<dotted.path>` (the `src.analysis.` prefix is fixed) and skips modules that raise `ImportError`.
- Collects every class that is a subclass of `Analysis`, is not `Analysis` itself, and is **not abstract**.

Practical consequence: any concrete subclass of `Analysis` you add becomes runnable and testable with no further wiring.

## The Authoring Pattern (template)

Every analysis is a class extending `Analysis` whose `__init__`:

1. Calls `super().__init__(name=..., description=...)` — `name` and `description` are **constructor arguments**, set as instance attributes by the base class. They are **not** class attributes.
2. Accepts **optional, injectable** `*_dir` (and `*_path`) parameters, each typed `Path | str | None = None`, defaulting to a path under the repo's `data/` directory.
3. Computes `base_dir = Path(__file__).parent.parent.parent.parent` — exactly **four** `.parent` calls. Analysis files live at `src/analysis/<platform>/<file>.py`, so four parents lands at the repo root where `data/` sits.

The `run()` method returns an `AnalysisOutput(figure=..., data=..., chart=...)`. Queries read Parquet directly via glob patterns against the injected directories (`FROM '{self.trades_dir}/*.parquet'`).

```python
"""One-line description of the analysis."""

from __future__ import annotations

from pathlib import Path

import duckdb
import matplotlib.pyplot as plt
import pandas as pd

from src.common.analysis import Analysis, AnalysisOutput
from src.common.interfaces.chart import ChartConfig, ChartType, UnitType


class MyAnalysis(Analysis):
    """What this analysis measures."""

    def __init__(
        self,
        trades_dir: Path | str | None = None,
        markets_dir: Path | str | None = None,
    ):
        super().__init__(
            name="my_analysis",
            description="One-line description shown in listings",
        )
        base_dir = Path(__file__).parent.parent.parent.parent
        self.trades_dir = Path(trades_dir or base_dir / "data" / "kalshi" / "trades")
        self.markets_dir = Path(markets_dir or base_dir / "data" / "kalshi" / "markets")

    def run(self) -> AnalysisOutput:
        """Execute the analysis and return outputs."""
        con = duckdb.connect()

        df = con.execute(
            f"""
            SELECT t.yes_price, COUNT(*) AS total_trades
            FROM '{self.trades_dir}/*.parquet' t
            INNER JOIN '{self.markets_dir}/*.parquet' m ON t.ticker = m.ticker
            GROUP BY t.yes_price
            ORDER BY t.yes_price
            """
        ).df()

        fig = self._create_figure(df)
        chart = self._create_chart(df)

        return AnalysisOutput(figure=fig, data=df, chart=chart)

    def _create_figure(self, df: pd.DataFrame) -> plt.Figure:
        fig, ax = plt.subplots(figsize=(10, 10))
        ax.scatter(df["yes_price"], df["total_trades"], s=30, alpha=0.8, color="#4C72B0")
        ax.set_xlabel("Contract Price (cents)")
        ax.set_ylabel("Total Trades")
        ax.set_title("My Analysis")
        plt.tight_layout()
        return fig

    def _create_chart(self, df: pd.DataFrame) -> ChartConfig:
        chart_data = [
            {"price": int(row["yes_price"]), "total": int(row["total_trades"])}
            for _, row in df.iterrows()
        ]
        return ChartConfig(
            type=ChartType.LINE,
            data=chart_data,
            xKey="price",
            yKeys=["total"],
            title="My Analysis",
            yUnit=UnitType.NUMBER,
            xLabel="Contract Price (cents)",
            yLabel="Total Trades",
        )
```

### The `AnalysisOutput` return contract

`run()` must return an `AnalysisOutput`, a dataclass with four optional fields (all default `None`):

```python
@dataclass
class AnalysisOutput:
    figure: Figure | FuncAnimation | None = None  # matplotlib Figure, or FuncAnimation for animations
    data: pd.DataFrame | None = None              # a pandas DataFrame (NOT a dict)
    chart: ChartConfig | None = None              # web-chart config (serialized to JSON)
    metadata: dict | None = None                  # carried on the output; NOT written to any file
```

Notes:

- `data` is a **pandas DataFrame**, not a list/dict — `save()` writes it with `output.data.to_csv(path, index=False)`.
- `metadata` is for in-process bookkeeping only; `save()` never writes it anywhere.
- `chart` is a `ChartConfig` (see below); it is what produces the JSON output the web frontend consumes.

### Loading registered/lookup tables before the main query (Polymarket)

Polymarket analyses often build intermediate lookup tables in Python and register them before the main query. The real CTF token resolution table (`polymarket_win_rate_by_price.py`) is keyed by token id with a boolean outcome:

```python
con.execute("CREATE TABLE token_resolution (token_id VARCHAR, won BOOLEAN)")
con.executemany(
    "INSERT INTO token_resolution VALUES (?, ?)",
    list(token_won.items()),
)
```

A separate `fpmm_resolution (fpmm_address VARCHAR, winning_outcome BIGINT)` table is built from the integer winning outcome for legacy FPMM trades. Note that the real Polymarket markets queries (`polymarket_win_rate_by_price.py` line 47, `polymarket_calibration_by_bucket.py`) also SELECT `clob_token_ids` and `market_maker_address`, which are used for CTF/FPMM resolution but are not yet listed in `docs/SCHEMAS.md`; confirm column names against the actual Parquet files.

JSON lookups (such as the FPMM collateral map) are loaded guardedly:

```python
if self.collateral_lookup_path.exists():
    with open(self.collateral_lookup_path) as f:
        collateral = json.load(f)
```

and legacy trades are only `UNION ALL`'d in when both the resolution data and the legacy directory exist.

## Automatic Testing & Parameter-Naming Rules

There is **no per-analysis test code**. Two generic, parametrized test modules cover every discovered analysis:

- `tests/test_compile.py` — `test_analysis_instantiation` constructs each class with **no arguments** (`cls()`) and asserts `instance.name` and `instance.description` are non-empty strings. `test_analysis_discovery` asserts `Analysis.load()` finds at least one class.
- `tests/test_analysis_run.py` — for each class, builds constructor kwargs from session fixtures (via `_build_kwargs`), instantiates it, calls `run()`, and asserts the result is an `AnalysisOutput` (with `.data` a DataFrame if present, `.figure` a `Figure`/`FuncAnimation` if present, and `.chart`, if present, serializing to JSON containing `"type"` and `"data"`). The animated analysis runs under `@pytest.mark.slow`.

### Zero-required-args rule

Because `test_compile.py` calls `cls()` with no arguments, **every `__init__` parameter must have a default**. This is exactly why all the injectable `*_dir`/`*_path` params default to `None` (and then to a `data/...` path). Any param the fixture wiring doesn't recognize is simply omitted from kwargs, so it too must have a default.

### How fixtures are wired (param-naming rules)

`_build_kwargs` decides the platform **purely from the class's module path** (it checks whether the dotted module name contains the literal substring `.kalshi.` or `.polymarket.`). For each constructor param it injects a fixture using this precedence:

1. **Direct match** — if the param name is itself one of the fixture keys, inject it directly. Valid keys: `kalshi_trades_dir`, `kalshi_markets_dir`, `polymarket_trades_dir`, `polymarket_legacy_trades_dir`, `polymarket_markets_dir`, `polymarket_blocks_dir`, `collateral_lookup_path`.
2. **Kalshi short names** (only if module path contains `.kalshi.`): `trades_dir → kalshi_trades_dir`, `markets_dir → kalshi_markets_dir`.
3. **Polymarket short names** (only if module path contains `.polymarket.`): `trades_dir → polymarket_trades_dir`, `legacy_trades_dir → polymarket_legacy_trades_dir`, `markets_dir → polymarket_markets_dir`, `blocks_dir → polymarket_blocks_dir`.

To get fixtures wired automatically, follow these naming conventions:

| Analysis location | Use these param names |
|---|---|
| `src/analysis/kalshi/...` | `trades_dir`, `markets_dir` |
| `src/analysis/polymarket/...` | `trades_dir`, `legacy_trades_dir`, `markets_dir`, `blocks_dir` |
| `src/analysis/comparison/...` (cross-platform; module path contains neither `.kalshi.` nor `.polymarket.`) | the explicit full keys: `kalshi_trades_dir`, `kalshi_markets_dir`, `polymarket_trades_dir`, `polymarket_legacy_trades_dir`, `polymarket_markets_dir`, `polymarket_blocks_dir` |

`collateral_lookup_path` is special: it must be named **exactly** `collateral_lookup_path` (no short alias, no platform prefix) — it is only ever injected via the direct-match branch — and it is a **file path** (`.json`), not a directory.

Real `__init__` parameter sets in the codebase:

- Kalshi (`win_rate_by_price.py`): `trades_dir → data/kalshi/trades`, `markets_dir → data/kalshi/markets`.
- Polymarket (`polymarket_win_rate_by_price.py`): `trades_dir → data/polymarket/trades`, `legacy_trades_dir → data/polymarket/legacy_trades`, `markets_dir → data/polymarket/markets`, `collateral_lookup_path → data/polymarket/fpmm_collateral_lookup.json`.
- Comparison (`win_rate_by_price_animated.py`): `kalshi_trades_dir`, `kalshi_markets_dir`, `polymarket_trades_dir`, `polymarket_legacy_trades_dir`, `polymarket_markets_dir`, `polymarket_blocks_dir`, `collateral_lookup_path`.

## Common DuckDB Query Patterns

DuckDB reads Parquet directly via glob patterns. Connect in-memory with `duckdb.connect()` (no path argument) and interpolate the injected directories into the SQL.

### Join trades with market outcomes (Kalshi)

```sql
WITH resolved_markets AS (
    SELECT ticker, result
    FROM '{self.markets_dir}/*.parquet'
    WHERE status = 'finalized'
      AND result IN ('yes', 'no')
)
SELECT
    t.yes_price,
    t.count,
    t.taker_side,
    m.result,
    CASE WHEN t.taker_side = m.result THEN 1 ELSE 0 END AS taker_won
FROM '{self.trades_dir}/*.parquet' t
INNER JOIN resolved_markets m ON t.ticker = m.ticker
```

### Analyze both taker and maker positions (Kalshi)

The taker pays `yes_price` when buying YES and `no_price` when buying NO; the maker (counterparty) takes the opposite leg.

```sql
WITH all_positions AS (
    -- Taker positions
    SELECT
        CASE WHEN taker_side = 'yes' THEN yes_price ELSE no_price END AS price,
        count,
        'taker' AS role
    FROM '{self.trades_dir}/*.parquet'

    UNION ALL

    -- Maker positions (counterparty)
    SELECT
        CASE WHEN taker_side = 'yes' THEN no_price ELSE yes_price END AS price,
        count,
        'maker' AS role
    FROM '{self.trades_dir}/*.parquet'
)
SELECT price, role, SUM(count) AS total_contracts
FROM all_positions
GROUP BY price, role
ORDER BY price
```

### Categorizing markets from `event_ticker`

To classify Kalshi markets, don't hand-roll the regex — reuse the canonical `CATEGORY_SQL` constant from `src/analysis/kalshi/util/categories.py`, which handles the null/empty/independent cases consistently. It has three branches: (1) null OR empty `event_ticker` → `'independent'`, (2) empty regex extraction → `'independent'`, (3) ELSE the extracted prefix. It is already used by `statistical_tests.py` and `maker_taker_returns_by_category.py`. (Note: `market_types.py` reimplements the same `CASE` inline rather than reusing the constant — it is a place to refactor, not an example to follow — and otherwise uses the Python helpers `get_group`/`get_hierarchy`/`GROUP_COLORS` from the same module.)

```python
from src.analysis.kalshi.util.categories import CATEGORY_SQL

df = con.execute(
    f"""
    SELECT {CATEGORY_SQL} AS category, COUNT(*) AS market_count
    FROM '{self.markets_dir}/*.parquet'
    GROUP BY category
    """
).df()
```

When the markets table is aliased (e.g. `m`), apply `CATEGORY_SQL.replace("event_ticker", "m.event_ticker")` as `statistical_tests.py` and `maker_taker_returns_by_category.py` do, since `CATEGORY_SQL` references the bare `event_ticker` column.

## The Categories Utility

For grouping Kalshi markets into high-level groups (Sports, Politics, Crypto, etc.), use `src/analysis/kalshi/util/categories.py`.

```python
from src.analysis.kalshi.util.categories import get_group, get_hierarchy, GROUP_COLORS

# Full hierarchy: a 3-tuple (group, category, subcategory)
get_hierarchy("NFLGAME")   # -> ("Sports", "NFL", "Games")
get_hierarchy("BTCD")      # -> ("Crypto", "Bitcoin", "Daily")

# Just the high-level group
get_group("BTCD")          # -> "Crypto"

# Predefined per-group hex colors for consistent visualizations
GROUP_COLORS["Sports"]              # -> "#1f77b4"
GROUP_COLORS[get_group("HIGHNY")]   # -> "#17becf"  (Weather)
```

How it works:

- `get_hierarchy(category)` uppercases the input, then scans `SUBCATEGORY_PATTERNS` (ordered most-specific-first) and returns the first entry whose pattern is a **substring** of the uppercased input (`pattern in cat_upper` — the input does not need to start with the pattern). If nothing matches, it returns `("Other", "Other", category)` using the original (non-uppercased) `category` as the subcategory.
- `get_group(category)` returns just the first element of `get_hierarchy(category)`.
- `GROUP_COLORS` maps each group name to a hex color. Keys: `"Sports"`, `"Politics"`, `"Crypto"`, `"Finance"`, `"Science/Tech"`, `"Weather"`, `"Entertainment"`, `"Media"`, `"World Events"`, `"Esports"`, `"Other"`.

## ChartConfig: Web-Chart Output

`ChartConfig` (`src/common/interfaces/chart.py`) is the structured chart spec that produces the JSON output consumed by the web frontend. Return it as `AnalysisOutput(..., chart=...)`; `save()` will serialize it to `{name}.json` via `chart.to_json()`.

Only `type` and `data` are required; every other field defaults to `None` and is **omitted** from the serialized output when `None`. `to_dict()` always emits `"type"` (as the enum's string value) and `"data"`; enum-typed fields (`xScale`, `yScale`, `yUnit`) are serialized to their `.value`. `to_json()` is `json.dumps(to_dict(), indent=2)`.

Enums:

- `ChartType`: `LINE="line"`, `BAR="bar"`, `STACKED_BAR="stacked-bar"`, `STACKED_BAR_100="stacked-bar-100"`, `AREA="area"`, `STACKED_AREA_100="stacked-area-100"`, `PIE="pie"`, `SCATTER="scatter"`, `TREEMAP="treemap"`, `HEATMAP="heatmap"`.
- `UnitType`: `DOLLARS="dollars"`, `PERCENT="percent"`, `BYTES="bytes"`, `ETH="eth"`, `BTC="btc"`, `CENTS="cents"`, `NUMBER="number"`.
- `ScaleType`: `LINEAR="linear"`, `LOG="log"` (used by `xScale`/`yScale`).

Direct construction:

```python
from src.common.interfaces.chart import ChartConfig, ChartType, UnitType

config = ChartConfig(
    type=ChartType.LINE,
    data=[{"x": 1, "y": 10}, {"x": 2, "y": 20}],
    xKey="x",
    yKeys=["y"],
    title="My Chart",
    yUnit=UnitType.DOLLARS,
)
config.to_dict()
# -> {"type": "line", "data": [...], "xKey": "x", "yKeys": ["y"],
#     "title": "My Chart", "yUnit": "dollars"}   (None fields omitted)
config.to_json()  # pretty-printed JSON string, 2-space indent
```

Helper constructors (each returns a `ChartConfig`):

```python
from src.common.interfaces.chart import (
    line_chart, bar_chart, area_chart, pie_chart, scatter_chart, heatmap, treemap,
    UnitType,
)

line_chart([{"x": 1, "y": 10}], x="x", y="y", yUnit=UnitType.PERCENT)  # y may be str or list[str]
bar_chart([{"x": "A", "v": 3}], x="x", y="v", stacked=True)            # type -> "stacked-bar"
area_chart([{"x": 1, "y": 5}], stacked=True)                          # type "area", stacked field=True
pie_chart([{"name": "A", "value": 10}])                              # sets nameKey/valueKey
scatter_chart([{"x": 1, "y": 2, "size": 5}], x="x", y="y", z="size")  # sets xKey/yKeys/zKey
heatmap([{"x": "Mon", "y": "AM", "value": 3}], x="x", y="y", value="value")
treemap([{"name": "root", "children": [{"name": "a", "value": 1}]}])
```

Note: for `bar_chart`, `stacked` selects the chart **type** (`STACKED_BAR` vs `BAR`); for `area_chart`, `stacked` is passed through as the `stacked` field (type is always `AREA`).

## Progress Indicator

For long-running operations, wrap the slow block in the `progress()` context manager. It shows a tqdm spinner with elapsed time on stderr that disappears when the block exits.

```python
def run(self) -> AnalysisOutput:
    con = duckdb.connect()

    with self.progress("Loading trades data"):
        df = con.execute(f"SELECT * FROM '{self.trades_dir}/*.parquet'").df()

    with self.progress("Computing aggregations"):
        result = df.groupby("yes_price").agg(total=("count", "sum"))

    ...
```

## Output Conventions & `save()` Formats

`Analysis.save(output_dir, formats=None, dpi=300)` runs the analysis once and writes the requested formats. It creates `output_dir` if needed and names every file `{self.name}.{fmt}`. It returns a `dict[str, Path]` mapping each written format to its file path.

- **Default formats** (when `formats is None`): `["png", "pdf", "csv"]`.
- **Supported formats**: `png`, `pdf`, `svg`, `gif`, `csv`, `json`.
- **Default DPI**: `300`.

Which `AnalysisOutput` field produces which format:

| Format(s) | Source field | Condition | How it's written |
|---|---|---|---|
| `png`, `pdf`, `svg` | `figure` | `figure` is a matplotlib `Figure` | `figure.savefig(path, dpi=dpi, bbox_inches="tight")` |
| `gif` | `figure` | `figure` is a `FuncAnimation` | `figure.save(path, writer="pillow", dpi=dpi)` |
| `csv` | `data` | `data is not None` and `"csv"` requested | `data.to_csv(path, index=False)` |
| `json` | `chart` | `chart is not None` and `"json"` requested | `path.write_text(chart.to_json())` |

Important combinations:

- A `Figure` is only written for `png`/`pdf`/`svg`; requesting `gif` for a plain `Figure` is silently skipped.
- A `FuncAnimation` is only written for `gif`; requesting `png`/`pdf`/`svg` for an animation is silently skipped.
- `metadata` is never written to any file.
- After writing, a `Figure` is closed with `plt.close(...)` to free memory; a `FuncAnimation` is not closed.

### Animated (GIF) analyses

To produce an animation, return a `FuncAnimation` as the `figure` and make `gif` a default format by overriding `save()`:

```python
from matplotlib.animation import FuncAnimation

class MyAnimatedAnalysis(Analysis):
    def save(self, output_dir, formats=None, dpi=100):
        if formats is None:
            formats = ["gif", "csv"]
        return super().save(output_dir, formats, dpi)

    def run(self) -> AnalysisOutput:
        fig, ax = plt.subplots(figsize=(10, 10))
        # ... create artists ...

        def animate(frame_idx):
            # update artists for this frame
            return (line,)

        anim = FuncAnimation(
            fig, animate, frames=total_frames, interval=10, blit=False, repeat=False
        )
        return AnalysisOutput(figure=anim, data=output_df, metadata={"total_weeks": len(weeks)})
```

The animated case returns no `chart=` (a `ChartConfig` describes static web charts only). The `save()` override is required because the base `save()` only persists a `FuncAnimation` when `gif` is among the requested formats.

## Dependencies

Analysis scripts have access to these libraries (see `pyproject.toml`):

- `duckdb` — SQL queries directly over Parquet files
- `pandas` — DataFrames (the `AnalysisOutput.data` type)
- `matplotlib` — plotting and animation (`FuncAnimation` for GIFs, saved via the `pillow` writer)
- `numpy` — numerics; imported directly by many analyses (note: it is only a transitive dependency via pandas/scipy, not an explicit entry in `pyproject.toml`)
- `scipy` — statistical functions
- `squarify` — treemap visualizations (used by `market_types.py`)
