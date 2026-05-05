import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Users, User, TrendingUp, Calendar, FileText, CreditCard,
  Building2, GraduationCap, Phone, Mail, MapPin, Linkedin,
  ChevronRight, ChevronDown, Plus, Pencil, Check, X,
  AlertCircle, Clock, CheckCircle2, BarChart3, ArrowLeft,
  Shield, Heart, Briefcase, Star, DollarSign, BookOpen,
  ExternalLink, Loader2, Search, SlidersHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getQueryFn } from "@/lib/queryClient";
import type { User as AuthUser } from "@shared/schema";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StaffMember {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  profile_pic_url: string | null;
  is_admin: boolean;
  is_active: boolean;
  team: string | null;
  profile_id: string | null;
  title: string | null;
  start_date: string | null;
  end_date: string | null;
  hr_status: string | null;
  salary_current: number | null;
  manager_id: string | null;
  manager_name: string | null;
  hr_department: string | null;
  rics_pathway: string | null;
  apc_status: string | null;
  apc_assessment_date: string | null;
  education: string | null;
  bio: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  holiday_entitlement: number | null;
  holiday_used: number | null;
  pension_opt_in: boolean | null;
  pension_rate: number | null;
  contract_sharepoint_url: string | null;
  passport_sharepoint_url: string | null;
  linkedin_url: string | null;
  xero_tracking_name: string | null;
}

interface SalaryEntry {
  id: string;
  salary_pence: number;
  effective_date: string;
  reason: string | null;
  notes: string | null;
  created_at: string;
}

interface CommissionData {
  salary: number;
  effectiveSalary: number;
  schemeYear: string;
  billedPence: number;
  t1: number; t2: number; t3: number;
  commissionEarned: number;
  billingsByYear: Array<{ year: string; pence: number }>;
  xeroError: string | null;
}

interface HolidayRequest {
  id: string;
  user_id: string;
  user_name: string;
  start_date: string;
  end_date: string;
  days_count: number;
  status: string;
  notes: string | null;
  approver_name: string | null;
  created_at: string;
}

interface HrDocument {
  id: string;
  user_id: string | null;
  doc_type: string;
  name: string;
  sharepoint_url: string | null;
  review_year: number | null;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtSalary = (pence: number) => `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const fmtProgress = (pence: number, total: number) => total > 0 ? Math.min((pence / total) * 100, 100) : 0;

function tenure(startDate: string | null): string {
  if (!startDate) return "—";
  const start = new Date(startDate);
  const now = new Date();
  const months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (months < 12) return `${months}m`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years}y ${rem}m` : `${years}y`;
}

function initials(name: string): string {
  return name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
}

function Avatar({ person, size = "md" }: { person: Pick<StaffMember, "name" | "profile_pic_url">, size?: "sm" | "md" | "lg" | "xl" }) {
  const sz = { sm: "w-8 h-8 text-xs", md: "w-10 h-10 text-sm", lg: "w-16 h-16 text-xl", xl: "w-24 h-24 text-2xl" }[size];
  if (person.profile_pic_url) {
    return <img src={person.profile_pic_url} alt={person.name} className={`${sz} rounded-full object-cover shrink-0`} />;
  }
  return (
    <div className={`${sz} rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary shrink-0`}>
      {initials(person.name)}
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === "leaver") return <Badge variant="outline" className="text-red-600 border-red-300">Leaver</Badge>;
  return <Badge variant="outline" className="text-green-600 border-green-300">Active</Badge>;
}

function ApcBadge({ status }: { status: string | null }) {
  if (!status || status === "not_started") return <Badge variant="outline" className="text-muted-foreground">APC: Not started</Badge>;
  if (status === "in_progress") return <Badge variant="outline" className="text-amber-600 border-amber-300">APC: In progress</Badge>;
  return <Badge variant="outline" className="text-green-600 border-green-300">APC: Complete</Badge>;
}

// ── Staff card (directory grid) ───────────────────────────────────────────────

function StaffCard({ person, onClick }: { person: StaffMember; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-3 p-4 rounded-lg border bg-card hover:bg-accent/40 transition-colors text-left w-full group"
    >
      <Avatar person={person} size="lg" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-sm truncate">{person.name}</span>
          <StatusBadge status={person.hr_status} />
        </div>
        <div className="text-xs text-muted-foreground truncate">{person.title || person.team || "—"}</div>
        <div className="text-xs text-muted-foreground mt-1">{person.hr_department || person.team || ""}</div>
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          {person.start_date && <span title="Tenure">{tenure(person.start_date)}</span>}
          {person.salary_current && <span className="font-medium text-foreground">{fmtSalary(person.salary_current)}</span>}
          {person.apc_status && person.apc_status !== "not_started" && <ApcBadge status={person.apc_status} />}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
    </button>
  );
}

