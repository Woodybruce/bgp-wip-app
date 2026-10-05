import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, RefreshCw, ExternalLink, Plug, Unplug, Bookmark, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Runs on KYC4U's SharePoint in the user's own browser: reads the site's
// lists through SharePoint's REST API with their guest session, then hands
// them to ChatBGP's /kyc4u-import window. Opens the window first — a popup
// opened after the reads would be blocked.
function bookmarkletSource(app: string): string {
  // Reads every visible list and document library with items on this site,
  // its subsites and any site the page's links point into. When nothing has
  // items it still reports what it saw, so ChatBGP can say where to look.
  const code = `(function(){var APP=${JSON.stringify(app)};if(/Raise-New-Service-Request/i.test(location.pathname)){var fw=window.open(APP+'/kyc4u-import?fill=1','chatbgp_kyc4u','width=520,height=560');if(!fw){alert('ChatBGP: allow pop-ups for this site, then click again.');return;}
function nrm(t){return String(t||'').replace(/\\*/g,'').replace(/\\s+/g,' ').trim().toLowerCase();}
function slp(ms){return new Promise(function(r){setTimeout(r,ms);});}
function lab(text){var t=nrm(text);var els=[].slice.call(document.querySelectorAll('label,span,p,div'));for(var i=0;i<els.length;i++){var el=els[i];if(el.querySelector('input,textarea,[role=combobox]'))continue;var n=nrm(el.textContent);if(n&&n.indexOf(t)===0&&n.length<t.length+60)return el;}return null;}
function ctl(l){if(l.htmlFor){var x=document.getElementById(l.htmlFor);if(x)return x;}if(l.id){var y=document.querySelector('[aria-labelledby~="'+l.id+'"]');if(y)return y;}var b=l.parentElement;for(var u=0;u<4&&b;u++){var cs=b.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=checkbox]),textarea,[role=combobox]');if(cs.length===1)return cs[0];if(cs.length>1)break;b=b.parentElement;}return null;}
function txt(el,v){var pr=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;var d=Object.getOwnPropertyDescriptor(pr,'value');el.focus();d.set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('blur',{bubbles:true}));return el.value===v;}
function dd(el,v,rep,label){el.click();return slp(450).then(function(){var os=[].slice.call(document.querySelectorAll('[role=option]'));rep.options[label]=os.map(function(o){return (o.textContent||'').trim();}).slice(0,30);var t=nrm(v);var o=os.filter(function(x){return nrm(x.textContent)===t;})[0]||os.filter(function(x){return nrm(x.textContent).indexOf(t)===0;})[0]||os.filter(function(x){return t&&nrm(x.textContent).indexOf(t)>=0;})[0];if(o){o.click();return slp(250).then(function(){return true;});}var k={key:'Escape',code:'Escape',keyCode:27,bubbles:true};el.dispatchEvent(new KeyboardEvent('keydown',k));document.body.dispatchEvent(new KeyboardEvent('keydown',k));return slp(150).then(function(){return false;});});}
var MAP=[['partyType','Party Type'],['partyName','Party Name'],['propertyAddress','Property Address'],['requestType','Request Type'],['metFaceToFace','Have you met the party face to face'],['howLongKnown','How long have you known the party'],['instructorName','Name the individual who has instructed you'],['instructorDesignation','Designation of the above mentioned person'],['jointAgent','If joint agent provide the name'],['feeEarnerEmails','Fee Earner Email'],['clientEmails','Client Email'],['expectedCompletion','Expected Completion Date'],['note','Note']];
var REQ={partyType:1,partyName:1,propertyAddress:1,requestType:1,metFaceToFace:1,howLongKnown:1,instructorName:1,instructorDesignation:1};
function mark(el){if(el){el.style.outline='3px solid #f59e0b';el.style.outlineOffset='2px';}}
function fillAll(dr,files){var f=dr.fields||{};var rep={filled:[],missed:[],check:[],options:{}};var i=0;
function step(){if(i>=MAP.length)return Promise.resolve();var m=MAP[i++];var key=m[0],name=m[1];var v=String(f[key]||'').trim();var l=lab(name);var el=l&&ctl(l);
if(!v){if(REQ[key]){rep.missed.push(name);mark(el||l);}return step();}
if(!el){rep.missed.push(name);mark(l);return step();}
el.scrollIntoView({block:'center'});
if(el.tagName==='INPUT'||el.tagName==='TEXTAREA'){var val=v;if(key==='expectedCompletion'){var q=v.split('-');if(q.length===3)val=q[2]+'/'+q[1]+'/'+q[0];}
if(el.readOnly){el.click();rep.check.push(name);mark(el);return slp(200).then(step);}
var ok=txt(el,val);if(/Email/.test(name)){el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}));rep.check.push(name);}
(ok?rep.filled:rep.missed).push(name);if(!ok)mark(el);return slp(120).then(step);}
return dd(el,v,rep,name).then(function(ok){(ok?rep.filled:rep.missed).push(name);if(!ok)mark(el);return slp(200);}).then(step);}
return step().then(function(){if(!files.length)return;var inp=document.querySelector('input[type=file]');if(!inp){rep.missed.push('Attachments');return;}
try{var dt=new DataTransfer();files.forEach(function(x){dt.items.add(new File([x.data],x.name,{type:x.type}));});inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));rep.filled.push('Attachments ('+files.length+')');}catch(e){rep.missed.push('Attachments');}
}).then(function(){var bx=document.createElement('div');bx.style.cssText='position:fixed;right:16px;bottom:16px;z-index:999999;max-width:360px;background:#fff;color:#1c1917;border:1px solid #d6d3d1;border-radius:12px;padding:14px 16px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.18)';
bx.innerHTML='<b>ChatBGP filled the form</b><div style="margin-top:6px">Filled: '+rep.filled.length+'</div>'+(rep.missed.length?'<div style="margin-top:6px;color:#b45309">Please complete (outlined): '+rep.missed.join(', ')+'</div>':'')+(rep.check.length?'<div style="margin-top:6px">Please check: '+rep.check.join(', ')+'</div>':'')+'<div style="margin-top:8px">Check everything, then press <b>Submit</b>. ChatBGP never submits for you.</div><button style="margin-top:10px;border:1px solid #d6d3d1;border-radius:999px;padding:4px 12px;background:#fff;cursor:pointer">Close</button>';
bx.querySelector('button').onclick=function(){bx.remove();};document.body.appendChild(bx);return rep;});}
var got=false;window.addEventListener('message',function(e){if(e.origin!==APP||!e.data||e.data.type!=='kyc4u-fill'||got)return;got=true;fw.postMessage({type:'kyc4u-fill-ack'},APP);fillAll(e.data.draft||{},e.data.files||[]).then(function(rep){fw.postMessage({type:'kyc4u-filled',id:(e.data.draft||{}).id,report:rep},APP);}).catch(function(err){alert('ChatBGP could not fill the form: '+err.message);});});
return;}
var w=window.open(APP+'/kyc4u-import','chatbgp_kyc4u','width=520,height=560');if(!w){alert('ChatBGP: allow pop-ups for this site, then click again.');return;}
var c=window._spPageContextInfo||{};var cut=/\\/(SitePages|Lists|_layouts|Forms|Shared%20Documents|Shared Documents)\\//i;var web=c.webAbsoluteUrl||(location.origin+location.pathname.split(cut)[0]);
var H={Accept:'application/json;odata=nometadata'};var SYS=/^(Site Pages|Site Assets|Style Library|Form Templates|Site Collection Documents|Site Collection Images|Images|Pages)$/i;
function get(u){return fetch(u,{headers:H,credentials:'include'}).then(function(r){if(!r.ok)throw new Error(r.status+' reading '+u);return r.json();});}
function all(u,acc){return get(u).then(function(d){acc=acc.concat(d.value||[]);var n=d['odata.nextLink']||d['@odata.nextLink'];return n?all(n,acc):acc;});}
var webs=[web];function addWeb(u){u=String(u||'').replace(/\\/+$/,'');if(u&&u.indexOf(location.origin)===0&&webs.indexOf(u)<0)webs.push(u);}
var links=[].slice.call(document.querySelectorAll('a[href]')).map(function(a){return{text:(a.textContent||'').trim().slice(0,80),href:a.href};}).filter(function(l){return l.href.indexOf('javascript:')!==0;}).slice(0,80);
links.forEach(function(l){if(cut.test(l.href))addWeb(l.href.split(cut)[0]);});
var diag={webs:[],links:links};
get(web+"/_api/web/webs?$select=Url").then(function(d){(d.value||[]).forEach(function(x){addWeb(x.Url);});}).catch(function(){}).then(function(){
return Promise.all(webs.map(function(u){var info={url:u,lists:[]};diag.webs.push(info);
return get(u+"/_api/web/lists?$filter=Hidden eq false&$select=Id,Title,ItemCount,BaseType,BaseTemplate,DefaultViewUrl").then(function(d){
var ls=(d.value||[]);info.lists=ls.map(function(l){return{title:l.Title,count:l.ItemCount,type:l.BaseType,template:l.BaseTemplate};});
ls=ls.filter(function(l){return l.ItemCount>0&&(l.BaseType===0||(l.BaseType===1&&l.BaseTemplate!==119&&!SYS.test(l.Title)));});
return Promise.all(ls.map(function(l){var lib=l.BaseType===1;return all(u+"/_api/web/lists(guid'"+l.Id+"')/items?$top=500"+(lib?"&$select=Id,Title,FileLeafRef,FileRef,FileDirRef,FSObjType,Created,Modified":""),[]).then(function(its){return{id:l.Id,name:l.Title,library:lib,items:its.map(function(i){var f={};for(var k in i){if(k.indexOf('odata')<0&&(i[k]===null||typeof i[k]!=='object'))f[k]=i[k];}return{id:String(i.Id),fields:f,created:i.Created,modified:i.Modified,url:location.origin+(lib&&i.FileRef?i.FileRef:(l.DefaultViewUrl||''))};})};}).catch(function(e){info.error=e.message;return null;});}));
}).catch(function(e){info.error=e.message;return [];});}));
}).then(function(per){var lists=[].concat.apply([],per).filter(Boolean);var sent=false;window.addEventListener('message',function(e){if(e.origin===APP&&e.data&&e.data.type==='kyc4u-ready'&&!sent){sent=true;w.postMessage({type:'kyc4u-data',lists:lists,site:web,diag:diag},APP);}});
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


// KYC4U's own verdict, shown on the Compliance & KYC board and the deal KYC
// panel. KYC4U runs the checks; this only reports what their grid says and
// links to their record. Renders nothing when they hold no request for the
// company (or for client logins — the server returns an empty list).
interface Kyc4uCompanyRequest { listId: string; itemId: string; listName: string | null; title: string | null; status: string | null; entityName: string | null; modifiedAt: string | null; createdAt: string | null; webUrl: string | null }
function kyc4uTone(status: string | null): string {
  const s = (status || "").toLowerCase();
  if (/(fail|reject|declin|refer|escalat|high risk|do not)/.test(s)) return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300";
  if (/(complete|approv|pass|clear|signed off|done|verified)/.test(s)) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  if (s) return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  return "bg-muted text-muted-foreground";
}
export function Kyc4uStatusStrip({ companyId }: { companyId: string }) {
  const { data } = useQuery<{ requests: Kyc4uCompanyRequest[]; lastSyncAt: string | null }>({
    queryKey: ["/api/kyc4u/company", companyId],
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  });
  const requests = data?.requests || [];
  if (!requests.length) return null;
  return (
    <div data-testid="kyc4u-status-strip">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center justify-between gap-2">
        <span>KYC4U</span>
        {data?.lastSyncAt && <span className="normal-case tracking-normal">synced {when(data.lastSyncAt)}</span>}
      </div>
      <ul className="space-y-1">
        {requests.slice(0, 4).map(r => (
          <li key={`${r.listId}:${r.itemId}`} className="flex items-start gap-2 text-sm">
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${kyc4uTone(r.status)}`}>{r.status || "No status"}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate" title={r.entityName || r.title || ""}>{r.entityName || r.title || "Request"}</span>
              {r.modifiedAt && <span className="block text-xs text-muted-foreground">Updated {when(r.modifiedAt)}</span>}
            </span>
            {r.webUrl && <a href={r.webUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-primary hover:underline">Open</a>}
          </li>
        ))}
      </ul>
      {requests.length > 4 && <p className="text-xs text-muted-foreground mt-1">+{requests.length - 4} more on the KYC hub</p>}
    </div>
  );
}

