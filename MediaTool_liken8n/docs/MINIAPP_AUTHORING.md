# Hướng dẫn viết Mini app

> Đọc trước: [ARCHITECTURE.md](ARCHITECTURE.md), mục 5 (Workspace và Mini app).

Mini app là **một tính năng** cho người dùng cuối, ví dụ "Làm video karaoke", "Tách giọng hát", "Dựng video theo nhịp".

**Bạn không dựng màn hình.** Workspace của core đã có sẵn trình phát video/audio, timeline, kho file, thanh tiến độ và màn xuất file. Bạn chỉ **cắm component của mình vào các slot** (panel, toolbar, overlay, track, result) và điều khiển phần chung qua `ws` (workspace API).

Bạn chỉ làm việc trong **một thư mục**: `miniapps/<name>/`.

## 0. Ba mức, chọn mức thấp nhất đủ dùng

| Mức | Bạn viết gì | Khi nào |
|---|---|---|
| **0. Không viết gì** | Không có gì | Mọi tool tự có panel sinh từ schema trong workspace. Đủ dùng cho các tool đơn giản (cắt, đổi định dạng, chuẩn hóa âm lượng…) |
| **1. Panel bằng component có sẵn** | `index.tsx` + panel ghép từ `@mediatool/ui` | Phần lớn mini app: một tính năng gồm nhiều tool, có vài tham số và nút |
| **2. Component riêng** | Thêm component React trong `panels/`, overlay, track | Cần tương tác đặc biệt, ví dụ kéo vùng đặt chữ trên video |

## 1. Tạo mini app

```powershell
mediatool-dev miniapp new karaoke_maker
```

```
miniapps/karaoke_maker/
├── manifest.json
├── index.tsx          # defineMiniApp(...)
├── panels/            # component của bạn (mức 1–2)
├── strings/vi.json    # tiếng Việt (mặc định) · en.json
├── mocks/             # (tùy chọn) kết quả tool giả lập để làm UI khi không chạy tool thật
├── icon.svg
└── README.md
```

## 2. `manifest.json`

```json
{
  "name": "karaoke_maker",
  "title": "Làm video karaoke",
  "description": "Từ video bài hát: tách giọng, căn lời theo từng chữ, xuất video karaoke.",
  "category": "karaoke",
  "version": "0.1.0",
  "sdk": "^0.1",
  "icon": "icon.svg",
  "owners": ["ten-github-cua-ban"],
  "accepts": [{ "format": "video", "multiple": false }],
  "layout": "video",
  "slots": ["panel", "toolbar"],
  "tools": [
    "video_demux", "audio_separate_stems", "music_vocal_activity",
    "lyrics_import", "lyrics_align", "audio_pitch_shift",
    "karaoke_render_subtitle", "karaoke_compose"
  ],
  "workflowSuggestions": [{ "title": "Karaoke → Hạ tông", "prompt": "Làm karaoke bài này rồi hạ 2 tông." }],
  "related": ["vocal_remover"]
}
```

| Trường | Ý nghĩa |
|---|---|
| `accepts` | Loại input theo `format`. Workspace tự lo bước chọn hoặc kéo thả file và nạp file vào player |
| `layout` | Bố cục workspace: `video` (viewer lớn + timeline), `audio` (waveform lớn), `compact` (chỉ panel + kết quả) |
| `slots` | Các slot mini app sử dụng |
| `tools` | **Mọi** tool được gọi. Workspace chặn tool không có trong danh sách |

## 3. `ws`: workspace API

| API | Dùng để |
|---|---|
| `ws.input` | File input hiện tại (asset), `ws.input.onChange(cb)` |
| `ws.player` | `play()`, `pause()`, `seek(t)`, `time` (theo dõi được), `setLoop(range)`, `setTrackGain(id, v)`, `mute(id)`, `setSubtitle(asset)` (preview SRT/ASS/karaoke), `compare(a, b)` |
| `ws.timeline` | `addTrack({id, source, editable})` (renderer chọn theo `format` của asset), `updateTrack`, `removeTrack`, `selection`, `markers`, `onEdit(id, cb)` |
| `ws.tools.run(id, {inputs, params}, {label})` | Chạy tool. Bước chạy tự hiện trên job bar. Trả `{outputs, summary, warnings}` |
| `ws.assets` | `pick({format})`, `add(asset)`, `url(asset)` |
| `ws.result` | `show(asset, {compareWith})`, `export(asset, preset)` |
| `ws.state` | Trạng thái của mini app, tự lưu theo project: `const [s, set] = ws.state.use({...})` |
| `ws.ui` | `toast`, `confirm`, `dialog` · `t()` để lấy chuỗi đa ngôn ngữ |

