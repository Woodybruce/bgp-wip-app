import { useRef, useState } from "react";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type EvidenceDraft = {
  tenant?: string | null; transactionType?: string | null; transactionDate?: string | null;
  sizeSqft?: number | string | null; zoneA?: number | string | null; itza?: number | string | null;
  headlineRent?: number | string | null; netEffective?: number | string | null;
  term?: string | null; concession?: string | null; notes?: string | null;
};
type Candidate = EvidenceDraft & { sheetName: string; unitRef: string | null; unitMismatch: boolean };
type Preview = { fileName: string; candidates: Candidate[]; warnings: string[] };

export function EvidenceUnitUpload({ planId, unitId, unitRef, onSaved }: {
  planId: string; unitId: string; unitRef: string; onSaved: () => void;
}) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [draft, setDraft] = useState<EvidenceDraft>({});
  const [confirmed, setConfirmed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const candidate = preview?.candidates[candidateIndex];
  const endpoint = `/api/evidence-plans/${planId}/units/${unitId}/import-evidence`;

  const send = async (body: FormData) => {
    const response = await fetch(endpoint, { method: "POST", body, credentials: "include", headers: getAuthHeaders() });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || "The upload could not finish. Please try again.");
    if (!result) throw new Error("The server did not return an upload result. Please try again.");
    return result;
  };
  const chooseFile = async (files: File[]) => {
    if (inFlight.current) return;
    setError("");
    if (files.length !== 1) { setError("Choose one Excel workbook at a time."); return; }
    const selected = files[0];
    if (!/\.(xls|xlsx)$/i.test(selected.name)) { setError("Choose an Excel workbook (.xls or .xlsx). Use Add TAFs above for PDFs."); return; }
    if (selected.size > 20 * 1024 * 1024) { setError("This workbook is too large. The limit is 20 MB."); return; }
    inFlight.current = true; setBusy("preview"); setFile(selected); setPreview(null); setConfirmed(false);
    try {
      const body = new FormData(); body.append("file", selected); body.append("action", "preview");
      const result: Preview = await send(body);
      if (!result.candidates?.length) throw new Error("No sheets could be read. Try saving the workbook again in Excel.");
      setPreview(result); setCandidateIndex(0); setDraft(result.candidates[0]); setOpen(true);
    } catch (e: any) { setError(e.message || "Could not read this workbook."); }
    finally { inFlight.current = false; setBusy(null); }
  };
  const save = async () => {
    if (!file || !candidate || inFlight.current || (candidate.unitMismatch && !confirmed)) return;
    inFlight.current = true; setBusy("save"); setError("");
    try {
      const body = new FormData(); body.append("file", file); body.append("action", "save");
      body.append("candidateIndex", String(candidateIndex)); body.append("fields", JSON.stringify(draft));
      body.append("confirmUnitMismatch", String(confirmed));
      const result = await send(body);
      onSaved(); setOpen(false); setPreview(null); setFile(null);
      toast({ title: result.duplicate ? "Workbook already linked" : `Evidence added to unit ${unitRef}`,
        description: result.duplicate ? "This sheet is already attached to this unit. Open its evidence entry to make changes." : "The original workbook is available from the evidence entry." });
    } catch (e: any) { setError(e.message || "Could not save. Your reviewed details are kept here."); }
    finally { inFlight.current = false; setBusy(null); }
  };
  const field = (key: keyof EvidenceDraft, label: string, type = "text") => <div>
    <label htmlFor={`upload-evidence-${key}`} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
    <Input id={`upload-evidence-${key}`} data-testid={`upload-evidence-${key}`} type={type}
      min={type === "number" ? 0 : undefined} step={type === "number" ? "any" : undefined}
      className={`mt-1 min-h-11 ${type === "number" ? "font-mono tabular-nums" : ""}`}
      value={draft[key] ?? ""} disabled={busy === "save"}
      onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} />
  </div>;

  return <>
    <div data-testid="unit-evidence-dropzone" className={`mb-3 rounded-xl border border-dashed p-3 ${dragOver ? "border-primary bg-muted" : "border-border bg-card"}`}
      onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; setDragOver(!busy); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false); }}
      onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragOver(false); void chooseFile(Array.from(event.dataTransfer.files)); }}>
      <p className="text-sm font-medium">Excel evidence for unit {unitRef}</p>
      <p className="text-xs text-muted-foreground mt-1">Drop a TAS here, or choose a workbook. Review its figures before saving them to this unit.</p>
      <input ref={input} type="file" accept=".xls,.xlsx" hidden data-testid="unit-evidence-file"
        onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) void chooseFile(files); }} />
      <Button variant="outline" size="sm" className="mt-2 min-h-11" disabled={!!busy} onClick={() => input.current?.click()} data-testid="button-upload-unit-evidence">
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
        {busy === "preview" ? "Reading workbook…" : "Upload Excel"}
      </Button>
      <p className="text-[11px] text-muted-foreground mt-1">.xls or .xlsx · up to 20 MB</p>
      {error && !open && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
    <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); setError(""); } }}>
      <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto pb-0 max-md:top-auto max-md:bottom-0 max-md:translate-y-0 max-md:rounded-b-none" data-testid="unit-evidence-preview" onOpenAutoFocus={event => { event.preventDefault(); title.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle ref={title} tabIndex={-1} className="outline-none">Add evidence to unit {unitRef}</DialogTitle>
          <DialogDescription>Check the values read from the workbook. Saving adds an evidence entry and keeps the original Excel file.</DialogDescription>
        </DialogHeader>
        <p className="flex items-start gap-2 text-sm break-all"><FileSpreadsheet className="h-4 w-4 shrink-0 mt-0.5" />{preview?.fileName}</p>
        {preview && preview.candidates.length > 1 ? <div>
          <label htmlFor="upload-evidence-sheet" className="text-xs font-medium">Worksheet</label>
          <select id="upload-evidence-sheet" className="mt-1 w-full min-h-11 rounded-md border border-input bg-background px-2 text-sm" value={candidateIndex} disabled={!!busy}
            onChange={event => { const index = Number(event.target.value); setCandidateIndex(index); setDraft(preview.candidates[index]); setConfirmed(false); setError(""); }}>
            {preview.candidates.map((item, index) => <option key={index} value={index}>{item.sheetName}{item.unitRef ? ` · Unit ${item.unitRef}` : ""}</option>)}
          </select>
        </div> : <p className="text-xs text-muted-foreground">Worksheet: {candidate?.sheetName}</p>}
        {!!preview?.warnings.length && <div className="rounded-lg border border-border bg-muted p-3 text-sm space-y-1" data-testid="unit-evidence-warnings">
          {preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
        </div>}
        {candidate?.unitMismatch && <div className="rounded-lg border border-destructive/50 p-3 text-sm" data-testid="unit-evidence-mismatch">
          <p>The worksheet names unit <strong>{candidate.unitRef}</strong>. You selected <strong>{unitRef}</strong>.</p>
          <label className="mt-2 flex min-h-11 items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={confirmed} disabled={!!busy} onChange={event => setConfirmed(event.target.checked)} data-testid="confirm-unit-evidence-mismatch" />
            <span>Link this evidence to unit {unitRef}. Keep its saved unit reference.</span>
          </label>
        </div>}
        {!candidate?.unitRef && <p className="text-sm text-muted-foreground">No unit reference was found in the sheet. This evidence will be linked to the selected unit, {unitRef}.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {field("tenant", "Tenant")}{field("transactionType", "Transaction type")}
          {field("transactionDate", "Transaction date", "date")}{field("sizeSqft", "Size sq ft", "number")}
          {field("zoneA", "Zone A £psf", "number")}{field("itza", "ITZA sq ft", "number")}
          {field("headlineRent", "Headline £pa", "number")}{field("netEffective", "Net effective £pa", "number")}
          {field("term", "Term")}{field("concession", "Concessions")}
        </div>
        <div><label htmlFor="upload-evidence-notes" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</label>
          <textarea id="upload-evidence-notes" data-testid="upload-evidence-notes" className="mt-1 w-full min-h-24 rounded-md border border-input bg-background p-2 text-sm" value={draft.notes || ""} disabled={busy === "save"}
            onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="sticky bottom-0 bg-background pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] flex justify-end gap-2 border-t border-border">
          <Button variant="outline" disabled={!!busy} onClick={() => { setOpen(false); setError(""); }}>Cancel</Button>
          <Button disabled={!!busy || !candidate || (candidate.unitMismatch && !confirmed)} onClick={() => void save()} data-testid="button-save-unit-evidence">
            {busy === "save" ? "Saving…" : `Save to unit ${unitRef}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
