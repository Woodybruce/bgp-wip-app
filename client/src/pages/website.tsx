import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ExternalLink, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, PillCount } from "@/components/ui/pill";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WebsiteCaseStudy, WebsiteNewsItem, WebsiteTeamMember } from "@shared/schema";

// Content for bgp.uk.com — the site reads these tables live (falls back to
// its bundled copy if the API is down), so edits here are public within a
// minute. ChatBGP's manage_website_content tool edits the same rows.
type Kind = "team" | "case-studies" | "news";
type Row = WebsiteTeamMember | WebsiteCaseStudy | WebsiteNewsItem;

const KINDS: { key: Kind; label: string; singular: string }[] = [
  { key: "team", label: "Team", singular: "team member" },
  { key: "case-studies", label: "Case studies", singular: "case study" },
  { key: "news", label: "News", singular: "article" },
];
const GROUPS: { key: string; label: string }[] = [
  { key: "leasing", label: "Leasing" },
  { key: "investment", label: "Investment" },
  { key: "lease_advisory", label: "Lease Advisory" },
  { key: "brand_representation", label: "Brand Representation" },
  { key: "consultancy", label: "Consultancy" },
];
const SERVICES = ["Leasing", "Investment", "Brand Representation", "Lease Advisory", "Consultancy"];
const SITE = "https://www.bgp.uk.com";
const MICRO = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

const isLive = (r: any) => (r.visible ?? r.published) !== false;
const linkFor = (kind: Kind, r: any) =>
  kind === "team" ? `${SITE}/team` : kind === "case-studies" ? `${SITE}/case-studies/${r.slug}` : `${SITE}/news/${r.slug}`;

// Text ⇄ structure helpers for the edit dialog.
const paragraphsToText = (b?: string[] | null) => (b || []).join("\n\n");
const textToParagraphs = (t: string) => t.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
const factsToText = (f: any) => (Array.isArray(f) ? f.map(([k, v]: [string, string]) => `${k}: ${v}`).join("\n") : "");
const textToFacts = (t: string) =>
  t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(":");
    return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, ""];
  });

