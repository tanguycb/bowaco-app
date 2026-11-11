// 4b.4: de zuivere kern van "Eén tik" (Vandaag van de werfleider) en van de starten van klant, architect en veiligheidscoördinator.
// Geen React, geen DOM: tests/proef-4b-4.mjs draait dit rechtstreeks. Alles volgt uit gegevens die de backend de rol al gaf.
import type { DayWork, ReportOp, TimeSlot } from "../backend";
import { t } from "../texts/nl";
import { faseNaam, type Fase } from "./fase";

const V = t.vandaag;
const DEFAULT_SLOTS: TimeSlot[] = [{ fromMin: 450n, toMin: 720n }, { fromMin: 750n, toMin: 960n }];
const MAX_TAKEN = 3;

export type Tik = { key: string; werk: DayWork; tekst: string; detail: string; knop: string; op: ReportOp[]; label: string };

/** Zuivere keuze (tests/proef-4b-4.mjs): welke bevestigingen staan er voor deze werven op deze dag, gegeven wat al in de wachtrij staat. */
export function tikken(works: DayWork[], pending: { workId: bigint; kind: string; taskId?: bigint; percent?: bigint }[]): Tik[] {
  const out: Tik[] = [];
  for (const w of works) {
    const mine = pending.filter((p) => p.workId === w.id);
    const noReport = w.reports.length === 0 && !mine.some((p) => p.kind === "attendance");
    if (w.planned.length > 0 && noReport) {
      out.push({
        key: `wie-${w.id}`, werk: w, tekst: V.eenTik.wie, detail: w.planned.map((p) => p.code).join(" · "), knop: V.eenTik.klopt,
        label: `${w.planned.length} firma's aanwezig`,
        op: w.planned.map((p) => ({ __kind__: "attendance", attendance: { orgId: p.orgId, names: "", headcount: 1n, slots: DEFAULT_SLOTS, regie: false, note: "", replaces: undefined } }) as ReportOp),
      });
    }
    let n = 0;
    for (const task of w.tasks) {
      if ((task.status as string) === "done" || task.percent >= 100n || n >= MAX_TAKEN) continue;
      if (mine.some((p) => p.kind === "workDone" && p.taskId === task.id && p.percent === 100n)) continue;
      n++;
      out.push({
        key: `taak-${w.id}-${task.id}`, werk: w, tekst: V.eenTik.taak, detail: task.title.split(/[,+]/)[0], knop: V.eenTik.klaar,
        label: `«${task.title}» ${t.verslag.ready}`,
        op: [{ __kind__: "workDone", workDone: { taskId: task.id, text: "", percent: 100n } } as ReportOp],
      });
    }
  }
  return out;
}


/** Wat er voor een werf klaarstaat voor een architect of een veiligheidscoördinator, uit zijn rechten op die werf (de backend beslist per tabblad). */
export function veiligRegels(w: { grants: readonly string[] }): { key: string; tab: string }[] {
  const out = [{ key: "planning", tab: "planning" }];
  if (w.grants.includes("readReports")) out.push({ key: "verslagen", tab: "verslagen" });
  out.push({ key: "vergunningen", tab: "vergunningen" });
  out.push({ key: w.grants.includes("uploadDocs") ? "documentenUpload" : "documenten", tab: "documenten" });
  return out;
}

/** De stand van de werf in één zin voor de klant. */
export const standZin = (f: Fase, client: boolean) => (f.cancelled ? t.klantStart.stilgelegd : t.klantStart.stand(faseNaam(f, client)));
