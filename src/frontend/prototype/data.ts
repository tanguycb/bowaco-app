// Voorbeelddata voor het prototype van stap 0.5.
// Werfadressen, taken en OA-codes komen uit 20260508_Planning_algemeen.xlsx (week 42–44 van 2026).
// Personen, klanten, architecten, telefoonnummers, nummerplaten en statussen zijn VERZONNEN.
import type { Status } from "../src/design";

export const TODAY = { label: "donderdag 22 oktober", short: "do 22-10", week: 43, dayIndex: 3 };
export const DAYS = ["ma", "di", "wo", "do", "vr"];
export const WEEKS: Record<number, { label: string; dates: string[] }> = {
  42: { label: "12 – 16 okt 2026", dates: ["12", "13", "14", "15", "16"] },
  43: { label: "19 – 23 okt 2026", dates: ["19", "20", "21", "22", "23"] },
  44: { label: "26 – 30 okt 2026", dates: ["26", "27", "28", "29", "30"] },
};

export type WorkId = "engel" | "onder" | "albert" | "duif" | "diel" | "stuiver" | "jbg" | "ciac" | "koren" | "steendam";
export type Work = {
  id: WorkId; name: string; place: string; short: string;
  status: Status; statusExtra?: string; lead: string; next: string; warn?: string;
};

export const WORKS: Work[] = [
  { id: "engel", name: "Engelhoekstraat 29", place: "Sint-Martens-Leerne", short: "Engelhoekstraat", status: "busy", lead: "Jonas", next: "Ventilatie + boringen · wk 44" },
  { id: "onder", name: "Onderbergen 50", place: "9000 Gent", short: "Onderbergen", status: "delayed", statusExtra: "+5 wd", lead: "Jonas", next: "Crepi buurman · wacht op droog weer", warn: "Vertraging gemeld door Jonas (20-10)" },
  { id: "albert", name: "Albertlaan 19", place: "9000 Gent", short: "Albertlaan", status: "busy", lead: "Jonas", next: "Opkuis + oplevering + PID · vr 23-10" },
  { id: "duif", name: "Duifhuisstraat 49", place: "9000 Gent", short: "Duifhuisstraat", status: "busy", lead: "Sander", next: "Chape · wk 44", warn: "Vergunning container vervalt 31-10" },
  { id: "diel", name: "Dieleghemdreef 79", place: "Jette", short: "Dieleghemdreef", status: "busy", lead: "Sander", next: "Plaatsen ketel · wk 44", warn: "Geen werfverslag op 21-10" },
  { id: "stuiver", name: "Stuiver 33", place: "9950 Waarschoot", short: "Stuiver", status: "busy", lead: "Jonas", next: "Schilderwerken · wk 44" },
  { id: "jbg", name: "Jan-Baptist-Guinardstraat 4", place: "9000 Gent", short: "J.-B.-Guinardstr.", status: "busy", lead: "Sander", next: "Afwerking elektriciteit · wk 44" },
  { id: "ciac", name: "CIAC Eeklo, Zeelaan 5", place: "9900 Eeklo", short: "CIAC Eeklo", status: "busy", lead: "Sander", next: "Afvoer terugplaatsen · wk 45" },
  { id: "koren", name: "Korenbloemstraat", place: "9000 Gent", short: "Korenbloemstraat", status: "done", lead: "Sander", next: "Definitieve oplevering 15-10" },
  { id: "steendam", name: "Steendam 60 (appartement)", place: "9000 Gent", short: "Steendam 60", status: "planned", lead: "Jonas", next: "Start dakwerken + velux · wk 45" },
];
export const workById = (id: WorkId) => WORKS.find((w) => w.id === id)!;

export type Conf = "ok" | "open" | "no";
export type Assignment = { id: string; oa: string; work: WorkId; task: string; week: number; from: number; to: number; conf: Conf; note?: string; status?: Status };

