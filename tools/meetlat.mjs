// Meetlat vóór elke draft (architectuur §7.1 M12, §10.1, T19, T21). Faalt (exit 1) bij een overschreden grens.
//   node tools/meetlat.mjs [map]      (standaard: de repo; push.sh geeft de schone kopie mee)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

const root = process.argv[2] ?? join(import.meta.dirname, "..");
const MiB = 1024 * 1024;
let bad = 0;
const ok = (cond, text) => {
  console.log(`${cond ? "✓" : "✗"} ${text}`);
  if (!cond) bad++;
};

// 1. backend.wasm ≤ 10 MiB en custom sections ≤ 1 MiB (motoko:stable-types, candid:service …)
const wasm = readFileSync(join(root, "src/backend/dist/backend.wasm"));
ok(wasm.length <= 10 * MiB, `backend.wasm ${(wasm.length / MiB).toFixed(2)} MiB (≤ 10 MiB)`);
const leb = (buf, pos) => {
  let n = 0, shift = 0, b;
  do { b = buf[pos++]; n |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
  return [n >>> 0, pos];
};
let pos = 8;
while (pos < wasm.length) {
  const id = wasm[pos++];
  let size;
  [size, pos] = leb(wasm, pos);
  if (id === 0) {
    const [nameLen, p2] = leb(wasm, pos);
    const name = wasm.subarray(p2, p2 + nameLen).toString("utf8");
    if (name.startsWith("icp:") || name.startsWith("motoko") || name.startsWith("candid")) {
      ok(size <= MiB, `custom section ${name}: ${(size / 1024).toFixed(1)} KiB (≤ 1 MiB)`);
    }
  }
  pos += size;
}

// 2. publieke methodes ≤ 1.000 (uit de .did)
const did = readFileSync(join(root, "src/backend/dist/backend.did"), "utf8");
const methods = [...did.slice(did.indexOf("service")).matchAll(/^\s+"?[A-Za-z_][A-Za-z0-9_]*"?\s*:/gm)].length;
ok(methods <= 1000, `${methods} publieke methodes (≤ 1.000)`);

// 3. geen data-viewer (T19)
const mops = readFileSync(join(root, "mops.toml"), "utf8");
ok(!mops.includes("--generate-view-queries") && !mops.includes("caffeineai-data-viewer"), "geen data-viewer / view-queries (T19)");

// 4. nooit een stabiele let/var op het hoogste niveau van een mixin (§10.1: wordt stilzwijgend stabiel)
const mixDir = join(root, "src/backend/mixins");
for (const f of readdirSync(mixDir).filter((x) => x.endsWith(".mo"))) {
  const lines = readFileSync(join(mixDir, f), "utf8").split("\n");
  const top = lines.filter((l) => /^ {2}(let|var) /.test(l));
  ok(top.length === 0, `${f}: geen let/var op het hoogste niveau${top.length ? ` (${top[0].trim()})` : ""}`);
}

// 5. geen geheimen in de upload (T21): geen privésleutels, geen opstartcode (16 tekens), geen .bowaco
const skip = new Set(["node_modules", ".git", ".mops", "dist", ".icp", "dist-prototype"]);
const hits = [];
// De test-opstartcode staat enkel in ~/.bowaco; zoek hem letterlijk (met en zonder streepjes).
const testCodeFile = join(homedir(), ".bowaco", "test-opstartcode.txt");
const testCode = existsSync(testCodeFile) ? readFileSync(testCodeFile, "utf8").trim() : "";
const forbidden = testCode ? [testCode, testCode.replace(/^BOW-/, "").replaceAll("-", "")] : [];
// Ed25519KeyIdentity.toJSON() = ["<publieke sleutel hex>", "<geheime sleutel hex>"]
const keyJson = /\[\s*"[0-9a-f]{64,}"\s*,\s*"[0-9a-f]{64,}"\s*\]/;
const walk = (d) => {
  for (const n of readdirSync(d)) {
    if (skip.has(n)) continue;
    const p = join(d, n);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (s.size < 2 * MiB && /\.(mo|ts|tsx|mjs|js|json|toml|md|sh|html|css|yaml|txt)$/.test(n)) {
      const text = readFileSync(p, "utf8");
      if (keyJson.test(text) || /PRIVATE\x20KEY/.test(text) || forbidden.some((c) => text.includes(c))) hits.push(relative(root, p));
    }
  }
};
walk(root);
ok(hits.length === 0, `geen sleutels of opstartcode in de bestanden${hits.length ? `: ${hits.join(", ")}` : ""}`);

console.log(bad ? `\n${bad} grens(en) overschreden` : "\nmeetlat groen");
process.exit(bad ? 1 : 0);
