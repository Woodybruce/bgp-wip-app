// Crash/lock-proof voice-note recovery.
//
// iOS suspends the WebView when the phone locks or backgrounds, which kills
// the MediaRecorder and can reload the app — losing an in-progress voice note
// that only lived in memory. To stop that, we persist each audio chunk to
// IndexedDB as it's recorded. If the recording is interrupted (lock, crash,
// reload) or its upload fails, the audio survives and can be recovered +
// transcribed on next open. On a clean, successful send we clear it.
//
// One pending recording is tracked at a time (key "current"). All ops are
// best-effort and never throw — recovery must never break recording itself.

const DB_NAME = "bgp-voice-recovery";
const STORE = "pending";
const KEY = "current";

interface Pending {
  mimeType: string;
  startedAt: number;
  chunks: Blob[];
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

/** Start a fresh pending recording, discarding any previous one. */
export async function beginRecording(mimeType: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const t = db.transaction(STORE, "readwrite");
      t.objectStore(STORE).put({ mimeType, startedAt: Date.now(), chunks: [] } as Pending, KEY);
      t.oncomplete = () => { db.close(); resolve(); };
      t.onerror = () => { db.close(); resolve(); };
    } catch { try { db.close(); } catch {} resolve(); }
  });
}

/** Append one recorded chunk to the pending recording (single transaction). */
export async function appendChunk(blob: Blob): Promise<void> {
  if (!blob || blob.size === 0) return;
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const t = db.transaction(STORE, "readwrite");
      const store = t.objectStore(STORE);
      const get = store.get(KEY);
      get.onsuccess = () => {
        const cur = get.result as Pending | undefined;
        if (cur) { cur.chunks.push(blob); store.put(cur, KEY); }
      };
      t.oncomplete = () => { db.close(); resolve(); };
      t.onerror = () => { db.close(); resolve(); };
    } catch { try { db.close(); } catch {} resolve(); }
  });
}

/** Load any pending (interrupted / un-sent) recording, assembled into a Blob.
 *  Returns null when there's nothing worth recovering. */
export async function loadPending(): Promise<{ blob: Blob; mimeType: string; durationMs: number } | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, "readonly");
      const get = t.objectStore(STORE).get(KEY);
      get.onsuccess = () => {
        const cur = get.result as Pending | undefined;
        db.close();
        if (!cur || !cur.chunks?.length) return resolve(null);
        const blob = new Blob(cur.chunks, { type: cur.mimeType || "audio/webm" });
        if (blob.size < 2000) return resolve(null); // too short to be a real note
        resolve({ blob, mimeType: cur.mimeType || "audio/webm", durationMs: Date.now() - cur.startedAt });
      };
      get.onerror = () => { db.close(); resolve(null); };
    } catch { try { db.close(); } catch {} resolve(null); }
  });
}

/** Clear the pending recording — call after a successful send. */
export async function clearPending(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const t = db.transaction(STORE, "readwrite");
      t.objectStore(STORE).delete(KEY);
      t.oncomplete = () => { db.close(); resolve(); };
      t.onerror = () => { db.close(); resolve(); };
    } catch { try { db.close(); } catch {} resolve(); }
  });
}
