import { Icon } from "./Icon";

export type PhotoItem = { id: string; src: string; caption?: string; /** nog niet opgeladen (wachtrij) */ pending?: boolean };

/** Raster van foto's. Eerste tegel = camera: één tik opent de camera van de gsm (capture="environment"). */
export function PhotoGrid({ photos, onFiles, onOpen, addLabel = "Foto" }: { photos: PhotoItem[]; onFiles?: (files: File[]) => void; onOpen?: (p: PhotoItem) => void; addLabel?: string }) {
  return (
    <div className="bw-photos">
      {onFiles && (
        <label className="bw-photo bw-photo--add">
          <Icon name="camera" size={30} />
          {addLabel}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            aria-label={addLabel}
            onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) onFiles(f); e.target.value = ""; }}
          />
        </label>
      )}
      {photos.map((p) => (
        <button key={p.id} type="button" className="bw-photo" onClick={() => onOpen?.(p)} aria-label={p.caption ?? "Foto"}>
          <img src={p.src} alt="" loading="lazy" />
          {p.caption && <span className="bw-photo__tag">{p.caption}</span>}
          {p.pending && <span className="bw-photo__wait" title="Wacht op verbinding"><Icon name="clock" size={14} /></span>}
        </button>
      ))}
    </div>
  );
}
