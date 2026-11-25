import { useState } from "react";
import { defineMiniApp, t, type PanelProps, type Ws } from "@mediatool/miniapp-sdk";
import { Button, Hint, Notice, Section, Select, Toggle } from "@mediatool/ui";

type Format = "wav" | "mp3" | "original";

interface State {
  info: string;
  format: Format;
  subs: boolean;
  done: string;
}

const initial: State = { info: "", format: "wav", subs: true, done: "" };

/** Đọc thông tin video bằng media_probe rồi lưu vào state (gọi được từ setup và toolbar). */
async function probe(ws: Ws) {
  const r = await ws.tools.run("media_probe", { inputs: { file: ws.input.current } }, { label: t("step.probe") });
  ws.state.set<State>({ info: r.summary });
}

function Panel({ ws }: PanelProps) {
  const [s, set] = ws.state.use<State>(initial);
  const [busy, setBusy] = useState(false);

  async function extract() {
    setBusy(true);
    try {
      const r = await ws.tools.run(
        "video_demux",
        { inputs: { video: ws.input.current }, params: { audio_format: s.format, extract_subtitles: s.subs } },
        { label: t("step.demux") },
      );
      if (r.outputs.audio) {
        // Timeline và player là của workspace: mini app chỉ đưa asset lên
        ws.timeline.addTrack({ id: "audio", source: r.outputs.audio, label: "Tiếng đã tách" });
        ws.result.show(r.outputs.audio, { compareWith: ws.input.current });
      }
      set({ done: r.summary });
    } catch {
      /* lỗi đã được workspace hiện thành thông báo */
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section title={t("info.title")}>
        <Hint>{s.info || t("info.loading")}</Hint>
      </Section>
      <Section title={t("format.title")}>
        <Select<Format>
          value={s.format}
          options={[
            { value: "wav", label: t("format.wav") },
            { value: "mp3", label: t("format.mp3") },
            { value: "original", label: t("format.original") },
          ]}
          onChange={(v) => set({ format: v })}
        />
        <Toggle label={t("subs")} checked={s.subs} onChange={(v) => set({ subs: v })} />
      </Section>
      <Section>
        <Button primary block disabled={busy} onClick={() => void extract()}>
          {busy ? t("running") : t("cta")}
        </Button>
        {s.done && <Notice kind="ok">{t("done", { summary: s.done })}</Notice>}
      </Section>
    </>
  );
}

export default defineMiniApp({
  setup: probe, // chạy ngay sau khi người dùng chọn video
  panel: Panel,
  toolbar: [{ id: "reprobe", label: "toolbar.reprobe", run: probe }],
});
