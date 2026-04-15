import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Upload, FileText, Trash2, CheckCircle2, AlertCircle, Loader2,
  ShieldCheck, ShieldAlert, Clock, Download, Scan, ExternalLink,
} from "lucide-react";

interface KycDocument {
  id: string;
  doc_type: string;
  file_url: string;
  file_name: string;
  file_size: number | null;
  certified_by: string | null;
  certified_at: string | null;
  expires_at: string | null;
  notes: string | null;
  uploaded_at: string;
}

interface CompanyAmlState {
  id: string;
  name: string;
  kyc_status: string | null;
  kyc_checked_at: string | null;
  kyc_approved_by: string | null;
  kyc_expires_at: string | null;
  aml_checklist: any;
  aml_risk_level: string | null;
  aml_pep_status: string | null;
  aml_source_of_wealth: string | null;
  aml_source_of_wealth_notes: string | null;
  aml_edd_required: boolean;
  aml_edd_reason: string | null;
  aml_notes: string | null;
  companies_house_number: string | null;
}

// MLR 2017 Reg 28 — standard CDD checklist for a counterparty
const CHECKLIST_ITEMS = [
  { id: "id_verified", label: "Identity verified (passport / driving licence)", group: "CDD" },
  { id: "address_verified", label: "Address verified (utility / bank statement)", group: "CDD" },
  { id: "ubo_identified", label: "Ultimate beneficial owner(s) identified", group: "CDD" },
  { id: "company_cert", label: "Cert of incorporation / Companies House check", group: "CDD" },
  { id: "sof_evidenced", label: "Source of funds evidenced", group: "CDD" },
  { id: "sow_evidenced", label: "Source of wealth evidenced", group: "CDD" },
  { id: "sanctions_clear", label: "Sanctions screening — no match", group: "Screening" },
  { id: "pep_checked", label: "PEP screening completed", group: "Screening" },
  { id: "adverse_media", label: "Adverse media check completed", group: "Screening" },
  { id: "edd_complete", label: "Enhanced due diligence (if required) complete", group: "EDD" },
  { id: "risk_assessed", label: "Customer risk rating assigned", group: "Risk" },
  { id: "mlro_review", label: "MLRO has reviewed file", group: "Sign-off" },
];

const DOC_TYPE_LABELS: Record<string, string> = {
  passport: "Passport",
  certified_passport: "Certified passport",
  drivers_licence: "Driving licence",
  proof_of_address: "Proof of address",
  source_of_funds: "Source of funds",
  source_of_wealth: "Source of wealth",
  ubo_declaration: "UBO declaration",
  company_cert: "Company cert",
  bank_statement: "Bank statement",
  onfido_report: "Onfido report",
  other: "Other",
};

function statusBadge(status: string | null, isExpired: boolean) {
  if (status === "approved" && !isExpired) return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200"><CheckCircle2 className="w-3 h-3 mr-1" />Approved</Badge>;
  if (status === "approved" && isExpired) return <Badge variant="destructive"><Clock className="w-3 h-3 mr-1" />Expired</Badge>;
  if (status === "rejected") return <Badge variant="destructive"><ShieldAlert className="w-3 h-3 mr-1" />Rejected</Badge>;
  if (status === "in_review") return <Badge className="bg-amber-100 text-amber-700 border-amber-200"><Clock className="w-3 h-3 mr-1" />In review</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
}

