// Hiển thị kết quả tool cho người dùng: câu tóm tắt, cảnh báo, rồi từng output theo loại (bảng, video, âm thanh, ảnh, chữ).
import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Download } from "lucide-react";
import { isAssetRef, type AssetRef, type JobResult, type MediaToolClient } from "@mediatool/api-client";
import { Button, KeyValueTable, Notice } from "@mediatool/ui";
import { fileSize } from "../meta";

function JsonOutput({ client, asset }: { client: MediaToolClient; asset: AssetRef }) {
  const [data, setData] = useState<unknown>(null);
  const [raw, setRaw] = useState(false);
  useEffect(() => {
    fetch(client.assetUrl(asset.asset_id)).then((r) => r.json()).then(setData).catch(() => setData(null));
  }, [client, asset.asset_id]);
  if (data == null) return <div className="mt-hint">Đang tải…</div>;
  const items = (data as { items?: { label: string; value: unknown }[] }).items;
  return (
    <div className="rv-json">
      {Array.isArray(items) && <KeyValueTable items={items.map((i) => ({ label: i.label, value: String(i.value) }))} />}
      <button className="rv-raw-toggle" onClick={() => setRaw(!raw)}>
        {raw ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {Array.isArray(items) ? "Xem dữ liệu gốc" : "Xem dữ liệu"}
      </button>
      {raw && <pre className="sb-pre">{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}

function TextOutput({ client, asset }: { client: MediaToolClient; asset: AssetRef }) {
  const [text, setText] = useState("Đang tải…");
  useEffect(() => {
    fetch(client.assetUrl(asset.asset_id)).then((r) => r.text()).then((t) => setText(t.slice(0, 20000))).catch((e) => setText(String(e)));
  }, [client, asset.asset_id]);
  return <pre className="sb-pre" style={{ maxHeight: 260 }}>{text}</pre>;
}

export function OutputView({ client, name, asset }: { client: MediaToolClient; name: string; asset: AssetRef }) {
  const url = client.assetUrl(asset.asset_id);
  let body;
  if (asset.format === "video") body = <video src={url} poster={client.thumbnailUrl(asset.asset_id)} controls preload="metadata" className="rv-media" />;
  else if (asset.format === "audio") body = <audio src={url} controls style={{ width: "100%" }} />;
  else if (asset.format === "image") body = <img src={url} alt={asset.filename} className="rv-media" />;
  else if (asset.format === "json" || asset.filename?.endsWith(".json")) body = <JsonOutput client={client} asset={asset} />;
  else body = <TextOutput client={client} asset={asset} />;
  return (
    <div className="rv-output">
      <div className="rv-output-head">
        <div>
          <b>{asset.filename ?? name}</b>
          <span className="mt-hint"> · {fileSize(asset.size_bytes)}</span>
        </div>
        <a className="mt-btn small" href={client.assetUrl(asset.asset_id, true)}><Download size={14} /> Tải về</a>
      </div>
      {body}
    </div>
  );
}

export function ResultView({ client, result, onAgain }: { client: MediaToolClient; result: JobResult; onAgain?: () => void }) {
  const outs = Object.entries(result.outputs).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).filter(isAssetRef).map((a) => ({ k, a })));
  return (
    <div className="rv">
      <div className="rv-summary">
        <CheckCircle2 size={22} />
        <div>
          <b>Xong!</b>
          <div>{result.summary}</div>
        </div>
        {onAgain && <Button small onClick={onAgain}>Làm file khác</Button>}
      </div>
      {result.warnings.map((w, i) => <Notice key={i} kind="warn">{w}</Notice>)}
      {outs.map(({ k, a }) => <OutputView key={a.asset_id} client={client} name={k} asset={a} />)}
    </div>
  );
}
