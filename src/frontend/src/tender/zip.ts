// Een kleine zip-schrijver en -lezer voor de prijsvraag-Excel (stap 2c.2, ontwerp 2c §5): geen bibliotheek. Schrijven = "stored"
// (zonder compressie, geldig voor .xlsx); lezen kent "stored" en "deflate" (wat Excel bewaart), uitgepakt met de ingebouwde
// DecompressionStream("deflate-raw") van de browser (en Node). Geen zip64, geen versleuteling, hoogstens 300 bestanden en 60 MB
// uitgepakt (geen zipbom). Zonder React en zonder backend-imports: Node draait dit bestand rechtstreeks.

const enc = new TextEncoder();

let crcTable: Uint32Array | null = null;
export function crc32(b: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array | string };

/** Een zip met "stored" bestanden (vaste datum: dezelfde invoer = dezelfde bytes). */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 01.01.2026
  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const crc = crc32(data);
    const lh = new Uint8Array(30 + name.length);
    const v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true); // UTF-8-namen
    v.setUint16(8, 0, true); // stored
    v.setUint16(10, DOS_TIME, true);
    v.setUint16(12, DOS_DATE, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, name.length, true);
    v.setUint16(28, 0, true);
    lh.set(name, 30);
    parts.push(lh, data);
    const ch = new Uint8Array(46 + name.length);
    const w = new DataView(ch.buffer);
    w.setUint32(0, 0x02014b50, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint16(8, 0x0800, true);
    w.setUint16(10, 0, true);
    w.setUint16(12, DOS_TIME, true);
    w.setUint16(14, DOS_DATE, true);
    w.setUint32(16, crc, true);
    w.setUint32(20, data.length, true);
    w.setUint32(24, data.length, true);
    w.setUint16(28, name.length, true);
    w.setUint32(42, offset, true);
    ch.set(name, 46);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const x = new DataView(end.buffer);
  x.setUint32(0, 0x06054b50, true);
  x.setUint16(8, entries.length, true);
  x.setUint16(10, entries.length, true);
  x.setUint32(12, cdSize, true);
  x.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > limit) { await reader.cancel(); throw new Error("Het bestand is te groot uitgepakt"); }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** Comprimeert met deflate (enkel voor de tests: zo bewaart Excel een .xlsx). */
export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const buf = await new Response(new Blob([data as BlobPart]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}

/** Een zip met "deflate" bestanden (enkel voor de tests). */
export async function zipDeflate(entries: ZipEntry[]): Promise<Uint8Array> {
  // Eerst stored maken en dan per bestand de data vervangen is eenvoudiger met een eigen lus.
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const raw = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const data = await deflateRaw(raw);
    const crc = crc32(raw);
    const lh = new Uint8Array(30 + name.length);
    const v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true);
    v.setUint16(8, 8, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, raw.length, true);
    v.setUint16(26, name.length, true);
    lh.set(name, 30);
    parts.push(lh, data);
    const ch = new Uint8Array(46 + name.length);
    const w = new DataView(ch.buffer);
    w.setUint32(0, 0x02014b50, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint16(8, 0x0800, true);
    w.setUint16(10, 8, true);
    w.setUint32(16, crc, true);
    w.setUint32(20, data.length, true);
    w.setUint32(24, raw.length, true);
    w.setUint16(28, name.length, true);
    w.setUint32(42, offset, true);
    ch.set(name, 46);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const x = new DataView(end.buffer);
  x.setUint32(0, 0x06054b50, true);
  x.setUint16(8, entries.length, true);
  x.setUint16(10, entries.length, true);
  x.setUint32(12, cdSize, true);
  x.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

export class ZipError extends Error {}

/** Leest een zip: naam → inhoud. Gooit een ZipError met een leesbare uitleg. */
export async function unzip(bytes: Uint8Array, opts: { maxEntries?: number; maxTotal?: number } = {}): Promise<Map<string, Uint8Array>> {
  const maxEntries = opts.maxEntries ?? 300;
  const maxTotal = opts.maxTotal ?? 60 * 1024 * 1024;
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new ZipError("Geen geldig .xlsx-bestand");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError("Het bestand is beschadigd (geen inhoudstafel)");
  const count = v.getUint16(eocd + 10, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  if (count > maxEntries) throw new ZipError("Te veel bestanden in de zip");
  const out = new Map<string, Uint8Array>();
  let p = cdOffset;
  let total = 0;
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50) throw new ZipError("Het bestand is beschadigd (inhoudstafel)");
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (flags & 1) throw new ZipError("Een versleuteld bestand kan de app niet lezen");
    if (csize === 0xffffffff || usize === 0xffffffff) throw new ZipError("Het bestand is te groot");
    total += usize;
    if (total > maxTotal) throw new ZipError("Het bestand is te groot uitgepakt");
    if (lho + 30 > bytes.length || v.getUint32(lho, true) !== 0x04034b50) throw new ZipError("Het bestand is beschadigd (bestandskop)");
    const start = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
    const data = bytes.subarray(start, start + csize);
    if (name.endsWith("/")) continue;
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflateRaw(data, usize + 1024));
    else throw new ZipError("Onbekende compressie in het bestand");
  }
  return out;
}
