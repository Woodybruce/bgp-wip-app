/**
 * <ImportAnythingDialog>
 * ======================
 *
 * The AI-native ingest experience for the BGP app. Drop any file or paste
 * any SharePoint link — the engine auto-classifies what it is, parses it,
 * matches against the existing CRM, and shows you exactly what will change
 * before any write happens.
 *
 *   1. Drop / link / paste — single zone, no target picker by default
 *   2. AI classifies + parses + diffs
 *   3. Plain-English summary up top, structured diff below
 *   4. Confirm to commit
 *
 * Backed by /api/ingest. The same backbone serves the leasing tracker,
 * deals, comps, lease events — every "Import" button on every board.
 */
import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, CheckCircle2, AlertTriangle, Loader2, X, Sparkles, Link2, FileSearch } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/queryClient";

type IngestTarget = "leasing_schedule_units" | "crm_deals" | "crm_companies" | "crm_contacts" | "crm_properties";
type IngestTargetOrAuto = IngestTarget | "auto";

const TARGET_LABELS: Record<IngestTargetOrAuto, string> = {
  auto: "Auto-detect (recommended)",
  leasing_schedule_units: "Leasing schedule",
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
  droppedFields?: string[];
}

interface IngestPreview {
  target: IngestTarget;
  filename: string;
  totalParsed: number;
  diff: DiffRecord[];
  summary: { adds: number; updates: number; noChange: number; needsReview: number };
  commitToken: string;
  narrative?: string;
  autoClassified?: { confidence: "high" | "medium" | "low"; reasoning: string };
}

interface ImportAnythingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTarget?: IngestTargetOrAuto;
  onCommitted?: (result: { written: number; skipped: number; target: IngestTarget }) => void;
}

