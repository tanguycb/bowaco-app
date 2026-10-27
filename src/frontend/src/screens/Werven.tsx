// Werven (1.1): lijst met zoeken en deelwerven, nieuwe werf of deelwerf, en de onderdelen die de
// werfpagina (Werf.tsx) gebruikt. Wat iemand mag, beslist de backend (Rights.mo).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ExternalBlob, OrgKind, type Caps, type FileView, type WorkView } from "../backend";
import { Button, Choice, Icon, Sheet, Table, useToast } from "../design";
import { t } from "../texts/nl";
import { OpenConfidential } from "./Dossier";
import { errText, fmtBytes, fmtTime, optText, unwrap, useBackend } from "../util";
import { EmptyState, factsOf, Loading, Page, PhaseLabel, useStages, useWorks, WorkList } from "./common";
import { DashCounters, useDashboard } from "./Dashboard";
import { isClient } from "../app/nav";
import { volgendeStap, werfFase, werfGroep } from "../app/fase";

/** Hoofdwerven met hun deelwerven er meteen onder; zoeken op code, naam of gemeente. */
function nested(works: WorkView[], q: string): WorkView[] {
  const s = q.trim().toLowerCase();
  const hit = (w: WorkView) => !s || [w.code, w.name, w.address.city, w.analyticCode ?? ""].some((x) => x.toLowerCase().includes(s));
  const byCode = (a: WorkView, b: WorkView) => a.code.localeCompare(b.code, "nl");
  const tops = works.filter((w) => w.parentId === undefined || !works.some((p) => p.id === w.parentId)).sort(byCode);
  const out: WorkView[] = [];
  for (const top of tops) {
    const subs = works.filter((w) => w.parentId === top.id).sort(byCode);
    if (hit(top) || subs.some(hit)) out.push(top, ...subs.filter((x) => hit(x) || hit(top)));
  }
  return out;
}

const GROUPS = ["aanvragen", "lopend", "afgerond", "alle"] as const;
type Group = (typeof GROUPS)[number];

/**
 * 2b.3: Werven met tabbladen per fase (Aanvragen & offertes · Lopend · Afgerond · Alle, vraag 15), de fase als eigen label
 * en de kolom Volgende stap. Geannuleerde werven enkel met het vinkje. Lopend toont bovenaan de tellers van het vroegere
 * Dashboard (AD-08) en een filter op werfleider. Externen (architect, klant, OA) zien hun werven zonder tabbladen.
 */
