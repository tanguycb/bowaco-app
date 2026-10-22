// (c) Meting van de opslagdienst van Caffeine vanuit Node, tegen de draft.
//   node tools/opslag.mjs <backend-canister> <project-id> [grootte-MB ...]
// Laadt een proef-PNG en een proef-PDF op (geen klantgegevens), leest ze terug zonder login en
// meet headers, toegang en tijd. Extra getallen = proefuploads van zoveel MB willekeurige bytes.
// Wat hier opgeladen wordt, verwijst de backend niet: de opslag ruimt het later zelf op.
import { HttpAgent } from "@icp-sdk/core/agent";
import { StorageClient } from "@caffeineai/object-storage";
import { createHash, randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { identity } from "./lib.mjs";

const [cid, projectId, ...sizes] = process.argv.slice(2);
if (!cid || !projectId) throw new Error("gebruik: node tools/opslag.mjs <backend-canister> <project-id> [MB ...]");
const GATEWAY = "https://blob.caffeine.ai";

function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, c]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = 0x1e + ((x * 200) / w) | 0;
      raw[o + 1] = 0x1f + ((y * 150) / h) | 0;
      raw[o + 2] = 0x41;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]),
  );
}

function pdf() {
  const text = `BOWACO opslagproef ${new Date().toISOString()}`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 18 Tf 60 760 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

async function client(name) {
  const agent = await HttpAgent.create({ host: "https://icp-api.io", identity: name ? identity(name) : undefined });
  return new StorageClient("default-bucket", GATEWAY, cid, projectId, agent);
}

async function head(url, method = "GET") {
  const t0 = Date.now();
  const r = await fetch(url, { method });
  const body = method === "GET" ? new Uint8Array(await r.arrayBuffer()) : null;
  const pick = ["content-type", "content-length", "content-disposition", "cache-control", "access-control-allow-origin", "etag"];
  return {
    status: r.status,
    ms: Date.now() - t0,
    headers: Object.fromEntries(pick.map((k) => [k, r.headers.get(k)]).filter(([, v]) => v)),
    body,
  };
}

const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const log = (...a) => console.log(...a);

const authed = await client("proef-vreemde");
for (const [label, bytes, mime, fname] of [
  ["PNG 1200×900", png(1200, 900), "image/png", "proef-foto.png"],
  ["PDF 1 pagina", pdf(), "application/pdf", "proef-document.pdf"],
]) {
  const t0 = Date.now();
  const { hash } = await authed.putFile(bytes, undefined, mime, fname);
  const ms = Date.now() - t0;
  const url = await authed.getDirectURL(hash);
  const got = await head(url);
  log(`\n${label}: ${bytes.length} B opgeladen in ${ms} ms`);
  log(`  URL: ${url}`);
  log(`  GET zonder login: ${got.status} in ${got.ms} ms, inhoud gelijk: ${got.body && sha(got.body) === sha(bytes)}`);
  log(`  headers: ${JSON.stringify(got.headers)}`);
  const wrongOwner = await head(url.replace(`owner_id=${cid}`, "owner_id=aaaaa-aa"), "GET");
  log(`  zelfde hash, ander owner_id: ${wrongOwner.status}`);
  const noProject = await head(url.replace(/&project_id=[^&]+/, ""), "GET");
  log(`  zelfde hash, zonder project_id: ${noProject.status}`);
}

const randomHash = `sha256:${randomBytes(32).toString("hex")}`;
const miss = await head(`${GATEWAY}/v1/blob/?blob_hash=${encodeURIComponent(randomHash)}&owner_id=${cid}&project_id=${projectId}`);
log(`\nwillekeurige hash: ${miss.status}`);

// Kan een anonieme beller ook opladen? (de certificaatfunctie van de mixin controleert de beller niet)
try {
  const anon = await client(null);
  const { hash } = await anon.putFile(pdf(), undefined, "application/pdf", "anoniem.pdf");
  log(`anonieme upload: GELUKT (${hash.slice(0, 20)}…)`);
} catch (e) {
  log(`anonieme upload: geweigerd — ${String(e.message ?? e).slice(0, 200)}`);
}

for (const mb of sizes) {
  const n = Number(mb) * 1024 * 1024;
  const bytes = new Uint8Array(randomBytes(n));
  const t0 = Date.now();
  try {
    const { hash } = await authed.putFile(bytes, undefined, "application/octet-stream", `groot-${mb}MB.bin`);
    const s = (Date.now() - t0) / 1000;
    const r = await head(await authed.getDirectURL(hash), "HEAD");
    log(`${mb} MB: GELUKT in ${s.toFixed(1)} s (${((n / 1024 / 1024) / s).toFixed(1)} MB/s), HEAD ${r.status} ${JSON.stringify(r.headers)}`);
  } catch (e) {
    log(`${mb} MB: MISLUKT na ${((Date.now() - t0) / 1000).toFixed(1)} s — ${String(e.message ?? e).slice(0, 300)}`);
  }
}