export function ImportAnythingDialog({ open, onOpenChange, defaultTarget = "auto", onCommitted }: ImportAnythingDialogProps) {
  const { toast } = useToast();
  const [target, setTarget] = useState<IngestTargetOrAuto>(defaultTarget);
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [preview, setPreview] = useState<IngestPreview | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
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

  const handleUpload = async (overrideFile?: File) => {
    const fileToUse = overrideFile || file;
    if (!fileToUse && !pastedText.trim() && !shareUrl.trim()) {
      toast({ title: "Nothing to upload", description: "Drop a file, paste a link, or paste text.", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("target", target);
      if (fileToUse) fd.append("file", fileToUse);
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
    if (f) {
      setFile(f);
      // Auto-trigger parse on drop — feels native.
      void handleUpload(f);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      void handleUpload(f);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b bg-gradient-to-r from-primary/5 via-transparent to-primary/5">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="w-5 h-5 text-primary" />
            Import data
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Drop any file. AI works out what it is, matches it to the CRM, and shows you the diff before anything's saved.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!preview ? (
            <DropZone
              file={file}
              shareUrl={shareUrl}
              pastedText={pastedText}
              setFile={setFile}
              setShareUrl={setShareUrl}
              setPastedText={setPastedText}
              onDrop={handleDrop}
              onFileChange={handleFileChange}
              fileInputRef={fileInputRef}
              target={target}
              setTarget={setTarget}
              showAdvanced={showAdvanced}
              setShowAdvanced={setShowAdvanced}
              isUploading={isUploading}
            />
          ) : (
            <PreviewPane preview={preview} />
          )}
        </div>

        <DialogFooter className="px-6 py-3 border-t bg-muted/20">
          {!preview ? (
            <>
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button onClick={() => handleUpload()} disabled={isUploading || (!file && !shareUrl.trim() && !pastedText.trim())}>
                {isUploading ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Reading…</>) : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Analyse</>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setPreview(null)} disabled={isCommitting}>Try another file</Button>
              <Button onClick={handleCommit} disabled={isCommitting || (preview.summary.adds + preview.summary.updates === 0)} className="min-w-[140px]">
                {isCommitting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>) : (
                  <>Commit {preview.summary.adds + preview.summary.updates} {preview.summary.adds + preview.summary.updates === 1 ? "change" : "changes"}</>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Drop / link / paste — three subtle inputs in one zone ──────────────
function DropZone(props: {
  file: File | null;
  shareUrl: string;
  pastedText: string;
  setFile: (f: File | null) => void;
  setShareUrl: (s: string) => void;
  setPastedText: (s: string) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  target: IngestTargetOrAuto;
  setTarget: (t: IngestTargetOrAuto) => void;
  showAdvanced: boolean;
  setShowAdvanced: (b: boolean) => void;
  isUploading: boolean;
}) {
  const { file, shareUrl, pastedText, setFile, setShareUrl, setPastedText, onDrop, onFileChange, fileInputRef, target, setTarget, showAdvanced, setShowAdvanced, isUploading } = props;
  const hasInput = !!file || !!shareUrl.trim() || !!pastedText.trim();

  if (isUploading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
          <Sparkles className="w-12 h-12 text-primary relative animate-pulse" />
        </div>
        <div className="text-center">
          <div className="font-medium">Reading the file…</div>
          <div className="text-xs text-muted-foreground mt-1">Classifying, extracting records, matching to CRM.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
          file ? "border-primary/50 bg-primary/5" : "border-muted-foreground/20 hover:border-primary/50 hover:bg-primary/5"
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept=".xlsx,.xls,.xlsm,.csv,.tsv,.pdf,.txt"
          onChange={onFileChange}
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
            <Upload className="w-10 h-10 mx-auto text-muted-foreground/60 mb-3" />
            <div className="font-medium">Drop a file or click to choose</div>
            <div className="text-xs text-muted-foreground mt-1.5">
              Excel, CSV, PDF or plain text · AI works out what it is
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="relative">
          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={shareUrl}
            onChange={(e) => setShareUrl(e.target.value)}
            placeholder="…or a SharePoint share link"
            disabled={!!file}
            className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors text-right md:text-right"
        >
          {showAdvanced ? "Hide options" : "Advanced options"}
        </button>
      </div>

      {showAdvanced && (
        <div className="space-y-3 p-3 border rounded-lg bg-muted/20">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Force a target table</label>
            <Select value={target} onValueChange={(v) => setTarget(v as IngestTargetOrAuto)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(TARGET_LABELS) as IngestTargetOrAuto[]).map((k) => (
                  <SelectItem key={k} value={k}>{TARGET_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Default is auto-detect — only override if AI gets it wrong.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Or paste raw text</label>
            <Textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Paste a CSV, table, or notes…"
              rows={3}
              disabled={!!file || !!shareUrl.trim()}
              className="text-xs"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Preview pane — narrative on top, diff list below ────────────────────
function PreviewPane({ preview }: { preview: IngestPreview }) {
  const { summary, diff, narrative, autoClassified } = preview;
  return (
    <div className="space-y-4">
      {narrative && (
        <div className="rounded-lg border bg-gradient-to-br from-primary/5 to-transparent p-4 flex items-start gap-3">
          <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="text-sm leading-relaxed">{narrative}</div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">{preview.filename}</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="text-muted-foreground">{preview.totalParsed} parsed</span>
        {autoClassified && (
          <>
            <span className="text-muted-foreground/60">·</span>
            <Badge variant="outline" className="text-[10px] gap-1">
              <FileSearch className="w-3 h-3" />
              Detected as {TARGET_LABELS[preview.target]} ({autoClassified.confidence})
            </Badge>
          </>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        <StatTile label="New" value={summary.adds} tone="emerald" />
        <StatTile label="Updates" value={summary.updates} tone="amber" />
        <StatTile label="No change" value={summary.noChange} tone="muted" />
        <StatTile label="Review" value={summary.needsReview} tone={summary.needsReview > 0 ? "rose" : "muted"} />
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-muted/30 text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center justify-between">
          <span>Records</span>
          <span>{diff.length} total</span>
        </div>
        <div className="max-h-[280px] overflow-y-auto divide-y text-xs">
          {diff.length === 0 && (
            <div className="p-6 text-center text-muted-foreground">No records extracted.</div>
          )}
          {diff.map((entry, i) => (
            <DiffRow key={i} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "muted" | "rose" }) {
  const colours: Record<typeof tone, string> = {
    emerald: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400",
    amber: "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400",
    muted: "bg-muted/40 text-muted-foreground border-muted",
    rose: "bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-400",
  };
  return (
    <div className={`rounded-lg border p-3 ${colours[tone]}`}>
      <div className="text-2xl font-semibold leading-none">{value}</div>
      <div className="text-[11px] mt-1 uppercase tracking-wide">{label}</div>
    </div>
  );
}

function DiffRow({ entry }: { entry: DiffRecord }) {
  const name = entry.record.unit_name || entry.record.name || entry.record.email || "(record)";
  const isReview = entry.unmatchedRefs && entry.unmatchedRefs.length > 0;
  return (
    <div className="px-3 py-2 flex items-start gap-3 hover:bg-muted/20 transition-colors">
      <div className="shrink-0 mt-0.5">
        {isReview ? <AlertTriangle className="w-3.5 h-3.5 text-rose-500" /> :
         entry.type === "add" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> :
         entry.type === "update" ? <CheckCircle2 className="w-3.5 h-3.5 text-amber-500" /> :
         <span className="w-3.5 h-3.5 inline-block" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{name}</div>
        {entry.changedFields && entry.changedFields.length > 0 && (
          <div className="text-muted-foreground text-[11px] mt-0.5">
            {entry.changedFields.join(", ")}
          </div>
        )}
        {entry.unmatchedRefs?.map((u, j) => (
          <div key={j} className="text-rose-600 text-[11px] mt-0.5">{u}</div>
        ))}
        {entry.droppedFields && entry.droppedFields.length > 0 && (
          <div className="text-muted-foreground/70 text-[10px] mt-0.5">
            ignored: {entry.droppedFields.join(", ")}
          </div>
        )}
      </div>
      <Badge
        variant="outline"
        className={`text-[10px] capitalize shrink-0 ${
          isReview ? "border-rose-300 text-rose-700" :
          entry.type === "add" ? "border-emerald-300 text-emerald-700" :
          entry.type === "update" ? "border-amber-300 text-amber-700" : ""
        }`}
      >
        {isReview ? "review" : entry.type.replace("_", " ")}
      </Badge>
    </div>
  );
}
