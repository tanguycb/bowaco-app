// Stap 2b.6 stap 3: werven en planning (plan van tools/inrichting/lees-werven.py + plan.json van tools/plan-analyse.py).
//   1. werven uit de werfmappen: createWork met de code van de index (W-001 …). Idempotent op code én adres: een werf
//      met dezelfde code of hetzelfde adres wordt niet opnieuw gemaakt. Elke nieuwe werf krijgt "nog na te kijken" met
//      de reden (setWorkReviewNote);
//   2. de planning van mei 2026 via importPlanning (1.5): een blok dat zeker bij een aangemaakte werf hoort, komt als
//      vervolg in die werf; de andere blokken worden een eigen werf (PL-…), zoals in 1.5. Idempotent via de vaste sleutels
//      van plan-analyse (blok, taak, uitvoerreeks, afspraak). Eerst een proefronde over alle blokken.
import { isAbsolute, join } from "node:path";
import { fold, leesPlan, ok, opt, NAKIJKEN } from "./lib.mjs";

const adresSleutel = (a) => fold(`${a.street} ${a.number} ${a.zip}`).replace(/ /g, "");

export async function stap3({ actor, plan, echt, verslag, map, zou }) {
  const S = 3;
  const werven = await actor.listWorks();
  const perCode = new Map(werven.map((w) => [w.code, w]));
  const perAdres = new Map(werven.filter((w) => w.address.street).map((w) => [adresSleutel(w.address), w]));
  const notities = new Map((await actor.workReviewNotes()).map(([id, t]) => [id, t]));
  const nakijken = async (id, code, tekst) => {
    if (notities.has(id)) return;
    if (echt) ok(await actor.setWorkReviewNote(id, tekst), `nog na te kijken ${code}`);
    verslag.add(S, "nog na te kijken", code, "", "aangemaakt", tekst);
  };

  // De werf in de app voor elke code van het plan (ook als ze op adres gevonden werd): de planning volgt die.
  const doelWerf = new Map();
  for (const w of plan.werven) {
    const bestaand = perCode.get(w.code) ?? perAdres.get(adresSleutel(w.adres));
    if (bestaand) { doelWerf.set(w.code, bestaand); verslag.add(S, "werf", w.code, w.naam, "overgeslagen", bestaand.code === w.code ? "bestaat al" : `zelfde adres als werf ${bestaand.code}`); continue; }
    let id = null;
    if (echt) {
      const r = await actor.createWork({ code: w.code, name: w.naam, address: w.adres, parentId: [], clientOrgId: [], architectOrgId: [], leaderPersonId: [], vatBp: BigInt(w.vatBp) });
      if ("err" in r) { verslag.add(S, "werf", w.code, w.naam, "fout", r.err); continue; }
      id = r.ok.id;
      perCode.set(w.code, r.ok);
      perAdres.set(adresSleutel(w.adres), r.ok);
      doelWerf.set(w.code, r.ok);
    }
    if (!echt) zou?.werven.add(w.code);
    verslag.add(S, "werf", w.code, w.naam, "aangemaakt", w.offertes ? `offerte(s) ${w.offertes}` : "");
    if (id !== null) await nakijken(id, w.code, `${NAKIJKEN}: ${w.nakijken} (inrichting met de documenten van BOWACO).`);
  }

  // ── Planning ─────────────────────────────────────────────────────────────
  const pp = plan.planning;
  if (!pp) return;
  // Ook het planningsplan gaat door de grens (het draagt geen label "test": dus echt).
  const pl = leesPlan(isAbsolute(pp.plan) ? pp.plan : join(map, pp.plan));
  if (!pl) throw new Error(`planningsplan ${pp.plan} ontbreekt`);
  const byCode = Object.fromEntries(pl.blokken.map((b) => [b.code, b]));
  const status = (s) => ({ [s]: null });
  const invoer = (b, beslissing) => ({
    key: b.key, name: b.name, street: b.street, number: b.number, zip: b.zip, city: b.city, vatBp: BigInt(b.vatBp), decision: beslissing,
    tasks: b.tasks.map((t, i) => ({
      key: t.key, title: t.title, note: t.note, responsible: opt(t.responsible), status: status(t.status), percent: BigInt(t.percent), start: BigInt(t.start), workdays: BigInt(t.workdays), order: BigInt(i + 1),
      runs: t.runs.map((r) => ({ key: r.key, name: r.name, from: BigInt(r.from), to: BigInt(r.to), note: r.note })),
      appointments: t.appointments.map((a) => ({ key: a.key, day: BigInt(a.day), time: opt(a.time), text: a.text, name: opt(a.name), weekFallback: a.weekFallback })),
      extra: t.extra,
    })),
  });
  const keuze = (b) => {
    const k = pp.blokken[String(b.rij)];
    if (k?.beslissing === "vervolg") {
      const doel = doelWerf.get(k.werf) ?? perCode.get(k.werf);
      if (doel) return { d: { followUp: doel.code }, uitleg: `taken in werf ${doel.code} (zelfde adres als de werfmap)` };
      // Echte run zonder doelwerf (bv. createWork faalde): niet als eigen werf, anders blijft het blok voorgoed daar.
      if (echt) return { d: null, uitleg: `werf ${k.werf} ontbreekt: blok overgeslagen` };
      return { d: { fresh: null }, uitleg: `zou in werf ${k.werf} komen (die bestaat in de droogloop nog niet)` };
    }
    const doel = b.besluit.doel ? byCode[b.besluit.doel]?.key : null;
    if (b.besluit.beslissing === "vervolg" && doel) return { d: { followUp: doel }, uitleg: `vervolg van blok ${b.besluit.doel} (1.5)` };
    if (b.besluit.beslissing === "deelwerf" && doel) return { d: { sub: doel }, uitleg: `deelwerf van blok ${b.besluit.doel} (1.5)` };
    return { d: { fresh: null }, uitleg: `eigen werf uit de planning (${k?.reden ?? "geen werfmap"})` };
  };
  const blokken = pl.blokken.filter((b) => b.besluit.beslissing !== "negeren");
  const ronde = async (dry) => {
    const known = [], out = [];
    for (const b of blokken) {
      const k = keuze(b);
      if (!k.d) { out.push({ b, k, r: null }); continue; }
      const r = await actor.importPlanning(dry, pp.batch, "Planning mei 2026 (inrichting)", known, invoer(b, k.d));
      out.push({ b, k, r });
      if (!("err" in r)) known.push(b.key);
    }
    return out;
  };
  const proef = await ronde(true);
  const fout = proef.filter((x) => x.r && "err" in x.r);
  if (fout.length) {
    for (const x of fout) verslag.add(S, "planningblok", x.b.code, x.b.header, "fout", x.r.err);
    verslag.noteer(S, "planning: de proefronde gaf fouten; er is niets van de planning bewaard");
    return;
  }
  const res = echt ? await ronde(false) : proef;
  const zonder = new Map();
  for (const { b, k, r } of res) {
    if (!r) { verslag.add(S, "planningblok", b.code, b.header, "conflict", k.uitleg); continue; }
    if ("err" in r) { verslag.add(S, "planningblok", b.code, b.header, "fout", r.err); continue; }
    const x = r.ok;
    const nieuw = Number(x.workCreated) > 0;
    verslag.add(S, "planningblok", b.code, b.header, Number(x.tasksCreated) + Number(x.assignmentsCreated) + Number(x.appointmentsCreated) + Number(x.workCreated) ? "aangemaakt" : "overgeslagen",
      `${k.uitleg}; werf ${x.workCode}${nieuw ? " (nieuw)" : ""} · taken ${x.tasksCreated} nieuw/${x.tasksExisting} bestaand · uitvoerders ${x.assignmentsCreated}/${x.assignmentsExisting} · afspraken ${x.appointmentsCreated}/${x.appointmentsExisting}`);
    for (const [n, c] of x.unmatched) zonder.set(n, (zonder.get(n) ?? 0) + Number(c));
    for (const p of x.problems) verslag.add(S, "planningblok", b.code, b.header, "conflict", p);
    // Een werfmap-werf die taken uit de planning krijgt, is gepland (zoals een werf die de planningimport zelf maakt).
    const doel = k.d.followUp ? perCode.get(k.d.followUp) : null;
    if (doel && "request" in doel.status) {
      if (echt) ok(await actor.setWorkStatus(doel.id, { planned: null }), `status ${doel.code}`);
      doel.status = { planned: null };
      verslag.add(S, "werfstatus", doel.code, doel.name, "bijgewerkt", "aanvraag → gepland (taken in de planning)");
    }
    if (echt && nieuw && x.workId.length) await nakijken(x.workId[0], x.workCode, `${NAKIJKEN}: werf uit de planning van mei 2026 zonder werfmap in de documenten (vraag Z1, D55); btw ${b.vatBp / 100} % voorlopig.`);
  }
  if (zonder.size) verslag.noteer(S, `planning: ${zonder.size} namen zonder firma (${[...zonder.values()].reduce((a, b) => a + b, 0)} plaatsen); die taken krijgen de weken maar geen uitvoerder (vraag D27)`);
  if (zonder.size) verslag.noteer(S, `namen zonder firma (meeste plaatsen eerst): ${[...zonder.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  verslag.noteer(S, `planning: ${blokken.length} blokken · ${pl.bevindingen.length} bevindingen van de lezer · blokkeringen ${Object.entries(pl.blokkeringen).map(([k, v]) => `${k} ${v.length}`).join(", ")} (niet als kalenderblok gezet)`);
  for (const w of [...(plan.nietInDeApp ? Object.entries(plan.nietInDeApp) : [])]) verslag.noteer(S, `niet in de app: ${w[1].aantal} × ${w[0]}`);
}
