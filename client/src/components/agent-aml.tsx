// Agents and HMRC's register on screen (Woody, 19 November 2026: BGP's AML
// policy, "Working with joint agents"). On an agent firm's page, and in a
// deal's AML box for every agent on the deal. The rules are
// shared/agent-aml.ts; the routes server/agent-aml.ts.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CheckCircle2, ExternalLink, Loader2, Search, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RaiseReportButton } from "@/components/aml-register";
import type { AgentSupervision, AgentSupervisionStatus, RegisterEntry } from "@shared/agent-aml";

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*?)"(,.*)?\}$/, "$1");
const REGISTER_PAGE = "https://www.gov.uk/guidance/money-laundering-regulations-supervised-business-register";

type Tone = "ok" | "amber" | "red" | "info";
interface AgentState { tone: Tone; words: string; required: boolean }
interface DealAgent { role: string; roleWords: string; companyId: string; name: string; feeShared: boolean; feePct: number | null; record: AgentSupervision | null; state: AgentState }

const TONE_BOX: Record<Tone, string> = {
  ok: "border-emerald-200 bg-emerald-50/60 text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-100",
  amber: "border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100",
  red: "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/20 dark:text-red-200",
  info: "border-border bg-muted/30 text-foreground",
};
function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === "ok") return <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600" />;
  if (tone === "red") return <ShieldAlert className="w-4 h-4 shrink-0 text-red-600" />;
  return <ShieldQuestion className={`w-4 h-4 shrink-0 ${tone === "amber" ? "text-amber-600" : "text-muted-foreground"}`} />;
}

function refreshAgent(companyId: string) {
  queryClient.invalidateQueries({ queryKey: ["/api/agent-aml/company", companyId] });
  queryClient.invalidateQueries({ predicate: q => q.queryKey[0] === "/api/deals" && q.queryKey[2] === "agents-aml" });
}

