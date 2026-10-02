import { useRef, useState } from "react";
import { Check, FileArchive, FileSpreadsheet, FileText, Loader2, Search, Upload } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type EvidenceDraft = {
  tenant?: string | null; transactionType?: string | null; transactionDate?: string | null;
  sizeSqft?: number | string | null; zoneA?: number | string | null; netZoneA?: number | string | null; itza?: number | string | null;
  headlineRent?: number | string | null; netEffective?: number | string | null;
  term?: string | null; concession?: string | null; notes?: string | null;
};
type Candidate = EvidenceDraft & { sheetName: string; unitRef: string | null; unitMismatch: boolean };
type Preview = { fileName: string; candidates: Candidate[]; warnings: string[] };

// One TAF the user can pick out of a zip (or a multi-file pick) and review
// on its own. Pete, 2026-10-02: the Hammerson folders hold duplicate and
// conflicting analyses, so he wants to sense-check each sheet before it
// goes in — not bulk-load the lot via Add TAFs. The zip is read in the
// browser (nothing unzipped on Windows, so no long-path errors) and only
// the picked PDF is decompressed and sent.
type PickItem = { key: string; name: string; folder: string; size: number; load: () => Promise<File> };

async function listZipPdfs(zip: File): Promise<PickItem[]> {
  const { unzipSync } = await import("fflate");
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const items: PickItem[] = [];
  unzipSync(bytes, { filter: entry => {
    const path = entry.name;
    if (/\.pdf$/i.test(path) && !/(^|\/)(__MACOSX|\.)/.test(path)) {
      const parts = path.split("/");
      const name = parts.pop() || path;
      items.push({ key: path, name, folder: parts.join(" › "), size: entry.originalSize, load: async () => {
        const out = unzipSync(bytes, { filter: e => e.name === path });
        const data = out[path];
        if (!data) throw new Error("That PDF could not be read from the zip.");
        return new File([data], name, { type: "application/pdf" });
      } });
    }
    return false; // list only — nothing is decompressed until picked
  } });
  return items.sort((a, b) => (a.folder + a.name).localeCompare(b.folder + b.name, "en-GB", { numeric: true }));
}

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
  const [pickSource, setPickSource] = useState<string>("");
  const [pickItems, setPickItems] = useState<PickItem[] | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [pickSearch, setPickSearch] = useState("");
  const [pickDone, setPickDone] = useState<Set<string>>(new Set());
  const [pickCurrent, setPickCurrent] = useState<string | null>(null);
  const candidate = preview?.candidates[candidateIndex];
  const isPdf = /\.pdf$/i.test(file?.name || preview?.fileName || "");
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
    // A zip, or several files at once → list them and let the user pick
    // one sheet at a time to review.
    if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
      if (files[0].size > 500 * 1024 * 1024) { setError("This zip is too large to open here. The limit is 500 MB."); return; }
      setBusy("preview");
      try {
        const items = await listZipPdfs(files[0]);
        if (!items.length) { setError("No PDFs were found in this zip."); return; }
        setPickSource(files[0].name); setPickItems(items); setPickDone(new Set()); setPickSearch(""); setPickOpen(true);
      } catch { setError("This zip could not be opened. Download it again from OneDrive and retry."); }
      finally { setBusy(null); }
      return;
    }
    if (files.length > 1) {
      const usable = files.filter(f => /\.(xls|xlsx|pdf)$/i.test(f.name));
      if (!usable.length) { setError("Choose Excel workbooks, PDFs or a zip."); return; }
      setPickSource(`${usable.length} files`); setPickDone(new Set()); setPickSearch("");
      setPickItems(usable.map(f => ({ key: f.name + f.size, name: f.name, folder: "", size: f.size, load: async () => f })));
      setPickOpen(true);
      return;
    }
    const selected = files[0];
    if (!/\.(xls|xlsx|pdf)$/i.test(selected.name)) { setError("Choose an Excel workbook (.xls or .xlsx), a PDF, or a zip of PDFs."); setPickCurrent(null); return; }
    if (selected.size > 20 * 1024 * 1024) { setError("This file is too large. The limit is 20 MB."); return; }
    inFlight.current = true; setBusy("preview"); setFile(selected); setPreview(null); setConfirmed(false);
    try {
      const body = new FormData(); body.append("file", selected); body.append("action", "preview");
      const result: Preview = await send(body);
      if (!result.candidates?.length) throw new Error(/\.pdf$/i.test(selected.name) ? "Nothing could be read from this PDF." : "No sheets could be read. Try saving the workbook again in Excel.");
      setPreview(result); setCandidateIndex(0); setDraft(result.candidates[0]); setOpen(true);
    } catch (e: any) { setError(e.message || "Could not read this file."); }
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
      if (pickCurrent) { setPickDone(prev => new Set(prev).add(pickCurrent)); setPickCurrent(null); setPickOpen(true); }
      toast({ title: result.duplicate ? "Already on this unit" : `Evidence added to unit ${unitRef}`,
        description: result.duplicate ? "This file is already attached to this unit. Open its evidence entry to make changes." : `The original ${isPdf ? "PDF" : "workbook"} is available from the evidence entry.` });
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
      <p className="text-sm font-medium">Evidence for unit {unitRef}</p>
      <p className="text-xs text-muted-foreground mt-1">Drop a TAS or TAF here, Excel or PDF. Review its figures before saving them to this unit. Choose a zip to pick sheets out of it one at a time.</p>
      <input ref={input} type="file" accept=".xls,.xlsx,.pdf,application/pdf,.zip,application/zip,application/x-zip-compressed" multiple hidden data-testid="unit-evidence-file"
        onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) void chooseFile(files); }} />
      <Button variant="outline" size="sm" className="mt-2 min-h-11" disabled={!!busy} onClick={() => input.current?.click()} data-testid="button-upload-unit-evidence">
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
        {busy === "preview" ? (/\.pdf$/i.test(file?.name || "") ? "Reading PDF… (up to 30s)" : "Reading…") : "Upload Excel, PDF or zip"}
      </Button>
      <p className="text-[11px] text-muted-foreground mt-1">.xls, .xlsx or .pdf up to 20 MB · a .zip opens as a list to pick from</p>
      {pickItems && !pickOpen && !open && <Button variant="ghost" size="sm" className="mt-1 min-h-11 px-2" onClick={() => setPickOpen(true)} data-testid="button-reopen-zip-list">
        <FileArchive className="mr-2 h-4 w-4" />Pick another from {pickSource} ({pickDone.size}/{pickItems.length} added)</Button>}
      {error && !open && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
    <Dialog open={pickOpen} onOpenChange={setPickOpen}>
      <DialogContent className="max-w-2xl max-h-[85dvh] flex flex-col" data-testid="unit-evidence-picker">
        <DialogHeader>
          <DialogTitle>Pick a sheet for unit {unitRef}</DialogTitle>
          <DialogDescription>{pickSource} · {pickItems?.length ?? 0} files. Choose one to read and review; you come back here after saving it.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={pickSearch} onChange={e => setPickSearch(e.target.value)} placeholder={`Search, e.g. "${unitRef}" or a tenant`} className="pl-9 min-h-11" data-testid="input-zip-search" autoFocus />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 divide-y divide-border">
          {(pickItems || []).filter(it => { const q = pickSearch.trim().toLowerCase(); return !q || (it.folder + " " + it.name).toLowerCase().includes(q); }).map(it => {
            const done = pickDone.has(it.key);
            return <button key={it.key} type="button" disabled={!!busy} data-testid="zip-pick-item"
              className="w-full min-h-11 text-left py-2 px-1 flex items-start gap-2 hover:bg-muted rounded disabled:opacity-50"
              onClick={async () => {
                try { const f = await it.load(); setPickOpen(false); setPickCurrent(it.key); await chooseFile([f]); }
                catch (e: any) { setError(e?.message || "That file could not be opened."); }
              }}>
              {/\.pdf$/i.test(it.name) ? <FileText className="h-4 w-4 mt-0.5 shrink-0" /> : <FileSpreadsheet className="h-4 w-4 mt-0.5 shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block text-sm break-words">{it.name}</span>
                {it.folder && <span className="block text-xs text-muted-foreground truncate" title={it.folder}>{(() => { const parts = it.folder.split(" › "); return (parts.length > 2 ? "… › " : "") + parts.slice(-2).join(" › "); })()}</span>}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{done ? <span className="inline-flex items-center gap-1 text-foreground"><Check className="h-3.5 w-3.5" />Added</span> : `${Math.max(1, Math.round(it.size / 1024))} KB`}</span>
            </button>;
          })}
        </div>
        {error && pickOpen && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
    <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); setError(""); if (!value && pickCurrent) { setPickCurrent(null); setPickOpen(true); } } }}>
      <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto pb-0 max-md:top-auto max-md:bottom-0 max-md:translate-y-0 max-md:rounded-b-none" data-testid="unit-evidence-preview" onOpenAutoFocus={event => { event.preventDefault(); title.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle ref={title} tabIndex={-1} className="outline-none">Add evidence to unit {unitRef}</DialogTitle>
          <DialogDescription>{isPdf
            ? "These values were read from the PDF by AI. Check each one against the document before saving. Saving adds an evidence entry and keeps the original PDF."
            : "Check the values read from the workbook. Saving adds an evidence entry and keeps the original Excel file."}</DialogDescription>
        </DialogHeader>
        <p className="flex items-start gap-2 text-sm break-all">{isPdf ? <FileText className="h-4 w-4 shrink-0 mt-0.5" /> : <FileSpreadsheet className="h-4 w-4 shrink-0 mt-0.5" />}{preview?.fileName}</p>
        {preview && preview.candidates.length > 1 ? <div>
          <label htmlFor="upload-evidence-sheet" className="text-xs font-medium">{isPdf ? "Analysis" : "Worksheet"}</label>
          <select id="upload-evidence-sheet" className="mt-1 w-full min-h-11 rounded-md border border-input bg-background px-2 text-sm" value={candidateIndex} disabled={!!busy}
            onChange={event => { const index = Number(event.target.value); setCandidateIndex(index); setDraft(preview.candidates[index]); setConfirmed(false); setError(""); }}>
            {preview.candidates.map((item, index) => <option key={index} value={index}>{item.sheetName}{item.unitRef ? ` · Unit ${item.unitRef}` : ""}</option>)}
          </select>
        </div> : !isPdf && <p className="text-xs text-muted-foreground">Worksheet: {candidate?.sheetName}</p>}
        {!!preview?.warnings.length && <div className="rounded-lg border border-border bg-muted p-3 text-sm space-y-1" data-testid="unit-evidence-warnings">
          {preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
        </div>}
        {candidate?.unitMismatch && <div className="rounded-lg border border-destructive/50 p-3 text-sm" data-testid="unit-evidence-mismatch">
          <p>The {isPdf ? "PDF" : "worksheet"} names unit <strong>{candidate.unitRef}</strong>. You selected <strong>{unitRef}</strong>.</p>
          <label className="mt-2 flex min-h-11 items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={confirmed} disabled={!!busy} onChange={event => setConfirmed(event.target.checked)} data-testid="confirm-unit-evidence-mismatch" />
            <span>Link this evidence to unit {unitRef}. Keep its saved unit reference.</span>
          </label>
        </div>}
        {!candidate?.unitRef && <p className="text-sm text-muted-foreground">No unit reference was found in the {isPdf ? "PDF" : "sheet"}. This evidence will be linked to the selected unit, {unitRef}.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {field("tenant", "Tenant")}{field("transactionType", "Transaction type")}
          {field("transactionDate", "Transaction date", "date")}{field("sizeSqft", "Size sq ft", "number")}
          {field("zoneA", "Headline Zone A £psf", "number")}{field("netZoneA", "Net Zone A £psf", "number")}
          {field("itza", "ITZA sq ft", "number")}
          {field("headlineRent", "Headline £pa", "number")}{field("netEffective", "Net effective £pa", "number")}
          {field("term", "Term")}{field("concession", "Concessions")}
        </div>
        <div><label htmlFor="upload-evidence-notes" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</label>
          <textarea id="upload-evidence-notes" data-testid="upload-evidence-notes" className="mt-1 w-full min-h-24 rounded-md border border-input bg-background p-2 text-sm" value={draft.notes || ""} disabled={busy === "save"}
            onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="sticky bottom-0 bg-background pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] flex justify-end gap-2 border-t border-border">
          <Button variant="outline" disabled={!!busy} onClick={() => { setOpen(false); setError(""); if (pickCurrent) { setPickCurrent(null); setPickOpen(true); } }}>{pickCurrent ? "Back to list" : "Cancel"}</Button>
          <Button disabled={!!busy || !candidate || (candidate.unitMismatch && !confirmed)} onClick={() => void save()} data-testid="button-save-unit-evidence">
            {busy === "save" ? "Saving…" : `Save to unit ${unitRef}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
