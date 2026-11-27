# Changelog

## 0.3.1
- Nhận diện bài hát, viết hoa đầu câu và ghi output dùng chung `mediatool_sdk.asr` (cùng các tool ZipFormer).

## 0.3.0
- **Tiếng Việt**: dùng PhoWhisper (VinAI, BSD-3) — `base` = PhoWhisper-small int8 (240 MB), `small` = PhoWhisper-medium (1,5 GB); ngôn ngữ khác vẫn dùng Whisper. Chọn model theo bảng `ENGINES` (ngôn ngữ → model). Mặc định `language = vi`.
- Đoạn nhận dạng quá dài được tách thành câu tại chỗ ngắt hơi (`timed.split_pauses`); model trả toàn chữ thường thì viết hoa chữ đầu câu.
- File bài hát / nhạc nền to: bộ lọc tiếng nói (VAD) loại giọng hát nên trước đây ra 0 dòng — giờ tự nhận ra và nghe cả file, kèm cảnh báo nên dùng `lyrics_align` khi có lời sẵn.
- Lọc đoạn "tưởng tượng" ở mép đoạn gần im lặng (quá ngắn / 1–2 từ độ tin cậy thấp); phụ đề dòng ngắn không còn dòng mồ côi một chữ.
- Đo trên mẫu tiếng Việt 37 từ: PhoWhisper-small sai 4 từ (~11%), PhoWhisper-medium đúng hoàn toàn.

## 0.2.0
- Đánh dấu hỗ trợ **tiếng Anh** (và vài ngoại ngữ lớn); bỏ tiếng Việt và "tự nhận biết" khỏi danh sách ngôn ngữ vì Whisper base / small chép tiếng Việt sai nhiều. Mặc định `language = en`.

## 0.1.2
- Thêm output `text` (lời chép thuần .txt) để nối vào tool đọc văn bản.

## 0.1.1
- Cắt dòng dùng `mediatool_sdk.timed.split_lines` (chung với các tool đọc / lồng tiếng).

## 0.1.0
- Bản đầu: chép lời nói thành phụ đề .srt + JSON thời gian từng từ bằng Whisper (faster-whisper), model base / small tải theo `[[models]]`, cắt dòng ngắn cho video dọc.
