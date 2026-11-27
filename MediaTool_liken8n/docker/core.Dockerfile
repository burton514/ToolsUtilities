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
# Thư viện cho tool AI chạy CPU (model tải khi cần theo [[models]] của từng tool, không đóng vào image)
RUN pip install --no-cache-dir "numpy>=1.26" "onnxruntime>=1.18" "faster-whisper>=1.0"
# Giọng đọc VieNeu-TTS (Apache-2.0): chỉ phần chạy ONNX trên CPU — bỏ gradio / librosa / torch mà gói kéo theo
RUN pip install --no-cache-dir --no-deps "vieneu==3.8.5" \
 && pip install --no-cache-dir "sea-g2p>=0.9.1" "soundfile>=0.12" "soxr>=0.3" "kaldi-native-fbank>=1.20" "tokenizers>=0.20"
# Nhận dạng giọng nói ZipFormer / k2 (speech_zipformer_*): sherpa-onnx (Apache-2.0)
RUN pip install --no-cache-dir "sherpa-onnx==2.0.3"
# Tách nguồn âm BS-RoFormer (audio_vocals_leap_xe, audio_stems6_sw): dựng đồ thị ONNX nhỏ lúc chạy — onnx (Apache-2.0)
RUN pip install --no-cache-dir "onnx==1.19.1"
# Bản GPU (docker-compose.gpu.yml đặt GPU=1): đổi onnxruntime sang onnxruntime-gpu kèm CUDA 12 + cuDNN 9 cài bằng pip.
# Ghim 1.26.0 — bản cuối dùng CUDA 12 (từ 1.27 cần CUDA 13 = driver NVIDIA >= 580). Một đường GPU duy nhất: CUDA.
# thư viện CUDA / cuDNN cài bằng pip: chỉ cho CTranslate2 (chép lời Whisper) tìm thấy; bản CPU không có thư mục này → vô hại
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.12/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.12/site-packages/nvidia/cudnn/lib:/usr/local/lib/python3.12/site-packages/nvidia/cuda_runtime/lib
ARG GPU=0
RUN if [ "$GPU" = "1" ]; then       pip uninstall -y onnxruntime && pip install --no-cache-dir "onnxruntime-gpu[cuda,cudnn]==1.26.0";     fi
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
