// A trust's structure on the transaction's AML box (Jack, 23 November 2026:
// "Remove KYC4u on trusts. We need you to build the trust structuring"). BGP
// records what the trust deed says: its kind, HMRC's registration, the
// settlor's wealth, and its people. Each person BGP's policy asks to verify
// then shows under People to check with a link of their own. Rules:
// shared/trust-structure.ts. No form element here: the dialog opens over the deal form.
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Pencil, Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  TRS_STATUSES, TRUST_KINDS, TRUST_ROLES, trustPersonOwesChecks, trustRoleWords,
  type TrsStatus, type TrustGap, type TrustKind, type TrustRole, type TrustStructure, type TrustStructureRecord,
} from "@shared/trust-structure";

export interface TrustStructureView {
  companyId: string; name: string; trust: boolean;
  record: TrustStructureRecord | null;
  documents: { deed: boolean; trs: boolean };
  gaps: TrustGap[];
}

const plain = (e: unknown) => String((e as any)?.message || e).replace(/^\d+:\s*/, "").replace(/^\{"message":"(.*)"\}$/, "$1");
const keyFor = (companyId: string) => ["/api/trust-structure", companyId];

export function useTrustStructure(companyId: string | null | undefined, enabled = true) {
  return useQuery<TrustStructureView>({ queryKey: keyFor(String(companyId)), enabled: !!companyId && enabled, staleTime: 30_000 });
}

function refreshAfter(companyId: string, dealId?: string | null) {
  queryClient.invalidateQueries({ queryKey: keyFor(companyId) });
  if (dealId) {
    queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/aml/deal", dealId, "client-checks"] });
    queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard", "deal", dealId] });
  }
}

/** The summary line for the AML box: how many people, and what is still to do. */
export function trustSummary(view: TrustStructureView | undefined): string {
  if (!view) return "";
  const s = view.record?.structure;
  if (!s) return "structure not recorded";
  const n = s.people.length;
  return `${TRUST_KINDS[s.kind].split(" (")[0].toLowerCase()}, ${n} ${n === 1 ? "person" : "people"}${view.gaps.length ? ` · ${view.gaps.length} to do` : ""}`;
}

