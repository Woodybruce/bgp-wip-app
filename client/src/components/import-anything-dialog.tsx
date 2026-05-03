/**
 * <ImportAnythingDialog>
 * ======================
 *
 * The drag-drop / paste-anything ingest dialog. Two phases:
 *
 *  1. Upload a file (or paste text), pick a target table → previews diff
 *  2. Review the diff (adds / updates / needs-review) → confirm to commit
 *
 * Backed by /api/ingest. Same pipeline drives the leasing tracker import,
 * the deals import, the comp import, etc. — each just specifies a different
 * `target`. Replaces every per-format importer over time.
 */
import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, CheckCircle2, AlertTriangle, Loader2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/queryClient";

type IngestTarget = "leasing_schedule_units" | "crm_deals" | "crm_companies" | "crm_contacts" | "crm_properties";

const TARGET_LABELS: Record<IngestTarget, string> = {
  leasing_schedule_units: "Leasing Schedule (units, targets, comments)",
  crm_deals: "Deals",
  crm_companies: "Companies / Brands",
  crm_contacts: "Contacts",
  crm_properties: "Properties",
};

interface DiffRecord {
  type: "add" | "update" | "no_change";
  record: any;
  existingId?: string;
  changedFields?: string[];
  unmatchedRefs?: string[];
}

interface IngestPreview {
  target: IngestTarget;
  filename: string;
  totalParsed: number;
  diff: DiffRecord[];
  summary: { adds: number; updates: number; noChange: number; needsReview: number };
  commitToken: string;
}

interface ImportAnythingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTarget?: IngestTarget;
  /** Called after a successful commit so the caller can refetch / refresh. */
  onCommitted?: (result: { written: number; skipped: number; target: IngestTarget }) => void;
}

export function ImportAnythingDialog({ open, onOpenChange, defaultTarget = "leasing_schedule_units", onCommitted }: ImportAnythingDialogProps) {
  const { toast } = useToast();
  const [target, setTarget] = useState<IngestTarget>(defaultTarget);
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [preview, setPreview] = useState<IngestPreview | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setPastedText("");
    setShareUrl("");
    setPreview(null);
    setIsUploading(false);
    setIsCommitting(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onOpenChange(false);
  }, [reset, onOpenChange]);

  const handleUpload = async () => {
    if (!file && !pastedText.trim() && !shareUrl.trim()) {
      toast({ title: "Nothing to upload", description: "Drop a file, paste a SharePoint link, or paste some text.", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("target", target);
      if (file) fd.append("file", file);
      else if (shareUrl.trim()) fd.append("shareUrl", shareUrl.trim());
      else fd.append("text", pastedText);
      const r = await fetch("/api/ingest", { method: "POST", credentials: "include", headers: getAuthHeaders(), body: fd });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `${r.status}: failed`);
      }
      const json: IngestPreview = await r.json();
      setPreview(json);
    } catch (err: any) {
      toast({ title: "Couldn't parse", description: err?.message || "Try a different file.", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    setIsCommitting(true);
    try {
      const r = await fetch(`/api/ingest/${preview.commitToken}/commit`, {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `${r.status}: commit failed`);
      }
      const result = await r.json();
      toast({
        title: "Imported",
        description: `${result.written} record${result.written === 1 ? "" : "s"} written. ${result.skipped} skipped.`,
      });
      onCommitted?.({ written: result.written, skipped: result.skipped, target: preview.target });
      handleClose();
    } catch (err: any) {
      toast({ title: "Commit failed", description: err?.message, variant: "destructive" });
    } finally {
      setIsCommitting(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import data</DialogTitle>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>What kind of data is this?</Label>
              <Select value={target} onValueChange={(v) => setTarget(v as IngestTarget)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TARGET_LABELS) as IngestTarget[]).map((k) => (
                    <SelectItem key={k} value={k}>{TARGET_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-muted/30 transition-colors"
            >
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".xlsx,.xls,.xlsm,.csv,.tsv,.pdf,.txt"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  <span className="text-sm font-medium">{file.name}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setFile(null); }}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <div className="text-sm font-medium">Drop a file here or click to choose</div>
                  <div className="text-xs text-muted-foreground mt-1">Excel, CSV, PDF, TSV, plain text</div>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Or paste a SharePoint / OneDrive share link</Label>
              <input
                type="text"
                value={shareUrl}
                onChange={(e) => setShareUrl(e.target.value)}
                placeholder="https://… brucegillinghampollardlimited.sharepoint.com/…"
                disabled={!!file}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Or paste text directly</Label>
              <Textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Paste a CSV, table, or notes here…"
                rows={4}
                disabled={!!file || !!shareUrl.trim()}
              />
            </div>
          </div>
        ) : (
          <PreviewPane preview={preview} />
        )}

        <DialogFooter>
          {!preview ? (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleUpload} disabled={isUploading}>
                {isUploading ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Parsing…</>) : "Preview"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setPreview(null)} disabled={isCommitting}>Back</Button>
              <Button onClick={handleCommit} disabled={isCommitting || (preview.summary.adds + preview.summary.updates === 0)}>
                {isCommitting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Committing…</>) : `Commit (${preview.summary.adds + preview.summary.updates})`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewPane({ preview }: { preview: IngestPreview }) {
  const { summary, diff } = preview;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">{preview.filename} · {preview.totalParsed} parsed</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge className="bg-emerald-500/15 text-emerald-700 border border-emerald-500/30">{summary.adds} new</Badge>
        <Badge className="bg-amber-500/15 text-amber-700 border border-amber-500/30">{summary.updates} updates</Badge>
        <Badge variant="outline">{summary.noChange} no change</Badge>
        {summary.needsReview > 0 && (
          <Badge className="bg-rose-500/15 text-rose-700 border border-rose-500/30">{summary.needsReview} needs review</Badge>
        )}
      </div>
      <div className="border rounded-lg max-h-[400px] overflow-y-auto divide-y text-xs">
        {diff.map((entry, i) => (
          <div key={i} className="p-2 flex items-start gap-2">
            {entry.type === "add" && !entry.unmatchedRefs && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />}
            {entry.type === "update" && <CheckCircle2 className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />}
            {entry.type === "no_change" && <span className="w-3.5 shrink-0" />}
            {entry.unmatchedRefs && <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">
                {entry.record.unit_name || entry.record.name || entry.record.email || "(record)"}
              </div>
              {entry.changedFields && entry.changedFields.length > 0 && (
                <div className="text-muted-foreground">→ {entry.changedFields.join(", ")}</div>
              )}
              {entry.unmatchedRefs?.map((u, j) => (
                <div key={j} className="text-rose-600">{u}</div>
              ))}
            </div>
            <Badge variant="outline" className="text-[10px] capitalize shrink-0">
              {entry.unmatchedRefs?.length ? "review" : entry.type.replace("_", " ")}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
