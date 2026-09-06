import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { clearPersistedQueries } from "./query-persist";

// When the session has expired, EVERY api call 401s — but the persisted
// cache has already painted a real-looking app, so without this the user
// stares at a dead shell until the auth/me refetch finally lands (15s+ on
// Woody's phone, 2026-08-31, "Chat taking ages to load"). Any 401 triggers
// an immediate auth/me re-probe (NOT a hard logout — endpoints like an
// unlinked Microsoft calendar 401 while the session is fine); only a null
// probe result drops the app to the login screen, clearing the persisted
// cache so the next paint is honest. Debounced so a burst of 401s on a
// dead session probes once.
let authProbeAt = 0;
function probeAuthOn401() {
  const now = Date.now();
  if (now - authProbeAt < 5000) return;
  authProbeAt = now;
  queryClient
    .fetchQuery({
      queryKey: ["/api/auth/me"],
      queryFn: getQueryFn({ on401: "returnNull" }),
      staleTime: 0,
    })
    .then((me) => {
      if (!me) {
        try { clearPersistedQueries(); } catch {}
      }
    })
    .catch(() => {});
}

export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("bgp_auth_token");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    // Surface the server's plain message (not raw JSON) so error toasts read
    // cleanly. Client (read-only) accounts get a friendly line instead of a
    // scary "403: {"error":"Read-only access for client accounts"}".
    let msg = text;
    try { const j = JSON.parse(text); msg = j.error || j.message || text; } catch {}
    if (res.status === 403 && /read-only access for client/i.test(msg)) {
      msg = "This is a read-only view — changes are managed by your BGP team.";
    }
    if (res.status === 401 && res.url.includes("/api/") && !res.url.includes("/api/auth/")) {
      probeAuthOn401();
    }
    throw new Error(`${res.status}: ${msg}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
  };
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers: getAuthHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      // Keep the app live while several people edit at once: poll every 30s
      // (only while the tab is actually visible — refetchIntervalInBackground
      // stays false — so background tabs and expensive endpoints aren't
      // hammered), and treat data as stale after 15s so navigating, mounting
      // a board, or refocusing the window pulls a colleague's change straight
      // away instead of serving a minutes-old cache.
      refetchInterval: 30 * 1000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
      staleTime: 15 * 1000,
      // Keep unused queries in memory for a day so the persisted-cache
      // restore (query-persist.ts, maxAge 24h) has something to restore
      // into — the v5 default of 5 minutes would silently drop most of it.
      gcTime: 24 * 60 * 60 * 1000,
      retry: (failureCount, error) => {
        if (error instanceof Error) {
          const match = error.message.match(/^(\d{3}):/);
          if (match) {
            const status = parseInt(match[1], 10);
            if (status === 401 || status === 403 || status === 404) return false;
          }
        }
        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * (attemptIndex + 1), 3000),
    },
    mutations: {
      retry: false,
    },
  },
});

// Session validity doesn't change every 30 seconds — exempt auth/me from the
// live-refresh polling above. Without this the poll + per-token API rate
// limiter combine badly: a busy page burns the 200/min budget, the next
// auth/me gets 429'd, and the app dumps a logged-in user at the sign-in
// screen mid-session.
queryClient.setQueryDefaults(["/api/auth/me"], {
  refetchInterval: false,
  staleTime: 5 * 60 * 1000,
  // Always revalidate on mount (i.e. once per page load) so a persisted-cache
  // restore that disagrees with the real session self-heals: the cached value
  // still paints instantly, and the background probe corrects it. The poll
  // exemption above is untouched — this is one request per load, not per 30s.
  refetchOnMount: "always",
});

/**
 * Invalidate every cache that derives from crm_deals so an edit on the Deals
 * page, WIP report, deal detail panel, etc. propagates to all the other
 * boards in one call. Call this anywhere a deal is created, updated, or
 * deleted instead of hand-rolling individual invalidations.
 */
export function invalidateDealCaches(dealId?: string) {
  queryClient.invalidateQueries({ queryKey: ["/api/crm/deals"] });
  queryClient.invalidateQueries({ queryKey: ["/api/wip"] });
  queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] });
  queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
  // Status writes on a deal mirror to available_units + leasing_schedule_units
  // server-side. Refresh those caches too so the Letting Tracker + Leasing
  // Schedule reflect deal status changes without a manual reload.
  queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
  queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property"] });
  if (dealId) {
    queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId] });
    queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId, "timeline"] });
  }
}
