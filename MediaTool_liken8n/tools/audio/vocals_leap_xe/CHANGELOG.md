# Changelog

## 0.1.0
- Bản đầu: tách giọng hát + nhạc nền bằng BS-RoFormer Leap Xe (pcunwa/BS-Roformer-Leap, `Xe/`), đọc checkpoint PyTorch gốc không cần torch (`mediatool_sdk.ckpt`), chạy bằng `mediatool_sdk.bs_roformer` (numpy + onnxruntime, đối chiếu code gốc ZFTurbo: SNR ~65 dB). Chạy cả bài theo `demix` của ZFTurbo, bộ đệm một đoạn. Nhạc nền: bài gốc − giọng hoặc model nhạc nền riêng của Leap Xe. Máy chủ bản GPU (`MEDIATOOL_DEVICE`) thì tự chạy CUDA qua `mediatool_sdk.device`.
