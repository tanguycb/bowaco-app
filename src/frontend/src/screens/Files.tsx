import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ExternalBlob, type FileRec } from "../backend";
import { errText, fmtBytes, fmtTime, unwrap, useBackend } from "../util";

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
        {upload.isPending && <progress max={100} value={progress} />}
        {last && <p>{last}</p>}
        {upload.error && <p className="error">{errText(upload.error)}</p>}
      </section>
      <section className="card">
        <h2>Bestanden</h2>
        {(files.data ?? []).length === 0 && <p>Nog niets.</p>}
        <div className="grid">
          {(files.data ?? []).map((f) => (
            <FileCard key={String(f.id)} f={f} />
          ))}
        </div>
      </section>
    </>
  );
}

function FileCard({ f }: { f: FileRec }) {
  const url = f.blob.getDirectURL();
  const [view, setView] = useState<string>("");
  const isPdf = f.mime === "application/pdf";
  const show = async () => {
    // Via de bytes, zodat de browser de PDF toont ook als de gateway hem als download aanbiedt.
    const bytes = await f.blob.getBytes();
    setView(URL.createObjectURL(new Blob([bytes], { type: f.mime })));
  };
  return (
    <div className="file">
      {isPdf ? <div className="pdfbadge">PDF</div> : <img src={url} alt={f.name} loading="lazy" />}
      <div className="small">
        <b>{f.name}</b> · {fmtBytes(Number(f.size))} · {fmtTime(f.at)}
      </div>
      <div className="small">
        <a href={url} target="_blank" rel="noreferrer">rechtstreekse URL</a>
        {isPdf && (
          <>
            {" · "}
            <button type="button" className="link" onClick={show}>tonen</button>
          </>
        )}
      </div>
      <details className="small">
        <summary>URL</summary>
        <span className="mono">{url}</span>
      </details>
      {view && <iframe title={f.name} src={view} className="pdfview" />}
    </div>
  );
}
