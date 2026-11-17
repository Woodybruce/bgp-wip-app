// Investment Research (Jack, 2026-11-17): a simple filing place for the
// reports and documents the investment team saves down, filed by sector (the
// tracker's classes, plus General). What is saved here is also read by
// ChatBGP's knowledge search, and each paper's key points are read once
// (server/investment-research-intel.ts): shown here under "Key points", used by
// ChatBGP's get_market_research, and a recent paper is posted to the Insights
// feed. Server: server/investment-research.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, FileText, Loader2, Search, Trash2, Upload } from "lucide-react";

type Fact = { topic: string; figure: string; place: string | null; period: string | null; quote: string };
type KeyPoints = { status: "read" | "failed" | "skipped"; published: string | null; publisher: string | null; headline: string | null; summary: string | null; outlook: string | null; facts: Fact[]; error: string | null };
type ResearchFile = { id: string; fileName: string; sector: string; note: string | null; sizeBytes: number | null; addedAt: string; addedBy: string | null; readable: boolean; keyPoints: KeyPoints | null };
type Feed = { sectors: string[]; files: ResearchFile[] };

const KEY = ["/api/investment-research"];
const AUTO = "auto";
const fmtSize = (b: number | null) => b == null ? "" : b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMonth = (ym: string | null) => { if (!ym) return null; const [y, m] = ym.split("-").map(Number); return MONTHS[m - 1] ? `${MONTHS[m - 1]} ${y}` : null; };
const fmtDate = (d: string) => { try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); } catch { return ""; } };

export default function InvestmentResearch() {
  const { toast } = useToast();
  // While any paper is still waiting to be read, look again every 20 seconds.
  const { data, isLoading } = useQuery<Feed>({
    queryKey: KEY,
    refetchInterval: (q) => ((q.state.data as Feed | undefined)?.files || []).some((f) => !f.keyPoints) ? 20_000 : false,
  });
  const sectors = data?.sectors || ["General"];
  const files = data?.files || [];
  const [sector, setSector] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  // ?file=<id> (a link from the Insights feed or ChatBGP) opens that paper.
  const [focus] = useState(() => { try { return new URLSearchParams(window.location.search).get("file"); } catch { return null; } });
  useEffect(() => {
    if (!focus || !data) return;
    const el = document.querySelector(`[data-testid="research-row-${CSS.escape(focus)}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [focus, !!data]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of files) m[f.sector] = (m[f.sector] || 0) + 1;
    return m;
  }, [files]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return files.filter((f) => (sector === "all" || f.sector === sector)
      && (!q || `${f.fileName} ${f.note || ""} ${f.addedBy || ""} ${f.keyPoints?.publisher || ""} ${f.keyPoints?.headline || ""} ${f.keyPoints?.summary || ""}`.toLowerCase().includes(q)));
  }, [files, sector, search]);

  const update = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => (await apiRequest("PATCH", `/api/investment-research/${id}`, body)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });
  const reread = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/investment-research/${id}/read`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (e: any) => toast({ title: "Couldn't read it", description: e?.message, variant: "destructive" }),
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
          Each paper is read for its key points: ChatBGP draws on them, newest first, and a recent paper goes into the Insights feed.
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
            <div key={f.id} className={`flex items-start gap-3 px-3 py-2.5 ${focus === f.id ? "bg-muted/60" : ""}`} data-testid={`research-row-${f.id}`}>
              <FileText className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => open(f)} className="text-sm font-medium text-left hover:underline break-words" data-testid={`research-open-${f.id}`}>
                  {f.fileName}
                </button>
                <NoteLine file={f} onSave={(note) => update.mutate({ id: f.id, body: { note } })} />
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {[f.keyPoints?.publisher, fmtMonth(f.keyPoints?.published || null) ? `published ${fmtMonth(f.keyPoints?.published || null)}` : null,
                    `added ${fmtDate(f.addedAt)}`, f.addedBy, fmtSize(f.sizeBytes)].filter(Boolean).join(" · ")}
                </p>
                <KeyPointsLine file={f} startOpen={focus === f.id} reading={reread.isPending && reread.variables === f.id} onReread={() => reread.mutate(f.id)} />
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

      {uploadOpen && <UploadDialog sectors={sectors} initialSector={sector === "all" ? AUTO : sector} onClose={() => setUploadOpen(false)} />}
    </div>
  );
}

function KeyPointsLine({ file, startOpen, reading, onReread }: { file: ResearchFile; startOpen: boolean; reading: boolean; onReread: () => void }) {
  const [open, setOpen] = useState(startOpen);
  const k = file.keyPoints;
  if (!k || reading) {
    return <p className="text-[11px] text-muted-foreground mt-1 inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Reading the key points…</p>;
  }
  if (k.status !== "read") {
    return (
      <p className="text-[11px] text-muted-foreground mt-1">
        Key points not read{k.error ? `: ${k.error}` : ""}.{" "}
        {k.status === "failed" && <button type="button" onClick={onReread} className="underline hover:text-foreground" data-testid={`research-reread-${file.id}`}>Read again</button>}
      </p>
    );
  }
  return (
    <div className="mt-1" data-testid={`research-key-points-${file.id}`}>
      <button type="button" onClick={() => setOpen(!open)} className="text-xs text-left inline-flex items-start gap-1 hover:underline">
        {open ? <ChevronDown className="h-3.5 w-3.5 mt-px shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 mt-px shrink-0" />}
        <span><span className="font-medium">Key points:</span> {k.headline}</span>
      </button>
      {open && (
        <div className="ml-4 mt-1 space-y-1.5 text-xs">
          {k.summary && <p className="text-muted-foreground">{k.summary}</p>}
          {k.facts.length > 0 && (
            <ul className="space-y-0.5">
              {k.facts.map((f, i) => (
                <li key={i} title={f.quote}>
                  <span className="text-muted-foreground">{f.topic}{f.place ? `, ${f.place}` : ""}{f.period ? ` (${f.period})` : ""}:</span>{" "}
                  <span className="font-medium tabular-nums">{f.figure}</span>
                </li>
              ))}
            </ul>
          )}
          {k.outlook && <p><span className="text-muted-foreground">Outlook:</span> {k.outlook}</p>}
          <button type="button" onClick={onReread} className="text-[11px] text-muted-foreground underline hover:text-foreground">Read again</button>
        </div>
      )}
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
      const saved: ResearchFile[] = (await r.json().catch(() => ({})))?.files || [];
      await queryClient.invalidateQueries({ queryKey: KEY });
      const where = Array.from(new Set(saved.map((f) => f.sector)));
      toast({
        title: `${picked.length} file${picked.length === 1 ? "" : "s"} filed under ${where.length === 1 ? where[0] : `${where.length} sectors`}`,
        description: where.length > 1 ? saved.map((f) => `${f.fileName} → ${f.sector}`).join("\n") : undefined,
      });
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
              <SelectContent>
                <SelectItem value={AUTO}>Choose for me</SelectItem>
                {sectors.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            {sector === AUTO && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Each file goes where its name and text clearly point (e.g. "London office" → Office London); anything mixed or unclear goes to General. You can move it after.
              </p>
            )}
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
