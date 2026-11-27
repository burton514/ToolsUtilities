# Changelog

## 0.2.0
- Thêm bước tách giọng `audio_vocals_leap_xe` (BS-RoFormer Leap Xe) ở đầu chuỗi: căn lời trên **giọng đã tách** (chính xác hơn khi nhạc to), video karaoke dùng **nhạc nền không lời** thay tiếng gốc (`video_volume = 0`). Output thêm `instrumental`, `vocals`; tham số thêm `instrumental`, `separation_quality`. Máy chủ bản GPU: bước tách tự chạy CUDA. Luồng B chạy trọn.

## 0.1.0
- Bản đầu: chuỗi `lyrics_align` → `compose_bind` (MV + lời → video karaoke trên hình và nhạc gốc + .lrc). Luồng B của mục tiêu đợt 1, chưa có bước tách giọng.
