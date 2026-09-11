import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import type { PersistedClient, PersistQueryClientOptions } from "@tanstack/react-query-persist-client";

// Reuse last-known page data after a live auth check confirms its owner,
// then refresh in the background. Bump BUSTER when payload shapes or cache
// ownership rules change incompatibly.
export const QUERY_PERSIST_KEY = "bgp-query-cache";
const BUSTER = "bgp-q3";
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
      dehydrateOptions: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) &&
          !(query.queryKey[0] === "/api/auth/me" && !query.state.data),
      },
    }
  : null;
