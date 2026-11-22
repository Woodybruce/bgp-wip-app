import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { KYC4U_ARCHIVE_PARALLEL } from "@shared/kyc4u-archive";

// Opened by the "Send to ChatBGP" bookmark on KYC4U's SharePoint. The
// bookmark reads the request lists in the user's own browser session (their
// guest access — no app sign-in to KYC4U's tenant) and hands them over here
// by postMessage; this page files them into AML Compliance.
const ALLOWED = /^https:\/\/kyc4ultd\.sharepoint\.com$/i;
const KYC4U_ORIGIN = "https://kyc4ultd.sharepoint.com";

// Every file on KYC4U's site, kept in the app (Woody, 21 November 2026: "yes
// build it so we keep all documents in the app"). After the requests are
// saved, the bookmark (version 2 or later) lists the files in KYC4U's library;
// the app answers which it does not hold yet, and this window asks the
// bookmark for each one in turn and hands it to the app.
interface CopyState {
  phase: "idle" | "old" | "listing" | "copying" | "stopped" | "done" | "error";
  listed: number; held: number; todo: number; handled: number;
  copied: number; filed: number; tooLarge: number; failed: number;
  message?: string;
}
const NO_COPY: CopyState = { phase: "idle", listed: 0, held: 0, todo: 0, handled: 0, copied: 0, filed: 0, tooLarge: 0, failed: 0 };
const n = (v: number) => v.toLocaleString("en-GB");

async function copyKyc4uFiles(opener: Window, stop: { current: boolean }, set: (fn: (c: CopyState) => CopyState) => void): Promise<void> {
  const pending = new Map<string, (d: any) => void>();
  let listed: ((d: any) => void) | null = null;
  const onMessage = (ev: MessageEvent) => {
    if (ev.origin !== KYC4U_ORIGIN || ev.source !== opener || !ev.data) return;
    if (ev.data.type === "kyc4u-archive-files" && listed) { listed(ev.data); listed = null; }
    if (ev.data.type === "kyc4u-archive-bytes") {
      const answer = pending.get(String(ev.data.key));
      if (answer) { pending.delete(String(ev.data.key)); answer(ev.data); }
    }
  };
  window.addEventListener("message", onMessage);
  try {
    set(c => ({ ...c, phase: "listing" }));
    const list: any = await new Promise((resolve) => {
      listed = resolve;
      opener.postMessage({ type: "kyc4u-archive-list" }, KYC4U_ORIGIN);
      setTimeout(() => { if (listed) { listed = null; resolve({ files: [], error: "KYC4U's tab did not list its files in time" }); } }, 180_000);
    });
    const files = Array.isArray(list?.files) ? list.files : [];
    if (!files.length) {
      set(c => ({ ...c, phase: "error", message: list?.error || "No files came through from KYC4U's library" }));
      return;
    }
    const plan = await (await apiRequest("POST", "/api/kyc4u/archive/plan", { files })).json();
    const queue: Array<{ key: string; path: string; web: string | null; name: string; size: number | null }> = plan.toCopy || [];
    const total = queue.length;
    set(c => ({ ...c, phase: total ? "copying" : "done", listed: plan.listed || 0, held: plan.held || 0, todo: total, tooLarge: plan.tooLarge || 0 }));
    const missed = (key: string, reason: string, size?: number) =>
      apiRequest("POST", "/api/kyc4u/archive/missed", { key, reason, size }).catch(() => {});
    const worker = async () => {
      while (queue.length && !stop.current) {
        const f = queue.shift()!;
        const reply: any = await new Promise((resolve) => {
          pending.set(f.key, resolve);
          opener.postMessage({ type: "kyc4u-archive-get", file: f, max: plan.max }, KYC4U_ORIGIN);
          setTimeout(() => { if (pending.has(f.key)) { pending.delete(f.key); resolve({ error: "silent" }); } }, 120_000);
        });
        if (reply?.error === "silent") {
          stop.current = true;
          set(c => ({ ...c, message: "KYC4U's tab stopped answering. Keep it open, then click the bookmark again: it carries on where it stopped." }));
          break;
        }
        if (reply?.error) {
          await missed(f.key, reply.error === "too_large" ? "too_large" : String(reply.error), reply.size);
          set(c => reply.error === "too_large" ? { ...c, handled: c.handled + 1, tooLarge: c.tooLarge + 1 } : { ...c, handled: c.handled + 1, failed: c.failed + 1 });
          continue;
        }
        try {
          const form = new FormData();
          form.append("key", f.key);
          form.append("file", new Blob([reply.bytes], { type: reply.mime || "application/octet-stream" }), f.name || "file");
          const res = await fetch("/api/kyc4u/archive/file", { method: "POST", body: form, credentials: "include", headers: getAuthHeaders() });
          const body = await res.json().catch(() => ({}));
          if (res.ok) set(c => ({ ...c, handled: c.handled + 1, copied: c.copied + 1, filed: c.filed + (body.filed ? 1 : 0) }));
          else if (res.status === 413) { await missed(f.key, "too_large", reply.size); set(c => ({ ...c, handled: c.handled + 1, tooLarge: c.tooLarge + 1 })); }
          else { await missed(f.key, body.message || `The app answered ${res.status}`); set(c => ({ ...c, handled: c.handled + 1, failed: c.failed + 1 })); }
        } catch (e: any) {
          await missed(f.key, e?.message || "The upload failed");
          set(c => ({ ...c, handled: c.handled + 1, failed: c.failed + 1 }));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Number(plan.parallel) || KYC4U_ARCHIVE_PARALLEL) }, worker));
    set(c => ({ ...c, phase: stop.current ? "stopped" : "done" }));
  } catch (e: any) {
    set(c => ({ ...c, phase: "error", message: String(e?.message || e).replace(/^\d+:\s*/, "") }));
  } finally {
    window.removeEventListener("message", onMessage);
  }
}

