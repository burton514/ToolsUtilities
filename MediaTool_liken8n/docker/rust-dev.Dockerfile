# Môi trường build core Rust có engine native: FFmpeg (libav*), clang (bindgen), fontconfig/freetype (Skia).
FROM rust:1-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      clang libclang-dev pkg-config \
      libavcodec-dev libavformat-dev libavutil-dev libswscale-dev libswresample-dev libavfilter-dev libavdevice-dev \
      libfontconfig1-dev libfreetype-dev fonts-noto-core fonts-noto-color-emoji ffmpeg \
 && rm -rf /var/lib/apt/lists/*
