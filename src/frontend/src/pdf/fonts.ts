// De lettertypes van de offerte-PDF (stap 2.7): dezelfde als de app (Archivo en IBM Plex Mono, SIL Open Font License, zie
// public/fonts), als TrueType uit tools/lettertypes-pdf.mjs. Ze worden pas opgehaald op het moment dat een PDF gemaakt wordt
// (± 150 KB samen, daarna in het geheugen van de pagina); pdf-lib bedt er enkel de gebruikte tekens van in (subset).
import type { PdfFonts } from "./offerte.ts";

let cache: Promise<PdfFonts> | null = null;

const get = async (name: string) => {
  const r = await fetch(new URL(`fonts/${name}`, document.baseURI));
  if (!r.ok) throw new Error(`Lettertype ${name} niet geladen (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
};

export function loadPdfFonts(): Promise<PdfFonts> {
  cache ??= Promise.all([get("archivo-400.ttf"), get("archivo-600.ttf"), get("archivo-700.ttf"), get("ibm-plex-mono-400.ttf"), get("ibm-plex-mono-600.ttf")])
    .then(([regular, medium, bold, mono, monoBold]) => ({ regular, medium, bold, mono, monoBold }))
    .catch((e) => { cache = null; throw e; });
  return cache;
}
