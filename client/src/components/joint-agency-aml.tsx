// AML file note: joint sole agency (Jack, 2026-11-11) — the New Deal
// form's "Joint Agency Lead Deal" switch, the note card on a deal, and the
// register of every note. Wording, storage and sign-off rules live in
// server/joint-agency-aml.ts.
//
// Flow on the form: switch it on → add the heads of terms and the five
// facts fill themselves, or type them in → the deal can't be saved with any
// of them blank → on save the note is recorded against the new deal.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Check, Download, FileText, Handshake, Loader2, ShieldCheck, Upload } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface JointAgencyState {
  on: boolean;
  property: string;
  client: string;
  coAgent: string;
  rentPa: string;
  tenant: string;
  hotsFileName: string;
}
export const EMPTY_JOINT_AGENCY: JointAgencyState = { on: false, property: "", client: "", coAgent: "", rentPa: "", tenant: "", hotsFileName: "" };

const rentNumber = (v: string) => { const n = parseFloat(String(v).replace(/[£,\s]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };

/** The details still missing, in the words the form uses — empty when the note can be saved. */
export function jointAgencyMissing(s: JointAgencyState): string[] {
  if (!s.on) return [];
  const missing: string[] = [];
  if (!s.property.trim()) missing.push("Property");
  if (!s.client.trim()) missing.push("Client");
  if (!s.coAgent.trim()) missing.push("Co-agent");
  if (!rentNumber(s.rentPa)) missing.push("Rent");
  if (!s.tenant.trim()) missing.push("Tenant");
  return missing;
}

export const jointAgencyPayload = (s: JointAgencyState) => ({
  property: s.property.trim(), client: s.client.trim(), coAgent: s.coAgent.trim(), rentPa: rentNumber(s.rentPa), tenant: s.tenant.trim(),
  hotsFileName: s.hotsFileName || null,
});

export function JointAgencyWidget({ value, onChange, defaults, signedBy, showErrors }: {
  value: JointAgencyState;
  onChange: (next: JointAgencyState) => void;
  /** What the deal form already knows, to save typing. */
  defaults: { property?: string; client?: string; rentPa?: string; tenant?: string };
  signedBy?: string;
  showErrors?: boolean;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const set = (patch: Partial<JointAgencyState>) => onChange({ ...value, ...patch });
  const fromDeal = (s: JointAgencyState): JointAgencyState => ({
    ...s,
    property: s.property || defaults.property || "",
    client: s.client || defaults.client || "",
    rentPa: s.rentPa || defaults.rentPa || "",
    tenant: s.tenant || defaults.tenant || "",
  });

  async function readHots(file: File) {
    setReading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/crm/deals/new/parse-hots", { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || res.statusText);
      const x = json?.extracted || {};
      const next: JointAgencyState = {
        ...value,
        hotsFileName: file.name,
        property: x.propertyAddress || value.property,
        client: x.landlordName || value.client,
        coAgent: x.jointAgent || value.coAgent,
        rentPa: x.rentPa != null ? String(x.rentPa) : value.rentPa,
        tenant: x.tenantName || value.tenant,
      };
      onChange(fromDeal(next));
      const still = jointAgencyMissing(fromDeal(next));
      toast(still.length
        ? { title: "Heads of terms read", description: `Please fill in: ${still.join(", ")}.` }
        : { title: "Heads of terms read", description: "All five details filled — check them before saving." });
    } catch (e: any) {
      toast({ title: "Couldn't read the heads of terms", description: `${e?.message || "Unknown error"} — type the details in below.`, variant: "destructive" });
    } finally {
      setReading(false);
    }
  }

  const bad = (empty: boolean) => (showErrors && empty ? "border-destructive focus-visible:ring-destructive" : "");
  const need = (empty: boolean) => showErrors && empty ? <p className="text-[11px] text-destructive">Required</p> : null;
  const rent = rentNumber(value.rentPa);

  if (!value.on) {
    return (
      <button
        type="button"
        onClick={() => onChange(fromDeal({ ...value, on: true }))}
        className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 px-4 py-3 text-left transition-colors hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        data-testid="joint-agency-toggle"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Handshake className="h-4 w-4" /></span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Joint Agency Lead Deal</span>
          <span className="block text-xs text-muted-foreground">Click if another agent introduced the tenant and led the negotiations. Records the AML file note against this deal.</span>
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border-2 border-primary bg-primary/5 p-4" data-testid="joint-agency-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-4 w-4" /></span>
          <div>
            <p className="text-sm font-semibold leading-tight">Joint Agency Lead Deal</p>
            <p className="text-xs text-muted-foreground">An AML file note will be saved against this deal.</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => set({ on: false })} data-testid="joint-agency-off">Not joint agency</Button>
      </div>

      {/* Step 1 — the heads of terms */}
      <div className="rounded-md border bg-background p-3">
        <p className="text-xs font-semibold">1. Add the heads of terms</p>
        <p className="text-[11px] text-muted-foreground">The app reads them and fills in the details below. No heads of terms to hand? Skip this and type the details in.</p>
        <input ref={fileRef} type="file" accept=".pdf,.docx" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) readHots(f); e.target.value = ""; }} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={reading} onClick={() => fileRef.current?.click()} data-testid="joint-agency-hots">
            {reading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
            {reading ? "Reading the heads of terms…" : value.hotsFileName ? "Use different heads of terms" : "Add heads of terms"}
          </Button>
          {value.hotsFileName && !reading && <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><FileText className="h-3 w-3" />{value.hotsFileName}</span>}
        </div>
      </div>

      {/* Step 2 — the five facts */}
      <div className="rounded-md border bg-background p-3 space-y-2">
        <p className="text-xs font-semibold">2. Check the details <span className="font-normal text-muted-foreground">— all five are needed</span></p>
        <div className="space-y-1">
          <Label className="text-xs">Property <span className="text-destructive">*</span></Label>
          <Input value={value.property} onChange={e => set({ property: e.target.value })} placeholder="Full address" className={bad(!value.property.trim())} data-testid="joint-agency-property" />
          {need(!value.property.trim())}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Client <span className="text-destructive">*</span></Label>
            <Input value={value.client} onChange={e => set({ client: e.target.value })} placeholder="Client's name" className={bad(!value.client.trim())} data-testid="joint-agency-client" />
            {need(!value.client.trim())}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Co-agent <span className="text-destructive">*</span></Label>
            <Input value={value.coAgent} onChange={e => set({ coAgent: e.target.value })} placeholder="The other agency firm" className={bad(!value.coAgent.trim())} data-testid="joint-agency-coagent" />
            {need(!value.coAgent.trim())}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Letting at (£ per annum) <span className="text-destructive">*</span></Label>
            <Input inputMode="decimal" value={value.rentPa} onChange={e => set({ rentPa: e.target.value })} placeholder="e.g. 175000" className={bad(!rent)} data-testid="joint-agency-rent" />
            {need(!rent)}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tenant <span className="text-destructive">*</span></Label>
            <Input value={value.tenant} onChange={e => set({ tenant: e.target.value })} placeholder="Tenant's name" className={bad(!value.tenant.trim())} data-testid="joint-agency-tenant" />
            {need(!value.tenant.trim())}
          </div>
        </div>
      </div>

      {/* Step 3 — what gets recorded */}
      <div className="rounded-md border bg-background p-3">
        <p className="text-xs font-semibold">3. Recorded when you create the deal</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          The file note is saved against this deal and added to the Joint agency AML register. It states that {value.coAgent.trim() || "the co-agent"} is
          HMRC-registered, introduced {value.tenant.trim() || "the tenant"} and managed all dealings with them, and that BGP only advised its client.
          Signed: {signedBy || "you"}. Reviewed: Jack Barratt. Only switch this on if that is what happened.
        </p>
      </div>
    </div>
  );
}

