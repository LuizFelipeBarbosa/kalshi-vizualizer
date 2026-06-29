.PHONY: analyze run index package visualize visualize-build visualize-serve lint format test setup

RUN = uv run main.py

analyze:
	$(RUN) analyze

run:
	$(RUN) analyze $(filter-out $@,$(MAKECMDGOALS))

index:
	$(RUN) index

package:
	$(RUN) package

visualize:
	$(RUN) visualize

visualize-build:
	$(RUN) visualize build

visualize-serve:
	$(RUN) visualize serve $(filter-out $@,$(MAKECMDGOALS))

lint:
	uv run ruff check .
	uv run ruff format --check .

format:
	uv run ruff check --fix .
	uv run ruff format .

test:
	uv run pytest tests/ -v

setup:
	bash scripts/install-tools.sh
	bash scripts/download.sh

%:
	@:
