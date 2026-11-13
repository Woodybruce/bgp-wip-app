import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import type { PersistedClient, PersistQueryClientOptions } from "@tanstack/react-query-persist-client";

// Reuse last-known page data after a live auth check confirms its owner,
// then refresh in the background. Saved data is only ever read back by the
// build that saved it: the buster carries the build's id (vite.config.ts),
// so every deploy drops the saved copies once. A reply that had changed
// shape used to be restored into the new page and crash it (2026-11-13: the
// Landsec Properties page read a total the saved copy did not have, and
// "Reload page" restored the same copy). Bump BUSTER_BASE only when the
// cache ownership rules change.
declare const __BGP_BUILD__: string | undefined;
export const QUERY_PERSIST_KEY = "bgp-query-cache";
const BUSTER_BASE = "bgp-q5-per-build-20261113";
const BUSTER = `${BUSTER_BASE}:${typeof __BGP_BUILD__ === "string" ? __BGP_BUILD__ : "dev"}`;
let pendingClient: PersistedClient | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

export function clearPersistedQueries() {
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = undefined;
  pendingClient = undefined;
  try {
    window.localStorage.removeItem(QUERY_PERSIST_KEY);
  } catch {}
}

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

// The longest list that is saved with the page data (see dehydrateOptions).
const PERSIST_MAX_ROWS = 500;

// null when localStorage is unusable (private mode, quota lockout) — the app
// then runs exactly as before, memory-only.
export const persistOptions: Omit<PersistQueryClientOptions, "queryClient"> | null = storageAvailable()
  ? {
      // Own the pending write so a logout/account change can cancel it.
      // Removing localStorage alone lets a throttled old snapshot reappear.
      persister: {
        persistClient: (client) => {
          pendingClient = client;
          if (persistTimer !== undefined) return;
          persistTimer = setTimeout(() => {
            persistTimer = undefined;
            const snapshot = pendingClient;
            pendingClient = undefined;
            if (!snapshot) return;
            try { window.localStorage.setItem(QUERY_PERSIST_KEY, JSON.stringify(snapshot)); } catch {}
          }, 2000);
        },
        restoreClient: () => {
          try {
            const stored = window.localStorage.getItem(QUERY_PERSIST_KEY);
            return stored ? JSON.parse(stored) : undefined;
          } catch { return undefined; }
        },
        removeClient: clearPersistedQueries,
      },
      maxAge: 24 * 60 * 60 * 1000,
      buster: BUSTER,
      // The auth record identifies the persisted cache owner. A logged-out
      // probe is omitted; App always validates a restored identity first.
      // A firm-wide list (companies, deals, contacts) is megabytes: with one
      // in the snapshot the write went over the storage quota and failed, so
      // nothing was saved, and the page still paid about half a second to
      // build the string after every cache change. Long lists are left out;
      // they are fetched afresh when a page mounts.
      dehydrateOptions: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) &&
          query.meta?.persist !== false &&
          !(query.queryKey[0] === "/api/auth/me" && !query.state.data) &&
          !(Array.isArray(query.state.data) && query.state.data.length > PERSIST_MAX_ROWS),
      },
    }
  : null;