type SavedNote = {
  id: string; dealId?: string; dealName?: string; dealRef?: number | string | null; savedAt: string;
  property: string; client: string; coAgent: string; rentPa: number; tenant: string;
  signedBy: string; reviewedBy: string; source?: string; hotsFileName?: string | null; paragraphs: string[];
};
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

async function downloadNote(id: string, onError: (m: string) => void) {
  try {
    const res = await fetch(`/api/joint-agency-notes/${id}/docx`, { credentials: "include", headers: getAuthHeaders() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || res.statusText);
    const name = (res.headers.get("content-disposition") || "").match(/filename="([^"]+)"/)?.[1] || "AML file note - joint agency.docx";
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e: any) { onError(e?.message || "Download failed"); }
}

/** On a deal's page: the joint agency note, when the deal has one. */
export function JointAgencyNoteCard({ dealId }: { dealId: string }) {
  const { toast } = useToast();
  const { data: notes = [] } = useQuery<SavedNote[]>({ queryKey: ["/api/crm/deals", dealId, "joint-agency-note"], queryFn: async () => {
    const res = await fetch(`/api/crm/deals/${dealId}/joint-agency-note`, { credentials: "include", headers: getAuthHeaders() });
    return res.ok ? res.json() : [];
  } });
  const note = notes[0];
  if (!note) return null;
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2" data-testid="joint-agency-note-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <div>
            <p className="text-sm font-semibold leading-tight">Joint agency — AML file note</p>
            <p className="text-xs text-muted-foreground">Signed {note.signedBy}, reviewed {note.reviewedBy} · {day(note.savedAt)}{notes.length > 1 ? ` · ${notes.length} versions on file` : ""}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => downloadNote(note.id, (m) => toast({ title: "Couldn't download the note", description: m, variant: "destructive" }))} data-testid="joint-agency-note-download">
          <Download className="mr-1 h-3.5 w-3.5" />Word
        </Button>
      </div>
      <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
        {note.paragraphs.slice(1).map((p, i) => <p key={i}>{p}</p>)}
      </div>
    </div>
  );
}

