//! Giải mã video bằng FFmpeg (libavformat/libavcodec qua `ffmpeg-the-third`), đổi sang RGBA bằng swscale.
//! Giữ decoder mở giữa các khung: phát/xuất tuần tự thì giải mã nối tiếp, chỉ seek khi nhảy xa.

use anyhow::{anyhow, Context, Result};
use ffmpeg_the_third as ff;
use ff::format::Pixel;
use ff::media::Type as MediaType;
use ff::software::scaling;
use std::sync::Once;

static INIT: Once = Once::new();

pub fn init() {
    INIT.call_once(|| {
        let _ = ff::init();
        ff::util::log::set_level(ff::util::log::Level::Error);
    });
}

/// Khung RGBA đã giải mã (không premultiply).
pub struct RgbaFrame {
    pub width: u32,
    pub height: u32,
    pub stride: usize,
    pub data: Vec<u8>,
    pub time: f64,
}

pub struct VideoSource {
    input: ff::format::context::Input,
    stream_index: usize,
    decoder: ff::decoder::Video,
    scaler: Option<(u32, u32, scaling::Context)>,
    time_base: f64,
    frame_dur: f64,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    last: Option<RgbaFrame>,
    /// thời điểm (giây) của khung vừa giải mã, để biết có cần seek không
    cursor: f64,
    eof: bool,
}

// Mỗi VideoSource chỉ được dùng trên một luồng render tại một thời điểm.
unsafe impl Send for VideoSource {}

impl VideoSource {
    pub fn open(path: &str) -> Result<Self> {
        init();
        let input = ff::format::input(path).with_context(|| format!("FFmpeg không mở được '{path}'"))?;
        let stream = input.streams().best(MediaType::Video).ok_or_else(|| anyhow!("'{path}' không có luồng hình"))?;
        let stream_index = stream.index();
        let tb = stream.time_base();
        let time_base = tb.numerator() as f64 / tb.denominator().max(1) as f64;
        let rate = stream.avg_frame_rate();
        let fps = if rate.denominator() > 0 && rate.numerator() > 0 { rate.numerator() as f64 / rate.denominator() as f64 } else { 25.0 };
        let duration = if input.duration() > 0 { input.duration() as f64 / 1_000_000.0 } else { 0.0 };
        let ctx = ff::codec::context::Context::from_parameters(stream.parameters())?;
        let decoder = ctx.decoder().video()?;
        let (width, height) = (decoder.width(), decoder.height());
        Ok(Self {
            input, stream_index, decoder, scaler: None, time_base, frame_dur: 1.0 / fps,
            width, height, duration, last: None, cursor: f64::NEG_INFINITY, eof: false,
        })
    }

    fn seek(&mut self, t: f64) -> Result<()> {
        let ts = (t.max(0.0) * 1_000_000.0) as i64;
        self.input.seek(ts, ..=ts)?;
        self.decoder.flush();
        self.cursor = f64::NEG_INFINITY;
        self.eof = false;
        Ok(())
    }

    /// Khung tại thời điểm `t` (giây trong file nguồn), thu về tối đa `max_w`×`max_h` (giữ tỉ lệ).
    pub fn frame_at(&mut self, t: f64, max_w: u32, max_h: u32) -> Result<&RgbaFrame> {
        let t = t.clamp(0.0, (self.duration - self.frame_dur).max(0.0));
        let (ow, oh) = fit_within(self.width, self.height, max_w, max_h);
        if let Some(l) = &self.last {
            if l.width == ow && l.height == oh && t >= l.time - 1e-6 && t < l.time + self.frame_dur - 1e-6 {
                return Ok(self.last.as_ref().unwrap());
            }
        }
        // nhảy lùi hoặc nhảy xa → seek; còn lại giải mã tiếp
        if t < self.cursor - 1e-6 || t > self.cursor + 2.0 || self.eof {
            self.seek(t)?;
        }

        let target = t - self.frame_dur * 0.5;
        let mut decoded = ff::frame::Video::empty();
        let mut found: Option<f64> = None;
        let tb = self.time_base;
        'outer: loop {
            // lấy hết khung đang có trong decoder
            while self.decoder.receive_frame(&mut decoded).is_ok() {
                let pts = decoded.timestamp().or(decoded.pts()).map(|p| p as f64 * tb).unwrap_or(self.cursor + self.frame_dur);
                self.cursor = pts;
                if pts >= target {
                    found = Some(pts);
                    break 'outer;
                }
            }
            if self.eof {
                break;
            }
            // đọc gói tiếp theo của luồng hình
            let mut sent = false;
            for res in self.input.packets() {
                let (stream, packet) = res?;
                if stream.index() == self.stream_index {
                    self.decoder.send_packet(&packet)?;
                    sent = true;
                    break;
                }
            }
            if !sent {
                self.decoder.send_eof()?;
                self.eof = true;
            }
        }
        if found.is_none() && self.last.is_some() {
            return Ok(self.last.as_ref().unwrap()); // hết file: giữ khung cuối
        }
        let pts = found.ok_or_else(|| anyhow!("Không giải mã được khung tại {t:.2}s"))?;

