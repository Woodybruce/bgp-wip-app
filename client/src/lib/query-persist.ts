import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";

// Persist the react-query cache to localStorage so the app paints instantly
// from last-known data on every open (then refreshes in the background) —
// instead of blank screens while ~15 requests race the mobile network
// (Woody, 2026-08-30: "consistently slow and loads blanks"). Bump BUSTER
// when a query's payload shape changes incompatibly.
export const QUERY_PERSIST_KEY = "bgp-query-cache";
const BUSTER = "bgp-q1";

function storageAvailable(): boolean {
  try {
    const k = "__bgp_probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

// null when localStorage is unusable (private mode, quota lockout) — the app
// then runs exactly as before, memory-only.
export const persistOptions: Omit<PersistQueryClientOptions, "queryClient"> | null = storageAvailable()
  ? {
      persister: createSyncStoragePersister({
        storage: window.localStorage,
        key: QUERY_PERSIST_KEY,
        throttleTime: 2000,
      }),
      maxAge: 24 * 60 * 60 * 1000,
      buster: BUSTER,
    }
  : null;

export function clearPersistedQueries() {
  try {
    window.localStorage.removeItem(QUERY_PERSIST_KEY);
  } catch {}
}
