// Foto's op de gsm verkleinen (bouwplan §4, architectuur §8.2/§8.5): langste zijde volgens Beheer (standaard 2000 px, lib/uploadPrep), JPEG 80 %, plus een miniatuur
// van 320 px. Opnieuw tekenen op een canvas laat de EXIF-gegevens (ook de GPS-locatie) achter; het tijdstip van
// de opname bewaren we apart (takenAt). De oriëntatie van de camera wordt toegepast vóór het tekenen.

export type Shrunk = { full: Blob; thumb: Blob; width: number; height: number; before: number; takenAt: number };

import { checkSize, decodeImage as bitmap, drawJpeg as draw, getPhotoPrefs, planUpload, sideFor } from "../lib/uploadPrep";


export async function shrink(file: File): Promise<Shrunk> {
  const prefs = getPhotoPrefs();
  const plan = planUpload(file, prefs);
  if (plan.action === "reject") throw new Error(plan.message);
  if (plan.action === "keep") throw new Error("Dit is geen foto (JPEG, PNG, WebP of HEIC).");
  const img = await bitmap(file);
  const full = await draw(img, sideFor(prefs), 0.8);
  const tooBig = checkSize(file.name, full.blob.size);
  if (tooBig) throw new Error(tooBig);
  const thumb = await draw(img, 320, 0.7);
  if ("close" in img) img.close();
  return { full: full.blob, thumb: thumb.blob, width: full.w, height: full.h, before: file.size, takenAt: file.lastModified || Date.now() };
}

export function fmtSize(n: number): string {
  return n > 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}
