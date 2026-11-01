// Het facturatieschema van een werf aanpassen (stap 2c.6, AC-4): schijven met naam, %, moment en eventueel een ander % per hoofdstuk;
// per hoofdstuk samen 100 %, de laatste schijf neemt de rest. Een schijf met een factuur blijft zoals ze is (de server controleert).
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { BillingWhen, SalesPlanView } from "../backend";
import { Button, Sheet, useToast } from "../design";
import { t } from "../texts/nl";
import { dayToInput, errText, fmtBp, inputToDay, parsePct, unwrap, useBackend } from "../util";

const T = t.sales;
type Row = { key: string; title: string; pct: string; when: string; day: string; chapters: Record<string, string> };

const toRow = (s: SalesPlanView["steps"][number]): Row => ({
  key: s.key,
  title: s.title,
  pct: fmtBp(s.pctBp).replace(" %", ""),
  when: s.when.__kind__,
  day: s.when.__kind__ === "onDay" ? dayToInput(s.when.onDay) : "",
  chapters: Object.fromEntries(s.chapterPct.map((c) => [c.chapter, fmtBp(c.pctBp).replace(" %", "")])),
});

export function PlanSheet({ workId, p, onClose }: { workId: bigint; p: SalesPlanView; onClose: () => void }) {
  const { actor } = useBackend();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(p.steps.map(toRow));
  const [perChapter, setPerChapter] = useState(p.steps.some((s) => s.chapterPct.length > 0));
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pctOf = (s: string) => parsePct(s);
  const sum = rows.reduce((a, r) => a + (pctOf(r.pct) ?? 0n), 0n);
  const chapterSums = p.chapters.map((c) => rows.reduce((a, r) => a + ((r.chapters[c.chapter] ?? "").trim() ? pctOf(r.chapters[c.chapter]) ?? 0n : pctOf(r.pct) ?? 0n), 0n));
  const valid = sum === 10_000n && chapterSums.every((x) => x === 10_000n) && rows.every((r) => pctOf(r.pct) !== null && r.title.trim());
  const save = useMutation({
    mutationFn: async () => {
      const steps = rows.map((r) => {
        const when: BillingWhen = r.when === "onDay" ? { __kind__: "onDay", onDay: inputToDay(r.day) ?? 0n } : r.when === "beforeStart" ? { __kind__: "beforeStart", beforeStart: null } : r.when === "final" ? { __kind__: "final", final: null } : { __kind__: "byHand", byHand: null };
        const chapterPct = perChapter ? p.chapters.filter((c) => (r.chapters[c.chapter] ?? "").trim()).map((c) => ({ chapter: c.chapter, pctBp: pctOf(r.chapters[c.chapter]) ?? 0n })) : [];
        return { key: r.key, title: r.title.trim(), pctBp: pctOf(r.pct) ?? 0n, when, chapterPct };
      });
      return unwrap(await actor!.saveSalesPlan(workId, p.version, steps));
    },
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); onClose(); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
  });
  const add = () => {
    let n = rows.length + 1;
    while (rows.some((r) => r.key === `schijf-${n}`)) n++;
    const last = rows[rows.length - 1];
    const next = { key: `schijf-${n}`, title: `Schijf ${n}`, pct: "0", when: "byHand", day: "", chapters: {} };
    setRows(last && last.when === "final" ? [...rows.slice(0, -1), next, last] : [...rows, next]);
  };
  return (
    <Sheet title={T.plan} open onClose={onClose} wide footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" disabled={!valid} busy={save.isPending} onClick={() => save.mutate()}>{T.planSave}</Button></>}>
      <p className="bw-muted">{T.planLead(p.baseQuote)}</p>
      <label className="a-check"><input type="checkbox" checked={perChapter} onChange={(e) => setPerChapter(e.target.checked)} /> {T.chapterPct}</label>
      <div className="a-tablewrap">
        <table className="a-table">
          <thead><tr><th>{T.cols.title}</th><th>%</th><th>{T.cols.due}</th>{perChapter && p.chapters.map((c) => <th key={c.chapter}>{c.chapter}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td><input className="bw-input" aria-label={T.cols.title} value={r.title} onChange={(e) => set(i, { title: e.target.value })} /></td>
                <td><input className="bw-input" style={{ width: 70 }} inputMode="decimal" aria-label="%" value={r.pct} onChange={(e) => set(i, { pct: e.target.value })} /></td>
                <td>
                  <select className="bw-input" aria-label={T.cols.due} value={r.when} onChange={(e) => set(i, { when: e.target.value })}>
                    {Object.entries(T.when).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  {r.when === "onDay" && <input className="bw-input" type="date" aria-label={T.when.onDay} value={r.day} onChange={(e) => set(i, { day: e.target.value })} />}
                </td>
                {perChapter && p.chapters.map((c) => <td key={c.chapter}><input className="bw-input" style={{ width: 60 }} inputMode="decimal" placeholder={r.pct} aria-label={`${r.title} ${c.chapter}`} value={r.chapters[c.chapter] ?? ""} onChange={(e) => set(i, { chapters: { ...r.chapters, [c.chapter]: e.target.value } })} /></td>)}
                <td>{rows.length > 1 && <Button iconOnly icon="close" aria-label={t.common.close} onClick={() => setRows(rows.filter((_, j) => j !== i))} />}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td><Button icon="plus" onClick={add}>{T.addStep}</Button></td><td className={sum === 10_000n ? "" : "a-err"}>{fmtBp(sum)}</td><td />{perChapter && chapterSums.map((x, k) => <td key={k} className={x === 10_000n ? "" : "a-err"}>{fmtBp(x)}</td>)}<td /></tr></tfoot>
        </table>
      </div>
    </Sheet>
  );
}
