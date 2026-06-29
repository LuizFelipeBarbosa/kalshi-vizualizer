# Container image for the Kalshi contract explorer (FastAPI + DuckDB).
#
# Build the distilled site dataset FIRST (one-time, needs the raw data/ present):
#     uv run main.py visualize build        # writes output/site/data/
# then:
#     docker build -t kalshi-tape .
#     docker run -p 8000:8000 kalshi-tape
#
# For a dataset too large to bake into the image, drop the COPY below and instead point
# SITE_DATA_DIR at a mounted volume, or have build_connection read_parquet from s3://.

FROM python:3.9-slim

# uv for fast, lockfile-pinned installs.
RUN pip install --no-cache-dir uv

WORKDIR /app
ENV PYTHONPATH=/app

# Dependencies first for better layer caching (uv.lock must be in sync with pyproject.toml).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Application code.
COPY main.py ./
COPY src ./src

# The prebuilt, distilled site dataset the server queries — NOT the ~36GiB raw data/.
COPY output/site/data /app/output/site/data
ENV SITE_DATA_DIR=/app/output/site/data

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "src.visualize.asgi:app", \
     "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
