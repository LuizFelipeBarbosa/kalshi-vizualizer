from __future__ import annotations

import sys
from pathlib import Path

from simple_term_menu import TerminalMenu

from src.common.analysis import Analysis
from src.common.indexer import Indexer
from src.common.util import package_data
from src.common.util.strings import snake_to_title


def analyze(name: str | None = None):
    """Run analysis by name or show interactive menu."""
    analyses = Analysis.load()

    if not analyses:
        print("No analyses found in src/analysis/")
        return

    output_dir = Path("output")

    # If name provided, run that specific analysis
    if name:
        if name == "all":
            print("\nRunning all analyses...\n")
            for analysis_cls in analyses:
                instance = analysis_cls()
                print(f"Running: {instance.name}")
                saved = instance.save(output_dir, formats=["png", "pdf", "csv", "json", "gif"])
                for fmt, path in saved.items():
                    print(f"  {fmt}: {path}")
            print("\nAll analyses complete.")
            return

        # Find matching analysis
        for analysis_cls in analyses:
            instance = analysis_cls()
            if instance.name == name:
                print(f"\nRunning: {instance.name}\n")
                saved = instance.save(output_dir, formats=["png", "pdf", "csv", "json", "gif"])
                print("Saved files:")
                for fmt, path in saved.items():
                    print(f"  {fmt}: {path}")
                return

        # No match found
        print(f"Analysis '{name}' not found. Available analyses:")
        for analysis_cls in analyses:
            instance = analysis_cls()
            print(f"  - {instance.name}")
        sys.exit(1)

    # Interactive menu mode
    options = ["[All] Run all analyses"]
    for analysis_cls in analyses:
        instance = analysis_cls()
        options.append(f"{snake_to_title(instance.name)}: {instance.description}")
    options.append("[Exit]")

    menu = TerminalMenu(
        options,
        title="Select an analysis to run (use arrow keys):",
        cycle_cursor=True,
        clear_screen=False,
    )
    choice = menu.show()

    if choice is None or choice == len(options) - 1:
        print("Exiting.")
        return

    if choice == 0:
        # Run all analyses
        print("\nRunning all analyses...\n")
        for analysis_cls in analyses:
            instance = analysis_cls()
            print(f"Running: {instance.name}")
            saved = instance.save(output_dir, formats=["png", "pdf", "csv", "json", "gif"])
            for fmt, path in saved.items():
                print(f"  {fmt}: {path}")
        print("\nAll analyses complete.")
    else:
        # Run selected analysis
        analysis_cls = analyses[choice - 1]
        instance = analysis_cls()
        print(f"\nRunning: {instance.name}\n")
        saved = instance.save(output_dir, formats=["png", "pdf", "csv", "json", "gif"])
        print("Saved files:")
        for fmt, path in saved.items():
            print(f"  {fmt}: {path}")


def index():
    """Interactive indexer selection menu."""
    indexers = Indexer.load()

    if not indexers:
        print("No indexers found in src/indexers/")
        return

    # Build menu options
    options = []
    for indexer_cls in indexers:
        instance = indexer_cls()
        options.append(f"{snake_to_title(instance.name)}: {instance.description}")
    options.append("[Exit]")

    menu = TerminalMenu(
        options,
        title="Select an indexer to run (use arrow keys):",
        cycle_cursor=True,
        clear_screen=False,
    )
    choice = menu.show()

    if choice is None or choice == len(options) - 1:
        print("Exiting.")
        return

    indexer_cls = indexers[choice]
    instance = indexer_cls()
    print(f"\nRunning: {instance.name}\n")
    instance.run()
    print("\nIndexer complete.")


def package():
    """Package the data directory into a zstd-compressed tar archive."""
    success = package_data()
    sys.exit(0 if success else 1)


def visualize(args: list[str]):
    """Build and/or serve the interactive Kalshi contract explorer.

    Usage:
        visualize                                       build the site dataset, then serve it
        visualize build                                 one-time build pass only
        visualize serve [--port N] [--workers N] [--reload]   serve an already-built dataset

    Serving runs the FastAPI app (src/visualize/app.py) under uvicorn. For production, point
    uvicorn/gunicorn at src.visualize.asgi:app directly (see the Dockerfile).
    """
    # Imports are local so `main.py` stays light and free of import-time side effects.
    from src.visualize.app import run
    from src.visualize.build import build_site_dataset

    data_dir = Path("output") / "site" / "data"
    sub = args[0] if args else None

    port = 8000
    if "--port" in args:
        i = args.index("--port")
        if i + 1 < len(args):
            port = int(args[i + 1])

    workers = 1
    if "--workers" in args:
        i = args.index("--workers")
        if i + 1 < len(args):
            workers = int(args[i + 1])

    reload = "--reload" in args

    if sub == "build":
        print("Building site dataset...")
        paths = build_site_dataset(out_dir=data_dir)
        print(f"Site dataset written to {paths['contracts'].parent}")
        return

    if sub == "serve":
        if not data_dir.exists():
            print(f"No built dataset at {data_dir}. Run 'visualize build' first.")
            sys.exit(1)
        run(data_dir=data_dir, port=port, workers=workers, reload=reload)
        return

    # Default: build then serve.
    print("Building site dataset...")
    build_site_dataset(out_dir=data_dir)
    run(data_dir=data_dir, port=port, workers=workers, reload=reload)


def main():
    if len(sys.argv) < 2:
        print("\nUsage: uv run main.py <command>")
        print("Commands: analyze, index, package, visualize")
        sys.exit(0)

    command = sys.argv[1]

    if command == "analyze":
        name = sys.argv[2] if len(sys.argv) > 2 else None
        analyze(name)
        sys.exit(0)

    if command == "index":
        index()
        sys.exit(0)

    if command == "package":
        package()
        sys.exit(0)

    if command == "visualize":
        visualize(sys.argv[2:])
        sys.exit(0)

    print(f"Unknown command: {command}")
    print("Commands: analyze, index, package, visualize")
    sys.exit(1)


if __name__ == "__main__":
    main()
