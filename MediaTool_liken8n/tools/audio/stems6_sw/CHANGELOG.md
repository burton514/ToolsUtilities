# Changelog

## 0.1.0
- Bản đầu: tách 6 phần (giọng, trống, bass, guitar, piano, khác) + nhạc nền ghép sẵn bằng BS-RoFormer SW (`BS-Rofo-SW-Fixed`, bản sao koidn/BS-RoFormer-SW-6stem), đọc checkpoint PyTorch gốc không cần torch, chạy bằng `mediatool_sdk.bs_roformer` (đối chiếu code gốc ZFTurbo: SNR ~130 dB). Chạy cả bài theo `demix` của ZFTurbo, bộ đệm một đoạn. Máy chủ bản GPU (`MEDIATOOL_DEVICE`) thì tự chạy CUDA qua `mediatool_sdk.device`.
