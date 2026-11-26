// Heads of terms before HOTs or Solicitors on the Letting Tracker (Jack,
// 26 November 2026: "when people move deal status to 'solicitors' or 'HOTs' a
// box needs to pop up saying adding HOTs", then "I want to make it a block,
// people cant bypass not adding HOTs. By adding the Heads of Terms the app
// should auto add the Landlord and Tenant"). The box has no way round it: the
// unit moves only once its heads of terms are on it (the server refuses the
// move too). The file is kept as the unit's final agreed heads of terms, read
// by the transaction's own reader, and a landlord or tenant the transaction
// does not have yet is set from it.
import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, getAuthHeaders, invalidateDealCaches, queryClient } from "@/lib/queryClient";
import type { HotsReadReply } from "@shared/deal-hots";

export type HotsGateTarget = "HOT" | "SOL";
export interface HotsGateUnit { id: string; unitName: string; dealId: string | null; propertyName: string | null; landlordId: string | null }
export interface HotsGateResult { dealId: string; added: string[]; note: string | null; /** The file just added, when one was. */ file?: File | null }

const TARGET_WORDS: Record<HotsGateTarget, string> = { HOT: "HOTs", SOL: "Solicitors" };
const ACCEPT = ".pdf,.docx";
const plain = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^\d{3}:\s*/, "");