export const OAS: { code: string; trade: string }[] = [
  { code: "BOWACO", trade: "eigen ploeg" },
  { code: "GILS", trade: "ruwbouw · riolering" },
  { code: "KEVIN", trade: "elektriciteit · ventilatie" },
  { code: "WESLEY", trade: "gyproc · crepi" },
  { code: "BENNY", trade: "pleisterwerk" },
  { code: "XAVIER", trade: "parket" },
  { code: "ROBBE", trade: "tegels" },
  { code: "FRANK", trade: "sanitair · terras" },
  { code: "TOM", trade: "sanitair" },
  { code: "NIVOLO", trade: "chape · PUR" },
  { code: "GANDAK", trade: "dak" },
  { code: "THOMAS", trade: "verwarming" },
  { code: "DAN", trade: "schilderwerk" },
];

export const ASSIGNMENTS: Assignment[] = [
  // week 42
  { id: "a1", oa: "WESLEY", work: "ciac", task: "Gyproc wand + deur", week: 42, from: 0, to: 2, conf: "ok" },
  { id: "a2", oa: "WESLEY", work: "jbg", task: "Plamuurwerken", week: 42, from: 3, to: 4, conf: "ok" },
  { id: "a3", oa: "XAVIER", work: "diel", task: "Opschuren + plaatsen parket", week: 42, from: 0, to: 4, conf: "ok" },
  { id: "a4", oa: "ROBBE", work: "diel", task: "Plaatsen vloertegels", week: 42, from: 0, to: 4, conf: "ok" },
  { id: "a5", oa: "BENNY", work: "duif", task: "Binnenplaatafwerking + dagkanten", week: 42, from: 0, to: 4, conf: "ok" },
  { id: "a6", oa: "GILS", work: "engel", task: "Riolering + wachtbuizen", week: 42, from: 0, to: 3, conf: "ok" },
  { id: "a7", oa: "GILS", work: "onder", task: "Stenen goot verwijderen", week: 42, from: 4, to: 4, conf: "ok", note: "GILS 17/10" },
  { id: "a8", oa: "TOM", work: "jbg", task: "Afwerking elektriciteit", week: 42, from: 0, to: 2, conf: "ok" },
  { id: "a9", oa: "TOM", work: "stuiver", task: "Douche + sanitair aanpassen", week: 42, from: 3, to: 4, conf: "ok" },
  { id: "a10", oa: "KEVIN", work: "koren", task: "Keuring elektriciteit", week: 42, from: 1, to: 1, conf: "ok" },
  { id: "a11", oa: "FRANK", work: "stuiver", task: "Pleisteren + kerdi", week: 42, from: 0, to: 4, conf: "ok" },
  // week 43 (deze week)
  { id: "b1", oa: "BOWACO", work: "albert", task: "Opkuis + oplevering + PID", week: 43, from: 3, to: 4, conf: "ok" },
  { id: "b2", oa: "GILS", work: "engel", task: "Riolering, wachtbuizen, terras uitzetten", week: 43, from: 0, to: 4, conf: "ok" },
  { id: "b3", oa: "GILS", work: "onder", task: "Balustrade ophangen", week: 43, from: 3, to: 3, conf: "open", note: "afspraak do 13:00" },
  { id: "b4", oa: "KEVIN", work: "ciac", task: "Elektriciteit nakijken", week: 43, from: 0, to: 1, conf: "ok" },
  { id: "b5", oa: "KEVIN", work: "jbg", task: "Afwerking ventilatie", week: 43, from: 2, to: 4, conf: "ok" },
  { id: "b6", oa: "WESLEY", work: "onder", task: "Crepi buurman", week: 43, from: 1, to: 2, conf: "ok", status: "delayed", note: "wacht op droog weer" },
  { id: "b7", oa: "BENNY", work: "duif", task: "Binnenplaatafwerking + dagkanten", week: 43, from: 0, to: 4, conf: "ok" },
  { id: "b8", oa: "XAVIER", work: "diel", task: "Opschuren + plaatsen parket", week: 43, from: 0, to: 4, conf: "ok" },
  { id: "b9", oa: "ROBBE", work: "diel", task: "Plaatsen vloertegels", week: 43, from: 0, to: 4, conf: "ok" },
  { id: "b10", oa: "FRANK", work: "stuiver", task: "Terras, fronten aanpassen", week: 43, from: 0, to: 3, conf: "open" },
  // week 44
  { id: "c1", oa: "XAVIER", work: "diel", task: "Opschuren + plaatsen parket", week: 44, from: 0, to: 4, conf: "ok" },
  { id: "c2", oa: "THOMAS", work: "diel", task: "Plaatsen ketel", week: 44, from: 1, to: 2, conf: "open" },
  { id: "c3", oa: "NIVOLO", work: "duif", task: "Chape", week: 44, from: 0, to: 1, conf: "open" },
  { id: "c4", oa: "BENNY", work: "duif", task: "Dagkanten + bogen", week: 44, from: 0, to: 4, conf: "ok" },
  { id: "c5", oa: "GANDAK", work: "duif", task: "Terras, lijngoot", week: 44, from: 2, to: 4, conf: "no", note: "kan niet: materiaal pas wk 45" },
  { id: "c6", oa: "ROBBE", work: "duif", task: "Vloer- en wandtegels", week: 44, from: 2, to: 4, conf: "ok" },
  { id: "c7", oa: "KEVIN", work: "engel", task: "Ventilatiebuizen + boringen", week: 44, from: 0, to: 4, conf: "open" },
  { id: "c8", oa: "DAN", work: "stuiver", task: "Schilderwerken", week: 44, from: 0, to: 4, conf: "ok" },
];

