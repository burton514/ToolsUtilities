# syntax=docker/dockerfile:1.7
# Core MediaTool: binary Rust (server + engine render native) + Python runtime (SDK + worker) + FFmpeg.

FROM rust:1-bookworm AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      clang libclang-dev pkg-config \
      libavcodec-dev libavformat-dev libavutil-dev libswscale-dev libswresample-dev libavfilter-dev libavdevice-dev \
      libfontconfig1-dev libfreetype-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src/core
COPY core/ ./
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/core/target \
    cargo build --release -p mediatool-server -p mediatool-render \
 && cp target/release/mediatool-server target/release/mediatool-render /usr/local/bin/

FROM python:3.12-slim-bookworm AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libfontconfig1 fonts-noto-core fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*
COPY sdk/python /opt/mediatool/sdk
COPY workers/python /opt/mediatool/worker
RUN pip install --no-cache-dir /opt/mediatool/sdk /opt/mediatool/worker "pytest>=8"
COPY --from=build /usr/local/bin/mediatool-server /usr/local/bin/mediatool-render /usr/local/bin/

ENV MEDIATOOL_HOST=0.0.0.0 \
    MEDIATOOL_PORT=8787 \
    MEDIATOOL_TOOLS=/app/tools \
    MEDIATOOL_MINIAPPS=/app/miniapps \
    MEDIATOOL_DATA=/app/data \
    MEDIATOOL_CONFIG=/app/config \
    MEDIATOOL_LIBRARY=/app/library \
    MEDIATOOL_PYTHON=python3 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
EXPOSE 8787
CMD ["mediatool-server"]