// ── Commission tracker ────────────────────────────────────────────────────────

function CommissionTab({ userId }: { userId: string }) {
  const { data, isLoading, error } = useQuery<CommissionData>({
    queryKey: [`/api/hr/staff/${userId}/commission`],
  });

  if (isLoading) return <div className="flex items-center justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return <div className="p-6 text-sm text-muted-foreground">Commission data unavailable</div>;

  const pct1 = fmtProgress(data.billedPence, data.t1);
  const pct2 = fmtProgress(data.billedPence, data.t2);
  const pct3 = fmtProgress(data.billedPence, data.t3);
  const maxBar = Math.max(data.billingsByYear.map(b => b.pence).reduce((a, b) => Math.max(a, b), 0), 1);

  return (
    <div className="space-y-6 p-1">
      {data.xeroError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs border border-amber-200 dark:border-amber-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Xero billings unavailable — enter manually or check Xero connection. {data.xeroError}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Commission Tracker — {data.schemeYear} (1 May → 30 Apr)</span>
            <span className="text-xs font-normal text-muted-foreground">Salary {fmtSalary(data.salary)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Billed YTD</span>
            <span className="font-bold text-lg">{fmtSalary(data.billedPence)}</span>
          </div>

          {/* Threshold bars */}
          {[
            { label: "Tier 1 threshold (2× salary)", target: data.t1, pct: pct1, rate: "30%" },
            { label: "Tier 2 threshold (3× salary)", target: data.t2, pct: pct2, rate: "40%" },
            { label: "Tier 3 threshold (4× salary)", target: data.t3, pct: pct3, rate: "50%" },
          ].map(({ label, target, pct, rate }) => (
            <div key={label} className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{label}</span>
                <span>{fmtSalary(target)} → <span className="font-semibold text-foreground">{rate}</span></span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-green-500" : "bg-primary"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {data.billedPence < target && (
                <div className="text-xs text-muted-foreground">{fmtSalary(target - data.billedPence)} to go</div>
              )}
              {data.billedPence >= target && (
                <div className="text-xs text-green-600 flex items-center gap-1"><Check className="w-3 h-3" /> Threshold reached</div>
              )}
            </div>
          ))}

          <div className="flex items-center justify-between p-3 rounded-lg bg-primary/5 border">
            <span className="text-sm font-medium">Commission earned YTD</span>
            <span className="text-lg font-bold text-primary">{fmtSalary(data.commissionEarned)}</span>
          </div>
        </CardContent>
      </Card>

      {data.billingsByYear.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Billings by year</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.billingsByYear.map(y => (
                <div key={y.year} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">{y.year}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${(y.pence / maxBar) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium w-20 text-right shrink-0">{fmtSalary(y.pence)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Holiday tab ───────────────────────────────────────────────────────────────

function HolidayTab({ person, isAdmin, currentUserId }: { person: StaffMember; isAdmin: boolean; currentUserId: string }) {
  const { toast } = useToast();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ startDate: "", endDate: "", daysCount: "", notes: "" });

  const isOwn = person.id === currentUserId;

  const { data: requests = [] } = useQuery<HolidayRequest[]>({
    queryKey: [`/api/hr/holidays`, person.id],
    queryFn: () => fetch(`/api/hr/holidays?userId=${person.id}`, { credentials: "include" }).then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/hr/holidays", {
        startDate: form.startDate,
        endDate: form.endDate,
        daysCount: parseFloat(form.daysCount),
        notes: form.notes || undefined,
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/holidays`, person.id] });
      setShowNew(false);
      setForm({ startDate: "", endDate: "", daysCount: "", notes: "" });
      toast({ title: "Holiday request submitted" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const r = await apiRequest("PATCH", `/api/hr/holidays/${id}`, { status });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/holidays`, person.id] });
      toast({ title: "Updated" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const entitlement = person.holiday_entitlement ?? 25;
  const used = requests.filter(r => r.status === "approved").reduce((sum, r) => sum + r.days_count, 0);
  const pending = requests.filter(r => r.status === "pending").reduce((sum, r) => sum + r.days_count, 0);
  const remaining = entitlement - used;

  const statusIcon = (s: string) => ({
    pending: <Clock className="w-3 h-3 text-amber-500" />,
    approved: <CheckCircle2 className="w-3 h-3 text-green-500" />,
    rejected: <X className="w-3 h-3 text-red-500" />,
    cancelled: <X className="w-3 h-3 text-muted-foreground" />,
  }[s] || null);

  return (
    <div className="space-y-4 p-1">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Entitlement", value: entitlement, color: "text-foreground" },
          { label: "Used", value: used, color: "text-amber-600" },
          { label: "Remaining", value: remaining, color: remaining < 5 ? "text-red-600" : "text-green-600" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="text-center p-4">
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-xs text-muted-foreground mt-1">{label}</div>
          </Card>
        ))}
      </div>

      {pending > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs border border-amber-200">
          <Clock className="w-4 h-4 shrink-0" /> {pending} days pending approval
        </div>
      )}

      {(isOwn || isAdmin) && (
        <Button size="sm" variant="outline" onClick={() => setShowNew(true)} className="w-full">
          <Plus className="w-3.5 h-3.5 mr-1.5" /> Request holiday
        </Button>
      )}

      <div className="space-y-2">
        {requests.map(req => (
          <div key={req.id} className="flex items-center gap-3 p-3 rounded-lg border text-sm">
            {statusIcon(req.status)}
            <div className="flex-1 min-w-0">
              <div className="font-medium">{req.start_date} → {req.end_date}</div>
              <div className="text-xs text-muted-foreground">{req.days_count} days{req.notes ? ` · ${req.notes}` : ""}</div>
            </div>
            <Badge variant="outline" className="shrink-0 capitalize text-xs">{req.status}</Badge>
            {isAdmin && req.status === "pending" && (
              <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-green-600" onClick={() => updateMutation.mutate({ id: req.id, status: "approved" })}>
                  <Check className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600" onClick={() => updateMutation.mutate({ id: req.id, status: "rejected" })}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
            {isOwn && req.status === "pending" && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground shrink-0" onClick={() => updateMutation.mutate({ id: req.id, status: "cancelled" })}>
                Cancel
              </Button>
            )}
          </div>
        ))}
        {requests.length === 0 && <div className="text-sm text-muted-foreground text-center py-4">No holiday requests</div>}
      </div>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request holiday</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>End date</Label>
                <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Days count</Label>
              <Input type="number" step="0.5" placeholder="5" value={form.daysCount} onChange={e => setForm(f => ({ ...f, daysCount: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Input placeholder="e.g. Summer holiday" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!form.startDate || !form.endDate || !form.daysCount || createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Documents tab ─────────────────────────────────────────────────────────────

function DocumentsTab({ person, isAdmin }: { person: StaffMember; isAdmin: boolean }) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [docForm, setDocForm] = useState({ docType: "contract", name: "", sharepointUrl: "", reviewYear: "" });

  const { data: docs = [] } = useQuery<HrDocument[]>({
    queryKey: [`/api/hr/documents`, person.id],
    queryFn: () => fetch(`/api/hr/documents?userId=${person.id}`, { credentials: "include" }).then(r => r.json()),
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/hr/documents", {
        userId: person.id,
        docType: docForm.docType,
        name: docForm.name,
        sharepointUrl: docForm.sharepointUrl || undefined,
        reviewYear: docForm.reviewYear ? parseInt(docForm.reviewYear) : undefined,
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/documents`, person.id] });
      setShowAdd(false);
      toast({ title: "Document added" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/hr/documents/${id}`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/hr/documents`, person.id] }),
  });

  const docTypeIcon = (t: string) => ({
    contract: <FileText className="w-4 h-4 text-blue-500" />,
    passport: <Shield className="w-4 h-4 text-purple-500" />,
    review: <Star className="w-4 h-4 text-amber-500" />,
    payslip: <DollarSign className="w-4 h-4 text-green-500" />,
    policy: <BookOpen className="w-4 h-4 text-muted-foreground" />,
  }[t] || <FileText className="w-4 h-4 text-muted-foreground" />);

  // Quick links from profile data
  const quickLinks = [
    person.contract_sharepoint_url && { name: "Employment Contract", url: person.contract_sharepoint_url, type: "contract" },
    person.passport_sharepoint_url && { name: "Passport / Right to Work", url: person.passport_sharepoint_url, type: "passport" },
  ].filter(Boolean) as Array<{ name: string; url: string; type: string }>;

  return (
    <div className="space-y-4 p-1">
      {quickLinks.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quick links</div>
          {quickLinks.map(l => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
               className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/40 transition-colors">
              {docTypeIcon(l.type)}
              <span className="text-sm flex-1">{l.name}</span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </a>
          ))}
        </div>
      )}

      {docs.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Documents</div>
          {docs.map(doc => (
            <div key={doc.id} className="flex items-center gap-3 p-3 rounded-lg border">
              {docTypeIcon(doc.doc_type)}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{doc.name}</div>
                {doc.review_year && <div className="text-xs text-muted-foreground">{doc.review_year}</div>}
              </div>
              {doc.sharepoint_url && (
                <a href={doc.sharepoint_url} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="ghost" className="h-7 px-2"><ExternalLink className="w-3.5 h-3.5" /></Button>
                </a>
              )}
              {isAdmin && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-red-500" onClick={() => deleteMutation.mutate(doc.id)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <Button size="sm" variant="outline" onClick={() => setShowAdd(true)} className="w-full">
          <Plus className="w-3.5 h-3.5 mr-1.5" /> Add document link
        </Button>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={docForm.docType} onValueChange={v => setDocForm(f => ({ ...f, docType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["contract", "passport", "review", "payslip", "policy", "other"].map(t => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input placeholder="e.g. Employment Contract 2024" value={docForm.name} onChange={e => setDocForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>SharePoint URL (optional)</Label>
              <Input placeholder="https://..." value={docForm.sharepointUrl} onChange={e => setDocForm(f => ({ ...f, sharepointUrl: e.target.value }))} />
            </div>
            {docForm.docType === "review" && (
              <div className="space-y-1.5">
                <Label>Review year</Label>
                <Input type="number" placeholder="2025" value={docForm.reviewYear} onChange={e => setDocForm(f => ({ ...f, reviewYear: e.target.value }))} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate()} disabled={!docForm.name || addMutation.isPending}>
              {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Salary history panel ───────────────────────────────────────────────────────

function SalaryHistoryPanel({ person }: { person: StaffMember }) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ salary: "", effectiveDate: "", reason: "annual_review", notes: "" });

  const { data: history = [] } = useQuery<SalaryEntry[]>({
    queryKey: [`/api/hr/staff/${person.id}/salary`],
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/hr/staff/${person.id}/salary`, {
        salaryPence: Math.round(parseFloat(form.salary) * 100),
        effectiveDate: form.effectiveDate,
        reason: form.reason,
        notes: form.notes || undefined,
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/staff/${person.id}/salary`] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/staff"] });
      setShowAdd(false);
      setForm({ salary: "", effectiveDate: "", reason: "annual_review", notes: "" });
      toast({ title: "Salary record added" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Salary history</div>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAdd(true)}>
          <Plus className="w-3 h-3 mr-1" /> Record change
        </Button>
      </div>

      {history.map((entry, i) => (
        <div key={entry.id} className={`flex items-center gap-3 p-3 rounded-lg border ${i === 0 ? "bg-primary/5 border-primary/20" : ""}`}>
          <div className="flex-1">
            <div className="text-sm font-medium">{fmtSalary(entry.salary_pence)}</div>
            <div className="text-xs text-muted-foreground">{entry.effective_date} · {entry.reason?.replace(/_/g, " ")}</div>
            {entry.notes && <div className="text-xs text-muted-foreground italic mt-0.5">{entry.notes}</div>}
          </div>
          {i === 0 && <Badge variant="outline" className="text-xs shrink-0">Current</Badge>}
        </div>
      ))}
      {history.length === 0 && <div className="text-sm text-muted-foreground text-center py-3">No salary records</div>}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record salary change</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>New salary (£)</Label>
              <Input type="number" placeholder="65000" value={form.salary} onChange={e => setForm(f => ({ ...f, salary: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Effective date</Label>
              <Input type="date" value={form.effectiveDate} onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={form.reason} onValueChange={v => setForm(f => ({ ...f, reason: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="annual_review">Annual review</SelectItem>
                  <SelectItem value="promotion">Promotion</SelectItem>
                  <SelectItem value="joining">Joining salary</SelectItem>
                  <SelectItem value="adjustment">Adjustment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate()} disabled={!form.salary || !form.effectiveDate || addMutation.isPending}>
              {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Profile edit dialog ───────────────────────────────────────────────────────

function EditProfileDialog({ person, allStaff, open, onClose }: {
  person: StaffMember;
  allStaff: StaffMember[];
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: person.title || "",
    startDate: person.start_date || "",
    department: person.hr_department || person.team || "",
    managerId: person.manager_id || "",
    ricsPathway: person.rics_pathway || "",
    apcStatus: person.apc_status || "not_started",
    apcAssessmentDate: person.apc_assessment_date || "",
    education: person.education || "",
    bio: person.bio || "",
    emergencyContactName: person.emergency_contact_name || "",
    emergencyContactPhone: person.emergency_contact_phone || "",
    emergencyContactRelation: person.emergency_contact_relation || "",
    holidayEntitlement: String(person.holiday_entitlement ?? 25),
    pensionOptIn: person.pension_opt_in ?? true,
    pensionRate: String(person.pension_rate ?? 5),
    contractSharepointUrl: person.contract_sharepoint_url || "",
    passportSharepointUrl: person.passport_sharepoint_url || "",
    linkedinUrl: person.linkedin_url || "",
    xeroTrackingName: person.xero_tracking_name || "",
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/hr/staff/${person.id}/profile`, {
        title: form.title || undefined,
        startDate: form.startDate || undefined,
        department: form.department || undefined,
        managerId: form.managerId || undefined,
        ricsPathway: form.ricsPathway || undefined,
        apcStatus: form.apcStatus || undefined,
        apcAssessmentDate: form.apcAssessmentDate || undefined,
        education: form.education || undefined,
        bio: form.bio || undefined,
        emergencyContactName: form.emergencyContactName || undefined,
        emergencyContactPhone: form.emergencyContactPhone || undefined,
        emergencyContactRelation: form.emergencyContactRelation || undefined,
        holidayEntitlement: parseInt(form.holidayEntitlement) || 25,
        pensionOptIn: form.pensionOptIn,
        pensionRate: parseFloat(form.pensionRate) || 5,
        contractSharepointUrl: form.contractSharepointUrl || undefined,
        passportSharepointUrl: form.passportSharepointUrl || undefined,
        linkedinUrl: form.linkedinUrl || undefined,
        xeroTrackingName: form.xeroTrackingName || undefined,
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/staff"] });
      queryClient.invalidateQueries({ queryKey: [`/api/hr/staff/${person.id}`] });
      toast({ title: "Profile saved" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit profile — {person.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Job title</Label><Input value={form.title} onChange={f("title")} placeholder="e.g. Senior Surveyor" /></div>
            <div className="space-y-1.5"><Label>Department</Label><Input value={form.department} onChange={f("department")} placeholder="e.g. Leasing" /></div>
            <div className="space-y-1.5"><Label>Start date</Label><Input type="date" value={form.startDate} onChange={f("startDate")} /></div>
            <div className="space-y-1.5">
              <Label>Line manager</Label>
              <Select value={form.managerId || "none"} onValueChange={v => setForm(p => ({ ...p, managerId: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {allStaff.filter(s => s.id !== person.id).map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5"><Label>Education / University</Label><Input value={form.education} onChange={f("education")} placeholder="e.g. University of Reading, BSc Real Estate" /></div>
          <div className="space-y-1.5"><Label>Bio / notes</Label><Textarea rows={2} value={form.bio} onChange={f("bio")} /></div>
          <div className="space-y-1.5"><Label>LinkedIn URL</Label><Input value={form.linkedinUrl} onChange={f("linkedinUrl")} placeholder="https://linkedin.com/in/..." /></div>
          <div className="space-y-1.5"><Label>Xero tracking name</Label><Input value={form.xeroTrackingName} onChange={f("xeroTrackingName")} placeholder="How they appear in Xero tracking (for commission calc)" /></div>

          <div className="border-t pt-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">APC / RICS</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>RICS pathway</Label><Input value={form.ricsPathway} onChange={f("ricsPathway")} placeholder="e.g. Commercial Real Estate" /></div>
              <div className="space-y-1.5">
                <Label>APC status</Label>
                <Select value={form.apcStatus} onValueChange={v => setForm(p => ({ ...p, apcStatus: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_started">Not started</SelectItem>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.apcStatus === "in_progress" && (
                <div className="space-y-1.5"><Label>Assessment date</Label><Input type="date" value={form.apcAssessmentDate} onChange={f("apcAssessmentDate")} /></div>
              )}
            </div>
          </div>

          <div className="border-t pt-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Emergency contact</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label>Name</Label><Input value={form.emergencyContactName} onChange={f("emergencyContactName")} /></div>
              <div className="space-y-1.5"><Label>Phone</Label><Input value={form.emergencyContactPhone} onChange={f("emergencyContactPhone")} /></div>
              <div className="space-y-1.5"><Label>Relation</Label><Input value={form.emergencyContactRelation} onChange={f("emergencyContactRelation")} placeholder="Partner, parent..." /></div>
            </div>
          </div>

          <div className="border-t pt-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Benefits & entitlements</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Holiday entitlement (days)</Label><Input type="number" value={form.holidayEntitlement} onChange={f("holidayEntitlement")} /></div>
              <div className="space-y-1.5"><Label>Employee pension rate (%)</Label><Input type="number" step="0.5" value={form.pensionRate} onChange={f("pensionRate")} /></div>
            </div>
          </div>

          <div className="border-t pt-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">SharePoint document links</div>
            <div className="space-y-2">
              <div className="space-y-1.5"><Label>Contract URL</Label><Input value={form.contractSharepointUrl} onChange={f("contractSharepointUrl")} placeholder="https://brucegillinghampollard..." /></div>
              <div className="space-y-1.5"><Label>Passport / right to work URL</Label><Input value={form.passportSharepointUrl} onChange={f("passportSharepointUrl")} placeholder="https://brucegillinghampollard..." /></div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Save profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Staff profile detail view ─────────────────────────────────────────────────

function StaffProfile({ person, allStaff, isAdmin, currentUserId, onBack }: {
  person: StaffMember;
  allStaff: StaffMember[];
  isAdmin: boolean;
  currentUserId: string;
  onBack: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const isOwn = person.id === currentUserId;

  // Card from expenses system
  const { data: cardholder } = useQuery<any>({
    queryKey: ["/api/expenses/cardholders"],
    select: (data: any[]) => data?.find((c: any) => c.userId === person.id),
  });

  const { data: expenseSummary } = useQuery<any>({
    queryKey: ["/api/expenses/admin/summary"],
    enabled: isAdmin,
    select: (data: any) => data?.byCardholder?.find((c: any) => c.cardholderId === cardholder?.id),
  });

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b sticky top-0 bg-background z-10">
        <Button variant="ghost" size="sm" onClick={onBack} className="h-8 px-2">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        {(isAdmin || isOwn) && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setEditOpen(true)}>
            <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit profile
          </Button>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Profile header */}
        <div className="flex items-start gap-4">
          <Avatar person={person} size="xl" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold">{person.name}</h1>
              <StatusBadge status={person.hr_status} />
              {person.is_admin && <Badge variant="secondary" className="text-xs">Admin</Badge>}
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">{person.title || person.team || ""}</div>
            {person.hr_department && <div className="text-sm text-muted-foreground">{person.hr_department}</div>}
            <div className="flex items-center gap-4 mt-2 flex-wrap">
              {person.start_date && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> {new Date(person.start_date).toLocaleDateString("en-GB", { month: "short", year: "numeric" })} · {tenure(person.start_date)}
                </span>
              )}
              {person.manager_name && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="w-3 h-3" /> Reports to {person.manager_name}
                </span>
              )}
              {person.salary_current && isAdmin && (
                <span className="text-xs font-medium">{fmtSalary(person.salary_current)}</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {person.email && <a href={`mailto:${person.email}`} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"><Mail className="w-3 h-3" />{person.email}</a>}
              {person.phone && <a href={`tel:${person.phone}`} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{person.phone}</a>}
              {person.linkedin_url && <a href={person.linkedin_url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"><Linkedin className="w-3 h-3" />LinkedIn</a>}
            </div>
          </div>
        </div>

        {person.bio && <p className="text-sm text-muted-foreground italic border-l-2 border-primary/20 pl-3">{person.bio}</p>}
        {person.education && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <GraduationCap className="w-4 h-4 shrink-0" /> {person.education}
          </div>
        )}

        {/* APC for grads */}
        {person.apc_status && person.apc_status !== "not_started" && (
          <div className="p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-2 mb-1">
              <ApcBadge status={person.apc_status} />
              {person.rics_pathway && <span className="text-xs text-muted-foreground">{person.rics_pathway}</span>}
            </div>
            {person.apc_assessment_date && (
              <div className="text-xs text-muted-foreground">Assessment: {new Date(person.apc_assessment_date).toLocaleDateString("en-GB")}</div>
            )}
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue={isAdmin ? "overview" : "holiday"} className="mt-2">
          <TabsList className="w-full overflow-x-auto flex-nowrap justify-start h-9">
            {isAdmin && <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>}
            {isAdmin && <TabsTrigger value="commission" className="text-xs">Commission</TabsTrigger>}
            <TabsTrigger value="holiday" className="text-xs">Holiday</TabsTrigger>
            <TabsTrigger value="documents" className="text-xs">Documents</TabsTrigger>
            {(isAdmin || isOwn) && cardholder && <TabsTrigger value="card" className="text-xs">My Card</TabsTrigger>}
          </TabsList>

          {isAdmin && (
            <TabsContent value="overview" className="mt-4">
              <div className="space-y-4">
                {/* Emergency contact */}
                {person.emergency_contact_name && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Heart className="w-4 h-4 text-red-500" />Emergency contact</CardTitle></CardHeader>
                    <CardContent className="text-sm space-y-1">
                      <div className="font-medium">{person.emergency_contact_name} {person.emergency_contact_relation && <span className="text-muted-foreground font-normal">({person.emergency_contact_relation})</span>}</div>
                      {person.emergency_contact_phone && <div className="text-muted-foreground">{person.emergency_contact_phone}</div>}
                    </CardContent>
                  </Card>
                )}
                {/* Pension */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Briefcase className="w-4 h-4 text-blue-500" />Benefits</CardTitle></CardHeader>
                  <CardContent className="text-sm space-y-2">
                    <div className="flex justify-between"><span className="text-muted-foreground">Pension</span><span>{person.pension_opt_in ? `Opted in · ${person.pension_rate ?? 5}% employee` : "Opted out"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Holiday entitlement</span><span>{person.holiday_entitlement ?? 25} days/year</span></div>
                  </CardContent>
                </Card>
                {/* Salary history */}
                <SalaryHistoryPanel person={person} />
                {/* Expenses summary */}
                {expenseSummary && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CreditCard className="w-4 h-4" />Expenses this month</CardTitle></CardHeader>
                    <CardContent className="text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Spent</span><span className="font-medium">£{(expenseSummary.spentPence / 100).toFixed(2)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Transactions</span><span>{expenseSummary.txCount}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Card limit utilisation</span><span>{expenseSummary.utilisation?.toFixed(0)}%</span></div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>
          )}

          {isAdmin && (
            <TabsContent value="commission" className="mt-4">
              <CommissionTab userId={person.id} />
            </TabsContent>
          )}

          <TabsContent value="holiday" className="mt-4">
            <HolidayTab person={person} isAdmin={isAdmin} currentUserId={currentUserId} />
          </TabsContent>

          <TabsContent value="documents" className="mt-4">
            <DocumentsTab person={person} isAdmin={isAdmin} />
          </TabsContent>

          {(isAdmin || isOwn) && cardholder && (
            <TabsContent value="card" className="mt-4">
              <CardTab cardholder={cardholder} isAdmin={isAdmin} person={person} />
            </TabsContent>
          )}
        </Tabs>
      </div>

      {isAdmin && (
        <EditProfileDialog
          person={person}
          allStaff={allStaff}
          open={editOpen}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}

// ── Card tab ──────────────────────────────────────────────────────────────────

function CardTab({ cardholder, isAdmin, person }: { cardholder: any; isAdmin: boolean; person: StaffMember }) {
  const [, navigate] = useLocation();
  const fmtLimit = (p: number) => `£${(p / 100).toFixed(0)}`;

  return (
    <div className="space-y-4 p-1">
      <div className="rounded-2xl bg-gradient-to-br from-neutral-800 to-neutral-900 dark:from-neutral-700 dark:to-neutral-800 p-6 text-white shadow-lg">
        <div className="flex items-center justify-between mb-6">
          <span className="text-xs uppercase tracking-widest opacity-70">BGP Card</span>
          <CreditCard className="w-5 h-5 opacity-70" />
        </div>
        <div className="text-lg font-mono tracking-widest mb-1">•••• •••• •••• ????</div>
        <div className="flex items-center justify-between mt-4">
          <div>
            <div className="text-xs opacity-60">CARDHOLDER</div>
            <div className="text-sm font-medium">{cardholder.userName}</div>
          </div>
          <Badge className={`${cardholder.status === "active" ? "bg-green-500" : "bg-red-500"} text-white border-0`}>
            {cardholder.status === "active" ? "Active" : "Frozen"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Monthly limit", value: fmtLimit(cardholder.monthlyLimit) },
          { label: "Daily limit", value: fmtLimit(cardholder.dailyLimit) },
          { label: "Per transaction", value: fmtLimit(cardholder.singleTxLimit) },
        ].map(({ label, value }) => (
          <Card key={label} className="p-3 text-center">
            <div className="text-base font-bold">{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </Card>
        ))}
      </div>

      <Button variant="outline" className="w-full" onClick={() => navigate(isAdmin ? "/expenses" : "/my-expenses")}>
        <ExternalLink className="w-4 h-4 mr-2" /> {isAdmin ? "Manage in Expenses Admin" : "View my expenses"}
      </Button>
    </div>
  );
}

// ── Policies panel ────────────────────────────────────────────────────────────

function PoliciesPanel() {
  const { data: policies = [] } = useQuery<Array<{ name: string; category: string; sharepointFolder: string }>>({
    queryKey: ["/api/hr/policies"],
  });

  const byCategory = useMemo(() => {
    const map: Record<string, typeof policies> = {};
    for (const p of policies) {
      (map[p.category] ??= []).push(p);
    }
    return map;
  }, [policies]);

  return (
    <div className="space-y-4">
      {Object.entries(byCategory).map(([cat, items]) => (
        <div key={cat}>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{cat}</div>
          <div className="space-y-1.5">
            {items.map(p => (
              <div key={p.name} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/40 transition-colors">
                <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm">{p.name}</span>
                <Badge variant="outline" className="ml-auto text-xs">{p.category}</Badge>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Holiday approvals overview (admin) ────────────────────────────────────────

function HolidayApprovals() {
  const { toast } = useToast();
  const { data: allRequests = [] } = useQuery<HolidayRequest[]>({ queryKey: ["/api/hr/holidays"] });
  const pending = allRequests.filter(r => r.status === "pending");

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const r = await apiRequest("PATCH", `/api/hr/holidays/${id}`, { status });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/holidays"] });
      toast({ title: "Updated" });
    },
  });

  if (pending.length === 0) return (
    <div className="text-center p-8 text-muted-foreground text-sm">
      <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
      No pending holiday requests
    </div>
  );

  return (
    <div className="space-y-2">
      {pending.map(req => (
        <div key={req.id} className="flex items-center gap-3 p-3 rounded-lg border">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">{req.user_name}</div>
            <div className="text-xs text-muted-foreground">{req.start_date} → {req.end_date} · {req.days_count} days</div>
            {req.notes && <div className="text-xs text-muted-foreground italic">{req.notes}</div>}
          </div>
          <div className="flex gap-1 shrink-0">
            <Button size="sm" variant="outline" className="h-8 px-3 text-green-600 border-green-300" onClick={() => updateMutation.mutate({ id: req.id, status: "approved" })}>
              <Check className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="outline" className="h-8 px-3 text-red-600 border-red-300" onClick={() => updateMutation.mutate({ id: req.id, status: "rejected" })}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HRPage() {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");

  const { data: currentUser } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  const isAdmin = !!currentUser?.isAdmin;

  const { data: allStaff = [], isLoading } = useQuery<StaffMember[]>({
    queryKey: ["/api/hr/staff"],
  });

  const selectedPerson = allStaff.find(s => s.id === selectedUserId) || null;

  // If non-admin, auto-select own profile
  const displayId = isAdmin ? selectedUserId : currentUser?.id || null;
  const displayPerson = allStaff.find(s => s.id === displayId) || null;

  const departments = useMemo(() => {
    const depts = new Set(allStaff.map(s => s.hr_department || s.team || "").filter(Boolean));
    return Array.from(depts).sort();
  }, [allStaff]);

  const filtered = useMemo(() => allStaff.filter(s => {
    const q = search.toLowerCase();
    const matchSearch = !q || s.name.toLowerCase().includes(q) || s.title?.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q);
    const matchDept = deptFilter === "all" || (s.hr_department || s.team || "") === deptFilter;
    return matchSearch && matchDept;
  }), [allStaff, search, deptFilter]);

  // Non-admin: show own profile directly
  if (!isAdmin) {
    if (isLoading || !currentUser) return <div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
    if (!displayPerson) return <div className="p-6 text-sm text-muted-foreground">Profile not found. Ask an admin to set up your HR profile.</div>;
    return (
      <div className="h-full overflow-hidden">
        <StaffProfile
          person={displayPerson}
          allStaff={allStaff}
          isAdmin={false}
          currentUserId={currentUser.id}
          onBack={() => {}}
        />
      </div>
    );
  }

  // Admin: show directory or profile
  if (selectedPerson) {
    return (
      <div className="h-full overflow-hidden">
        <StaffProfile
          person={selectedPerson}
          allStaff={allStaff}
          isAdmin={isAdmin}
          currentUserId={currentUser?.id || ""}
          onBack={() => setSelectedUserId(null)}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 border-b sticky top-0 bg-background z-10">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold">People & HR</h1>
          <Badge variant="secondary" className="ml-auto">{allStaff.length} staff</Badge>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input className="pl-8 h-8 text-sm" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="h-8 text-sm w-36">
              <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5 shrink-0" />
              <SelectValue placeholder="All depts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="team" className="px-4">
        <TabsList className="mt-3 mb-3">
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="holidays">
            Holiday approvals
          </TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
        </TabsList>

        <TabsContent value="team">
          {isLoading ? (
            <div className="flex items-center justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pb-6">
              {filtered.map(person => (
                <StaffCard key={person.id} person={person} onClick={() => setSelectedUserId(person.id)} />
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full text-center py-8 text-muted-foreground text-sm">No staff found</div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="holidays">
          <div className="pb-6"><HolidayApprovals /></div>
        </TabsContent>

        <TabsContent value="policies">
          <div className="pb-6"><PoliciesPanel /></div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