// ── Request a KYC4U check (Woody, 2026-10-05) ───────────────────────────
// Prepares KYC4U's "Raise New Service Request" form from the deal. The
// Send to ChatBGP bookmark, clicked on that page, fills it in; the user
// checks it and presses Submit there. KYC4U's status then shows above.
const KYC4U_FORM_URL = "https://kyc4ultd.sharepoint.com/sites/customers/CST1092/SitePages/Raise-New-Service-Request.aspx";
type DraftFields = Record<string, string>;
const DRAFT_FIELDS: Array<{ key: string; label: string; required?: boolean; long?: boolean; hint?: string; type?: string }> = [
  { key: "partyType", label: "Party type", required: true, hint: "As KYC4U's dropdown words it — usually Client or Counterparty" },
  { key: "partyName", label: "Party name", required: true },
  { key: "propertyAddress", label: "Property address", required: true, long: true },
  { key: "requestType", label: "Request type", required: true, hint: "As KYC4U's dropdown words it. Leave blank to pick it on their form" },
  { key: "metFaceToFace", label: "Have you met the party face to face?", required: true },
  { key: "howLongKnown", label: "How long have you known the party?", required: true, hint: "e.g. 1 year 3 months" },
  { key: "instructorName", label: "Name the individual who has instructed you", required: true },
  { key: "instructorDesignation", label: "Their designation in the organisation", required: true },
  { key: "jointAgent", label: "Joint agent (if any)" },
  { key: "feeEarnerEmails", label: "Fee earner email(s)" },
  { key: "clientEmails", label: "Client email(s)" },
  { key: "expectedCompletion", label: "Expected completion date", type: "date" },
  { key: "note", label: "Note", long: true },
];

