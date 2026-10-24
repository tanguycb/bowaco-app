// Wachtrij van de gsm (architectuur §8.2–§8.4). Elke handeling in het werfverslag wordt eerst LOKAAL bewaard
// (IndexedDB) als kleine opdracht met een opId (UUID) en de clientKey van het verslag; daarna verstuurt de
// wachtrij ze in volgorde, in pakjes, zodra er bereik is. De backend voert een opId maar één keer uit: een
// herhaling (antwoord gemist, tweede poging) geeft hetzelfde resultaat, nooit een dubbel.
//   • netwerkfout  → blijft staan, telt niet als poging ("wacht op verbinding");
//   • inhoudelijke fout (#err) → poging +1; na 5 pogingen "mislukt" met de reden en de knoppen Opnieuw / Weghalen;
//   • afsluiten wacht tot de eerdere opdrachten van hetzelfde verslag niet meer mislukt staan.
// Foto's: het verkleinde beeld staat in de lokale opslag tot de upload lukt; de verwijzing wordt bewaard, zodat
// bij een tweede poging enkel de opdracht herhaald wordt en niet de upload (§8.3).
import { createActorWithConfig, useInternetIdentity } from "@caffeineai/core-infrastructure";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createActor, ExternalBlob, type Backend, type OpResult, type ReportOp } from "../backend";
import { errText } from "../util";
import * as idb from "./db";

export type OpKind = ReportOp["__kind__"];
type FileSpec = { name: string; mime: string };

/** Een opdracht in de wachtrij. payload = de ReportOp zonder bestanden; die staan in de store "blobs". */
export type QueuedOp = {
  opId: string;
  seq: number;
  clientKey: string;
  workId: bigint;
  day: bigint;
  kind: OpKind;
  label: string;
  payload: ReportOp;
  file?: FileSpec; // foto of foto van een bon
  thumb?: FileSpec;
  state: "pending" | "failed";
  tries: number;
  error?: string;
  createdAt: number;
};

type BlobRec = { full: Blob; thumb?: Blob; fullRef?: Uint8Array; thumbRef?: Uint8Array };

export type NewOp = {
  clientKey: string;
  workId: bigint;
  day: bigint;
  label: string;
  op: ReportOp;
  file?: { blob: Blob; name: string; mime: string };
  thumb?: { blob: Blob; name: string; mime: string };
};

export type OutboxApi = {
  ready: boolean;
  online: boolean;
  syncing: boolean;
  syncedAt?: number;
  ops: QueuedOp[];
  pending: number;
  failed: QueuedOp[];
  enqueue: (o: NewOp) => Promise<string>;
  patch: (opId: string, payload: ReportOp, label?: string) => Promise<boolean>;
  discard: (opId: string) => Promise<void>;
  retry: (opId: string) => Promise<void>;
  sync: () => Promise<void>;
  blobUrl: (opId: string, which: "full" | "thumb") => Promise<string | undefined>;
  /** clientKey van het verslag van (werf, dag) op dit toestel; maakt er een als nodig. */
  clientKeyFor: (workId: bigint, day: bigint) => Promise<string>;
  /** Idem, en zet één keer de opdracht "verslag openen" (ensure) in de wachtrij vóór het eerste blok. */
  ensureReport: (workId: bigint, day: bigint, label: string) => Promise<string>;
  wipe: () => Promise<void>;
};

const Ctx = createContext<OutboxApi | null>(null);

export function useOutbox(): OutboxApi {
  const x = useContext(Ctx);
  if (!x) throw new Error("useOutbox buiten OutboxProvider");
  return x;
}

export function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const MAX_TRIES = 5;
const BATCH = 40;
const PHOTOS_PER_BATCH = 4;

/** Netwerk (geen bereik, time-out) of inhoud (weigering van de backend)? Enkel inhoud telt als poging. */
function isNetwork(e: unknown): boolean {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  if (/reject|trapped|Geen toegang|IC0\d{3}|canister/i.test(m) && !/fetch|network|timeout|timed out/i.test(m)) return false;
  return true;
}

