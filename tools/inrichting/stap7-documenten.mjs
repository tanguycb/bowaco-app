// Stap 2b.6 stap 7: documenten van de actieve werven (plan van tools/inrichting/lees-documenten.py). Een upload gaat naar
// de opslagdienst van Caffeine, BUITEN het lokale net: daarom toont deze stap enkel wat er per werf zou komen (droogloop),
// ook met --echt. Opladen gebeurt pas na de beslissing van de eigenaar (vraag D47: welke soorten, welke werven) en zijn
// uitdrukkelijke "ja" (PB-01), met de uploadfunctie van de app per werf; geen bulk-upload.
import { isLocal } from "./lib.mjs";

export async function stap7({ actor, plan, echt, verslag, zou }) {
  const S = 7;
  const codes = new Set([...(await actor.listWorks()).map((w) => w.code), ...(zou?.werven ?? [])]);
  const mb = (b) => `${(b / 1e6).toFixed(1)} MB`;
  for (const w of plan.werven) {
    const soorten = Object.entries(w.soorten).map(([k, n]) => `${n} ${k}`).join(", ");
    if (!codes.has(w.code)) { verslag.add(S, "werfdocumenten", w.code, "", "conflict", "werf niet in de app (eerst stap 3)"); continue; }
    verslag.add(S, "werfdocumenten", w.code, "", "overgeslagen", `${w.aantal} bestanden (${mb(w.bytes)}): ${soorten}; niet opgeladen (vraag D47)`);
  }
  const tot = plan.werven.reduce((s, w) => s + w.bytes, 0);
  verslag.noteer(S, `selectie: ${plan.werven.reduce((s, w) => s + w.aantal, 0)} bestanden, ${mb(tot)} over ${plan.werven.length} werven. Niet opgeladen: ${isLocal() ? "de opslagdienst van Caffeine ligt buiten het lokale net" : "wacht op de beslissing van de eigenaar"} (vraag D47).`);
  for (const [k, n] of Object.entries(plan.nietGeselecteerd ?? {})) verslag.noteer(S, `niet geselecteerd: ${n} × ${k}`);
  if (echt) verslag.noteer(S, "--echt heeft voor deze stap geen effect: er wordt niets opgeladen.");
}