export function Werven({ caps, go, route }: { caps: Caps; go: (to: string) => void; route?: string[] }) {
  const works = useWorks();
  const stages = useStages();
  const { actor, isFetching } = useBackend();
  const on = !!actor && !isFetching;
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: on && caps.readTeam });
  const persons = useQuery({ queryKey: ["persons", false], queryFn: () => actor!.listPersons(false), enabled: on && caps.readTeam });
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [leader, setLeader] = useState("all");
  const [cancelled, setCancelled] = useState(false);
  const W = t.wervenFase;
  const group: Group = (GROUPS as readonly string[]).includes(route?.[1] ?? "") ? (route![1] as Group) : "lopend";
  const newBtn = caps.createWork && <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>{W.newRequest}</Button>;
  if (!caps.readTeam) {
    const list = works.data ? nested(works.data, q) : [];
    return (
      <Page title={t.werven.title}>
        {works.data && works.data.length > 6 && <input className="bw-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.werven.search} aria-label={t.werven.search} />}
        <Loading q={works} />
        {works.data && <WorkList works={list} go={go} empty={q ? t.werven.noMatch : t.werven.empty} client={isClient(caps)} />}
      </Page>
    );
  }
  const all = (works.data ?? []).filter((w) => w.archivedAt === undefined);
  const rows = all.map((w) => { const f = factsOf(w, stages.data); return { w, f, fase: werfFase(f) }; });
  const inGroup = (r: (typeof rows)[number], g: Group) => (cancelled || !r.fase.cancelled) && (g === "alle" || werfGroep(r.fase) === g);
  const counts = Object.fromEntries(GROUPS.map((g) => [g, rows.filter((r) => inGroup(r, g)).length])) as Record<Group, number>;
  const leaders = [...new Set(all.map((w) => w.leaderPersonId).filter((x): x is bigint => x !== undefined).map(String))];
  const pname = (id?: bigint) => (id === undefined ? "" : persons.data?.find((p) => p.id === id)?.name ?? `#${id}`);
  const oname = (id?: bigint) => (id === undefined ? "" : orgs.data?.find((o) => o.id === id)?.name ?? "");
  const shownIds = new Set(rows.filter((r) => inGroup(r, group) && (leader === "all" || (leader === "none" ? r.w.leaderPersonId === undefined : String(r.w.leaderPersonId) === leader))).map((r) => r.w.id));
  // Hoofdwerven met hun deelwerven eronder; zoeken op code, naam, gemeente of klant.
  const s = q.trim().toLowerCase();
  const byId = new Map(rows.map((r) => [r.w.id, r]));
  const list = nested(all.filter((w) => shownIds.has(w.id)), "").filter((w) => !s || [w.code, w.name, w.address.city, w.analyticCode ?? "", oname(w.clientOrgId)].some((x) => x.toLowerCase().includes(s))).map((w) => byId.get(w.id)!);
  return (
    <Page title={t.werven.title} actions={newBtn}>
      <nav className="a-tabs a-tabs--inline" aria-label={t.werven.title}>
        {GROUPS.map((g) => (
          <a key={g} href={`#/werven/${g}`} className="a-tab" aria-current={g === group ? "page" : undefined} onClick={(e) => { e.preventDefault(); go(`werven/${g}`); }}>
            {W.tabs[g]} <span className="a-tag">{counts[g]}</span>
          </a>
        ))}
      </nav>
      {group === "lopend" && caps.readOrgPlanning && <LopendTellers />}
      <div className="a-wfilter">
        <input className="bw-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.werven.search} aria-label={t.werven.search} />
        {leaders.length > 0 && (
          <select className="bw-input" value={leader} onChange={(e) => setLeader(e.target.value)} aria-label={W.leaderFilter} style={{ maxWidth: 240 }}>
            <option value="all">{W.leaderAll}</option>
            {leaders.map((l) => <option key={l} value={l}>{pname(BigInt(l))}</option>)}
            <option value="none">{W.leaderNone}</option>
          </select>
        )}
        <label className="a-check"><input type="checkbox" checked={cancelled} onChange={(e) => setCancelled(e.target.checked)} />{W.showCancelled}</label>
      </div>
      <Loading q={works} />
      {works.data && (list.length === 0 ? (all.length === 0 && !q ? <EmptyState title={t.leeg.werven.t} text={t.leeg.werven.d} action={caps.createWork ? <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>{t.leeg.request}</Button> : <span className="bw-muted">{t.leeg.zonderRecht}</span>} extra={caps.importPlan && <Button onClick={() => go("beheer/planning")}>{t.leeg.werven.import}</Button>} /> : <p className="a-empty">{q ? t.werven.noMatch : W.empty[group]}</p>) : (
        <Table
          rows={list}
          rowKey={(r) => String(r.w.id)}
          onRow={(r) => go(`werven/${r.w.id}`)}
          columns={[
            { key: "code", label: W.cols.code, width: "110px", render: (r) => <span className="bw-mono">{r.w.parentId !== undefined ? "↳ " : ""}{r.w.code}</span> },
            { key: "werf", label: W.cols.werf, render: (r) => <span className="a-list__main"><b>{r.w.name}</b><span className="bw-muted">{r.w.parentId !== undefined ? `${W.sub} · ` : ""}{r.w.address.city}</span></span> },
            { key: "klant", label: W.cols.klant, render: (r) => oname(r.w.clientOrgId) || <span className="bw-muted">–</span> },
            { key: "fase", label: W.cols.fase, render: (r) => <PhaseLabel fase={r.fase} /> },
            { key: "leider", label: W.cols.leider, render: (r) => pname(r.w.leaderPersonId) || <span className="bw-muted">{t.werven.noLeader}</span> },
            { key: "volgende", label: W.cols.volgende, render: (r) => { const s = volgendeStap(r.fase, r.f, caps, r.w.caps.edit); return s ? t.stap[s.key].t : ""; } },
          ]}
        />
      ))}
      <p className="bw-muted">{W.note}</p>
      {open && <NewRequest caps={caps} onClose={() => setOpen(false)} go={go} />}
    </Page>
  );
}