let seqCounter = 0;
const nextSeq = () => Date.now() * 1000 + (seqCounter++ % 1000);

/** Bericht na een sync voor de gebruiker (samengevoegd, correctie …). */
export type SyncNotice = { clientKey: string; text: string };

export function OutboxProvider({ children, onNotice }: { children: ReactNode; onNotice?: (n: SyncNotice) => void }) {
  const { identity, isAuthenticated } = useInternetIdentity();
  const principal = identity?.getPrincipal().toText();
  const qc = useQueryClient();
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number>();
  const busy = useRef(false);
  const actorRef = useRef<{ principal: string; actor: Promise<Backend> } | null>(null);
  const notice = useRef(onNotice);
  notice.current = onNotice;

  // Opgeladen verwijzingen: ExternalBlob → (opId, welke). De uploader bewaart de verwijzing meteen lokaal.
  const uploads = useRef(new WeakMap<ExternalBlob, { opId: string; which: "full" | "thumb" }>());
  const known = useRef(new WeakMap<ExternalBlob, Uint8Array>());

  const reload = useCallback(async () => {
    const list = await idb.all<QueuedOp>("outbox");
    list.sort((a, b) => a.seq - b.seq);
    setOps(list);
    return list;
  }, []);

  useEffect(() => {
    setReady(false);
    setOps([]);
    if (!isAuthenticated || !principal || identity?.getPrincipal().isAnonymous()) return;
    let live = true;
    void (async () => {
      try {
        await idb.openDb(principal);
      } catch {
        return; // geen lokale opslag: geen wachtrij (de app werkt online); een volgende login probeert opnieuw
      }
      await idb.wipeOthers(principal);
      if (!live) return;
      await reload();
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [principal, isAuthenticated, identity, reload]);

  /** Eigen actor voor de wachtrij: fetch wordt pas bij de oproep opgezocht, en de uploader onthoudt verwijzingen. */
  const actor = useCallback((): Promise<Backend> => {
    if (actorRef.current && actorRef.current.principal === principal) return actorRef.current.actor;
    const a = createActorWithConfig(
      (cid: string, up: (f: ExternalBlob) => Promise<Uint8Array>, down: (b: Uint8Array) => Promise<ExternalBlob>, opts) =>
        createActor(
          cid,
          async (f: ExternalBlob) => {
            const k = known.current.get(f);
            if (k) return k;
            const ref = await up(f);
            const who = uploads.current.get(f);
            if (who) {
              const rec = await idb.get<BlobRec>("blobs", who.opId);
              if (rec) await idb.put("blobs", who.opId, who.which === "full" ? { ...rec, fullRef: ref } : { ...rec, thumbRef: ref });
            }
            return ref;
          },
          down,
          opts,
        ),
      { agentOptions: { identity, fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) } },
    ) as Promise<Backend>;
    actorRef.current = { principal: principal ?? "", actor: a };
    return a;
  }, [identity, principal]);

  /** De ReportOp met de bestanden erin (ExternalBlob uit de lokale opslag, of de bewaarde verwijzing). */
  const materialize = useCallback(async (q: QueuedOp): Promise<ReportOp> => {
    if (!q.file) return q.payload;
    const rec = await idb.get<BlobRec>("blobs", q.opId);
    if (!rec) throw new Error("De foto staat niet meer op dit toestel");
    const eb = async (b: Blob, spec: FileSpec, ref: Uint8Array | undefined, which: "full" | "thumb") => {
      const x = ExternalBlob.fromBytes(new Uint8Array(await b.arrayBuffer()), spec.mime, spec.name);
      if (ref) known.current.set(x, ref);
      else uploads.current.set(x, { opId: q.opId, which });
      return { blob: x, name: spec.name, mime: spec.mime, size: BigInt(b.size) };
    };
    if (q.payload.__kind__ === "photo") {
      const file = await eb(rec.full, q.file, rec.fullRef, "full");
      const thumb = rec.thumb && q.thumb ? await eb(rec.thumb, q.thumb, rec.thumbRef, "thumb") : undefined;
      return { __kind__: "photo", photo: { ...q.payload.photo, file, thumb } };
    }
    if (q.payload.__kind__ === "material") {
      const file = await eb(rec.full, q.file, rec.fullRef, "full");
      return { __kind__: "material", material: { ...q.payload.material, file } };
    }
    return q.payload;
  }, []);

  const sync = useCallback(async () => {
    if (busy.current || !ready) return;
    if (!navigator.onLine) {
      setOnline(false);
      return;
    }
    busy.current = true;
    setSyncing(true);
    try {
      let rounds = 0;
      while (rounds++ < 20) {
        const list = await reload();
        // Pakje: in volgorde; een opdracht van een verslag waarvan een eerdere opdracht mislukt staat, wacht.
        const blocked = new Set<string>();
        const batch: QueuedOp[] = [];
        let photos = 0;
        for (const q of list) {
          if (q.state === "failed") {
            blocked.add(q.clientKey);
            continue;
          }
          if (blocked.has(q.clientKey)) continue;
          if (q.file) {
            if (photos >= PHOTOS_PER_BATCH) break;
            photos++;
          }
          batch.push(q);
          if (batch.length >= BATCH) break;
        }
        if (batch.length === 0) break;
        let results: OpResult[];
        try {
          const input = [];
          for (const q of batch) input.push({ opId: q.opId, clientKey: q.clientKey, op: await materialize(q) });
          results = await (await actor()).reportSync(input);
        } catch (e) {
          if (isNetwork(e)) {
            setOnline(false);
            return;
          }
          // De hele oproep geweigerd (bv. geen schrijfrecht meer): elke opdracht krijgt een poging erbij.
          const why = errText(e);
          for (const q of batch) await bump(q, why);
          continue;
        }
        setOnline(true);
        const byId = new Map(results.map((r) => [r.opId, r]));
        for (const q of batch) {
          const r = byId.get(q.opId);
          if (!r) continue;
          if (r.outcome.__kind__ === "done") {
            const note = r.outcome.done.note;
            if (q.kind === "ensure") {
              const d = await idb.get<DraftRec>("drafts", draftKey(q.workId, q.day));
              if (d) await idb.put("drafts", draftKey(q.workId, q.day), { ...d, reportId: r.outcome.done.reportId });
            }
            if (note === "samengevoegd") notice.current?.({ clientKey: q.clientKey, text: "Er was al een verslag van deze werf vandaag: je aanvullingen staan erbij." });
            if (note === "correctie" && q.kind !== "ensure") notice.current?.({ clientKey: q.clientKey, text: "Het verslag was intussen afgesloten: je aanvullingen staan in een correctie." });
            await idb.del("outbox", q.opId);
            await idb.del("blobs", q.opId).catch(() => {});
          } else {
            await bump(q, r.outcome.err);
          }
        }
        setSyncedAt(Date.now());
        void qc.invalidateQueries({ predicate: (x) => ["myDay", "reportDay", "reports", "issues", "plan"].includes(String(x.queryKey[0])) });
      }
    } finally {
      busy.current = false;
      setSyncing(false);
      await reload().catch(() => {});
    }

    async function bump(q: QueuedOp, why: string) {
      // "eerst openen" volgt uit een mislukte opening van hetzelfde verslag: telt niet apart.
      const tries = /eerst openen/.test(why) ? q.tries : q.tries + 1;
      await idb.put("outbox", q.opId, { ...q, tries, error: why, state: tries >= MAX_TRIES ? "failed" : "pending" });
    }
  }, [ready, reload, materialize, actor, qc]);

  // Verzenden bij elke wijziging van bereik, bij terugkeer naar de app en elke 20 s zolang er iets wacht.
  useEffect(() => {
    const on = () => {
      setOnline(true);
      void sync();
    };
    const off = () => setOnline(false);
    const vis = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [sync]);

  const waiting = ops.filter((o) => o.state === "pending").length;
  useEffect(() => {
    if (!ready) return;
    if (waiting > 0) void sync();
    const t = setInterval(() => {
      if (waiting > 0) void sync();
    }, 20_000);
    return () => clearInterval(t);
  }, [ready, waiting, sync]);

  const enqueue = useCallback(
    async (o: NewOp): Promise<string> => {
      const opId = uuid();
      const q: QueuedOp = {
        opId,
        seq: nextSeq(),
        clientKey: o.clientKey,
        workId: o.workId,
        day: o.day,
        kind: o.op.__kind__,
        label: o.label,
        payload: o.op,
        file: o.file ? { name: o.file.name, mime: o.file.mime } : undefined,
        thumb: o.thumb ? { name: o.thumb.name, mime: o.thumb.mime } : undefined,
        state: "pending",
        tries: 0,
        createdAt: Date.now(),
      };
      // Grens (§8.5): geen stille groei van de lokale opslag.
      if (ops.length >= 200) throw new Error("Er wachten al 200 wijzigingen op verbinding: zoek eerst bereik");
      if (o.file) await idb.put("blobs", opId, { full: o.file.blob, thumb: o.thumb?.blob } satisfies BlobRec);
      await idb.put("outbox", opId, q);
      await reload();
      setTimeout(() => void sync(), 50);
      return opId;
    },
    [ops.length, reload, sync],
  );

  const patch = useCallback(
    async (opId: string, payload: ReportOp, label?: string) => {
      const q = await idb.get<QueuedOp>("outbox", opId);
      if (!q || busy.current) return false;
      await idb.put("outbox", opId, { ...q, payload, label: label ?? q.label });
      await reload();
      return true;
    },
    [reload],
  );

  const discard = useCallback(
    async (opId: string) => {
      await idb.del("outbox", opId);
      await idb.del("blobs", opId).catch(() => {});
      await reload();
    },
    [reload],
  );

  const retry = useCallback(
    async (opId: string) => {
      const q = await idb.get<QueuedOp>("outbox", opId);
      if (q) await idb.put("outbox", opId, { ...q, state: "pending", tries: 0, error: undefined });
      await reload();
      void sync();
    },
    [reload, sync],
  );

  const blobUrl = useCallback(async (opId: string, which: "full" | "thumb") => {
    const rec = await idb.get<BlobRec>("blobs", opId);
    const b = which === "thumb" ? rec?.thumb ?? rec?.full : rec?.full;
    return b ? URL.createObjectURL(b) : undefined;
  }, []);

  const clientKeyFor = useCallback(async (workId: bigint, day: bigint) => {
    const k = draftKey(workId, day);
    const d = await idb.get<DraftRec>("drafts", k);
    if (d) return d.clientKey;
    const clientKey = uuid();
    await idb.put("drafts", k, { clientKey, workId, day, createdAt: Date.now() } satisfies DraftRec);
    return clientKey;
  }, []);

  const ensureReport = useCallback(
    async (workId: bigint, day: bigint, label: string) => {
      const clientKey = await clientKeyFor(workId, day);
      const k = draftKey(workId, day);
      const d = await idb.get<DraftRec>("drafts", k);
      if (d && !d.ensured) {
        await idb.put("drafts", k, { ...d, ensured: true });
        await enqueue({ clientKey, workId, day, label, op: { __kind__: "ensure", ensure: { workId, day } } });
      }
      return clientKey;
    },
    [clientKeyFor, enqueue],
  );

  const wipe = useCallback(async () => {
    await idb.wipe();
    setOps([]);
    setReady(false);
  }, []);

  const api = useMemo<OutboxApi>(
    () => ({ ready, online, syncing, syncedAt, ops, pending: waiting, failed: ops.filter((o) => o.state === "failed"), enqueue, patch, discard, retry, sync, blobUrl, clientKeyFor, ensureReport, wipe }),
    [ready, online, syncing, syncedAt, ops, waiting, enqueue, patch, discard, retry, sync, blobUrl, clientKeyFor, ensureReport, wipe],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

type DraftRec = { clientKey: string; workId: bigint; day: bigint; createdAt: number; reportId?: bigint; ensured?: boolean };
const draftKey = (w: bigint, d: bigint) => `${w}:${d}`;