export function Kyc4uRequestButton({ dealId, companyId, role, partyName }: { dealId?: string; companyId: string; role?: string; partyName: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<DraftFields>({});
  const [docIds, setDocIds] = useState<string[]>([]);
  const prefill = useQuery<{ fields: DraftFields; docs: Array<{ id: string; doc_type: string; file_name: string; file_size: number | null }> }>({
    queryKey: ["/api/kyc4u/drafts/prefill", dealId, companyId, role],
    queryFn: async () => (await apiRequest("GET", `/api/kyc4u/drafts/prefill?${new URLSearchParams({ dealId: dealId || "", companyId, role: role || "" })}`)).json(),
    enabled: open,
  });
  useEffect(() => { if (open && prefill.data) { setFields(prefill.data.fields); setDocIds([]); } }, [open, prefill.data]);
  const drafts = useQuery<any[]>({
    queryKey: ["/api/kyc4u/drafts", dealId, companyId],
    queryFn: async () => (await apiRequest("GET", `/api/kyc4u/drafts?${new URLSearchParams({ ...(dealId ? { dealId } : {}), companyId })}`)).json(),
  });
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/kyc4u/drafts", { dealId, companyId, role, fields, docIds })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kyc4u/drafts", dealId, companyId] });
      setOpen(false);
      toast({ title: "Ready to send to KYC4U", description: "Open KYC4U's Raise New Service Request page and click your Send to ChatBGP bookmark. Check the form, then press Submit there." });
    },
    onError: (e: any) => toast({ title: "Couldn't prepare the request", description: e?.message, variant: "destructive" }),
  });
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => apiRequest("PATCH", `/api/kyc4u/drafts/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/kyc4u/drafts", dealId, companyId] }),
  });
  const latest = (drafts.data || []).find(d => d.status !== "cancelled");
  const missingRequired = DRAFT_FIELDS.filter(f => f.required && f.key !== "requestType" && !(fields[f.key] || "").trim()).map(f => f.label);

  return (
    <div className="space-y-1" data-testid={`kyc4u-request-${companyId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => setOpen(true)} data-testid="button-kyc4u-request">
          <Upload className="w-3.5 h-3.5 mr-1.5" />Request KYC4U check
        </Button>
        {latest?.status === "queued" && <span className="text-xs text-muted-foreground">Waiting to be filled on KYC4U's form · <a href={KYC4U_FORM_URL} target="_blank" rel="noopener noreferrer" className="underline">open the form</a> · <button type="button" className="underline" onClick={() => setStatus.mutate({ id: latest.id, status: "cancelled" })}>cancel</button></span>}
        {latest?.status === "filled" && <span className="text-xs text-muted-foreground">Filled on KYC4U's form {when(latest.filled_at)} — once submitted there, their status shows here after the next sync · <button type="button" className="underline" onClick={() => setStatus.mutate({ id: latest.id, status: "queued" })}>fill again</button></span>}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Request a KYC4U check — {partyName}</DialogTitle>
            <DialogDescription>These go into KYC4U's Raise New Service Request form. Check them here; the Send to ChatBGP bookmark fills the form on their site and you press Submit there.</DialogDescription>
          </DialogHeader>
          {prefill.isLoading ? <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Filling from the deal…</p> : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DRAFT_FIELDS.map(f => (
              <div key={f.key} className={f.long || f.key === "propertyAddress" || f.key === "note" ? "sm:col-span-2" : ""}>
                <label className="text-xs font-medium" htmlFor={`kyc4u-${f.key}`}>{f.label}{f.required ? " *" : ""}</label>
                {f.key === "metFaceToFace" ? (
                  <select id={`kyc4u-${f.key}`} className="mt-1 w-full min-h-11 rounded-md border border-input bg-background px-2 text-sm" value={fields[f.key] || ""} onChange={e => setFields(v => ({ ...v, [f.key]: e.target.value }))}>
                    <option value="">Choose…</option><option value="Yes">Yes</option><option value="No">No</option>
                  </select>
                ) : f.long ? (
                  <textarea id={`kyc4u-${f.key}`} className="mt-1 w-full min-h-20 rounded-md border border-input bg-background p-2 text-sm" value={fields[f.key] || ""} onChange={e => setFields(v => ({ ...v, [f.key]: e.target.value }))} />
                ) : (
                  <Input id={`kyc4u-${f.key}`} type={f.type || "text"} className="mt-1 min-h-11" value={fields[f.key] || ""} onChange={e => setFields(v => ({ ...v, [f.key]: e.target.value }))} />
                )}
                {f.hint && <p className="text-[11px] text-muted-foreground mt-0.5">{f.hint}</p>}
              </div>
            ))}
            {!!prefill.data?.docs?.length && <div className="sm:col-span-2">
              <p className="text-xs font-medium">Attach KYC documents (up to 10 MB each)</p>
              <div className="mt-1 space-y-1">
                {prefill.data.docs.map(d => (
                  <label key={d.id} className="flex items-center gap-2 text-sm min-h-9">
                    <input type="checkbox" checked={docIds.includes(d.id)} disabled={(d.file_size || 0) > 10 * 1024 * 1024}
                      onChange={e => setDocIds(ids => e.target.checked ? [...ids, d.id] : ids.filter(x => x !== d.id))} />
                    <span className="truncate">{d.file_name}</span><span className="text-xs text-muted-foreground shrink-0">{d.doc_type}{(d.file_size || 0) > 10 * 1024 * 1024 ? " · over 10 MB" : ""}</span>
                  </label>
                ))}
              </div>
            </div>}
          </div>}
          {missingRequired.length > 0 && <p className="text-xs text-muted-foreground">Still to fill: {missingRequired.join(", ")}. You can also complete these on KYC4U's form.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !(fields.partyName || "").trim()} data-testid="button-kyc4u-request-save">
              {save.isPending ? "Saving…" : "Ready for KYC4U"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
