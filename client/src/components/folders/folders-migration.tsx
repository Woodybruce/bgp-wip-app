// Moving the old folder links into Folders (Woody, 24 November 2026;
// docs/folders-review-2026-11-20.md, 4.7; server/folders/migration.ts). For
// admins, in Settings: Preview reads every stored address and old team-folder
// path as the admin, on their own Microsoft 365; tick the rows that open and
// Apply (typing APPLY) within the hour; Undo from the runs. Nothing here runs
// by itself, at boot or on a timer. The old columns stay and are still read.
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Eye, FolderOpen, Loader2, Play, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Pill, PillCount } from "@/components/ui/pill";
import { useToast } from "@/hooks/use-toast";
import { MIGRATION_COLUMNS, MIGRATION_STATUS_WORDS, type DriveEntry, type MigrationStatus } from "@shared/folders";
import { FolderApiError, folderApi, refreshFolders } from "./folder-api";

type Row = { id: string; column: string; recordType: string; recordId: string; recordName: string; key: string; label: string; value: string; kind: "address" | "path"; status: MigrationStatus; error: string | null; entry: DriveEntry | null };
type Suggestion = { recordType: string; recordId: string; recordName: string; entry: DriveEntry };
type Preview = { previewedAt: string; previewedByName: string; rows: Row[]; suggestions: Suggestion[]; counts: Partial<Record<MigrationStatus, number>>; unread: string[]; readers: { column: string; where: string; what: string }[] };
type Run = { kind: "apply"; batch: string; at: string; byName: string; rows: unknown[]; undoneAt?: string | null };

