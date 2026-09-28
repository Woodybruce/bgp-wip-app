import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// Opened by the "Send to ChatBGP" bookmark on KYC4U's SharePoint. The
// bookmark reads the request lists in the user's own browser session (their
// guest access — no app sign-in to KYC4U's tenant) and hands them over here
// by postMessage; this page files them into AML Compliance.
const ALLOWED = /^https:\/\/kyc4ultd\.sharepoint\.com$/i;

export default function Kyc4uImport() {
  const [state, setState] = useState<{ phase: "waiting" | "saving" | "done" | "error"; text: string }>({ phase: "waiting", text: "Waiting for KYC4U…" });

  useEffect(() => {
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
        const res = await apiRequest("POST", "/api/kyc4u/import", { lists });
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
  }, []);

  const Icon = state.phase === "done" ? CheckCircle2 : state.phase === "error" ? AlertCircle : Loader2;
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background" data-testid="kyc4u-import">
      <div className="rounded-xl border bg-card p-6 max-w-sm w-full text-center space-y-3">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">KYC4U → ChatBGP</p>
        <Icon className={`w-8 h-8 mx-auto ${state.phase === "done" ? "text-emerald-600" : state.phase === "error" ? "text-destructive" : "animate-spin text-muted-foreground"}`} />
        <p className="text-sm">{state.text}</p>
      </div>
    </div>
  );
}