function DocUpload({ companyId, dealId, docType, label }: { companyId: string; dealId?: string | null; docType: string; label: string }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const send = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("companyId", companyId);
      fd.append("docType", docType);
      if (dealId) fd.append("dealId", dealId);
      fd.append("notes", `${label}, added by BGP from the trust's structure`);
      const res = await fetch("/api/kyc/documents/upload", { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(plain(await res.text()));
      toast({ title: `${label} added to the trust's KYC record` });
      refreshAfter(companyId, dealId);
    } catch (e) {
      toast({ title: "Not added", description: plain(e), variant: "destructive" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <>
      <input ref={input} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx" onChange={e => { const f = e.target.files?.[0]; if (f) void send(f); }} />
      <button type="button" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline disabled:opacity-50" disabled={busy} onClick={() => input.current?.click()} data-testid={`trust-upload-${docType}`}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}Add it
      </button>
    </>
  );
}

export function TrustStructurePanel({ companyId, dealId, partyName, onPeople }: { companyId: string; dealId?: string | null; partyName: string; onPeople?: () => void }) {
  const q = useTrustStructure(companyId);
  const [editing, setEditing] = useState(false);
  if (q.isLoading) return <p className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Reading the trust's structure…</p>;
  if (q.isError || !q.data) return <p className="text-xs text-red-700 dark:text-red-400">The trust's structure could not be read: {plain(q.error)}</p>;
  const view = q.data;
  const s = view.record?.structure || null;
  const recorded = view.gaps.filter(g => g.from === "recorded");
  return (
    <div className="space-y-2 rounded-md border border-border/70 px-2.5 py-2 text-xs" data-testid={`trust-structure-${companyId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Trust structure</span>
        {view.record && <span className="text-muted-foreground">recorded by {view.record.updatedBy || "BGP"} · {new Date(view.record.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
        <Button type="button" size="sm" variant={s ? "outline" : "default"} className="ml-auto h-7 text-xs" onClick={() => setEditing(true)} data-testid={`trust-structure-edit-${companyId}`}>
          {s ? <><Pencil className="mr-1 h-3 w-3" />Change</> : <><Plus className="mr-1 h-3 w-3" />Record it</>}
        </Button>
      </div>
      {!s && <p className="text-muted-foreground">From the trust deed: what kind of trust it is, whether HMRC holds it, where the settlor's money came from, and its people. Each person who has to be verified then gets their own link under People to check.</p>}
      {s && (
        <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Kind</dt><dd>{TRUST_KINDS[s.kind]}{s.established ? ` · settled ${s.established}` : ""}{s.governingLaw ? ` · ${s.governingLaw} law` : ""}</dd>
          <dt className="text-muted-foreground">HMRC</dt><dd>{TRS_STATUSES[s.trsStatus]}{s.trsReference ? ` · ${s.trsReference}` : ""}</dd>
          {s.beneficiaryClass && <><dt className="text-muted-foreground">Beneficiaries</dt><dd className="whitespace-pre-line">{s.beneficiaryClass}</dd></>}
          <dt className="text-muted-foreground">Settlor's wealth</dt><dd className="whitespace-pre-line">{s.settlorWealth || <span className="text-amber-800 dark:text-amber-300">not recorded</span>}</dd>
        </dl>
      )}
      {s && s.people.length > 0 && (
        <ul className="divide-y divide-border/60 rounded border border-border/60" data-testid={`trust-people-${companyId}`}>
          {s.people.map(p => (
            <li key={p.key} className="flex flex-wrap items-center gap-x-2 px-2 py-1">
              <span className="font-medium">{p.name}</span>
              <span className="text-muted-foreground">{trustRoleWords(p.roles)}{p.corporate ? " · a company" : ""}{p.share ? ` · ${p.share}` : ""}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{trustPersonOwesChecks(p, s.kind) ? "verified: own link" : p.corporate ? "screened as a company" : "screened"}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1" data-testid={`trust-docs-${companyId}`}>
        <span className="inline-flex items-center gap-1">
          {view.documents.deed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
          Trust deed {view.documents.deed ? "on file" : "not on file"}
          {!view.documents.deed && <DocUpload companyId={companyId} dealId={dealId} docType="trust_deed" label="Trust deed" />}
        </span>
        {s?.trsStatus !== "not_required" && (
          <span className="inline-flex items-center gap-1">
            {view.documents.trs ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
            HMRC's proof of registration {view.documents.trs ? "on file" : "not on file"}
            {!view.documents.trs && <DocUpload companyId={companyId} dealId={dealId} docType="trs_excerpt" label="HMRC's proof of registration" />}
          </span>
        )}
      </div>
      {view.gaps.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-amber-800 dark:text-amber-300" data-testid={`trust-gaps-${companyId}`}>
          {recorded.map(g => <li key={g.key}>{g.words}</li>)}
          {view.gaps.filter(g => g.from === "document").map(g => <li key={g.key}>{g.words}: the client checks ask for it, or add it above</li>)}
        </ul>
      )}
      {s && s.people.some(p => trustPersonOwesChecks(p, s.kind)) && onPeople && (
        <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={onPeople}>Send each person their own link, under People to check</button>
      )}
      {editing && <TrustStructureDialog companyId={companyId} dealId={dealId} partyName={partyName} initial={s} onClose={() => setEditing(false)} />}
    </div>
  );
}

interface PersonDraft {
  id: number; name: string; roles: TrustRole[]; corporate: boolean; companyNumber: string; country: string;
  month: string; year: string; share: string; note: string;
}
let nextId = 1;
const blankPerson = (roles: TrustRole[] = []): PersonDraft => ({ id: nextId++, name: "", roles, corporate: false, companyNumber: "", country: "", month: "", year: "", share: "", note: "" });

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export function TrustStructureDialog({ companyId, dealId, partyName, initial, onClose }: {
  companyId: string; dealId?: string | null; partyName: string; initial: TrustStructure | null; onClose: () => void;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState<TrustKind>(initial?.kind || "unknown");
  const [established, setEstablished] = useState(initial?.established || "");
  const [governingLaw, setGoverningLaw] = useState(initial?.governingLaw || "");
  const [trsStatus, setTrsStatus] = useState<TrsStatus>(initial?.trsStatus || "unknown");
  const [trsReference, setTrsReference] = useState(initial?.trsReference || "");
  const [beneficiaryClass, setBeneficiaryClass] = useState(initial?.beneficiaryClass || "");
  const [settlorWealth, setSettlorWealth] = useState(initial?.settlorWealth || "");
  const [people, setPeople] = useState<PersonDraft[]>(() => initial?.people.length
    ? initial.people.map(p => ({
        id: nextId++, name: p.name, roles: [...p.roles], corporate: p.corporate, companyNumber: p.companyNumber || "", country: p.country || "",
        month: p.dob?.month ? String(p.dob.month) : "", year: p.dob?.year ? String(p.dob.year) : "", share: p.share || "", note: p.note || "",
      }))
    : [blankPerson(["settlor"]), blankPerson(["trustee"])]);

  const change = (id: number, patch: Partial<PersonDraft>) => setPeople(list => list.map(p => (p.id === id ? { ...p, ...patch } : p)));
  const toggleRole = (id: number, role: TrustRole) => setPeople(list => list.map(p => (p.id === id
    ? { ...p, roles: p.roles.includes(role) ? p.roles.filter(r => r !== role) : [...p.roles, role] } : p)));

  const save = useMutation({
    mutationFn: async () => {
      const structure = {
        kind, established, governingLaw, trsStatus, trsReference, beneficiaryClass, settlorWealth,
        people: people.filter(p => p.name.trim()).map(p => ({
          name: p.name, roles: p.roles, corporate: p.corporate, companyNumber: p.companyNumber, country: p.country,
          dob: p.year ? { year: Number(p.year), month: p.month ? Number(p.month) : null } : null, share: p.share, note: p.note,
        })),
      };
      return (await apiRequest("PUT", `/api/trust-structure/${companyId}`, { structure, dealId: dealId || null })).json();
    },
    onSuccess: () => {
      toast({ title: "Trust structure saved", description: "Everyone on it is screened again now." });
      refreshAfter(companyId, dealId);
      onClose();
    },
    onError: e => toast({ title: "Not saved", description: plain(e), variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="trust-structure-dialog">
        <DialogHeader>
          <DialogTitle>Trust structure: {partyName}</DialogTitle>
          <DialogDescription>From the trust deed. The settlor, the trustees, any protector and anyone else with control each do their own identity check and proof of address; beneficiaries too unless the trust is discretionary. Everyone named is screened.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Kind of trust</Label>
              <select className={selectClass} value={kind} onChange={e => setKind(e.target.value as TrustKind)} data-testid="trust-kind">
                {(Object.keys(TRUST_KINDS) as TrustKind[]).map(k => <option key={k} value={k}>{TRUST_KINDS[k]}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label>Settled (date or year)</Label><Input value={established} onChange={e => setEstablished(e.target.value)} placeholder="e.g. 12 March 2004" /></div>
            <div className="space-y-1"><Label>HMRC's Trust Registration Service</Label>
              <select className={selectClass} value={trsStatus} onChange={e => setTrsStatus(e.target.value as TrsStatus)} data-testid="trust-trs">
                {(Object.keys(TRS_STATUSES) as TrsStatus[]).map(k => <option key={k} value={k}>{TRS_STATUSES[k]}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label>Its URN or UTR</Label><Input value={trsReference} onChange={e => setTrsReference(e.target.value)} placeholder="e.g. XATRUST80000001" /></div>
            <div className="space-y-1 sm:col-span-2"><Label>Governing law</Label><Input value={governingLaw} onChange={e => setGoverningLaw(e.target.value)} placeholder="e.g. England and Wales" /></div>
          </div>
          <div className="space-y-1"><Label>Where the settlor's money came from</Label>
            <Textarea rows={2} value={settlorWealth} onChange={e => setSettlorWealth(e.target.value)} placeholder="e.g. Proceeds of the sale of the family business in 2003, per the accountant's letter" data-testid="trust-wealth" />
          </div>
          {(kind === "discretionary" || beneficiaryClass) && (
            <div className="space-y-1"><Label>Class of beneficiaries (as the deed describes it)</Label>
              <Textarea rows={2} value={beneficiaryClass} onChange={e => setBeneficiaryClass(e.target.value)} placeholder="e.g. The settlor's children and remoter issue" />
            </div>
          )}
          <div className="space-y-2">
            <Label>People on the trust</Label>
            {people.map(p => (
              <div key={p.id} className="space-y-2 rounded-md border border-border p-2" data-testid="trust-person-row">
                <div className="flex items-center gap-2">
                  <Input value={p.name} onChange={e => change(p.id, { name: e.target.value })} placeholder={p.corporate ? "Company name" : "Full name"} className="flex-1" data-testid="trust-person-name" />
                  <button type="button" className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Remove this person" onClick={() => setPeople(list => list.filter(x => x.id !== p.id))}><X className="h-4 w-4" /></button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(Object.keys(TRUST_ROLES) as TrustRole[]).map(r => (
                    <button key={r} type="button" onClick={() => toggleRole(p.id, r)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${p.roles.includes(r) ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                      data-testid={`trust-role-${r}`}>{TRUST_ROLES[r]}</button>
                  ))}
                  <label className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <input type="checkbox" checked={p.corporate} onChange={e => change(p.id, { corporate: e.target.checked })} />A company
                  </label>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {p.corporate
                    ? <Input value={p.companyNumber} onChange={e => change(p.id, { companyNumber: e.target.value })} placeholder="Company number" />
                    : <div className="flex gap-1">
                        <Input value={p.month} onChange={e => change(p.id, { month: e.target.value.replace(/\D/g, "").slice(0, 2) })} placeholder="Born: month" inputMode="numeric" />
                        <Input value={p.year} onChange={e => change(p.id, { year: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="year" inputMode="numeric" />
                      </div>}
                  <Input value={p.country} onChange={e => change(p.id, { country: e.target.value })} placeholder={p.corporate ? "Country registered" : "Country they live in"} />
                  {p.roles.includes("beneficiary") && <Input value={p.share} onChange={e => change(p.id, { share: e.target.value })} placeholder="Their share (e.g. 50%)" />}
                </div>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setPeople(list => [...list, blankPerson()])} data-testid="trust-add-person">
              <Plus className="mr-1 h-3.5 w-3.5" />Add a person
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate()} data-testid="trust-structure-save">
            {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
