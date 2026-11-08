// Stap 2d.4: een zuinige import. Dezelfde regels als de upload-helper van de app (src/frontend/src/lib/uploadPrep.ts, 2d.3):
//   - foto's: langste zijde hoogstens 2000 px (nooit groter maken), JPEG 0,8, altijd opnieuw gecodeerd, zodat EXIF en gps
//     wegvallen; een EXIF-draaiing komt eerst in de pixels;
//   - video's: nooit opladen (enkel in de lijst vermelden);
//   - grens 15 MB per bestand na verkleining; documenten (PDF, Excel, Word …) ongewijzigd.
// De parameters komen uit uploadPrep.ts zelf: wijzigt de app ze, dan volgt de import vanzelf.
// Verkleinen met `sips` (macOS, geen nieuw npm-pakket). De raming volgt het IC-tarief van BOWACO_verslag_2d.md §4.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, statfsSync, renameSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HELPER = join(dirname(fileURLToPath(import.meta.url)), "../../src/frontend/src/lib/uploadPrep.ts");

/** De regels van de upload-helper (gelezen uit uploadPrep.ts). */
export function uploadRegels(pad = HELPER) {
  const t = readFileSync(pad, "utf8");
  const getal = (re, wat) => { const m = t.match(re); if (!m) throw new Error(`uploadPrep.ts: ${wat} niet gevonden`); return m; };
  const mb = getal(/MAX_UPLOAD_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/, "MAX_UPLOAD_BYTES");
  const regels = {
    maxZijde: Number(getal(/DEFAULT_MAX_SIDE\s*=\s*(\d+)/, "DEFAULT_MAX_SIDE")[1]),
    kwaliteit: Number(getal(/JPEG_QUALITY\s*=\s*([\d.]+)/, "JPEG_QUALITY")[1]),
    maxBytes: Number(mb[1]) * 1024 * 1024,
    videoExt: new RegExp(getal(/VIDEO_EXT\s*=\s*\/(.+)\/i;/, "VIDEO_EXT")[1], "i"),
    fotoExt: new RegExp(getal(/PHOTO_EXT\s*=\s*\/(.+)\/i;/, "PHOTO_EXT")[1], "i"),
  };
  if (!(regels.maxZijde >= 400 && regels.kwaliteit > 0 && regels.kwaliteit <= 1)) throw new Error("uploadPrep.ts: onverwachte waarden");
  return regels;
}
export const REGELS = uploadRegels();

export const isVideo = (naam, type = "") => /^video\//.test(type) || REGELS.videoExt.test(naam) || /^(mov|mp4|m4v|avi|mkv|webm|3gp)$/i.test(type);
export const isFoto = (naam, type = "") => REGELS.fotoExt.test(naam) || /^(jpe?g|png|webp|heic|heif)$/i.test(type);

/** Wat er met een bestand gebeurt, op naam en grootte (zonder het te lezen). */
export function beslis(naam, bytes, type = "") {
  if (isVideo(naam, type)) return { actie: "video" };
  if (isFoto(naam, type)) return { actie: "foto" };
  if (bytes > REGELS.maxBytes) return { actie: "te groot" };
  return { actie: "ongewijzigd" };
}

/** Enkel APP0 (JFIF) en APP2 (ICC) blijven: EXIF/XMP (APP1, met gps), IPTC (APP13) en commentaar weg. */
export function stripJpeg(data) {
  if (data[0] !== 0xff || data[1] !== 0xd8) return data;
  const uit = [data.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= data.length) {
    if (data[i] !== 0xff) break;
    const m = data[i + 1];
    if (m === 0xda) { uit.push(data.subarray(i)); return Buffer.concat(uit); } // beelddata: de rest ongewijzigd
    const n = data.readUInt16BE(i + 2);
    if (m === 0xe0 || m === 0xe2 || !((m >= 0xe1 && m <= 0xef) || m === 0xfe)) uit.push(data.subarray(i, i + 2 + n));
    i += 2 + n;
  }
  return data;
}

