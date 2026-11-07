// Bestanden van een taak (ontwerp §3.5): multipart lezen met grenzen, soort op INHOUD (magic bytes, nooit de opgegeven
// mime of bestandsnaam), PDF-bladen tellen, afmetingen van afbeeldingen, XLSX → CSV per blad, en de invoerhash.
// Alles in het geheugen; niets naar schijf. Bestandsnamen worden niet bewaard (ze kunnen een klantnaam dragen).
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { inflateRawSync } from "node:zlib";
import type { Grenzen } from "./config.ts";

export type Soort = "pdf" | "jpeg" | "png" | "webp" | "xlsx" | "csv" | "audio";
export const MIME: Record<Soort, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  audio: "audio/*",
};

export type Bestand = {
  soort: Soort;
  mime: string; // afgeleid van de inhoud (voor audio: de echte audiosoort)
  bytes: Buffer;
  bladen?: number; // pdf (best effort)
  breedte?: number; // afbeeldingen
  hoogte?: number;
  tekst?: string; // xlsx → csv per blad, csv als tekst
};

export class Weigering extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, msg: string) {
    super(msg);
    this.status = status;
    this.code = code;
  }
}

// --- body lezen met een plafond ----------------------------------------------------------------------------------
// Boven `max` bytes: niets meer bewaren, de rest wegdraineren en 413. Boven 2 × max: verbinding dicht (Caddy laat al
// niets boven 22 MB door).
export function leesBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((ok, err) => {
    let n = 0;
    let te = false;
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      n += c.length;
      if (n > max) {
        te = true;
        parts.length = 0;
        if (n > 2 * max) req.destroy();
      } else parts.push(c);
    });
    req.on("end", () => (te ? err(new Weigering(413, "grootte", "verzoek te groot")) : ok(Buffer.concat(parts))));
    req.on("close", () => {
      if (te) err(new Weigering(413, "grootte", "verzoek te groot"));
    });
    req.on("error", err);
  });
}

export type Multipart = { velden: Map<string, string>; bestanden: { bytes: Buffer; opgegeven: string }[] };

// Multipart via de ingebouwde WHATWG-parser van Node (undici); geen extra pakket.
export async function leesMultipart(contentType: string, body: Buffer): Promise<Multipart> {
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) throw new Weigering(400, "json", "multipart/form-data verwacht");
  let fd: FormData;
  try {
    fd = await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new Weigering(400, "json", "multipart onleesbaar");
  }
  const velden = new Map<string, string>();
  const bestanden: Multipart["bestanden"] = [];
  for (const [k, v] of fd.entries()) {
    if (k === "bestand") {
      if (typeof v === "string") throw new Weigering(400, "json", "veld bestand moet een bestand zijn");
      bestanden.push({ bytes: Buffer.from(await v.arrayBuffer()), opgegeven: v.type });
    } else if (k === "ticket" || k === "invoer") {
      if (typeof v !== "string" || velden.has(k)) throw new Weigering(400, "json", `veld ${k} ongeldig`);
      velden.set(k, v);
    } else throw new Weigering(400, "json", "onbekend veld");
  }
  return { velden, bestanden };
}

// --- soort op inhoud ---------------------------------------------------------------------------------------------
const begint = (b: Buffer, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);
const ascii = (b: Buffer, s: string, at = 0) => b.length >= at + s.length && b.toString("latin1", at, at + s.length) === s;

