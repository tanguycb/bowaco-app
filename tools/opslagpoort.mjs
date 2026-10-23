// Opslagpoort op de draft (T10, StorageGate.mo): een echte upload naar de opslagdienst van Caffeine.
// Bewijst dat de gateway het certificaat van onze eigen mixin aanvaardt, en dat anoniem en een klant
// geen certificaat krijgen. Proefbestand = een kleine gekleurde PNG, geen klantgegevens.
//   node tools/opslagpoort.mjs <backend-canister> <project-id>      (na tests/rollen.mjs op die canister)
import { HttpAgent } from "@icp-sdk/core/agent";
import { StorageClient } from "@caffeineai/object-storage";
import { deflateSync } from "node:zlib";
import { backend, identity } from "./lib.mjs";

const [cid, projectId] = process.argv.slice(2);
if (!cid || !projectId) throw new Error("gebruik: node tools/opslagpoort.mjs <backend-canister> <project-id>");
const GATEWAY = "https://blob.caffeine.ai";

function png(w, h, seed) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x + seed) & 255; raw[o + 1] = (y * 2) & 255; raw[o + 2] = 0xe0; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
const store = async (name) => new StorageClient("default-bucket", GATEWAY, cid, projectId, await HttpAgent.create({ host: "https://icp-api.io", identity: name ? identity(name) : undefined }));

let pass = 0, fail = 0;
const check = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}${x ? `  — ${x}` : ""}`); };
const tryPut = async (name, bytes) => {
  try { return { hash: (await (await store(name)).putFile(bytes, () => {}, "image/png", "proef.png")).hash }; }
  catch (e) { return { err: String(e.message ?? e).slice(0, 160) }; }
};

const seed = Date.now() & 255;
const a = await tryPut(null, png(32, 32, seed));
check("anoniem: upload geweigerd", !!a.err, a.err);
const k = await tryPut("proef-klant", png(32, 32, seed + 1));
check("klant: upload geweigerd", !!k.err, k.err);
const t0 = Date.now();
const w = await tryPut("proef-werfleider", png(64, 64, seed + 2));
check("werfleider: upload aanvaard door de gateway", !!w.hash, w.hash ?? w.err);
if (w.hash) {
  const wl = await backend("proef-werfleider", cid);
  const works = await wl.listWorks();
  const A = works.find((x) => x.code === "P-A").id;
  const ref = new TextEncoder().encode("!caf!" + w.hash);
  const r = await wl.addFile("opslagpoort.png", "image/png", 1000n, ref, [A], false);
  check("werfleider: verwijzing bewaard bij werf A", "ok" in r, JSON.stringify(r, (_, v) => (typeof v === "bigint" ? String(v) : v)));
  const url = await (await store("proef-werfleider")).getDirectURL(w.hash);
  const res = await fetch(url);
  check("bestand terug op te halen via de URL", res.status === 200, `${res.status} in ${Date.now() - t0} ms`);
}
console.log(`\n${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
