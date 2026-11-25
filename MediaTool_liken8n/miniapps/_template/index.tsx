// Mẫu mini app: chỉ khai báo panel cắm vào workspace. Player, timeline, kho file, job bar là của workspace.
// Xem docs/MINIAPP_AUTHORING.md.
import { defineMiniApp, t, type PanelProps } from "@mediatool/miniapp-sdk";
import { Button, Hint, Section } from "@mediatool/ui";

function Panel({ ws }: PanelProps) {
  const [s, set] = ws.state.use({ summary: "" });
  return (
    <Section title={t("section.title")}>
      <Button primary block onClick={async () => {
        const r = await ws.tools.run("media_probe", { inputs: { file: ws.input.current } }, { label: t("step.probe") });
        set({ summary: r.summary });
      }}>{t("cta")}</Button>
      {s.summary && <Hint>{s.summary}</Hint>}
    </Section>
  );
}

export default defineMiniApp({ panel: Panel });
