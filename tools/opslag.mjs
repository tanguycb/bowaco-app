// Echte upload naar de opslagdienst van Caffeine voor de draftproeven (tests/ vindt de pakketten niet zelf:
// ze staan in tools/node_modules). Enkel proefbeelden, nooit echte werffoto's.
import { HttpAgent } from "@icp-sdk/core/agent";
import { StorageClient } from "@caffeineai/object-storage";
import { identity } from "./lib.mjs";

export async function storageClient(cid, projectId, identityName) {
  return new StorageClient("default-bucket", "https://blob.caffeine.ai", cid, projectId, await HttpAgent.create({ host: "https://icp-api.io", identity: identityName ? identity(identityName) : undefined }));
}
