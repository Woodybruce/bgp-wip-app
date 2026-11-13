// The backlog of comments not yet logged, for an admin (Settings, with the
// other letting tools). Preview reads every unit's target comments, viewings,
// interest notes and brief comments and writes nothing; Apply stores what
// Preview counted as suggestions for the "Not yet logged" list. Neither logs
// an offer or a viewing, and nothing here runs by itself.
import { useState } from "react";
import { Eye, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { refreshSuggestions } from "./suggestions-dialog";

interface Backlog {
  unitsRead: number; raised: number; closed: number; failed: number;
  byKind: Record<string, number>; bySource: Record<string, number>;
  sample: { unitName: string; propertyName: string | null; brandName: string | null; kind: string; source: string; summary: string; excerpt: string; evidenceDate: string | null }[];
  previewedAt?: string; appliedAt?: string;
}
const SOURCE_WORDS: Record<string, string> = { target_comment: "target comments", viewing: "viewings", interest_note: "interest notes", brief_comment: "brief comments" };
const said = (e: unknown): string => (e instanceof Error ? e.message.replace(/^\d{3}:\s*/, "") : "") || "Try again in a moment.";
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

export function LettingSuggestionsAdmin() {
  const { toast } = useToast();
  const [preview, setPreview] = useState<Backlog | null>(null);
  const [applied, setApplied] = useState<Backlog | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = async (apply: boolean) => {
    setBusy(apply ? "apply" : "preview");
    try {
      const res = apply ? await apiRequest("POST", "/api/admin/letting-suggestions/apply") : await apiRequest("GET", "/api/admin/letting-suggestions/preview");
      const data = (await res.json()) as Backlog;
      if (apply) { setApplied(data); setPreview(null); setConfirming(false); refreshSuggestions(); toast({ title: "Applied", description: `${plural(data.raised, "suggestion", "suggestions")} added to Not yet logged.` }); }
      else { setPreview(data); setApplied(null); setConfirming(false); }
    } catch (e) {
      toast({ title: apply ? "Apply failed" : "Preview failed", description: said(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };
  const changes = preview ? preview.raised + preview.closed : 0;
  const sources = (b: Backlog) => Object.entries(b.bySource).map(([k, n]) => `${n.toLocaleString("en-GB")} from ${SOURCE_WORDS[k] || k}`).join(", ");

  return (
    <div className="rounded-md border border-border p-2 space-y-2" data-testid="panel-letting-suggestions-backlog">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-medium">Comments not yet logged</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => run(false)} disabled={busy !== null} data-testid="button-letting-suggestions-preview">
            {busy === "preview" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
            {busy === "preview" ? "Previewing…" : "Preview"}
          </Button>
          <Button size="sm" onClick={() => setConfirming(true)} disabled={!preview || changes === 0 || busy !== null} data-testid="button-letting-suggestions-apply">
            {busy === "apply" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            {busy === "apply" ? "Applying…" : "Apply"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Reads the comments on targets, viewings, interest notes and brief comments already in the app for ones that read as an offer or a viewing with none logged, and lists them under Not yet logged on the Letting Tracker.
        The shorthand rules only: no AI, and no emails or chat. It logs no offer and no viewing: a person does that from the list.
      </p>
      {preview && (
        <div className="space-y-1.5 text-xs" data-testid="text-letting-suggestions-preview">
          <p>
            Previewed {new Date(preview.previewedAt || Date.now()).toLocaleString("en-GB")}: <span className="font-mono tabular-nums">{preview.unitsRead}</span> units read,{" "}
            <span className="font-mono tabular-nums">{preview.raised}</span> to add{preview.raised > 0 && sources(preview) ? ` (${sources(preview)})` : ""},{" "}
            <span className="font-mono tabular-nums">{preview.closed}</span> open to close because the offer or viewing is now logged or the words changed.
            {preview.failed > 0 && <span className="text-destructive"> {plural(preview.failed, "unit", "units")} could not be read.</span>}
            {" "}Nothing has been written.
          </p>
          {preview.sample.length > 0 && (
            <ul className="rounded-md border border-border bg-muted/40 p-2 space-y-1.5">
              {preview.sample.map((s, i) => (
                <li key={i} className="min-w-0">
                  <p className="break-words"><span className="font-medium">{s.unitName}</span>{s.propertyName ? <span className="text-muted-foreground"> · {s.propertyName}</span> : null} · {s.brandName || "No brand named"} · <span className="text-muted-foreground">{s.source}</span></p>
                  <p className="break-words text-muted-foreground">{s.excerpt ? `“${s.excerpt}” ` : ""}{s.summary}</p>
                </li>
              ))}
              {preview.raised > preview.sample.length && <li className="text-muted-foreground">And {(preview.raised - preview.sample.length).toLocaleString("en-GB")} more.</li>}
            </ul>
          )}
          {confirming && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2" data-testid="box-letting-suggestions-confirm">
              <span>Add {plural(preview.raised, "suggestion", "suggestions")} and close {preview.closed}? The units are read again as it runs, so the numbers can move a little.</span>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={busy !== null}>Cancel</Button>
              <Button size="sm" onClick={() => run(true)} disabled={busy !== null} data-testid="button-letting-suggestions-confirm">
                {busy === "apply" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Apply
              </Button>
            </div>
          )}
        </div>
      )}
      {applied && (
        <p className="text-xs" data-testid="text-letting-suggestions-applied">
          Applied {new Date(applied.appliedAt || Date.now()).toLocaleString("en-GB")}: <span className="font-mono tabular-nums">{applied.raised}</span> added, <span className="font-mono tabular-nums">{applied.closed}</span> closed, from <span className="font-mono tabular-nums">{applied.unitsRead}</span> units.
          {applied.failed > 0 && <span className="text-destructive"> {plural(applied.failed, "unit", "units")} could not be read.</span>}
        </p>
      )}
    </div>
  );
}
