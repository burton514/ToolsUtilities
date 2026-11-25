// Xem nhanh một asset (video, audio, ảnh, văn bản/JSON) — dùng trong bảng kiểm thử và chuỗi tool.
import { useEffect, useState } from "react";
import type { AssetRef, MediaToolClient } from "@mediatool/api-client";

export function AssetPreview({ client, asset, compact }: { client: MediaToolClient; asset: AssetRef; compact?: boolean }) {
  const url = client.assetUrl(asset.asset_id);
  const [text, setText] = useState<string | null>(null);
  const isText = !["video", "audio", "image"].includes(asset.format);
  useEffect(() => {
    if (!isText) return;
    let alive = true;
    fetch(url)
      .then((r) => r.text())
      .then((t) => alive && setText(t.length > 50_000 ? t.slice(0, 50_000) + "\n…" : t))
      .catch((e) => alive && setText(String(e)));
    return () => {
      alive = false;
    };
  }, [url, isText]);
  const h = compact ? 120 : 360;
  if (asset.format === "video") return <video src={url} controls style={{ maxWidth: "100%", maxHeight: h }} />;
  if (asset.format === "audio") return <audio src={url} controls style={{ width: "100%" }} />;
  if (asset.format === "image") return <img src={url} alt={asset.filename} style={{ maxWidth: "100%", maxHeight: h }} />;
  return <pre className="sb-pre" style={{ maxHeight: h }}>{text ?? "Đang tải…"}</pre>;
}

export function PreviewModal({ client, asset, onClose }: { client: MediaToolClient; asset: AssetRef | null; onClose: () => void }) {
  if (!asset) return null;
  return (
    <div className="sb-modal" onClick={onClose}>
      <div className="sb-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="sb-row" style={{ justifyContent: "space-between" }}>
          <b>{asset.filename} <span className="sb-dim">({asset.format})</span></b>
          <span className="sb-row">
            <a className="mt-btn small" href={client.assetUrl(asset.asset_id, true)}>Tải về</a>
            <button className="mt-btn small" onClick={onClose}>Đóng</button>
          </span>
        </div>
        <AssetPreview client={client} asset={asset} />
      </div>
    </div>
  );
}
