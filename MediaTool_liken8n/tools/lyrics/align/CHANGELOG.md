# Changelog

## 0.1.0
- Bản đầu: căn lời bài hát theo nhạc (thời gian từng chữ) theo phương pháp nguyenvulebinh/lyric-alignment — chữ viết → cách đọc (sea-g2p), wav2vec2 CTC (ONNX, CPU, chạy theo đoạn), căn ép Viterbi; 2 model: `song` (CC-BY-NC) và `general` (Apache-2.0); xuất Enhanced LRC + TimedLyrics, cảnh báo dòng tin cậy thấp.
- Review: chữ ghép gạch nối / gạch chéo tách thành âm tiết, số đọc theo ngữ cảnh chữ trước ("ngày 26/11"), bỏ dòng chỉ có ký hiệu, ngưỡng tin cậy 0,5 theo số đo + cảnh báo cả bài, JSON sai dạng báo lỗi đầu vào thay vì sập, lời dài hơn âm thanh báo rõ.