Mọi hàm đều bất đồng bộ và chỉ nhận/trả dữ liệu serialize được.

## 4. Ví dụ: `index.tsx`

```tsx
import { defineMiniApp, t, type Ws } from "@mediatool/miniapp-sdk";
import { KaraokePanel } from "./panels/KaraokePanel";

export default defineMiniApp({
  // Chạy khi người dùng mở file: tách sẵn và đưa lên timeline
  async setup(ws: Ws) {
    const demux = await ws.tools.run("video_demux", { inputs: { video: ws.input.current } }, { label: t("step.demux") });
    const stems = await ws.tools.run("audio_separate_stems",
      { inputs: { audio: demux.outputs.audio }, params: { stems: "2" } }, { label: t("step.separate") });

    ws.timeline.addTrack({ id: "music",  source: stems.outputs.accompaniment });   // waveform
    ws.timeline.addTrack({ id: "vocals", source: stems.outputs.vocals });          // waveform
    ws.state.set({ video: demux.outputs.video, ...stems.outputs });
  },

  panel: KaraokePanel,

  toolbar: [
    { id: "tone_down", icon: "minus", label: t("btn.toneDown"), run: ws => ws.state.set(s => ({ tone: s.tone - 1 })) },
    { id: "tone_up",   icon: "plus",  label: t("btn.toneUp"),   run: ws => ws.state.set(s => ({ tone: s.tone + 1 })) },
  ],
});
```

## 5. Ví dụ: `panels/KaraokePanel.tsx`

```tsx
import { Section, TextArea, Slider, Select, Button } from "@mediatool/ui";
import { t, type PanelProps } from "@mediatool/miniapp-sdk";

export function KaraokePanel({ ws }: PanelProps) {
  const [s, set] = ws.state.use({ lyrics: "", tone: 0, guide: 10, style: "classic", timed: null });

  async function align() {
    const lyr = await ws.tools.run("lyrics_import", { params: { text: s.lyrics } }, { label: t("step.import") });
    const vad = await ws.tools.run("music_vocal_activity", { inputs: { vocals: s.vocals } }, { label: t("step.vad") });
    const res = await ws.tools.run("lyrics_align",
      { inputs: { vocals: s.vocals, lyrics: lyr.outputs.lyrics, ranges: vad.outputs.ranges } }, { label: t("step.align") });

    // Track lời là renderer chuẩn của workspace: người dùng kéo thả sửa thời gian từng chữ
    ws.timeline.addTrack({ id: "lyrics", source: res.outputs.lyrics, editable: true });
    ws.timeline.onEdit("lyrics", edited => set({ timed: edited }));
    set({ timed: res.outputs.lyrics });
    preview(res.outputs.lyrics);
  }

  async function preview(timed = s.timed) {
    const ass = await ws.tools.run("karaoke_render_subtitle",
      { inputs: { lyrics: timed }, params: { style: s.style } }, { label: t("step.subtitle") });
    ws.player.setSubtitle(ass.outputs.subtitle);           // xem karaoke chạy chữ ngay trên player
  }

  async function exportVideo() {
    let music = s.accompaniment;
    if (s.tone !== 0) {
      music = (await ws.tools.run("audio_pitch_shift",
        { inputs: { audio: music }, params: { semitones: s.tone } }, { label: t("step.tone") })).outputs.audio;
    }
    const ass = await ws.tools.run("karaoke_render_subtitle", { inputs: { lyrics: s.timed }, params: { style: s.style } });
    const out = await ws.tools.run("karaoke_compose", {
      inputs: { background: s.video, music, guide: s.vocals, subtitle: ass.outputs.subtitle },
      params: { guide_volume: s.guide },                 // 0–30 %, xem TOOL_SPECS.md
    }, { label: t("step.compose") });
    ws.result.show(out.outputs.video, { compareWith: ws.input.current });
  }

  return (
    <>
      <Section title={t("lyrics.title")}>
        <TextArea rows={8} value={s.lyrics} placeholder={t("lyrics.hint")} onChange={v => set({ lyrics: v })} />
        <Button onClick={align} disabled={!s.lyrics.trim()}>{t("btn.align")}</Button>
      </Section>

      <Section title={t("music.title")}>
        <Slider label={t("tone")} min={-6} max={6} value={s.tone} onChange={v => set({ tone: v })} />
        <Slider label={t("guide")} min={0} max={30} step={5} value={s.guide} unit="%"
                onChange={v => { set({ guide: v }); ws.player.setTrackGain("vocals", v / 100); }} />
      </Section>

      <Section title={t("style.title")}>
        <Select value={s.style} options={["classic", "neon", "minimal"]}
                onChange={v => { set({ style: v }); if (s.timed) preview(); }} />
      </Section>

      <Button primary block onClick={exportVideo} disabled={!s.timed}>{t("cta")}</Button>
    </>
  );
}
```

