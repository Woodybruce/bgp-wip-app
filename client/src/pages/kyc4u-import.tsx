import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";

// Opened by the "Send to ChatBGP" bookmark on KYC4U's SharePoint. The
// bookmark reads the request lists in the user's own browser session (their
// guest access — no app sign-in to KYC4U's tenant) and hands them over here
// by postMessage; this page files them into AML Compliance.
const ALLOWED = /^https:\/\/kyc4ultd\.sharepoint\.com$/i;

export default function Kyc4uImport() {
  const [state, setState] = useState<{ phase: "waiting" | "saving" | "done" | "error"; text: string }>({ phase: "waiting", text: "Waiting for KYC4U…" });

  // Fill mode: the bookmark was clicked on KYC4U's Raise New Service
  // Request page. Hand it the next prepared request (and its KYC documents)
  // to fill in; the user submits the form themselves.
  const fillMode = new URLSearchParams(window.location.search).get("fill") === "1";
  useEffect(() => {
    if (!fillMode) return;
    let acked = false, timer: any = null;
    (async () => {
      try {
        const next = await (await apiRequest("GET", "/api/kyc4u/drafts/next")).json();
        if (!next.draft) { setState({ phase: "error", text: "No KYC4U request is waiting. On the deal, press Request KYC4U check first, then click the bookmark here again." }); return; }
        setState({ phase: "saving", text: `Filling KYC4U's form for ${next.draft.fields?.partyName || next.draft.company_name || "the party"}…` });
        const files: Array<{ name: string; type: string; data: ArrayBuffer }> = [];
        for (const d of next.docs || []) {
          try {
            const r = await fetch(d.file_url, { credentials: "include", headers: getAuthHeaders() });
            if (r.ok) files.push({ name: d.file_name, type: d.mime_type || "application/octet-stream", data: await r.arrayBuffer() });
          } catch {}
        }
        const send = () => { if (!acked && window.opener) window.opener.postMessage({ type: "kyc4u-fill", draft: { id: next.draft.id, fields: next.draft.fields }, files }, "https://kyc4ultd.sharepoint.com"); };
        send(); timer = setInterval(send, 700);
      } catch (e: any) { setState({ phase: "error", text: e?.message || "Couldn't load the request" }); }
    })();
    const onMessage = async (e: MessageEvent) => {
      if (!ALLOWED.test(e.origin)) return;
      if (e.data?.type === "kyc4u-fill-ack") { acked = true; clearInterval(timer); }
      if (e.data?.type === "kyc4u-filled") {
        acked = true; clearInterval(timer);
        const report = e.data.report || {};
        try { await apiRequest("POST", `/api/kyc4u/drafts/${e.data.id}/filled`, { report }); } catch {}
        const missed: string[] = report.missed || [];
        setState({ phase: "done", text: missed.length
          ? `Form filled. Please complete these by hand: ${missed.join(", ")}. Then check it and press Submit on KYC4U's page. You can close this window.`
          : "Form filled. Check it, then press Submit on KYC4U's page. You can close this window." });
      }
    };
    window.addEventListener("message", onMessage);
    return () => { clearInterval(timer); window.removeEventListener("message", onMessage); };
  }, [fillMode]);

  useEffect(() => {
    if (fillMode) return;
    let received = false;
    const ping = setInterval(() => {
      if (!received && window.opener) window.opener.postMessage({ type: "kyc4u-ready" }, "*");
    }, 500);
    const onMessage = async (e: MessageEvent) => {
      if (!ALLOWED.test(e.origin) || e.data?.type !== "kyc4u-data" || received) return;
      received = true;
      clearInterval(ping);
      const lists = Array.isArray(e.data.lists) ? e.data.lists : [];
      const count = lists.reduce((n: number, l: any) => n + (l.items?.length || 0), 0);
      setState({ phase: "saving", text: `Saving ${count} requests from ${lists.length} list${lists.length === 1 ? "" : "s"}…` });
      try {
        const res = await apiRequest("POST", "/api/kyc4u/import", { lists, site: e.data.site || null, diag: e.data.diag || null });
        const r = await res.json();
        setState({ phase: "done", text: `Saved ${r.items} requests · ${r.matched} matched to CRM companies. You can close this window.` });
      } catch (err: any) {
        setState({ phase: "error", text: err?.message || "Couldn't save the requests" });
      }
    };
    window.addEventListener("message", onMessage);
    const timeout = setTimeout(() => {
      if (!received) setState({ phase: "error", text: "Nothing arrived. Open KYC4U's site, then click the Send to ChatBGP bookmark from there." });
    }, 90_000);
    return () => { clearInterval(ping); clearTimeout(timeout); window.removeEventListener("message", onMessage); };
  }, [fillMode]);

  const Icon = state.phase === "done" ? CheckCircle2 : state.phase === "error" ? AlertCircle : Loader2;
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background" data-testid="kyc4u-import">
      <div className="rounded-xl border bg-card p-6 max-w-sm w-full text-center space-y-3">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{fillMode ? "ChatBGP → KYC4U form" : "KYC4U → ChatBGP"}</p>
        <Icon className={`w-8 h-8 mx-auto ${state.phase === "done" ? "text-emerald-600" : state.phase === "error" ? "text-destructive" : "animate-spin text-muted-foreground"}`} />
        <p className="text-sm">{state.text}</p>
      </div>
    </div>
  );
}