/** Lopend: de tellers van het vroegere Dashboard (werven bezig, vertraagd, bevestigingen, problemen, verslagen, vergunningen). */
function LopendTellers() {
  const q = useDashboard();
  return q.data ? <DashCounters v={q.data} /> : null;
}

/**
 * 2b.3: + Nieuwe aanvraag (vraag 1): een klant belt of mailt → klant (bestaand of nieuw) + adres → een werf in de fase Aanvraag.
 * De klant hoeft niet eerst in het adresboek (B4/B5). Het vertrouwelijk klantcontact (e-mail, telefoon) enkel voor wie het mag
 * (R23: beheerder); de backend controleert elke stap (createOrg, setOrgConfidential, createWork).
 */
export function NewRequest({ caps, onClose, go }: { caps: Caps; onClose: () => void; go: (to: string) => void }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const W = t.wervenFase;
  const orgs = useQuery({ queryKey: ["orgs", false], queryFn: () => actor!.listOrgs(false), enabled: !!actor && !isFetching });
  const clients = (orgs.data ?? []).filter((o) => o.kind === OrgKind.client).sort((a, b) => a.name.localeCompare(b.name, "nl"));
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [f, setF] = useState({ client: "", clientName: "", email: "", phone: "", code: "", name: "", street: "", number: "", zip: "", city: "", vat: 600 });
  // Chrome-test 2b.3: zonder adres blokkeert de controle vóór verzending ("De klant heeft geen volledig adres"); bij een
  // renovatie woont de klant meestal op de werf, dus standaard krijgt de nieuwe klant het werfadres.
  const [sameAddr, setSameAddr] = useState(true);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const autoName = [f.street, f.number].filter(Boolean).join(" ");
  // Review 2b.3: de nieuwe klant wordt maar één keer gemaakt; weigert de werf daarna (code al in gebruik …), dan gebruikt een
  // tweede poging dezelfde firma (geen dubbele "Familie …" in het adresboek).
  const [madeOrg, setMadeOrg] = useState<bigint | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (!f.code.trim()) throw new Error(W.needCode);
      if (!(f.name.trim() || autoName)) throw new Error(W.needAddress);
      let clientOrgId: bigint;
      if (mode === "existing") {
        if (!f.client) throw new Error(W.needClient);
        clientOrgId = BigInt(f.client);
      } else if (madeOrg !== null) {
        clientOrgId = madeOrg;
      } else {
        if (!f.clientName.trim()) throw new Error(W.needClient);
        const address = sameAddr && f.street.trim() && f.city.trim() ? { street: f.street, number: f.number, zip: f.zip, city: f.city, country: "BE" } : undefined;
        clientOrgId = unwrap(await actor!.createOrg({ kind: OrgKind.client, name: f.clientName.trim(), kbo: undefined, vat: undefined, aliases: [], trades: [], address, notes: "" })).id;
        setMadeOrg(clientOrgId);
        if (caps.readConfidentialContact && (f.email.trim() || f.phone.trim())) {
          const r = await actor!.setOrgConfidential(clientOrgId, { name: f.clientName.trim(), phone: optText(f.phone), email: optText(f.email) }, "");
          if ("err" in r) throw new Error(`${W.clientMade(f.clientName.trim())}: ${r.err}`);
        }
      }
      return unwrap(await actor!.createWork({
        code: f.code,
        name: f.name.trim() || autoName,
        address: { street: f.street, number: f.number, zip: f.zip, city: f.city, country: "BE" },
        parentId: undefined,
        clientOrgId,
        architectOrgId: undefined,
        leaderPersonId: undefined,
        vatBp: BigInt(f.vat),
      }));
    },
    onSuccess: (w) => { toast.show({ kind: "ok", text: W.made }); void qc.invalidateQueries({ queryKey: ["works"] }); void qc.invalidateQueries({ queryKey: ["stages"] }); void qc.invalidateQueries({ queryKey: ["orgs"] }); onClose(); go(`werven/${w.id}`); },
  });
  return (
    <Sheet title={W.newRequest} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      <div className="a-form">
        <p className="bw-muted">{W.requestLead}</p>
        <Field label={W.clientPick}>
          <Choice label={W.clientPick} value={mode} onChange={setMode} options={[{ value: "new", label: W.clientNew }, { value: "existing", label: W.clientExisting }]} />
        </Field>
        {mode === "existing" ? (
          <Field label={W.clientExisting}>
            <select className="bw-input" value={f.client} onChange={set("client")}>
              <option value="">{t.werven.noOrgPick}</option>
              {clients.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name}</option>)}
            </select>
          </Field>
        ) : (
          <>
            <Field label={W.clientName}><input className="bw-input" value={f.clientName} onChange={set("clientName")} placeholder={W.clientNamePh} maxLength={80} disabled={madeOrg !== null} /></Field>
            {caps.readConfidentialContact && (
              <div className="a-grid2">
                <Field label={W.clientEmail}><input className="bw-input" value={f.email} onChange={set("email")} inputMode="email" /></Field>
                <Field label={W.clientPhone}><input className="bw-input" value={f.phone} onChange={set("phone")} inputMode="tel" /></Field>
              </div>
            )}
          </>
        )}
        <div className="a-grid3">
          <Field label={t.werven.street}><input className="bw-input" value={f.street} onChange={set("street")} /></Field>
          <Field label={t.werven.number}><input className="bw-input" value={f.number} onChange={set("number")} /></Field>
          <Field label={t.werven.zip}><input className="bw-input" value={f.zip} onChange={set("zip")} inputMode="numeric" /></Field>
        </div>
        <Field label={t.werven.city}><input className="bw-input" value={f.city} onChange={set("city")} /></Field>
        {mode === "new" && madeOrg === null && <label className="a-check"><input type="checkbox" checked={sameAddr} onChange={(e) => setSameAddr(e.target.checked)} />{W.sameAddr}</label>}
        <div className="a-grid2">
          <Field label={t.werven.code}><input className="bw-input bw-mono" value={f.code} onChange={set("code")} placeholder="2026-231" /></Field>
          <Field label={t.werven.vat}><Choice label={t.werven.vat} value={f.vat} onChange={(v) => setF({ ...f, vat: v })} options={[{ value: 600, label: "6 %" }, { value: 2100, label: "21 %" }]} /></Field>
        </div>
        <p className="bw-muted">{W.codeHelp}</p>
        <Field label={t.werven.name}><input className="bw-input" value={f.name} onChange={set("name")} placeholder={autoName || W.whatPh} maxLength={80} /></Field>
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      </div>
    </Sheet>
  );
}