export function KycPanel({ companyId, dealId }: { companyId: string; dealId?: string }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedDocType, setSelectedDocType] = useState<string>("passport");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [certifiedBy, setCertifiedBy] = useState("");
  const [docNotes, setDocNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [veriffOpen, setVeriffOpen] = useState(false);
  const [veriffFirstName, setVeriffFirstName] = useState("");
  const [veriffLastName, setVeriffLastName] = useState("");
  const [veriffEmail, setVeriffEmail] = useState("");

  const { data: veriffStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/veriff/status"],
    queryFn: async () => {
      const res = await fetch("/api/veriff/status", { credentials: "include" });
      if (!res.ok) return { configured: false };
      return res.json();
    },
  });

  const { data: veriffSessions = [] } = useQuery<any[]>({
    queryKey: ["/api/veriff/sessions", { companyId }],
    queryFn: async () => {
      const res = await fetch(`/api/veriff/sessions?companyId=${companyId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!veriffStatus?.configured,
  });

  const createVeriff = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/veriff/sessions", {
        firstName: veriffFirstName,
        lastName: veriffLastName,
        email: veriffEmail || undefined,
        companyId,
        dealId,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setVeriffOpen(false);
      setVeriffFirstName(""); setVeriffLastName(""); setVeriffEmail("");
      queryClient.invalidateQueries({ queryKey: ["/api/veriff/sessions", { companyId }] });
      toast({
        title: "Veriff session created",
        description: data?.verificationUrl ? "Copy the link to send to the subject, or open it now." : "",
      });
      if (data?.verificationUrl) {
        window.open(data.verificationUrl, "_blank", "noopener,noreferrer");
      }
    },
    onError: (e: any) => toast({ title: "Veriff error", description: e?.message, variant: "destructive" }),
  });

  const { data, isLoading } = useQuery<{ company: CompanyAmlState; documents: KycDocument[] }>({
    queryKey: ["/api/kyc/company", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/kyc/company/${companyId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const company = data?.company;
  const documents = data?.documents || [];
  const checklist: Record<string, { ticked: boolean; notes?: string }> = company?.aml_checklist || {};
  const isExpired = !!(company?.kyc_expires_at && new Date(company.kyc_expires_at) < new Date());
  const allTicked = CHECKLIST_ITEMS.every(item => checklist[item.id]?.ticked);
  const tickedCount = CHECKLIST_ITEMS.filter(item => checklist[item.id]?.ticked).length;

  const checklistMutation = useMutation({
    mutationFn: async (updates: any) => {
      const res = await apiRequest("PUT", `/api/kyc/company/${companyId}/checklist`, updates);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/kyc/company", companyId] }),
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/kyc/company/${companyId}/approve`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kyc/company", companyId] });
      if (dealId) queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
      toast({ title: "KYC approved", description: "6-month re-check reminder created automatically." });
    },
    onError: (e: any) => toast({ title: "Approve failed", description: e?.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (reason: string) => {
      const res = await apiRequest("POST", `/api/kyc/company/${companyId}/reject`, { reason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kyc/company", companyId] });
      toast({ title: "KYC rejected" });
    },
  });

  const deleteDoc = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/kyc/documents/${id}`);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/kyc/company", companyId] }),
  });

  async function uploadFile() {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", pendingFile);
      form.append("companyId", companyId);
      if (dealId) form.append("dealId", dealId);
      form.append("docType", selectedDocType);
      if (certifiedBy) form.append("certifiedBy", certifiedBy);
      if (docNotes) form.append("notes", docNotes);
      const res = await fetch("/api/kyc/documents/upload", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Upload failed");
      }
      setPendingFile(null);
      setCertifiedBy("");
      setDocNotes("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/kyc/company", companyId] });
      toast({ title: "Document uploaded" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function toggleChecklistItem(itemId: string) {
    const wasTicked = !!checklist[itemId]?.ticked;
    // Mark as a manual tick so the server-side orchestrator won't overwrite
    // it on the next auto-run — manual sign-off from the MLRO wins.
    const next = {
      ...checklist,
      [itemId]: wasTicked
        ? { ticked: false, source: "manual" }
        : { ticked: true, source: "manual", tickedAt: new Date().toISOString() },
    };
    checklistMutation.mutate({ checklist: next });
  }

  const runAllChecks = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/kyc/run-all-checks", { companyId, dealId });
      return res.json();
    },
    onSuccess: (data: any) => {
      const run = data?.runs?.[0];
      if (!run) {
        toast({ title: "AML sweep complete", description: "No runs returned" });
      } else if (run.error) {
        toast({ title: "AML sweep failed", description: run.error, variant: "destructive" });
      } else {
        const ticked = (run.checklistTicked || []).length;
        const veriff = (run.veriffLaunched || []).length;
        toast({
          title: "AML sweep complete",
          description: `Risk: ${run.risk?.level || "n/a"} · auto-ticked ${ticked} item${ticked === 1 ? "" : "s"} · launched ${veriff} Veriff session${veriff === 1 ? "" : "s"}`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/kyc/company", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/veriff/sessions", { companyId }] });
    },
    onError: (e: any) => toast({ title: "AML sweep failed", description: e?.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (!company) return null;

  const blockedReason = !allTicked
    ? `${CHECKLIST_ITEMS.length - tickedCount} checklist item${tickedCount === CHECKLIST_ITEMS.length - 1 ? "" : "s"} outstanding`
    : documents.length === 0
    ? "No supporting documents uploaded"
    : null;

  return (
    <div className="space-y-4" data-testid="kyc-panel">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              AML / KYC — {company.name}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {company.companies_house_number ? `Companies House: ${company.companies_house_number}` : "No CH number on file"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {statusBadge(company.kyc_status, isExpired)}
            {company.kyc_checked_at && (
              <span className="text-[11px] text-muted-foreground">
                {company.kyc_status === "approved" ? "Approved" : "Updated"} {new Date(company.kyc_checked_at).toLocaleDateString("en-GB")}
                {company.kyc_approved_by ? ` by ${company.kyc_approved_by}` : ""}
              </span>
            )}
            {company.kyc_expires_at && (
              <span className={`text-[11px] ${isExpired ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                Re-check due {new Date(company.kyc_expires_at).toLocaleDateString("en-GB")}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Risk + PEP */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Customer risk rating</label>
              <Select
                value={company.aml_risk_level || ""}
                onValueChange={(v) => checklistMutation.mutate({ riskLevel: v })}
              >
                <SelectTrigger data-testid="select-risk-level"><SelectValue placeholder="Set risk level" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">PEP status</label>
              <Select
                value={company.aml_pep_status || ""}
                onValueChange={(v) => checklistMutation.mutate({ pepStatus: v })}
              >
                <SelectTrigger data-testid="select-pep-status"><SelectValue placeholder="Set PEP status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="clear">Clear</SelectItem>
                  <SelectItem value="pep_domestic">PEP — Domestic</SelectItem>
                  <SelectItem value="pep_foreign">PEP — Foreign</SelectItem>
                  <SelectItem value="pep_associate">PEP — Associate</SelectItem>
                  <SelectItem value="pep_family">PEP — Family</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Source of wealth */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Source of wealth</label>
            <Select
              value={company.aml_source_of_wealth || ""}
              onValueChange={(v) => checklistMutation.mutate({ sourceOfWealth: v })}
            >
              <SelectTrigger data-testid="select-sow"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="employment">Employment income</SelectItem>
                <SelectItem value="business">Business ownership / sale</SelectItem>
                <SelectItem value="inheritance">Inheritance</SelectItem>
                <SelectItem value="investment">Investments</SelectItem>
                <SelectItem value="property">Property sale</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              className="mt-2 text-sm"
              placeholder="Source of wealth notes / evidence summary"
              value={company.aml_source_of_wealth_notes || ""}
              onBlur={(e) => {
                if (e.target.value !== (company.aml_source_of_wealth_notes || "")) {
                  checklistMutation.mutate({ sourceOfWealthNotes: e.target.value });
                }
              }}
              defaultValue={company.aml_source_of_wealth_notes || ""}
              data-testid="textarea-sow-notes"
            />
          </div>

          {/* Checklist */}
          <div>
            <div className="flex items-center justify-between mb-2 gap-2">
              <h4 className="text-sm font-semibold">MLR 2017 CDD Checklist</h4>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{tickedCount} / {CHECKLIST_ITEMS.length}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runAllChecks.mutate()}
                  disabled={runAllChecks.isPending}
                  data-testid="btn-run-all-checks"
                  className="h-7 text-xs"
                >
                  {runAllChecks.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Scan className="w-3 h-3 mr-1" />}
                  Run all AML checks
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              {CHECKLIST_ITEMS.map(item => {
                const entry = checklist[item.id] as { ticked?: boolean; source?: string; notes?: string } | undefined;
                const source = entry?.source;
                const autoTicked = entry?.ticked && source && source !== "manual";
                return (
                  <label
                    key={item.id}
                    className="flex items-start gap-2 text-sm cursor-pointer hover:bg-muted/40 rounded-md px-2 py-1.5"
                    data-testid={`checklist-item-${item.id}`}
                    title={entry?.notes || ""}
                  >
                    <Checkbox
                      checked={!!entry?.ticked}
                      onCheckedChange={() => toggleChecklistItem(item.id)}
                      className="mt-0.5"
                    />
                    <span className={`flex-1 ${entry?.ticked ? "text-muted-foreground line-through" : ""}`}>
                      {item.label}
                    </span>
                    {autoTicked && (
                      <Badge variant="secondary" className="text-[10px] shrink-0" data-testid={`source-${item.id}`}>
                        auto · {source}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] shrink-0">{item.group}</Badge>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Documents */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold">Documents</h4>
              <span className="text-xs text-muted-foreground">{documents.length} on file</span>
            </div>
            {documents.length > 0 ? (
              <div className="space-y-1.5 mb-3">
                {documents.map(doc => (
                  <div key={doc.id} className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-md text-sm" data-testid={`doc-${doc.id}`}>
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}</Badge>
                        <span className="truncate font-medium">{doc.file_name}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(doc.uploaded_at).toLocaleDateString("en-GB")}
                        {doc.certified_by ? ` · certified by ${doc.certified_by}` : ""}
                        {doc.expires_at ? ` · expires ${new Date(doc.expires_at).toLocaleDateString("en-GB")}` : ""}
                      </div>
                    </div>
                    <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground" data-testid={`doc-download-${doc.id}`}>
                      <Download className="w-4 h-4" />
                    </a>
                    <button onClick={() => deleteDoc.mutate(doc.id)} className="shrink-0 text-muted-foreground hover:text-red-600" data-testid={`doc-delete-${doc.id}`}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic mb-3">No documents uploaded yet.</div>
            )}

            {/* Upload form */}
            <div className="border border-dashed border-border rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Select value={selectedDocType} onValueChange={setSelectedDocType}>
                  <SelectTrigger className="h-9 text-sm" data-testid="select-doc-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="h-9 text-sm"
                  placeholder="Certified by (optional)"
                  value={certifiedBy}
                  onChange={(e) => setCertifiedBy(e.target.value)}
                  data-testid="input-certified-by"
                />
              </div>
              <Input
                className="h-9 text-sm"
                placeholder="Notes (optional)"
                value={docNotes}
                onChange={(e) => setDocNotes(e.target.value)}
                data-testid="input-doc-notes"
              />
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => setPendingFile(e.target.files?.[0] || null)}
                className="text-sm w-full"
                data-testid="input-doc-file"
              />
              <Button
                onClick={uploadFile}
                disabled={!pendingFile || uploading}
                className="w-full"
                size="sm"
                data-testid="button-upload-doc"
              >
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                Upload {pendingFile ? `"${pendingFile.name}"` : "document"}
              </Button>
            </div>
          </div>

          {/* Biometric verification via Veriff */}
          {veriffStatus?.configured && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold flex items-center gap-1.5">
                  <Scan className="w-3.5 h-3.5 text-primary" />
                  Biometric verification (Veriff)
                </h4>
                <Button size="sm" variant="outline" onClick={() => setVeriffOpen(true)} data-testid="button-request-veriff">
                  Request check
                </Button>
              </div>
              {veriffSessions.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">No biometric checks requested yet.</div>
              ) : (
                <div className="space-y-1.5">
                  {veriffSessions.map((s: any) => (
                    <div key={s.session_id} className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-md text-sm" data-testid={`veriff-${s.session_id}`}>
                      <Scan className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{s.first_name} {s.last_name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          Session {(s.session_id as string).slice(0, 8)}… · {new Date(s.created_at).toLocaleDateString("en-GB")}
                          {s.decision_reason ? ` · ${s.decision_reason}` : ""}
                        </div>
                      </div>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${
                        s.status === "approved" ? "border-emerald-300 text-emerald-700" :
                        s.status === "declined" ? "border-red-300 text-red-700" :
                        s.status === "resubmission_requested" ? "border-amber-300 text-amber-700" :
                        ""
                      }`}>
                        {s.status || "created"}
                      </Badge>
                      {s.verification_url && s.status !== "approved" && s.status !== "declined" && (
                        <a
                          href={s.verification_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-primary hover:text-primary/70"
                          title="Open Veriff session"
                          data-testid={`veriff-open-${s.session_id}`}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Veriff request dialog */}
          <AlertDialog open={veriffOpen} onOpenChange={setVeriffOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Request biometric verification</AlertDialogTitle>
                <AlertDialogDescription>
                  Creates a Veriff session for this counterparty. You'll get a unique verification URL
                  to send to the subject — they'll upload their ID and a selfie on their own device.
                  The result posts back to this company record automatically.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2">
                <Input value={veriffFirstName} onChange={(e) => setVeriffFirstName(e.target.value)} placeholder="First name" data-testid="input-veriff-firstname" />
                <Input value={veriffLastName} onChange={(e) => setVeriffLastName(e.target.value)} placeholder="Last name" data-testid="input-veriff-lastname" />
                <Input value={veriffEmail} onChange={(e) => setVeriffEmail(e.target.value)} placeholder="Email (optional)" type="email" data-testid="input-veriff-email" />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => { e.preventDefault(); createVeriff.mutate(); }}
                  disabled={!veriffFirstName || !veriffLastName || createVeriff.isPending}
                >
                  {createVeriff.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
                  Create session
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Approve / Reject actions */}
          {company.kyc_status !== "approved" && (
            <div className="border-t border-border pt-4">
              {blockedReason ? (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm" data-testid="kyc-blocked-reason">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium text-amber-900">Cannot approve yet</div>
                    <div className="text-amber-700 text-xs">{blockedReason}</div>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" data-testid="button-mlro-approve">
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        MLRO Approve
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Approve KYC for {company.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will mark the company as KYC-approved for 6 months and create an automatic
                          re-check reminder. Only do this if you've reviewed every checklist item and supporting
                          document. Your name and the timestamp will be recorded in the audit log.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => approveMutation.mutate()} className="bg-emerald-600 hover:bg-emerald-700">
                          Confirm approve
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <RejectButton onReject={(reason) => rejectMutation.mutate(reason)} />
                </div>
              )}
            </div>
          )}
          {company.kyc_status === "approved" && !isExpired && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-md text-sm" data-testid="kyc-approved-banner">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="text-emerald-900">
                Approved by <strong>{company.kyc_approved_by || "MLRO"}</strong>
                {company.kyc_checked_at ? ` on ${new Date(company.kyc_checked_at).toLocaleDateString("en-GB")}` : ""}.
                Valid until {company.kyc_expires_at ? new Date(company.kyc_expires_at).toLocaleDateString("en-GB") : "—"}.
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RejectButton({ onReject }: { onReject: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" data-testid="button-mlro-reject">
          Reject
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reject KYC?</AlertDialogTitle>
          <AlertDialogDescription>
            Add the reason — this is appended to the AML notes and visible to the team.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejection" data-testid="textarea-reject-reason" />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => onReject(reason)} className="bg-red-600 hover:bg-red-700">
            Confirm reject
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