const sipsWaarde = (pad, sleutel) => {
  const t = execFileSync("sips", ["-g", sleutel, pad], { encoding: "utf8", timeout: 60_000 });
  const m = t.match(new RegExp(`${sleutel}:\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
};

export function vrijeSchijf(pad) {
  try { const s = statfsSync(pad); return s.bavail * s.bsize; } catch { return Infinity; }
}

/** Een foto zoals de app: JPEG, langste zijde ≤ maxZijde (nooit groter), kwaliteit 0,8, zonder EXIF/gps. Geeft de nieuwe grootte. */
export function verkleinFoto(src, dst, regels = REGELS) {
  mkdirSync(dirname(dst), { recursive: true, mode: 0o700 });
  if (vrijeSchijf(dirname(dst)) < 3e9) throw new Error("minder dan 3 GB vrij op de schijf: gestopt");
  const tmp = `${dst}.tmp.jpg`;
  try {
    const w = sipsWaarde(src, "pixelWidth"), h = sipsWaarde(src, "pixelHeight");
    if (!w || !h) throw new Error("geen beeld");
    const args = ["-s", "format", "jpeg", "-s", "formatOptions", String(Math.round(regels.kwaliteit * 100))];
    if (Math.max(w, h) > regels.maxZijde) args.push("-Z", String(regels.maxZijde));
    execFileSync("sips", [...args, src, "--out", tmp], { stdio: "pipe", timeout: 120_000 });
    const graden = { 3: 180, 6: 90, 8: 270 }[sipsWaarde(tmp, "orientation") ?? 1];
    if (graden) execFileSync("sips", ["-r", String(graden), tmp], { stdio: "pipe", timeout: 120_000 });
    writeFileSync(dst + ".part", stripJpeg(readFileSync(tmp)), { mode: 0o600 });
    renameSync(dst + ".part", dst);
    return statSync(dst).size;
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Verkleinen met een voorraad: een eerder verkleinde foto (zelfde bron-grootte) wordt niet opnieuw gemaakt. */
export function verkleindeFoto(src, cacheMap, sleutel, regels = REGELS) {
  const dst = join(cacheMap, `${sleutel}-${regels.maxZijde}-${Math.round(regels.kwaliteit * 100)}.jpg`);
  const meta = dst + ".bron";
  const bronBytes = statSync(src).size;
  if (existsSync(dst) && existsSync(meta) && readFileSync(meta, "utf8") === String(bronBytes)) return { pad: dst, bytes: statSync(dst).size, nieuw: false };
  const bytes = verkleinFoto(src, dst, regels);
  writeFileSync(meta, String(bronBytes), { mode: 0o600 });
  return { pad: dst, bytes, nieuw: true };
}

// ── Raming (IC-tarief zonder de marge van Caffeine; BOWACO_verslag_2d.md §4) ─────────────────────
export const TARIEF = {
  ingressPerGB: 2.6, // € eenmalig per GB opgeladen (≈ 2 k cycli per byte)
  opslagPerGBMaand: 0.41, // € per GB per maand
  perBestand: 11e6 * 1.25 / 1e12, // € per verwijzing (≈ 11 M cycli per addFile)
  grootSubnet: 2.6, // 34 nodes in plaats van 13
};
export function raming(bytes, bestanden) {
  const gb = bytes / 1e9;
  const eenmalig = gb * TARIEF.ingressPerGB + bestanden * TARIEF.perBestand;
  const maand = gb * TARIEF.opslagPerGBMaand;
  return { eenmalig, maand, eenmaligGroot: eenmalig * TARIEF.grootSubnet, maandGroot: maand * TARIEF.grootSubnet };
}
export const euro = (x) => `€ ${x < 0.1 && x > 0 ? x.toFixed(3) : x.toFixed(2)}`.replace(".", ",");
export const mb = (b) => `${(b / 1e6).toFixed(1).replace(".", ",")} MB`;
export const ext = (naam) => extname(naam).toLowerCase();
