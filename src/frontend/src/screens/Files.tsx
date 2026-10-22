import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ExternalBlob, type FileRec } from "../backend";
import { errText, fmtBytes, fmtTime, isPhone, openInNewTab, unwrap, useBackend } from "../util";

// Foto's worden op het toestel verkleind (≤ 1600 px, JPEG) vóór de upload (§4).
async function shrinkPhoto(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Verkleinen mislukt"))), "image/jpeg", 0.82));
}

export function FilesPanel() {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const [original, setOriginal] = useState(false);
  const [progress, setProgress] = useState(0);
  const [last, setLast] = useState("");
  const files = useQuery({ queryKey: ["files"], queryFn: () => actor!.listFiles(), enabled: !!actor });
  const [big, setBig] = useState<FileRec | null>(null);
  const sorted = (files.data ?? []).slice().sort((a, b) => Number(b.at - a.at));

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const isImage = file.type.startsWith("image/");
      const data = isImage && !original ? await shrinkPhoto(file) : file;
      const mime = isImage && !original ? "image/jpeg" : file.type;
      const name = isImage && !original ? file.name.replace(/\.[^.]+$/, "") + ".jpg" : file.name;
      const bytes = new Uint8Array(await data.arrayBuffer());
      const t0 = performance.now();
      setProgress(0);
      const blob = ExternalBlob.fromBytes(bytes, mime, name).withUploadProgress(setProgress);
      const id = unwrap(await actor!.addFile(name, mime, BigInt(bytes.length), blob));
      const secs = (performance.now() - t0) / 1000;
      setLast(`${name}: ${fmtBytes(file.size)} → ${fmtBytes(bytes.length)} in ${secs.toFixed(1)} s (bestand #${id})`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["files"] }),
  });

  return (
    <>
      <section className="card">
        <h2>Foto of PDF opladen</h2>
        <p>Proef voor de opslagdienst van Caffeine. Gebruik geen klantgegevens.</p>
        <div className="stack">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            capture={undefined}
            disabled={upload.isPending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
          <label className="chip">
            <input type="checkbox" checked={original} onChange={(e) => setOriginal(e.target.checked)} />
            origineel opladen (niet verkleinen)
          </label>
        </div>
        {upload.isPending && (
          <div className="uploading">
            <progress max={100} value={progress} />
            <span>{progress} %</span>
          </div>
        )}
        {last && <p>{last}</p>}
        {upload.error && <p className="error">{errText(upload.error)}</p>}
      </section>
      <section className="card">
        <h2>Bestanden</h2>
        {sorted.length === 0 && <p>Nog niets.</p>}
        <div className="grid">
          {sorted.map((f) => (
            <FileCard key={String(f.id)} f={f} onOpen={() => setBig(f)} />
          ))}
        </div>
      </section>
      {big && (
        <div className="lightbox" onClick={() => setBig(null)}>
          <img src={big.blob.getDirectURL()} alt={big.name} />
          <div className="lightbox-bar">
            <span>{big.name} · {fmtBytes(Number(big.size))}</span>
            <button type="button" onClick={() => setBig(null)}>Sluiten</button>
          </div>
        </div>
      )}
    </>
  );
}

function FileCard({ f, onOpen }: { f: FileRec; onOpen: () => void }) {
  const url = f.blob.getDirectURL();
  const [view, setView] = useState("");
  const [err, setErr] = useState("");
  const isPdf = f.mime === "application/pdf";
  const openPdf = async () => {
    setErr("");
    try {
      if (isPhone()) {
        // Gsm: eigen PDF-weergave van het toestel (alle pagina's, zoomen).
        await openInNewTab(() => f.blob.getBytes(), f.mime);
      } else {
        // Desktop: in de pagina. Via de bytes, want de opslag biedt het bestand als download aan.
        const bytes = await f.blob.getBytes();
        setView(URL.createObjectURL(new Blob([bytes], { type: f.mime })));
      }
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <div className="file">
      {isPdf ? (
        <button type="button" className="pdfbadge" onClick={openPdf}>PDF<br /><span className="small">openen</span></button>
      ) : (
        <button type="button" className="thumb" onClick={onOpen}>
          <img src={url} alt={f.name} loading="lazy" />
        </button>
      )}
      <div className="small">
        <b>{f.name}</b>
        <br />
        {fmtBytes(Number(f.size))} · {fmtTime(f.at)}
      </div>
      <details className="small">
        <summary>Rechtstreekse URL (voor test T5)</summary>
        <a href={url} target="_blank" rel="noreferrer" className="mono">{url}</a>
      </details>
      {err && <p className="error small">{err}</p>}
      {view && (
        <>
          <iframe title={f.name} src={view} className="pdfview" />
          <button type="button" className="secondary" onClick={() => setView("")}>PDF sluiten</button>
        </>
      )}
    </div>
  );
}
