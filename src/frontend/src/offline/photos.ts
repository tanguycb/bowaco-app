// Foto's op de gsm verkleinen (bouwplan §4, architectuur §8.2/§8.5): ≤ 1600 px, JPEG ± 80 %, plus een miniatuur
// van 320 px. Opnieuw tekenen op een canvas laat de EXIF-gegevens (ook de GPS-locatie) achter; het tijdstip van
// de opname bewaren we apart (takenAt). De oriëntatie van de camera wordt toegepast vóór het tekenen.

export type Shrunk = { full: Blob; thumb: Blob; width: number; height: number; before: number; takenAt: number };

async function bitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* oudere browser: hieronder */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((ok, err) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => err(new Error("Dit beeld kan niet gelezen worden"));
      i.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function draw(img: ImageBitmap | HTMLImageElement, max: number, quality: number): Promise<{ blob: Blob; w: number; h: number }> {
  const iw = "naturalWidth" in img ? img.naturalWidth : img.width;
  const ih = "naturalHeight" in img ? img.naturalHeight : img.height;
  const k = Math.min(1, max / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * k));
  const h = Math.max(1, Math.round(ih * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Geen canvas");
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((ok, err) => c.toBlob((b) => (b ? ok({ blob: b, w, h }) : err(new Error("Verkleinen mislukt"))), "image/jpeg", quality));
}

export const MAX_SIDE = 1600;

export async function shrink(file: File): Promise<Shrunk> {
  const img = await bitmap(file);
  const full = await draw(img, MAX_SIDE, 0.8);
  const thumb = await draw(img, 320, 0.7);
  if ("close" in img) img.close();
  return { full: full.blob, thumb: thumb.blob, width: full.w, height: full.h, before: file.size, takenAt: file.lastModified || Date.now() };
}

export function fmtSize(n: number): string {
  return n > 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}
