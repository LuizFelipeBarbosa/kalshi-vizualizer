"""Interactive Kalshi contract-explorer subsystem.

This package is intentionally *not* under ``src/analysis`` or ``src/indexers`` so it
is never picked up by ``Analysis.load()`` / ``Indexer.load()`` auto-discovery. It is
a self-contained two-phase tool:

* :mod:`src.visualize.build` distills the raw Kalshi trade/market parquet into a
  compact, key-sorted "site dataset" under ``output/site/data/``.
* :mod:`src.visualize.serve` serves a small static frontend plus a JSON API that
  queries that dataset live (see :mod:`src.visualize.queries`).

Import-time purity matters: nothing here may open a DuckDB connection, bind a socket,
or run the build at import (``tests/test_compile.py`` imports every module under
``src/``). All side effects live inside functions.
"""