export function herken(b: Buffer): { soort: Soort; mime: string } | null {
  if (ascii(b, "%PDF-")) return { soort: "pdf", mime: MIME.pdf };
  if (begint(b, [0xff, 0xd8, 0xff])) return { soort: "jpeg", mime: MIME.jpeg };
  if (begint(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { soort: "png", mime: MIME.png };
  if (ascii(b, "RIFF") && ascii(b, "WEBP", 8)) return { soort: "webp", mime: MIME.webp };
  if (ascii(b, "RIFF") && ascii(b, "WAVE", 8)) return { soort: "audio", mime: "audio/wav" };
  if (ascii(b, "OggS")) return { soort: "audio", mime: "audio/ogg" };
  if (begint(b, [0x1a, 0x45, 0xdf, 0xa3])) return { soort: "audio", mime: "audio/webm" };
  if (ascii(b, "ID3") || (b.length > 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { soort: "audio", mime: "audio/mpeg" };
  if (ascii(b, "ftyp", 4) && /^(M4A |M4B |mp42|isom)/.test(b.toString("latin1", 8, 12))) return { soort: "audio", mime: "audio/mp4" };
  if (begint(b, [0x50, 0x4b, 0x03, 0x04])) {
    // Een zip: enkel een XLSX (werkmap met xl/workbook.xml) is toegelaten; docx, zip, jar … niet.
    try {
      const z = zipInhoud(b);
      if (z.has("xl/workbook.xml") && z.has("[Content_Types].xml")) return { soort: "xlsx", mime: MIME.xlsx };
    } catch {
      /* geen geldige zip */
    }
    return null;
  }
  if (isTekst(b)) return { soort: "csv", mime: MIME.csv };
  return null;
}

function isTekst(b: Buffer): boolean {
  if (b.length === 0 || b.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

// --- PDF en afbeeldingen ----------------------------------------------------------------------------------------
// Bladen tellen zonder bibliotheek: /Type /Page-objecten (niet /Pages). Bij object-streams kan dat 0 geven; dan is
// het aantal onbekend en geldt enkel de bytegrens.
export function pdfBladen(b: Buffer): number {
  return (b.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

export function beeldMaat(b: Buffer, soort: Soort): { breedte: number; hoogte: number } | null {
  try {
    if (soort === "png") return { breedte: b.readUInt32BE(16), hoogte: b.readUInt32BE(20) };
    if (soort === "webp") {
      const k = b.toString("latin1", 12, 16);
      if (k === "VP8X") return { breedte: 1 + b.readUIntLE(24, 3), hoogte: 1 + b.readUIntLE(27, 3) };
      if (k === "VP8L") {
        const v = b.readUInt32LE(21);
        return { breedte: (v & 0x3fff) + 1, hoogte: ((v >> 14) & 0x3fff) + 1 };
      }
      if (k === "VP8 ") return { breedte: b.readUInt16LE(26) & 0x3fff, hoogte: b.readUInt16LE(28) & 0x3fff };
    }
    if (soort === "jpeg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const m = b[i + 1];
        const len = b.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { hoogte: b.readUInt16BE(i + 5), breedte: b.readUInt16BE(i + 7) };
        i += 2 + len;
      }
    }
  } catch {
    /* kapotte kop */
  }
  return null;
}

// --- XLSX → CSV (minimale zip- en XML-lezer, enkel wat een werkmap nodig heeft) -----------------------------------
const MAX_UITGEPAKT = 60 * 1024 * 1024; // zipbom-grens over alle gelezen delen samen

function zipInhoud(b: Buffer): Map<string, { methode: number; grootte: number; offset: number }> {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("geen zip");
  const n = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const uit = new Map<string, { methode: number; grootte: number; offset: number }>();
  for (let k = 0; k < n; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("kapotte zip");
    const methode = b.readUInt16LE(p + 10);
    const grootte = b.readUInt32LE(p + 20);
    const nl = b.readUInt16LE(p + 28);
    const el = b.readUInt16LE(p + 30);
    const cl = b.readUInt16LE(p + 32);
    const offset = b.readUInt32LE(p + 42);
    uit.set(b.toString("utf8", p + 46, p + 46 + nl), { methode, grootte, offset });
    p += 46 + nl + el + cl;
  }
  return uit;
}

function zipLees(b: Buffer, inhoud: ReturnType<typeof zipInhoud>, naam: string, budget: { over: number }): string | null {
  const e = inhoud.get(naam);
  if (!e) return null;
  if (b.readUInt32LE(e.offset) !== 0x04034b50) throw new Error("kapotte zip");
  const start = e.offset + 30 + b.readUInt16LE(e.offset + 26) + b.readUInt16LE(e.offset + 28);
  const data = b.subarray(start, start + e.grootte);
  const ruw = e.methode === 0 ? data : e.methode === 8 ? inflateRawSync(data, { maxOutputLength: Math.max(1, budget.over) }) : null;
  if (!ruw) throw new Error("zipmethode niet ondersteund");
  budget.over -= ruw.length;
  if (budget.over <= 0) throw new Error("werkmap te groot uitgepakt");
  return ruw.toString("utf8");
}

const ont = (s: string) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : e === "quot" ? '"' : e === "apos" ? "'" : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)),
  );
const tTekst = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => ont(m[1])).join("");
const kolom = (ref: string) => [...(ref.match(/^[A-Z]+/)?.[0] ?? "A")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
const csvVeld = (s: string) => (/[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function xlsxNaarCsv(b: Buffer, maxRijen: number): string {
  const inhoud = zipInhoud(b);
  const budget = { over: MAX_UITGEPAKT };
  const wb = zipLees(b, inhoud, "xl/workbook.xml", budget) ?? "";
  const rels = zipLees(b, inhoud, "xl/_rels/workbook.xml.rels", budget) ?? "";
  const ss = zipLees(b, inhoud, "xl/sharedStrings.xml", budget);
  const gedeeld = ss ? [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => tTekst(m[1])) : [];
  const doel = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [m[0].match(/\bId="([^"]+)"/)?.[1] ?? "", m[0].match(/\bTarget="([^"]+)"/)?.[1] ?? ""]));
  const uit: string[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const naam = ont(m[0].match(/\bname="([^"]*)"/)?.[1] ?? "blad");
    const rid = m[0].match(/\br:id="([^"]+)"/)?.[1] ?? "";
    let pad = doel.get(rid) ?? "";
    pad = pad.startsWith("/") ? pad.slice(1) : `xl/${pad}`;
    const xml = zipLees(b, inhoud, pad, budget);
    if (!xml) continue;
    const rijen: string[] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rijen.length >= maxRijen) {
        rijen.push(`(… afgekapt na ${maxRijen} rijen)`);
        break;
      }
      const cellen: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attr = c[1];
        const ref = attr.match(/\br="([A-Z]+)\d+"/)?.[1] ?? String.fromCharCode(65 + cellen.length);
        const t = attr.match(/\bt="([^"]+)"/)?.[1] ?? "n";
        const binnen = c[2] ?? "";
        const v = ont(binnen.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
        const waarde = t === "s" ? (gedeeld[Number(v)] ?? "") : t === "inlineStr" ? tTekst(binnen) : t === "b" ? (v === "1" ? "WAAR" : "ONWAAR") : v;
        const k = kolom(ref);
        while (cellen.length < k) cellen.push("");
        cellen[k] = csvVeld(waarde);
      }
      rijen.push(cellen.join(","));
    }
    uit.push(`## blad: ${naam}\n${rijen.join("\n")}`);
  }
  return uit.join("\n\n");
}

