import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvidencePlanShareAccess } from "@shared/evidence-plan-sharing";
import { EvidencePlanTransportProvider, type EvidencePlanTransport } from "@/lib/evidence-plan-transport";
import { Toaster } from "@/components/ui/toaster";
import bgpLogo from "@/assets/BGP_BlackHolder_1771853582461.png";

const PlanView = lazy(() => import("@/pages/evidence-plans").then(module => ({ default: module.PlanView })));
const ReadOnlyPlan = lazy(() => import("@/pages/evidence-plan-share"));
const loading = <p role="status" className="p-8 text-center text-sm">Loading shared plan…</p>;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

function SharedEditor({ token, access, onUnavailable }: {
  token: string; access: EvidencePlanShareAccess & { planId: string }; onUnavailable: () => void;
}) {
  const controller = useMemo(() => new AbortController(), [token]);
  const transport = useMemo<EvidencePlanTransport>(() => {
    const base = `/api/public/evidence-plans/${encodeURIComponent(token)}`;
    const map = (path: string) => {
      if (path.startsWith(`${base}/editor/`)) return path;
      if (!path.startsWith("/api/evidence-plans/") || path.includes("#")) throw new Error("This link only opens the shared evidence plan.");
      return `${base}/editor${path.slice("/api/evidence-plans".length)}`;
    };
    const checkAccess = async () => {
      try {
        const response = await fetch(`${base}/access`, {
          credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
        });
        if (!response.ok) { onUnavailable(); return; }
        const current: EvidencePlanShareAccess = await response.json();
        if (current.accessMode !== "edit" || current.planId !== access.planId) onUnavailable();
      } catch (error) { if (!controller.signal.aborted) onUnavailable(); }
    };
    const scopedFetch = async (path: string, options: RequestInit = {}) => {
      const perRequest = new AbortController();
      const abort = () => perRequest.abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      options.signal?.addEventListener("abort", abort, { once: true });
      if (controller.signal.aborted || options.signal?.aborted) perRequest.abort();
      const headers = new Headers(options.headers);
      headers.delete("authorization");
      try {
        const response = await fetch(map(path), { ...options, headers, signal: perRequest.signal,
          credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
        if ([401, 403, 404, 410].includes(response.status)) await checkAccess();
        return response;
      } catch (error) {
        if (!perRequest.signal.aborted) onUnavailable();
        throw error;
      } finally {
        controller.signal.removeEventListener("abort", abort);
        options.signal?.removeEventListener("abort", abort);
      }
    };
    return {
      external: true,
      viewerIdentity: "shared-editor",
      fetch: scopedFetch,
      request: async (method, path, data) => {
        const response = await scopedFetch(path, { method,
          ...(["GET", "HEAD"].includes(method.toUpperCase()) ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data ?? {}) }) });
        if (!response.ok) {
          const error = await response.json().catch(() => null);
          throw new Error(`${response.status}: ${typeof error?.error === "string" ? error.error : "This change could not be saved. Reload the plan and try again."}`);
        }
        return response;
      },
      url: map,
      sourceDocumentUrl: entry => entry.source_key || entry.document_url
        ? `${base}/editor/entries/${encodeURIComponent(entry.id)}/document` : null,
      originalPlanUrl: (levelId, sourceUrl) => sourceUrl ? `${base}/editor/levels/${encodeURIComponent(levelId)}/original` : null,
      tenancyImportUrl: planId => `/api/evidence-plans/${planId}/import-tenancy`,
    };
  }, [token, access.planId, controller, onUnavailable]);
  const client = useMemo(() => new QueryClient({ defaultOptions: {
    queries: {
      queryFn: async ({ queryKey, signal }) => {
        const response = await transport.fetch(queryKey.join("/"), { signal });
        if (!response.ok) throw new Error("The shared plan could not be loaded.");
        return response.json();
      },
      retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: true, refetchOnReconnect: true,
    },
    mutations: { retry: false },
  } }), [transport]);
  useEffect(() => () => { controller.abort(); void client.cancelQueries(); client.clear(); }, [controller, client]);
  return <QueryClientProvider client={client}>
    <EvidencePlanTransportProvider transport={transport}>
      <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2">
          <img src={bgpLogo} alt="Bruce Gillingham Pollard" className="h-8 w-auto" />
          <span className="text-xs text-muted-foreground">Shared editing · saved changes update the live plan</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto [&>div]:h-full">
          <Suspense fallback={loading}><PlanView planId={access.planId} /></Suspense>
        </div>
      </div>
      <Toaster />
    </EvidencePlanTransportProvider>
  </QueryClientProvider>;
}

