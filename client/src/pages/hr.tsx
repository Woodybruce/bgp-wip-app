import { useState, useMemo, useRef, useEffect, lazy, Suspense } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";

const TasksPage = lazy(() => import("./tasks"));
import {
  Users, User, TrendingUp, Calendar, FileText, CreditCard,
  Building2, GraduationCap, Phone, Mail, MapPin, Linkedin,
  ChevronRight, ChevronDown, Plus, Pencil, Check, X,
  AlertCircle, Clock, CheckCircle2, BarChart3, ArrowLeft,
  Shield, Heart, Briefcase, Star, DollarSign, BookOpen,
  ExternalLink, Loader2, Search, SlidersHorizontal,
  Network, Cake, UserPlus, Trash2, FolderLock, Folder, Upload,
  LayoutGrid, GitBranch, Camera, Eye, Bike, Baby, PiggyBank, Smartphone,
  Train, HeartHandshake, Mountain, Award, Megaphone, Sparkles, Target,
  MessageSquare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
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
  personal_email?: string | null;
  wfh_days: string[] | null;
  employment_type: string | null;
  cv_sharepoint_url: string | null;
  board_member: boolean | null;
  management_team: boolean | null;
  rics_number?: string | null;
}

// Small label/value row for the read-only Personal tab. Hides itself when
// the value is empty so we don't show "Address —" lines for staff who
// haven't filled anything in.
function Row({ label, children, preserveWhitespace }: { label: string; children: React.ReactNode; preserveWhitespace?: boolean }) {
  if (children == null || children === "") return null;
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`text-right ${preserveWhitespace ? "whitespace-pre-wrap" : ""}`}>{children}</span>
    </div>
  );
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
  scenarios: Array<{ key: string; label: string; totalPence: number; commission: number; deltaCommission: number }>;
  awaitingPayment: Array<{ id: string; name: string; fee: number; status: string; date: string | null; invoicedAt: string | null }>;
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
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data, isLoading, error } = useQuery<CommissionData>({
    queryKey: [`/api/hr/staff/${userId}/commission`],
  });
  const { data: payslips = [] } = useQuery<UploadedFile[]>({
    queryKey: [`/api/hr/files/${userId}`, "payslip"],
    queryFn: () => apiRequest("GET", `/api/hr/files/${userId}?kind=payslip`).then(r => r.json()),
  });
  const syncXeroPayslips = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/hr/payslips/sync-from-xero").then(r => r.json()),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/files/${userId}`, "payslip"] });
      const msg = `Imported ${d.imported || 0}${d.skipped ? ` · skipped ${d.skipped}` : ""}${d.unmatched ? ` · ${d.unmatched} unmatched` : ""}`;
      toast({ title: "Xero payslip sync done", description: msg });
    },
    onError: (e: any) => toast({ title: "Xero sync failed", description: e?.message, variant: "destructive" }),
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

      {/* ── 'If you collect…' scenario calculator ───────────────────────── */}
      {data.scenarios && data.scenarios.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-500" /> If you collect…</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1.5">
            <div className="text-[11px] text-muted-foreground italic mb-1">
              Commission only pays when BGP gets paid. Stages are cumulative — each row is the extra you'd earn if that bucket converts.
            </div>
            {data.scenarios.map((s, i) => (
              <div key={s.key} className={`flex items-center gap-3 p-2 rounded-md border ${i === 0 ? "bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900" : "bg-card"}`}>
                <div className={`w-1.5 h-8 rounded-full shrink-0 ${i === 0 ? "bg-emerald-500" : i === 1 ? "bg-blue-500" : i === 2 ? "bg-amber-500" : "bg-muted-foreground/40"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="text-[11px] text-muted-foreground">Total billed: {fmtSalary(s.totalPence)}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold tabular-nums">{fmtSalary(s.commission)}</div>
                  {i > 0 && s.deltaCommission > 0 && (
                    <div className="text-[10px] text-emerald-600 tabular-nums">+ {fmtSalary(s.deltaCommission)} extra</div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Awaiting payment — admin chase list ─────────────────────────── */}
      {data.awaitingPayment && data.awaitingPayment.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><Clock className="w-4 h-4 text-amber-600" /> Awaiting payment</span>
              <span className="text-[11px] font-normal text-muted-foreground">{data.awaitingPayment.length} deal{data.awaitingPayment.length === 1 ? "" : "s"} · {fmtSalary(data.awaitingPayment.reduce((s, d) => s + d.fee, 0))} unlocks commission</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-[10px] text-muted-foreground italic mb-2">
              Completed or invoiced but Xero hasn't seen the payment yet. Commission flips from "expected" to "earned" when paid.
            </div>
            <div className="space-y-1">
              {data.awaitingPayment.slice(0, 10).map(d => (
                <button key={d.id} onClick={() => navigate(`/deals/${d.id}`)} className="w-full flex items-center gap-3 p-2 rounded-md border bg-card hover:bg-accent/40 transition-colors text-left">
                  <Badge variant="outline" className={`text-[10px] shrink-0 ${d.status === "INV" ? "border-blue-300 text-blue-700" : "border-emerald-300 text-emerald-700"}`}>
                    {d.status === "INV" ? "Invoiced" : "Completed"}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{d.name}</div>
                    <div className="text-[10px] text-muted-foreground">{d.invoicedAt ? `Invoiced ${d.invoicedAt}` : d.date ? `Completed ${d.date}` : ""}</div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0">{fmtSalary(d.fee)}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Payslips — uploaded by admin via the Files tab ─────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><FileText className="w-4 h-4 text-muted-foreground" /> Payslips</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" className="h-6 text-[11px] px-1.5" onClick={() => syncXeroPayslips.mutate()} disabled={syncXeroPayslips.isPending}>
                {syncXeroPayslips.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
                Sync Xero
              </Button>
              <button onClick={() => {
                const u = new URLSearchParams(window.location.search);
                u.set("person", userId);
                u.set("tab", "files");
                window.history.replaceState(null, "", `${window.location.pathname}?${u.toString()}`);
                window.dispatchEvent(new PopStateEvent("popstate"));
              }} className="text-[11px] text-primary hover:underline">Upload &rarr;</button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {payslips.length === 0 ? (
            <div className="text-xs text-muted-foreground italic py-2">
              No payslips uploaded yet. Admin can upload via the Files tab with kind = "payslip".
            </div>
          ) : (
            <div className="space-y-1">
              {payslips.slice(0, 12).map(p => (
                <a key={p.id} href={`/api/hr/files/${p.id}/file`} download={p.name} className="flex items-center gap-2 p-2 rounded-md border hover:bg-accent/40 transition-colors text-xs">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-[10px] text-muted-foreground">{new Date(p.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </a>
              ))}
            </div>
          )}
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

// ── 👶 Parental leave card ────────────────────────────────────────────────

interface ParentalLeave {
  id: string;
  user_id: string;
  kind: string;
  start_date: string;
  planned_end_date: string | null;
  actual_return_date: string | null;
  kit_days_used: number;
  kit_days_allowance: number;
  status: string;
  notes: string | null;
}

const PARENTAL_KINDS: Record<string, { label: string; emoji: string; defaultMonths: number }> = {
  maternity: { label: "Maternity", emoji: "👶", defaultMonths: 12 },
  paternity: { label: "Paternity", emoji: "👨‍👶", defaultMonths: 0.5 },
  shared:    { label: "Shared parental", emoji: "👪", defaultMonths: 12 },
  adoption:  { label: "Adoption", emoji: "🧡", defaultMonths: 12 },
};

function ParentalLeaveCard({ person, isAdmin, isOwn }: { person: StaffMember; isAdmin: boolean; isOwn: boolean }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ kind: "maternity", startDate: "", plannedEndDate: "", kitDaysAllowance: 10, notes: "" });

  const { data: entries = [] } = useQuery<ParentalLeave[]>({
    queryKey: [`/api/hr/parental-leave/${person.id}`],
    enabled: isAdmin || isOwn,
  });

  const create = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/hr/parental-leave", { ...form, userId: person.id }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/parental-leave/${person.id}`] });
      setAdding(false);
      setForm({ kind: "maternity", startDate: "", plannedEndDate: "", kitDaysAllowance: 10, notes: "" });
      toast({ title: "Parental leave logged" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: any }) => apiRequest("PATCH", `/api/hr/parental-leave/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/hr/parental-leave/${person.id}`] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/hr/parental-leave/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/hr/parental-leave/${person.id}`] }),
  });

  if (!isAdmin && !isOwn) return null;

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const statusOf = (e: ParentalLeave): string => {
    if (e.status && e.status !== "planned") return e.status;
    const start = new Date(e.start_date);
    const end = e.actual_return_date ? new Date(e.actual_return_date) : (e.planned_end_date ? new Date(e.planned_end_date) : null);
    if (today < start) return "planned";
    if (end && today >= end) return "returned";
    return "on_leave";
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">👶 Parental leave</span>
          {isAdmin && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(true)}>
              <Plus className="w-3 h-3 mr-1" /> Add
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {entries.length === 0 ? (
          <div className="text-xs text-muted-foreground italic py-2">
            No parental leave on file. {isAdmin ? "Use Add to log a planned mat / pat / shared / adoption leave." : ""}
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map(e => {
              const meta = PARENTAL_KINDS[e.kind] || PARENTAL_KINDS.maternity;
              const status = statusOf(e);
              const start = new Date(e.start_date);
              const plannedEnd = e.planned_end_date ? new Date(e.planned_end_date) : null;
              const daysToStart = Math.round((start.getTime() - today.getTime()) / 86400000);
              const daysToEnd = plannedEnd ? Math.round((plannedEnd.getTime() - today.getTime()) / 86400000) : null;
              return (
                <div key={e.id} className="rounded-md border bg-card p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{meta.emoji}</span>
                    <span className="text-sm font-semibold flex-1">{meta.label} leave</span>
                    <Badge variant="outline" className={`text-[10px] capitalize ${status === "on_leave" ? "border-orange-300 text-orange-700" : status === "returned" ? "border-emerald-300 text-emerald-700" : ""}`}>
                      {status === "on_leave" ? "On leave" : status === "returned" ? "Returned" : status === "planned" ? "Planned" : status.replace("_", " ")}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {start.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                    {plannedEnd && (
                      <> → planned return {plannedEnd.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</>
                    )}
                    {e.actual_return_date && (
                      <> · actual return {new Date(e.actual_return_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {status === "planned" && daysToStart >= 0 && `${daysToStart} day${daysToStart === 1 ? "" : "s"} until start`}
                    {status === "on_leave" && daysToEnd != null && daysToEnd > 0 && `${daysToEnd} day${daysToEnd === 1 ? "" : "s"} until planned return`}
                    {status === "on_leave" && daysToEnd != null && daysToEnd <= 0 && "Return overdue"}
                  </div>

                  {/* KIT days bar */}
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-muted-foreground w-16 shrink-0">KIT days</span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min((e.kit_days_used / Math.max(e.kit_days_allowance, 1)) * 100, 100)}%` }} />
                    </div>
                    <span className="tabular-nums">{e.kit_days_used} / {e.kit_days_allowance}</span>
                    {(isAdmin || isOwn) && (
                      <div className="flex gap-0.5">
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0" disabled={e.kit_days_used >= e.kit_days_allowance} onClick={() => update.mutate({ id: e.id, body: { kitDaysUsed: e.kit_days_used + 1 } })}>+</Button>
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0" disabled={e.kit_days_used <= 0} onClick={() => update.mutate({ id: e.id, body: { kitDaysUsed: e.kit_days_used - 1 } })}>−</Button>
                      </div>
                    )}
                  </div>

                  {e.notes && <div className="text-[11px] text-muted-foreground italic">{e.notes}</div>}

                  {isAdmin && status !== "returned" && (
                    <div className="flex gap-1 pt-1">
                      {status !== "on_leave" && (
                        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => update.mutate({ id: e.id, body: { status: "on_leave" } })}>
                          Mark on leave
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => {
                        const d = prompt("Actual return date (YYYY-MM-DD)?", new Date().toISOString().slice(0, 10));
                        if (d) update.mutate({ id: e.id, body: { actualReturnDate: d, status: "returned" } });
                      }}>
                        Mark returned
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-red-500 ml-auto" onClick={() => { if (confirm("Delete this leave record?")) remove.mutate(e.id); }}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogContent>
            <DialogHeader><DialogTitle>Log parental leave</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.kind} onValueChange={v => setForm(f => ({ ...f, kind: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PARENTAL_KINDS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.emoji} {v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Start date</Label>
                  <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Planned return</Label>
                  <Input type="date" value={form.plannedEndDate} onChange={e => setForm(f => ({ ...f, plannedEndDate: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>KIT days allowance</Label>
                <Input type="number" value={form.kitDaysAllowance} onChange={e => setForm(f => ({ ...f, kitDaysAllowance: parseInt(e.target.value) || 10 }))} />
                <div className="text-[10px] text-muted-foreground">Statutory: up to 10 paid Keeping In Touch days while on mat leave.</div>
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. covering arrangements, salary continuation" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
              <Button onClick={() => create.mutate()} disabled={!form.startDate || create.isPending}>
                {create.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Log leave
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

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

      <ParentalLeaveCard person={person} isAdmin={isAdmin} isOwn={isOwn} />
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

// ── Salary timeline chart ──────────────────────────────────────────────────────
//
// Stepped line of salary over time with bonus + commission markers extracted
// from each row's `notes` (the spreadsheet importer stuffs them in there as
// "commission rate: 10% · tier: T2"). Yearly Xero billings come in via the
// commission endpoint and are layered on as context bars.

interface BonusEntry { id: string; amount_pence: number; effective_date: string; kind: string; reason: string | null; notes: string | null; }

function SalaryTimelineChart({ person, history }: { person: StaffMember; history: SalaryEntry[] }) {
  const { data: commissionData } = useQuery<{ billingsByYear?: Array<{ year: string; pence: number }> }>({
    queryKey: [`/api/hr/staff/${person.id}/commission`],
    retry: false,
  });
  const { data: bonuses = [] } = useQuery<BonusEntry[]>({
    queryKey: [`/api/hr/staff/${person.id}/bonuses`],
  });

  // Three sources merged on date: salary uplifts (step line), bonuses
  // (orange bars from bonus_history) and yearly Xero billings (cyan context
  // bars pinned to Jan-1). Each date slot accumulates a tooltip blurb.
  const points = useMemo(() => {
    const byDate = new Map<string, { salary?: number; bonus?: number; billings?: number; tooltip: string[] }>();
    const ensure = (d: string) => {
      if (!byDate.has(d)) byDate.set(d, { tooltip: [] });
      return byDate.get(d)!;
    };

    for (const h of history) {
      if (!h.effective_date) continue;
      const slot = ensure(h.effective_date);
      slot.salary = h.salary_pence / 100;
      slot.tooltip.push(`Salary £${(h.salary_pence / 100).toLocaleString()} (${h.reason?.replace(/_/g, " ") || "salary"})`);
    }
    for (const b of bonuses) {
      if (!b.effective_date) continue;
      const slot = ensure(b.effective_date);
      slot.bonus = (slot.bonus || 0) + b.amount_pence / 100;
      const k = b.kind === "bonus" ? "Bonus" : b.kind.replace(/_/g, " ");
      slot.tooltip.push(`${k} £${(b.amount_pence / 100).toLocaleString()}${b.reason ? ` (${b.reason})` : ""}`);
    }
    for (const cb of commissionData?.billingsByYear || []) {
      if (!cb.year) continue;
      const slot = ensure(`${cb.year}-01-01`);
      slot.billings = cb.pence / 100;
      slot.tooltip.push(`Billings ${cb.year}: £${Math.round(cb.pence / 100).toLocaleString()}`);
    }
    const rows: Array<{ date: string; salary?: number; bonus?: number; billings?: number; tooltip: string }> = [];
    for (const [date, v] of Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      rows.push({ date, salary: v.salary, bonus: v.bonus, billings: v.billings, tooltip: v.tooltip.join("\n") });
    }
    // Forward-fill salary so the step line continues across bonus-only points.
    let lastSalary: number | undefined;
    for (const r of rows) {
      if (r.salary != null) lastSalary = r.salary;
      else if (lastSalary != null) r.salary = lastSalary;
    }
    return rows;
  }, [history, bonuses, commissionData]);

  if (points.length === 0) return null;

  return (
    <div className="rounded-lg border p-3 bg-card">
      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Pay timeline</div>
      <p className="text-[10px] text-muted-foreground mb-2">Stepped line = base salary changes. Orange bars = bonuses. Faint cyan bars = annual Xero billings (if commission tier applies).</p>
      <div className="h-56 w-full">
        <ResponsiveContainer>
          <ComposedChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => String(d).slice(0, 7)} />
            <YAxis tickFormatter={(v) => v >= 1000 ? `£${(v/1000).toFixed(0)}k` : `£${v}`} tick={{ fontSize: 10 }} />
            <Tooltip
              formatter={(v: any, name: string) => v == null ? null : [`£${Number(v).toLocaleString()}`, name]}
              labelFormatter={(d: any) => `Effective ${d}`}
              contentStyle={{ fontSize: 11, borderRadius: 6 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="billings" name="Annual billings" fill="#06b6d4" fillOpacity={0.25} />
            <Bar dataKey="bonus" name="Bonus" fill="#f97316" fillOpacity={0.85} />
            <Line type="stepAfter" dataKey="salary" name="Salary" stroke="#10b981" strokeWidth={2} dot={{ r: 4, fill: "#10b981" }} activeDot={{ r: 6 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Bonus history panel ────────────────────────────────────────────────────────
// Sits between the timeline chart and the salary list. Admins can record
// one-off bonuses (annual, retention, spot, etc.) — they show up as orange
// bars on the chart above and as a list here.

function BonusHistoryPanel({ person }: { person: StaffMember }) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ amount: "", effectiveDate: "", kind: "bonus", reason: "" });

  const { data: bonuses = [] } = useQuery<BonusEntry[]>({
    queryKey: [`/api/hr/staff/${person.id}/bonuses`],
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/hr/staff/${person.id}/bonuses`, {
        amountPence: Math.round(parseFloat(form.amount) * 100),
        effectiveDate: form.effectiveDate,
        kind: form.kind,
        reason: form.reason || undefined,
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/staff/${person.id}/bonuses`] });
      setShowAdd(false);
      setForm({ amount: "", effectiveDate: "", kind: "bonus", reason: "" });
      toast({ title: "Bonus recorded" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/hr/staff/${person.id}/bonuses/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/hr/staff/${person.id}/bonuses`] }),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Bonuses & one-offs</div>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAdd(true)} data-testid="record-bonus">
          <Plus className="w-3 h-3 mr-1" /> Record bonus
        </Button>
      </div>
      {bonuses.length === 0 ? (
        <div className="text-[11px] text-muted-foreground italic">No bonuses recorded yet.</div>
      ) : (
        <div className="space-y-1">
          {bonuses.map((b) => (
            <div key={b.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs">
              <span className="font-medium tabular-nums">£{(b.amount_pence / 100).toLocaleString()}</span>
              <Badge variant="outline" className="text-[9px] py-0 capitalize">{b.kind.replace(/_/g, " ")}</Badge>
              <span className="text-muted-foreground">{b.effective_date}</span>
              {b.reason && <span className="text-muted-foreground italic truncate">{b.reason}</span>}
              <div className="ml-auto">
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-muted-foreground hover:text-destructive" onClick={() => deleteMutation.mutate(b.id)}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record bonus</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount (£)</Label>
                <Input type="number" placeholder="5000" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Effective date</Label>
                <Input type="date" value={form.effectiveDate} onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bonus">Annual bonus</SelectItem>
                  <SelectItem value="commission_payout">Commission payout</SelectItem>
                  <SelectItem value="spot">Spot bonus</SelectItem>
                  <SelectItem value="retention">Retention</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reason / note (optional)</Label>
              <Input placeholder="2025 annual review" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate()} disabled={!form.amount || !form.effectiveDate || addMutation.isPending}>
              {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Save
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
      <SalaryTimelineChart person={person} history={history} />

      <BonusHistoryPanel person={person} />

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
    ricsNumber: (person as any).rics_number || "",
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
        ricsNumber: form.ricsNumber || undefined,
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
              <div className="space-y-1.5"><Label>RICS member number</Label><Input value={form.ricsNumber} onChange={f("ricsNumber")} placeholder="e.g. 1234567" /></div>
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

function StaffProfile({ person, allStaff, isAdmin, currentUserId, onBack, initialTab }: {
  person: StaffMember;
  allStaff: StaffMember[];
  isAdmin: boolean;
  currentUserId: string;
  onBack: () => void;
  initialTab?: string;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const isOwn = person.id === currentUserId;
  // Office / Corporate staff (PAs, bookkeeper, consultant) aren't on the
  // commission scheme and aren't RICS surveyors, so we hide those tabs/cards
  // for them. Once a surveyor qualifies (APC completed), we still show their
  // RICS member number but drop the in-progress APC fields.
  const isOfficeStaff = (person.team || "").toLowerCase().includes("office") || (person.team || "").toLowerCase().includes("corporate");
  const isQualifiedSurveyor = person.apc_status === "completed";
  const showRicsCard = !isOfficeStaff && (person.rics_number || person.rics_pathway || (person.apc_status && person.apc_status !== "not_started"));

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
        <Tabs defaultValue={(() => {
            // Map legacy tab names from old links / bookmarks to where they
            // live now after the May 2026 consolidation.
            const t = initialTab;
            if (!t) return (isAdmin || isOwn) ? "personal" : "about";
            if (t === "overview") return "personal";
            if (["holiday", "pension", "kit", "files"].includes(t)) return "mystuff";
            return t;
          })()} className="mt-2">
          <TabsList className="w-full overflow-x-auto flex-nowrap justify-start h-9">
            {!isAdmin && !isOwn && <TabsTrigger value="about" className="text-xs">About</TabsTrigger>}
            {(isAdmin || isOwn) && <TabsTrigger value="personal" className="text-xs">Personal</TabsTrigger>}
            {isAdmin && !isOfficeStaff && <TabsTrigger value="commission" className="text-xs">Commission</TabsTrigger>}
            {(isAdmin || isOwn) && <TabsTrigger value="mystuff" className="text-xs">My stuff</TabsTrigger>}
            {(isAdmin || isOwn) && <TabsTrigger value="reviews" className="text-xs">Reviews</TabsTrigger>}
            {(isAdmin || isOwn) && <TabsTrigger value="career" className="text-xs">Career</TabsTrigger>}
            {(isAdmin || isOwn) && <TabsTrigger value="expenses" className="text-xs">Card &amp; Expenses</TabsTrigger>}
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

          {(isAdmin || isOwn) && (
            <TabsContent value="personal" className="mt-4">
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <User className="w-4 h-4 text-violet-500" />
                      Personal details
                      <Badge variant="outline" className="text-[9px] py-0 ml-auto">
                        {isOwn ? "Visible to you & Admins" : "Visible to this person & Admins"}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1.5">
                    <Row label="Date of birth">{person.dob ? new Date(person.dob).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null}</Row>
                    <Row label="Address" preserveWhitespace>{person.address}</Row>
                    <Row label="Employment">{person.employment_type}</Row>
                    <Row label="WFH days">{person.wfh_days?.length ? person.wfh_days.join(", ") : null}</Row>
                    <Row label="Personal email">{person.personal_email}</Row>
                  </CardContent>
                </Card>

                {showRicsCard && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><GraduationCap className="w-4 h-4 text-blue-500" />RICS &amp; qualifications</CardTitle></CardHeader>
                    <CardContent className="text-sm space-y-1.5">
                      <Row label="RICS member number">{person.rics_number}</Row>
                      {/* APC fields are only shown while the surveyor is still
                          on the pathway. Once they've qualified the member
                          number is the only ongoing-relevant detail. */}
                      {!isQualifiedSurveyor && <Row label="Pathway">{person.rics_pathway}</Row>}
                      {!isQualifiedSurveyor && <Row label="APC status">{person.apc_status?.replace(/_/g, " ")}</Row>}
                      {!isQualifiedSurveyor && person.apc_assessment_date && <Row label="Assessment date">{new Date(person.apc_assessment_date).toLocaleDateString("en-GB")}</Row>}
                      <Row label="Education">{person.education}</Row>
                    </CardContent>
                  </Card>
                )}

                {person.emergency_contact_name && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Heart className="w-4 h-4 text-red-500" />Emergency contact</CardTitle></CardHeader>
                    <CardContent className="text-sm space-y-1">
                      <div className="font-medium">{person.emergency_contact_name} {person.emergency_contact_relation && <span className="text-muted-foreground font-normal">({person.emergency_contact_relation})</span>}</div>
                      {person.emergency_contact_phone && <div className="text-muted-foreground">{person.emergency_contact_phone}</div>}
                    </CardContent>
                  </Card>
                )}

                {isAdmin && (
                  <SalaryHistoryPanel person={person} />
                )}

                {isAdmin && expenseSummary && (
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

          {isAdmin && !isOfficeStaff && (
            <TabsContent value="commission" className="mt-4">
              <CommissionTab userId={person.id} />
            </TabsContent>
          )}

          {/* "My stuff" — pension, holiday, kit, files all in one place. */}
          {(isAdmin || isOwn) && (
            <TabsContent value="mystuff" className="mt-4 space-y-6">
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Holiday</h3>
                <HolidayTab person={person} isAdmin={isAdmin} currentUserId={currentUserId} />
              </section>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> Pension</h3>
                <PensionTab userId={person.id} isAdmin={isAdmin} isOwn={isOwn} />
              </section>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Files</h3>
                <FilesTab userId={person.id} isAdmin={isAdmin} isOwn={isOwn} />
              </section>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> Kit</h3>
                <KitCard person={person} isAdmin={isAdmin} isOwn={isOwn} />
              </section>
            </TabsContent>
          )}

          <TabsContent value="reviews" className="mt-4">
            <ReviewsTab userId={person.id} isAdmin={isAdmin} isOwn={isOwn} person={person} />
          </TabsContent>

          <TabsContent value="career" className="mt-4">
            <CareerRoadmapTab userId={person.id} isAdmin={isAdmin} isOwn={isOwn} currentTitle={person.title} />
          </TabsContent>

          <TabsContent value="expenses" className="mt-4 space-y-4">
            {cardholder && <CardTab cardholder={cardholder} isAdmin={isAdmin} person={person} />}
            <ExpensesAnalysisCard userId={person.id} isAdmin={isAdmin} isOwn={isOwn} />
          </TabsContent>
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

// ── 🎓 Promotion pitches (under the Career tab) ───────────────────────────

interface PromotionPitch {
  id: string;
  user_id: string;
  from_level: string | null;
  to_level: string | null;
  pitch_date: string | null;
  status: string;
  narrative: string | null;
  key_wins: string | null;
  financials: string | null;
  development: string | null;
  ask: string | null;
  ai_draft: string | null;
  decision: string | null;
  decision_notes: string | null;
  decided_at: string | null;
}

function PromotionPitchesPanel({ userId, isAdmin, isOwn, currentTitle, levels }: { userId: string; isAdmin: boolean; isOwn: boolean; currentTitle: string | null; levels: string[] }) {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingTo, setCreatingTo] = useState<string>("");
  const { data: pitches = [] } = useQuery<PromotionPitch[]>({ queryKey: [`/api/hr/promotion-pitches/${userId}`] });

  const create = useMutation({
    mutationFn: async () => {
      const fromLevel = currentTitle ? (levels.find(l => currentTitle.toLowerCase().includes(l.toLowerCase())) || null) : null;
      return apiRequest("POST", "/api/hr/promotion-pitches", { userId, fromLevel, toLevel: creatingTo, pitchDate: new Date().toISOString().slice(0, 10) }).then(r => r.json());
    },
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/promotion-pitches/${userId}`] });
      setCreatingTo("");
      setEditingId(d.id);
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: any }) => apiRequest("PATCH", `/api/hr/promotion-pitches/${id}`, body).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/hr/promotion-pitches/${userId}`] }),
  });

  const aiDraft = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/hr/promotion-pitches/${id}/ai-draft`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/promotion-pitches/${userId}`] });
      toast({ title: "AI draft generated — review the text above" });
    },
    onError: (e: any) => toast({ title: "AI draft failed", description: e?.message, variant: "destructive" }),
  });

  if (!isAdmin && !isOwn) return null;
  const editing = pitches.find(p => p.id === editingId);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Award className="w-4 h-4 text-violet-600" /> Promotion pitches</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex items-center gap-2">
          <Select value={creatingTo} onValueChange={setCreatingTo}>
            <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Pitch for promotion to…" /></SelectTrigger>
            <SelectContent>{levels.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" disabled={!creatingTo || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
            Start
          </Button>
        </div>

        {pitches.length === 0 ? (
          <div className="text-xs text-muted-foreground italic py-2">No pitches yet — when you're ready to make your case, draft one above. AI will pull your deals + reviews into a starter narrative.</div>
        ) : (
          <div className="space-y-1.5">
            {pitches.map(p => (
              <button
                key={p.id}
                onClick={() => setEditingId(editingId === p.id ? null : p.id)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-md border text-left transition-colors hover:bg-accent/40 ${editingId === p.id ? "border-primary bg-primary/5" : ""}`}
              >
                <Award className="w-4 h-4 text-violet-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{p.from_level || "?"} → {p.to_level}</div>
                  <div className="text-[11px] text-muted-foreground">{p.pitch_date ? new Date(p.pitch_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Undated"}</div>
                </div>
                <Badge variant={p.decision === "approved" ? "default" : p.decision === "deferred" ? "secondary" : "outline"} className="text-[10px] capitalize">
                  {p.decision || p.status}
                </Badge>
              </button>
            ))}
          </div>
        )}

        {editing && (
          <div className="rounded-lg border bg-muted/10 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold">{editing.from_level || "?"} → {editing.to_level}</div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => aiDraft.mutate(editing.id)} disabled={aiDraft.isPending}>
                  {aiDraft.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />} AI draft
                </Button>
                {editing.status === "draft" && isOwn && (
                  <Button size="sm" className="h-7 text-xs" onClick={() => update.mutate({ id: editing.id, body: { status: "submitted" } })}>Submit</Button>
                )}
              </div>
            </div>
            {editing.ai_draft && (
              <div className="rounded-md border bg-violet-50 dark:bg-violet-950/20 p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-violet-700 dark:text-violet-300 mb-1 flex items-center gap-1"><Sparkles className="w-3 h-3" /> AI starter</div>
                <pre className="text-xs whitespace-pre-wrap font-sans text-muted-foreground">{editing.ai_draft}</pre>
              </div>
            )}
            {[
              { key: "narrative", label: "Narrative" },
              { key: "key_wins", label: "Key wins" },
              { key: "financials", label: "Financials" },
              { key: "development", label: "Development plan" },
              { key: "ask", label: "Ask (salary / title / scope)" },
            ].map(f => (
              <div key={f.key} className="space-y-1.5">
                <Label className="text-xs">{f.label}</Label>
                <Textarea rows={3} defaultValue={(editing as any)[f.key] || ""} onBlur={e => update.mutate({ id: editing.id, body: { [f.key]: e.target.value } })} className="text-sm" />
              </div>
            ))}
            {isAdmin && (
              <div className="rounded-md border-2 border-dashed border-violet-200 dark:border-violet-800 p-3 space-y-2">
                <div className="text-xs font-semibold text-violet-900 dark:text-violet-200 uppercase tracking-wider">Decision (admin)</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["approved", "deferred", "declined"] as const).map(d => (
                    <Button key={d} size="sm" variant={editing.decision === d ? "default" : "outline"} className="h-8 capitalize" onClick={() => update.mutate({ id: editing.id, body: { decision: d } })}>{d}</Button>
                  ))}
                </div>
                <Textarea rows={2} defaultValue={editing.decision_notes || ""} placeholder="Decision notes" onBlur={e => update.mutate({ id: editing.id, body: { decision_notes: e.target.value } })} className="text-sm" />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 📁 Files tab — uploaded documents replace SharePoint URLs ──────────────

interface UploadedFile {
  id: string;
  kind: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  review_year: number | null;
  notes: string | null;
  created_at: string;
  uploaded_by_name: string | null;
}

function FilesTab({ userId, isAdmin, isOwn }: { userId: string; isAdmin: boolean; isOwn: boolean }) {
  const { toast } = useToast();
  const [previewing, setPreviewing] = useState<UploadedFile | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadKind, setUploadKind] = useState("other");
  const { data: files = [], isLoading } = useQuery<UploadedFile[]>({ queryKey: [`/api/hr/files/${userId}`], enabled: isAdmin || isOwn });

  const deleteFile = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/hr/files/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/hr/files/${userId}`] }),
  });

  if (!isAdmin && !isOwn) return null;

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", uploadKind);
      fd.append("name", file.name);
      const resp = await fetch(`/api/hr/files/${userId}`, { method: "POST", body: fd, credentials: "include" });
      if (!resp.ok) throw new Error(`Upload failed (${resp.status})`);
      queryClient.invalidateQueries({ queryKey: [`/api/hr/files/${userId}`] });
      toast({ title: `Uploaded ${file.name}` });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const fileIcon = (mime: string | null, name: string) => {
    if ((mime || "").startsWith("image/")) return <Camera className="w-4 h-4 text-pink-500" />;
    if ((mime || "").includes("pdf") || /\.pdf$/i.test(name)) return <FileText className="w-4 h-4 text-red-500" />;
    if (/\.(doc|docx)$/i.test(name)) return <FileText className="w-4 h-4 text-blue-500" />;
    if (/\.(xls|xlsx|csv)$/i.test(name)) return <FileText className="w-4 h-4 text-green-500" />;
    return <FileText className="w-4 h-4 text-muted-foreground" />;
  };

  const KIND_LABEL: Record<string, string> = {
    contract: "Contract",
    payslip: "Payslip",
    review: "Review",
    headshot: "Headshot / photo",
    passport: "Passport / right to work",
    cv: "CV",
    other: "Other",
  };

  const isPdf = (f: UploadedFile) => (f.mime_type || "").includes("pdf") || /\.pdf$/i.test(f.name);
  const isImg = (f: UploadedFile) => (f.mime_type || "").startsWith("image/");

  return (
    <div className="space-y-4 pb-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><Folder className="w-4 h-4 text-primary" /> Documents</span>
            <div className="flex items-center gap-2">
              <Select value={uploadKind} onValueChange={setUploadKind}>
                <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(KIND_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.heic,.txt"
              />
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fileInput.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />} Upload
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center p-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : files.length === 0 ? (
            <div className="text-xs text-muted-foreground italic py-3 text-center">No files uploaded yet. Click Upload to add a contract, payslip, headshot, etc. — kept in-app, no SharePoint detour.</div>
          ) : (
            <div className="space-y-1">
              {files.map(f => (
                <div key={f.id} className="flex items-center gap-3 p-2 rounded-md border hover:bg-accent/40 transition-colors">
                  {fileIcon(f.mime_type, f.name)}
                  <button onClick={() => setPreviewing(f)} className="flex-1 min-w-0 text-left">
                    <div className="text-sm font-medium truncate">{f.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {KIND_LABEL[f.kind] || f.kind} · {f.size_bytes ? `${Math.round(f.size_bytes / 1024)} KB · ` : ""}
                      {new Date(f.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      {f.uploaded_by_name && ` · by ${f.uploaded_by_name}`}
                    </div>
                  </button>
                  <a href={`/api/hr/files/${f.id}/file`} download={f.name} className="text-xs text-muted-foreground hover:text-foreground p-1.5">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  {(isAdmin || isOwn) && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-red-500" onClick={() => { if (confirm(`Delete ${f.name}?`)) deleteFile.mutate(f.id); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!previewing} onOpenChange={o => !o && setPreviewing(null)}>
        <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-4 border-b">
            <DialogTitle className="text-sm flex items-center gap-2">
              {previewing && fileIcon(previewing.mime_type, previewing.name)} {previewing?.name}
              {previewing && (
                <a href={`/api/hr/files/${previewing.id}/file`} download={previewing.name} className="ml-auto text-xs text-primary hover:underline flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" /> Download
                </a>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 bg-muted/20 overflow-auto">
            {previewing && isPdf(previewing) ? (
              <iframe src={`/api/hr/files/${previewing.id}/file`} className="w-full h-full border-0" title={previewing.name} />
            ) : previewing && isImg(previewing) ? (
              <div className="flex items-center justify-center p-4 h-full">
                <img src={`/api/hr/files/${previewing.id}/file`} alt={previewing.name} className="max-w-full max-h-full object-contain" />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-3">
                <FileText className="w-10 h-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">In-app preview isn't available for this file type — download to view.</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 📋 Performance reviews tab ───────────────────────────────────────────────

interface StaffReview {
  id: string;
  user_id: string;
  period: string;
  kind: string;
  review_date: string | null;
  current_salary_pence: number | null;
  fees_target_pence: number | null;
  fees_achieved_pence: number | null;
  pipeline_under_offer_pence: number | null;
  pipeline_negotiating_pence: number | null;
  expected_invoice_next_year_pence: number | null;
  achievements: string | null;
  development_areas: string | null;
  goals: string | null;
  referrals: string | null;
  marketing_pr: string | null;
  salary_expectation_pence: number | null;
  feedback: string | null;
  bgp_can_help: string | null;
  status: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  ai_summary: string | null;
}

interface ReviewGoal {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  metric_type: string | null;
  target_value: number | null;
  current_value: number | null;
  due_date: string | null;
  status: string;
  linked_task_id: string | null;
  task_title: string | null;
}

function ReviewsTab({ userId, isAdmin, isOwn, person }: { userId: string; isAdmin: boolean; isOwn: boolean; person: StaffMember }) {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newGoal, setNewGoal] = useState("");
  const { data: reviews = [], isLoading } = useQuery<StaffReview[]>({ queryKey: [`/api/hr/reviews/${userId}`] });
  const { data: goals = [] } = useQuery<ReviewGoal[]>({ queryKey: [`/api/hr/goals/${userId}`] });

  const startReview = useMutation({
    mutationFn: async ({ kind }: { kind: string }) => {
      const period = kind === "annual" ? `annual_${new Date().getFullYear()}`
        : kind === "midyear" ? `midyear_${new Date().getFullYear()}`
        : `monthly_${new Date().getFullYear()}_${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      return apiRequest("POST", `/api/hr/reviews/${userId}`, { period, kind, reviewDate: new Date().toISOString().slice(0, 10) }).then(r => r.json());
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/reviews/${userId}`] });
      setEditingId(data.id);
    },
  });

  const updateReview = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: any }) => apiRequest("PATCH", `/api/hr/reviews/${id}`, body).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/hr/reviews/${userId}`] }),
  });

  const aiDraft = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/hr/reviews/${id}/ai-draft`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/reviews/${userId}`] });
      toast({ title: "AI draft ready — see the summary panel" });
    },
    onError: (e: any) => toast({ title: "AI draft failed", description: e?.message, variant: "destructive" }),
  });

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPeriod, setImportPeriod] = useState(`annual_${new Date().getFullYear()}`);
  const importReview = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/hr/reviews/import-from-text", {
      userId, period: importPeriod, kind: "annual", text: importText,
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/reviews/${userId}`] });
      setImportOpen(false);
      setImportText("");
      toast({ title: "Review imported and parsed" });
    },
    onError: (e: any) => toast({ title: "Import failed", description: e?.message, variant: "destructive" }),
  });

  const reactMutation = useMutation({
    mutationFn: async ({ id, emoji }: { id: string; emoji: string }) => apiRequest("POST", `/api/hr/reviews/${id}/react`, { emoji }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/hr/reviews/${userId}`] }),
  });

  const addGoal = useMutation({
    mutationFn: async (title: string) => apiRequest("POST", `/api/hr/goals`, { userId, title, createTask: true }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/goals/${userId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", "todo"] });
      setNewGoal("");
    },
  });

  const updateGoal = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => apiRequest("PATCH", `/api/hr/goals/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/hr/goals/${userId}`] }),
  });

  if (!isAdmin && !isOwn) return null;

  const editing = reviews.find(r => r.id === editingId);

  return (
    <div className="space-y-4 pb-4">
      {/* Goals — appears even before any review exists */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" /> Active goals
            <span className="text-[10px] font-normal text-muted-foreground ml-auto">linked to your tasks</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {goals.filter(g => g.status === "active").length === 0 && (
            <div className="text-xs text-muted-foreground italic">No active goals — add one below to drive your year.</div>
          )}
          {goals.filter(g => g.status === "active").map(g => (
            <div key={g.id} className="flex items-center gap-2 p-2 rounded-md border">
              <button
                onClick={() => updateGoal.mutate({ id: g.id, status: "achieved" })}
                className="w-4 h-4 rounded border border-muted-foreground/40 hover:border-primary hover:bg-primary/10 flex items-center justify-center shrink-0"
              >
                <Check className="w-3 h-3 text-primary opacity-0 hover:opacity-100" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{g.title}</div>
                {g.task_title && <div className="text-[10px] text-muted-foreground">Task: {g.task_title}</div>}
              </div>
              {g.due_date && <span className="text-[10px] text-muted-foreground">{new Date(g.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
            </div>
          ))}
          {goals.filter(g => g.status === "achieved").length > 0 && (
            <details className="rounded-md border bg-muted/20">
              <summary className="text-xs p-2 cursor-pointer text-muted-foreground">Achieved ({goals.filter(g => g.status === "achieved").length})</summary>
              <div className="space-y-1 px-2 pb-2">
                {goals.filter(g => g.status === "achieved").map(g => (
                  <div key={g.id} className="flex items-center gap-2 text-xs">
                    <Check className="w-3 h-3 text-emerald-500" /> <span className="line-through text-muted-foreground">{g.title}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
          <form onSubmit={(e) => { e.preventDefault(); if (newGoal.trim()) addGoal.mutate(newGoal.trim()); }} className="flex gap-1.5 mt-2">
            <Input value={newGoal} onChange={(e) => setNewGoal(e.target.value)} placeholder="New goal — auto-creates a task" className="h-8 text-sm" />
            <Button size="sm" type="submit" variant="outline" className="h-8 px-2.5" disabled={!newGoal.trim() || addGoal.isPending}>
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Reviews list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><Star className="w-4 h-4 text-amber-500" /> Reviews</span>
            <div className="flex gap-1 flex-wrap">
              {isAdmin && (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setImportOpen(true)}>
                  Import existing
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startReview.mutate({ kind: "monthly" })} disabled={startReview.isPending}>1:1</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startReview.mutate({ kind: "midyear" })} disabled={startReview.isPending}>Mid-year</Button>
              <Button size="sm" className="h-7 text-xs" onClick={() => startReview.mutate({ kind: "annual" })} disabled={startReview.isPending}>+ Annual</Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center p-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : reviews.length === 0 ? (
            <div className="text-xs text-muted-foreground italic py-2">No reviews yet — start one above.</div>
          ) : (
            <div className="space-y-1.5">
              {reviews.map(r => (
                <button
                  key={r.id}
                  onClick={() => setEditingId(editingId === r.id ? null : r.id)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-md border text-left transition-colors hover:bg-accent/40 ${editingId === r.id ? "border-primary bg-primary/5" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium capitalize">{r.kind} review · {r.period}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.review_date ? new Date(r.review_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "Not dated"}
                      {r.fees_achieved_pence != null && r.fees_target_pence ? ` · achieved ${fmtSalary(r.fees_achieved_pence)} of ${fmtSalary(r.fees_target_pence)}` : ""}
                    </div>
                  </div>
                  <Badge variant={r.status === "completed" ? "default" : r.status === "submitted" ? "secondary" : "outline"} className="text-[10px] capitalize">{r.status.replace(/_/g, " ")}</Badge>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Editor */}
      {editing && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="capitalize">{editing.kind} review — {editing.period}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => aiDraft.mutate(editing.id)} disabled={aiDraft.isPending}>
                  {aiDraft.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />} AI draft
                </Button>
                {editing.status === "draft" && isOwn && (
                  <Button size="sm" className="h-7 text-xs" onClick={() => updateReview.mutate({ id: editing.id, body: { status: "submitted" } })}>
                    Submit to manager
                  </Button>
                )}
                {editing.status === "submitted" && isAdmin && (
                  <Button size="sm" className="h-7 text-xs" onClick={() => updateReview.mutate({ id: editing.id, body: { status: "completed" } })}>
                    Mark complete
                  </Button>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {editing.ai_summary && (
              <div className="rounded-md border bg-violet-50 dark:bg-violet-950/20 p-3">
                <div className="text-[10px] uppercase tracking-wider text-violet-700 dark:text-violet-300 mb-1 flex items-center gap-1"><Sparkles className="w-3 h-3" /> AI coach</div>
                <pre className="text-xs whitespace-pre-wrap font-sans text-muted-foreground">{editing.ai_summary}</pre>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Target (£)</Label>
                <Input type="number" defaultValue={editing.fees_target_pence ? Math.round(editing.fees_target_pence / 100) : ""} onBlur={e => updateReview.mutate({ id: editing.id, body: { fees_target_pence: Math.round(parseFloat(e.target.value || "0") * 100) } })} className="h-8" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Achieved (£)</Label>
                <Input type="number" defaultValue={editing.fees_achieved_pence ? Math.round(editing.fees_achieved_pence / 100) : ""} onBlur={e => updateReview.mutate({ id: editing.id, body: { fees_achieved_pence: Math.round(parseFloat(e.target.value || "0") * 100) } })} className="h-8" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Pipeline — under offer (£)</Label>
                <Input type="number" defaultValue={editing.pipeline_under_offer_pence ? Math.round(editing.pipeline_under_offer_pence / 100) : ""} onBlur={e => updateReview.mutate({ id: editing.id, body: { pipeline_under_offer_pence: Math.round(parseFloat(e.target.value || "0") * 100) } })} className="h-8" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Pipeline — negotiating (£)</Label>
                <Input type="number" defaultValue={editing.pipeline_negotiating_pence ? Math.round(editing.pipeline_negotiating_pence / 100) : ""} onBlur={e => updateReview.mutate({ id: editing.id, body: { pipeline_negotiating_pence: Math.round(parseFloat(e.target.value || "0") * 100) } })} className="h-8" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Expected invoice next year (£)</Label>
                <Input type="number" defaultValue={editing.expected_invoice_next_year_pence ? Math.round(editing.expected_invoice_next_year_pence / 100) : ""} onBlur={e => updateReview.mutate({ id: editing.id, body: { expected_invoice_next_year_pence: Math.round(parseFloat(e.target.value || "0") * 100) } })} className="h-8" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Salary expectation (£)</Label>
                <Input type="number" defaultValue={editing.salary_expectation_pence ? Math.round(editing.salary_expectation_pence / 100) : ""} onBlur={e => updateReview.mutate({ id: editing.id, body: { salary_expectation_pence: Math.round(parseFloat(e.target.value || "0") * 100) } })} className="h-8" />
              </div>
            </div>

            {[
              { key: "achievements", label: "Achievements", placeholder: "Numbered list of wins this year" },
              { key: "development_areas", label: "Development areas", placeholder: "What to work on" },
              { key: "goals", label: "Goals for next year", placeholder: "SMART goals — turn into tasks above" },
              { key: "referrals", label: "Referrals (cross-team)", placeholder: "Who you've passed work to internally" },
              { key: "marketing_pr", label: "Marketing / PR", placeholder: "LinkedIn posts, press, panels" },
              { key: "feedback", label: "Feedback for line manager", placeholder: "" },
              { key: "bgp_can_help", label: "Anything BGP can do to help you?", placeholder: "Hire a grad, more kit, training..." },
            ].map(f => (
              <div key={f.key} className="space-y-1.5">
                <Label className="text-xs">{f.label}</Label>
                <Textarea
                  rows={3}
                  defaultValue={(editing as any)[f.key] || ""}
                  placeholder={f.placeholder}
                  onBlur={e => updateReview.mutate({ id: editing.id, body: { [f.key]: e.target.value } })}
                  className="text-sm"
                />
              </div>
            ))}

            {/* ── Manager feedback section ─────────────────────────────── */}
            <div className="rounded-lg border-2 border-dashed border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/10 p-3 space-y-3">
              <div className="text-xs font-semibold text-blue-900 dark:text-blue-200 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" /> Manager feedback
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Manager comments {!isAdmin && <span className="text-[10px] text-muted-foreground">(admin-only)</span>}</Label>
                {isAdmin ? (
                  <Textarea
                    rows={4}
                    defaultValue={(editing as any).manager_comments || ""}
                    placeholder="Your reaction, agreement, areas to challenge, salary recommendation, next steps..."
                    onBlur={e => updateReview.mutate({ id: editing.id, body: { managerComments: e.target.value } })}
                    className="text-sm bg-background"
                  />
                ) : (
                  <div className="text-sm whitespace-pre-wrap p-2.5 rounded-md bg-background min-h-[60px]">
                    {(editing as any).manager_comments || <span className="italic text-muted-foreground text-xs">Manager hasn't added comments yet.</span>}
                  </div>
                )}
              </div>

              {(editing as any).manager_comments && isOwn && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Your acknowledgement / response</Label>
                  <Textarea
                    rows={2}
                    defaultValue={(editing as any).employee_acknowledgement || ""}
                    placeholder="Anything you'd like to say in reply"
                    onBlur={e => updateReview.mutate({ id: editing.id, body: { employeeAcknowledgement: e.target.value } })}
                    className="text-sm bg-background"
                  />
                </div>
              )}

              {/* Reactions */}
              <div className="flex items-center gap-1 flex-wrap pt-1 border-t border-blue-200/50 dark:border-blue-800/50">
                <span className="text-[10px] text-muted-foreground mr-1">React:</span>
                {(["👍", "🎉", "🔥", "💪", "🙌", "💯"]).map(em => {
                  const reactions: any[] = Array.isArray((editing as any).reactions) ? (editing as any).reactions : [];
                  const count = reactions.filter(r => r.emoji === em).length;
                  return (
                    <button
                      key={em}
                      onClick={() => reactMutation.mutate({ id: editing.id, emoji: em })}
                      className={`text-xs rounded-full px-2 py-0.5 border transition-colors ${count > 0 ? "bg-primary/10 border-primary/30" : "bg-background hover:bg-muted"}`}
                    >
                      {em} {count > 0 && <span className="ml-0.5 text-[10px] font-medium">{count}</span>}
                    </button>
                  );
                })}
              </div>
              {Array.isArray((editing as any).reactions) && (editing as any).reactions.length > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  {(editing as any).reactions.map((r: any) => `${r.byName} ${r.emoji}`).join(" · ")}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import existing review dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import existing review</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Paste a review (e.g. from a SharePoint Word doc). Claude will parse the fields automatically into a new review record so the SharePoint copy can be archived.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Period</Label>
              <Input value={importPeriod} onChange={e => setImportPeriod(e.target.value)} placeholder="annual_2026" className="h-8" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Review text</Label>
              <Textarea rows={14} value={importText} onChange={e => setImportText(e.target.value)} className="text-xs font-mono" placeholder="Performance review – May 2026&#10;&#10;Name: ...&#10;Position: ...&#10;Date: ...&#10;Current Salary: £...&#10;..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button onClick={() => importReview.mutate()} disabled={!importText.trim() || importReview.isPending}>
              {importReview.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Parse &amp; import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 💰 Pension dashboard tab ─────────────────────────────────────────────────

interface PensionData {
  contributions: Array<{
    pay_period: string | null;
    pay_date: string | null;
    employee_pence: number;
    employer_pence: number;
    pensionable_pay_pence: number | null;
    source_file: string | null;
  }>;
  totals: {
    employeeYtdPence: number;
    employerYtdPence: number;
    currentYear: number;
    contributionCount: number;
  };
}

function PensionTab({ userId, isAdmin, isOwn }: { userId: string; isAdmin: boolean; isOwn: boolean }) {
  const { toast } = useToast();
  const [csvText, setCsvText] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const { data, isLoading } = useQuery<PensionData>({ queryKey: [`/api/hr/pension/${userId}`], enabled: isAdmin || isOwn });

  const importCsv = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/hr/pension/import", { csv: csvText, sourceFile: `royal-london-${new Date().toISOString().slice(0, 10)}.csv` }).then(r => r.json()),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/pension/${userId}`] });
      const unmatchedMsg = data.unmatched > 0 ? ` (${data.unmatched} unmatched: ${(data.unmatchedNames || []).slice(0, 3).join(", ")}…)` : "";
      toast({ title: `Imported ${data.imported} contributions${unmatchedMsg}` });
      setImportOpen(false);
      setCsvText("");
    },
    onError: (e: any) => toast({ title: "Import failed", description: e?.message, variant: "destructive" }),
  });

  if (!isAdmin && !isOwn) return null;
  if (isLoading) return <div className="flex items-center justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-4 pb-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><PiggyBank className="w-4 h-4 text-primary" /> Pension — Royal London</span>
            {isAdmin && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setImportOpen(true)}>
                Import CSV
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Your YTD</div>
              <div className="text-base font-semibold tabular-nums">{fmtSalary(data.totals.employeeYtdPence)}</div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Employer YTD</div>
              <div className="text-base font-semibold tabular-nums">{fmtSalary(data.totals.employerYtdPence)}</div>
            </div>
            <div className="rounded-lg border p-3 text-center bg-emerald-50/40 dark:bg-emerald-950/20">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total YTD {data.totals.currentYear}</div>
              <div className="text-base font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{fmtSalary(data.totals.employeeYtdPence + data.totals.employerYtdPence)}</div>
            </div>
          </div>

          {data.contributions.length === 0 ? (
            <div className="text-xs text-muted-foreground italic text-center py-3">
              No contributions imported yet. {isAdmin ? "Click Import CSV to upload Royal London's contribution report." : "Ask an admin to import the latest payroll CSV."}
            </div>
          ) : (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Recent contributions</div>
              {data.contributions.slice(0, 12).map((c, i) => (
                <div key={i} className="flex items-center gap-2 p-1.5 rounded-md border text-xs">
                  <Calendar className="w-3 h-3 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="font-medium">{c.pay_period || (c.pay_date ? new Date(c.pay_date).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "Unknown period")}</div>
                  </div>
                  <span className="text-muted-foreground tabular-nums">You {fmtSalary(c.employee_pence)}</span>
                  <span className="text-muted-foreground tabular-nums">+ Emp {fmtSalary(c.employer_pence)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Import Royal London CSV</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Paste the CSV from Royal London's <em>Online Service for Employers</em> contribution report. Expected columns: Member Name, Pay Period, Pay Date, Employee Contribution, Employer Contribution, Pensionable Pay.
            </p>
            <Textarea rows={10} value={csvText} onChange={e => setCsvText(e.target.value)} className="font-mono text-xs" placeholder="Member Name,Pay Period,Pay Date,Employee Contribution,Employer Contribution,Pensionable Pay&#10;Woody Bruce,May 2026,2026-05-31,250.00,150.00,5000.00" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button onClick={() => importCsv.mutate()} disabled={!csvText.trim() || importCsv.isPending}>
              {importCsv.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 📊 Marketing trends extractor ────────────────────────────────────────────

interface TrendsResponse {
  trends: {
    themes?: Array<{ title: string; summary: string; evidence: string[]; spokesperson?: string; outlets?: string[] }>;
    opinion_pieces?: Array<{ title: string; angle: string; drafted_by?: string }>;
    event_topics?: Array<{ title: string; audience?: string; questions?: string[] }>;
    note?: string;
  };
  dealCount: number;
  periodDays: number;
}

function MarketingTrendsPanel({ isAdmin }: { isAdmin: boolean }) {
  const [team, setTeam] = useState<string>("");
  const { data, isLoading, refetch, isFetching } = useQuery<TrendsResponse>({
    queryKey: ["/api/marketing/trends", team],
    queryFn: () => apiRequest("GET", `/api/marketing/trends${team ? `?team=${encodeURIComponent(team)}` : ""}`).then(r => r.json()),
    enabled: false,
  });

  const TEAMS = ["", "Lease Advisory", "London Leasing", "National Leasing", "Investment", "Tenant Rep", "Development"];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-500" /> Quarterly trends — opinion-leader fuel</span>
          <div className="flex items-center gap-2">
            <Select value={team || "all"} onValueChange={v => setTeam(v === "all" ? "" : v)}>
              <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {TEAMS.filter(Boolean).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-7 text-xs" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
              {data ? "Refresh" : "Generate"}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {!data && !isLoading && (
          <div className="text-xs text-muted-foreground italic py-3 text-center">
            Click <strong>Generate</strong> — Claude will scan the past 90 days of deals and surface opinion-leader themes, article angles and panel topics for Emmy.
          </div>
        )}
        {data?.trends?.note && (
          <div className="text-xs text-amber-600 italic mb-2">{data.trends.note}</div>
        )}
        {data?.trends?.themes && data.trends.themes.length > 0 && (
          <div className="space-y-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Themes ({data.dealCount} deals · {data.periodDays}d)</div>
              <div className="space-y-2">
                {data.trends.themes.map((t, i) => (
                  <div key={i} className="rounded-md border p-2.5 bg-violet-50/30 dark:bg-violet-950/10">
                    <div className="text-sm font-semibold">{t.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{t.summary}</div>
                    {t.evidence?.length > 0 && (
                      <div className="text-[10px] text-muted-foreground mt-1.5">
                        <span className="font-medium">Evidence:</span> {t.evidence.join(" · ")}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {t.spokesperson && <Badge variant="outline" className="text-[10px]">🗣 {t.spokesperson}</Badge>}
                      {t.outlets?.map(o => <Badge key={o} variant="outline" className="text-[10px]">📰 {o}</Badge>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {data.trends.opinion_pieces && data.trends.opinion_pieces.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Opinion pieces to pitch</div>
                <div className="space-y-1.5">
                  {data.trends.opinion_pieces.map((p, i) => (
                    <div key={i} className="rounded-md border p-2 text-xs">
                      <div className="font-medium">{p.title}</div>
                      <div className="text-muted-foreground">{p.angle}</div>
                      {p.drafted_by && <div className="text-[10px] text-muted-foreground mt-0.5">Best author: {p.drafted_by}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.trends.event_topics && data.trends.event_topics.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">BGP event / panel topics</div>
                <div className="space-y-1.5">
                  {data.trends.event_topics.map((e, i) => (
                    <div key={i} className="rounded-md border p-2 text-xs">
                      <div className="font-medium">{e.title}</div>
                      {e.audience && <div className="text-muted-foreground">Audience: {e.audience}</div>}
                      {e.questions?.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {e.questions.map((q, j) => <li key={j} className="text-muted-foreground">· {q}</li>)}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 📣 LinkedIn post drafter (pick a recent deal → AI generates variants) ────

interface DraftPostResponse {
  deal: { id: string; name: string };
  drafts: {
    variants?: Array<{ tone: string; text: string }>;
    hashtags?: string[];
    tag_suggestions?: string[];
    note?: string;
  };
}

function LinkedInDraftPanel() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedDealId, setSelectedDealId] = useState<string>("");
  const { data: deals = [] } = useQuery<Array<{ id: string; name: string; status: string }>>({
    queryKey: ["/api/crm/deals", "marketing-pickable"],
    queryFn: () => apiRequest("GET", "/api/crm/deals?limit=80").then(r => r.json()).catch(() => []),
  });
  const [result, setResult] = useState<DraftPostResponse | null>(null);

  const draftPost = useMutation({
    mutationFn: async (dealId: string) => apiRequest("POST", "/api/marketing/draft-post", { dealId, kind: "linkedin" }).then(r => r.json()),
    onSuccess: (data: any) => {
      setResult(data);
      if (data.drafts?.note) toast({ title: data.drafts.note, variant: "destructive" });
    },
    onError: (e: any) => toast({ title: "Draft failed", description: e?.message, variant: "destructive" }),
  });

  const filteredDeals = useMemo(() => {
    const q = search.toLowerCase();
    return (Array.isArray(deals) ? deals : []).filter((d: any) => !q || d.name?.toLowerCase().includes(q)).slice(0, 30);
  }, [deals, search]);

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied" });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Linkedin className="w-4 h-4 text-sky-600" /> Draft a LinkedIn post</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex gap-2">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search deals..." className="h-8 text-sm flex-1" />
          <Select value={selectedDealId} onValueChange={setSelectedDealId}>
            <SelectTrigger className="h-8 text-xs w-64"><SelectValue placeholder="Pick a deal…" /></SelectTrigger>
            <SelectContent>{filteredDeals.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name} ({d.status})</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" disabled={!selectedDealId || draftPost.isPending} onClick={() => draftPost.mutate(selectedDealId)}>
            {draftPost.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
            Draft
          </Button>
        </div>

        {result && result.drafts?.variants && result.drafts.variants.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">3 variants for {result.deal.name}</div>
            {result.drafts.variants.map((v, i) => (
              <div key={i} className="rounded-md border p-2.5 bg-sky-50/30 dark:bg-sky-950/10">
                <div className="flex items-center justify-between mb-1.5">
                  <Badge variant="outline" className="text-[10px] capitalize">{v.tone}</Badge>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => copyText(v.text)}>Copy</Button>
                </div>
                <pre className="text-xs whitespace-pre-wrap font-sans">{v.text}</pre>
              </div>
            ))}
            {result.drafts.hashtags && result.drafts.hashtags.length > 0 && (
              <div className="text-xs">
                <span className="text-muted-foreground">Hashtags: </span>
                {result.drafts.hashtags.join(" ")}
              </div>
            )}
            {result.drafts.tag_suggestions && result.drafts.tag_suggestions.length > 0 && (
              <div className="text-xs">
                <span className="text-muted-foreground">Tag suggestions: </span>
                {result.drafts.tag_suggestions.join(" ")}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 📣 Marketing hub tab ──────────────────────────────────────────────────────

interface MarketingEvent {
  id: string;
  title: string;
  kind: string | null;
  category: string | null;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  description: string | null;
  lead_user_id: string | null;
  lead_name: string | null;
  lead_pic: string | null;
  external_url: string | null;
  status: string;
}

interface PressContact {
  id: string;
  name: string;
  title: string | null;
  publication: string | null;
  email: string | null;
  notes: string | null;
}

function MarketingHub({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", kind: "industry", category: "", startsAt: "", location: "", description: "" });
  const { data: events = [] } = useQuery<MarketingEvent[]>({ queryKey: ["/api/marketing/events"] });
  const { data: press = [] } = useQuery<PressContact[]>({ queryKey: ["/api/marketing/press"] });

  const seedMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/marketing/seed").then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/press"] });
      toast({ title: "Seeded calendar from Emmy's strategy" });
    },
  });

  const addEvent = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/marketing/events", form).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing/events"] });
      setAdding(false);
      setForm({ title: "", kind: "industry", category: "", startsAt: "", location: "", description: "" });
    },
  });

  const upcoming = events.filter(e => !e.starts_at || new Date(e.starts_at) >= new Date());
  const past = events.filter(e => e.starts_at && new Date(e.starts_at) < new Date());

  const kindBadge = (k: string | null) => ({
    industry: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    pitch: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    speaking: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    bgp: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    press: "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300",
  }[k || ""] || "bg-muted text-muted-foreground");

  return (
    <div className="space-y-4 pb-6">
      <div className="rounded-lg border bg-gradient-to-r from-pink-50 to-violet-50 dark:from-pink-950/30 dark:to-violet-950/30 p-4 flex items-start gap-3">
        <Megaphone className="w-5 h-5 text-pink-600 dark:text-pink-300 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-sm font-semibold mb-0.5">Marketing hub</div>
          <p className="text-xs text-muted-foreground">Editorial calendar, BGP events, press contacts and campaign pipeline. Charlotte heads up, Emmy drives the day-to-day. AI-powered trend extraction & LinkedIn deal-watcher coming next.</p>
        </div>
        {isAdmin && events.length === 0 && (
          <Button size="sm" variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
            Seed from Emmy's strategy
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><Calendar className="w-4 h-4 text-primary" /> Upcoming events &amp; pitches</span>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(true)}>
              <Plus className="w-3 h-3 mr-1" /> Add
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-1.5">
          {upcoming.length === 0 ? (
            <div className="text-xs text-muted-foreground italic py-2">Nothing scheduled.</div>
          ) : (
            upcoming.map(e => (
              <div key={e.id} className="flex items-center gap-3 p-2.5 rounded-md border">
                <div className="w-12 text-center shrink-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{e.starts_at ? new Date(e.starts_at).toLocaleDateString("en-GB", { month: "short" }) : "TBC"}</div>
                  <div className="text-lg font-bold leading-none">{e.starts_at ? new Date(e.starts_at).getDate() : "—"}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{e.title}</div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {e.kind && <span className={`text-[10px] px-1.5 py-0.5 rounded ${kindBadge(e.kind)}`}>{e.kind}</span>}
                    {e.category && <span className="text-[10px] text-muted-foreground">{e.category}</span>}
                    {e.location && <span className="text-[10px] text-muted-foreground">· {e.location}</span>}
                  </div>
                </div>
                {e.lead_name && (
                  <div className="text-[10px] text-muted-foreground shrink-0">{e.lead_name}</div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> Press contacts</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {press.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">No press contacts yet.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {press.map(p => (
                <div key={p.id} className="p-2 rounded-md border text-xs">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-muted-foreground">{p.title}{p.publication ? ` · ${p.publication}` : ""}</div>
                  {p.email && <a href={`mailto:${p.email}`} className="text-primary hover:underline">{p.email}</a>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <MarketingTrendsPanel isAdmin={isAdmin} />
      <LinkedInDraftPanel />

      {past.length > 0 && (
        <details className="rounded-md border bg-muted/10">
          <summary className="text-xs cursor-pointer p-3 text-muted-foreground">Past events ({past.length})</summary>
          <div className="px-3 pb-3 space-y-1">
            {past.slice(0, 20).map(e => (
              <div key={e.id} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground tabular-nums w-20 shrink-0">{e.starts_at ? new Date(e.starts_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : ""}</span>
                <span className="flex-1 truncate">{e.title}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add marketing event</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="MAPIC panel discussion" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Kind</Label>
                <Select value={form.kind} onValueChange={v => setForm(f => ({ ...f, kind: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="industry">Industry event</SelectItem>
                    <SelectItem value="pitch">Press pitch</SelectItem>
                    <SelectItem value="speaking">Speaking opportunity</SelectItem>
                    <SelectItem value="bgp">BGP event</SelectItem>
                    <SelectItem value="press">Media bonding</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="datetime-local" value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Location (optional)</Label>
              <Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Cannes, Estates Gazette HQ…" />
            </div>
            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={() => addEvent.mutate()} disabled={!form.title.trim() || addEvent.isPending}>Add event</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 💳 Expenses analysis (inline on profile) ────────────────────────────────

interface ExpensesSummary {
  hasCard: boolean;
  mtdPence: number;
  ytdPence: number;
  totalPence: number;
  ytdCount: number;
  rechargeableCount: number;
  rechargeablePence: number;
  byCategory: Array<{ category: string; count: number; pence: number }>;
  topMerchants: Array<{ merchant: string; count: number; pence: number }>;
  topClients: Array<{ client: string; dealId: string | null; count: number; pence: number; rechargeable: boolean }>;
  recent: Array<{
    id: string;
    merchant: string | null;
    amountPence: number;
    transactionDate: string | null;
    category: string | null;
    businessPurpose: string | null;
    status: string;
    relatedDealId: string | null;
  }>;
}

const CATEGORY_COLORS = ["bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-pink-500", "bg-violet-500", "bg-orange-500", "bg-cyan-500", "bg-rose-500", "bg-indigo-500", "bg-lime-500", "bg-fuchsia-500", "bg-teal-500"];

function ExpensesAnalysisCard({ userId, isAdmin, isOwn }: { userId: string; isAdmin: boolean; isOwn: boolean }) {
  const [, navigate] = useLocation();
  const { data, isLoading } = useQuery<ExpensesSummary>({
    queryKey: [`/api/hr/staff/${userId}/expenses-summary`],
    enabled: isAdmin || isOwn,
  });

  if (!isAdmin && !isOwn) return null;
  if (isLoading) return <Card><CardContent className="p-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" /></CardContent></Card>;
  if (!data || !data.hasCard) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CreditCard className="w-4 h-4 text-muted-foreground" /> Expenses</CardTitle></CardHeader>
        <CardContent className="pt-0 text-xs text-muted-foreground italic">No card issued yet.</CardContent>
      </Card>
    );
  }

  const totalCat = data.byCategory.reduce((s, c) => s + c.pence, 0) || 1;
  const rechargePct = data.ytdPence > 0 ? Math.round((data.rechargeablePence / data.ytdPence) * 100) : 0;

  const statusColor = (s: string) => ({
    pending_receipt: "text-amber-600",
    pending_approval: "text-amber-600",
    approved: "text-green-600",
    rejected: "text-red-500",
    posted_to_xero: "text-blue-600",
  }[s] || "text-muted-foreground");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" /> Expenses analysis</span>
          <button onClick={() => navigate(isAdmin ? "/expenses" : "/my-expenses")} className="text-[11px] text-primary hover:underline">Open full ledger →</button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Headline numbers */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border p-2.5 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">This month</div>
            <div className="text-base font-semibold tabular-nums">{fmtSalary(data.mtdPence)}</div>
          </div>
          <div className="rounded-lg border p-2.5 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">YTD ({data.ytdCount})</div>
            <div className="text-base font-semibold tabular-nums">{fmtSalary(data.ytdPence)}</div>
          </div>
          <div className="rounded-lg border p-2.5 text-center bg-emerald-50/40 dark:bg-emerald-950/20">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Rechargeable</div>
            <div className="text-base font-semibold tabular-nums">{fmtSalary(data.rechargeablePence)}</div>
            <div className="text-[10px] text-emerald-700 dark:text-emerald-400">{rechargePct}% of YTD</div>
          </div>
        </div>

        {/* Category breakdown */}
        {data.byCategory.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Where it went · YTD</div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
              {data.byCategory.map((c, i) => (
                <div
                  key={c.category}
                  className={CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                  style={{ width: `${(c.pence / totalCat) * 100}%` }}
                  title={`${c.category}: ${fmtSalary(c.pence)}`}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
              {data.byCategory.slice(0, 8).map((c, i) => (
                <div key={c.category} className="flex items-center gap-1.5 text-[11px]">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${CATEGORY_COLORS[i % CATEGORY_COLORS.length]}`} />
                  <span className="flex-1 truncate text-muted-foreground">{c.category}</span>
                  <span className="font-medium tabular-nums">{fmtSalary(c.pence)}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums w-7 text-right">×{c.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top clients */}
        {data.topClients.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Top clients YTD</div>
            <div className="space-y-1">
              {data.topClients.slice(0, 5).map((c, i) => (
                <div key={`${c.client}-${i}`} className="flex items-center gap-2 text-xs">
                  <Building2 className="w-3 h-3 text-muted-foreground shrink-0" />
                  <button
                    onClick={() => c.dealId ? navigate(`/deals/${c.dealId}`) : null}
                    disabled={!c.dealId}
                    className="flex-1 truncate text-left hover:text-foreground disabled:hover:text-current"
                  >
                    {c.client}
                  </button>
                  {c.rechargeable && <Badge variant="outline" className="text-[9px] h-4 px-1 text-emerald-700 border-emerald-300">£→client</Badge>}
                  <span className="text-[10px] text-muted-foreground tabular-nums">×{c.count}</span>
                  <span className="font-medium tabular-nums">{fmtSalary(c.pence)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top merchants */}
        {data.topMerchants.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Top merchants YTD</div>
            <div className="space-y-1">
              {data.topMerchants.slice(0, 5).map(m => (
                <div key={m.merchant} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate text-muted-foreground">{m.merchant}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">×{m.count}</span>
                  <span className="font-medium tabular-nums">{fmtSalary(m.pence)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent transactions */}
        {data.recent.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Recent transactions</div>
            <div className="space-y-1">
              {data.recent.slice(0, 6).map(r => (
                <button
                  key={r.id}
                  onClick={() => navigate(isAdmin ? `/expenses/${r.id}` : `/my-expenses/${r.id}`)}
                  className="w-full flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/40 text-left text-xs"
                >
                  <Clock className={`w-3 h-3 shrink-0 ${statusColor(r.status)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{r.merchant || "Unknown"}</div>
                    {(r.businessPurpose || r.category) && (
                      <div className="text-[10px] text-muted-foreground truncate">{r.businessPurpose || r.category}</div>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                    {r.transactionDate ? new Date(r.transactionDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
                  </span>
                  <span className="font-semibold tabular-nums shrink-0">{fmtSalary(r.amountPence)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 🎁 Benefits hub ───────────────────────────────────────────────────────────

interface Benefit {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  eligibility: string | null;
  enrolment_url: string | null;
  contact: string | null;
  icon: string | null;
  enrolled: boolean;
}

const BENEFIT_ICONS: Record<string, any> = {
  bike: Bike,
  baby: Baby,
  heart: Heart,
  shield: Shield,
  "piggy-bank": PiggyBank,
  smartphone: Smartphone,
  train: Train,
  "heart-handshake": HeartHandshake,
  "graduation-cap": GraduationCap,
  mountain: Mountain,
};
const BENEFIT_CAT_COLORS: Record<string, string> = {
  Wellbeing: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  Family:    "bg-pink-50 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300",
  Health:    "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  Finance:   "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  Kit:       "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
  Travel:    "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  Career:    "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  Social:    "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
};

function BenefitsTab() {
  const { toast } = useToast();
  const { data: benefits = [], isLoading } = useQuery<Benefit[]>({ queryKey: ["/api/hr/benefits"] });

  const enrol = useMutation({
    mutationFn: async ({ slug, enrolled }: { slug: string; enrolled: boolean }) => {
      if (enrolled) await apiRequest("DELETE", `/api/hr/benefits/${slug}/enrol`);
      else await apiRequest("POST", `/api/hr/benefits/${slug}/enrol`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/hr/benefits"] }),
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="flex items-center justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const byCategory = benefits.reduce<Record<string, Benefit[]>>((acc, b) => {
    const c = b.category || "Other";
    (acc[c] ??= []).push(b);
    return acc;
  }, {});

  return (
    <div className="space-y-6 pb-6">
      <div className="rounded-lg border bg-gradient-to-br from-emerald-50 to-sky-50 dark:from-emerald-950/30 dark:to-sky-950/30 p-4">
        <div className="text-sm font-semibold mb-1">Your benefits at BGP</div>
        <p className="text-xs text-muted-foreground">
          Click into anything to enrol or check eligibility. Salary-sacrifice schemes are usually the best-value perks — let Wendy know if you want help working out the saving.
        </p>
      </div>

      {Object.entries(byCategory).map(([cat, items]) => (
        <div key={cat}>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
            <span>{cat}</span>
            <span className="h-px flex-1 bg-border" />
            <span className="text-[10px]">{items.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {items.map(b => {
              const Icon = b.icon ? BENEFIT_ICONS[b.icon] || Star : Star;
              const catColor = BENEFIT_CAT_COLORS[b.category || ""] || "bg-muted text-muted-foreground";
              return (
                <Card key={b.id} className="overflow-hidden hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`rounded-lg p-2 shrink-0 ${catColor}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-sm">{b.name}</h4>
                          {b.enrolled && (
                            <Badge variant="outline" className="text-[10px] text-green-700 border-green-300 dark:text-green-400 dark:border-green-700">
                              <Check className="w-3 h-3 mr-0.5" /> Enrolled
                            </Badge>
                          )}
                        </div>
                        {b.description && <p className="text-xs text-muted-foreground leading-relaxed">{b.description}</p>}
                        {b.eligibility && (
                          <div className="text-[10px] text-muted-foreground mt-1.5 italic">{b.eligibility}</div>
                        )}
                        <div className="flex items-center gap-2 mt-3">
                          <Button
                            size="sm"
                            variant={b.enrolled ? "outline" : "default"}
                            className="h-7 text-xs"
                            onClick={() => enrol.mutate({ slug: b.slug, enrolled: b.enrolled })}
                            disabled={enrol.isPending}
                            data-testid={`benefit-enrol-${b.slug}`}
                          >
                            {b.enrolled ? "Mark as not enrolled" : "I'm enrolled / interested"}
                          </Button>
                          {b.enrolment_url && (
                            <a href={b.enrolment_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" /> Sign up
                            </a>
                          )}
                          {b.contact && (
                            <span className="text-[10px] text-muted-foreground ml-auto">Ask {b.contact}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 📱 Kit / phone-laptop contract card on staff profile ─────────────────────

interface KitItem {
  id: string;
  kind: string;
  device: string | null;
  contract_start: string | null;
  contract_end: string | null;
  provider: string | null;
  monthly_cost_pence: number | null;
  notes: string | null;
}

const KIT_ICONS: Record<string, any> = {
  phone: Smartphone,
  laptop: Briefcase,
  tablet: Briefcase,
  other: Briefcase,
};
const KIT_LABEL: Record<string, string> = {
  phone: "Mobile phone",
  laptop: "Laptop",
  tablet: "Tablet",
  other: "Other kit",
};

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

function KitCard({ person, isAdmin, isOwn }: { person: StaffMember; isAdmin: boolean; isOwn: boolean }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ kind: "phone", device: "", contractEnd: "", provider: "", monthlyCostPence: "" });
  const { data: kit = [] } = useQuery<KitItem[]>({ queryKey: [`/api/hr/kit/${person.id}`], enabled: isAdmin || isOwn });

  const addKit = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/hr/kit/${person.id}`, {
      kind: form.kind,
      device: form.device || null,
      contractEnd: form.contractEnd || null,
      provider: form.provider || null,
      monthlyCostPence: form.monthlyCostPence ? Math.round(parseFloat(form.monthlyCostPence) * 100) : null,
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/kit/${person.id}`] });
      setAdding(false);
      setForm({ kind: "phone", device: "", contractEnd: "", provider: "", monthlyCostPence: "" });
      toast({ title: "Kit added" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  const deleteKit = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/hr/kit/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/hr/kit/${person.id}`] }),
  });

  if (!isAdmin && !isOwn) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2"><Smartphone className="w-4 h-4 text-muted-foreground" /> Kit & contracts</span>
          {isAdmin && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(true)}>
              <Plus className="w-3 h-3 mr-1" /> Add
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {kit.length === 0 ? (
          <div className="text-xs text-muted-foreground italic py-2">No kit logged yet — admin can add phones, laptops and contract end dates.</div>
        ) : (
          <div className="space-y-2">
            {kit.map(k => {
              const Icon = KIT_ICONS[k.kind] || Briefcase;
              const days = daysUntil(k.contract_end);
              const isUpgradeReady = days !== null && days <= 60;
              return (
                <div key={k.id} className="flex items-center gap-3 p-2.5 rounded-md border">
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{k.device || KIT_LABEL[k.kind] || k.kind}</div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                      {k.provider && <span>{k.provider}</span>}
                      {k.monthly_cost_pence && <span>· £{(k.monthly_cost_pence / 100).toFixed(2)}/mo</span>}
                      {k.contract_end && (
                        <span className={isUpgradeReady ? "text-green-600 font-medium" : days !== null && days < 0 ? "text-red-500 font-medium" : ""}>
                          · {days === null ? "—"
                            : days < 0 ? `Upgrade overdue (${-days}d)`
                            : days === 0 ? "Upgrade today"
                            : days <= 60 ? `Upgrade in ${days}d 🎉`
                            : `Ends ${new Date(k.contract_end).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`}
                        </span>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={() => deleteKit.mutate(k.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add kit / contract</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Kind</Label>
                  <Select value={form.kind} onValueChange={v => setForm(f => ({ ...f, kind: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["phone", "laptop", "tablet", "other"].map(k => <SelectItem key={k} value={k}>{KIT_LABEL[k]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Device</Label>
                  <Input value={form.device} onChange={e => setForm(f => ({ ...f, device: e.target.value }))} placeholder="iPhone 16 Pro" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Contract ends</Label>
                  <Input type="date" value={form.contractEnd} onChange={e => setForm(f => ({ ...f, contractEnd: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Provider</Label>
                  <Input value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} placeholder="EE, O2, Vodafone…" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Monthly cost (£)</Label>
                <Input type="number" step="0.01" value={form.monthlyCostPence} onChange={e => setForm(f => ({ ...f, monthlyCostPence: e.target.value }))} placeholder="45" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
              <Button onClick={() => addKit.mutate()} disabled={addKit.isPending}>
                {addKit.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ── 🎓 Career roadmap tab on staff profile ───────────────────────────────────

interface CompetencyEntry {
  competency: string;
  level: number;
  evidence: string | null;
  reviewedAt: string | null;
}

interface CareerRoadmap {
  rics: { mandatory: CompetencyEntry[]; technical: CompetencyEntry[] };
  bgpLevels: Array<{ level: string; criteria: string[] }>;
}

function CareerRoadmapTab({ userId, isAdmin, isOwn, currentTitle }: { userId: string; isAdmin: boolean; isOwn: boolean; currentTitle: string | null }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<CareerRoadmap>({ queryKey: [`/api/hr/career-roadmap/${userId}`] });

  const updateLevel = useMutation({
    mutationFn: async ({ competency, level, evidence }: { competency: string; level: number; evidence?: string }) => {
      await apiRequest("PUT", `/api/hr/career-roadmap/${userId}/${encodeURIComponent(competency)}`, { level, evidence });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/hr/career-roadmap/${userId}`] }),
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <div className="flex items-center justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const allCompetencies = [...data.rics.mandatory, ...data.rics.technical];
  const totalLevels = allCompetencies.reduce((s, c) => s + c.level, 0);
  const maxLevels = allCompetencies.length * 3;
  const overallPct = maxLevels > 0 ? Math.round((totalLevels / maxLevels) * 100) : 0;

  // Try to map current title onto BGP levels
  const currentLevelIdx = currentTitle
    ? data.bgpLevels.findIndex(l => currentTitle.toLowerCase().includes(l.level.toLowerCase()))
    : -1;

  const canEdit = isAdmin || isOwn;

  const renderCompetencyList = (items: CompetencyEntry[], label: string) => (
    <div>
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{label}</div>
      <div className="space-y-1">
        {items.map(c => (
          <div key={c.competency} className="flex items-center gap-2 p-2 rounded-md border text-xs">
            <div className="flex-1 truncate">{c.competency}</div>
            <div className="flex gap-0.5">
              {[0, 1, 2, 3].map(l => (
                <button
                  key={l}
                  disabled={!canEdit || updateLevel.isPending}
                  onClick={() => updateLevel.mutate({ competency: c.competency, level: l })}
                  className={`w-6 h-6 rounded text-[10px] font-medium border transition-colors ${
                    c.level === l
                      ? "bg-primary text-primary-foreground border-primary"
                      : c.level > l
                      ? "bg-primary/30 border-primary/40"
                      : "bg-background hover:bg-muted border-border"
                  } ${!canEdit ? "cursor-default" : "cursor-pointer"}`}
                  title={["Not started", "Knowledge", "Application", "Achievement"][l]}
                  data-testid={`competency-${c.competency.replace(/\W+/g, "-")}-${l}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4 pb-4">
      {/* Overall progress hero */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">RICS competency progress</span>
            <span className="text-xs text-muted-foreground">{totalLevels} of {maxLevels} levels</span>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold tabular-nums">{overallPct}%</span>
            <span className="text-sm text-muted-foreground">towards APC submission</span>
          </div>
          <div className="h-2 mt-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${overallPct}%` }} />
          </div>
          <div className="text-[10px] text-muted-foreground mt-1.5">Levels: 0 = not started · 1 = knowledge · 2 = application · 3 = achievement</div>
        </CardContent>
      </Card>

      {/* BGP career ladder */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Award className="w-4 h-4 text-primary" /> BGP career path</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-1">
            {data.bgpLevels.map((lvl, i) => {
              const isCurrent = i === currentLevelIdx;
              const isPast = currentLevelIdx >= 0 && i < currentLevelIdx;
              return (
                <details key={lvl.level} open={isCurrent} className={`rounded-md border ${isCurrent ? "border-primary bg-primary/5" : "border-border"}`}>
                  <summary className="cursor-pointer flex items-center gap-2 p-2.5 select-none">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      isCurrent ? "bg-primary text-primary-foreground"
                      : isPast ? "bg-emerald-500 text-white"
                      : "bg-muted text-muted-foreground"
                    }`}>
                      {isPast ? <Check className="w-3 h-3" /> : i + 1}
                    </span>
                    <span className="text-sm font-medium flex-1">{lvl.level}</span>
                    {isCurrent && <Badge className="text-[10px]">You're here</Badge>}
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  </summary>
                  <div className="px-3 pb-3 pt-0">
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {lvl.criteria.map(c => (
                        <li key={c} className="flex items-start gap-1.5">
                          <Check className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* RICS competencies */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><GraduationCap className="w-4 h-4 text-primary" /> RICS competencies — Commercial Property Practice</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {renderCompetencyList(data.rics.mandatory, "Mandatory")}
          {renderCompetencyList(data.rics.technical, "Technical")}
          {!canEdit && <div className="text-[10px] text-muted-foreground italic">Read-only — only the user themselves or an admin can update levels.</div>}
        </CardContent>
      </Card>

      <PromotionPitchesPanel
        userId={userId}
        isAdmin={isAdmin}
        isOwn={isOwn}
        currentTitle={currentTitle}
        levels={data.bgpLevels.map(l => l.level)}
      />
    </div>
  );
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
  "London Retail":       { bg: "bg-yellow-50 dark:bg-yellow-950/30", border: "border-yellow-300 dark:border-yellow-700", text: "text-yellow-900 dark:text-yellow-100", pip: "bg-yellow-500" },
  "London F&B":          { bg: "bg-rose-50 dark:bg-rose-950/30", border: "border-rose-300 dark:border-rose-700", text: "text-rose-900 dark:text-rose-100", pip: "bg-rose-500" },
};
const DEFAULT_TEAM_STYLE = { bg: "bg-muted", border: "border-border", text: "text-foreground", pip: "bg-gray-500" };
const TEAM_ORDER = ["Office / Corporate", "Investment", "Lease Advisory", "National Leasing", "Development", "Tenant Rep", "London Retail", "London F&B"];

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

// ── Import salaries from a SharePoint spreadsheet (admin) ────────────────────

function ImportSalariesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [shareUrl, setShareUrl] = useState("");
  const [report, setReport] = useState<any>(null);

  const previewMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/hr/import-salaries", { shareUrl: shareUrl.trim(), dryRun: true });
      return r.json();
    },
    onSuccess: (data) => { setReport(data); },
    onError: (e: any) => toast({ title: "Preview failed", description: e?.message || String(e), variant: "destructive" }),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/hr/import-salaries", { shareUrl: shareUrl.trim(), dryRun: false });
      return r.json();
    },
    onSuccess: (data) => {
      setReport(data);
      queryClient.invalidateQueries({ queryKey: ["/api/hr/staff"] });
      toast({
        title: "Salary import complete",
        description: `${data.salaryHistoryInserted} history rows inserted, ${data.salaryCurrentUpdated} salaries updated.`,
      });
    },
    onError: (e: any) => toast({ title: "Import failed", description: e?.message || String(e), variant: "destructive" }),
  });

  const close = () => { setShareUrl(""); setReport(null); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Import salaries from SharePoint</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>SharePoint share link</Label>
            <Input
              value={shareUrl}
              onChange={(e) => setShareUrl(e.target.value)}
              placeholder="https://brucegillinghampollardlimited.sharepoint.com/..."
              data-testid="input-import-share-url"
            />
            <p className="text-[11px] text-muted-foreground">
              Paste a link to the salary tracker spreadsheet. The app reads it via your Microsoft 365 Graph integration —
              column headers are auto-detected (Name / Salary / Effective Date / Bonus / Commission).
              Preview first to see what will land before committing.
            </p>
          </div>

          {report && (
            <div className="space-y-2 rounded-md border p-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{report.filename}</div>
                <Badge variant={report.dryRun ? "outline" : "default"}>{report.dryRun ? "Preview" : "Applied"}</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded border p-2"><div className="text-muted-foreground">Rows parsed</div><div className="text-base font-semibold">{report.rowsParsed}</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground">Matched to staff</div><div className="text-base font-semibold">{report.rowsMatched}</div></div>
                <div className="rounded border p-2"><div className="text-muted-foreground">With salary</div><div className="text-base font-semibold">{report.rowsWithSalary}</div></div>
              </div>
              {!report.dryRun && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded border p-2"><div className="text-muted-foreground">History rows inserted</div><div className="text-base font-semibold text-green-600">{report.salaryHistoryInserted}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground">Current salaries set</div><div className="text-base font-semibold text-green-600">{report.salaryCurrentUpdated}</div></div>
                  <div className="rounded border p-2"><div className="text-muted-foreground">Skipped duplicates</div><div className="text-base font-semibold text-amber-600">{report.skippedDuplicates?.length ?? 0}</div></div>
                </div>
              )}

              {report.unmatchedNames?.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Unmatched names ({report.unmatchedNames.length}):</div>
                  <div className="text-[11px] flex flex-wrap gap-1">
                    {report.unmatchedNames.map((n: string) => (
                      <span key={n} className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{n}</span>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">Add them via "Add staff" first, then re-run.</p>
                </div>
              )}

              {report.sheets?.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Sheets scanned</div>
                  <div className="space-y-1">
                    {report.sheets.map((s: any) => (
                      <div key={s.sheet} className="text-[11px] rounded border p-2">
                        <div className="font-medium">{s.sheet} <span className="text-muted-foreground font-normal">· {s.rowsParsed} rows</span></div>
                        <div className="text-muted-foreground">Columns: {Object.entries(s.columnMap).map(([role, idx]: any) => `${role}=${s.headers[idx] || `#${idx}`}`).join(", ") || "none recognised"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.sample?.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Sample of mapped rows</div>
                  <table className="w-full text-[11px] border">
                    <thead className="bg-muted/50"><tr><th className="text-left p-1">Name</th><th className="text-left p-1">Salary</th><th className="text-left p-1">Date</th><th className="text-left p-1">Bonus</th><th className="text-left p-1">Comm</th></tr></thead>
                    <tbody>
                      {report.sample.map((s: any, i: number) => (
                        <tr key={i} className="border-t"><td className="p-1">{s.staffName}</td><td className="p-1">{s.salary || "—"}</td><td className="p-1">{s.effectiveDate || "—"}</td><td className="p-1">{s.bonus || "—"}</td><td className="p-1">{s.commission || "—"}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Close</Button>
          <Button variant="outline" onClick={() => previewMutation.mutate()} disabled={!shareUrl.trim() || previewMutation.isPending} data-testid="button-import-preview">
            {previewMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Preview
          </Button>
          <Button onClick={() => applyMutation.mutate()} disabled={!shareUrl.trim() || applyMutation.isPending || !report?.rowsMatched} data-testid="button-import-apply">
            {applyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Import for real
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [location] = useLocation();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [initialTab, setInitialTab] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [importSalariesOpen, setImportSalariesOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"org" | "grid">("org");

  // Honour ?person=:id (and optional &tab=:name) from the URL — links from
  // the You panel set both so 'My Card & Expenses' lands on the right tab.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const personId = params.get("person");
    const tab = params.get("tab") || undefined;
    if (personId) setSelectedUserId(personId);
    setInitialTab(tab);
  }, [location]);

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
          onBack={() => { setSelectedUserId(null); setInitialTab(undefined); }}
          initialTab={initialTab}
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
              <Button size="sm" variant="outline" className="h-8" onClick={() => setImportSalariesOpen(true)} data-testid="button-import-salaries">
                <Upload className="w-3.5 h-3.5 mr-1.5" /> Import salaries
              </Button>
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
          <TabsTrigger value="my-tasks">My Tasks</TabsTrigger>
          <TabsTrigger value="benefits">Benefits</TabsTrigger>
          <TabsTrigger value="marketing">Marketing</TabsTrigger>
          {isAdmin && <TabsTrigger value="holidays">Holiday approvals</TabsTrigger>}
          <TabsTrigger value="policies">Policies</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <HrOverview onSelectPerson={(id) => setSelectedUserId(id)} />
        </TabsContent>

        <TabsContent value="my-tasks">
          <Suspense fallback={<div className="flex items-center justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}>
            <TasksPage />
          </Suspense>
        </TabsContent>

        <TabsContent value="benefits">
          <BenefitsTab />
        </TabsContent>

        <TabsContent value="marketing">
          <MarketingHub isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="holidays">
          <div className="pb-6"><HolidayApprovals /></div>
        </TabsContent>

        <TabsContent value="policies">
          <div className="pb-6"><PoliciesPanel isAdmin={isAdmin} /></div>
        </TabsContent>
      </Tabs>

      {isAdmin && <AddStaffDialog allStaff={allStaff} open={addStaffOpen} onClose={() => setAddStaffOpen(false)} />}
      {isAdmin && <ImportSalariesDialog open={importSalariesOpen} onClose={() => setImportSalariesOpen(false)} />}
    </div>
  );
}
