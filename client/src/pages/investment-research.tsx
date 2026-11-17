// Investment Research (Jack, 2026-11-17): a simple filing place for the
// reports and documents the investment team saves down, filed by sector (the
// tracker's classes, plus General). What is saved here is also read by
// ChatBGP's knowledge search, so it feeds the app's market intel.
// Server: server/investment-research.ts.
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, Search, Trash2, Upload } from "lucide-react";

type ResearchFile = { id: string; fileName: string; sector: string; note: string | null; sizeBytes: number | null; addedAt: string; addedBy: string | null; readable: boolean };
type Feed = { sectors: string[]; files: ResearchFile[] };

const KEY = ["/api/investment-research"];
const fmtSize = (b: number | null) => b == null ? "" : b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const fmtDate = (d: string) => { try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); } catch { return ""; } };

export default function InvestmentResearch() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Feed>({ queryKey: KEY });
  const sectors = data?.sectors || ["General"];
  const files = data?.files || [];
  const [sector, setSector] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of files) m[f.sector] = (m[f.sector] || 0) + 1;
    return m;
  }, [files]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return files.filter((f) => (sector === "all" || f.sector === sector)
      && (!q || `${f.fileName} ${f.note || ""} ${f.addedBy || ""}`.toLowerCase().includes(q)));
  }, [files, sector, search]);

  const update = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => (await apiRequest("PATCH", `/api/investment-research/${id}`, body)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/investment-research/${id}`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (e: any) => toast({ title: "Couldn't delete", description: e?.message, variant: "destructive" }),
  });

  const open = async (f: ResearchFile) => {
    const r = await fetch(`/api/investment-research/${f.id}/file`, { headers: getAuthHeaders(), credentials: "include" });
    if (!r.ok) { toast({ title: "Couldn't open the file", variant: "destructive" }); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener";
    if (!/pdf|image/.test(r.headers.get("content-type") || "")) a.download = f.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto w-full" data-testid="investment-research">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search research..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-research-search" />
        </div>
        <p className="text-xs text-muted-foreground flex-1 min-w-[200px]">
          Saved here, a PDF or text file is also read by ChatBGP, so it can draw on it for market intel.
        </p>
        <Button onClick={() => setUploadOpen(true)} data-testid="button-research-upload">
          <Upload className="h-4 w-4 mr-1" /> Add files
        </Button>
      </div>

      <div className="flex gap-1.5 flex-wrap" data-testid="research-sectors">
        <Pill active={sector === "all"} onClick={() => setSector("all")} data-testid="research-sector-all">
          All <span className="opacity-60 font-mono tabular-nums">{files.length}</span>
        </Pill>
        {sectors.map((s) => (
          <Pill key={s} active={sector === s} onClick={() => setSector(sector === s ? "all" : s)} data-testid={`research-sector-${s.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
            {s} <span className="opacity-60 font-mono tabular-nums">{counts[s] || 0}</span>
          </Pill>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-10 text-center">Loading research…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
          {files.length === 0 ? "No research saved yet. Press Add files to file your first documents." : "Nothing filed here yet."}
        </div>
      ) : (
        <div className="rounded-md border divide-y" data-testid="research-list">
          {shown.map((f) => (
            <div key={f.id} className="flex items-start gap-3 px-3 py-2.5" data-testid={`research-row-${f.id}`}>
              <FileText className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => open(f)} className="text-sm font-medium text-left hover:underline break-words" data-testid={`research-open-${f.id}`}>
                  {f.fileName}
                </button>
                <NoteLine file={f} onSave={(note) => update.mutate({ id: f.id, body: { note } })} />
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {[fmtDate(f.addedAt), f.addedBy, fmtSize(f.sizeBytes), f.readable ? "read by ChatBGP" : "filed by name only"].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Select value={f.sector} onValueChange={(v) => update.mutate({ id: f.id, body: { sector: v } })}>
                <SelectTrigger className="h-8 w-[190px] text-xs shrink-0" data-testid={`research-sector-select-${f.id}`}><SelectValue /></SelectTrigger>
                <SelectContent>{sectors.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Delete"
                onClick={() => { if (confirm(`Delete "${f.fileName}"?`)) remove.mutate(f.id); }} data-testid={`research-delete-${f.id}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {uploadOpen && <UploadDialog sectors={sectors} initialSector={sector === "all" ? "General" : sector} onClose={() => setUploadOpen(false)} />}
    </div>
  );
}

function NoteLine({ file, onSave }: { file: ResearchFile; onSave: (note: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(file.note || "");
  if (editing) {
    return (
      <Input autoFocus value={val} onChange={(e) => setVal(e.target.value)} className="h-7 text-xs mt-1"
        onBlur={() => { setEditing(false); if (val !== (file.note || "")) onSave(val); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setVal(file.note || ""); setEditing(false); } }} />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} className="block text-xs text-muted-foreground text-left mt-0.5 hover:text-foreground">
      {file.note || "+ Add a note"}
    </button>
  );
}

function UploadDialog({ sectors, initialSector, onClose }: { sectors: string[]; initialSector: string; onClose: () => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const [sector, setSector] = useState(initialSector);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!picked.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of picked) fd.append("files", f);
      fd.append("sector", sector);
      if (note.trim()) fd.append("note", note.trim());
      const r = await fetch("/api/investment-research", { method: "POST", body: fd, headers: getAuthHeaders(), credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `Upload failed (${r.status})`);
      await queryClient.invalidateQueries({ queryKey: KEY });
      toast({ title: `${picked.length} file${picked.length === 1 ? "" : "s"} filed under ${sector}` });
      onClose();
    } catch (e: any) {
      toast({ title: "Couldn't upload", description: e?.message, variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add research</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <input ref={input} type="file" multiple className="hidden" onChange={(e) => setPicked(Array.from(e.target.files || []))} data-testid="input-research-files" />
          <Button variant="outline" className="w-full" onClick={() => input.current?.click()}>
            <Upload className="h-4 w-4 mr-1" /> {picked.length ? `${picked.length} file${picked.length === 1 ? "" : "s"} chosen` : "Choose files"}
          </Button>
          {picked.length > 0 && <ul className="text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-y-auto">{picked.map((f) => <li key={f.name}>{f.name}</li>)}</ul>}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Sector</label>
            <Select value={sector} onValueChange={setSector}>
              <SelectTrigger data-testid="select-research-sector"><SelectValue /></SelectTrigger>
              <SelectContent>{sectors.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Note (optional)</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Q3 London office market report" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={send} disabled={!picked.length || busy} data-testid="button-research-save">{busy ? "Filing…" : "File"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
