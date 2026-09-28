import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, RefreshCw, ExternalLink, Plug, Unplug, Bookmark, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Runs on KYC4U's SharePoint in the user's own browser: reads the site's
// lists through SharePoint's REST API with their guest session, then hands
// them to ChatBGP's /kyc4u-import window. Opens the window first — a popup
// opened after the reads would be blocked.
function bookmarkletSource(app: string): string {
  const code = `(function(){var APP=${JSON.stringify(app)};var w=window.open(APP+'/kyc4u-import','chatbgp_kyc4u','width=520,height=560');if(!w){alert('ChatBGP: allow pop-ups for this site, then click again.');return;}
var c=window._spPageContextInfo||{};var web=c.webAbsoluteUrl||(location.origin+location.pathname.split(/\/(SitePages|Lists|_layouts|Shared%20Documents)\//i)[0]);
var H={Accept:'application/json;odata=nometadata'};
function get(u){return fetch(u,{headers:H,credentials:'include'}).then(function(r){if(!r.ok)throw new Error(r.status+' reading '+u);return r.json();});}
function all(u,acc){return get(u).then(function(d){acc=acc.concat(d.value||[]);var n=d['odata.nextLink']||d['@odata.nextLink'];return n?all(n,acc):acc;});}
get(web+"/_api/web/lists?$filter=Hidden eq false and BaseType eq 0&$select=Id,Title,ItemCount,DefaultViewUrl").then(function(d){
var ls=(d.value||[]).filter(function(l){return l.ItemCount>0;});
return Promise.all(ls.map(function(l){return all(web+"/_api/web/lists(guid'"+l.Id+"')/items?$top=500",[]).then(function(its){return{id:l.Id,name:l.Title,items:its.map(function(i){var f={};for(var k in i){if(k.indexOf('odata')<0&&(i[k]===null||typeof i[k]!=='object'))f[k]=i[k];}return{id:String(i.Id),fields:f,created:i.Created,modified:i.Modified,url:location.origin+(l.DefaultViewUrl||'')};})};});}));
}).then(function(lists){var sent=false;window.addEventListener('message',function(e){if(e.origin===APP&&e.data&&e.data.type==='kyc4u-ready'&&!sent){sent=true;w.postMessage({type:'kyc4u-data',lists:lists,site:web},APP);}});
}).catch(function(e){alert('ChatBGP could not read KYC4U: '+e.message);});})();`;
  return `javascript:${encodeURIComponent(code.replace(/\n/g, ""))}`;
}

interface Kyc4uStatus { lastImport?: { at: string; source: string; items: number; matched: number } | null; connected: boolean; username: string | null; connectedAt: string | null; lastSyncAt: string | null; lastError: string | null; site: string; requests: number; matched: number }
interface Kyc4uRequest { listId: string; itemId: string; listName: string | null; title: string | null; status: string | null; entityName: string | null; companyId: string | null; companyName: string | null; modifiedAt: string | null; webUrl: string | null }

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