async function post(url: string, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(url, { method: "POST", credentials: "include", headers: getAuthHeaders(), body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || `Not saved (${r.status})`);
  return j;
}

const PARTY = {
  landlord: { field: "landlordId", label: "Landlord", type: "Landlord" },
  tenant: { field: "tenantId", label: "Tenant", type: "Tenant" },
  vendor: { field: "vendorId", label: "Vendor", type: "Vendor" },
  purchaser: { field: "purchaserId", label: "Purchaser", type: "Purchaser" },
} as const;
type PartyRole = keyof typeof PARTY;
const LETTING_ROLES = ["landlord", "tenant"] as const;
const SALE_ROLES = ["vendor", "purchaser"] as const;
/** A letting names its landlord and tenant; a sale or purchase its vendor and purchaser. */
const rolesFor = (dealType: string | null | undefined): readonly PartyRole[] =>
  /^(sale|purchase|investment)/i.test(String(dealType || "").trim()) ? SALE_ROLES : LETTING_ROLES;

/** Sets the parties the transaction lacks from what the heads of terms name. */
async function addParties(dealId: string, reply: HotsReadReply, landlordId: string | null, roles: readonly PartyRole[] = LETTING_ROLES): Promise<string[]> {
  const added: string[] = [];
  for (const role of roles) {
    const m = reply.parties.find(p => p.role === role);
    if (!m || m.brand) continue;
    const { field, label, type } = PARTY[role];
    let id: string | null = m.candidates.length === 1 ? m.candidates[0].companyId : null;
    let name = id ? m.candidates[0].companyName : m.read.name;
    // The property's own landlord, when the CRM has no one record of that name.
    if (!id && role === "landlord" && landlordId) { id = landlordId; name = "the property's landlord"; }
    if (!id && m.candidates.length > 1) continue;
    if (!id) {
      const made = await (await apiRequest("POST", "/api/crm/companies", { name: m.read.name, companyType: type })).json();
      id = String(made.id);
      name = made.name;
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
    }
    await apiRequest("PUT", `/api/crm/deals/${dealId}`, { [field]: id });
    added.push(`${label}: ${name}`);
  }
  return added;
}

export function TrackerHotsGate({ unit, target, onDone, onCancel }: {
  unit: HotsGateUnit | null; target: HotsGateTarget;
  /** The heads of terms are on the unit: carry on with the move. */
  onDone: (result: HotsGateResult) => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState<"checking" | "ask" | "working">("checking");
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const unitId = unit?.id || null;

  const dealFor = async (u: HotsGateUnit): Promise<string> => {
    if (u.dealId) return u.dealId;
    const made = await (await apiRequest("POST", `/api/available-units/${u.id}/ensure-deal`)).json();
    if (!made?.dealId) throw new Error("This unit has no transaction yet.");
    queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
    return String(made.dealId);
  };

  // Heads of terms already on the unit (filed, or issued in the app): nothing to add.
  useEffect(() => {
    if (!unit) return;
    let live = true;
    setState("checking"); setError(null); setStep("");
    (async () => {
      try {
        const w = await (await apiRequest("GET", `/api/unit-hots/${encodeURIComponent(unit.id)}`)).json();
        if (!live) return;
        if (w?.finalFile || w?.issuedAt) onDone({ dealId: await dealFor(unit), added: [], note: null });
        else setState("ask");
      } catch (e) {
        if (!live) return;
        setError(plain(e)); setState("ask");
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId, target]);

  const add = async (file: File) => {
    if (!unit) return;
    if (!/\.(pdf|docx)$/i.test(file.name)) { setError("Add the heads of terms as a PDF or a Word document (.docx)."); return; }
    setState("working"); setError(null);
    try {
      setStep("Saving the heads of terms");
      const dealId = await dealFor(unit);
      await post(`/api/unit-hots/${encodeURIComponent(unit.id)}/final`, file);
      queryClient.invalidateQueries({ queryKey: ["/api/unit-hots", unit.id] });
      let added: string[] = [];
      let note: string | null = null;
      try {
        setStep("Reading the landlord and tenant");
        const reply = await post(`/api/deals/${dealId}/heads-of-terms/read`, file) as HotsReadReply;
        added = await addParties(dealId, reply, unit.landlordId);
        const named = (role: string) => reply.parties.some(p => p.role === role);
        if (!named("landlord") || !named("tenant")) note = "The heads of terms did not name both the landlord and the tenant: add them in the box.";
      } catch (e) {
        note = `The heads of terms are saved, but could not be read (${plain(e)}): add the landlord and tenant in the box.`;
      }
      invalidateDealCaches(dealId);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId] });
      onDone({ dealId, added, note });
    } catch (e) {
      setError(plain(e)); setState("ask");
    }
  };

  return (
    <HotsGateBox open={!!unit && state !== "checking"} title={unit ? `${unit.unitName}${unit.propertyName ? `, ${unit.propertyName}` : ""}` : ""}
      words={`This unit moves to ${TARGET_WORDS[target]} once its agreed heads of terms are added. The landlord and tenant are set from them.`}
      working={state === "working"} step={step} error={error} onFile={f => void add(f)} onCancel={onCancel} />
  );
}

export interface HotsGateDeal { id: string; name: string | null; dealType: string | null }

/**
 * The same block on a transaction (the Transactions table and the Edit form):
 * it moves to HOTs or Solicitors once its heads of terms are on it. Filed on
 * its Letting Tracker unit when it has one, else on the transaction itself.
 */
export function DealHotsGate({ deal, target, setParties = true, onDone, onCancel }: {
  deal: HotsGateDeal | null; target: HotsGateTarget;
  /** Off where the screen saves its own parties straight after (the Edit form). */
  setParties?: boolean;
  onDone: (result: HotsGateResult) => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState<"checking" | "ask" | "working">("checking");
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const dealId = deal?.id || null;
  const roles = rolesFor(deal?.dealType);
  const names = roles === SALE_ROLES ? "vendor and purchaser" : "landlord and tenant";

  useEffect(() => {
    if (!deal) return;
    let live = true;
    setState("checking"); setError(null); setStep(""); setUnitId(null);
    (async () => {
      try {
        const w = await (await apiRequest("GET", `/api/deals/${encodeURIComponent(deal.id)}/heads-of-terms/on-file`)).json();
        if (!live) return;
        if (w?.onFile) onDone({ dealId: deal.id, added: [], note: null });
        else { setUnitId(w?.unitId || null); setState("ask"); }
      } catch (e) {
        if (!live) return;
        setError(plain(e)); setState("ask");
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, target]);

  const add = async (file: File) => {
    if (!deal) return;
    if (!/\.(pdf|docx)$/i.test(file.name)) { setError("Add the heads of terms as a PDF or a Word document (.docx)."); return; }
    setState("working"); setError(null);
    try {
      setStep("Saving the heads of terms");
      if (unitId) {
        await post(`/api/unit-hots/${encodeURIComponent(unitId)}/final`, file);
        queryClient.invalidateQueries({ queryKey: ["/api/unit-hots", unitId] });
      } else {
        await post(`/api/deals/${encodeURIComponent(deal.id)}/heads-of-terms/file`, file);
      }
      let added: string[] = [];
      let note: string | null = null;
      if (setParties) try {
        setStep(`Reading the ${names}`);
        const reply = await post(`/api/deals/${deal.id}/heads-of-terms/read`, file) as HotsReadReply;
        added = await addParties(deal.id, reply, null, roles);
        if (roles.some(role => !reply.parties.some(p => p.role === role))) note = `The heads of terms did not name both the ${names}: add them on the transaction.`;
      } catch (e) {
        note = `The heads of terms are saved, but could not be read (${plain(e)}): add the ${names} on the transaction.`;
      }
      invalidateDealCaches(deal.id);
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", deal.id] });
      onDone({ dealId: deal.id, added, note, file });
    } catch (e) {
      setError(plain(e)); setState("ask");
    }
  };

  return (
    <HotsGateBox open={!!deal && state !== "checking"} title={deal?.name || "This transaction"}
      words={`This transaction moves to ${TARGET_WORDS[target]} once its agreed heads of terms are added.${setParties ? ` The ${names} are set from them.` : ""}`}
      working={state === "working"} step={step} error={error} onFile={f => void add(f)} onCancel={onCancel} />
  );
}

function HotsGateBox({ open, title, words, working, step, error, onFile, onCancel }: {
  open: boolean; title: string; words: string; working: boolean; step: string; error: string | null;
  onFile: (file: File) => void; onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !working) onCancel(); }}>
      <DialogContent className="max-w-lg" data-testid="tracker-hots-gate">
        {open && (<>
          <DialogHeader>
            <DialogTitle>
              Add the heads of terms
              <span className="block text-sm font-normal text-muted-foreground mt-0.5">{title}</span>
            </DialogTitle>
            <DialogDescription>
              {words}
            </DialogDescription>
          </DialogHeader>
          <input ref={input} type="file" accept={ACCEPT} className="hidden" data-testid="tracker-hots-gate-input"
            onChange={e => { const f = e.target.files?.[0]; if (input.current) input.current.value = ""; if (f) onFile(f); }} />
          <div
            className={`rounded-lg border border-dashed px-4 py-8 text-center text-sm ${over ? "border-primary bg-primary/5" : "border-border"}`}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
            onDragLeave={e => { e.stopPropagation(); setOver(false); }}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); setOver(false); const f = e.dataTransfer?.files?.[0]; if (f && !working) onFile(f); }}
            data-testid="tracker-hots-gate-drop"
          >
            {working ? (
              <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{step}…</span>
            ) : (
              <div className="space-y-3">
                <FileText className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="text-muted-foreground">Drop the heads of terms or proforma here (PDF or Word)</p>
                <Button type="button" size="sm" onClick={() => input.current?.click()} data-testid="tracker-hots-gate-choose">
                  <Upload className="mr-1.5 h-3.5 w-3.5" />Add HOTs or Proforma
                </Button>
              </div>
            )}
          </div>
          {error && <p className="text-sm text-destructive" data-testid="tracker-hots-gate-error">{error}</p>}
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" disabled={working} onClick={onCancel} data-testid="tracker-hots-gate-cancel">
              Cancel, leave the status as it is
            </Button>
          </div>
        </>)}
      </DialogContent>
    </Dialog>
  );
}
