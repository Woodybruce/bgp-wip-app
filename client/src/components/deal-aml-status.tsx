import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Clock, ShieldCheck, Loader2, FileDown, Sparkles, Upload, Trash2, Brain, ScrollText, Mail, Send, Copy, Cloud, ChevronDown, ChevronUp, TrendingUp, TrendingDown, FolderOpen } from "lucide-react";
import { Link } from "wouter";
import { KycPanel } from "@/components/kyc-panel";
import { getAuthHeaders, queryClient, apiRequest } from "@/lib/queryClient";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export interface DealAmlStatus {
  dealId: string;
  dealName: string;
  counterparties: Array<{
    id: string;
    name: string;
    role: string;
    kyc_status: string | null;
    kyc_expires_at: string | null;
    kyc_approved_by: string | null;
    isApproved: boolean;
    isExpired: boolean;
  }>;
  allApproved: boolean;
  canInvoice: boolean;
  missing: string[];
}

export function useDealAmlStatus(dealId: string) {
  return useQuery<DealAmlStatus>({
    queryKey: ["/api/kyc/deal", dealId, "status"],
    queryFn: async () => {
      const res = await fetch(`/api/kyc/deal/${dealId}/status`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load AML status");
      return res.json();
    },
  });
}

export function DealAmlStatusCard({ dealId }: { dealId: string }) {
  const { data, isLoading } = useDealAmlStatus(dealId);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading) return (
    <Card><CardContent className="py-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin" /></CardContent></Card>
  );
  if (!data) return null;

  // The legacy "both sides need to be linked to invoice" gate previously
  // returned early here, hiding the AML AI augments (MLR scope, AI triage,
  // SoF analysis, MLRO PDF) until both counterparties were set. Those
  // augments are useful from the moment a deal exists, so we now render the
  // warning inline above the AmlAiPanel rather than blocking the whole card.

  if (data.counterparties.length < 2) {
    return (
      <Card data-testid="deal-aml-status-card">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-md text-sm" data-testid="deal-aml-status-incomplete">
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <span>
              Only {data.counterparties.length} counterparty linked to this deal — both sides need to be set on the deal record before AML status can clear and the invoice can unlock. AML AI tools below still work though.
            </span>
          </div>
          <AmlAiPanel dealId={dealId} dealName={data.dealName} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="deal-aml-status-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className={`w-4 h-4 ${data.allApproved ? "text-emerald-600" : "text-muted-foreground"}`} />
            <h3 className="font-semibold text-sm">AML status — both counterparties</h3>
          </div>
          {data.allApproved ? (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200" data-testid="badge-deal-aml-clear">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              AML CLEAR — invoice unlocked
            </Badge>
          ) : (
            <Badge variant="secondary" data-testid="badge-deal-aml-blocked">
              <Clock className="w-3 h-3 mr-1" />
              AML pending
            </Badge>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-2">
          {data.counterparties.map(cp => {
            const status = cp.isApproved && !cp.isExpired ? "approved" : cp.isExpired ? "expired" : cp.kyc_status || "pending";
            const colour = status === "approved" ? "border-emerald-300 bg-emerald-50/50" :
                          status === "expired" ? "border-red-300 bg-red-50/50" :
                          status === "rejected" ? "border-red-300 bg-red-50/50" :
                          "border-amber-300 bg-amber-50/30";
            const icon = status === "approved" ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> :
                        status === "expired" ? <Clock className="w-4 h-4 text-red-600" /> :
                        <AlertCircle className="w-4 h-4 text-amber-600" />;
            const isOpen = expanded === cp.id;
            return (
              <div key={cp.id} className={`border-2 rounded-lg p-3 ${colour}`} data-testid={`counterparty-${cp.id}`}>
                <div className="flex items-start gap-2">
                  {icon}
                  <div className="flex-1 min-w-0">
                    <Badge variant="outline" className="text-[10px] mb-1 uppercase">{cp.role}</Badge>
                    <Link href={`/companies/${cp.id}`} className="font-medium text-sm hover:underline block truncate">
                      {cp.name}
                    </Link>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {status === "approved" ? `Approved${cp.kyc_approved_by ? ` by ${cp.kyc_approved_by}` : ""}` :
                       status === "expired" ? "Expired — re-check needed" :
                       status === "rejected" ? "Rejected" :
                       status === "in_review" ? "In review" : "No KYC yet"}
                    </div>
                    {cp.kyc_expires_at && (
                      <div className="text-[11px] text-muted-foreground">
                        {cp.isExpired ? "Was valid until" : "Valid until"} {new Date(cp.kyc_expires_at).toLocaleDateString("en-GB")}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => setExpanded(isOpen ? null : cp.id)}
                    data-testid={`button-expand-counterparty-${cp.id}`}
                  >
                    {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {isOpen ? "Close" : "Manage"}
                  </Button>
                </div>
                {isOpen && (
                  <div className="mt-3 pt-3 border-t border-current/10">
                    <KycPanel companyId={cp.id} dealId={dealId} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!data.allApproved && data.missing.length > 0 && (
          <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-md text-sm" data-testid="deal-aml-blocker">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-medium">Invoice locked.</span> Waiting on AML approval for {data.missing.join(", ")}.
              Open each counterparty above and complete the checklist + upload supporting documents, then click MLRO Approve.
            </div>
          </div>
        )}

        <AmlAiPanel dealId={dealId} dealName={data.dealName} />
      </CardContent>
    </Card>
  );
}

// ── AI AML augments — MLR scope, AI triage, SoF analyses, MLRO PDF ──────────

interface DealAmlAi {
  id: string;
  name: string;
  amlEddRequired: boolean | null;
  amlEddReason: string | null;
  amlSourceOfFunds: string | null;
  amlAiTriage: {
    verdict?: "clear" | "review" | "escalate";
    recommendation?: string;
    rationale?: string[];
    mlroAction?: string;
    generatedAt?: string;
  } | null;
  amlSofAnalysis: { items?: Array<{
    documentType: string;
    summary: string;
    declaredSourceMatchesDocument: boolean | null;
    inferredAnnualIncomePence: number | null;
    redFlags: string[];
    evidence: string[];
    generatedAt: string;
  }> } | null;
  amlMarketData: {
    listed: boolean;
    ticker: string | null;
    exchange: string | null;
    marketCapGBP: number | null;
    fiftyTwoWeekChange: number | null;
    signals: {
      largeCap: boolean;
      midCap: boolean;
      sharpDrop: boolean;
      strongMomentum: boolean;
      halted: boolean;
    };
    creditSafe?: { configured: boolean; score?: number | null; riskBand?: string | null; insolvencyFlag?: boolean };
    fetchedAt: string;
  } | null;
}

// Exported so the Compliance Board (and other KYC review surfaces) can drop
// the AI augments alongside their existing per-counterparty KycPanel.
export function AmlAiPanel({ dealId, dealName }: { dealId: string; dealName: string }) {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Pull deal-level AML AI fields directly from the deal record. The
  // /api/kyc/deal/:id/status endpoint above doesn't include these, so we
  // hit /api/deals/:id and pluck the columns we need.
  const { data: deal } = useQuery<DealAmlAi>({
    queryKey: ["/api/crm/deals", dealId, "aml-ai"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/deals/${dealId}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("deal load failed");
      const d = await res.json();
      return {
        id: d.id, name: d.name,
        amlEddRequired: d.amlEddRequired ?? d.aml_edd_required,
        amlEddReason: d.amlEddReason ?? d.aml_edd_reason,
        amlSourceOfFunds: d.amlSourceOfFunds ?? d.aml_source_of_funds,
        amlAiTriage: d.amlAiTriage ?? d.aml_ai_triage ?? null,
        amlSofAnalysis: d.amlSofAnalysis ?? d.aml_sof_analysis ?? null,
        amlMarketData: d.amlMarketData ?? d.aml_market_data ?? null,
      };
    },
  });

  const { data: scope, refetch: refetchScope } = useQuery<{ current: any; suggestion: { suggestedScope: string; reason: string } }>({
    queryKey: ["/api/aml/deal", dealId, "mlr-scope"],
    queryFn: async () => {
      const res = await fetch(`/api/aml/deal/${dealId}/mlr-scope`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("scope load failed");
      return res.json();
    },
  });

  const setScope = useMutation({
    mutationFn: async (body: { scope: string; reason: string }) =>
      apiRequest("POST", `/api/aml/deal/${dealId}/mlr-scope`, body),
    onSuccess: () => {
      refetchScope();
      toast({ title: "MLR scope saved" });
    },
  });

  const deleteSof = useMutation({
    mutationFn: async (idx: number) => apiRequest("DELETE", `/api/aml/deal/${dealId}/sof/${idx}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId, "aml-ai"] }),
  });

  const uploadSof = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (deal?.amlSourceOfFunds) fd.append("declaredSource", deal.amlSourceOfFunds);
      const res = await fetch(`/api/aml/deal/${dealId}/sof`, {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId, "aml-ai"] });
      toast({ title: "Source-of-funds analysis complete" });
    } catch (e: any) {
      toast({ title: "Analysis failed", description: e?.message?.slice(0, 200), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const triage = deal?.amlAiTriage;
  const triageColor = triage?.verdict === "clear" ? "border-emerald-300 bg-emerald-50/50"
    : triage?.verdict === "escalate" ? "border-red-300 bg-red-50/50"
    : "border-amber-300 bg-amber-50/30";
  const sofItems = deal?.amlSofAnalysis?.items || [];

  return (
    <div className="space-y-3 pt-2 border-t">
      {/* MLR scope */}
      <div className="flex items-start gap-2 p-2.5 rounded-md border bg-card">
        <ScrollText className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold uppercase tracking-wide">MLR 2017 scope</span>
            {scope?.current?.scope ? (
              <Badge variant="outline" className="text-[10px] capitalize">{String(scope.current.scope).replace(/_/g, " ")}</Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">Not assessed</Badge>
            )}
          </div>
          {scope?.suggestion && (
            <p className="text-[11px] text-muted-foreground mt-1">
              <span className="font-medium">Suggested:</span> {scope.suggestion.suggestedScope.replace(/_/g, " ")} — {scope.suggestion.reason}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2">
            <Select
              value={scope?.current?.scope || ""}
              onValueChange={(v) => setScope.mutate({ scope: v, reason: scope?.suggestion?.reason || "" })}
            >
              <SelectTrigger className="h-7 text-xs w-56" data-testid="select-mlr-scope">
                <SelectValue placeholder="Set scope…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in_scope">In scope — full CDD required</SelectItem>
                <SelectItem value="out_of_scope_below_threshold">Out of scope — below MLR threshold</SelectItem>
                <SelectItem value="simplified_dd">Simplified DD (Reg 37)</SelectItem>
              </SelectContent>
            </Select>
            {scope?.current?.scope === "out_of_scope_below_threshold" && (
              <span className="text-[10px] text-emerald-700 font-medium">Deal can proceed without full CDD</span>
            )}
          </div>
        </div>
      </div>

      {/* Auto-EDD reason */}
      {deal?.amlEddRequired && (
        <div className="flex items-start gap-2 p-2.5 rounded-md border border-orange-300 bg-orange-50">
          <AlertCircle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-orange-800">Enhanced Due Diligence required</div>
            <p className="text-[11px] text-orange-900 mt-0.5">{deal.amlEddReason || "Set by AML rules engine."}</p>
          </div>
        </div>
      )}

      {/* Market data — Yahoo Finance for listed entities, Creditsafe when wired */}
      {deal?.amlMarketData && (deal.amlMarketData.listed || deal.amlMarketData.creditSafe?.score != null) && (
        <div className="flex items-start gap-2 p-2.5 rounded-md border bg-card" data-testid="market-data-card">
          {deal.amlMarketData.signals.sharpDrop || deal.amlMarketData.signals.halted
            ? <TrendingDown className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            : <TrendingUp className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold uppercase tracking-wide">Market data</span>
              {deal.amlMarketData.listed && (
                <Badge variant="outline" className="text-[10px]">
                  {deal.amlMarketData.ticker}{deal.amlMarketData.exchange ? ` · ${deal.amlMarketData.exchange}` : ""}
                </Badge>
              )}
              {deal.amlMarketData.signals.largeCap && <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700 bg-emerald-50">Large cap</Badge>}
              {deal.amlMarketData.signals.midCap && <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-700 bg-blue-50">Mid cap</Badge>}
              {deal.amlMarketData.signals.strongMomentum && <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700 bg-emerald-50">Strong momentum</Badge>}
              {deal.amlMarketData.signals.sharpDrop && <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 bg-red-50">Sharp drop</Badge>}
              {deal.amlMarketData.signals.halted && <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 bg-red-50">Halted</Badge>}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap gap-x-3">
              {deal.amlMarketData.marketCapGBP != null && (
                <span>Mkt cap: £{(deal.amlMarketData.marketCapGBP / 1e6).toFixed(0)}m</span>
              )}
              {deal.amlMarketData.fiftyTwoWeekChange != null && (
                <span>52w: {(deal.amlMarketData.fiftyTwoWeekChange * 100).toFixed(1)}%</span>
              )}
              {deal.amlMarketData.creditSafe?.score != null && (
                <span>Creditsafe: {deal.amlMarketData.creditSafe.score}{deal.amlMarketData.creditSafe.riskBand ? ` (${deal.amlMarketData.creditSafe.riskBand})` : ""}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI triage */}
      {triage && (
        <div className={`p-2.5 rounded-md border ${triageColor}`} data-testid="ai-triage-card">
          <div className="flex items-center gap-2 mb-1">
            <Brain className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">AI triage</span>
            <Badge variant="outline" className="text-[10px] uppercase">{triage.verdict}</Badge>
          </div>
          <p className="text-[12px] leading-relaxed">{triage.recommendation}</p>
          {Array.isArray(triage.rationale) && triage.rationale.length > 0 && (
            <ul className="mt-1.5 list-disc list-inside text-[11px] text-muted-foreground space-y-0.5">
              {triage.rationale.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
          {triage.mlroAction && (
            <p className="text-[11px] mt-2"><span className="font-semibold">MLRO action:</span> {triage.mlroAction}</p>
          )}
        </div>
      )}

      {/* Source of Funds analyses */}
      <div className="rounded-md border p-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wide">AI Source-of-Funds</span>
            <Badge variant="outline" className="text-[10px]">{sofItems.length} doc{sofItems.length === 1 ? "" : "s"}</Badge>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fileInput.current?.click()} disabled={uploading} data-testid="button-upload-sof">
            {uploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
            {uploading ? "Analysing…" : "Add document"}
          </Button>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadSof(f); e.target.value = ""; }}
          />
        </div>
        {sofItems.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic">Drop a bank statement, payslip or tax return — Claude will extract the figures, summarise the income picture and flag inconsistencies vs declared source.</p>
        ) : (
          <div className="space-y-2">
            {sofItems.map((s, i) => (
              <div key={i} className="rounded border p-2 bg-card" data-testid={`sof-doc-${i}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] capitalize">{s.documentType?.replace(/_/g, " ")}</Badge>
                      {typeof s.declaredSourceMatchesDocument === "boolean" && (
                        <Badge className={`text-[10px] ${s.declaredSourceMatchesDocument ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {s.declaredSourceMatchesDocument ? "Matches declared" : "Mismatch"}
                        </Badge>
                      )}
                      {s.inferredAnnualIncomePence != null && (
                        <span className="text-[11px] text-muted-foreground">~£{(s.inferredAnnualIncomePence/100).toLocaleString()}/yr inferred</span>
                      )}
                    </div>
                    <p className="text-[12px] mt-1 leading-snug">{s.summary}</p>
                    {Array.isArray(s.redFlags) && s.redFlags.length > 0 && (
                      <ul className="text-[11px] text-red-700 mt-1 list-disc list-inside space-y-0.5">
                        {s.redFlags.map((f, j) => <li key={j}>{f}</li>)}
                      </ul>
                    )}
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-muted-foreground hover:text-destructive" onClick={() => deleteSof.mutate(i)} title="Delete this analysis">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tokenised upload links — admin issues, customer uses, polled */}
      <UploadLinksPanel dealId={dealId} dealName={dealName} />

      {/* MLRO Report PDF — download or save to SharePoint */}
      <MlroReportButtons dealId={dealId} />
    </div>
  );
}

function UploadLinksPanel({ dealId, dealName }: { dealId: string; dealName: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ contactEmail: "", contactName: "", customNote: "", sendEmail: true });

  const { data: links = [] } = useQuery<any[]>({
    queryKey: ["/api/aml/deal", dealId, "upload-links"],
    queryFn: () => fetch(`/api/aml/deal/${dealId}/upload-links`, { credentials: "include", headers: getAuthHeaders() }).then(r => r.ok ? r.json() : []),
  });

  const issue = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/aml/deal/${dealId}/upload-link`, form);
      return r.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/aml/deal", dealId, "upload-links"] });
      setOpen(false);
      setForm({ contactEmail: "", contactName: "", customNote: "", sendEmail: true });
      const note = data?.emailResult?.ok ? "Email sent." : data?.emailResult?.error ? `Email failed: ${data.emailResult.error}` : "Link created (no email sent).";
      toast({ title: "KYC link issued", description: note });
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message?.slice(0, 200), variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: async (token: string) => apiRequest("DELETE", `/api/aml/upload-link/${token}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/aml/deal", dealId, "upload-links"] }),
  });

  return (
    <div className="rounded-md border p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wide">Client upload links</span>
          <Badge variant="outline" className="text-[10px]">{links.length}</Badge>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid="button-request-kyc">
          <Mail className="w-3 h-3 mr-1" /> Request docs from client
        </Button>
      </div>
      {links.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">No links issued yet. Click above to email a customer a self-service upload page.</p>
      ) : (
        <div className="space-y-1">
          {links.map((l) => {
            const expired = new Date(l.expires_at) < new Date();
            const status = l.revoked_at ? "revoked" : expired ? "expired" : l.last_used_at ? "used" : "pending";
            return (
              <div key={l.token} className="flex items-center gap-2 rounded border p-2 text-xs">
                <Badge variant="outline" className={`text-[10px] capitalize ${status === "used" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : status === "expired" ? "bg-red-50 text-red-700 border-red-200" : status === "revoked" ? "bg-muted" : "bg-amber-50 text-amber-700 border-amber-200"}`}>{status}</Badge>
                <span className="font-medium truncate max-w-[160px]">{l.contact_email || "—"}</span>
                <span className="text-muted-foreground">expires {new Date(l.expires_at).toLocaleDateString("en-GB")}</span>
                {l.use_count > 0 && <span className="text-muted-foreground">· {l.use_count} upload{l.use_count === 1 ? "" : "s"}</span>}
                <div className="ml-auto flex items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => { navigator.clipboard.writeText(l.url); toast({ title: "Link copied" }); }} title="Copy link">
                    <Copy className="w-3 h-3" />
                  </Button>
                  {!l.revoked_at && !expired && (
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-muted-foreground hover:text-destructive" onClick={() => revoke.mutate(l.token)} title="Revoke">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request KYC documents</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Contact name</Label><Input value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} placeholder="Jane Smith" /></div>
              <div className="space-y-1.5"><Label>Contact email</Label><Input type="email" value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} placeholder="jane@example.com" /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Custom note (optional)</Label>
              <Textarea rows={3} value={form.customNote} onChange={e => setForm(f => ({ ...f, customNote: e.target.value }))} placeholder="Any specific docs you want to call out…" />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <input id="send-email-cb" type="checkbox" checked={form.sendEmail} onChange={e => setForm(f => ({ ...f, sendEmail: e.target.checked }))} className="h-4 w-4" />
              <Label htmlFor="send-email-cb" className="cursor-pointer">Email the link to {form.contactEmail || "the contact"} now</Label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Email goes from the BGP AML mailbox with a 14-day link to the secure upload page.
              Replies with attachments are auto-ingested and analysed.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
              {issue.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
              Issue & {form.sendEmail ? "send" : "copy link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MlroReportButtons({ dealId }: { dealId: string }) {
  const { toast } = useToast();
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/aml/deal/${dealId}/mlro-report/save`);
      return r.json();
    },
    onSuccess: (data) => {
      setSavedUrl(data.webUrl);
      toast({ title: "Saved to SharePoint", description: `${data.filename} (${data.sizeMB?.toFixed?.(2) ?? "?"} MB)` });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message?.slice(0, 200), variant: "destructive" }),
  });

  return (
    <div className="flex items-center justify-end gap-2 flex-wrap">
      {savedUrl && (
        <a href={savedUrl} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline">SP file ↗</a>
      )}
      <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-mlro-save-sp">
        {save.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5 mr-1.5" />}
        Save to SharePoint
      </Button>
      <Button size="sm" variant="outline" asChild data-testid="button-mlro-report">
        <a href={`/api/aml/deal/${dealId}/mlro-report`} target="_blank" rel="noreferrer">
          <FileDown className="w-3.5 h-3.5 mr-1.5" />
          Download MLRO Report PDF
        </a>
      </Button>
    </div>
  );
}
