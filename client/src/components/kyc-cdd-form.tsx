// The KYC form — the app's version of the KYC4U "Standard KYC form" BGP
// used until Sept 2026: risk factors, the CDD/EDD items, ownership chain,
// UBOs, risk assessment, the counterparty's agent and lawyers, and the
// app's recommendation. Pre-filled by the app (and from an imported KYC4U
// workbook); every field is editable and a human edit is never overwritten.
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronRight, Plus, X, RefreshCw, Loader2 } from "lucide-react";

type Row = { name: string; country?: string; orgType?: string; idMethod?: string };
type CddForm = Record<string, any> & {
  riskFactors?: { client?: string; geographic?: string; other?: string };
  ownershipChain?: Row[]; ubos?: Row[]; counterparty?: Record<string, string>;
  recommendation?: { verdict: string; reasons: string[] }; source?: Record<string, string>;
};

const TEXT_FIELDS: Array<[string, string]> = [
  ["structureChart", "Structure chart"],
  ["authorityToInstruct", "Authority to instruct"],
  ["clientBackground", "Client background"],
  ["adverseMedia", "Adverse media (web search)"],
  ["sourceOfFunds", "Source of funds for acquisitions"],
  ["financialStatements", "Financial statements"],
  ["jointAgency", "Joint agency?"],
  ["documentsCertified", "Are documents certified?"],
];
const CP_FIELDS: Array<[string, string]> = [
  ["agentName", "Counterparty's agent"],
  ["agentHmrcRegistered", "Agent registered with HMRC?"],
  ["agentComplianceTeam", "Agent has a compliance team?"],
  ["agentNegativeMedia", "Negative media around the agent?"],
  ["brokerView", "Our broker's view of the agent's reputation"],
  ["solicitorName", "Counterparty's solicitors"],
  ["solicitorSizeReputation", "Size and reputation of the solicitors"],
  ["solicitorNegativeMedia", "Negative media around the solicitors?"],
];