/** Check a firm on HMRC's register and record what was found. */
export function AgentCheckDialog({ companyId, companyName, record, onClose }: { companyId: string; companyName: string; record: AgentSupervision | null; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(companyName);
  const [status, setStatus] = useState<AgentSupervisionStatus | null>(record?.status || null);
  const [picked, setPicked] = useState<RegisterEntry | null>(null);
  const [number, setNumber] = useState(record?.registrationNumber || "");
  const [supervisor, setSupervisor] = useState(record?.supervisor || "");
  const [agreement, setAgreement] = useState<boolean>(record?.agreementInPlace === true);
  const [agreementNote, setAgreementNote] = useState(record?.agreementNote || "");
  const [notes, setNotes] = useState(record?.notes || "");
  const search = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/agent-aml/company/${companyId}/search`, { name })).json() as Promise<{ exact: RegisterEntry[]; near: RegisterEntry[]; updatedAt: string | null }>,
    onError: (e: any) => toast({ title: "HMRC's register could not be read", description: plain(e), variant: "destructive" }),
  });
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", `/api/agent-aml/company/${companyId}`, {
      status,
      registrationNumber: status === "registered" ? (picked?.number || number) : null,
      registerName: picked ? [picked.businessName, picked.tradingName && picked.tradingName !== picked.businessName ? `trading as ${picked.tradingName}` : ""].filter(Boolean).join(", ") : null,
      registerPostcode: picked?.postcode || null,
      registerStatus: picked?.status || null,
      supervisor: status === "other_supervisor" ? supervisor : null,
      agreementInPlace: agreement, agreementNote, notes,
      source: picked ? "register" : "manual",
      registerDate: search.data?.updatedAt || null,
    })).json(),
    onSuccess: () => { refreshAgent(companyId); toast({ title: "Check recorded" }); onClose(); },
    onError: (e: any) => toast({ title: "Not recorded", description: plain(e), variant: "destructive" }),
  });
  const results = search.data ? [...search.data.exact, ...search.data.near] : [];
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="agent-aml-dialog">
        <DialogHeader>
          <DialogTitle>{companyName}: HMRC registration</DialogTitle>
          <DialogDescription>Agents BGP works with must be registered with HMRC.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex gap-2">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="The firm's name" data-testid="agent-aml-search-name" />
            <Button type="button" variant="outline" disabled={!name.trim() || search.isPending} onClick={() => search.mutate()} data-testid="agent-aml-search">
              {search.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Search className="w-4 h-4 mr-1.5" />}Search HMRC's register
            </Button>
          </div>
          {search.isPending && <p className="text-xs text-muted-foreground">Reading HMRC's register (the first read after a restart takes up to a minute)…</p>}
          {search.data && (
            <div className="space-y-1.5" data-testid="agent-aml-results">
              <p className="text-xs text-muted-foreground">
                {results.length ? `${search.data.exact.length} with this name${search.data.near.length ? `, ${search.data.near.length} holding these words` : ""}` : "No estate or letting agency of this name on HMRC's register"}
                {search.data.updatedAt ? `. Register updated ${new Date(search.data.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}.
              </p>
              <ul className="max-h-56 overflow-y-auto divide-y rounded-md border">
                {results.map(r => (
                  <li key={r.number}>
                    <button type="button" className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted/40 ${picked?.number === r.number ? "bg-primary/10" : ""}`}
                      onClick={() => { setPicked(r); setStatus("registered"); setNumber(r.number); }} data-testid={`agent-aml-entry-${r.number}`}>
                      <div className="font-medium">{r.businessName}{r.tradingName && r.tradingName !== r.businessName ? ` · trading as ${r.tradingName}` : ""}</div>
                      <div className="text-muted-foreground">{r.number} · {r.postcode} · {r.status}{r.estateAgency ? " · estate agency" : ""}{r.lettingAgency ? " · letting agency" : ""}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant={status === "registered" ? "default" : "outline"} onClick={() => setStatus("registered")} data-testid="agent-aml-status-registered">Registered with HMRC</Button>
            <Button type="button" size="sm" variant={status === "not_registered" ? "default" : "outline"} onClick={() => { setStatus("not_registered"); setPicked(null); }} data-testid="agent-aml-status-not">Not on the register</Button>
            <Button type="button" size="sm" variant={status === "other_supervisor" ? "default" : "outline"} onClick={() => { setStatus("other_supervisor"); setPicked(null); }} data-testid="agent-aml-status-other">Supervised by a professional body</Button>
            <a href={REGISTER_PAGE} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline ml-auto self-center">HMRC's register on GOV.UK<ExternalLink className="w-3 h-3" /></a>
          </div>
          {status === "registered" && !picked && (
            <div className="space-y-1.5">
              <Label>HMRC registration number</Label>
              <Input value={number} onChange={e => setNumber(e.target.value.toUpperCase())} placeholder="e.g. XJML00000138016" data-testid="agent-aml-number" />
            </div>
          )}
          {status === "registered" && picked && <p className="text-xs flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />Using {picked.number}, {picked.businessName}.</p>}
          {status === "other_supervisor" && (
            <div className="space-y-1.5">
              <Label>Which professional body</Label>
              <Input value={supervisor} onChange={e => setSupervisor(e.target.value)} placeholder="The AML supervisor named in the Regulations" />
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={agreement} onCheckedChange={v => setAgreement(v === true)} data-testid="agent-aml-agreement" />
            <span>An agreement with them sets out who does the client due diligence</span>
          </label>
          {agreement && <Input value={agreementNote} onChange={e => setAgreementNote(e.target.value)} placeholder="Which agreement (e.g. the joint agency letter of 3 March)" />}
          <div className="space-y-1.5">
            <Label>{status === "not_registered" ? "How you checked (required)" : "Notes"}</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} data-testid="agent-aml-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!status || save.isPending} onClick={() => save.mutate()} data-testid="agent-aml-save">
            {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Record the check
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The card on an agent firm's page (BGP staff). */
export function AgentAmlCard({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { data } = useQuery<{ record: AgentSupervision | null; state: AgentState }>({ queryKey: ["/api/agent-aml/company", companyId] });
  const [checking, setChecking] = useState(false);
  if (!data) return null;
  const tone: Tone = data.record ? data.state.tone : "info";
  return (
    <div className={`rounded-xl border p-3 text-sm space-y-1.5 ${TONE_BOX[tone]}`} data-testid="agent-aml-card">
      <div className="flex items-start gap-2">
        <ToneIcon tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="font-medium">AML supervision</div>
          <div className="text-xs mt-0.5">{data.record ? data.state.words : "Not checked on HMRC's register yet."}</div>
          {data.record?.agreementInPlace && <div className="text-xs mt-0.5 text-muted-foreground">Agreement: {data.record.agreementNote || "in place"}</div>}
        </div>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => setChecking(true)} data-testid="agent-aml-check">{data.record ? "Check again" : "Check HMRC's register"}</Button>
      </div>
      {checking && <AgentCheckDialog companyId={companyId} companyName={companyName} record={data.record} onClose={() => setChecking(false)} />}
    </div>
  );
}

export type DealAgentAmlTone = Tone;
/** The agents on a deal and where each stands on HMRC's register (the AML box's Agents line reads it). */
export function useDealAgentsAml(dealId: string, enabled = true) {
  return useQuery<{ agents: DealAgent[] }>({ queryKey: ["/api/deals", dealId, "agents-aml"], enabled });
}

/** Every agent on a deal, in the deal's AML box (BGP staff). bare: under the box's own Agents line. */
export function DealAgentsAml({ dealId, bare }: { dealId: string; bare?: boolean }) {
  const { data } = useDealAgentsAml(dealId);
  const [checking, setChecking] = useState<DealAgent | null>(null);
  if (!data?.agents.length) return null;
  return (
    <div className="space-y-1.5" data-testid="deal-agents-aml">
      {!bare && <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agents on this transaction</div>}
      {data.agents.map(a => (
        <div key={`${a.role}-${a.companyId}`} className={`rounded-md border p-2.5 text-xs ${TONE_BOX[a.state.tone]}`} data-testid={`deal-agent-aml-${a.role}`}>
          <div className="flex items-start gap-2">
            <ToneIcon tone={a.state.tone} />
            <div className="min-w-0 flex-1">
              <div><span className="font-medium">{a.roleWords}:</span> <Link href={`/companies/${a.companyId}`} className="hover:underline">{a.name}</Link>{a.feePct ? <span className="text-muted-foreground"> · {a.feePct}% of the fee</span> : null}</div>
              <div className="mt-0.5">{a.state.words}</div>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setChecking(a)} data-testid={`deal-agent-aml-check-${a.role}`}>{a.record ? "Check again" : "Check"}</Button>
              {a.state.tone === "red" && (
                <RaiseReportButton label="Tell the Nominated Officer" kind="agent_unregistered" dealId={dealId} companyId={a.companyId}
                  seed={`${a.name} (${a.roleWords.toLowerCase()} on this transaction) is not on HMRC's register of businesses supervised for anti-money laundering.`}
                  className="h-7 text-xs" testId={`deal-agent-aml-report-${a.role}`} />
              )}
            </div>
          </div>
        </div>
      ))}
      {checking && <AgentCheckDialog companyId={checking.companyId} companyName={checking.name} record={checking.record} onClose={() => setChecking(null)} />}
    </div>
  );
}