/** Nieuwe werf, of een deelwerf van `parent` (zelfde adres, klant en btw als vertrekpunt). */
export function NewWork({ onClose, parent, go }: { onClose: () => void; parent?: WorkView; go?: (to: string) => void }) {
  const { actor } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    code: parent ? `${parent.code}-` : "",
    name: parent ? `${parent.name} ` : "",
    street: parent?.address.street ?? "",
    number: parent?.address.number ?? "",
    zip: parent?.address.zip ?? "",
    city: parent?.address.city ?? "",
    vat: parent ? Number(parent.vatBp) : 600,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: async () =>
      unwrap(await actor!.createWork({
        code: f.code,
        name: f.name,
        address: { street: f.street, number: f.number, zip: f.zip, city: f.city, country: "BE" },
        parentId: parent?.id,
        clientOrgId: parent?.clientOrgId,
        architectOrgId: parent?.architectOrgId,
        leaderPersonId: undefined,
        vatBp: BigInt(f.vat),
      })),
    onSuccess: (w) => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["works"] }); onClose(); go?.(`werven/${w.id}`); },
  });
  return (
    <Sheet title={parent ? `${t.werven.newSub} · ${parent.code}` : t.werven.new} open onClose={onClose} side footer={<><Button onClick={onClose}>{t.common.cancel}</Button><Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>{t.common.save}</Button></>}>
      <div className="a-form">
        <div className="a-grid2">
          <Field label={t.werven.code}><input className="bw-input bw-mono" value={f.code} onChange={set("code")} placeholder="2026-231" /></Field>
          <Field label={t.werven.vat}><Choice label={t.werven.vat} value={f.vat} onChange={(v) => setF({ ...f, vat: v })} options={[{ value: 600, label: "6 %" }, { value: 2100, label: "21 %" }]} /></Field>
        </div>
        <Field label={t.werven.name}><input className="bw-input" value={f.name} onChange={set("name")} /></Field>
        <div className="a-grid3">
          <Field label={t.werven.street}><input className="bw-input" value={f.street} onChange={set("street")} /></Field>
          <Field label={t.werven.number}><input className="bw-input" value={f.number} onChange={set("number")} /></Field>
          <Field label={t.werven.zip}><input className="bw-input" value={f.zip} onChange={set("zip")} inputMode="numeric" /></Field>
        </div>
        <Field label={t.werven.city}><input className="bw-input" value={f.city} onChange={set("city")} /></Field>
        {save.error && <p className="a-err" role="alert">{errText(save.error)}</p>}
      </div>
    </Sheet>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="bw-field">
      <span className="bw-label">{label}</span>
      {children}
    </label>
  );
}