const VERDICT: Record<string, { label: string; cls: string }> = {
  recommend: { label: "Recommend", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  recommend_with_conditions: { label: "Recommend with conditions", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  do_not_recommend: { label: "Do not recommend", cls: "bg-red-100 text-red-700 border-red-200" },
};

function SourceTag({ source }: { source?: string }) {
  if (!source || source === "manual") return null;
  return <span className="text-[9px] uppercase tracking-wide text-muted-foreground ml-1">{source === "kyc4u" ? "from KYC4U" : "auto"}</span>;
}

export function KycCddForm({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const key = ["/api/kyc/company", companyId, "cdd-form"];
  const { data, isLoading } = useQuery<{ form: CddForm; overallRisk: string | null }>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`/api/kyc/company/${companyId}/cdd-form`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load the KYC form");
      return res.json();
    },
  });
  const save = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => (await apiRequest("PUT", `/api/kyc/company/${companyId}/cdd-form`, patch)).json(),
    onSuccess: (out) => queryClient.setQueryData(key, out),
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });
  const refill = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/kyc/company/${companyId}/cdd-form?prefill=1`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Refresh failed");
      return res.json();
    },
    onSuccess: (out) => { queryClient.setQueryData(key, out); toast({ title: "KYC form refreshed from the latest checks" }); },
  });

  const form: CddForm = data?.form || {};
  const src = form.source || {};
  const [draft, setDraft] = useState<CddForm>({});
  useEffect(() => { setDraft(form); }, [data]);  // eslint-disable-line react-hooks/exhaustive-deps

  const rec = form.recommendation;
  const verdict = rec ? VERDICT[rec.verdict] : null;
  const risk = data?.overallRisk;
  const isCounterparty = (draft.role || form.role) === "counterparty";

  const table = (field: "ownershipChain" | "ubos", cols: Array<[keyof Row, string]>) => {
    const rows: Row[] = draft[field] || [];
    const commit = (next: Row[]) => { setDraft({ ...draft, [field]: next }); save.mutate({ [field]: next.filter(r => r.name?.trim()) }); };
    return (
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_110px_1fr_24px] gap-1.5">
            {cols.map(([k, label]) => (
              <Input key={k} className="h-8 text-xs" placeholder={label} defaultValue={(r as any)[k] || ""}
                onBlur={(e) => { const next = rows.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x); if ((r as any)[k] !== e.target.value) commit(next); }} />
            ))}
            <button className="text-muted-foreground hover:text-red-600" onClick={() => commit(rows.filter((_, j) => j !== i))} title="Remove"><X className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <Button size="sm" variant="ghost" className="h-6 text-[11px] px-1.5" onClick={() => setDraft({ ...draft, [field]: [...rows, { name: "" }] })}>
          <Plus className="w-3 h-3 mr-1" />Add row
        </Button>
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-border" data-testid="kyc-cdd-form">
      <button className="w-full flex items-center gap-2 px-3 py-2.5 text-left" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <span className="text-sm font-semibold">KYC form</span>
        {form.importedFrom && <span className="text-[10px] text-muted-foreground truncate">imported from {form.importedFrom}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {risk && <Badge variant="outline" className={`text-[10px] ${risk === "high" ? "border-orange-300 text-orange-700" : "border-green-300 text-green-700"}`}>{risk === "high" ? "High risk" : "Low risk"}</Badge>}
          {verdict && <Badge variant="outline" className={`text-[10px] ${verdict.cls}`}>{verdict.label}</Badge>}
          {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        </span>
      </button>
      {open && data && (
        <div className="px-3 pb-3 space-y-4">
          {rec && rec.reasons.length > 0 && (
            <div className="text-xs text-muted-foreground rounded-md bg-muted/40 p-2" data-testid="kyc-recommendation">
              <span className="font-medium text-foreground">App recommendation:</span> {verdict?.label}. {rec.reasons.join(" · ")}
              <div className="text-[10px] mt-1">A named BGP person signs off below — the fee earner, plus the Nominated Officer for higher-risk clients.</div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <label className="text-[11px] text-muted-foreground">Checks for
              <Select value={draft.role || "party"} onValueChange={(v) => { setDraft({ ...draft, role: v }); save.mutate({ role: v }); }}>
                <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="party">Client (party / billing entity)</SelectItem><SelectItem value="counterparty">Counterparty</SelectItem></SelectContent>
              </Select>
            </label>
            <label className="text-[11px] text-muted-foreground">Work type<SourceTag source={src.workType} />
              <Input className="h-8 text-xs mt-0.5" defaultValue={draft.workType || ""} onBlur={(e) => e.target.value !== (form.workType || "") && save.mutate({ workType: e.target.value })} />
            </label>
            {(["client", "geographic", "other"] as const).map(k => (
              <label key={k} className="text-[11px] text-muted-foreground capitalize">{k} risk<SourceTag source={src.riskFactors} />
                <Select value={draft.riskFactors?.[k] || ""} onValueChange={(v) => { const rf = { ...(draft.riskFactors || {}), [k]: v }; setDraft({ ...draft, riskFactors: rf }); save.mutate({ riskFactors: rf }); }}>
                  <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
                </Select>
              </label>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-2">
            {TEXT_FIELDS.map(([k, label]) => (
              <label key={k} className="text-[11px] text-muted-foreground">{label}<SourceTag source={src[k]} />
                <Textarea rows={2} className="text-xs mt-0.5" defaultValue={draft[k] || ""} key={`${k}-${form[k] || ""}`}
                  onBlur={(e) => e.target.value !== (form[k] || "") && save.mutate({ [k]: e.target.value })} />
              </label>
            ))}
            <label className="text-[11px] text-muted-foreground">Met face to face?
              <Select value={draft.metFaceToFace === true ? "yes" : draft.metFaceToFace === false ? "no" : ""} onValueChange={(v) => { const b = v === "yes"; setDraft({ ...draft, metFaceToFace: b }); save.mutate({ metFaceToFace: b }); }}>
                <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No — verified remotely</SelectItem></SelectContent>
              </Select>
            </label>
          </div>

          <div>
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Client structure, ownership and evidence<SourceTag source={src.ownershipChain} /></div>
            {table("ownershipChain", [["name", "Entity"], ["country", "Country"], ["orgType", "Organisation type"]])}
          </div>
          <div>
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Ultimate beneficial owners<SourceTag source={src.ubos} /></div>
            {table("ubos", [["name", "Name"], ["country", "Country"], ["idMethod", "ID verification method"]])}
          </div>

          <label className="text-[11px] text-muted-foreground block">Detailed risk assessment<SourceTag source={src.riskNarrative} />
            <Textarea rows={4} className="text-xs mt-0.5" defaultValue={draft.riskNarrative || ""} key={`narr-${(form.riskNarrative || "").length}`}
              onBlur={(e) => e.target.value !== (form.riskNarrative || "") && save.mutate({ riskNarrative: e.target.value })} />
          </label>

          {isCounterparty && (
            <div>
              <div className="text-[11px] font-medium text-muted-foreground mb-1">Counterparty's agent and solicitors<SourceTag source={src.counterparty} /></div>
              <div className="grid md:grid-cols-2 gap-2">
                {CP_FIELDS.map(([k, label]) => (
                  <label key={k} className="text-[11px] text-muted-foreground">{label}
                    <Input className="h-8 text-xs mt-0.5" defaultValue={draft.counterparty?.[k] || ""} key={`${k}-${form.counterparty?.[k] || ""}`}
                      onBlur={(e) => { if (e.target.value === (form.counterparty?.[k] || "")) return; const cp = { ...(draft.counterparty || {}), [k]: e.target.value }; setDraft({ ...draft, counterparty: cp }); save.mutate({ counterparty: cp }); }} />
                  </label>
                ))}
              </div>
            </div>
          )}

          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => refill.mutate()} disabled={refill.isPending}>
            {refill.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
            Refresh from latest checks
          </Button>
        </div>
      )}
    </div>
  );
}