// --- alles samen: van ruwe delen naar gecontroleerde bestanden ---------------------------------------------------
export function controleer(delen: { bytes: Buffer }[], g: Grenzen): Bestand[] {
  if (delen.length > g.maxBestanden) throw new Weigering(422, "bestanden", `hoogstens ${g.maxBestanden} bestanden`);
  let som = 0;
  const uit: Bestand[] = [];
  for (const d of delen) {
    som += d.bytes.length;
    if (d.bytes.length > g.maxBestand) throw new Weigering(413, "grootte", "bestand te groot");
    if (som > g.maxTotaal) throw new Weigering(413, "grootte", "bestanden samen te groot");
    const h = herken(d.bytes);
    if (!h) throw new Weigering(415, "bestand", "soort bestand niet toegelaten");
    const b: Bestand = { soort: h.soort, mime: h.mime, bytes: d.bytes };
    if (h.soort === "pdf") {
      b.bladen = pdfBladen(d.bytes);
      if (b.bladen > g.maxPdfBladen) throw new Weigering(422, "bestanden", `PDF heeft meer dan ${g.maxPdfBladen} bladzijden`);
    }
    if (h.soort === "jpeg" || h.soort === "png" || h.soort === "webp") {
      const m = beeldMaat(d.bytes, h.soort);
      if (!m) throw new Weigering(415, "bestand", "afbeelding onleesbaar");
      Object.assign(b, m);
      // Verkleinen naar maxBeeldPx vraagt een beeldbibliotheek (open punt 3.1-B3); de leverancier verkleint zelf,
      // de raming rekent met de begrensde maat.
    }
    if (h.soort === "xlsx") {
      try {
        b.tekst = xlsxNaarCsv(d.bytes, g.maxXlsxRijen);
      } catch {
        throw new Weigering(415, "bestand", "werkmap onleesbaar");
      }
    }
    if (h.soort === "csv") b.tekst = d.bytes.toString("utf8");
    uit.push(b);
  }
  return uit;
}

// Invoerhash zoals de browser ze berekent (B2 moet exact hetzelfde doen):
//   SHA-256 over UTF-8(tekst), en dan voor elk bestand in volgorde: één byte 0x1E gevolgd door de ruwe bytes.
//   Resultaat in kleine hex (64 tekens). Deze waarde wordt ook AiCall.inputSha256 in de app.
export function invoerHash(tekst: string, bestanden: { bytes: Buffer }[]): string {
  const h = createHash("sha256").update(Buffer.from(tekst, "utf8"));
  for (const b of bestanden) h.update(Buffer.from([0x1e])).update(b.bytes);
  return h.digest("hex");
}
