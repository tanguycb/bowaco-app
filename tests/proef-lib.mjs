// Hulp voor de proefbank (stap 3.5): verzonnen historiek (bestanden die een interne persoon aan een document hangt) en een volledige
// proefronde van een bot via zijn proeftools op /mcp (zoals Claude het zou doen). Enkel VERZONNEN gegevens (P-…, pb-…).
import { tool } from "./mcp-lib.mjs";

const ok = (r) => { if (r && typeof r === "object" && "err" in r) throw new Error(r.err); return r && typeof r === "object" && "ok" in r ? r.ok : r; };
export const fakeBlob = (c) => new TextEncoder().encode("!caf!sha256:" + c.repeat(64).slice(0, 64));

// n bestanden over de werven en soorten (rondgaand), elk door `who` (een interne persoon) aan een NIEUW document gehangen.
// De naam bevat de werfcode en de soort (zo kan de nep-inferentiedienst en een "goede" bot het juiste antwoord vinden).
export async function makeHistory(who, works, kinds, n, tag, mark = "") {
  const out = [];
  const one = async (i) => {
    const w = works[i % works.length];
    const k = kinds[i % kinds.length];
    const name = `pb-${tag}-${w.code}-${k}-${i}${mark ? "-" + mark : ""}.pdf`;
    const fileId = ok(await who.addFile(name, "application/pdf", BigInt(10_000 + i), fakeBlob(((i % 15) + 1).toString(16)), [w.id], false));
    const docId = ok(await who.attachDocumentFile(w.id, k, [], fileId));
    out[i] = { fileId, docId, workId: w.id, code: w.code, kind: k, name };
  };
  for (let i = 0; i < n; i += 8) await Promise.all(Array.from({ length: Math.min(8, n - i) }, (_, j) => one(i + j)));
  return out;
}

// Een proefronde als de bot: gevallen ophalen, per geval een antwoord (answerFor(naam) → { werfId, soort } of null = overslaan),
// in porties van `batch`. Geeft de antwoorden van de app terug (om na te gaan dat ze nooit juist/fout zeggen).
export async function playRound(anon, cid, token, answerFor, { batch = 25, maxLoops = 40 } = {}) {
  const replies = [];
  const seen = new Set();
  for (let loop = 0; loop < maxLoops; loop++) {
    const g = await tool(anon, cid, token, "proef_gevallen");
    if (g.isError) return { error: g.text, replies };
    const todo = (g.data.gevallen ?? []).filter((c) => !seen.has(c.geval));
    if (todo.length === 0) return { done: g.data.open === 0, open: g.data.open, replies, last: g };
    const ans = [];
    for (const c of todo) {
      seen.add(c.geval);
      const a = answerFor(c.invoer?.bestand?.naam ?? "");
      if (a) ans.push({ geval: c.geval, ...a });
    }
    for (let i = 0; i < ans.length; i += batch) {
      const r = await tool(anon, cid, token, "proef_antwoorden", { antwoorden: ans.slice(i, i + batch) });
      replies.push(r);
      if (r.isError) return { error: r.text, replies };
      if (r.data.open === 0) return { done: true, open: 0, replies };
    }
  }
  return { done: false, replies };
}

// Een geslaagde ronde voor een bot (alle antwoorden juist): set uit de historiek, ronde starten, spelen. Geeft { setId, roundId, round }.
export async function passProof(admin, anon, cid, token, botId, history, name = "Proefset (test)") {
  const byName = new Map(history.map((h) => [h.name, h]));
  const setId = ok(await admin.buildProofSet("document-koppelen", name, 200n));
  const roundId = ok(await admin.startProofRound(setId, { bot: botId }));
  const play = await playRound(anon, cid, token, (n) => { const h = byName.get(n); return h ? { werfId: Number(h.workId), soort: h.kind } : { werfId: 0, soort: "onbekend" }; });
  const round = (await admin.listProofRounds()).find((r) => r.id === roundId);
  return { setId, roundId, round, play };
}