        // đổi sang RGBA đúng kích thước cần dùng
        let need_new = !matches!(&self.scaler, Some((w, h, _)) if *w == ow && *h == oh);
        if need_new {
            let sc = scaling::Context::get(decoded.format(), decoded.width(), decoded.height(), Pixel::RGBA, ow, oh, scaling::Flags::BILINEAR)?;
            self.scaler = Some((ow, oh, sc));
        }
        let mut rgba = ff::frame::Video::empty();
        self.scaler.as_mut().unwrap().2.run(&decoded, &mut rgba)?;
        let stride = rgba.stride(0);
        let data = rgba.data(0)[..stride * oh as usize].to_vec();
        self.last = Some(RgbaFrame { width: ow, height: oh, stride, data, time: pts });
        Ok(self.last.as_ref().unwrap())
    }
}

pub fn fit_within(w: u32, h: u32, max_w: u32, max_h: u32) -> (u32, u32) {
    let s = (max_w as f64 / w.max(1) as f64).min(max_h as f64 / h.max(1) as f64).min(1.0);
    (((w as f64 * s).round() as u32).max(2) & !1, ((h as f64 * s).round() as u32).max(2) & !1)
}

/// Dải ảnh thu nhỏ (filmstrip) cho timeline: `count` khung đều nhau, cao `height` px, ghép ngang thành 1 JPEG (Skia).
pub fn filmstrip(path: &str, count: u32, height: u32) -> Result<Vec<u8>> {
    use skia_safe::{surfaces, AlphaType, ColorType, Data, EncodedImageFormat, ImageInfo, Paint, Rect};
    let mut v = VideoSource::open(path)?;
    let count = count.clamp(1, 60);
    let th = height.clamp(16, 360);
    let tw = ((v.width as f64 / v.height.max(1) as f64) * th as f64).round().max(8.0) as u32;
    let mut surface = surfaces::raster_n32_premul(((tw * count) as i32, th as i32)).ok_or_else(|| anyhow!("Không tạo được surface"))?;
    let dur = if v.duration > 0.0 { v.duration } else { 1.0 };
    for i in 0..count {
        let t = dur * (i as f64 + 0.5) / count as f64;
        let f = v.frame_at(t, tw, th)?;
        let info = ImageInfo::new((f.width as i32, f.height as i32), ColorType::RGBA8888, AlphaType::Unpremul, None);
        if let Some(img) = skia_safe::images::raster_from_data(&info, Data::new_copy(&f.data), f.stride) {
            surface.canvas().draw_image_rect(&img, None, Rect::from_xywh((i * tw) as f32, 0.0, tw as f32, th as f32), &Paint::default());
        }
    }
    #[allow(deprecated)]
    let data = surface.image_snapshot().encode_to_data_with_quality(EncodedImageFormat::JPEG, 70).ok_or_else(|| anyhow!("Không mã hóa JPEG"))?;
    Ok(data.as_bytes().to_vec())
}

/// Đỉnh sóng âm cho timeline: FFmpeg giải mã về mono f32 tần số thấp, chia `buckets` đoạn lấy biên độ lớn nhất (0..1).
pub fn peaks(ffmpeg: &str, path: &str, buckets: usize) -> Result<Vec<f32>> {
    let out = std::process::Command::new(ffmpeg)
        .args(["-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "2000", "-f", "f32le", "-"])
        .output()
        .with_context(|| format!("Không chạy được {ffmpeg}"))?;
    if !out.status.success() {
        return Err(anyhow!("FFmpeg không đọc được tiếng: {}", String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or("")));
    }
    let samples: Vec<f32> = out.stdout.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let buckets = buckets.clamp(8, 8000);
    if samples.is_empty() {
        return Ok(vec![0.0; buckets]);
    }
    let per = (samples.len() as f64 / buckets as f64).max(1.0);
    let mut res = Vec::with_capacity(buckets);
    for i in 0..buckets {
        let a = (i as f64 * per) as usize;
        let b = (((i + 1) as f64 * per) as usize).min(samples.len()).max(a + 1).min(samples.len());
        let peak = samples.get(a..b).map(|s| s.iter().fold(0f32, |m, v| m.max(v.abs()))).unwrap_or(0.0);
        res.push(peak.min(1.0));
    }
    Ok(res)
}

/// File có luồng tiếng không (để quyết định có trộn tiếng khi xuất).
pub fn has_audio(path: &str) -> bool {
    init();
    ff::format::input(path).map(|i| i.streams().best(MediaType::Audio).is_some()).unwrap_or(false)
}
