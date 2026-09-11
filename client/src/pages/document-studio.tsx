// Document Studio v2 — the single hub for every BGP document.
// Three panes: library (left), visual preview (centre), actions (right).
// Generate from a deck template, see a page-image render of the real file,
// edit in PowerPoint/Word (or in app when OnlyOffice is configured), and file
// to SharePoint. Backend: server/documents.ts.

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  FileText, Plus, Upload, Download, RefreshCw, FolderUp, Presentation,
  FileSpreadsheet, FileType, ChevronRight, Loader2, Sparkles, CloudUpload, Trash2,
} from "lucide-react";

interface DocItem {
  id: string; title: string; docType: string; category: string | null;
  templateKey: string | null; deckId: string | null; project: string | null;
  fileName: string | null; status: string; version: number;
  sharepointWebUrl: string | null; sharepointPath: string | null;
  updatedAt: string; downloadUrl: string; pageCount: number; pageUrls: string[];
}
interface DeckTemplate { key: string; name: string; description: string | null; pdf_scope: string }

const TYPE_ICON: Record<string, any> = { deck: Presentation, word: FileType, sheet: FileSpreadsheet, pdf: FileText };

export default function DocumentStudio() {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [genOpen, setGenOpen] = useState(false);
  const [mirrorOpen, setMirrorOpen] = useState(false);
  const [editing, setEditing] = useState<DocItem | null>(null);

  const { data: docs = [], isLoading } = useQuery<DocItem[]>({
    queryKey: ["/api/documents"],
    refetchInterval: (q) => ((q.state.data as DocItem[] | undefined)?.some(d => ["generating", "uploading", "processing"].includes(d.status)) ? 5000 : false),
  });
  const { data: templates = [] } = useQuery<DeckTemplate[]>({ queryKey: ["/api/deck-templates"] });

  const categories = Array.from(new Set(docs.map(d => d.category).filter(Boolean))) as string[];
  const filtered = docs.filter(d => {
    if (category !== "all" && d.category !== category) return false;
    if (search.trim() && !d.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const selected = docs.find(d => d.id === selectedId) || filtered[0] || null;

  const reRender = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/documents/${id}/render`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/documents"] }),
    onError: (e: any) => toast({ title: "Re-render failed", description: e?.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/documents/${id}`)).json(),
    onSuccess: () => { setSelectedId(null); queryClient.invalidateQueries({ queryKey: ["/api/documents"] }); toast({ title: "Deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-4 border-b">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Document Studio
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every BGP document in one place — generate, preview, edit in PowerPoint/Word, file to SharePoint.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <UploadButton onDone={() => queryClient.invalidateQueries({ queryKey: ["/api/documents"] })} />
          <Button onClick={() => setGenOpen(true)} data-testid="button-new-document">
            <Plus className="w-4 h-4 mr-1" /> New document
          </Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left — library */}
        <aside className="w-72 shrink-0 border-r flex flex-col min-h-0">
          <div className="p-3 space-y-2 border-b">
            <Input placeholder="Search documents…" value={search} onChange={e => setSearch(e.target.value)} className="h-9" />
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map(c => <SelectItem key={c} value={c}>{labelFor(c, templates)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {isLoading ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)
              : !filtered.length ? (
                <div className="text-center text-muted-foreground py-10 px-3">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No documents yet</p>
                  <p className="text-xs mt-1">Generate one from a template or upload a file.</p>
                </div>
              ) : filtered.map(d => {
                const Icon = TYPE_ICON[d.docType] || FileText;
                const active = selected?.id === d.id;
                return (
                  <button key={d.id} onClick={() => setSelectedId(d.id)}
                    className={`w-full text-left rounded-lg px-3 py-2 flex items-start gap-2 transition-colors ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{d.title}</span>
                      <span className={`block text-[11px] truncate ${active ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {labelFor(d.category, templates)}{d.project ? ` · ${d.project}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })}
          </div>
        </aside>

        {/* Centre — preview */}
        <main className="flex-1 min-w-0 overflow-y-auto bg-muted/40 p-6">
          {!selected ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
              <FileText className="w-12 h-12 mb-3 opacity-20" />
              <p>Select a document, or create one to get started.</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-4">
              {selected.status === "generating" ? (
                <Card>
                  <CardContent className="py-16 text-center text-muted-foreground">
                    <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-primary" />
                    <p className="text-sm font-medium text-foreground">Assembling your document…</p>
                    <p className="text-xs mt-1">Claude is designing it — this takes a minute. It'll appear here automatically.</p>
                  </CardContent>
                </Card>
              ) : selected.status === "error" ? (
                <Card className="border-red-200">
                  <CardContent className="py-16 text-center text-muted-foreground">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm text-red-600">Generation failed</p>
                    <p className="text-xs mt-1">Try again — if it persists, the PDF renderer may be unavailable.</p>
                  </CardContent>
                </Card>
              ) : ["uploading", "processing"].includes(selected.status) ? (
                <Card>
                  <CardContent className="py-16 text-center text-muted-foreground">
                    <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-primary" />
                    <p className="text-sm font-medium text-foreground">Rendering preview…</p>
                    <p className="text-xs mt-1">Big decks take a minute or two. Pages will appear here automatically.</p>
                  </CardContent>
                </Card>
              ) : selected.pageCount === 0 ? (
                <Card>
                  <CardContent className="py-16 text-center text-muted-foreground">
                    <RefreshCw className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No preview yet</p>
                    <Button size="sm" variant="outline" className="mt-3" disabled={reRender.isPending}
                      onClick={() => reRender.mutate(selected.id)}>
                      {reRender.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                      Render preview
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                selected.pageUrls.map((url, i) => (
                  <img key={i} src={url} alt={`${selected.title} — page ${i + 1}`} loading="lazy"
                    className="w-full rounded-lg border shadow-sm bg-white" />
                ))
              )}
            </div>
          )}
        </main>

        {/* Right — actions */}
        <aside className="w-64 shrink-0 border-l p-4 space-y-4 overflow-y-auto">
          {selected ? (
            <>
              <div>
                <div className="text-muted-foreground text-[11px] uppercase tracking-widest mb-1">Document</div>
                <div className="font-semibold leading-snug">{selected.title}</div>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <Badge variant="outline" className="text-[10px]">{labelFor(selected.category, templates)}</Badge>
                  <Badge variant="secondary" className="text-[10px] uppercase">{selected.docType}</Badge>
                  <Badge variant="outline" className="text-[10px]">v{selected.version}</Badge>
                </div>
                {selected.pageCount > 0 && <div className="text-[11px] text-muted-foreground mt-1">{selected.pageCount} pages</div>}
              </div>

              <div className="space-y-2">
                <Button className="w-full justify-start" variant="default" data-testid="button-edit-inapp"
                  onClick={() => setEditing(selected)}>
                  <Sparkles className="w-4 h-4 mr-2" /> Edit in app
                </Button>
                {!isPdf(selected) && (
                  <a href={selected.downloadUrl} className="block">
                    <Button className="w-full justify-start" variant="outline" data-testid="button-edit-office">
                      <Presentation className="w-4 h-4 mr-2" /> Edit in {selected.docType === "word" ? "Word" : selected.docType === "sheet" ? "Excel" : "PowerPoint"}
                    </Button>
                  </a>
                )}
                <a href={selected.downloadUrl} className="block">
                  <Button className="w-full justify-start" variant="outline">
                    <Download className="w-4 h-4 mr-2" /> Download
                  </Button>
                </a>
                <Button className="w-full justify-start" variant="outline" disabled={reRender.isPending}
                  onClick={() => reRender.mutate(selected.id)}>
                  {reRender.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Re-render preview
                </Button>
                <Button className="w-full justify-start" variant="outline" onClick={() => setMirrorOpen(true)}>
                  <FolderUp className="w-4 h-4 mr-2" /> File to SharePoint
                </Button>
                {selected.deckId && (
                  <a href={`/decks/${selected.deckId}`} className="block">
                    <Button className="w-full justify-start" variant="ghost">
                      <Sparkles className="w-4 h-4 mr-2" /> Edit content (cards)
                    </Button>
                  </a>
                )}
                <Button className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50" variant="ghost"
                  disabled={del.isPending}
                  onClick={() => { if (confirm(`Delete "${selected.title}"? This removes it from the library (the SharePoint copy, if filed, stays).`)) del.mutate(selected.id); }}>
                  {del.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />} Delete
                </Button>
              </div>

              {selected.sharepointWebUrl && (
                <div className="text-[11px] text-muted-foreground border-t pt-3">
                  <CloudUpload className="w-3 h-3 inline mr-1 text-emerald-600" />
                  Filed: <a className="underline" href={selected.sharepointWebUrl} target="_blank" rel="noreferrer">{selected.sharepointPath}</a>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground border-t pt-3">
                <b>Edit in app</b> opens a full editor in the browser and saves straight back here.
                <b> Edit in PowerPoint/Word</b> opens the real file for heavier edits.
              </p>
            </>
          ) : <div className="text-sm text-muted-foreground">No document selected.</div>}
        </aside>
      </div>

      <GenerateDialog open={genOpen} onOpenChange={setGenOpen} templates={templates}
        onCreated={(id) => { setGenOpen(false); setSelectedId(id); queryClient.invalidateQueries({ queryKey: ["/api/documents"] }); }}
        onError={(m) => toast({ title: "Couldn't generate", description: m, variant: "destructive" })} />
      {selected && <MirrorDialog open={mirrorOpen} onOpenChange={setMirrorOpen} doc={selected}
        onDone={() => { setMirrorOpen(false); queryClient.invalidateQueries({ queryKey: ["/api/documents"] }); toast({ title: "Filed to SharePoint" }); }}
        onError={(m) => toast({ title: "Filing failed", description: m, variant: "destructive" })} />}
      {editing && <OnlyOfficeEditor doc={editing}
        onClose={() => { setEditing(null); setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/documents"] }), 1500); }} />}
    </div>
  );
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error("Couldn't load the editor"));
    document.head.appendChild(s);
  });
}

function OnlyOfficeEditor({ doc, onClose }: { doc: DocItem; onClose: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const editorRef = useRef<any>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${doc.id}/editor-config`, { credentials: "include", headers: { ...getAuthHeaders() } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Editor config failed");
        const cfg = await res.json();
        await loadScript(`${cfg.documentServerUrl}/web-apps/apps/api/documents/api.js`);
        if (cancelled) return;
        // @ts-ignore — DocsAPI injected by the OnlyOffice script
        editorRef.current = new window.DocsAPI.DocEditor("oo-editor", {
          ...cfg, width: "100%", height: "100%",
          events: { onError: (e: any) => setErr(String(e?.data || "editor error")) },
        });
      } catch (e: any) { if (!cancelled) setErr(e?.message || "Failed to open editor"); }
    })();
    return () => { cancelled = true; try { editorRef.current?.destroyEditor?.(); } catch {} };
  }, [doc.id]);
  return (
    <div className="fixed inset-0 z-50 bg-neutral-900 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 text-white shrink-0">
        <span className="font-semibold text-sm">{doc.title} — editing in app</span>
        <Button variant="secondary" size="sm" onClick={onClose}>Done</Button>
      </div>
      <div className="flex-1 bg-white min-h-0">
        {err ? <div className="p-6 text-red-600 text-sm">Couldn't open the editor: {err}</div>
          : <div id="oo-editor" className="w-full h-full" />}
      </div>
    </div>
  );
}

function isPdf(d: DocItem): boolean {
  return d.docType === "pdf" || (d.fileName?.toLowerCase().endsWith(".pdf") ?? false);
}

function labelFor(key: string | null, templates: DeckTemplate[]): string {
  if (!key) return "Other";
  const t = templates.find(t => t.key === key);
  if (t) return t.name;
  return key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function UploadButton({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <label>
      <input type="file" className="hidden" accept=".pptx,.docx,.pdf,.xlsx" disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0]; if (!file) return;
          setBusy(true);
          try {
            const fd = new FormData(); fd.append("file", file);
            const res = await fetch("/api/documents/upload", { method: "POST", body: fd, credentials: "include", headers: { ...getAuthHeaders() } });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed");
            onDone();
          } catch (err: any) { toast({ title: "Upload failed", description: err?.message, variant: "destructive" }); }
          finally { setBusy(false); e.target.value = ""; }
        }} />
      <Button asChild variant="outline"><span>{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />} Upload</span></Button>
    </label>
  );
}

interface Brief { id: string; name: string; description: string | null; category: string | null }

function GenerateDialog({ open, onOpenChange, templates, onCreated, onError }: {
  open: boolean; onOpenChange: (v: boolean) => void; templates: DeckTemplate[];
  onCreated: (id: string) => void; onError: (m: string) => void;
}) {
  const [tab, setTab] = useState<"deck" | "brief">("deck");
  const [title, setTitle] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [project, setProject] = useState("");
  const { data: briefs = [] } = useQuery<Brief[]>({ queryKey: ["/api/document-briefs"], enabled: open });
  const active = templates.find(t => t.key === templateKey) || templates[0];
  const key = templateKey || active?.key;
  const gen = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/documents/generate", { title: title.trim(), templateKey: key, project: project.trim() || undefined })).json(),
    onSuccess: (d) => { setTitle(""); setProject(""); onCreated(d.id); },
    onError: (e: any) => onError(e?.message || "Unknown error"),
  });
  const TABS: Array<{ id: typeof tab; label: string }> = [
    { id: "deck", label: "Deck templates" },
    { id: "brief", label: "AI briefs" },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New document</DialogTitle></DialogHeader>

        <div className="flex gap-1 p-0.5 rounded-lg bg-muted text-sm">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${tab === t.id ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "deck" && (
          <>
            <div className="space-y-3 py-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Title</label>
                <Input placeholder="e.g. The Broadway — Why Buy Memo" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Template</label>
                <Select value={key} onValueChange={setTemplateKey}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{templates.map(t => <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
                {active?.description && <p className="text-[11px] text-muted-foreground mt-1">{active.description}</p>}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Project (optional)</label>
                <Input placeholder="e.g. The Broadway, Wimbledon" value={project} onChange={e => setProject(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => gen.mutate()} disabled={!title.trim() || !key || gen.isPending}>
                {gen.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Generating…</> : "Generate"}
              </Button>
            </DialogFooter>
          </>
        )}

        {tab === "brief" && (
          <div className="py-2">
            <p className="text-[11px] text-muted-foreground mb-2">
              Property-scoped briefs (Why Buy, brochures, market reports) — Claude-designed, filed to SharePoint.
            </p>
            <div className="max-h-72 overflow-y-auto border rounded-lg divide-y">
              {!briefs.length ? <div className="p-4 text-center text-muted-foreground text-sm">No briefs available.</div>
                : briefs.map(b => (
                  <a key={b.id} href="/document-briefs"
                    className="block px-3 py-2.5 hover:bg-muted">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{b.name}</span>
                      {b.category && <Badge variant="outline" className="text-[10px] capitalize shrink-0">{b.category}</Badge>}
                    </div>
                    {b.description && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{b.description}</p>}
                  </a>
                ))}
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}

function MirrorDialog({ open, onOpenChange, doc, onDone, onError }: {
  open: boolean; onOpenChange: (v: boolean) => void; doc: DocItem; onDone: () => void; onError: (m: string) => void;
}) {
  const [path, setPath] = useState("BGP share drive");
  const { data: folders = [], isFetching } = useQuery<Array<{ name: string; path: string }>>({
    queryKey: [`/api/documents/sp-folders?path=${encodeURIComponent(path)}`], enabled: open,
  });
  const mirror = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/documents/${doc.id}/mirror`, { folderPath: path })).json(),
    onSuccess: (r) => { if (r?.error) return onError(r.error); onDone(); },
    onError: (e: any) => onError(e?.message || "Unknown error"),
  });
  const parts = path.split("/").filter(Boolean);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>File to SharePoint</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
            <button className="underline" onClick={() => setPath("")}>BGP</button>
            {parts.map((p, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight className="w-3 h-3" />
                <button className="underline" onClick={() => setPath(parts.slice(0, i + 1).join("/"))}>{p}</button>
              </span>
            ))}
          </div>
          <div className="border rounded-lg max-h-56 overflow-y-auto">
            {isFetching ? <div className="p-4 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 mx-auto animate-spin" /></div>
              : !folders.length ? <div className="p-4 text-center text-muted-foreground text-sm">No subfolders — file here.</div>
                : folders.map(f => (
                  <button key={f.path} onClick={() => setPath(f.path)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2 border-b last:border-0">
                    <FolderUp className="w-3.5 h-3.5 text-muted-foreground" /> {f.name}
                  </button>
                ))}
          </div>
          <p className="text-[11px] text-muted-foreground">Filing <b>{doc.fileName}</b> into <b>{path || "site root"}</b></p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mirror.mutate()} disabled={mirror.isPending}>
            {mirror.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Filing…</> : "File here"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
