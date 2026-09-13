// Browser-side cache of computed viewer trends (PQW-100).
//
// The trend strip is derived from the whole recording, one 60 s block at a
// time — a 24 h record is 1,440 serial range reads before the last epoch is
// painted. The result is a few hundred kB of Float32Arrays that depend only on
// the recording bytes and the trend algorithm, so it is kept in IndexedDB
// keyed by (job id, spec hash, renderer version) and invalidated by
// TREND_ENGINE_VERSION. Nothing here is authoritative: a miss just recomputes.

import { TREND_ENGINE_VERSION, type ViewerTrends } from "./trends";

const DB_NAME = "pq-lab-trends";
const STORE = "trends";
/** entries kept (least recently saved evicted first) */
const MAX_ENTRIES = 24;

interface StoredTrends {
  key: string;
  version: number;
  savedAt: number;
  trends: ViewerTrends;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "key" }).createIndex("savedAt", "savedAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      // private mode, storage disabled, or no IndexedDB at all
      resolve(null);
    }
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** A complete, current-version trend set for `key`, or null. */
export async function loadCachedTrends(key: string): Promise<ViewerTrends | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const row = (await request(db.transaction(STORE).objectStore(STORE).get(key))) as StoredTrends | undefined;
    if (!row || row.version !== TREND_ENGINE_VERSION || !row.trends) return null;
    // `filled` stops short of nT on purpose: the engine never fills epochs whose
    // window would run past either end of the record. The caller only saves a
    // set whose pass over the whole record finished, so what is here is complete.
    return row.trends;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/** Store a finished trend set (call only after the full pass); trims the cache to MAX_ENTRIES. Never throws. */
export async function saveCachedTrends(key: string, trends: ViewerTrends): Promise<void> {
  if (!trends.filled) return;
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const row: StoredTrends = { key, version: TREND_ENGINE_VERSION, savedAt: Date.now(), trends };
    store.put(row);
    const keys = await request(store.index("savedAt").getAllKeys());
    for (let i = 0; i < keys.length - MAX_ENTRIES; i++) store.delete(keys[i]);
    await done(tx);
  } catch (e) {
    console.warn("[viewer] trend cache write failed:", e);
  } finally {
    db.close();
  }
}
