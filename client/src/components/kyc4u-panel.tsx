import { useEffect, useMemo, useRef, useState } from "react";
import { Kyc4uArchiveCard } from "@/components/kyc4u-archive-card";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, ExternalLink, Bookmark, Upload } from "lucide-react";
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
function txt(el){return (el.textContent||'').replace(/\\s+/g,' ').trim();}
function pageGrid(){var grids=[].slice.call(document.querySelectorAll('table,[role=grid]'));var items=[];grids.forEach(function(g,gi){var isT=g.tagName==='TABLE';var hs=[].slice.call(g.querySelectorAll(isT?'th':'[role=columnheader]')).map(txt);if(!hs.some(function(h){return /status/i.test(h);}))return;var rows=[].slice.call(g.querySelectorAll(isT?'tr':'[role=row]'));rows.forEach(function(r,ri){var cs=[].slice.call(r.querySelectorAll(isT?'td':'[role=gridcell],[role=rowheader]'));if(cs.length<2)return;var f={};cs.forEach(function(c,ci){f[hs[ci]||('Column '+(ci+1))]=txt(c).slice(0,300);});var m=txt(r).match(/REQ[- ]?\\d+/i);var a=r.querySelector('a[href]');items.push({id:m?m[0].toUpperCase().replace(/[- ]/,''):('row-'+gi+'-'+ri),fields:f,created:null,modified:null,url:a?a.href:location.href});});});diag.page={url:location.href,rows:items.length};return items.length?{id:'page:'+location.pathname,name:(document.title||'KYC4U status page').slice(0,120),items:items}:null;}
get(web+"/_api/web/webs?$select=Url").then(function(d){(d.value||[]).forEach(function(x){addWeb(x.Url);});}).catch(function(){}).then(function(){
return Promise.all(webs.map(function(u){var info={url:u,lists:[]};diag.webs.push(info);
return get(u+"/_api/web/lists?$filter=Hidden eq false&$select=Id,Title,ItemCount,BaseType,BaseTemplate,DefaultViewUrl").then(function(d){
var ls=(d.value||[]);info.lists=ls.map(function(l){return{title:l.Title,count:l.ItemCount,type:l.BaseType,template:l.BaseTemplate};});
ls=ls.filter(function(l){return l.ItemCount>0&&(l.BaseType===0||(l.BaseType===1&&l.BaseTemplate!==119&&!SYS.test(l.Title)));});
return Promise.all(ls.map(function(l){var lib=l.BaseType===1;return all(u+"/_api/web/lists(guid'"+l.Id+"')/items?$top=500"+(lib?"&$select=Id,Title,FileLeafRef,FileRef,FileDirRef,FSObjType,Created,Modified":""),[]).then(function(its){return{id:l.Id,name:l.Title,library:lib,web:u,items:its.map(function(i){var f={};for(var k in i){if(k.indexOf('odata')<0&&(i[k]===null||typeof i[k]!=='object'))f[k]=i[k];}return{id:String(i.Id),fields:f,created:i.Created,modified:i.Modified,url:location.origin+(lib&&i.FileRef?i.FileRef:(l.DefaultViewUrl||''))};})};}).catch(function(e){info.error=e.message;return null;});}));
}).catch(function(e){info.error=e.message;return [];});}));
}).then(function(per){var lists=[].concat.apply([],per).filter(Boolean);var pg=pageGrid();if(pg)lists.push(pg);var sent=false;window.addEventListener('message',function(e){if(e.origin===APP&&e.data&&e.data.type==='kyc4u-ready'&&!sent){sent=true;w.postMessage({type:'kyc4u-data',v:2,lists:lists,site:web,diag:diag},APP);}});
var libs=lists.filter(function(l){return l.library&&l.web;});
function afiles(){var S="$select=Id,UniqueId,FileRef,FileLeafRef,FSObjType,Modified,Created,File_x0020_Size";var S0="$select=Id,FileRef,FileLeafRef,FSObjType,Modified,Created";
return Promise.all(libs.map(function(l){var b=l.web+"/_api/web/lists(guid'"+l.id+"')/items?$top=500&";return all(b+S,[]).catch(function(){return all(b+S0,[]);}).then(function(its){return its.filter(function(i){return Number(i.FSObjType)===0&&i.FileRef;}).map(function(i){var sz=i.File_x0020_Size;return{uniqueId:i.UniqueId||null,path:i.FileRef,name:i.FileLeafRef||String(i.FileRef).split('/').pop(),web:l.web,modified:i.Modified||null,created:i.Created||null,size:(sz===undefined||sz===null||sz==='')?null:Number(sz)};});}).catch(function(){return [];});})).then(function(per){return [].concat.apply([],per);});}
function abytes(f){var p=String(f.path||'').replace(/'/g,"''");var u=String(f.web||web)+"/_api/web/GetFileByServerRelativePath(decodedurl='"+encodeURIComponent(p)+"')/$value";
return fetch(u,{credentials:'include'}).then(function(r){return r.ok?r:fetch(location.origin+encodeURI(String(f.path||''))+'?download=1',{credentials:'include'});}).then(function(r){if(!r.ok)throw new Error('KYC4U answered '+r.status);var t=r.headers.get('content-type')||'';return r.arrayBuffer().then(function(b){return{b:b,t:t};});});}
window.addEventListener('message',function(e){if(e.origin!==APP||e.source!==w||!e.data)return;var d=e.data;
if(d.type==='kyc4u-archive-list'){afiles().then(function(fs){w.postMessage({type:'kyc4u-archive-files',files:fs},APP);}).catch(function(err){w.postMessage({type:'kyc4u-archive-files',files:[],error:String(err&&err.message||err)},APP);});}
if(d.type==='kyc4u-archive-get'){var f=d.file||{};var max=Number(d.max)||26214400;abytes(f).then(function(x){var nm=String(f.name||'').toLowerCase();if(x.t.toLowerCase().indexOf('text/html')>=0&&!/[.]html?$/.test(nm))throw new Error('KYC4U sent a web page, not the file');if(x.b.byteLength>max){w.postMessage({type:'kyc4u-archive-bytes',key:f.key,error:'too_large',size:x.b.byteLength},APP);return;}w.postMessage({type:'kyc4u-archive-bytes',key:f.key,mime:x.t,size:x.b.byteLength,bytes:x.b},APP,[x.b]);}).catch(function(err){w.postMessage({type:'kyc4u-archive-bytes',key:f.key,error:String(err&&err.message||err)},APP);});}
});
}).catch(function(e){alert('ChatBGP could not read KYC4U: '+e.message);});})();`;
  return `javascript:${encodeURIComponent(code.replace(/\n/g, ""))}`;
}

interface Kyc4uStatus {
  lastImport?: { at: string; source: string; items: number; matched: number } | null;
  connected: boolean; username: string | null; connectedAt: string | null; lastSyncAt: string | null; lastError: string | null;
  lastDocuments?: { copied: number; already: number; tooLarge: number; unmatched: number; failed: number; folders: number } | null;
  connectable?: boolean;
  site: string; requests: number; matched: number;
}
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

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/kyc4u/status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/kyc4u/requests"] });
  };

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
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">KYC4U: past checks</p>
        <p className="text-sm mt-1" data-testid="kyc4u-retired">KYC4U is no longer used (since 23 November 2026). Enhanced checks are done by BGP's Nominated Officer and Deputies. KYC4U's past checks and every file copied from their site are kept here as records, and still count on each party.</p>
        <p className="text-sm mt-1">
          {status.lastImport ? <>Last sent {when(status.lastImport.at)} · </> : <>Nothing sent from KYC4U yet · </>}
          <span className="tabular-nums">{status.requests}</span> requests, <span className="tabular-nums">{status.matched}</span> matched to CRM
        </p>
        <a href={status.site} target="_blank" rel="noopener" className="text-xs text-primary inline-flex items-center gap-1 mt-1">KYC4U site <ExternalLink className="w-3 h-3" /></a>
      </section>

      {isAdmin && (
        <section className="rounded-xl border bg-card p-4" data-testid="kyc4u-bookmark">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Copy KYC4U's records into the app</p>
          <p className="text-sm mt-1">While BGP can still sign in to KYC4U's site, run the bookmark once more to bring across their latest statuses and any file the app does not hold yet. It uses your own login and only reads.</p>
          <ol className="text-sm mt-2 space-y-1 list-decimal pl-5">
            <li>Drag this button to your browser's bookmarks bar: <a ref={bookmarkRef} className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs font-semibold cursor-grab no-underline" onClick={(e) => { e.preventDefault(); toast({ title: "Drag it to your bookmarks bar", description: "Then click it while you're on KYC4U's site." }); }} data-testid="link-kyc4u-bookmarklet"><Bookmark className="w-3 h-3" />Send to ChatBGP</a></li>
            <li>Open the <a href={status.site} target="_blank" rel="noopener" className="text-primary underline-offset-2 hover:underline">KYC4U site</a> and sign in as usual.</li>
            <li>Click <strong>Send to ChatBGP</strong> in your bookmarks bar. A small window brings across the requests, then copies every file on KYC4U's site that the app does not hold yet. Keep it and KYC4U's tab open until it finishes; clicking again carries on.</li>
          </ol>
          <p className="text-xs text-muted-foreground mt-2">The bookmark changed on 21 November 2026 to copy KYC4U's files: drag it to your bookmarks bar again, in place of the old one.</p>
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t">
            <span className="text-xs text-muted-foreground">Or upload an export of the grid (CSV or Excel):</span>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadExport(f); }} />
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}Upload export</Button>
            {status.lastImport && <span className="text-xs text-muted-foreground">Last import {when(status.lastImport.at)} · {status.lastImport.items} requests via {status.lastImport.source === "bookmark" ? "the bookmark" : "upload"}</span>}
          </div>
        </section>
      )}

      {isAdmin && <Kyc4uArchiveCard />}

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


// KYC4U's past verdicts on the company (KYC4U is no longer used since
// 23 November 2026; its checks stay on record). This only reports what their
// grid said and links to their record. Renders nothing when they held no
// request for the company (or for client logins: the server returns none).
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
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isAdmin = !!me?.isAdmin;
  const requests = data?.requests || [];
  if (!requests.length && !isAdmin) return null;
  return (
    <div data-testid="kyc4u-status-strip">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center justify-between gap-2">
        <span>KYC4U's past checks</span>
        {data?.lastSyncAt && <span className="normal-case tracking-normal">synced {when(data.lastSyncAt)}</span>}
      </div>
      {!requests.length && <p className="text-sm text-muted-foreground">KYC4U held no check on this company. KYC4U is no longer used.</p>}
      <ul className="space-y-1">
        {requests.slice(0, 4).map(r => (
          <li key={`${r.listId}:${r.itemId}`} className="flex items-start gap-2 text-sm">
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${kyc4uTone(r.status)}`}>{r.status || "No status"}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate" title={r.entityName || r.title || ""}>{r.entityName || r.title || "Request"}</span>
              {r.modifiedAt && <span className="block text-xs text-muted-foreground">{r.listId === "manual" ? "Recorded in the app" : "Updated"} {when(r.modifiedAt)}</span>}
            </span>
            {r.webUrl && <a href={r.webUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-primary hover:underline">Open</a>}
          </li>
        ))}
      </ul>
      {requests.length > 4 && <p className="text-xs text-muted-foreground mt-1">+{requests.length - 4} more on the KYC hub</p>}
      {isAdmin && <Kyc4uSignoffButton companyId={companyId} />}
    </div>
  );
}

function Kyc4uSignoffButton({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/kyc4u/company/${companyId}/signoff`, { date, note })).json(),
    onSuccess: () => {
      setOpen(false); setNote("");
      queryClient.invalidateQueries();
      toast({ title: "KYC4U's past sign-off recorded", description: "Approved by KYC4U: the company's transactions update now." });
    },
    onError: (e: any) => toast({ title: "Couldn't record it", description: e?.message, variant: "destructive" }),
  });
  return (
    <>
      <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => setOpen(true)} data-testid="button-kyc4u-signoff">Record a past KYC4U sign-off</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record a past KYC4U sign-off</DialogTitle>
            <DialogDescription>When KYC4U signed it off by email before 23 November 2026 and it isn't on their status page.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-sm">Signed off on<Input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-1" /></label>
            <label className="block text-sm">Note<Input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. KYC4U email from Parul, 6 Oct" className="mt-1" /></label>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="rounded-full" onClick={() => save.mutate()} disabled={save.isPending || !date}>{save.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Record sign-off</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
