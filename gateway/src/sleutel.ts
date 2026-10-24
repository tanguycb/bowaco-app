// Maakt de sleutel van de robot (Ed25519) en toont ENKEL de publieke principal. De sleutel blijft op de server
// (bestand 0600); een offline kopie bewaart de eigenaar zelf (architectuur §6.2). Bestaat het bestand al: niets
// overschrijven, enkel de principal tonen.
//   node src/sleutel.ts /etc/bowaco-postbode/robot.json
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("gebruik: node src/sleutel.ts <pad naar robot.json>");
  process.exit(2);
}
if (existsSync(file)) {
  const id = Ed25519KeyIdentity.fromJSON(readFileSync(file, "utf8"));
  console.log(`bestaat al; robotprincipal: ${id.getPrincipal().toText()}`);
} else {
  const id = Ed25519KeyIdentity.generate();
  writeFileSync(file, JSON.stringify(id.toJSON()), { mode: 0o600, flag: "wx" });
  console.log(`nieuwe sleutel in ${file}; robotprincipal: ${id.getPrincipal().toText()}`);
}