// KYC4U's request grid, pulled from their SharePoint through a BGP systems
// account signed in once as a guest (Woody, 2026-09-28).
export default function Kyc4uPanel() {
  const { toast } = useToast();
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { data: status, isLoading } = useQuery<Kyc4uStatus>({ queryKey: ["/api/kyc4u/status"] });
  const { data: requests = [] } = useQuery<Kyc4uRequest[]>({ queryKey: ["/api/kyc4u/requests"], enabled: !!status?.requests });
  const [search, setSearch] = useState("");
  const bookmarkRef = useRef<HTMLAnchorElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // React won't render a javascript: href, so set it on the element.
  useEffect(() => { bookmarkRef.current?.setAttribute("href", bookmarkletSource(window.location.origin)); });
  const uploadExport = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/kyc4u/import-file", { method: "POST", body: form, headers: getAuthHeaders(), credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `Upload failed (${res.status})`);
      refresh();
      toast({ title: "KYC4U export imported", description: `${body.items} requests · ${body.matched} matched to CRM` });
    } catch (e: any) {
      toast({ title: "Import failed", description: e?.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  useEffect(() => {
    const note = new URLSearchParams(window.location.search).get("kyc4u");
    if (!note) return;
    toast(note === "connected"
      ? { title: "KYC4U connected", description: "The first sync is running — requests appear here in a minute." }
      : /has approved/.test(note)
        ? { title: "Approved", description: note }
        : { title: "KYC4U sign-in didn't finish", description: note, variant: "destructive" });
    const url = new URL(window.location.href);
    url.searchParams.delete("kyc4u");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/kyc4u/status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/kyc4u/requests"] });
  };
  const connect = useMutation({
    mutationFn: async () => (await apiRequest("GET", "/api/kyc4u/connect")).json(),
    onSuccess: (r: any) => { if (r?.authUrl) window.location.href = r.authUrl; },
    onError: (e: any) => toast({ title: "Couldn't start the sign-in", description: e?.message, variant: "destructive" }),
  });
  const sync = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/kyc4u/sync")).json(),
    onSuccess: (r: any) => { refresh(); toast({ title: "KYC4U synced", description: `${r.items} requests from ${r.lists} list${r.lists === 1 ? "" : "s"} · ${r.matched} matched to CRM` }); },
    onError: (e: any) => { refresh(); toast({ title: "Sync failed", description: e?.message, variant: "destructive" }); },
  });
  const disconnect = useMutation({
    mutationFn: () => apiRequest("POST", "/api/kyc4u/disconnect"),
    onSuccess: () => { refresh(); toast({ title: "KYC4U disconnected" }); },
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? requests.filter(r => [r.title, r.entityName, r.status, r.companyName].some(v => (v || "").toLowerCase().includes(q))) : requests;
  }, [requests, search]);
  const byStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of requests) m.set(r.status || "No status", (m.get(r.status || "No status") || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [requests]);

  if (isLoading || !status) return <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading KYC4U…</div>;
  const isAdmin = !!me?.isAdmin;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1400px]" data-testid="kyc4u-panel">
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">KYC4U requests</p>
            {status.connected ? (
              <p className="text-sm mt-1">Connected as <strong>{status.username}</strong> · last sync {when(status.lastSyncAt)} · <span className="tabular-nums">{status.requests}</span> requests, <span className="tabular-nums">{status.matched}</span> matched to CRM</p>
            ) : (
              <p className="text-sm mt-1 text-muted-foreground">Not connected. Sign in once with your BGP email (your guest access to KYC4U's SharePoint); the grid then syncs every six hours.</p>
            )}
            {status.lastError && <p className="text-xs text-destructive mt-1 break-words">Last sync error: {status.lastError}</p>}
            <a href={status.site} target="_blank" rel="noopener" className="text-xs text-primary inline-flex items-center gap-1 mt-1">KYC4U site <ExternalLink className="w-3 h-3" /></a>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 shrink-0">
              {status.connected && <Button size="sm" variant="outline" className="rounded-full" onClick={() => sync.mutate()} disabled={sync.isPending}>{sync.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}Sync now</Button>}
              <Button size="sm" className="rounded-full" onClick={() => connect.mutate()} disabled={connect.isPending} data-testid="button-kyc4u-connect"><Plug className="w-4 h-4 mr-1.5" />{status.connected ? "Reconnect" : "Connect KYC4U"}</Button>
              {status.connected && <Button size="sm" variant="ghost" className="rounded-full" onClick={() => disconnect.mutate()}><Unplug className="w-4 h-4 mr-1.5" />Disconnect</Button>}
            </div>
          )}
        </div>
        {!status.connected && isAdmin && (
          <p className="text-xs text-muted-foreground mt-3">Press Connect and sign in with your BGP email. If Microsoft says "Need admin approval", KYC4U's IT admin has to approve BGP Dashboard once for their organisation first.</p>
        )}
      </section>

      {isAdmin && (
        <section className="rounded-xl border bg-card p-4" data-testid="kyc4u-bookmark">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Send from KYC4U — no approval needed</p>
          <p className="text-sm mt-1">Uses your own login to KYC4U's site, so their admin approval isn't needed.</p>
          <ol className="text-sm mt-2 space-y-1 list-decimal pl-5">
            <li>Drag this button to your browser's bookmarks bar: <a ref={bookmarkRef} className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs font-semibold cursor-grab no-underline" onClick={(e) => { e.preventDefault(); toast({ title: "Drag it to your bookmarks bar", description: "Then click it while you're on KYC4U's site." }); }} data-testid="link-kyc4u-bookmarklet"><Bookmark className="w-3 h-3" />Send to ChatBGP</a></li>
            <li>Open the <a href={status.site} target="_blank" rel="noopener" className="text-primary underline-offset-2 hover:underline">KYC4U site</a> and sign in as usual.</li>
            <li>Click <strong>Send to ChatBGP</strong> in your bookmarks bar. A small window confirms how many requests came across.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t">
            <span className="text-xs text-muted-foreground">Or upload an export of the grid (CSV or Excel):</span>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadExport(f); }} />
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}Upload export</Button>
            {status.lastImport && <span className="text-xs text-muted-foreground">Last import {when(status.lastImport.at)} · {status.lastImport.items} requests via {status.lastImport.source === "bookmark" ? "the bookmark" : "upload"}</span>}
          </div>
        </section>
      )}

      {requests.length > 0 && (
        <section className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="flex flex-wrap gap-1.5">
              {byStatus.map(([s, n]) => <span key={s} className="text-[11px] rounded-full border px-2 py-0.5">{s} <span className="tabular-nums text-muted-foreground">{n}</span></span>)}
            </div>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search requests…" className="h-8 w-56" />
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground border-b">
                  <th className="py-1.5 pr-3 font-medium">Request</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">CRM company</th>
                  <th className="py-1.5 pr-3 font-medium">Updated</th>
                  <th className="py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={`${r.listId}-${r.itemId}`} className="border-b last:border-0">
                    <td className="py-1.5 pr-3"><span className="font-medium">{r.title || r.entityName || "Untitled"}</span>{r.entityName && r.entityName !== r.title && <span className="block text-muted-foreground">{r.entityName}</span>}</td>
                    <td className="py-1.5 pr-3">{r.status || "—"}</td>
                    <td className="py-1.5 pr-3">{r.companyId ? <Link href={`/companies/${r.companyId}`} className="text-primary hover:underline">{r.companyName}</Link> : <span className="text-muted-foreground">Not matched</span>}</td>
                    <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap text-muted-foreground">{when(r.modifiedAt)}</td>
                    <td className="py-1.5">{r.webUrl && <a href={r.webUrl} target="_blank" rel="noopener" className="text-muted-foreground hover:text-primary" aria-label="Open in KYC4U"><ExternalLink className="w-3.5 h-3.5" /></a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
