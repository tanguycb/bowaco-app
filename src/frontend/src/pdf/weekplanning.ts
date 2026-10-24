// Deel-knop weekplanning per OA (bouwplan §8.6, rij 1.7): de week van één firma als PDF (pdf-lib) of als beeld
// (canvas → PNG), per dag de werven en de taken, met een link naar de app. Delen via het deelmenu van de gsm
// (WhatsApp, mail …) als de browser bestanden kan delen, anders downloaden. Enkel wat de deler zelf mag zien
// (weekBoard voor kantoor, myBoard voor de OA); nooit prijzen, notities van kantoor of andere firma's.
import type { BoardRow } from "../backend";

export type ShareWeek = {
  orgName: string;
  orgCode?: string;
  monday: number; // dagnummer van de maandag
  row: BoardRow | null;
  weekIndex: number; // welke week van het venster van `row`
  appUrl: string;
  byName?: string;
};

const DAYS = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag"];
const CONF: Record<string, string> = { confirmed: "bevestigd", declined: "kan niet", open: "nog te bevestigen" };

const dm = (d: number) => {
  const x = new Date(d * 86_400_000);
  return `${String(x.getUTCDate()).padStart(2, "0")}.${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
};

export function isoWeekOf(d: number): number {
  const t = new Date(d * 86_400_000);
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y.getTime()) / 86400000 + 1) / 7);
}

/** Per werkdag (ma–vr) de regels "WERF · naam — taak (bevestiging)". */
export function weekLines(w: ShareWeek): { day: string; lines: string[] }[] {
  const cell = w.row?.cells.find((c) => Number(c.week) === w.weekIndex);
  return DAYS.map((name, i) => {
    const d = w.monday + i;
    const lines: string[] = [];
    for (const it of cell?.items ?? []) {
      for (const tk of it.tasks) {
        if (tk.days.some((x) => Number(x) === d)) {
          const werf = it.hidden ? "andere werf" : `${it.workCode} · ${it.workName}`;
          lines.push(`${werf} — ${tk.title || "taak"}${tk.personName ? ` (${tk.personName})` : ""} · ${CONF[tk.confirmation.__kind__] ?? ""}`);
        }
      }
    }
    return { day: `${name} ${dm(d)}`, lines };
  });
}

export function title(w: ShareWeek): string {
  return `Weekplanning ${w.orgCode ? `${w.orgCode} · ` : ""}${w.orgName} · week ${isoWeekOf(w.monday)} (${dm(w.monday)} – ${dm(w.monday + 4)})`;
}

/** WinAnsi (standaardlettertype van een PDF): tekens daarbuiten vervangen in plaats van te falen. */
function safe(s: string): string {
  return s.replace(/[→⇒]/g, "->").replace(/[^\x20-\x7E -ÿ–—‘’“”•€]/g, "?");
}

export async function weekPdf(w: ShareWeek): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]);
  let y = 800;
  const line = (text: string, size: number, f = font, color = rgb(0.07, 0.07, 0.08), indent = 0) => {
    // Lange regels afbreken op woorden.
    const words = safe(text).split(" ");
    let cur = "";
    const out: string[] = [];
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (f.widthOfTextAtSize(next, size) > 515 - indent && cur) {
        out.push(cur);
        cur = word;
      } else cur = next;
    }
    if (cur) out.push(cur);
    for (const l of out) {
      if (y < 60) {
        page = doc.addPage([595, 842]);
        y = 800;
      }
      page.drawText(l, { x: 40 + indent, y, size, font: f, color });
      y -= size + 6;
    }
  };
  line("BOWACO", 11, bold, rgb(0.12, 0.12, 0.25));
  y -= 4;
  line(title(w), 15, bold);
  y -= 6;
  for (const d of weekLines(w)) {
    y -= 6;
    line(d.day, 11, bold, rgb(0.15, 0.25, 0.65));
    if (d.lines.length === 0) line("geen werk gepland", 10, font, rgb(0.4, 0.4, 0.45), 12);
    for (const l of d.lines) line(`• ${l}`, 10, font, undefined, 12);
  }
  y -= 14;
  line(`Bevestigen of "kan niet" melden in de app: ${w.appUrl}`, 9, font, rgb(0.3, 0.3, 0.35));
  line(`Gedeeld${w.byName ? ` door ${w.byName}` : ""} op ${new Date().toLocaleString("nl-BE")}. Bij twijfel geldt de planning in de app.`, 8, font, rgb(0.45, 0.45, 0.5));
  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

export async function weekPng(w: ShareWeek): Promise<Blob> {
  const days = weekLines(w);
  const W = 1080;
  const pad = 56;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = (size: number, weight = 400) => `${weight} ${size}px "Archivo Variable", Archivo, system-ui, sans-serif`;
  // Eerst de hoogte bepalen (regels afbreken), dan tekenen.
  const wrap = (text: string, size: number, weight: number, width: number) => {
    ctx.font = font(size, weight);
    const out: string[] = [];
    let cur = "";
    for (const word of text.split(" ")) {
      const next = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(next).width > width && cur) {
        out.push(cur);
        cur = word;
      } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  };
  type L = { text: string; size: number; weight: number; color: string; indent: number; gap: number };
  const ls: L[] = [];
  const add = (text: string, size: number, weight: number, color: string, indent = 0, gap = 10) => {
    for (const t of wrap(text, size, weight, W - 2 * pad - indent)) ls.push({ text: t, size, weight, color, indent, gap });
  };
  add("BOWACO", 26, 800, "#1e1f41");
  add(title(w), 36, 700, "#111111", 0, 24);
  for (const d of days) {
    add(d.day, 28, 700, "#1f45c4", 0, 8);
    if (d.lines.length === 0) add("geen werk gepland", 26, 400, "#6b7280", 24);
    for (const l of d.lines) add(`• ${l}`, 26, 400, "#111111", 24);
    ls[ls.length - 1].gap = 22;
  }
  add(`Bevestigen in de app: ${w.appUrl}`, 22, 400, "#4b5563", 0, 8);
  const H = pad * 2 + ls.reduce((a, l) => a + l.size * 1.25 + l.gap, 0);
  c.width = W;
  c.height = Math.ceil(H);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, c.height);
  let y = pad;
  for (const l of ls) {
    ctx.font = font(l.size, l.weight);
    ctx.fillStyle = l.color;
    ctx.textBaseline = "top";
    ctx.fillText(l.text, pad + l.indent, y);
    y += l.size * 1.25 + l.gap;
  }
  return new Promise((ok, err) => c.toBlob((b) => (b ? ok(b) : err(new Error("Beeld maken mislukt"))), "image/png"));
}

/** Delen via het deelmenu (gsm), anders downloaden. */
export async function shareWeek(w: ShareWeek, kind: "pdf" | "png"): Promise<"shared" | "downloaded"> {
  const blob = kind === "pdf" ? await weekPdf(w) : await weekPng(w);
  const name = `weekplanning-${(w.orgCode || w.orgName).replace(/[^A-Za-z0-9-]+/g, "_")}-week${isoWeekOf(w.monday)}.${kind}`;
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: title(w), text: `${title(w)} — ${w.appUrl}` });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "shared";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "downloaded";
}
