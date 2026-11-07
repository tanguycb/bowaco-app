// 2d.3: elk bestand gaat vóór het opladen door deze helper. Foto's worden op het toestel verkleind (langste zijde
// standaard 2000 px, JPEG 0,8) en altijd opnieuw getekend: zo valt de EXIF (ook de GPS-locatie) weg en klopt de
// oriëntatie. Het origineel blijft op het toestel. Documenten (PDF, Excel, Word …) gaan ongewijzigd. Video's weigeren
// we. Grens: 15 MB per bestand na verkleining. Instelling (aan/uit + maat) per toestel in Beheer > Documenten.

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const DEFAULT_MAX_SIDE = 2000;
export const JPEG_QUALITY = 0.8;
export const VIDEO_MSG = "Video's laden we niet op: zet een link naar de cloudmap.";
export const tooBigMsg = (name: string) => `"${name}" is groter dan 15 MB. Verklein het bestand of zet een link naar de cloudmap.`;

export type PhotoPrefs = { shrink: boolean; maxSide: number };
export type Plan = { action: "reject"; message: string } | { action: "photo" } | { action: "keep" };

const PHOTO = /^image\/(jpeg|jpg|pjpeg|png|webp|heic|heif)$/i;
const PHOTO_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|avi|mkv|webm|3gp)$/i;

/** Beslissing op soort en grootte (zonder het bestand te lezen). */
export function planUpload(f: { name: string; type: string; size: number }, prefs: PhotoPrefs): Plan {
  if (f.type.startsWith("video/") || (!f.type && VIDEO_EXT.test(f.name))) return { action: "reject", message: VIDEO_MSG };
  const photo = PHOTO.test(f.type) || (!f.type && PHOTO_EXT.test(f.name));
  if (photo) return { action: "photo" }; // altijd hercoderen (EXIF/GPS weg); "uit" = enkel niet verkleinen
  if (f.size > MAX_UPLOAD_BYTES) return { action: "reject", message: tooBigMsg(f.name) };
  return { action: "keep" };
}

/** Grens na verkleining. */
export function checkSize(name: string, size: number): string | null {
  return size > MAX_UPLOAD_BYTES ? tooBigMsg(name) : null;
}

export const clampSide = (n: number) => (Number.isFinite(n) ? Math.min(8000, Math.max(400, Math.round(n))) : DEFAULT_MAX_SIDE);

const KEY = "bowaco.photoPrefs";
export function getPhotoPrefs(): PhotoPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PhotoPrefs>;
      return { shrink: p.shrink !== false, maxSide: clampSide(Number(p.maxSide ?? DEFAULT_MAX_SIDE)) };
    }
  } catch { /* geen opslag: standaard */ }
  return { shrink: true, maxSide: DEFAULT_MAX_SIDE };
}
export function setPhotoPrefs(p: PhotoPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify({ shrink: p.shrink, maxSide: clampSide(p.maxSide) })); } catch { /* stil */ }
}

export async function decodeImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* hieronder */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((ok, err) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => err(new Error("Dit beeld kan niet gelezen worden (bv. HEIC): bewaar het als JPEG en probeer opnieuw."));
      i.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function drawJpeg(img: ImageBitmap | HTMLImageElement, max: number, quality: number): Promise<{ blob: Blob; w: number; h: number }> {
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

/** Langste zijde: uit = volle maat (wel hercoderen). */
export const sideFor = (p: PhotoPrefs) => (p.shrink ? p.maxSide : Number.POSITIVE_INFINITY);

const jpgName = (n: string) => n.replace(/\.[^.]+$/, "") + ".jpg";

/** Maakt een bestand klaar voor opladen; gooit een Error met Nederlandse melding bij weigering. */
export async function prepareUpload(file: File, prefs: PhotoPrefs = getPhotoPrefs()): Promise<File> {
  const plan = planUpload(file, prefs);
  if (plan.action === "reject") throw new Error(plan.message);
  if (plan.action === "keep") return file;
  const img = await decodeImage(file);
  const out = await drawJpeg(img, sideFor(prefs), JPEG_QUALITY);
  if ("close" in img) img.close();
  const msg = checkSize(file.name, out.blob.size);
  if (msg) throw new Error(msg);
  return new File([out.blob], jpgName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
}
