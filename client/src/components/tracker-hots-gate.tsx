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
export interface HotsGateResult { dealId: string; added: string[]; note: string | null }

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

/** Sets the landlord and tenant the transaction lacks from what the heads of terms name. */
async function addParties(dealId: string, reply: HotsReadReply, landlordId: string | null): Promise<string[]> {
  const added: string[] = [];
  for (const role of ["landlord", "tenant"] as const) {
    const m = reply.parties.find(p => p.role === role);
    if (!m || m.brand) continue;
    const field = role === "landlord" ? "landlordId" : "tenantId";
    let id: string | null = m.candidates.length === 1 ? m.candidates[0].companyId : null;
    let name = id ? m.candidates[0].companyName : m.read.name;
    // The property's own landlord, when the CRM has no one record of that name.
    if (!id && role === "landlord" && landlordId) { id = landlordId; name = "the property's landlord"; }
    if (!id && m.candidates.length > 1) continue;
    if (!id) {
      const made = await (await apiRequest("POST", "/api/crm/companies", { name: m.read.name, companyType: role === "landlord" ? "Landlord" : "Tenant" })).json();
      id = String(made.id);
      name = made.name;
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
    }
    await apiRequest("PUT", `/api/crm/deals/${dealId}`, { [field]: id });
    added.push(`${role === "landlord" ? "Landlord" : "Tenant"}: ${name}`);
  }
  return added;
}

export function TrackerHotsGate({ unit, target, onDone, onCancel }: {
  unit: HotsGateUnit | null; target: HotsGateTarget;
  /** The heads of terms are on the unit: carry on with the move. */
  onDone: (result: HotsGateResult) => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"checking" | "ask" | "working">("checking");
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
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

  const open = !!unit && state !== "checking";
  return (
    <Dialog open={open} onOpenChange={o => { if (!o && state !== "working") onCancel(); }}>
      <DialogContent className="max-w-lg" data-testid="tracker-hots-gate">
        {unit && (<>
          <DialogHeader>
            <DialogTitle>
              Add the heads of terms
              <span className="block text-sm font-normal text-muted-foreground mt-0.5">{unit.unitName}{unit.propertyName ? `, ${unit.propertyName}` : ""}</span>
            </DialogTitle>
            <DialogDescription>
              This unit moves to {TARGET_WORDS[target]} once its agreed heads of terms are added. The landlord and tenant are set from them.
            </DialogDescription>
          </DialogHeader>
          <input ref={input} type="file" accept={ACCEPT} className="hidden" data-testid="tracker-hots-gate-input"
            onChange={e => { const f = e.target.files?.[0]; if (input.current) input.current.value = ""; if (f) void add(f); }} />
          <div
            className={`rounded-lg border border-dashed px-4 py-8 text-center text-sm ${over ? "border-primary bg-primary/5" : "border-border"}`}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
            onDragLeave={e => { e.stopPropagation(); setOver(false); }}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); setOver(false); const f = e.dataTransfer?.files?.[0]; if (f && state === "ask") void add(f); }}
            data-testid="tracker-hots-gate-drop"
          >
            {state === "working" ? (
              <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{step}…</span>
            ) : (
              <div className="space-y-3">
                <FileText className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="text-muted-foreground">Drop the heads of terms here (PDF or Word)</p>
                <Button type="button" size="sm" onClick={() => input.current?.click()} data-testid="tracker-hots-gate-choose">
                  <Upload className="mr-1.5 h-3.5 w-3.5" />Choose the file
                </Button>
              </div>
            )}
          </div>
          {error && <p className="text-sm text-destructive" data-testid="tracker-hots-gate-error">{error}</p>}
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" disabled={state === "working"} onClick={onCancel} data-testid="tracker-hots-gate-cancel">
              Cancel, leave the status as it is
            </Button>
          </div>
        </>)}
      </DialogContent>
    </Dialog>
  );
}
