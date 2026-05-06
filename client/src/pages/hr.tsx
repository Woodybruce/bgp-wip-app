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
  Network, Cake, UserPlus, Trash2, FolderLock, Folder,
  LayoutGrid, GitBranch, Camera, Eye,
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
import HrOverview from "./hr-overview";

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
  // Org-chart additions (May 2026)
  dob: string | null;
  address: string | null;
  wfh_days: string[] | null;
  employment_type: string | null;
  cv_sharepoint_url: string | null;
  board_member: boolean | null;
  management_team: boolean | null;
}

interface Birthday {
  id: string;
  name: string;
  title: string | null;
  team: string | null;
  profilePicUrl: string | null;
  date: string;
  daysUntil: number;
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
  wipByStage: { neg: number; exc: number; com: number };
  wipTotal: number;
  forecastPence: number;
  t1: number; t2: number; t3: number;
  commissionEarned: number;
  commissionForecast: number;
  billingsByYear: Array<{ year: string; pence: number }>;
  topDeals: Array<{ id: string; name: string; fee: number; status: string; date: string | null }>;
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

  // Headline target = 3× salary (the "real" stretch number people quote in
  // reviews). Billed = paid Xero invoices YTD; WIP = signed-but-unbilled
  // crm_deals share. Forecast bar is Billed + WIP layered on the same track.
  const target = data.t2;
  const pctBilled = Math.min((data.billedPence / target) * 100, 100);
  const pctForecast = Math.min((data.forecastPence / target) * 100, 100);
  const toTarget = Math.max(target - data.forecastPence, 0);
  const overTarget = data.forecastPence > target;
  const maxBar = Math.max(data.billingsByYear.map(b => b.pence).reduce((a, b) => Math.max(a, b), 0), 1);

  const stageLabel = (s: string) => ({ NEG: "In negotiation", SOL: "In solicitors", EXC: "Exchanged", COM: "Completed", INV: "Invoiced" }[s] || s);
  const stageColor = (s: string) => ({ NEG: "bg-amber-500", SOL: "bg-amber-500", EXC: "bg-blue-500", COM: "bg-emerald-500", INV: "bg-primary" }[s] || "bg-muted");

  return (
    <div className="space-y-4 p-1">
      {data.xeroError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-xs border border-amber-200 dark:border-amber-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Xero billings unavailable — figures may be incomplete. {data.xeroError}
        </div>
      )}