export default function Kyc4uImport() {
  const [state, setState] = useState<{ phase: "waiting" | "saving" | "done" | "error"; text: string }>({ phase: "waiting", text: "Waiting for KYC4U…" });
  const [copy, setCopy] = useState<CopyState>(NO_COPY);
  const stopCopy = useRef(false);

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
        if (!next.draft) { setState({ phase: "error", text: "No KYC4U request is waiting. On the transaction, press Request KYC4U check first, then click the bookmark here again." }); return; }
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
        const canCopy = Number(e.data.v) >= 2 && !!e.source;
        setState({ phase: "done", text: `Saved ${r.items} requests · ${r.matched} matched to CRM companies.${canCopy ? "" : " You can close this window."}` });
        if (canCopy) void copyKyc4uFiles(e.source as Window, stopCopy, setCopy);
        else setCopy(c => ({ ...c, phase: "old" }));
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
  const pct = copy.phase === "done" || !copy.todo ? 100 : Math.min(100, Math.round((copy.handled / copy.todo) * 100));
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background" data-testid="kyc4u-import">
      <div className="rounded-xl border bg-card p-6 max-w-sm w-full text-center space-y-3">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{fillMode ? "ChatBGP → KYC4U form" : "KYC4U → ChatBGP"}</p>
        <Icon className={`w-8 h-8 mx-auto ${state.phase === "done" ? "text-emerald-600" : state.phase === "error" ? "text-destructive" : "animate-spin text-muted-foreground"}`} />
        <p className="text-sm">{state.text}</p>
        {!fillMode && copy.phase !== "idle" && (
          <div className="border-t pt-3 text-left space-y-2 text-sm" data-testid="kyc4u-copy">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground text-center">KYC4U's files</p>
            {copy.phase === "old" && (
              <p className="text-xs text-muted-foreground" data-testid="kyc4u-copy-old">To keep KYC4U's files in the app too, drag the new Send to ChatBGP bookmark from Subscriptions &amp; APIs → KYC4U onto your bookmarks bar (in place of this one), then click it again on KYC4U's site.</p>
            )}
            {copy.phase === "listing" && <p className="flex items-center gap-2 text-xs"><Loader2 className="w-3.5 h-3.5 animate-spin" />Listing the files on KYC4U's site…</p>}
            {(copy.phase === "copying" || copy.phase === "stopped" || copy.phase === "done") && (
              <>
                <p className="text-xs" data-testid="kyc4u-copy-counts">
                  {n(copy.listed)} files on KYC4U's site · {n(copy.held)} already in the app{copy.todo ? ` · ${n(copy.todo)} to copy` : ""}
                </p>
                {copy.todo > 0 && (
                  <div className="h-2 rounded-full bg-muted overflow-hidden" aria-label="Copied so far">
                    <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                )}
                <p className="text-xs text-muted-foreground" data-testid="kyc4u-copy-progress">
                  {n(copy.copied)} copied · {n(copy.filed)} filed on companies · {n(copy.copied - copy.filed)} kept to match later
                  {copy.tooLarge ? ` · ${n(copy.tooLarge)} too large` : ""}{copy.failed ? ` · ${n(copy.failed)} failed` : ""}
                </p>
              </>
            )}
            {copy.phase === "copying" && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Keep this window and KYC4U's tab open until it finishes. If either closes, click the bookmark again: it carries on.</p>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs shrink-0" onClick={() => { stopCopy.current = true; }} data-testid="kyc4u-copy-stop">Stop</Button>
              </div>
            )}
            {copy.phase === "stopped" && <p className="text-xs text-muted-foreground">Stopped. Click the bookmark again on KYC4U's site to carry on.</p>}
            {copy.phase === "done" && (
              <p className="text-xs text-emerald-700 dark:text-emerald-400" data-testid="kyc4u-copy-done">
                {copy.tooLarge || copy.failed
                  ? `Done. The files not copied are listed in Subscriptions & APIs → KYC4U.`
                  : `Every file on KYC4U's site is in the app. You can close this window.`}
              </p>
            )}
            {copy.message && <p className="text-xs text-amber-800 dark:text-amber-300">{copy.message}</p>}
            {copy.phase === "error" && <p className="text-xs text-destructive" data-testid="kyc4u-copy-error">{copy.message || "The files could not be copied"}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
