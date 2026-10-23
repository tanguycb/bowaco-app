// Kalenderrekenen in de browser voor de planning (1.3). De backend (lib/Plan.mo) blijft de waarheid: dit is
// enkel voor de weergave (weken, slepen, verlengen) en rekent met dezelfde regels: werkdagen = ma–vr zonder
// de kalenderblokken van de werf.
import type { BlockView } from "../backend";

export const DAY_MS = 86_400_000;

/** 0 = maandag … 6 = zondag (1970-01-01 was een donderdag). */
export const weekday = (d: number) => (d + 3) % 7;

export type Cal = { blocks: [number, number][] };

export function makeCal(blocks: BlockView[]): Cal {
  return { blocks: blocks.map((b) => [Number(b.from), Number(b.to)] as [number, number]) };
}

export const blocked = (cal: Cal, d: number) => cal.blocks.some(([f, t]) => d >= f && d <= t);
export const isWorkday = (cal: Cal, d: number) => weekday(d) < 5 && !blocked(cal, d);

export function nextWorkday(cal: Cal, d: number): number {
  let x = d;
  for (let i = 0; i < 1500 && !isWorkday(cal, x); i++) x++;
  return x;
}

export function addWorkdays(cal: Cal, d: number, n: number): number {
  let x = nextWorkday(cal, d);
  let k = Math.abs(n);
  for (let i = 0; k > 0 && i < 1500; i++) {
    x += n >= 0 ? 1 : -1;
    if (isWorkday(cal, x)) k--;
  }
  return x;
}

/** Werkdagen van a tot en met b (a ≤ b). */
export function workdaysIn(cal: Cal, a: number, b: number): number {
  let n = 0;
  for (let d = a; d <= b && d - a < 1500; d++) if (isWorkday(cal, d)) n++;
  return n;
}

/** ISO-weeknummer en de maandag van die week. */
export function isoWeek(d: number): { year: number; week: number; monday: number } {
  const monday = d - weekday(d);
  const date = new Date((d + 3 - weekday(d)) * DAY_MS); // donderdag van die week
  const year = date.getUTCFullYear();
  const jan1 = Math.floor(Date.UTC(year, 0, 1) / DAY_MS);
  const week = Math.floor((d + 3 - weekday(d) - jan1) / 7) + 1;
  return { year, week, monday };
}

const WD = ["ma", "di", "wo", "do", "vr", "za", "zo"];

/** "ma 02.11" */
export function fmtShort(d: number | bigint): string {
  const n = Number(d);
  const x = new Date(n * DAY_MS);
  return `${WD[weekday(n)]} ${String(x.getUTCDate()).padStart(2, "0")}.${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "02.11" */
export function fmtDm(d: number | bigint): string {
  const x = new Date(Number(d) * DAY_MS);
  return `${String(x.getUTCDate()).padStart(2, "0")}.${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const dayLetter = (d: number) => WD[weekday(d)][0].toUpperCase();

/** Belgische wettelijke feestdagen van een jaar (Pasen volgens de gregoriaanse kalender). */
export function belgianHolidays(year: number): { day: number; name: string }[] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const dayN = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = Math.floor(Date.UTC(year, month - 1, dayN) / DAY_MS);
  const day = (mo: number, da: number) => Math.floor(Date.UTC(year, mo - 1, da) / DAY_MS);
  return [
    { day: day(1, 1), name: "Nieuwjaar" },
    { day: easter + 1, name: "Paasmaandag" },
    { day: day(5, 1), name: "Feest van de Arbeid" },
    { day: easter + 39, name: "O.L.H. Hemelvaart" },
    { day: easter + 50, name: "Pinkstermaandag" },
    { day: day(7, 21), name: "Nationale feestdag" },
    { day: day(8, 15), name: "O.L.V. Hemelvaart" },
    { day: day(11, 1), name: "Allerheiligen" },
    { day: day(11, 11), name: "Wapenstilstand" },
    { day: day(12, 25), name: "Kerstmis" },
  ];
}

/** Vandaag als dagnummer (lokale kalenderdatum). */
export function today(): number {
  const n = new Date();
  return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY_MS);
}

/** Een fout "intussen gewijzigd" van de backend (planversie). */
export const isStale = (e: unknown) => String(e instanceof Error ? e.message : e).includes("intussen gewijzigd");