export default function SharedEvidencePlanPage() {
  const [, params] = useRoute("/evidence-plan-share/:token");
  const token = params?.token ?? "";
  const [state, setState] = useState<{ token: string; access: EvidencePlanShareAccess | null; pending: boolean }>({ token: "", access: null, pending: true });
  const [reload, setReload] = useState(0);
  const accessGuard = useRef({ token, closed: false });
  const onUnavailable = useCallback(() => {
    if (accessGuard.current.token !== token) return;
    accessGuard.current.closed = true;
    setState(current => current.token === token ? { token, access: null, pending: false } : current);
  }, [token]);
  const access = state.token === token ? state.access : null;
  const pending = state.token !== token || state.pending;
  useEffect(() => {
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const previousViewport = viewport?.content, previousTitle = document.title;
    if (viewport) viewport.content = "width=device-width,initial-scale=1,viewport-fit=cover";
    return () => { if (viewport && previousViewport !== undefined) viewport.content = previousViewport; document.title = previousTitle; };
  }, []);
  useEffect(() => { document.title = access ? `${access.planName} — Evidence plan | BGP` : "Shared evidence plan | BGP"; }, [access?.planName]);
  useEffect(() => {
    const controller = new AbortController();
    let latest = 0, unavailable = false;
    accessGuard.current = { token, closed: false };
    setState({ token, access: null, pending: tokenPattern.test(token) });
    if (!tokenPattern.test(token)) return;
    const refresh = async () => {
      const version = ++latest;
      try {
        const response = await fetch(`/api/public/evidence-plans/${encodeURIComponent(token)}/access`, {
          credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unavailable");
        const next: EvidencePlanShareAccess = await response.json();
        if ((next.accessMode !== "edit" && next.accessMode !== "view") || typeof next.planName !== "string"
          || next.accessMode === "edit" && typeof next.planId !== "string") throw new Error("Unavailable");
        if (!controller.signal.aborted && version === latest && !unavailable && !accessGuard.current.closed) setState({ token, access: next, pending: false });
      } catch {
        if (!controller.signal.aborted && version === latest) { unavailable = true; onUnavailable(); }
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible" && !unavailable && !accessGuard.current.closed) void refresh(); };
    void refresh();
    const interval = window.setInterval(onVisible, 30_000);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      latest++; controller.abort(); window.clearInterval(interval);
      window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, reload, onUnavailable]);
  if (pending) return loading;
  if (!access) return <main className="min-h-dvh bg-background px-4 py-12 text-foreground">
    <section className="mx-auto max-w-lg rounded-xl border border-border bg-card p-8 text-center">
      <img src={bgpLogo} alt="Bruce Gillingham Pollard" className="mx-auto mb-8 h-12 w-auto" />
      <h1 className="text-2xl font-semibold">Plan unavailable</h1>
      <p role="alert" className="mt-4 text-sm text-muted-foreground">This link is unavailable or access could not be confirmed. Please retry or ask your BGP contact for a current link.</p>
      <button type="button" className="mt-6 min-h-11 rounded-md border border-border px-4 text-sm" onClick={() => setReload(value => value + 1)}>Try again</button>
    </section>
  </main>;
  if (access.accessMode === "view") return <Suspense fallback={loading}><ReadOnlyPlan /></Suspense>;
  return <SharedEditor key={token} token={token} access={access as EvidencePlanShareAccess & { planId: string }} onUnavailable={onUnavailable} />;
}
