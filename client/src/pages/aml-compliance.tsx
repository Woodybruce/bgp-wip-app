import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldCheck, UserCog, GraduationCap, Clock, AlertTriangle, Play,
  Plus, Check, Trash2, Save, ChevronDown, ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// --- MLRO Settings Section ---
function MlroSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ["/api/aml/settings"],
    queryFn: () => fetch("/api/aml/settings").then(r => r.json()),
  });

  const [form, setForm] = useState<any>({});
  const [editing, setEditing] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (body: any) => fetch("/api/aml/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/aml/settings"] }); setEditing(false); toast({ title: "Settings saved" }); },
  });

  const s = settings || {};

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCog className="w-4 h-4" />
            Nominated Officer (MLRO)
          </CardTitle>
          {!editing && (
            <Button size="sm" variant="outline" onClick={() => { setForm({ nominatedOfficerName: s.nominated_officer_name || "", nominatedOfficerEmail: s.nominated_officer_email || "", amlPolicyNotes: s.aml_policy_notes || "", recheckIntervalDays: s.recheck_interval_days || 365 }); setEditing(true); }}>
              Edit
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Under MLR 2017 Regulation 21, estate agents must appoint a nominated officer responsible for receiving and assessing internal suspicious activity reports.</p>
      </CardHeader>
      <CardContent>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : editing ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Officer Name</label>
              <Input value={form.nominatedOfficerName} onChange={e => setForm({ ...form, nominatedOfficerName: e.target.value })} placeholder="e.g. John Smith" />
            </div>
            <div>
              <label className="text-xs font-medium">Email</label>
              <Input value={form.nominatedOfficerEmail} onChange={e => setForm({ ...form, nominatedOfficerEmail: e.target.value })} placeholder="mlro@bgp.co.uk" />
            </div>
            <div>
              <label className="text-xs font-medium">Re-check Interval (days)</label>
              <Input type="number" value={form.recheckIntervalDays} onChange={e => setForm({ ...form, recheckIntervalDays: parseInt(e.target.value) || 365 })} />
            </div>
            <div>
              <label className="text-xs font-medium">AML Policy Notes</label>
              <textarea className="w-full border rounded p-2 text-sm min-h-[80px]" value={form.amlPolicyNotes} onChange={e => setForm({ ...form, amlPolicyNotes: e.target.value })} placeholder="Firm AML policy summary..." />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
                <Save className="w-3 h-3 mr-1" /> Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            {s.nominated_officer_name ? (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">Name:</span><span className="font-medium">{s.nominated_officer_name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Email:</span><span>{s.nominated_officer_email || "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Re-check interval:</span><span>{s.recheck_interval_days || 365} days</span></div>
                {s.aml_policy_notes && <div className="mt-2 p-2 bg-muted/50 rounded text-xs">{s.aml_policy_notes}</div>}
              </>
            ) : (
              <div className="text-center py-4">
                <AlertTriangle className="w-8 h-8 mx-auto text-amber-500 mb-2" />
                <p className="font-medium text-amber-700">No MLRO Designated</p>
                <p className="text-xs text-muted-foreground mt-1">You must designate a Nominated Officer under MLR 2017 Regulation 21.</p>
                <Button size="sm" className="mt-3" onClick={() => { setForm({ nominatedOfficerName: "", nominatedOfficerEmail: "", amlPolicyNotes: "", recheckIntervalDays: 365 }); setEditing(true); }}>
                  Designate MLRO
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Training Records Section ---
function TrainingRecords() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: records = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/aml/training"],
    queryFn: () => fetch("/api/aml/training").then(r => r.json()),
  });

  // Cross-link: map each logged training row to the interactive module
  // (if one exists with a matching title) so the MLRO can see who's due
  // to re-take and jump straight into the quiz.
  const { data: modules = [] } = useQuery<Array<{ id: string; title: string }>>({
    queryKey: ["/api/aml/training-modules"],
    queryFn: () => fetch("/api/aml/training-modules", { credentials: "include" }).then(r => r.json()),
  });
  const moduleByTitle = new Map(modules.map(m => [m.title.toLowerCase(), m.id]));
  const moduleByType = (trainingType: string): string | null => {
    const t = (trainingType || "").toLowerCase();
    // Direct title match
    if (moduleByTitle.has(t)) return moduleByTitle.get(t) || null;
    // Match legacy training_type slugs against our module titles
    const aliases: Record<string, string> = {
      induction: "aml essentials",
      annual_refresher: "aml essentials",
      sar_reporting: "sar reporting",
      sanctions_screening: "sanctions screening",
    };
    const alias = aliases[t];
    if (alias) {
      for (const [title, id] of Array.from(moduleByTitle.entries())) {
        if (title.includes(alias)) return id;
      }
    }
    return null;
  };

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ userName: "", trainingType: "annual_refresher", trainingDate: new Date().toISOString().slice(0, 10), topics: "", notes: "" });

  const addMutation = useMutation({
    mutationFn: (body: any) => fetch("/api/aml/training", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/aml/training"] }); setShowAdd(false); setForm({ userName: "", trainingType: "annual_refresher", trainingDate: new Date().toISOString().slice(0, 10), topics: "", notes: "" }); toast({ title: "Training record added" }); },
  });

  const completeMutation = useMutation({
    mutationFn: (id: number) => fetch(`/api/aml/training/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completedAt: new Date().toISOString() }) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/aml/training"] }); toast({ title: "Marked as complete" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fetch(`/api/aml/training/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/aml/training"] }); toast({ title: "Record deleted" }); },
  });

  const trainingTypes: Record<string, string> = {
    induction: "New Starter Induction",
    annual_refresher: "Annual Refresher",
    edd_workshop: "Enhanced Due Diligence Workshop",
    sar_reporting: "SAR Reporting Procedures",
    sanctions_screening: "Sanctions Screening",
    pep_awareness: "PEP Awareness",
    red_flags: "Red Flags & Suspicious Activity",
    custom: "Custom / Other",
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <GraduationCap className="w-4 h-4" />
            Staff AML Training Log
          </CardTitle>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline" data-testid="button-open-training-tab">
              <a href="/kyc-clouseau?tab=training">
                <GraduationCap className="w-3 h-3 mr-1" />
                Take a module
              </a>
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
              {showAdd ? <ChevronUp className="w-3 h-3 mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
              {showAdd ? "Cancel" : "Log Training"}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">MLR 2017 Regulation 24 requires firms to take appropriate measures to ensure employees are aware of AML obligations. Staff training is auto-logged when they pass a module on the Training tab.</p>
      </CardHeader>
      <CardContent>
        {showAdd && (
          <div className="border rounded-lg p-3 mb-4 bg-muted/30 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">Staff Member</label>
                <Input value={form.userName} onChange={e => setForm({ ...form, userName: e.target.value })} placeholder="Full name" />
              </div>
              <div>
                <label className="text-xs font-medium">Training Type</label>
                <select className="w-full border rounded px-2 py-2 text-sm bg-background" value={form.trainingType} onChange={e => setForm({ ...form, trainingType: e.target.value })}>
                  {Object.entries(trainingTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">Training Date</label>
              <Input type="date" value={form.trainingDate} onChange={e => setForm({ ...form, trainingDate: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium">Topics Covered</label>
              <Input value={form.topics} onChange={e => setForm({ ...form, topics: e.target.value })} placeholder="Comma-separated, e.g. CDD, EDD, PEPs, SARs" />
            </div>
            <div>
              <label className="text-xs font-medium">Notes</label>
              <textarea className="w-full border rounded p-2 text-sm min-h-[60px]" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Additional notes..." />
            </div>
            <Button size="sm" onClick={() => addMutation.mutate({ userId: form.userName.toLowerCase().replace(/\s+/g, "."), userName: form.userName, trainingType: form.trainingType, trainingDate: form.trainingDate, topics: form.topics.split(",").map(t => t.trim()).filter(Boolean), notes: form.notes || undefined })} disabled={!form.userName || addMutation.isPending}>
              <Save className="w-3 h-3 mr-1" /> Save Record
            </Button>
          </div>
        )}

        {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : records.length === 0 ? (
          <div className="text-center py-6">
            <GraduationCap className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No training records yet</p>
            <p className="text-xs text-muted-foreground mt-1">Click "Log Training" to add a record</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(records as any[]).map((r: any) => (
              <div key={r.id} className="flex items-center justify-between border rounded-lg p-2.5 text-sm">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${r.completed_at ? "bg-green-500" : "bg-amber-500"}`} />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.user_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {trainingTypes[r.training_type] || r.training_type} — {new Date(r.training_date).toLocaleDateString("en-GB")}
                    </div>
                    {r.topics?.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {r.topics.map((t: string, i: number) => <Badge key={i} variant="secondary" className="text-[9px] px-1 py-0">{t}</Badge>)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {(() => {
                    const moduleId = moduleByType(r.training_type);
                    if (!moduleId) return null;
                    const label = r.completed_at ? "Re-take" : "Take";
                    return (
                      <Button asChild size="sm" variant="outline" className="h-7 text-xs" data-testid={`take-module-${r.id}`}>
                        <a href={`/aml-training/${moduleId}`}>
                          <Play className="w-3 h-3 mr-1" /> {label}
                        </a>
                      </Button>
                    );
                  })()}
                  {r.completed_at ? (
                    <Badge variant="default" className="bg-green-600 text-[10px]">
                      <Check className="w-2.5 h-2.5 mr-0.5" /> Complete
                    </Badge>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => completeMutation.mutate(r.id)}>
                      <Check className="w-3 h-3 mr-1" /> Mark Complete
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => deleteMutation.mutate(r.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Re-check Reminders Section ---
function RecheckReminders() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: reminders = [], isLoading } = useQuery({
    queryKey: ["/api/aml/reminders"],
    queryFn: () => fetch("/api/aml/reminders").then(r => r.json()),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ entityName: "", recheckType: "annual_cdd", dueDate: "", notes: "" });

  const addMutation = useMutation({
    mutationFn: (body: any) => fetch("/api/aml/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/aml/reminders"] }); setShowAdd(false); toast({ title: "Reminder created" }); },
  });

  const completeMutation = useMutation({
    mutationFn: (id: number) => fetch(`/api/aml/reminders/${id}/complete`, { method: "PUT" }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/aml/reminders"] }); toast({ title: "Reminder completed" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fetch(`/api/aml/reminders/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/aml/reminders"] }); toast({ title: "Reminder deleted" }); },
  });

  const recheckTypes: Record<string, string> = {
    annual_cdd: "Annual CDD Re-check",
    pep_screening: "PEP Re-screening",
    sanctions_check: "Sanctions Re-check",
    edd_review: "EDD Review",
    risk_reassessment: "Risk Re-assessment",
  };

  const now = new Date();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="w-4 h-4" />
            Re-check Reminders
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? <ChevronUp className="w-3 h-3 mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
            {showAdd ? "Cancel" : "Add Reminder"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Ongoing monitoring under MLR 2017 Regulation 28(11). CDD must be re-applied when there's a material change or when existing documents are outdated.</p>
      </CardHeader>
      <CardContent>
        {showAdd && (
          <div className="border rounded-lg p-3 mb-4 bg-muted/30 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">Entity / Client Name</label>
                <Input value={form.entityName} onChange={e => setForm({ ...form, entityName: e.target.value })} placeholder="Company or individual name" />
              </div>
              <div>
                <label className="text-xs font-medium">Re-check Type</label>
                <select className="w-full border rounded px-2 py-2 text-sm bg-background" value={form.recheckType} onChange={e => setForm({ ...form, recheckType: e.target.value })}>
                  {Object.entries(recheckTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">Due Date</label>
              <Input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium">Notes</label>
              <textarea className="w-full border rounded p-2 text-sm min-h-[60px]" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
            <Button size="sm" onClick={() => addMutation.mutate(form)} disabled={!form.entityName || !form.dueDate || addMutation.isPending}>
              <Save className="w-3 h-3 mr-1" /> Create Reminder
            </Button>
          </div>
        )}

        {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : (reminders as any[]).length === 0 ? (
          <div className="text-center py-6">
            <Clock className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No reminders set</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(reminders as any[]).map((r: any) => {
              const due = new Date(r.due_date);
              const isOverdue = !r.completed_at && due < now;
              const isDueSoon = !r.completed_at && !isOverdue && (due.getTime() - now.getTime()) < 30 * 24 * 60 * 60 * 1000;
              return (
                <div key={r.id} className={`flex items-center justify-between border rounded-lg p-2.5 text-sm ${isOverdue ? "border-red-300 bg-red-50 dark:bg-red-950/20" : isDueSoon ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20" : ""}`}>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${r.completed_at ? "bg-green-500" : isOverdue ? "bg-red-500" : isDueSoon ? "bg-amber-500" : "bg-blue-500"}`} />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{r.entity_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {recheckTypes[r.recheck_type] || r.recheck_type} — Due: {due.toLocaleDateString("en-GB")}
                        {isOverdue && <span className="text-red-600 font-medium ml-1">OVERDUE</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {r.completed_at ? (
                      <Badge variant="default" className="bg-green-600 text-[10px]">
                        <Check className="w-2.5 h-2.5 mr-0.5" /> Done {r.completed_by && `by ${r.completed_by}`}
                      </Badge>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => completeMutation.mutate(r.id)}>
                        <Check className="w-3 h-3 mr-1" /> Complete
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => deleteMutation.mutate(r.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Firm-wide Risk Assessment ---
function FirmRiskAssessment() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: settings } = useQuery<any>({
    queryKey: ["/api/aml/settings"],
    queryFn: () => fetch("/api/aml/settings").then(r => r.json()),
  });

  const [editing, setEditing] = useState(false);
  const [assessment, setAssessment] = useState({
    overallRisk: "medium",
    clientRisk: "",
    serviceRisk: "",
    geographicRisk: "",
    transactionRisk: "",
    mitigatingMeasures: "",
  });

  const saveMutation = useMutation({
    mutationFn: (body: any) => fetch("/api/aml/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/aml/settings"] }); setEditing(false); toast({ title: "Risk assessment saved" }); },
  });

  const populateDefault = useMutation({
    mutationFn: () => fetch("/api/aml/risk-assessment/populate-default", { method: "POST", credentials: "include" }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/aml/settings"] });
      toast({ title: "Template populated", description: "Review the draft, edit anything BGP-specific, then click Approve." });
    },
  });

  const approveAssessment = useMutation({
    mutationFn: () => fetch("/api/aml/risk-assessment/approve", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/aml/settings"] }); toast({ title: "Risk assessment approved", description: "Next review scheduled in 12 months." }); },
  });

  const existing = settings?.firm_risk_assessment;
  const status = settings?.firm_risk_assessment_status || (existing ? "draft" : null);
  const approvedAt = settings?.firm_risk_assessment_approved_at;
  const approvedBy = settings?.firm_risk_assessment_approved_by;
  const nextReview = settings?.firm_risk_assessment_next_review_at;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="w-4 h-4" />
            Firm-wide Risk Assessment
          </CardTitle>
          {!editing && (
            <div className="flex items-center gap-2">
              {status === "approved" && (
                <Badge className="bg-emerald-600">Approved</Badge>
              )}
              {status === "draft" && (
                <Badge className="bg-amber-600">Draft — unapproved</Badge>
              )}
              {!existing && (
                <Button size="sm" variant="outline" onClick={() => populateDefault.mutate()} disabled={populateDefault.isPending} data-testid="button-populate-template">
                  Populate MLR 2017 template
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => {
                if (existing) setAssessment(existing);
                setEditing(true);
              }} data-testid="button-edit-risk-assessment">
                {existing ? "Edit" : "Create blank"}
              </Button>
              {existing && status !== "approved" && (
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => approveAssessment.mutate()} disabled={approveAssessment.isPending} data-testid="button-approve-risk-assessment">
                  MLRO Approve
                </Button>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">MLR 2017 Regulation 18 requires estate agents to carry out a firm-wide risk assessment identifying and assessing the risks of money laundering and terrorist financing.</p>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Overall Risk Level</label>
              <div className="flex gap-2 mt-1">
                {["low", "medium", "high"].map(level => (
                  <button
                    key={level}
                    className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                      assessment.overallRisk === level
                        ? level === "low" ? "bg-green-100 border-green-400 text-green-800"
                        : level === "medium" ? "bg-amber-100 border-amber-400 text-amber-800"
                        : "bg-red-100 border-red-400 text-red-800"
                        : "bg-muted hover:bg-muted/80"
                    }`}
                    onClick={() => setAssessment({ ...assessment, overallRisk: level })}
                  >
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {[
              { key: "clientRisk", label: "Client Risk Factors", placeholder: "Types of clients served, proportion of high-risk clients..." },
              { key: "serviceRisk", label: "Service/Product Risk Factors", placeholder: "Types of property transactions, sale/lettings split..." },
              { key: "geographicRisk", label: "Geographic Risk Factors", placeholder: "London super-prime exposure, international buyers..." },
              { key: "transactionRisk", label: "Transaction Risk Factors", placeholder: "Cash purchases, complex ownership structures..." },
              { key: "mitigatingMeasures", label: "Mitigating Measures", placeholder: "EDD procedures, enhanced monitoring, training frequency..." },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="text-xs font-medium">{label}</label>
                <textarea
                  className="w-full border rounded p-2 text-sm min-h-[60px]"
                  value={(assessment as any)[key] || ""}
                  onChange={e => setAssessment({ ...assessment, [key]: e.target.value })}
                  placeholder={placeholder}
                />
              </div>
            ))}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => saveMutation.mutate({ firmRiskAssessment: assessment, firmRiskAssessmentUpdatedBy: "current_user" })} disabled={saveMutation.isPending}>
                <Save className="w-3 h-3 mr-1" /> Save Assessment
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        ) : existing ? (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Overall risk:</span>
              <Badge className={
                existing.overallRisk === "low" ? "bg-green-600" :
                existing.overallRisk === "high" ? "bg-red-600" : "bg-amber-600"
              }>{existing.overallRisk?.toUpperCase()}</Badge>
            </div>
            {settings?.firm_risk_assessment_updated_at && (
              <p className="text-xs text-muted-foreground">
                Last updated: {new Date(settings.firm_risk_assessment_updated_at).toLocaleDateString("en-GB")}
                {settings.firm_risk_assessment_updated_by && ` by ${settings.firm_risk_assessment_updated_by}`}
              </p>
            )}
            {status === "approved" && approvedAt && (
              <p className="text-xs text-emerald-700 font-medium" data-testid="risk-assessment-approved-line">
                Approved by {approvedBy || "MLRO"} on {new Date(approvedAt).toLocaleDateString("en-GB")}
                {nextReview && ` · Next review due ${new Date(nextReview).toLocaleDateString("en-GB")}`}
              </p>
            )}
            {[
              { key: "clientRisk", label: "Client Risk" },
              { key: "serviceRisk", label: "Service Risk" },
              { key: "geographicRisk", label: "Geographic Risk" },
              { key: "transactionRisk", label: "Transaction Risk" },
              { key: "mitigatingMeasures", label: "Mitigating Measures" },
            ].map(({ key, label }) => existing[key] ? (
              <div key={key}>
                <p className="text-xs font-medium text-muted-foreground">{label}</p>
                <p className="text-sm mt-0.5">{existing[key]}</p>
              </div>
            ) : null)}
          </div>
        ) : (
          <div className="text-center py-6">
            <AlertTriangle className="w-8 h-8 mx-auto text-amber-500 mb-2" />
            <p className="font-medium text-amber-700">No Risk Assessment</p>
            <p className="text-xs text-muted-foreground mt-1">A firm-wide risk assessment is required under MLR 2017.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Main Page ---
export default function AmlCompliancePage() {
  const { data: overdueCount } = useQuery({
    queryKey: ["/api/aml/reminders/overdue-count"],
    queryFn: () => fetch("/api/aml/reminders/overdue-count").then(r => r.json()),
  });

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="px-6 py-4 border-b bg-background">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">AML Compliance</h1>
            <p className="text-xs text-muted-foreground">
              Money Laundering Regulations 2017 — Estate Agent Compliance Dashboard
              {overdueCount?.count > 0 && (
                <Badge variant="destructive" className="ml-2 text-[10px]">{overdueCount.count} overdue</Badge>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6 max-w-4xl">
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 text-xs text-blue-800 dark:text-blue-300">
          <p className="font-semibold mb-1">UK Money Laundering Regulations 2017 — Estate Agent Obligations</p>
          <p>Estate agents are subject to the MLR 2017 and must implement Customer Due Diligence (CDD), maintain policies & procedures, appoint a Nominated Officer (MLRO), ensure staff training, and conduct ongoing monitoring. HMRC is the supervisory authority for estate agents.</p>
        </div>

        <MlroSettings />
        <FirmRiskAssessment />
        <TrainingRecords />
        <RecheckReminders />
      </div>
    </div>
  );
}
