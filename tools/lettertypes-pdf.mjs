// Zet de woff-bestanden van Archivo en IBM Plex Mono (@fontsource, SIL Open Font License) om naar TrueType voor de
// offerte-PDF (stap 2.7): pdf-lib bedt een lettertype in via @pdf-lib/fontkit, en die kan een woff2 niet betrouwbaar
// verkleinen (subset). Een woff is een zlib-verpakte sfnt; hier wordt enkel uitgepakt, niets aan de glyphs veranderd.
//   node tools/lettertypes-pdf.mjs      → src/frontend/public/fonts/*.ttf (+ de licentie)
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const fs = join(root, "src/frontend/node_modules/@fontsource");
const out = join(root, "src/frontend/public/fonts");
mkdirSync(out, { recursive: true });

function woffToSfnt(buf) {
  if (buf.toString("latin1", 0, 4) !== "wOFF") throw new Error("geen woff");
  const flavor = buf.readUInt32BE(4);
  const n = buf.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const p = 44 + i * 20;
    const tag = buf.toString("latin1", p, p + 4);
    const off = buf.readUInt32BE(p + 4);
    const comp = buf.readUInt32BE(p + 8);
    const orig = buf.readUInt32BE(p + 12);
    const sum = buf.readUInt32BE(p + 16);
    const raw = buf.subarray(off, off + comp);
    const data = comp < orig ? inflateSync(raw) : raw;
    if (data.length !== orig) throw new Error(`tabel ${tag}: ${data.length} ≠ ${orig}`);
    tables.push({ tag, data, sum });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  let pow = 1, log = 0;
  while (pow * 2 <= n) { pow *= 2; log++; }
  const head = Buffer.alloc(12 + 16 * n);
  head.writeUInt32BE(flavor, 0);
  head.writeUInt16BE(n, 4);
  head.writeUInt16BE(pow * 16, 6);
  head.writeUInt16BE(log, 8);
  head.writeUInt16BE(n * 16 - pow * 16, 10);
  let off = head.length;
  const parts = [head];
  tables.forEach((t, i) => {
    const p = 12 + i * 16;
    head.write(t.tag, p, "latin1");
    head.writeUInt32BE(t.sum, p + 4);
    head.writeUInt32BE(off, p + 8);
    head.writeUInt32BE(t.data.length, p + 12);
    const pad = (4 - (t.data.length % 4)) % 4;
    parts.push(t.data, Buffer.alloc(pad));
    off += t.data.length + pad;
  });
  return Buffer.concat(parts);
}

const jobs = [
  ["archivo/files/archivo-latin-400-normal.woff", "archivo-400.ttf"],
  ["archivo/files/archivo-latin-600-normal.woff", "archivo-600.ttf"],
  ["archivo/files/archivo-latin-700-normal.woff", "archivo-700.ttf"],
  ["ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff", "ibm-plex-mono-400.ttf"],
  ["ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff", "ibm-plex-mono-600.ttf"],
];
for (const [src, dst] of jobs) {
  const ttf = woffToSfnt(readFileSync(join(fs, src)));
  writeFileSync(join(out, dst), ttf);
  console.log(dst, ttf.length, "bytes");
}
for (const [pkg, name] of [["archivo", "LICENSE-archivo.txt"], ["ibm-plex-mono", "LICENSE-ibm-plex-mono.txt"]]) {
  try { copyFileSync(join(fs, pkg, "LICENSE"), join(out, name)); } catch { console.log("geen LICENSE in", pkg); }
}