// Foto's worden op het toestel verkleind (≤ 1600 px, JPEG): kleiner en zonder EXIF-locatie (§8.5).
export async function shrinkPhoto(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Verkleinen mislukt"))), "image/jpeg", 0.82));
}

export function Files({ workId, canUpload, title, canConfidential }: { workId: bigint; canUpload: boolean; title?: string; canConfidential?: boolean }) {
  const { actor, isFetching } = useBackend();
  const qc = useQueryClient();
  const toast = useToast();
  const [progress, setProgress] = useState<number | null>(null);
  // Bestanden van anderen verschijnen zonder herladen: bij terugkeren naar het tabblad en elke 30 s.
  const files = useQuery({ queryKey: ["files", String(workId)], queryFn: () => actor!.listFiles(workId), enabled: !!actor && !isFetching, refetchOnWindowFocus: true, refetchInterval: 30_000 });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const isImage = file.type.startsWith("image/");
      const data = isImage ? await shrinkPhoto(file) : file;
      const mime = isImage ? "image/jpeg" : file.type;
      const name = isImage ? file.name.replace(/\.[^.]+$/, "") + ".jpg" : file.name;
      const bytes = new Uint8Array(await data.arrayBuffer());
      setProgress(0);
      const blob = ExternalBlob.fromBytes(bytes, mime, name).withUploadProgress(setProgress);
      return unwrap(await actor!.addFile(name, mime, BigInt(bytes.length), blob, workId, false));
    },
    onSuccess: () => { toast.show({ kind: "ok", text: t.common.saved }); void qc.invalidateQueries({ queryKey: ["files", String(workId)] }); },
    onError: (e) => toast.show({ kind: "error", text: errText(e) }),
    onSettled: () => setProgress(null),
  });
  const sorted = (files.data ?? []).slice().sort((a, b) => Number(b.at - a.at));
  return (
    <section className="a-section">
      <h2 className="bw-h2">{title ?? t.werven.files}</h2>
      {canUpload && (
        <label className="bw-btn bw-btn--secondary" style={{ position: "relative" }}>
          <Icon name="camera" size={22} />
          {upload.isPending ? t.werven.uploading(progress ?? 0) : t.werven.upload}
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={upload.isPending} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
        </label>
      )}
      <Loading q={files} />
      {files.data && sorted.length === 0 && <p className="a-empty">{t.werven.noFiles}</p>}
      {sorted.length > 0 && (
        <ul className="a-list">
          {sorted.map((f) => <FileRow key={String(f.id)} f={f} canConfidential={!!canConfidential} />)}
        </ul>
      )}
    </section>
  );
}

function FileRow({ f, canConfidential }: { f: FileView; canConfidential: boolean }) {
  const url = f.blob?.getDirectURL();
  return (
    <li>
      <span className="a-list__main">
        <b>{f.name}</b>
        <span className="bw-muted bw-num">{fmtBytes(Number(f.size))} · {fmtTime(f.at)}</span>
      </span>
      {f.confidential && <span className="a-tag a-tag--warn">{t.werven.confidential}</span>}
      {url && <a className="bw-btn bw-btn--quiet" href={url} target="_blank" rel="noreferrer">{t.werven.open}</a>}
      {/* P-15 (1.1): ook een los vertrouwelijk bestand opent, via de gelogde update-call (R12, R23). */}
      {!url && f.confidential && canConfidential && <OpenConfidential fileId={f.id} />}
    </li>
  );
}
