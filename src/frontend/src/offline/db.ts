// IndexedDB op de gsm (architectuur §8.2): één databank per principal, gewist bij uitloggen (§8.5).
//   outbox  opdrachten voor de backend, in volgorde (seq), met opId en clientKey
//   blobs   verkleinde foto's die nog niet opgeladen zijn (+ de verwijzing zodra de upload lukte)
//   cache   laatste antwoorden (Vandaag, verslag van de dag), met tijdstempel — enkel interne data, nooit vertrouwelijk
//   drafts  per toestel de clientKey van het verslag van (werf, dag)
// Geen eigen versleuteling: het toestelslot en de II-sessie zijn de grendel (§8.5, T5).

export type Store = "outbox" | "blobs" | "cache" | "drafts";
const STORES: Store[] = ["outbox", "blobs", "cache", "drafts"];
const PREFIX = "bowaco-";

let current: { name: string; db: Promise<IDBDatabase> } | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, err) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => err(r.error);
  });
}

/** Open (of maak) de databank van deze principal. Chrome-test 2.2: een open verbinding in een ander venster (een tweede
 *  tab, het voorbeeldvenster van Caffeine) hield een verwijdering (§8.5, wissel van login) tegen, waarna elk volgend openen
 *  bleef wachten en de app op "Even laden…" bleef staan. Nu sluit een verbinding zichzelf zodra een ander venster de
 *  databank wil verwijderen of upgraden, en geeft openen na 5 s op: de app werkt dan online, zonder lokale opslag. */
export function openDb(principal: string): Promise<IDBDatabase> {
  const name = PREFIX + principal;
  if (current?.name === name) return current.db;
  const db = new Promise<IDBDatabase>((ok, err) => {
    const timer = setTimeout(() => err(new Error("Lokale opslag geblokkeerd: sluit andere vensters van de app en herlaad")), 5000);
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
    };
    r.onsuccess = () => {
      clearTimeout(timer);
      const d = r.result;
      d.onversionchange = () => {
        d.close();
        if (current?.name === name) current = null;
      };
      ok(d);
    };
    r.onerror = () => {
      clearTimeout(timer);
      err(r.error);
    };
  });
  current = { name, db };
  // Mislukt openen: de volgende oproep probeert opnieuw.
  db.catch(() => {
    if (current?.db === db) current = null;
  });
  return db;
}

function db(): Promise<IDBDatabase> {
  if (!current) return Promise.reject(new Error("Geen lokale opslag (niet ingelogd)"));
  return current.db;
}

export async function get<T>(store: Store, key: string): Promise<T | undefined> {
  const d = await db();
  return req<T | undefined>(d.transaction(store).objectStore(store).get(key));
}

export async function put(store: Store, key: string, value: unknown): Promise<void> {
  const d = await db();
  const tx = d.transaction(store, "readwrite");
  tx.objectStore(store).put(value, key);
  await new Promise<void>((ok, err) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => err(tx.error);
    tx.onabort = () => err(tx.error ?? new Error("opslag afgebroken"));
  });
}

export async function del(store: Store, key: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  await new Promise<void>((ok, err) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => err(tx.error);
  });
}

export async function all<T>(store: Store): Promise<T[]> {
  const d = await db();
  return req<T[]>(d.transaction(store).objectStore(store).getAll());
}

/** Alles van deze principal weg (uitloggen, andere principal). */
export async function wipe(): Promise<void> {
  if (!current) return;
  const name = current.name;
  try {
    (await current.db).close();
  } catch {
    /* al dicht */
  }
  current = null;
  await new Promise<void>((ok) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = r.onerror = r.onblocked = () => ok();
  });
}

/** Databanken van andere principals op dit toestel (na een wissel van login): weg (§8.5). */
export async function wipeOthers(principal: string): Promise<void> {
  const list = (indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }).databases;
  if (!list) return;
  try {
    for (const d of await list.call(indexedDB)) {
      if (d.name?.startsWith(PREFIX) && d.name !== PREFIX + principal) indexedDB.deleteDatabase(d.name);
    }
  } catch {
    /* niet ondersteund */
  }
}

// ── Cache van laatste antwoorden ("stand van 07:42") ──
export type Cached<T> = { at: number; value: T };

export async function cacheGet<T>(key: string): Promise<Cached<T> | undefined> {
  try {
    return await get<Cached<T>>("cache", key);
  } catch {
    return undefined;
  }
}

export async function cachePut(key: string, value: unknown): Promise<void> {
  try {
    await put("cache", key, { at: Date.now(), value });
  } catch {
    /* geen opslag: de app werkt dan enkel online */
  }
}