Mini app không viết dòng nào cho player, waveform, timeline lời, thanh tiến độ hay màn so sánh kết quả. Workspace lo hết những phần đó.

## 6. Component dùng chung: `@mediatool/ui`

`Section`, `Button`, `IconButton`, `Slider`, `RangeSlider`, `Select`, `Segmented`, `Toggle`, `TextArea`, `TextInput`, `NumberInput`, `ColorPicker`, `FontPicker` (font tiếng Việt có sẵn), `TimeInput`, `AssetPicker`, `PresetList`, `Badge`, `Hint`…

Cần component mà **nhiều** mini app sẽ dùng thì đề xuất thêm vào `packages/ui/` (PR riêng cho nhóm core). Component chỉ cho riêng mini app của bạn thì đặt trong `panels/`.

## 7. Chạy và kiểm thử

```powershell
mediatool sandbox
```

Mở tab **Mini apps** và chọn mini app của bạn. Mini app chạy trong **workspace thật** với core local; sandbox hiển thị từng lời gọi `ws` và tool, kèm lỗi theo từng slot.

```powershell
mediatool-dev miniapp dev karaoke_maker --mock
```

Chế độ `--mock` cho phép làm UI **không cần chạy tool thật**. `ws.tools.run` trả kết quả từ `mocks/<tool_id>.json`, hoặc từ `[[examples]]` của tool nếu không có mock. Người làm giao diện không phải chờ người làm tool, và máy yếu vẫn làm UI được.

```powershell
mediatool-dev miniapp validate karaoke_maker
```

## 8. Checklist trước khi mở PR

- [ ] PR chỉ sửa file trong `miniapps/<name>/`
- [ ] `tools` trong manifest đủ và đúng với các lời gọi `ws.tools.run` (`validate` kiểm tra)
- [ ] Chỉ import `@mediatool/miniapp-sdk`, `@mediatool/ui`, React (và thư viện nhỏ đã khai báo)
- [ ] Không tự làm lại player, timeline, waveform, job bar hay màn xuất file
- [ ] Mọi chuỗi hiển thị nằm trong `strings/vi.json` (+ `en.json`); CSS chỉ dùng CSS module
- [ ] Chạy được bằng `--mock` và chạy thật trong sandbox
- [ ] Xử lý trường hợp tool `unavailable` và tool trả `warnings`

## 9. Không được làm

- Xử lý media trong mini app (encode, cắt hay ghép bằng JS). Việc đó là của tool
- Gọi HTTP trực tiếp, truy cập DOM ngoài slot của mình, viết CSS toàn cục
- Import code của mini app khác, của workspace hay của shell
- Sửa `packages/workspace/`, `packages/ui/`, `sandbox/` hay `desktop/` trong cùng PR
