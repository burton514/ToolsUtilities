from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from mediatool_sdk import AudioFile, BaseTool, Context, InputError, JsonData, Result, SubtitleFile, VideoFile

# đuôi file khi giữ nguyên codec tiếng
_AUDIO_EXT = {"aac": "m4a", "mp3": "mp3", "opus": "opus", "vorbis": "ogg", "flac": "flac", "alac": "m4a",
              "pcm_s16le": "wav", "pcm_s24le": "wav"}
_TEXT_SUBS = {"subrip": "srt", "srt": "srt", "ass": "ass", "ssa": "ass", "webvtt": "srt", "mov_text": "srt", "text": "srt"}
_VIDEO_CONTAINERS = {"mp4", "mkv", "mov", "webm"}


class Inputs(BaseModel):
    video: VideoFile = Field(description="Video cần tách")


class Params(BaseModel):
    audio_format: Literal["wav", "original", "mp3"] = Field(
        "wav", description="Định dạng file tiếng tách ra", json_schema_extra={"x-labels": {"wav": "WAV — dễ xử lý tiếp nhất", "original": "Giữ nguyên — nhanh nhất", "mp3": "MP3 — nhẹ"}})
    audio_track: int = Field(1, ge=1, le=32, description="Chọn track tiếng nếu video có nhiều track (1, 2, …)")
    extract_subtitles: bool = Field(True, description="Lấy luôn phụ đề có sẵn trong file")


class Outputs(BaseModel):
    video: VideoFile = Field(description="Hình, không có tiếng (giữ nguyên chất lượng)")
    audio: AudioFile | None = Field(None, description="Tiếng của track đã chọn (không có nếu video không có tiếng)")
    subtitles: list[SubtitleFile] = Field(default_factory=list, description="Các phụ đề dạng chữ có sẵn trong file")
    info: JsonData = Field(description="Thông tin các luồng của video gốc")


class DemuxTool(BaseTool[Inputs, Params, Outputs]):
    def check(self, ctx: Context) -> None:
        ctx.require_binary("ffmpeg")
        ctx.require_binary("ffprobe")

    def run(self, inputs: Inputs, params: Params, ctx: Context) -> Result[Outputs]:
        src = inputs.video.path
        ctx.progress(0.02, "Đang đọc file")
        raw = ctx.probe(src)
        streams = raw.get("streams", [])
        duration = float(raw.get("format", {}).get("duration") or 0) or None
        videos = [s for s in streams if s.get("codec_type") == "video"
                  and not (s.get("disposition") or {}).get("attached_pic")]
        audios = [s for s in streams if s.get("codec_type") == "audio"]
        subs = [s for s in streams if s.get("codec_type") == "subtitle"]
        if not videos:
            raise InputError("video", "File không có hình. Nếu là file nhạc, hãy dùng trực tiếp như audio.")
        warnings: list[str] = []

        # 1) hình, không tiếng — copy luồng, không mã hóa lại
        ext = src.suffix.lower().lstrip(".")
        ext = ext if ext in _VIDEO_CONTAINERS else "mkv"
        video_out = ctx.workdir / f"video.{ext}"
        ctx.ffmpeg(["-i", str(src), "-map", "0:v:0", "-c", "copy", "-an", "-sn", "-dn", str(video_out)],
                   total_seconds=duration, progress_range=(0.05, 0.35), message="Đang tách hình")

        # 2) tiếng
        audio_out = None
        if not audios:
            warnings.append("Video không có tiếng")
        else:
            if params.audio_track > len(audios):
                raise InputError("audio_track", f"Video chỉ có {len(audios)} track tiếng")
            a = audios[params.audio_track - 1]
            sel = ["-map", f"0:a:{params.audio_track - 1}", "-vn", "-sn", "-dn"]
            if params.audio_format == "wav":
                audio_out, codec = ctx.workdir / "audio.wav", ["-c:a", "pcm_s16le"]
            elif params.audio_format == "mp3":
                audio_out, codec = ctx.workdir / "audio.mp3", ["-c:a", "libmp3lame", "-q:a", "2"]
            else:
                aext = _AUDIO_EXT.get(a.get("codec_name", ""), "mka")
                audio_out, codec = ctx.workdir / f"audio.{aext}", ["-c:a", "copy"]
            ctx.ffmpeg(["-i", str(src), *sel, *codec, str(audio_out)],
                       total_seconds=duration, progress_range=(0.35, 0.85), message="Đang tách tiếng")

        # 3) phụ đề dạng chữ
        sub_files: list[SubtitleFile] = []
        if params.extract_subtitles and subs:
            for i, s in enumerate(subs):
                ctx.check_cancelled()
                sext = _TEXT_SUBS.get(s.get("codec_name", ""))
                lang = (s.get("tags") or {}).get("language") or "und"
                if not sext:
                    warnings.append(f"Bỏ qua phụ đề {i + 1} ({s.get('codec_name')}): phụ đề dạng ảnh chưa hỗ trợ")
                    continue
                out = ctx.workdir / f"subtitle_{i + 1}_{lang}.{sext}"
                ctx.ffmpeg(["-i", str(src), "-map", f"0:s:{i}", "-c:s", "ass" if sext == "ass" else "srt", str(out)],
                           progress_range=(0.85 + 0.1 * i / len(subs), 0.85 + 0.1 * (i + 1) / len(subs)))
                sub_files.append(SubtitleFile(path=out))

        info = JsonData.write(ctx.workdir / "streams.json", {
            "duration_s": duration,
            "video_streams": len(videos), "audio_streams": len(audios), "subtitle_streams": len(subs),
            "streams": [{"index": s.get("index"), "type": s.get("codec_type"), "codec": s.get("codec_name"),
                         "language": (s.get("tags") or {}).get("language")} for s in streams],
        })

        parts = ["hình"] + (["tiếng"] if audio_out else []) + ([f"{len(sub_files)} phụ đề"] if sub_files else [])
        return Result(
            outputs=Outputs(video=VideoFile(path=video_out), audio=AudioFile(path=audio_out) if audio_out else None,
                            subtitles=sub_files, info=info),
            summary="Đã tách " + ", ".join(parts),
            warnings=warnings,
        )
