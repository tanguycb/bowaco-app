// Voorbeeldfoto's als getekende SVG (geen echte werffoto's in het prototype) + verkleinen van een echte foto.
import type { PhotoItem } from "../src/design";

const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">${body}</svg>`)}`;

const SCENES: Record<string, string> = {
  riolering: `<rect width="300" height="300" fill="#b89a74"/><rect y="0" width="300" height="70" fill="#9fb3c4"/><path d="M0 70 L300 85 L300 300 L0 300Z" fill="#a8875f"/><path d="M60 300 L110 120 L200 120 L260 300Z" fill="#6f5638"/><rect x="40" y="190" width="240" height="26" rx="13" fill="#c8622a" transform="rotate(-12 150 200)"/><circle cx="215" cy="170" r="24" fill="#8d8d88"/><circle cx="215" cy="170" r="15" fill="#5c5c58"/>`,
  wachtbuizen: `<rect width="300" height="300" fill="#a3a29b"/><rect y="200" width="300" height="100" fill="#8a8982"/><g stroke="#3d6fa3" stroke-width="12" stroke-linecap="round"><path d="M70 300 V140 Q70 110 100 110"/><path d="M130 300 V160"/></g><g stroke="#c9c9c2" stroke-width="10" stroke-linecap="round"><path d="M200 300 V120"/><path d="M240 300 V170 Q240 150 260 150"/></g><rect x="0" y="0" width="300" height="40" fill="#7e7d76"/>`,
  terras: `<rect width="300" height="300" fill="#7c6446"/><rect width="300" height="90" fill="#b7c7a2"/><path d="M0 90 H300 V300 H0Z" fill="#8b6f4c"/><path d="M40 120 L260 110 L280 290 L20 290Z" fill="#6a5338"/><g stroke="#f4f1e8" stroke-width="2"><path d="M30 118 L270 106"/><path d="M40 120 L20 295"/><path d="M262 110 L285 295"/></g><rect x="255" y="96" width="6" height="40" fill="#e3b04b"/><rect x="34" y="104" width="6" height="40" fill="#e3b04b"/>`,
  gevel: `<rect width="300" height="300" fill="#9a4b32"/><g fill="none" stroke="#d9cfc0" stroke-width="3">${Array.from({ length: 12 }, (_, i) => `<path d="M0 ${i * 25 + 25} H300"/>`).join("")}${Array.from({ length: 12 }, (_, i) => Array.from({ length: 6 }, (_, j) => `<path d="M${j * 55 + (i % 2) * 27} ${i * 25} v25"/>`).join("")).join("")}</g><rect x="90" y="110" width="120" height="150" fill="#2b2d3a"/><rect x="80" y="100" width="140" height="12" fill="#cfc8ba"/>`,
  bon: `<rect width="300" height="300" fill="#5a5f6e"/><g transform="rotate(-6 150 150)"><rect x="70" y="30" width="160" height="240" fill="#f7f5ee"/><g fill="#b9b6ab">${Array.from({ length: 10 }, (_, i) => `<rect x="86" y="${60 + i * 18}" width="${80 + ((i * 37) % 50)}" height="6"/>`).join("")}</g><rect x="86" y="44" width="70" height="8" fill="#1e1f41"/></g>`,
};

export const SAMPLE_PHOTOS: PhotoItem[] = [
  { id: "f1", src: svg(SCENES.riolering), caption: "Riolering · 08:14" },
  { id: "f2", src: svg(SCENES.wachtbuizen), caption: "Wachtbuizen · 10:02" },
  { id: "f3", src: svg(SCENES.terras), caption: "Terras · 14:40" },
];
export const WORK_PHOTOS: PhotoItem[] = [
  ...SAMPLE_PHOTOS,
  { id: "f4", src: svg(SCENES.gevel), caption: "Dorpels · 09-10" },
  { id: "f5", src: svg(SCENES.bon), caption: "Bon 2210" },
];
export const RECEIPT_PHOTO = svg(SCENES.bon);

/** Verkleint zoals de echte app zal doen (architectuur §8.2): ≤ 1600 px, JPEG, locatie gaat verloren. */
export async function shrink(file: File): Promise<{ src: string; before: number; after: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), "image/jpeg", 0.8));
    return { src: URL.createObjectURL(blob), before: file.size, after: blob.size };
  } catch {
    return { src: url, before: file.size, after: file.size };
  }
}

export const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",")} MB` : `${Math.round(n / 1e3)} KB`);
