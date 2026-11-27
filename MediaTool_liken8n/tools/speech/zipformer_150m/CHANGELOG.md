# Changelog

## 0.1.0
- Bản đầu: chép lời tiếng Việt bằng model ZipFormer của hynt (ONNX int8, sherpa-onnx, CPU); cắt đoạn bằng VAD (tự xử lý bài hát), thời gian từng từ, tách câu tại chỗ ngắt hơi; output giống speech_transcribe. Phần xử lý chung ở `mediatool_sdk.asr`.
