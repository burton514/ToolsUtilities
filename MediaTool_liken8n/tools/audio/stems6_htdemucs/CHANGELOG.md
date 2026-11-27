# Changelog

## 0.1.0
- Bản đầu: tách 6 phần (giọng, trống, bass, guitar, piano, khác) + nhạc nền ghép sẵn bằng HTDemucs 6s (Meta, MIT; ONNX StemSplitio/htdemucs-6s-onnx, trọng số fp16). Chạy theo đoạn như `demucs.apply` (chuẩn hóa theo cả bài, chồng 25%, trọng số tam giác), bộ đệm một đoạn. Phần chạy theo đoạn dùng chung ở `mediatool_sdk.stems`. Máy chủ bản GPU (`MEDIATOOL_DEVICE`) thì tự chạy CUDA qua `mediatool_sdk.device`.
