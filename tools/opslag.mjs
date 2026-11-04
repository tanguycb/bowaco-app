// Echte upload naar de opslagdienst van Caffeine voor de draftproeven (tests/ vindt de pakketten niet zelf:
// ze staan in tools/node_modules). Enkel proefbeelden, nooit echte werffoto's.
// 2c.9: ook de hash van een bestand ZONDER upload (blobHash: dezelfde berekening als StorageClient.putFile) en de client
// voor de import van één werf op live (storageClientInrichting: enkel de inrichtingsidentiteit, enkel na het ja van de eigenaar).
import { HttpAgent } from "@icp-sdk/core/agent";
import { StorageClient } from "@caffeineai/object-storage";
import { identity, isLiveCanister, LIVE_ID, weigerLive } from "./lib.mjs";

const GATEWAY = "https://blob.caffeine.ai";

export async function storageClient(cid, projectId, identityName) {
  weigerLive(cid, "een proefupload");
  return new StorageClient("default-bucket", GATEWAY, cid, projectId, await HttpAgent.create({ host: "https://icp-api.io", identity: identityName ? identity(identityName) : undefined }));
}

// De opslag kent een bestand aan de hash van zijn boom (stukken van 1 MiB + de kopregels Content-Type, Content-Length en
// Content-Disposition met de bestandsnaam), niet aan de sha256 van de inhoud. Zelfde berekening als putFile, zonder netwerk:
// zo weet de import vóór de upload of een bestand er al staat, en registreert hij lokaal exact de verwijzing van live.
const disposition = (await import(new URL("./formatBlobContentDisposition.js", import.meta.resolve("@caffeineai/object-storage")).href)).formatBlobContentDisposition;
const rekenaar = new StorageClient("default-bucket", GATEWAY, "aaaaa-aa", "-", null);
export async function blobHash(bytes, mime, name) {
  const file = new Blob([new Uint8Array(bytes)], { type: mime });
  const headers = { "Content-Type": mime, "Content-Length": String(file.size) };
  const d = disposition(name);
  if (d) headers["Content-Disposition"] = d;
  const { blobHashTree } = await rekenaar.processFileForUpload(file, headers);
  return blobHashTree.tree.hash.toShaString();
}
export const blobRef = (hash) => new TextEncoder().encode("!caf!" + hash);
export const refText = (blob) => { try { return new TextDecoder().decode(blob); } catch { return ""; } };

// De import van één werf (tools/inrichting/stap8-werf.mjs) op live: enkel als inrichtingsidentiteit, enkel met JA_EIGENAAR=1.
// Een draft krijgt nooit echte bestanden (de stap weigert dat zelf voor een echt plan); lokaal is er geen opslagdienst.
export async function storageClientInrichting(cid, projectId, identityName) {
  if (isLiveCanister(cid) && (identityName !== LIVE_ID || process.env.JA_EIGENAAR !== "1")) {
    throw new Error(`Geweigerd: op live laadt enkel de inrichtingsidentiteit (${LIVE_ID}) op, met JA_EIGENAAR=1.`);
  }
  if (!projectId) throw new Error("opladen vraagt --project <project-id> (project_id in env.json van de app)");
  return new StorageClient("default-bucket", GATEWAY, cid, projectId, await HttpAgent.create({ host: "https://icp-api.io", identity: identity(identityName) }));
}
