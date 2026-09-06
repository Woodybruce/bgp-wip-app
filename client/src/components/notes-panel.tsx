// Notes — free-form notes that know the CRM. Mounted on property / deal /
// brand / contact pages (staff only; the server 403s client accounts).
// Composer at the top, notes newest-first, each with AI-suggested actions
// (Accept → linked task) and a OneNote import flow for BGP users.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { StickyNote, Plus, Loader2, Sparkles, Check, Trash2, ExternalLink, Video, BookOpen } from "lucide-react";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type EntityScope = { propertyId?: string; dealId?: string; companyId?: string; contactId?: string };

function scopeQuery(scope: EntityScope): string {
  const p = new URLSearchParams();
  if (scope.propertyId) p.set("propertyId", scope.propertyId);
  if (scope.dealId) p.set("dealId", scope.dealId);
  if (scope.companyId) p.set("companyId", scope.companyId);
  if (scope.contactId) p.set("contactId", scope.contactId);
  return p.toString();
}

const SOURCE_CHIP: Record<string, { icon: any; label: string; cls: string }> = {
  onenote: { icon: BookOpen, label: "OneNote", cls: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300" },
  teams: { icon: Video, label: "Teams", cls: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
};

function noteTimeAgo(d: string): string {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function NotesPanel(scope: EntityScope) {
  const { toast } = useToast();
  const qs = scopeQuery(scope);
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("");
  const [showOneNote, setShowOneNote] = useState(false);
  const [onUrl, setOnUrl] = useState("");
  const [onSections, setOnSections] = useState<any[] | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery<{ notes: any[] }>({
    queryKey: ["/api/notes", qs],
    queryFn: async () => {
      const r = await fetch(`/api/notes?${qs}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error("Failed to load notes");
      return r.json();
    },
    staleTime: 60_000,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/notes", qs] });

  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/notes", { title: title.trim() || undefined, body: draft.trim(), ...scope })).json(),
    onSuccess: () => {
      setDraft(""); setTitle(""); invalidate();
      // action extraction runs async server-side — refetch shortly for chips
      setTimeout(invalidate, 6000);
    },
    onError: (e: any) => toast({ title: "Couldn't save note", description: e?.message, variant: "destructive" }),
  });
  const accept = useMutation({
    mutationFn: async ({ noteId, index }: { noteId: number; index: number }) =>
      (await apiRequest("POST", `/api/notes/${noteId}/actions/${index}/accept`)).json(),
    onSuccess: (j: any) => { toast({ title: "Task created", description: j.task?.title }); invalidate(); },
    onError: (e: any) => toast({ title: "Couldn't create task", description: e?.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/notes/${id}`)).json(),
    onSuccess: invalidate,
    onError: (e: any) => toast({ title: "Couldn't delete", description: e?.message, variant: "destructive" }),
  });
  const resolveOneNote = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/notes/import/onenote/resolve", { url: onUrl.trim() })).json(),
    onSuccess: (j: any) => setOnSections(j.sections || []),
    onError: (e: any) => toast({ title: "Couldn't open that notebook", description: e?.message, variant: "destructive" }),
  });
  const importPage = useMutation({
    mutationFn: async (pageId: string) => (await apiRequest("POST", "/api/notes/import/onenote/page", { pageId, ...scope })).json(),
    onSuccess: () => { toast({ title: "Page imported" }); invalidate(); setTimeout(invalidate, 6000); },
    onError: (e: any) => toast({ title: "Import failed", description: e?.message, variant: "destructive" }),
  });

  const notes = data?.notes || [];
  return (
    <Card className="overflow-hidden" data-testid="notes-panel">
      <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <StickyNote className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          Notes
          {notes.length > 0 && <Badge variant="secondary" className="text-[10px]">{notes.length}</Badge>}
        </CardTitle>
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setShowOneNote(v => !v)} data-testid="notes-onenote-toggle">
          <BookOpen className="w-3 h-3 mr-1" /> OneNote import
        </Button>
      </CardHeader>
      <CardContent className="p-3 pt-2 space-y-2.5">
        {showOneNote && (
          <div className="rounded-md border border-border bg-muted/40 p-2.5 space-y-2" data-testid="notes-onenote-import">
            <p className="text-[11px] text-muted-foreground">Paste a OneNote notebook link (right-click the notebook → Copy Link to Notebook), pick the pages to bring in.</p>
            <div className="flex gap-1.5">
              <Input value={onUrl} onChange={e => setOnUrl(e.target.value)} placeholder="https://…sharepoint.com/…/Notebook" className="h-7 text-xs" />
              <Button size="sm" variant="outline" className="h-7 text-[11px] shrink-0" onClick={() => resolveOneNote.mutate()} disabled={!onUrl.trim() || resolveOneNote.isPending}>
                {resolveOneNote.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Open"}
              </Button>
            </div>
            {onSections && (
              <div className="max-h-[220px] overflow-y-auto space-y-1.5">
                {onSections.length === 0 && <p className="text-[11px] text-muted-foreground italic">No sections found in that notebook.</p>}
                {onSections.map((s: any) => (
                  <div key={s.id}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{s.name}</p>
                    {(s.pages || []).map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 px-1.5 py-0.5 rounded hover:bg-muted/50">
                        <span className="text-xs truncate">{p.title || "Untitled"}</span>
                        <Button size="sm" variant="ghost" className="h-5 text-[10px] shrink-0" onClick={() => importPage.mutate(p.id)} disabled={importPage.isPending}>
                          Import
                        </Button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (optional)" className="h-7 text-xs" data-testid="notes-title" />
          <Textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3}
            placeholder="Type a note — meeting scribbles, viewing observations, anything. Actions get spotted automatically."
            className="text-xs" data-testid="notes-body" />
          <div className="flex justify-end">
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => create.mutate()} disabled={!draft.trim() || create.isPending} data-testid="notes-save">
              {create.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />} Save note
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : notes.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic">No notes yet — everything you write here is searchable in ChatBGP too.</p>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {notes.map((n: any) => {
              const chip = SOURCE_CHIP[n.source];
              const actions = Array.isArray(n.suggested_actions) ? n.suggested_actions : [];
              const pending = actions.filter((a: any) => !a.accepted);
              const isOpen = expanded.has(n.id);
              const bodyPreview = String(n.body || "");
              return (
                <div key={n.id} className="rounded-md border border-l-2 border-l-muted-foreground/30 px-2.5 py-2 group" data-testid={`note-${n.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-snug">{n.title}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {n.author_name || "—"} · {noteTimeAgo(n.updated_at)}
                        {chip && <Badge className={`ml-1.5 text-[9px] border-transparent ${chip.cls}`}><chip.icon className="w-2.5 h-2.5 mr-0.5" />{chip.label}</Badge>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {n.onenote_page_url && (
                        <a href={n.onenote_page_url} target="_blank" rel="noopener noreferrer" className="p-0.5 rounded hover:bg-muted" title="Open in OneNote">
                          <ExternalLink className="w-3 h-3 text-muted-foreground" />
                        </a>
                      )}
                      <button onClick={() => remove.mutate(n.id)} className="p-0.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100" title="Delete note">
                        <Trash2 className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </div>
                  </div>
                  <p className={`text-[11px] leading-snug mt-1 whitespace-pre-wrap ${isOpen ? "" : "line-clamp-3"}`}>{bodyPreview}</p>
                  {bodyPreview.length > 220 && (
                    <button className="text-[10px] text-primary hover:underline" onClick={() => setExpanded(prev => { const s = new Set(prev); s.has(n.id) ? s.delete(n.id) : s.add(n.id); return s; })}>
                      {isOpen ? "Show less" : "Show more"}
                    </button>
                  )}
                  {pending.length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {actions.map((a: any, i: number) => a.accepted ? null : (
                        <div key={i} className="flex items-center gap-1.5 rounded bg-muted/40 border border-border px-2 py-1">
                          <Sparkles className="w-3 h-3 text-primary shrink-0" />
                          <span className="text-[11px] flex-1 leading-snug">{a.title}{a.due_hint ? ` · ${a.due_hint}` : ""}</span>
                          <Button size="sm" variant="ghost" className="h-5 text-[10px] shrink-0" onClick={() => accept.mutate({ noteId: n.id, index: i })} disabled={accept.isPending} data-testid={`note-action-accept-${n.id}-${i}`}>
                            <Check className="w-3 h-3 mr-0.5" /> Add task
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