/** Every joint agency note, for an HMRC audit. */
export function JointAgencyRegisterDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const { data: notes = [], isLoading } = useQuery<SavedNote[]>({ queryKey: ["/api/joint-agency-notes"], enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Joint agency AML register</DialogTitle>
          <DialogDescription>Every AML file note saved for a Joint Agency Lead Deal, newest first. Each downloads as a Word file exactly as it was saved.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading the register…</p>
        ) : notes.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No joint agency notes yet. They appear here when a deal is created with Joint Agency Lead Deal switched on.</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto rounded border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted text-muted-foreground">
                <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:font-semibold">
                  <th>Saved</th><th>Deal</th><th>Property</th><th>Client</th><th>Co-agent</th><th>Tenant</th><th className="text-right">Rent pa</th><th>Signed</th><th>Reviewed</th><th />
                </tr>
              </thead>
              <tbody>
                {notes.map(n => (
                  <tr key={n.id} className="border-t align-top [&>td]:px-2 [&>td]:py-2" data-testid={`joint-agency-row-${n.id}`}>
                    <td className="whitespace-nowrap">{day(n.savedAt)}</td>
                    <td>{n.dealId ? <a href={`/deals/${n.dealId}`} className="text-primary hover:underline">{n.dealRef ? `#${n.dealRef} ` : ""}{n.dealName || "Deal"}</a> : "—"}</td>
                    <td>{n.property}</td>
                    <td>{n.client}</td>
                    <td>{n.coAgent}</td>
                    <td>{n.tenant}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">£{Math.round(n.rentPa).toLocaleString("en-GB")}</td>
                    <td className="whitespace-nowrap">{n.signedBy}</td>
                    <td className="whitespace-nowrap">{n.reviewedBy}</td>
                    <td>
                      <Button variant="ghost" size="sm" className="h-7 px-2" title="Download as Word" onClick={() => downloadNote(n.id, (m) => toast({ title: "Couldn't download the note", description: m, variant: "destructive" }))}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
