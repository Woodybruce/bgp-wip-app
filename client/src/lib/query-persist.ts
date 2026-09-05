import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import type { PersistQueryClientOptions, Persister } from "@tanstack/react-query-persist-client";

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

// A restored snapshot must never count as FRESH. The snapshot carries the
// dataUpdatedAt of the fetch it captured, so a cache written seconds before a
// change restores inside the 15s staleTime and refetchOnMount then skips the
// request entirely — the board paints the PRE-change value and issues no GET
// at all, so it never corrects itself (r557: set a status, reload straight
// away, the row reads its old value while the database has the new one; a
// colleague's edit is invisible the same way). Zeroing dataUpdatedAt keeps the
// instant paint and marks every restored query stale, so each one revalidates
// once as it mounts — the "paint instantly, then refresh" the cache is for.
function alwaysRevalidateOnRestore(persister: Persister): Persister {
  return {
    ...persister,
    restoreClient: async () => {
      const client = await persister.restoreClient();
      for (const query of client?.clientState?.queries ?? []) {
        if (query?.state) query.state.dataUpdatedAt = 0;
      }
      return client;
    },
  };
}

// null when localStorage is unusable (private mode, quota lockout) — the app
// then runs exactly as before, memory-only.

export const persistOptions: Omit<PersistQueryClientOptions, "queryClient"> | null = storageAvailable()
  ? {
      persister: alwaysRevalidateOnRestore(
        createSyncStoragePersister({
          storage: window.localStorage,
          key: QUERY_PERSIST_KEY,
          throttleTime: 2000,
        }),
      ),
      maxAge: 24 * 60 * 60 * 1000,
      buster: BUSTER,
      // Never persist a logged-out auth/me probe. The login screen caches
      // auth/me=null; if the user signs in and the page reloads before the
      // next throttled flush, that null restores as FRESH (staleTime 5min),
      // so the app paints the sign-in screen with a valid session cookie and
      // never re-asks the server. A real signed-in user stays persisted for
      // the instant paint.
      dehydrateOptions: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) &&
          !(query.queryKey[0] === "/api/auth/me" && !query.state.data),
      },
    }
  : null;

export function clearPersistedQueries() {
  try {
    window.localStorage.removeItem(QUERY_PERSIST_KEY);
  } catch {}
}