export default function WebsitePage() {
  const [kind, setKind] = useState<Kind>("team");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<any | null>(null); // {} = new
  const { toast } = useToast();

  const { data: rows = [], isLoading } = useQuery<Row[]>({ queryKey: [`/api/website/${kind}`] });
  const counts = {
    team: useQuery<Row[]>({ queryKey: ["/api/website/team"] }).data?.length,
    "case-studies": useQuery<Row[]>({ queryKey: ["/api/website/case-studies"] }).data?.length,
    news: useQuery<Row[]>({ queryKey: ["/api/website/news"] }).data?.length,
  } as Record<Kind, number | undefined>;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [`/api/website/${kind}`] });
  const save = useMutation({
    mutationFn: async (data: any) => {
      const { id, ...body } = data;
      const res = id
        ? await apiRequest("PATCH", `/api/website/${kind}/${id}`, body)
        : await apiRequest("POST", `/api/website/${kind}`, body);
      return res.json();
    },
    onSuccess: () => { invalidate(); setEditing(null); toast({ title: "Saved", description: "Live on bgp.uk.com within a minute." }); },
    onError: (e: any) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  const toggle = useMutation({
    mutationFn: async (r: any) => {
      const field = kind === "team" ? "visible" : "published";
      const res = await apiRequest("PATCH", `/api/website/${kind}/${r.id}`, { [field]: !isLive(r) });
      return res.json();
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (r: any) => { await apiRequest("DELETE", `/api/website/${kind}/${r.id}`); },
    onSuccess: () => { invalidate(); toast({ title: "Removed from the website" }); },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows as any[]).filter((r) => !q || `${r.name || ""} ${r.title || ""} ${r.service || ""} ${r.category || ""}`.toLowerCase().includes(q));
  }, [rows, search]);
  const meta = KINDS.find((k) => k.key === kind)!;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><Globe className="h-5 w-5" /> Website</h1>
          <p className="text-sm text-muted-foreground">
            Content on bgp.uk.com — {rows.length} {meta.label.toLowerCase()}, {(rows as any[]).filter(isLive).length} live. Edits go public within a minute.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing({})} data-testid="button-add-website-item">
          <Plus className="h-4 w-4 mr-1.5" />Add {meta.singular}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <Pill key={k.key} active={kind === k.key} onClick={() => { setKind(k.key); setSearch(""); }} data-testid={`pill-website-${k.key}`}>
            {k.label} {counts[k.key] != null && <PillCount n={counts[k.key]!} active={kind === k.key} />}
          </Pill>
        ))}
      </div>

      <Input placeholder={`Search ${meta.label.toLowerCase()}…`} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" data-testid="input-website-search" />

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Nothing here yet — add the first {meta.singular}.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r: any) => (
            <Card key={r.id} className={!isLive(r) ? "opacity-60" : ""} data-testid={`website-row-${r.id}`}>
              <CardContent className="py-3 px-4 flex items-center gap-3">
                {(r.photoUrl || r.imageUrl) ? (
                  <img src={r.photoUrl || r.imageUrl} alt="" className="h-12 w-12 rounded-md object-cover shrink-0 grayscale" />
                ) : (
                  <div className="h-12 w-12 rounded-md bg-muted shrink-0 flex items-center justify-center text-xs text-muted-foreground">—</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{r.name || r.title}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {kind === "team" ? [r.title, (r.groups || []).map((g: string) => GROUPS.find((x) => x.key === g)?.label).filter(Boolean).join(", ")].filter(Boolean).join(" · ")
                      : kind === "case-studies" ? [r.service, r.blurb].filter(Boolean).join(" · ")
                      : [r.category, r.date, r.author].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className={`${MICRO} ${isLive(r) ? "text-emerald-600" : ""}`}>{isLive(r) ? "Live" : "Hidden"}</span>
                <Switch checked={isLive(r)} onCheckedChange={() => toggle.mutate(r)} aria-label="Show on website" data-testid={`switch-website-live-${r.id}`} />
                <a href={linkFor(kind, r)} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Open on bgp.uk.com"><ExternalLink className="h-4 w-4" /></a>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setEditing(r)} data-testid={`button-edit-website-${r.id}`}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => { if (confirm(`Remove "${r.name || r.title}" from the website?`)) remove.mutate(r); }} data-testid={`button-delete-website-${r.id}`}><Trash2 className="h-4 w-4" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <EditDialog kind={kind} row={editing} onClose={() => setEditing(null)} onSave={(d) => save.mutate(d)} saving={save.isPending} />
      )}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <label className={MICRO}>{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EditDialog({ kind, row, onClose, onSave, saving }: { kind: Kind; row: any; onClose: () => void; onSave: (d: any) => void; saving: boolean }) {
  const isNew = !row.id;
  const [f, setF] = useState<any>(() => ({
    ...row,
    bodyText: paragraphsToText(row.body),
    factsText: factsToText(row.facts),
    groups: row.groups || [],
  }));
  const upd = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const submit = () => {
    const { bodyText, factsText, updatedAt, updatedBy, ...rest } = f;
    const data: any = { ...rest };
    if (kind !== "team") { data.body = textToParagraphs(bodyText || ""); }
    if (kind === "case-studies") { data.facts = textToFacts(factsText || ""); }
    if (kind === "team") { data.visible = f.visible ?? true; } else { data.published = f.published ?? false; }
    onSave(data);
  };
  const title = `${isNew ? "Add" : "Edit"} ${KINDS.find((k) => k.key === kind)!.singular}`;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {kind === "team" ? (
            <>
              <Field label="Name"><Input value={f.name || ""} onChange={(e) => upd("name", e.target.value)} data-testid="input-website-name" /></Field>
              <Field label="Title"><Input value={f.title || ""} onChange={(e) => upd("title", e.target.value)} placeholder="e.g. Director, National Leasing" /></Field>
              <Field label="Phone"><Input value={f.phone || ""} onChange={(e) => upd("phone", e.target.value)} /></Field>
              <Field label="Email"><Input value={f.email || ""} onChange={(e) => upd("email", e.target.value)} /></Field>
              <div className="sm:col-span-2">
                <Field label="Photo URL" hint={`Leave blank to use the share drive: a file named "${f.name || "Firstname Surname"}.jpg" in Marketing / Team CVs & Photos / Team Photos / For website appears automatically.`}>
                  <Input value={f.photoUrl || ""} onChange={(e) => upd("photoUrl", e.target.value)} placeholder="https://…" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Key contact for">
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {GROUPS.map((g) => (
                      <Pill key={g.key} active={f.groups.includes(g.key)} onClick={() => upd("groups", f.groups.includes(g.key) ? f.groups.filter((x: string) => x !== g.key) : [...f.groups, g.key])}>
                        {g.label}
                      </Pill>
                    ))}
                  </div>
                </Field>
              </div>
              <Field label="Order"><Input type="number" value={f.sortOrder ?? 0} onChange={(e) => upd("sortOrder", Number(e.target.value))} /></Field>
              <Field label="Visible on site"><div className="pt-2"><Switch checked={f.visible ?? true} onCheckedChange={(v) => upd("visible", v)} /></div></Field>
            </>
          ) : (
            <>
              <Field label="Title"><Input value={f.title || ""} onChange={(e) => upd("title", e.target.value)} data-testid="input-website-title" /></Field>
              <Field label="Slug" hint="Web address; leave blank to generate from the title."><Input value={f.slug || ""} onChange={(e) => upd("slug", e.target.value)} /></Field>
              {kind === "case-studies" ? (
                <>
                  <Field label="Service">
                    <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={f.service || SERVICES[0]} onChange={(e) => upd("service", e.target.value)}>
                      {SERVICES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field label="Image URL"><Input value={f.imageUrl || ""} onChange={(e) => upd("imageUrl", e.target.value)} placeholder="https://…" /></Field>
                  <div className="sm:col-span-2"><Field label="Blurb (one sentence, shown on cards)"><Textarea rows={2} value={f.blurb || ""} onChange={(e) => upd("blurb", e.target.value)} /></Field></div>
                  <div className="sm:col-span-2"><Field label="Facts — one per line as Label: Value" hint="e.g. Client: Landsec"><Textarea rows={4} value={f.factsText} onChange={(e) => upd("factsText", e.target.value)} className="font-mono text-xs" /></Field></div>
                </>
              ) : (
                <>
                  <Field label="Category"><Input value={f.category || ""} onChange={(e) => upd("category", e.target.value)} placeholder="Deals, Opinion, News…" /></Field>
                  <Field label="Date (as shown)"><Input value={f.date || ""} onChange={(e) => upd("date", e.target.value)} placeholder="12 June 2026" /></Field>
                  <Field label="Author"><Input value={f.author || ""} onChange={(e) => upd("author", e.target.value)} /></Field>
                  <Field label="Image URL"><Input value={f.imageUrl || ""} onChange={(e) => upd("imageUrl", e.target.value)} placeholder="https://…" /></Field>
                  <div className="sm:col-span-2"><Field label="Standfirst"><Textarea rows={2} value={f.standfirst || ""} onChange={(e) => upd("standfirst", e.target.value)} /></Field></div>
                </>
              )}
              <div className="sm:col-span-2"><Field label="Body — blank line between paragraphs"><Textarea rows={8} value={f.bodyText} onChange={(e) => upd("bodyText", e.target.value)} /></Field></div>
              <Field label="Order"><Input type="number" value={f.sortOrder ?? 0} onChange={(e) => upd("sortOrder", Number(e.target.value))} /></Field>
              <Field label="Published"><div className="pt-2"><Switch checked={f.published ?? false} onCheckedChange={(v) => upd("published", v)} /></div></Field>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} data-testid="button-save-website-item">{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