/** Conflict = dezelfde OA op twee werven op dezelfde dag (architectuur §2.5). */
export function conflicts(list: Assignment[], week: number): Set<string> {
  const ids = new Set<string>();
  const w = list.filter((a) => a.week === week);
  for (const a of w) for (const b of w) {
    if (a.id < b.id && a.oa === b.oa && a.work !== b.work && a.from <= b.to && b.from <= a.to) { ids.add(a.id); ids.add(b.id); }
  }
  return ids;
}

export type Task = { id: string; title: string; oa: string; weeks: string; status: Status; percent?: number; reason?: string; today?: boolean };

export const ENGEL_TASKS: Task[] = [
  { id: "t1", title: "Voorbereidende werken: werfborden, afsluiting", oa: "BOWACO", weeks: "wk 18–20", status: "done" },
  { id: "t2", title: "Afbraakwerken + plaatsen netten", oa: "GILS", weeks: "wk 22–26", status: "done" },
  { id: "t3", title: "Betonplaat", oa: "GILS", weeks: "wk 28", status: "done" },
  { id: "t4", title: "Dakwerken: dakraam + goot aanpassen", oa: "GANDAK", weeks: "wk 34–38", status: "done" },
  { id: "t5", title: "Dorpels voorgevel uitmetselen + kimblokken", oa: "GILS", weeks: "wk 41", status: "done" },
  { id: "t6", title: "Opmeten buitenschrijnwerk", oa: "DE RUYVER", weeks: "wk 41", status: "done" },
  { id: "t7", title: "Aanpassen riolering + plaatsen putten", oa: "GILS", weeks: "wk 42–43", status: "busy", percent: 60, today: true },
  { id: "t8", title: "Plaatsen wachtbuizen volgens plan", oa: "GILS", weeks: "wk 42–43", status: "busy", percent: 25, today: true },
  { id: "t9", title: "Uitzetten terras, uitscheppen −20 cm", oa: "GILS", weeks: "wk 43", status: "planned", percent: 0, today: true },
  { id: "t10", title: "Plaatsen ventilatiebuizen + boringen", oa: "KEVIN", weeks: "wk 44", status: "planned" },
  { id: "t11", title: "Plaatsen buitenschrijnwerk", oa: "DE RUYVER", weeks: "wk 45", status: "blocked", reason: "wacht op levering ramen" },
  { id: "t12", title: "Plaatsen structuur voorzetwand", oa: "WESLEY", weeks: "wk 45", status: "planned" },
  { id: "t13", title: "Plaatsen gevelisolatie", oa: "BOWACO", weeks: "wk 46", status: "planned" },
  { id: "t14", title: "Pleisterwerken + dagkanten", oa: "BENNY", weeks: "wk 47–50", status: "planned" },
  { id: "t15", title: "Chape in badkamers", oa: "NIVOLO", weeks: "wk 49", status: "planned" },
];

