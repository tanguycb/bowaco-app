// Echte opstartcode maken (bouwplan §3.3.1, architectuur T21, vraag A16). DE EIGENAAR draait dit zelf in
// zijn eigen Terminal; de code verschijnt alleen daar en komt nooit in een Claude-sessie, een log of git.
// Bewaard wordt enkel de HASH, in ~/.bowaco/opstart-hash.txt; die hash komt in src/backend/lib/Config.mo.
//
//   node tools/opstartcode.mjs            → nieuwe code + hash
//   node tools/opstartcode.mjs controle   → typ een code (onzichtbaar) en zie of ze bij de bewaarde hash past
//
// Zelfde regels als de backend (lib/Codes.mo): 16 tekens uit het Crockford-alfabet (80 bit) uit een
// cryptografische toevalsbron, hash = SHA-256("bowaco-code-v1|" + code zonder BOW- en streepjes).
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const dir = join(homedir(), ".bowaco");
const hashFile = join(dir, "opstart-hash.txt");
const hash = (body) => createHash("sha256").update(`bowaco-code-v1|${body}`).digest("hex");

function normalize(raw) {
  let s = raw.toUpperCase().replace(/[\s-]/g, "");
  if (s.length === 19 && s.startsWith("BOW")) s = s.slice(3);
  return s.replace(/O/g, "0").replace(/[IL]/g, "1");
}

if (process.argv[2] === "controle") {
  const want = readFileSync(hashFile, "utf8").trim();
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = () => {}; // invoer niet tonen
  process.stdout.write("Opstartcode (wordt niet getoond): ");
  rl.question("", (code) => {
    rl.close();
    console.log(hash(normalize(code)) === want ? "\n✓ Deze code past bij de bewaarde hash." : "\n✗ Past NIET bij de bewaarde hash.");
  });
} else {
  // 256 is deelbaar door 32: byte % 32 is zonder vertekening.
  const body = [...randomBytes(16)].map((b) => ALPHABET[b % 32]).join("");
  const shown = `BOW-${body.match(/.{4}/g).join("-")}`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(hashFile, hash(body) + "\n", { mode: 0o600 });
  console.log("\nOPSTARTCODE (schrijf ze op papier of bewaar ze in je wachtwoordbeheerder; ze wordt nergens bewaard):\n");
  console.log(`    ${shown}\n`);
  console.log("Druk op Enter als je ze bewaard hebt; daarna wordt het scherm leeggemaakt.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question("", () => {
    rl.close();
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H"); // scherm én terugscrolbuffer leeg
    console.log(`Hash bewaard in ${hashFile}:\n\n    ${hash(body)}\n`);
    console.log("Geef Claude enkel deze hash (of zeg: 'de hash staat in ~/.bowaco/opstart-hash.txt').");
    console.log("Controleren kan later met: node tools/opstartcode.mjs controle");
  });
}