      {/* ── Hero: target progress with billed + WIP ──────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Commission tracker — {data.schemeYear}</span>
            <span className="text-xs font-normal text-muted-foreground">Salary {fmtSalary(data.salary)} · Scheme yr 1 May → 30 Apr</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Billed YTD</div>
              <div className="text-lg font-bold mt-0.5">{fmtSalary(data.billedPence)}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">WIP / pipeline</div>
              <div className="text-lg font-bold mt-0.5">{fmtSalary(data.wipTotal)}</div>
            </div>
            <div className="rounded-lg border p-3 bg-primary/5 border-primary/20">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Forecast</div>
              <div className="text-lg font-bold text-primary mt-0.5">{fmtSalary(data.forecastPence)}</div>
            </div>
          </div>

          {/* 3× target bar with billed (solid) + WIP (lighter) layered */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">Target ({fmtSalary(target)} · 3× salary)</span>
              {overTarget ? (
                <span className="text-green-600 font-medium flex items-center gap-1"><Check className="w-3 h-3" /> Beating target by {fmtSalary(data.forecastPence - target)}</span>
              ) : (
                <span className="text-muted-foreground">{fmtSalary(toTarget)} to go (incl. WIP)</span>
              )}
            </div>
            <div className="relative h-3 rounded-full bg-muted overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-primary/30 rounded-full transition-all" style={{ width: `${pctForecast}%` }} />
              <div className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all" style={{ width: `${pctBilled}%` }} />
            </div>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary inline-block" /> Billed</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary/30 inline-block" /> WIP</span>
            </div>
          </div>

          {/* WIP breakdown by stage */}
          {data.wipTotal > 0 && (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border p-2.5 text-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Negotiating</div>
                <div className="text-sm font-semibold mt-0.5">{fmtSalary(data.wipByStage.neg)}</div>
              </div>
              <div className="rounded-md border p-2.5 text-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Exchanged</div>
                <div className="text-sm font-semibold mt-0.5 text-blue-600">{fmtSalary(data.wipByStage.exc)}</div>
              </div>
              <div className="rounded-md border p-2.5 text-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Completed</div>
                <div className="text-sm font-semibold mt-0.5 text-emerald-600">{fmtSalary(data.wipByStage.com)}</div>
              </div>
            </div>
          )}

          {/* Tier breakdown — kept for context, secondary now */}
          <details className="rounded-md border bg-muted/20">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground p-2.5 select-none">Tier breakdown (2× / 3× / 4× salary)</summary>
            <div className="px-2.5 pb-2.5 space-y-2">
              {[
                { label: "Tier 1 (2× salary)", target: data.t1, rate: "30%" },
                { label: "Tier 2 (3× salary)", target: data.t2, rate: "40%" },
                { label: "Tier 3 (4× salary)", target: data.t3, rate: "50%" },
              ].map(({ label, target, rate }) => {
                const pct = fmtProgress(data.billedPence, target);
                return (
                  <div key={label} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{label} · {rate}</span>
                      <span>{fmtSalary(target)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${pct >= 100 ? "bg-green-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between text-xs pt-1.5 border-t">
                <span className="text-muted-foreground">Commission earned YTD</span>
                <span className="font-semibold">{fmtSalary(data.commissionEarned)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Forecast commission (billed + WIP)</span>
                <span className="font-semibold text-primary">{fmtSalary(data.commissionForecast)}</span>
              </div>
            </div>
          </details>
        </CardContent>
      </Card>

      {/* ── Top deals YTD ─────────────────────────────────────────────── */}
      {data.topDeals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top deals this scheme year</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {data.topDeals.map(d => (
                <div key={d.id} className="flex items-center gap-3 p-2 rounded-md border text-sm">
                  <span className={`w-1.5 h-6 rounded-full shrink-0 ${stageColor(d.status)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{d.name}</div>
                    <div className="text-[11px] text-muted-foreground">{stageLabel(d.status)}{d.date ? ` · ${d.date}` : ""}</div>
                  </div>
                  <span className="font-semibold text-sm shrink-0">{fmtSalary(d.fee)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Billings by year (history) ───────────────────────────────── */}
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
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${(y.pence / maxBar) * 100}%` }} />
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
    queryFn: () => apiRequest("GET", `/api/hr/holidays?userId=${person.id}`).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
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
    queryFn: () => apiRequest("GET", `/api/hr/documents?userId=${person.id}`).then(r => r.json()).then(d => Array.isArray(d) ? d : []),
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
    // Org chart additions (May 2026)
    dob: person.dob || "",
    address: person.address || "",
    wfhDays: (person.wfh_days || []).join(", "),
    employmentType: person.employment_type || "",
    cvSharepointUrl: person.cv_sharepoint_url || "",
    boardMember: person.board_member ?? false,
    managementTeam: person.management_team ?? false,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const wfhArr = form.wfhDays ? form.wfhDays.split(",").map(s => s.trim()).filter(Boolean) : [];
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
        // Org chart additions
        dob: form.dob || undefined,
        address: form.address || undefined,
        wfhDays: wfhArr.length ? wfhArr : undefined,
        employmentType: form.employmentType || undefined,
        cvSharepointUrl: form.cvSharepointUrl || undefined,
        boardMember: form.boardMember,
        managementTeam: form.managementTeam,
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
              <div className="space-y-1.5"><Label>CV URL (for presentations)</Label><Input value={form.cvSharepointUrl} onChange={f("cvSharepointUrl")} placeholder="https://brucegillinghampollard..." /></div>
            </div>
          </div>

          <div className="border-t pt-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Personal — visible to {person.name.split(" ")[0]} & Admin</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Date of birth</Label><Input type="date" value={form.dob} onChange={f("dob")} /></div>
              <div className="space-y-1.5">
                <Label>Employment type</Label>
                <Select value={form.employmentType} onValueChange={v => setForm(p => ({ ...p, employmentType: v }))}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{["FT", "PT", "Mat", "Contract", "Grad"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5 mt-3"><Label>Home address</Label><Textarea value={form.address} onChange={f("address")} placeholder="Street, city, postcode" rows={2} /></div>
            <div className="space-y-1.5 mt-3"><Label>WFH days</Label><Input value={form.wfhDays} onChange={f("wfhDays")} placeholder="Mon, Wed, Fri" /></div>
          </div>

          <div className="border-t pt-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Org chart flags</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 rounded-md border p-2.5">
                <input type="checkbox" id="board_member" checked={form.boardMember} onChange={e => setForm(p => ({ ...p, boardMember: e.target.checked }))} className="h-4 w-4" />
                <Label htmlFor="board_member" className="text-sm cursor-pointer">Board member</Label>
              </div>
              <div className="flex items-center gap-2 rounded-md border p-2.5">
                <input type="checkbox" id="management_team" checked={form.managementTeam} onChange={e => setForm(p => ({ ...p, managementTeam: e.target.checked }))} className="h-4 w-4" />
                <Label htmlFor="management_team" className="text-sm cursor-pointer">Management team</Label>
              </div>
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

// ── Active deals ("what I'm working on") ──────────────────────────────────────

interface ActiveDeal {
  id: string;
  name: string;
  status: string;
  dealType: string | null;
  fee: number;
  date: string | null;
}

function ActiveDealsCard({ userId }: { userId: string }) {
  const [, navigate] = useLocation();
  const { data: deals = [], isLoading } = useQuery<ActiveDeal[]>({
    queryKey: [`/api/hr/staff/${userId}/active-deals`],
  });
  if (isLoading || deals.length === 0) return null;

  const stageLabel = (s: string) => ({ NEG: "In negotiation", SOL: "In solicitors", EXC: "Exchanged", COM: "Completed", LIVE: "Live", SPEC: "Spec", AVA: "Available", REP: "Reported" }[s] || s);
  const stageColor = (s: string) => ({ NEG: "bg-amber-500", SOL: "bg-amber-500", EXC: "bg-blue-500", COM: "bg-emerald-500" }[s] || "bg-muted-foreground/30");
  const totalFee = deals.reduce((sum, d) => sum + d.fee, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> Working on right now</span>
          <span className="text-xs font-normal text-muted-foreground">{deals.length} active · {fmtSalary(totalFee)} share</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-1">
          {deals.slice(0, 8).map(d => (
            <button
              key={d.id}
              onClick={() => navigate(`/deals/${d.id}`)}
              className="w-full flex items-center gap-3 p-2 rounded-md border bg-card hover:bg-accent/40 transition-colors text-left"
              data-testid={`active-deal-${d.id}`}
            >
              <span className={`w-1.5 h-6 rounded-full shrink-0 ${stageColor(d.status)}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{d.name}</div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <span>{stageLabel(d.status)}</span>
                  {d.dealType && <><span>·</span><span>{d.dealType}</span></>}
                  {d.date && <><span>·</span><span>{d.date}</span></>}
                </div>
              </div>
              {d.fee > 0 && <span className="text-xs font-semibold shrink-0">{fmtSalary(d.fee)}</span>}
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            </button>
          ))}
          {deals.length > 8 && (
            <div className="text-xs text-muted-foreground text-center pt-1">+{deals.length - 8} more</div>
          )}
        </div>
      </CardContent>
    </Card>
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

  // Card from expenses system (admin-only endpoint)
  const { data: cardholder } = useQuery<any>({
    queryKey: ["/api/expenses/cardholders"],
    enabled: isAdmin,
    select: (data: any[]) => Array.isArray(data) ? data.find((c: any) => c.userId === person.id) : undefined,
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
        {isAdmin && (
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

        {/* What I'm working on — admin or self only */}
        {(isAdmin || isOwn) && <ActiveDealsCard userId={person.id} />}

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
        <Tabs defaultValue={isAdmin ? "overview" : isOwn ? "holiday" : "about"} className="mt-2">
          <TabsList className="w-full overflow-x-auto flex-nowrap justify-start h-9">
            {!isAdmin && !isOwn && <TabsTrigger value="about" className="text-xs">About</TabsTrigger>}
            {isAdmin && <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>}
            {isAdmin && <TabsTrigger value="commission" className="text-xs">Commission</TabsTrigger>}
            {(isAdmin || isOwn) && <TabsTrigger value="holiday" className="text-xs">Holiday</TabsTrigger>}
            {(isAdmin || isOwn) && <TabsTrigger value="documents" className="text-xs">Documents</TabsTrigger>}
            {(isAdmin || isOwn) && cardholder && <TabsTrigger value="card" className="text-xs">My Card</TabsTrigger>}
          </TabsList>

          {!isAdmin && !isOwn && (
            <TabsContent value="about" className="mt-4">
              <div className="space-y-3 text-sm">
                {person.team && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="w-4 h-4 shrink-0" /> {person.team}{person.hr_department && person.hr_department !== person.team ? ` · ${person.hr_department}` : ""}
                  </div>
                )}
                {person.start_date && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="w-4 h-4 shrink-0" /> Joined {new Date(person.start_date).toLocaleDateString("en-GB", { month: "short", year: "numeric" })} · {tenure(person.start_date)}
                  </div>
                )}
                {person.manager_name && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <User className="w-4 h-4 shrink-0" /> Reports to {person.manager_name}
                  </div>
                )}
                {person.education && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <GraduationCap className="w-4 h-4 shrink-0" /> {person.education}
                  </div>
                )}
              </div>
            </TabsContent>
          )}

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

interface PolicyDoc {
  id: string;
  name: string;
  category: string;
  fileName: string | null;
  mimeType: string | null;
  inlineUrl: string | null;
}

function PoliciesPanel({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast();
  const [open, setOpen] = useState<PolicyDoc | null>(null);
  const { data: policies = [], isLoading } = useQuery<PolicyDoc[]>({
    queryKey: ["/api/hr/policies"],
  });

  const refreshMutation = useMutation({
    mutationFn: async () => apiRequest("GET", "/api/hr/policies?refresh=1").then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/policies"] });
      toast({ title: "Policies re-synced from SharePoint" });
    },
    onError: (e: any) => toast({ title: "Refresh failed", description: e?.message, variant: "destructive" }),
  });

  const byCategory = useMemo(() => {
    const map: Record<string, PolicyDoc[]> = {};
    for (const p of policies) {
      (map[p.category] ??= []).push(p);
    }
    return map;
  }, [policies]);

  const isPdf = (p: PolicyDoc) => (p.mimeType || "").toLowerCase().includes("pdf") || (p.fileName || "").toLowerCase().endsWith(".pdf");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">Read in-app — no SharePoint detour</div>
        {isAdmin && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}>
            {refreshMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
            Re-sync from SharePoint
          </Button>
        )}
      </div>

      {isLoading && <div className="flex items-center justify-center p-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}

      {Object.entries(byCategory).map(([cat, items]) => (
        <div key={cat}>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{cat}</div>
          <div className="space-y-1.5">
            {items.map(p => (
              <button
                key={p.id}
                onClick={() => p.inlineUrl ? setOpen(p) : null}
                disabled={!p.inlineUrl}
                className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/40 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid={`policy-${p.id}`}
              >
                <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium flex-1">{p.name}</span>
                {p.fileName && <span className="text-[10px] text-muted-foreground truncate max-w-[180px]">{p.fileName}</span>}
                {p.inlineUrl ? <Eye className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <span className="text-[10px] italic text-muted-foreground">not synced</span>}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Inline reader */}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-4 border-b">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <BookOpen className="w-4 h-4 text-primary" />
              {open?.name}
              {open?.fileName && <span className="text-[10px] text-muted-foreground font-normal">{open.fileName}</span>}
              {open?.inlineUrl && (
                <a href={open.inlineUrl} target="_blank" rel="noreferrer" className="ml-auto text-xs text-primary flex items-center gap-1 hover:underline">
                  <ExternalLink className="w-3 h-3" /> Open in new tab
                </a>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 bg-muted/20 overflow-hidden">
            {open?.inlineUrl && (
              isPdf(open)
                ? <iframe src={open.inlineUrl} className="w-full h-full border-0" title={open.name} />
                : (
                  <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-3">
                    <FileText className="w-10 h-10 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground max-w-md">
                      This is a {open.fileName?.split(".").pop()?.toUpperCase()} document — click below to download or open.
                    </p>
                    <a href={open.inlineUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm">
                      <ExternalLink className="w-3.5 h-3.5" /> Open / download
                    </a>
                  </div>
                )
            )}
          </div>
        </DialogContent>
      </Dialog>
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

// ── Org chart visualisation ───────────────────────────────────────────────────

// Card colours mirror Layla's May 2026 organigram. Keyed off `users.team`.
const TEAM_STYLES: Record<string, { bg: string; border: string; text: string; pip: string }> = {
  "Office / Corporate": { bg: "bg-purple-50 dark:bg-purple-950/30", border: "border-purple-300 dark:border-purple-700", text: "text-purple-900 dark:text-purple-100", pip: "bg-purple-500" },
  "Investment":          { bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-300 dark:border-emerald-700", text: "text-emerald-900 dark:text-emerald-100", pip: "bg-emerald-500" },
  "Lease Advisory":      { bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-300 dark:border-amber-700", text: "text-amber-900 dark:text-amber-100", pip: "bg-amber-500" },
  "National Leasing":    { bg: "bg-orange-50 dark:bg-orange-950/30", border: "border-orange-300 dark:border-orange-700", text: "text-orange-900 dark:text-orange-100", pip: "bg-orange-500" },
  "Development":         { bg: "bg-pink-50 dark:bg-pink-950/30", border: "border-pink-300 dark:border-pink-700", text: "text-pink-900 dark:text-pink-100", pip: "bg-pink-500" },
  "Tenant Rep":          { bg: "bg-sky-50 dark:bg-sky-950/30", border: "border-sky-300 dark:border-sky-700", text: "text-sky-900 dark:text-sky-100", pip: "bg-sky-500" },
  "London Leasing":      { bg: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-300 dark:border-yellow-700", text: "text-yellow-900 dark:text-yellow-100", pip: "bg-yellow-500" },
};
const DEFAULT_TEAM_STYLE = { bg: "bg-muted", border: "border-border", text: "text-foreground", pip: "bg-gray-500" };
const TEAM_ORDER = ["Office / Corporate", "Investment", "Lease Advisory", "National Leasing", "Development", "Tenant Rep", "London Leasing"];

function styleForTeam(team: string | null | undefined) {
  if (!team) return DEFAULT_TEAM_STYLE;
  return TEAM_STYLES[team] || DEFAULT_TEAM_STYLE;
}

function OrgCard({ person, onClick, dim, highlight }: { person: StaffMember; onClick: () => void; dim?: boolean; highlight?: boolean }) {
  const style = styleForTeam(person.team);
  const initials = person.name.split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <button
      onClick={onClick}
      className={`relative w-44 rounded-lg border-2 ${style.bg} ${style.border} ${style.text} p-2 text-left shadow-sm hover:shadow-md hover:scale-[1.02] transition-all cursor-pointer ${dim ? "opacity-30" : ""} ${highlight ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
      data-testid={`org-card-${person.id}`}
    >
      <div className="flex items-start gap-2">
        <div className="w-9 h-9 shrink-0 rounded-full bg-white border flex items-center justify-center overflow-hidden">
          {person.profile_pic_url ? (
            <img src={person.profile_pic_url} alt={person.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs font-medium text-muted-foreground">{initials}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-tight truncate">{person.name}</p>
          <p className="text-[10px] opacity-75 leading-tight mt-0.5 line-clamp-2">{person.title || person.team || "—"}</p>
        </div>
      </div>
      {(person.board_member || person.management_team) && (
        <div className="absolute -top-1.5 -right-1.5 flex gap-0.5">
          {person.board_member && <span className="text-[8px] font-bold bg-black text-white px-1 py-0.5 rounded shadow">BOARD</span>}
          {person.management_team && !person.board_member && <span className="text-[8px] font-bold bg-slate-700 text-white px-1 py-0.5 rounded shadow">MGT</span>}
        </div>
      )}
    </button>
  );
}

function ChainNode({ person, childrenByManager, onSelect, matchedIds, hasFilter }: { person: StaffMember; childrenByManager: Map<string, StaffMember[]>; onSelect: (p: StaffMember) => void; matchedIds?: Set<string>; hasFilter?: boolean }) {
  const directs = childrenByManager.get(person.id) || [];
  const isMatch = matchedIds?.has(person.id) ?? true;
  return (
    <div className="flex flex-col items-center">
      <OrgCard person={person} onClick={() => onSelect(person)} dim={hasFilter && !isMatch} highlight={hasFilter && isMatch} />
      {directs.length > 0 && (
        <>
          <div className="w-px h-4 bg-border" />
          <div className="flex flex-col items-center gap-4">
            {directs.map(child => <ChainNode key={child.id} person={child} childrenByManager={childrenByManager} onSelect={onSelect} matchedIds={matchedIds} hasFilter={hasFilter} />)}
          </div>
        </>
      )}
    </div>
  );
}

function OrgChartTab({ allStaff, onSelectPerson, isAdmin, matchedIds, hasFilter }: { allStaff: StaffMember[]; onSelectPerson: (p: StaffMember) => void; isAdmin: boolean; matchedIds?: Set<string>; hasFilter?: boolean }) {
  const { toast } = useToast();
  // Real staff = those with a staff_profiles row. Excludes shared mailboxes
  // / placeholder accounts (e.g. "Accounts") that would otherwise win the
  // "no manager" race purely on alphabetical ordering.
  const realStaff = useMemo(() => allStaff.filter(s => s.profile_id), [allStaff]);
  const root = useMemo(() => {
    const md = realStaff.find(s => (s.title || "").toLowerCase().includes("managing director"));
    if (md) return md;
    const boardRoot = realStaff.find(s => s.board_member && !s.manager_id);
    if (boardRoot) return boardRoot;
    return realStaff.find(s => !s.manager_id) || null;
  }, [realStaff]);
  const childrenByManager = useMemo(() => {
    const map = new Map<string, StaffMember[]>();
    for (const s of realStaff) {
      if (!s.manager_id) continue;
      const list = map.get(s.manager_id) || [];
      list.push(s);
      map.set(s.manager_id, list);
    }
    return map;
  }, [realStaff]);

  const seedMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/hr/seed-org-chart");
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/staff"] });
      const skipMsg = data?.skipped > 0 ? ` ${data.skipped} not yet in users (add via "Add staff").` : "";
      toast({ title: `Seeded ${data?.updated ?? 0} from May 2026 chart.${skipMsg}` });
    },
    onError: (e: any) => toast({ title: "Seed failed", description: e?.message, variant: "destructive" }),
  });

  // Anyone whose manager is missing or who isn't reachable from the root
  // surfaces below as "Unassigned" so admins can fix the chain.
  const reachable = useMemo(() => {
    if (!root) return new Set<string>();
    const set = new Set<string>([root.id]);
    const queue = [root.id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const child of childrenByManager.get(id) || []) {
        if (!set.has(child.id)) { set.add(child.id); queue.push(child.id); }
      }
    }
    return set;
  }, [root, childrenByManager]);

  const unassigned = useMemo(() => realStaff.filter(s => !reachable.has(s.id)), [realStaff, reachable]);
  const noManagersSet = realStaff.length > 0 && realStaff.every(s => !s.manager_id);

  if (!root || noManagersSet) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <Network className="w-10 h-10 text-muted-foreground" />
        <h3 className="text-base font-semibold">No reporting lines set yet</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          {isAdmin
            ? "Seed the May 2026 BGP chart to wire reporting lines, BOARD and MGT flags. Idempotent — safe to re-run after edits."
            : "An admin needs to set up the org chart."}
        </p>
        {isAdmin && (
          <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} size="sm">
            <Network className="w-4 h-4 mr-2" />
            {seedMutation.isPending ? "Seeding…" : "Seed BGP org chart"}
          </Button>
        )}
      </div>
    );
  }

  // Group root's direct reports into team columns so e.g. Office / Corporate's
  // 5 PAs stack inside one column rather than spawning 5 sibling columns.
  const directs = childrenByManager.get(root.id) || [];
  const columnGroups = TEAM_ORDER
    .map(team => ({ team, members: directs.filter(p => p.team === team) }))
    .filter(g => g.members.length > 0);
  const otherDirects = directs.filter(p => !TEAM_ORDER.includes(p.team || ""));
  if (otherDirects.length > 0) columnGroups.push({ team: "Other", members: otherDirects });

  return (
    <div className="pb-8">
      <div className="flex items-center justify-end mb-3 gap-2">
        {isAdmin && (
          <Button variant="ghost" size="sm" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} className="h-7 text-xs text-muted-foreground">
            {seedMutation.isPending ? "Re-syncing…" : "Re-sync from May 2026 chart"}
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card p-6">
        <div className="flex flex-col items-center min-w-max">
          <OrgCard person={root} onClick={() => onSelectPerson(root)} dim={hasFilter && !(matchedIds?.has(root.id) ?? true)} highlight={hasFilter && (matchedIds?.has(root.id) ?? false)} />
          <div className="w-px h-6 bg-border" />
          <div className="flex items-start gap-6">
            {columnGroups.map(group => {
              const style = styleForTeam(group.team);
              return (
                <div key={group.team} className="flex flex-col items-center">
                  <div className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${style.bg} ${style.border} ${style.text} mb-2`}>
                    {group.team}
                  </div>
                  <div className="flex flex-col items-center gap-4">
                    {group.members.map(m => <ChainNode key={m.id} person={m} childrenByManager={childrenByManager} onSelect={onSelectPerson} matchedIds={matchedIds} hasFilter={hasFilter} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {unassigned.length > 0 && (
        <div className="mt-6 rounded-lg border bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Unassigned ({unassigned.length})</p>
          <p className="text-xs text-muted-foreground mb-3">Active staff with no manager link or whose manager is missing.</p>
          <div className="flex flex-wrap gap-3">
            {unassigned.map(p => <OrgCard key={p.id} person={p} onClick={() => onSelectPerson(p)} dim={hasFilter && !(matchedIds?.has(p.id) ?? true)} highlight={hasFilter && (matchedIds?.has(p.id) ?? false)} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Birthdays widget ──────────────────────────────────────────────────────────

function BirthdaysWidget() {
  const { data: birthdays = [] } = useQuery<Birthday[]>({ queryKey: ["/api/hr/birthdays"] });
  if (birthdays.length === 0) return null;
  return (
    <Card className="mb-3">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Cake className="w-4 h-4 text-pink-500" /> Upcoming birthdays
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {birthdays.slice(0, 6).map(b => {
            const initials = b.name.split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase();
            return (
              <div key={b.id} className="flex items-center gap-2 p-2 rounded-md border text-xs" data-testid={`birthday-${b.id}`}>
                <div className="w-7 h-7 rounded-full bg-muted overflow-hidden border flex items-center justify-center shrink-0">
                  {b.profilePicUrl ? <img src={b.profilePicUrl} alt={b.name} className="w-full h-full object-cover" /> : <span className="text-[10px]">{initials}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{b.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{b.title || b.team}</p>
                </div>
                <Badge variant={b.daysUntil === 0 ? "default" : "outline"} className="text-[10px] shrink-0">
                  {b.daysUntil === 0 ? "Today!" : b.daysUntil === 1 ? "Tomorrow" : `${b.daysUntil}d`}
                </Badge>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Add staff dialog (admin) ──────────────────────────────────────────────────

function AddStaffDialog({ allStaff, open, onClose }: { allStaff: StaffMember[]; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", email: "", title: "", role: "", team: "", managerId: "", employmentType: "" });

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/hr/staff", {
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        title: form.title.trim() || undefined,
        role: form.role.trim() || undefined,
        team: form.team || undefined,
        managerId: form.managerId || undefined,
        employmentType: form.employmentType || undefined,
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/staff"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/birthdays"] });
      toast({ title: `Added ${form.name}` });
      setForm({ name: "", email: "", title: "", role: "", team: "", managerId: "", employmentType: "" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Add failed", description: e?.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add staff member</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Full name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Smith" /></div>
          <div className="space-y-1.5"><Label>Work email</Label><Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@bgpcommercial.com" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>Job title</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Surveyor" /></div>
            <div className="space-y-1.5">
              <Label>Employment</Label>
              <Select value={form.employmentType} onValueChange={v => setForm(f => ({ ...f, employmentType: v }))}>
                <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  {["FT", "PT", "Mat", "Contract", "Grad"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Team</Label>
            <Select value={form.team} onValueChange={v => setForm(f => ({ ...f, team: v }))}>
              <SelectTrigger><SelectValue placeholder="Choose team" /></SelectTrigger>
              <SelectContent>{TEAM_ORDER.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Reports to</Label>
            <Select value={form.managerId || "none"} onValueChange={v => setForm(f => ({ ...f, managerId: v === "none" ? "" : v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None (top of chart) —</SelectItem>
                {allStaff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!form.name.trim() || createMutation.isPending}>
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HRPage() {
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"org" | "grid">("org");

  const syncPhotosMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/hr/sync-photos");
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/staff"] });
      const bits = [
        data.updated ? `${data.updated} updated` : null,
        data.skipped ? `${data.skipped} already had one` : null,
        data.missing ? `${data.missing} no photo in M365` : null,
      ].filter(Boolean).join(" · ");
      toast({ title: "Photo sync complete", description: bits || "Nothing to do" });
    },
    onError: (e: any) => toast({ title: "Photo sync failed", description: e?.message, variant: "destructive" }),
  });

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

  const hasFilter = search.trim().length > 0 || deptFilter !== "all";
  const matchedIds = useMemo(() => new Set(filtered.map(s => s.id)), [filtered]);

  // Drill-in to a single profile (admin or self viewing anyone, non-admin
  // viewing themselves). Non-admins clicking on a colleague see the same
  // directory profile but with sensitive fields already masked server-side.
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
          <Badge variant="secondary" className="ml-2">{allStaff.length} staff</Badge>
          {isAdmin && (
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8" onClick={() => syncPhotosMutation.mutate()} disabled={syncPhotosMutation.isPending} data-testid="button-sync-photos">
                {syncPhotosMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Camera className="w-3.5 h-3.5 mr-1.5" />}
                Sync photos
              </Button>
              <Button size="sm" className="h-8" onClick={() => setAddStaffOpen(true)} data-testid="button-add-staff">
                <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Add staff
              </Button>
            </div>
          )}
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

      <Tabs defaultValue="overview" className="px-4">
        <TabsList className="mt-3 mb-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
          {isAdmin && <TabsTrigger value="holidays">Holiday approvals</TabsTrigger>}
          <TabsTrigger value="policies">Policies</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <HrOverview />
        </TabsContent>

        <TabsContent value="people">
          <BirthdaysWidget />
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs text-muted-foreground">
              {hasFilter ? `${filtered.length} of ${allStaff.length} match` : `${allStaff.length} staff`}
            </div>
            <div className="inline-flex rounded-md border bg-muted/30 p-0.5" role="tablist" aria-label="View mode">
              <button
                onClick={() => setViewMode("org")}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${viewMode === "org" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="view-mode-org"
              >
                <GitBranch className="w-3.5 h-3.5" /> Org chart
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${viewMode === "grid" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="view-mode-grid"
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Grid
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : viewMode === "org" ? (
            <OrgChartTab allStaff={allStaff} onSelectPerson={(p) => setSelectedUserId(p.id)} isAdmin={isAdmin} matchedIds={matchedIds} hasFilter={hasFilter} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pb-6">
              {filtered.map(person => (
                <StaffCard key={person.id} person={person} onClick={() => setSelectedUserId(person.id)} />
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full text-center py-8 text-muted-foreground text-sm">No staff match the current filter</div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="holidays">
          <div className="pb-6"><HolidayApprovals /></div>
        </TabsContent>

        <TabsContent value="policies">
          <div className="pb-6"><PoliciesPanel isAdmin={isAdmin} /></div>
        </TabsContent>
      </Tabs>

      {isAdmin && <AddStaffDialog allStaff={allStaff} open={addStaffOpen} onClose={() => setAddStaffOpen(false)} />}
    </div>
  );
}