export const CONTACTS = [
  { role: "Werfleider", name: "Jonas Van Acker", phone: "0400 10 20 30" },
  { role: "OA · GILS", name: "ploegbaas GILS", phone: "0400 11 22 33" },
  { role: "OA · KEVIN", name: "Kevin (elektriciteit)", phone: "0400 44 55 66" },
  { role: "Klant", name: "Fam. Mertens", phone: "0400 77 88 99" },
  { role: "Architect", name: "Atelier Noord", phone: "09 000 00 00" },
];

export const PERMIT = {
  kind: "Inname openbaar domein: container 6 m³",
  by: "Stad Deinze",
  nr: "IOD-2026-0417",
  from: "05-10-2026",
  to: "30-11-2026",
  where: "voor nr. 29, 2 parkeerplaatsen",
};

export type Attendee = { id: string; org: string; who: string; count: number; slots: [number, number][]; regie: boolean; fromPlan: boolean };

export const ATTENDEES: Attendee[] = [
  { id: "p1", org: "BOWACO", who: "Jonas (werfleider)", count: 1, slots: [[450, 720], [750, 960]], regie: false, fromPlan: true },
  { id: "p2", org: "GILS", who: "Gils, Yannick, Sam", count: 3, slots: [[450, 720], [750, 990]], regie: true, fromPlan: true },
];

export const MATERIAL_KINDS = [
  { key: "receipt", label: "Bon / levering" },
  { key: "fromWarehouse", label: "Uit magazijn of camionette" },
  { key: "smallMaterial", label: "Klein materiaal" },
  { key: "equipment", label: "Materieel" },
  { key: "wasteToWarehouse", label: "Afval naar magazijn" },
  { key: "returned", label: "Materiaal terug" },
] as const;

export const MATERIALS = [
  { id: "m1", kind: "receipt", text: "12 zakken snelbeton, 6 PVC-bochten 110 mm (bon 2210)" },
  { id: "m2", kind: "fromWarehouse", text: "8 kimblokken uit de camionette" },
  { id: "m3", kind: "equipment", text: "Trilplaat, bouwlaser" },
];

export const VEHICLES = ["Camionette 1-VBW-482", "Bestelwagen 2-KRT-117", "Eigen wagen"];

export const REPORTS = [
  { day: "wo 21-10", by: "Jonas", people: "BOWACO 1 · GILS 3", regie: "25u30", photos: 6, note: "Riolering achterzijde open, 2 putten geplaatst. Buurman verwittigd voor de container." },
  { day: "di 20-10", by: "Jonas", people: "BOWACO 1 · GILS 3", regie: "24u00", photos: 4, note: "Wachtbuizen keuken en berging volgens plan. Regen vanaf 15 u." },
  { day: "ma 19-10", by: "Jonas", people: "BOWACO 1 · GILS 2", regie: "16u00", photos: 3, note: "Opstart week 43; levering beton en riolering." },
];

export const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const fmtDur = (m: number) => `${Math.floor(m / 60)}u${String(m % 60).padStart(2, "0")}`;
export const slotsMinutes = (s: [number, number][]) => s.reduce((t, [a, b]) => t + Math.max(0, b - a), 0);