const STATUSES: MigrationStatus[] = ["opens", "linked", "missing", "not_folder", "outside", "no_access", "error"];
const whatColumn = (c: string) => MIGRATION_COLUMNS.find(x => x.column === c)?.what || c;
const recordHref = (type: string, id: string) => type === "property" ? `/properties/${id}` : type === "deal" ? `/deals/${id}` : type === "company" ? `/companies/${id}` : null;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function FoldersMigrationSection() {
  const { toast } = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [connect, setConnect] = useState(false);
  const [shown, setShown] = useState<MigrationStatus | "all">("all");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState("");
  const runs = useQuery<{ runs: Run[] }, FolderApiError>({
    queryKey: ["/api/admin/folders/migration/runs"],
    queryFn: () => folderApi("GET", "/api/admin/folders/migration/runs"),
    retry: false,
  });

  const rows = useMemo(() => (preview?.rows || []).filter(r => shown === "all" || r.status === shown), [preview, shown]);
  const opening = (preview?.rows || []).filter(r => r.status === "opens");

  const runPreview = async () => {
    setBusy("preview"); setProblem(null); setConnect(false);
    try {
      const p = await folderApi<Preview>("GET", "/api/admin/folders/migration");
      setPreview(p); setTicked(new Set()); setTyped(""); setShown("all");
    } catch (e: any) {
      setProblem(e?.message || "The report could not be made.");
      setConnect(!!e?.connect);
    } finally { setBusy(null); }
  };
  const apply = async () => {
    if (!preview) return;
    setBusy("apply"); setProblem(null);
    try {
      const r = await folderApi<{ batch: string; linked: number; already: number; skipped: { id: string; why: string }[] }>("POST", "/api/admin/folders/migration/apply", { ids: [...ticked], previewedAt: preview.previewedAt });
      toast({ title: `${r.linked} folder${r.linked === 1 ? "" : "s"} moved into Folders`, description: [r.already ? `${r.already} were already there` : "", r.skipped.length ? `${r.skipped.length} not moved` : ""].filter(Boolean).join("; ") || undefined });
      setTicked(new Set()); setTyped("");
      await Promise.all([runs.refetch(), refreshFolders()]);
      await runPreview();
    } catch (e: any) { setProblem(e?.message || "Nothing was moved."); }
    finally { setBusy(null); }
  };
  const undo = async (batch: string) => {
    setBusy(batch); setProblem(null);
    try {
      const r = await folderApi<{ removed: number }>("POST", "/api/admin/folders/migration/undo", { batch });
      toast({ title: `${r.removed} link${r.removed === 1 ? "" : "s"} taken back out`, description: "The old links show again where they did." });
      await Promise.all([runs.refetch(), refreshFolders()]);
    } catch (e: any) { setProblem(e?.message || "Not undone."); }
    finally { setBusy(null); }
  };

  return (
    <Card data-testid="section-folders-migration">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><FolderOpen className="w-4 h-4" />Folders: moving the old links over</CardTitle>
        <CardDescription>
          Preview opens every folder address the app stored before Folders (properties, their team folders, companies, transactions, schemes, Lease Advisory matters and Pathway runs), each old team-folder path and each company's folder in BGP share drive/Companies (the brand page's old link), as you, on your own Microsoft 365. Tick the ones that open and Apply within the hour: each becomes a folder in Folders, and Undo takes a batch back out. The old columns are not changed and are still read where the app read them. Nothing here runs by itself.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={runPreview} disabled={!!busy} data-testid="folders-migration-preview">
            {busy === "preview" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Eye className="w-3.5 h-3.5 mr-1.5" />}{preview ? "Preview again" : "Preview"}
          </Button>
          {busy === "preview" && <span className="text-xs text-muted-foreground">Opening each stored address; this can take a few minutes.</span>}
          {preview && <span className="text-xs text-muted-foreground">Preview by {preview.previewedByName}, {when(preview.previewedAt)}.</span>}
        </div>
        {problem && <p className="text-sm text-destructive" data-testid="folders-migration-problem">{problem}{connect && <> <Link href="/sharepoint" className="underline underline-offset-2">Open the SharePoint page</Link>.</>}</p>}

        {preview && (
          <>
            <div className="flex flex-wrap items-center gap-1.5" data-testid="folders-migration-filters">
              <Pill active={shown === "all"} onClick={() => setShown("all")}>All <PillCount n={preview.rows.length} active={shown === "all"} /></Pill>
              {STATUSES.filter(s => preview.counts[s]).map(s => (
                <Pill key={s} active={shown === s} onClick={() => setShown(s)} data-testid={`folders-migration-filter-${s}`}>{MIGRATION_STATUS_WORDS[s]} <PillCount n={preview.counts[s] || 0} active={shown === s} /></Pill>
              ))}
            </div>
            {preview.unread.length > 0 && <p className="text-xs text-muted-foreground">Not read: {preview.unread.join("; ")}.</p>}
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stored folder links{shown === "all" ? "" : " of that kind"}.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border" data-testid="folders-migration-rows">
                {rows.map(r => {
                  const href = recordHref(r.recordType, r.recordId);
                  return (
                    <li key={r.id} className="flex items-start gap-2 px-2.5 py-2 text-xs" data-testid={`folders-migration-row-${r.id}`}>
                      <Checkbox className="mt-0.5" disabled={r.status !== "opens"} checked={ticked.has(r.id)} onCheckedChange={v => setTicked(prev => { const next = new Set(prev); if (v === true) next.add(r.id); else next.delete(r.id); return next; })} aria-label={`Move ${r.recordName}'s folder over`} />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-x-2">
                          {href ? <Link href={href} className="font-medium text-primary hover:underline">{r.recordName || "A record"}</Link> : <span className="font-medium">{r.recordName || "A record"}</span>}
                          <span className="text-muted-foreground">{whatColumn(r.column)}{r.key ? `: ${r.key}` : ""}</span>
                        </div>
                        <div className="break-all text-muted-foreground">{r.kind === "path" ? `Path ${r.value}` : r.value}</div>
                        {r.entry && <div>Opens to <span className="font-medium">{r.entry.path || r.entry.name}</span></div>}
                        {r.error && r.status !== "missing" && <div className="text-muted-foreground">{r.error}</div>}
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${r.status === "opens" ? "border-foreground/40" : "border-border text-muted-foreground"}`}>{MIGRATION_STATUS_WORDS[r.status]}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" disabled={!opening.length} onClick={() => setTicked(new Set(opening.map(r => r.id)))} data-testid="folders-migration-tick-all">Tick all {opening.length} that open</Button>
              <Input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Type APPLY" className="h-8 w-32 text-xs" data-testid="folders-migration-typed" />
              <Button type="button" size="sm" onClick={apply} disabled={!ticked.size || typed.trim() !== "APPLY" || !!busy} data-testid="folders-migration-apply">
                {busy === "apply" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}Apply {ticked.size || ""}
              </Button>
            </div>

            {preview.suggestions.length > 0 && (
              <div className="space-y-1.5" data-testid="folders-migration-suggestions">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Suggestions only: a folder of the same name in BGP - Share Drive</p>
                <p className="text-xs text-muted-foreground">For records whose stored links open nothing. Check it is theirs, then add it from the record's Folders.</p>
                <ul className="space-y-1">
                  {preview.suggestions.map(s => {
                    const href = recordHref(s.recordType, s.recordId);
                    return (
                      <li key={`${s.recordType}:${s.recordId}:${s.entry.itemId}`} className="flex flex-wrap items-center gap-x-2 text-xs">
                        {href ? <Link href={href} className="font-medium text-primary hover:underline">{s.recordName}</Link> : <span className="font-medium">{s.recordName}</span>}
                        <span className="text-muted-foreground">{s.entry.path}</span>
                        {s.entry.webUrl && <a href={s.entry.webUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="w-3 h-3" />Open in SharePoint</a>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <details className="text-xs" data-testid="folders-migration-readers">
              <summary className="cursor-pointer text-muted-foreground">Where the app still reads the old links ({preview.readers.length})</summary>
              <ul className="mt-1.5 space-y-1">
                {preview.readers.map((r, i) => <li key={i}><span className="font-mono">{r.column}</span> · {r.where}: {r.what}</li>)}
              </ul>
            </details>
          </>
        )}

        {(runs.data?.runs || []).filter(r => r.kind === "apply").length > 0 && (
          <div className="space-y-1.5" data-testid="folders-migration-runs">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Runs</p>
            <ul className="space-y-1">
              {runs.data!.runs.filter(r => r.kind === "apply").slice(0, 10).map(r => (
                <li key={r.batch} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="tabular-nums">{when(r.at)}</span>
                  <span className="text-muted-foreground">{r.byName}: {r.rows.length} moved</span>
                  {r.undoneAt ? <span className="text-muted-foreground">Undone {when(r.undoneAt)}</span> : (
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => undo(r.batch)} disabled={!!busy} data-testid="folders-migration-undo">
                      {busy === r.batch ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Undo2 className="w-3.5 h-3.5 mr-1" />}Undo
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
