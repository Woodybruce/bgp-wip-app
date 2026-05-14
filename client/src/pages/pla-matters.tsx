/**
 * PLA Matters — list + create. The Lease Advisory platform's main page.
 *
 * Tom and Pete's workbench: every active rent review, lease renewal,
 * dilapidations, service charge and general advisory matter, anchored to
 * a canonical property via the Property Resolver. New matters are created
 * by typing an address into the resolver bar — once the property's picked,
 * the matter inherits canonical identity and the Lease Advisory folder
 * template gets applied in SharePoint.
 */

import { useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Scale, Calendar as CalendarIcon, MapPin, Loader2, X, FileText } from "lucide-react";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PropertyResolverBar } from "@/components/property-resolver-bar";
import { PropertyImageryPicker } from "@/components/property-imagery-picker";
import { InlineNumber, InlineDate } from "@/components/inline-edit";
import type { PlaMatter, CrmComp } from "@shared/schema";

const MATTER_TYPES: Array<{ value: string; label: string }> = [
  { value: "rent_review", label: "Rent Review" },
  { value: "lease_renewal", label: "Lease Renewal" },
  { value: "dilapidations", label: "Dilapidations" },
  { value: "service_charge", label: "Service Charge" },
  { value: "general", label: "General Advisory" },
];

// Lease advisory now shares the standard deal lifecycle codes — same picker
// as Letting Tracker and Deal CRM. AVA / SPEC / LIVE / INV don't really
// apply to lease advisory work but the codes are shared so the boards stay
// consistent. Legacy values (open/in_negotiation/...) accepted on read.
const LEASE_ADVISORY_STATUSES: Array<{ value: string; label: string; color: string }> = [
  { value: "REP", label: "Instructed",   color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  { value: "NEG", label: "Negotiating",  color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  { value: "SOL", label: "Solicitors",   color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  { value: "EXC", label: "Exchanged",    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  { value: "COM", label: "Completed",    color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  { value: "WIT", label: "Withdrawn",    color: "bg-zinc-100 text-zinc-500 dark:bg-zinc-900/30 dark:text-zinc-500" },
];

// Legacy-status aliases — old rows that haven't been remapped yet still
// resolve to a label so the table doesn't render raw "in_negotiation" text.
const LEGACY_STATUS_LABELS: Record<string, string> = {
  open: "Instructed",
  in_negotiation: "Negotiating",
  agreed: "Exchanged",
  settled: "Completed",
  closed: "Withdrawn",
  on_hold: "Instructed",
};

const STATUSES = LEASE_ADVISORY_STATUSES;

function statusBadge(status: string | null | undefined) {
  const s = LEASE_ADVISORY_STATUSES.find((x) => x.value === status);
  if (s) return <Badge className={s.color} variant="secondary">{s.label}</Badge>;
  const legacy = status ? LEGACY_STATUS_LABELS[status] : null;
  return legacy ? <Badge variant="outline">{legacy}</Badge> : <Badge variant="outline">{status}</Badge>;
}

function typeLabel(t: string) {
  return MATTER_TYPES.find((m) => m.value === t)?.label || t;
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}

/** Pull the most relevant upcoming date from the matter row for the table. */
function nextKeyDate(m: PlaMatter): { label: string; date: Date } | null {
  const candidates: Array<{ label: string; date: Date | null }> = [
    { label: "Counter notice", date: toDate(m.counterNoticeDeadline) },
    { label: "Review", date: toDate(m.currentRentReviewDate) },
    { label: "Break", date: toDate(m.breakDate) },
    { label: "Expiry", date: toDate(m.expiryDate) },
  ];
  const future = candidates
    .filter((c): c is { label: string; date: Date } => !!c.date && c.date.getTime() > Date.now())
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return future[0] || null;
}
function toDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export default function PlaMattersPage() {
  const [matchDetail, params] = useRoute("/pla/matters/:id");
  if (matchDetail && params?.id) {
    return <MatterDetailView id={params.id} />;
  }
  return <MatterListView />;
}

function MatterListView() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: matters = [], isLoading } = useQuery<PlaMatter[]>({
    queryKey: ["/api/pla/matters", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "active") {
        if (statusFilter === "all") params.set("includeClosed", "true");
        else params.set("status", statusFilter);
      }
      const res = await fetch(`/api/pla/matters?${params}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    let rows = matters;
    if (typeFilter !== "all") rows = rows.filter((m) => m.matterType === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((m) =>
        (m.notes || "").toLowerCase().includes(q) ||
        (m.tags || []).some((t) => t.toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [matters, typeFilter, search]);

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="border-b bg-background sticky top-0 z-10 px-4 lg:px-6 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Lease Advisory</h1>
            <Badge variant="outline" className="text-xs">{filtered.length} instructions</Badge>
          </div>
          <Button onClick={() => setCreateOpen(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" /> New Instruction
          </Button>
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes / tags…"
            className="max-w-xs"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active (default)</SelectItem>
              <SelectItem value="all">All including closed</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {MATTER_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 lg:p-6">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="p-12 text-center text-muted-foreground">
            <Scale className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium mb-1">No instructions {statusFilter !== "all" ? `with status "${statusFilter}"` : "yet"}</p>
            <p className="text-sm">Click "New Instruction" to start one — anchor it to a property via the resolver.</p>
          </CardContent></Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Acting for</TableHead>
                  <TableHead>Next date</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m) => {
                  const next = nextKeyDate(m);
                  return (
                    <TableRow
                      key={m.id}
                      className="cursor-pointer hover:bg-accent"
                      onClick={() => navigate(`/pla/matters/${m.id}`)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2 min-w-0">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <Link to={`/properties/${m.propertyId}`} className="truncate hover:underline" onClick={(e) => e.stopPropagation()}>
                            {m.propertyId.slice(0, 8)}…
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell>{typeLabel(m.matterType)}</TableCell>
                      <TableCell>{statusBadge(m.status)}</TableCell>
                      <TableCell className="capitalize">{m.actingFor || "—"}</TableCell>
                      <TableCell>
                        {next ? (
                          <span className="flex items-center gap-1.5 text-sm">
                            <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            {next.label} · {formatDate(next.date)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(m.updatedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <NewMatterDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(matterId) => {
          setCreateOpen(false);
          queryClient.invalidateQueries({ queryKey: ["/api/pla/matters"] });
          navigate(`/pla/matters/${matterId}`);
        }}
      />
    </div>
  );
}

// ─── New Matter dialog ───────────────────────────────────────────────────────

function NewMatterDialog({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { toast } = useToast();
  const [property, setProperty] = useState<{ id: string; name: string; postcode: string | null } | null>(null);
  const [unitId, setUnitId] = useState<string>("");
  const [matterType, setMatterType] = useState<string>("rent_review");
  const [actingFor, setActingFor] = useState<string>("landlord");
  const [notes, setNotes] = useState("");

  // Pull units for the chosen property — picker shows only after the resolver
  // gives us a propertyId. Required for unit-level matter types.
  const { data: propertyUnits = [] } = useQuery<Array<{ id: string; unitName: string; propertyId: string }>>({
    queryKey: ["/api/property-units", property?.id],
    queryFn: async () => {
      if (!property?.id) return [];
      const r = await fetch(`/api/property-units?propertyId=${encodeURIComponent(property.id)}`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!property?.id,
  });
  const UNIT_REQUIRED_TYPES = new Set(["rent_review", "lease_renewal", "regear", "dilapidations", "service_charge"]);
  const unitRequired = UNIT_REQUIRED_TYPES.has(matterType);

  const create = useMutation({
    mutationFn: async () => {
      if (!property) throw new Error("pick a property first");
      const res = await fetch("/api/pla/matters", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          propertyId: property.id,
          matterType,
          actingFor,
          unitId: unitId || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "create failed");
      return res.json() as Promise<PlaMatter>;
    },
    onSuccess: (m) => {
      toast({ title: "Instruction created", description: typeLabel(m.matterType) });
      setProperty(null);
      setUnitId("");
      setNotes("");
      onCreated(m.id);
    },
    onError: (err: any) => toast({ title: "Couldn't create instruction", description: err?.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Instruction</DialogTitle>
          <DialogDescription>
            Anchor this instruction to a canonical property — type any address, postcode, UPRN or title number and the resolver will pick it up.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2 min-w-0">
          <div className="min-w-0">
            <label className="text-sm font-medium block mb-2">Property</label>
            <PropertyResolverBar
              current={property}
              onResolve={(id, prop) => { setProperty({ id, name: prop.name, postcode: prop.postcode }); setUnitId(""); }}
            />
          </div>
          {property && (
            <div className="min-w-0">
              <label className="text-sm font-medium block mb-2">Unit{unitRequired ? " *" : " (optional)"}</label>
              <Select value={unitId || undefined} onValueChange={(v) => setUnitId(v === "__clear__" ? "" : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={propertyUnits.length === 0 ? "No units on this property yet" : "Pick unit"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__clear__">None</SelectItem>
                  {propertyUnits.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.unitName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {unitRequired && !unitId && (
                <p className="text-[11px] text-rose-600 mt-1">{typeLabel(matterType)} requires a unit on this property.</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
            <div className="min-w-0">
              <label className="text-sm font-medium block mb-2">Instruction type</label>
              <Select value={matterType} onValueChange={setMatterType}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MATTER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <label className="text-sm font-medium block mb-2">Acting for</label>
              <Select value={actingFor} onValueChange={setActingFor}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="landlord">Landlord</SelectItem>
                  <SelectItem value="tenant">Tenant</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="min-w-0">
            <label className="text-sm font-medium block mb-2">Notes <span className="text-muted-foreground font-normal">(optional)</span></label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Brief description of the instruction…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!property || (unitRequired && !unitId) || create.isPending}>
            {create.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Create instruction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Matter detail view ──────────────────────────────────────────────────────

type MatterDetailResponse = {
  matter: PlaMatter;
  comps: Array<{ matterId: string; compId: string; weight: number; notes: string | null; addedBy: string | null; addedAt: string }>;
  events: Array<{ id: string; matterId: string; eventKind: string; eventDate: string; description: string | null; done: boolean; doneAt: string | null }>;
  workbooks: Array<{ id: string; matterId: string; kind: string; sharepointUrl: string | null; generatedAt: string }>;
};

function MatterDetailView({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [addEventOpen, setAddEventOpen] = useState(false);

  const [linkCompOpen, setLinkCompOpen] = useState(false);
  const [netEffectiveOpen, setNetEffectiveOpen] = useState(false);
  const [itzaOpen, setItzaOpen] = useState(false);
  const [devaluationOpen, setDevaluationOpen] = useState(false);
  const [briefsOpen, setBriefsOpen] = useState(false);

  // SOL-promotion gate — same rules as Letting Tracker. Status change to SOL
  // requires Tenant + Fee + Agent (hard) and Fee Agreement + AML (soft, override).
  const [solOpen, setSolOpen] = useState(false);
  const [solForm, setSolForm] = useState({
    tenantName: "",
    fee: "",
    agent: "",
    feeAgreement: "",
    amlChecked: "",
    overrideCompliance: false,
  });

  const { data, isLoading, refetch } = useQuery<MatterDetailResponse>({
    queryKey: ["/api/pla/matters", id],
    queryFn: async () => {
      const res = await fetch(`/api/pla/matters/${id}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      return res.json();
    },
  });

  const updateField = useMutation({
    mutationFn: async (patch: Partial<PlaMatter>) => {
      const res = await fetch(`/api/pla/matters/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("update failed");
      return res.json();
    },
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/pla/matters"] });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err?.message, variant: "destructive" }),
  });

  const closeMatter = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pla/matters/${id}`, {
        method: "DELETE", credentials: "include", headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("close failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Instruction closed" });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/pla/matters"] });
    },
  });

  if (isLoading) {
    return <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  }
  if (!data) {
    return <div className="p-6 text-center text-muted-foreground">Instruction not found.</div>;
  }
  const { matter, comps, events, workbooks } = data;

  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="border-b bg-background sticky top-0 z-10 px-4 lg:px-6 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => navigate("/pla/matters")}>← Back</Button>
          <Scale className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">{typeLabel(matter.matterType)}</h1>
          <Badge variant="outline" className="capitalize">Acting for {matter.actingFor || "—"}</Badge>
          <Select
            value={matter.status}
            onValueChange={(v) => {
              if (v === "SOL" && matter.status !== "SOL") {
                setSolForm({
                  tenantName: "",
                  fee: "",
                  agent: matter.leadUserId || "",
                  feeAgreement: "",
                  amlChecked: "",
                  overrideCompliance: false,
                });
                setSolOpen(true);
                return;
              }
              updateField.mutate({ status: v } as any);
            }}
          >
            <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setBriefsOpen(true)} className="gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Generate document
            </Button>
            {matter.sharepointFolderUrl ? (
              <Button variant="outline" size="sm" asChild>
                <a href={matter.sharepointFolderUrl} target="_blank" rel="noreferrer">SharePoint folder</a>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const r = await fetch(`/api/pla/matters/${id}/apply-folder-template`, {
                    method: "POST", credentials: "include", headers: getAuthHeaders(),
                  });
                  if (r.ok) {
                    toast({ title: "Folder template applied" });
                    refetch();
                  } else {
                    const e = await r.json().catch(() => null);
                    toast({ title: "Couldn't apply folder template", description: e?.error || `${r.status}`, variant: "destructive" });
                  }
                }}
              >
                Apply folder template
              </Button>
            )}
            {matter.status !== "closed" && (
              <Button variant="outline" size="sm" onClick={() => closeMatter.mutate()}>Close instruction</Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-6 max-w-5xl mx-auto w-full">
        {/* Property */}
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground mb-1">Property</div>
          <Link to={`/properties/${matter.propertyId}`} className="font-medium hover:underline flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            {matter.propertyId.slice(0, 8)}…
          </Link>
        </CardContent></Card>

        {/* Negotiation positions */}
        <Card><CardContent className="p-4">
          <div className="text-sm font-medium mb-3">Negotiation <span className="text-xs text-muted-foreground font-normal">(click any value to edit)</span></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MoneyField label="Current rent"   value={matter.currentRent}        onSave={(v) => updateField.mutate({ currentRent: v } as any)} />
            <MoneyField label="Our quoting"    value={matter.quotingRent}        onSave={(v) => updateField.mutate({ quotingRent: v } as any)} />
            <MoneyField label="Their counter"  value={matter.counterQuotingRent} onSave={(v) => updateField.mutate({ counterQuotingRent: v } as any)} />
            <MoneyField label="Agreed"         value={matter.agreedRent}         onSave={(v) => updateField.mutate({ agreedRent: v } as any)} highlight />
          </div>
        </CardContent></Card>

        {/* Key dates */}
        <Card><CardContent className="p-4">
          <div className="text-sm font-medium mb-3">Key dates</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <DateField label="Review"           value={matter.currentRentReviewDate} onSave={(v) => updateField.mutate({ currentRentReviewDate: v } as any)} />
            <DateField label="Break"            value={matter.breakDate}             onSave={(v) => updateField.mutate({ breakDate: v } as any)} />
            <DateField label="Expiry"           value={matter.expiryDate}            onSave={(v) => updateField.mutate({ expiryDate: v } as any)} />
            <DateField label="Notice served"    value={matter.noticeServedAt}        onSave={(v) => updateField.mutate({ noticeServedAt: v } as any)} />
            <DateField label="Counter deadline" value={matter.counterNoticeDeadline} onSave={(v) => updateField.mutate({ counterNoticeDeadline: v } as any)} highlight={isUpcoming(matter.counterNoticeDeadline)} />
            <DateField label="Counter served"   value={matter.counterNoticeServedAt} onSave={(v) => updateField.mutate({ counterNoticeServedAt: v } as any)} />
            <DateField label="Settled"          value={matter.settledAt}             readOnly />
            <DateField label="Opened"           value={matter.openedAt}              readOnly />
          </div>
        </CardContent></Card>

        {/* Comps */}
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium">Linked comparables · {comps.length}</div>
            <Button variant="outline" size="sm" onClick={() => setLinkCompOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Link comp
            </Button>
          </div>
          {comps.length === 0 ? (
            <div className="text-sm text-muted-foreground">None linked yet — comps drive the valuation engine when it lands.</div>
          ) : (
            <CompLinkRows
              compIds={comps.map((c) => ({ compId: c.compId, weight: c.weight }))}
              matterId={id}
              onChange={() => refetch()}
            />
          )}
        </CardContent></Card>

        {/* Events / timeline */}
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium">Events · {events.length}</div>
            <Button variant="outline" size="sm" onClick={() => setAddEventOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add event
            </Button>
          </div>
          {events.length === 0 ? (
            <div className="text-sm text-muted-foreground">No events logged.</div>
          ) : (
            <div className="space-y-1">
              {events.map((e) => (
                <EventRow key={e.id} event={e} matterId={id} onChange={() => refetch()} />
              ))}
            </div>
          )}
        </CardContent></Card>

        {/* Workbooks */}
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-sm font-medium">Valuation workbooks · {workbooks.length}</div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => setNetEffectiveOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Net Effective
              </Button>
              <Button variant="outline" size="sm" onClick={() => setItzaOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> ITZA
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDevaluationOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Devaluation
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={comps.length === 0}
                title={comps.length === 0 ? "Link at least one comp first" : ""}
                onClick={async () => {
                  const res = await fetch(`/api/pla/matters/${id}/valuation/comparables-schedule`, {
                    method: "POST", credentials: "include", headers: getAuthHeaders(),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    toast({ title: "Schedule generated", description: `${data.rowCount} comps · uploading to SharePoint` });
                    refetch();
                  } else {
                    const e = await res.json().catch(() => null);
                    toast({ title: "Couldn't generate schedule", description: e?.error || `${res.status}`, variant: "destructive" });
                  }
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Schedule of Comps
              </Button>
            </div>
          </div>
          {workbooks.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No valuations run yet. Click "Run Net Effective" — straight-line amortisation
              of rent free + capex over the assumed term, mirroring BGP's Net Effective Template.
            </div>
          ) : (
            <div className="space-y-1">
              {workbooks.map((w) => (
                <WorkbookRow key={w.id} workbook={w as any} />
              ))}
            </div>
          )}
        </CardContent></Card>

        {/* Imagery — hero + location plan + floor plan, drives RR reps and dilapidations cover */}
        <Card><CardContent className="p-4">
          <PropertyImageryPicker
            propertyId={matter.propertyId}
            matterId={id}
            kinds={["hero", "secondary_external", "location_plan", "floor_plan", "comps_chart"]}
          />
        </CardContent></Card>

        {/* Related Pathway runs — same property */}
        <RelatedPathwayRuns propertyId={matter.propertyId} />

        {/* Notes */}
        <Card><CardContent className="p-4">
          <div className="text-sm font-medium mb-2">Notes</div>
          <Input
            defaultValue={matter.notes || ""}
            placeholder="Internal notes…"
            onBlur={(e) => {
              if (e.target.value !== (matter.notes || "")) {
                updateField.mutate({ notes: e.target.value });
              }
            }}
          />
        </CardContent></Card>
      </div>

      <AddEventDialog
        open={addEventOpen}
        onClose={() => setAddEventOpen(false)}
        matterId={id}
        onCreated={() => { setAddEventOpen(false); refetch(); }}
      />
      <CompLinkerDialog
        open={linkCompOpen}
        onClose={() => setLinkCompOpen(false)}
        matterId={id}
        existingCompIds={new Set(comps.map((c) => c.compId))}
        onLinked={() => { setLinkCompOpen(false); refetch(); }}
      />
      <DocumentBriefsDialog
        open={briefsOpen}
        onClose={() => setBriefsOpen(false)}
        propertyId={matter.propertyId}
        matterId={id}
      />
      <NetEffectiveDialog
        open={netEffectiveOpen}
        onClose={() => setNetEffectiveOpen(false)}
        matterId={id}
        defaults={{
          headlineRentPa: matter.quotingRent ?? matter.currentRent ?? null,
          termYears: matter.expiryDate && matter.openedAt
            ? Math.max(1, Math.round((new Date(matter.expiryDate).getTime() - new Date(matter.openedAt).getTime()) / (365.25 * 24 * 60 * 60 * 1000)))
            : 10,
        }}
        onComputed={() => { setNetEffectiveOpen(false); refetch(); }}
      />
      <ItzaDialog
        open={itzaOpen}
        onClose={() => setItzaOpen(false)}
        matterId={id}
        onComputed={() => { setItzaOpen(false); refetch(); }}
      />
      <DevaluationDialog
        open={devaluationOpen}
        onClose={() => setDevaluationOpen(false)}
        matterId={id}
        defaults={{ annualRentPa: matter.currentRent ?? null }}
        onComputed={() => { setDevaluationOpen(false); refetch(); }}
      />

      {/* SOL promotion — same hard/soft gates as Letting Tracker. Updates the
          backing crm_deals row and flips the matter status. Override + audit
          mirror the leasing side. */}
      <Dialog open={solOpen} onOpenChange={(o) => !o && setSolOpen(false)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Promote to Solicitors</DialogTitle>
            <DialogDescription>
              Capture the deal-handover info — fee, counter-party and compliance — before this instruction goes to solicitors.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1">Counter-party *</Label>
                <Input
                  value={solForm.tenantName}
                  onChange={e => setSolForm(f => ({ ...f, tenantName: e.target.value }))}
                  placeholder="Tenant / landlord name"
                />
              </div>
              <div>
                <Label className="text-xs mb-1">Fee (£) *</Label>
                <Input
                  type="number"
                  value={solForm.fee}
                  onChange={e => setSolForm(f => ({ ...f, fee: e.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1">Lead BGP agent *</Label>
                <Input
                  value={solForm.agent}
                  onChange={e => setSolForm(f => ({ ...f, agent: e.target.value }))}
                  placeholder="User ID"
                />
              </div>
              <div>
                <Label className="text-xs mb-1">Fee Agreement signed</Label>
                <Select value={solForm.feeAgreement} onValueChange={v => setSolForm(f => ({ ...f, feeAgreement: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YES">YES</SelectItem>
                    <SelectItem value="NO">NO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1">AML / KYC checked</Label>
              <Select value={solForm.amlChecked} onValueChange={v => setSolForm(f => ({ ...f, amlChecked: v }))}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="YES">YES</SelectItem>
                  <SelectItem value="NO">NO</SelectItem>
                  <SelectItem value="N-A">N/A</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {(() => {
            const hardMissing: string[] = [];
            if (!solForm.tenantName.trim()) hardMissing.push("Counter-party");
            if (!solForm.fee.trim()) hardMissing.push("Fee");
            if (!solForm.agent.trim()) hardMissing.push("Lead agent");
            const softMissing: string[] = [];
            if (solForm.feeAgreement !== "YES") softMissing.push("Fee agreement signed");
            if (solForm.amlChecked !== "YES" && solForm.amlChecked !== "N-A") softMissing.push("AML / KYC checked");
            const canSubmit = hardMissing.length === 0 && (softMissing.length === 0 || solForm.overrideCompliance);
            const submit = async () => {
              if (!matter.dealId) {
                toast({ title: "No linked deal — can't promote", variant: "destructive" });
                return;
              }
              try {
                // Update the linked deal with the SOL handover fields.
                await fetch(`/api/crm/deals/${matter.dealId}`, {
                  method: "PATCH",
                  credentials: "include",
                  headers: { "content-type": "application/json", ...getAuthHeaders() },
                  body: JSON.stringify({
                    status: "SOL",
                    fee: parseFloat(solForm.fee),
                    internalAgent: [solForm.agent],
                    feeAgreement: solForm.feeAgreement || null,
                    amlCheckCompleted: solForm.amlChecked || null,
                    comments: solForm.tenantName ? `Counter-party: ${solForm.tenantName}` : undefined,
                  }),
                });
                // Flip the matter status.
                updateField.mutate({ status: "SOL" } as any);
                // Log compliance override if applicable.
                if (solForm.overrideCompliance && softMissing.length > 0) {
                  await fetch(`/api/deal-compliance-audit`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "content-type": "application/json", ...getAuthHeaders() },
                    body: JSON.stringify({
                      dealId: matter.dealId,
                      missingFields: softMissing.map(s => s.toLowerCase().replace(/[^a-z]+/g, "_")),
                      targetStatus: "SOL",
                    }),
                  }).catch(() => {});
                }
                setSolOpen(false);
                toast({ title: "Promoted to Solicitors" });
              } catch (err: any) {
                toast({ title: "Couldn't promote", description: err?.message, variant: "destructive" });
              }
            };
            return (
              <>
                {(hardMissing.length > 0 || softMissing.length > 0) && (
                  <div className="rounded-md border p-2 bg-amber-50 dark:bg-amber-900/10 mt-2 space-y-1.5">
                    {hardMissing.length > 0 && (
                      <p className="text-xs text-rose-700 dark:text-rose-400">Required before saving: {hardMissing.join(", ")}</p>
                    )}
                    {hardMissing.length === 0 && softMissing.length > 0 && (
                      <>
                        <p className="text-xs text-amber-700 dark:text-amber-400">Missing compliance: {softMissing.join(", ")}</p>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={solForm.overrideCompliance}
                            onChange={e => setSolForm(f => ({ ...f, overrideCompliance: e.target.checked }))}
                          />
                          <span>Promote anyway — I'll complete these before exchange</span>
                        </label>
                      </>
                    )}
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setSolOpen(false)}>Cancel</Button>
                  <Button onClick={submit} disabled={!canSubmit}>Promote to Solicitors</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkbookRow({ workbook }: { workbook: { id: string; kind: string; sharepointUrl: string | null; generatedAt: string; outputSummary: any; inputsSnapshot: any } }) {
  const [open, setOpen] = useState(false);
  const summary = workbook.outputSummary || {};
  const headlineBadge = (() => {
    if (workbook.kind === "net_effective" && summary.netEffectivePsf != null) return `£${summary.netEffectivePsf} psf NE`;
    if (workbook.kind === "itza" && summary.itzaSqft != null) return `${summary.itzaSqft} sq ft ITZA`;
    if (workbook.kind === "devaluation" && summary.zoneARatePsfItza != null) return `£${summary.zoneARatePsfItza} psf Zone A`;
    if (workbook.kind === "comparables_schedule" && summary.rowCount != null) return `${summary.rowCount} comps`;
    return null;
  })();
  return (
    <div className="border-b border-border last:border-0 py-2">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between text-left text-sm hover:bg-accent rounded px-1 py-1">
        <div className="flex items-center gap-3">
          <span className="font-medium capitalize">{(workbook.kind || "").replace(/_/g, " ")}</span>
          {headlineBadge && <Badge variant="secondary">{headlineBadge}</Badge>}
          {summary.discountPct != null && workbook.kind === "net_effective" && (
            <Badge variant="outline">{summary.discountPct}% off headline</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatDate(workbook.generatedAt)}</span>
          {workbook.sharepointUrl && <a onClick={(e) => e.stopPropagation()} href={workbook.sharepointUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open</a>}
        </div>
      </button>
      {open && (
        <div className="text-xs text-muted-foreground mt-2 grid grid-cols-3 gap-2 px-1 pb-1">
          {workbook.kind === "net_effective" && (
            <>
              <Stat label="Headline psf" value={summary.headlinePsf} prefix="£" />
              <Stat label="Net effective psf" value={summary.netEffectivePsf} prefix="£" />
              <Stat label="Total incentive" value={summary.totalIncentive} prefix="£" thousands />
              <Stat label="Effective annual" value={summary.effectiveAnnualPa} prefix="£" thousands />
              <Stat label="Effective total" value={summary.effectiveTotal} prefix="£" thousands />
              <Stat label="Discount" value={summary.discountPct} suffix="%" />
            </>
          )}
          {workbook.kind === "itza" && (
            <>
              <Stat label="ITZA sq ft" value={summary.itzaSqft} thousands />
              <Stat label="Basement ITZA" value={summary.basementItza} thousands />
              <Stat label="Ancillary ITZA" value={summary.ancillaryItza} thousands />
            </>
          )}
          {workbook.kind === "devaluation" && (
            <Stat label="Zone A psf (ITZA)" value={summary.zoneARatePsfItza} prefix="£" />
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, prefix, suffix, thousands }: { label: string; value: any; prefix?: string; suffix?: string; thousands?: boolean }) {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!isFinite(n)) return null;
  const display = thousands ? n.toLocaleString("en-GB") : n.toString();
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium text-foreground">{prefix}{display}{suffix}</div>
    </div>
  );
}

function NetEffectiveDialog({
  open, onClose, matterId, defaults, onComputed,
}: {
  open: boolean; onClose: () => void; matterId: string;
  defaults: { headlineRentPa: number | null; termYears: number };
  onComputed: () => void;
}) {
  const { toast } = useToast();
  const [areaSqft, setAreaSqft] = useState("");
  const [headlineRentPa, setHeadlineRentPa] = useState(defaults.headlineRentPa?.toString() || "");
  const [termYears, setTermYears] = useState(String(defaults.termYears || 10));
  const [rentFreeMonths, setRentFreeMonths] = useState("");
  const [capex, setCapex] = useState("");
  const [result, setResult] = useState<any | null>(null);

  const compute = async () => {
    setResult(null);
    const res = await fetch(`/api/pla/matters/${matterId}/valuation/net-effective`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        areaSqft: Number(areaSqft) || 0,
        headlineRentPa: Number(headlineRentPa) || 0,
        termYears: Number(termYears) || 10,
        rentFreeMonths: Number(rentFreeMonths) || 0,
        capexContribution: Number(capex) || 0,
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => null);
      toast({ title: "Couldn't run Net Effective", description: e?.error || `${res.status}`, variant: "destructive" });
      return;
    }
    const data = await res.json();
    setResult(data);
    toast({ title: "Net Effective saved", description: `£${data.output.netEffectivePsf} psf` });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Run Net Effective</DialogTitle>
          <DialogDescription>
            Straight-line amortisation of rent free + capex over the assumed term —
            same approach as the BGP Net Effective template.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium block mb-1.5">Area (sq ft)</label>
              <Input type="number" value={areaSqft} onChange={(e) => setAreaSqft(e.target.value)} placeholder="e.g. 1500" />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Headline rent £ p.a.</label>
              <Input type="number" value={headlineRentPa} onChange={(e) => setHeadlineRentPa(e.target.value)} placeholder="e.g. 75000" />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Term (years)</label>
              <Input type="number" value={termYears} onChange={(e) => setTermYears(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Rent-free (months)</label>
              <Input type="number" value={rentFreeMonths} onChange={(e) => setRentFreeMonths(e.target.value)} placeholder="0" />
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium block mb-1.5">Capex contribution (£)</label>
              <Input type="number" value={capex} onChange={(e) => setCapex(e.target.value)} placeholder="0 — optional landlord contribution" />
            </div>
          </div>
          {result && (
            <div className="border rounded p-3 bg-muted/40 text-sm space-y-1">
              <div className="font-medium mb-1">Result</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>Net effective: <span className="font-semibold">£{result.output.netEffectivePsf} psf</span></div>
                <div>Headline: £{result.output.headlinePsf} psf</div>
                <div>Effective annual: £{result.output.effectiveAnnualPa.toLocaleString("en-GB")}</div>
                <div>Total incentive: £{result.output.totalIncentive.toLocaleString("en-GB")}</div>
                <div className="col-span-2 text-muted-foreground">{result.output.discountPct}% discount to headline · saved to workbook</div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={compute} disabled={!areaSqft || !headlineRentPa}>
            {result ? "Re-run" : "Compute"}
          </Button>
          {result && <Button onClick={() => { onComputed(); }}>Save & close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isUpcoming(d: any): boolean {
  const date = toDate(d);
  if (!date) return false;
  const ms = date.getTime() - Date.now();
  return ms > 0 && ms < 30 * 24 * 60 * 60 * 1000; // within 30 days
}

function MoneyField({ label, value, onSave, highlight }: {
  label: string; value: number | null | undefined; onSave: (v: number | null) => void; highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-medium ${highlight ? "text-amber-700 dark:text-amber-400" : ""}`}>
        <InlineNumber
          value={value ?? null}
          onSave={(v) => onSave(v)}
          prefix="£"
          format={(v) => v.toLocaleString("en-GB")}
          placeholder="—"
        />
      </div>
    </div>
  );
}

function DateField({ label, value, onSave, highlight, readOnly }: {
  label: string;
  value: any;
  onSave?: (v: string | null) => void;
  highlight?: boolean;
  readOnly?: boolean;
}) {
  const iso = value ? (typeof value === "string" ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10)) : null;
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-medium ${highlight ? "text-amber-700 dark:text-amber-400" : ""}`}>
        {readOnly || !onSave ? (
          <span>{formatDate(value)}</span>
        ) : (
          <InlineDate value={iso} onSave={(v) => onSave(v)} placeholder="—" />
        )}
      </div>
    </div>
  );
}

function EventRow({
  event, matterId, onChange,
}: { event: { id: string; eventKind: string; eventDate: string; description: string | null; done: boolean }; matterId: string; onChange: () => void }) {
  const toggle = async () => {
    await fetch(`/api/pla/matters/${matterId}/events/${event.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ done: !event.done }),
    });
    onChange();
  };
  return (
    <div className="flex items-center gap-3 text-sm py-1.5 border-b border-border last:border-0">
      <input type="checkbox" checked={event.done} onChange={toggle} className="cursor-pointer" />
      <span className={event.done ? "line-through text-muted-foreground" : ""}>
        <span className="font-medium capitalize">{event.eventKind.replace(/_/g, " ")}</span>
        {event.description && <span className="text-muted-foreground"> — {event.description}</span>}
      </span>
      <span className="ml-auto text-xs text-muted-foreground">{formatDate(event.eventDate)}</span>
    </div>
  );
}

// ─── Comp linker ─────────────────────────────────────────────────────────────

function compAddress(c: CrmComp): string {
  if (typeof c.address === "string") return c.address;
  if (c.address && typeof c.address === "object") {
    const a = c.address as any;
    return a.formatted || a.line1 || a.address || a.text || c.name || "";
  }
  return c.name || "—";
}

function compRentLabel(c: CrmComp): string {
  // Show net effective if set, otherwise headline
  const ne = c.netEffectiveRent || c.effectiveRentPa;
  const hl = c.headlineRent || c.passingRentPa;
  const psf = c.zoneARatePsf || c.zoneARate || c.rentPsfOverall || c.overallRatePsf;
  const parts: string[] = [];
  if (ne) parts.push(`NE ${ne}`);
  else if (hl) parts.push(`HL ${hl}`);
  if (psf) parts.push(`${psf} psf`);
  return parts.join(" · ") || "—";
}

function CompLinkRows({
  compIds, matterId, onChange,
}: { compIds: Array<{ compId: string; weight: number }>; matterId: string; onChange: () => void }) {
  // Fetch the linked comps' details so we can show address/rent/etc instead of bare IDs
  const ids = compIds.map((c) => c.compId).join(",");
  const { data: comps = [] } = useQuery<CrmComp[]>({
    queryKey: ["/api/crm/comps", "for-pla", ids],
    enabled: compIds.length > 0,
    queryFn: async () => {
      const res = await fetch(`/api/crm/comps`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return [];
      const all = (await res.json()) as CrmComp[];
      const idSet = new Set(compIds.map((c) => c.compId));
      return all.filter((c) => idSet.has(c.id));
    },
  });
  const byId = new Map(comps.map((c) => [c.id, c]));

  const unlink = async (compId: string) => {
    await fetch(`/api/pla/matters/${matterId}/comps/${compId}`, {
      method: "DELETE", credentials: "include", headers: getAuthHeaders(),
    });
    onChange();
  };

  return (
    <div className="space-y-1">
      {compIds.map((row) => {
        const c = byId.get(row.compId);
        return (
          <div key={row.compId} className="flex items-center gap-3 text-sm py-1.5 border-b border-border last:border-0">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{c ? (c.name || compAddress(c)) : row.compId.slice(0, 8) + "…"}</div>
              {c && (
                <div className="text-xs text-muted-foreground flex gap-3">
                  {c.tenant && <span>{c.tenant}</span>}
                  {c.areaSqft && <span>{c.areaSqft} sq ft</span>}
                  <span>{compRentLabel(c)}</span>
                  {c.completionDate && <span>{c.completionDate}</span>}
                </div>
              )}
            </div>
            <Badge variant="outline" className="text-xs">weight {row.weight.toFixed(2)}</Badge>
            <Button variant="ghost" size="sm" onClick={() => unlink(row.compId)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function CompLinkerDialog({
  open, onClose, matterId, existingCompIds, onLinked,
}: { open: boolean; onClose: () => void; matterId: string; existingCompIds: Set<string>; onLinked: () => void }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data: allComps = [], isLoading } = useQuery<CrmComp[]>({
    queryKey: ["/api/crm/comps"],
    enabled: open,
    queryFn: async () => {
      const res = await fetch(`/api/crm/comps`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    const candidates = allComps.filter((c) => !existingCompIds.has(c.id));
    if (!search.trim()) return candidates.slice(0, 50);
    const q = search.toLowerCase();
    return candidates
      .filter((c) =>
        (c.name || "").toLowerCase().includes(q) ||
        compAddress(c).toLowerCase().includes(q) ||
        (c.tenant || "").toLowerCase().includes(q) ||
        (c.postcode || "").toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [allComps, search, existingCompIds]);

  const link = async (compId: string, weight: number) => {
    const res = await fetch(`/api/pla/matters/${matterId}/comps`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ compId, weight }),
    });
    if (!res.ok) {
      toast({ title: "Couldn't link comp", variant: "destructive" });
      return;
    }
    toast({ title: "Comp linked" });
    onLinked();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Link a comparable</DialogTitle>
          <DialogDescription>
            Pick from the comps schedule. Comp weighting (0–1) influences the valuation engine when it lands.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, address, tenant or postcode…"
            className="mb-3"
          />
          <div className="max-h-96 overflow-y-auto border rounded">
            {isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading comps…</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {search ? "No comps match." : "No comps available."}
              </div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => link(c.id, 1.0)}
                  className="w-full text-left p-3 border-b border-border last:border-0 hover:bg-accent transition flex items-start gap-3"
                >
                  <Scale className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{c.name || compAddress(c)}</div>
                    <div className="text-xs text-muted-foreground flex gap-3 mt-0.5 flex-wrap">
                      {c.tenant && <span>{c.tenant}</span>}
                      {c.areaSqft && <span>{c.areaSqft} sq ft</span>}
                      <span>{compRentLabel(c)}</span>
                      {c.completionDate && <span>{c.completionDate}</span>}
                      {c.postcode && <span>{c.postcode}</span>}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── ITZA dialog ─────────────────────────────────────────────────────────────

interface ZoningInputState {
  zoneA: string; zoneB: string; zoneC: string; zoneD: string;
  basementSqft: string; basementFactor: string;
  ancillarySqft: string; ancillaryFactor: string;
  a3SalesApportionment: string;
}
const EMPTY_ZONING: ZoningInputState = {
  zoneA: "", zoneB: "", zoneC: "", zoneD: "",
  basementSqft: "", basementFactor: "",
  ancillarySqft: "", ancillaryFactor: "",
  a3SalesApportionment: "",
};

function zoningInputs(state: ZoningInputState) {
  return {
    zones: [
      { zoneAreaSqft: Number(state.zoneA) || 0, factor: 1 },
      { zoneAreaSqft: Number(state.zoneB) || 0, factor: 0.5 },
      { zoneAreaSqft: Number(state.zoneC) || 0, factor: 0.25 },
      { zoneAreaSqft: Number(state.zoneD) || 0, factor: 0.125 },
    ].filter((z) => z.zoneAreaSqft > 0),
    basementSqft: Number(state.basementSqft) || 0,
    basementFactor: Number(state.basementFactor) || 0,
    ancillarySqft: Number(state.ancillarySqft) || 0,
    ancillaryFactor: Number(state.ancillaryFactor) || 0,
    a3SalesApportionment: Number(state.a3SalesApportionment) || 0,
  };
}

// BGP-canonical presets per use class — Tom + Pete's standard factors.
const USE_CLASS_PRESETS: Record<string, Partial<ZoningInputState>> = {
  retail:     { basementFactor: "0.1",  ancillaryFactor: "0.1",  a3SalesApportionment: "" },
  restaurant: { basementFactor: "0.5",  ancillaryFactor: "0.25", a3SalesApportionment: "0.65" },
  office:     { basementFactor: "0.5",  ancillaryFactor: "0.5",  a3SalesApportionment: "" },
};

function ZoningFields({ state, set }: { state: ZoningInputState; set: (s: ZoningInputState) => void }) {
  const update = (k: keyof ZoningInputState, v: string) => set({ ...state, [k]: v });
  const applyPreset = (preset: string) => {
    if (preset === "custom") return;
    const p = USE_CLASS_PRESETS[preset];
    if (!p) return;
    set({ ...state, ...p });
  };
  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium block mb-1.5">Use class preset</label>
        <Select onValueChange={applyPreset} defaultValue="custom">
          <SelectTrigger><SelectValue placeholder="Pick a preset to auto-fill factors" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="custom">Custom (manual)</SelectItem>
            <SelectItem value="retail">Retail — A/10 basement, no A3 apportionment</SelectItem>
            <SelectItem value="restaurant">Restaurant (A3) — A/2 basement, 0.65 sales apportionment</SelectItem>
            <SelectItem value="office">Office (B1) — A/2 weights</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <div className="text-sm font-medium mb-2">Zoned areas (sq ft) — fronts halve through zones (A/1, B/2, C/4, D/8)</div>
        <div className="grid grid-cols-4 gap-2">
          {[
            { k: "zoneA" as const, label: "Zone A" },
            { k: "zoneB" as const, label: "Zone B" },
            { k: "zoneC" as const, label: "Zone C" },
            { k: "zoneD" as const, label: "Zone D" },
          ].map(({ k, label }) => (
            <div key={k}>
              <label className="text-xs text-muted-foreground block mb-1">{label}</label>
              <Input type="number" value={state[k]} onChange={(e) => update(k, e.target.value)} placeholder="0" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium block mb-1.5">Basement sq ft</label>
          <Input type="number" value={state.basementSqft} onChange={(e) => update("basementSqft", e.target.value)} placeholder="0" />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1.5">Basement factor</label>
          <Input type="number" step="0.01" value={state.basementFactor} onChange={(e) => update("basementFactor", e.target.value)} placeholder="0.1 retail · 0.5 restaurant" />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1.5">Ancillary sq ft</label>
          <Input type="number" value={state.ancillarySqft} onChange={(e) => update("ancillarySqft", e.target.value)} placeholder="0" />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1.5">Ancillary factor</label>
          <Input type="number" step="0.01" value={state.ancillaryFactor} onChange={(e) => update("ancillaryFactor", e.target.value)} placeholder="0.1" />
        </div>
        <div className="col-span-2">
          <label className="text-sm font-medium block mb-1.5">A3 sales apportionment (optional)</label>
          <Input type="number" step="0.01" value={state.a3SalesApportionment} onChange={(e) => update("a3SalesApportionment", e.target.value)} placeholder="0.65 — restaurant ground sales (BGP A3 convention)" />
        </div>
      </div>
    </div>
  );
}

function ItzaDialog({
  open, onClose, matterId, onComputed,
}: { open: boolean; onClose: () => void; matterId: string; onComputed: () => void }) {
  const { toast } = useToast();
  const [state, setState] = useState<ZoningInputState>(EMPTY_ZONING);
  const [result, setResult] = useState<any | null>(null);

  const compute = async () => {
    setResult(null);
    const res = await fetch(`/api/pla/matters/${matterId}/valuation/itza`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify(zoningInputs(state)),
    });
    if (!res.ok) {
      toast({ title: "ITZA calc failed", variant: "destructive" });
      return;
    }
    const data = await res.json();
    setResult(data);
    toast({ title: "ITZA saved", description: `${data.output.itzaSqft} sq ft` });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Run ITZA</DialogTitle>
          <DialogDescription>
            Zoned area calculation — Zone A through D halve every 6.1m (20 ft) of depth.
            Basement and ancillary are weighted by use class.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <ZoningFields state={state} set={setState} />
          {result && (
            <div className="mt-4 border rounded p-3 bg-muted/40 text-sm">
              <div className="font-medium mb-1">Result</div>
              <div className="grid grid-cols-2 gap-2">
                <div>ITZA total: <span className="font-semibold">{result.output.itzaSqft} sq ft</span></div>
                <div>Basement ITZA: {result.output.basementItza} sq ft</div>
                <div>Ancillary ITZA: {result.output.ancillaryItza} sq ft</div>
                <div>Saved to workbook</div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={compute}>{result ? "Re-run" : "Compute"}</Button>
          {result && <Button onClick={onComputed}>Save & close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DevaluationDialog({
  open, onClose, matterId, defaults, onComputed,
}: { open: boolean; onClose: () => void; matterId: string; defaults: { annualRentPa: number | null }; onComputed: () => void }) {
  const { toast } = useToast();
  const [state, setState] = useState<ZoningInputState>(EMPTY_ZONING);
  const [annualRent, setAnnualRent] = useState(defaults.annualRentPa?.toString() || "");
  const [result, setResult] = useState<any | null>(null);

  const compute = async () => {
    setResult(null);
    const res = await fetch(`/api/pla/matters/${matterId}/valuation/devaluation`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ ...zoningInputs(state), annualRentPa: Number(annualRent) || 0 }),
    });
    if (!res.ok) {
      toast({ title: "Devaluation calc failed", variant: "destructive" });
      return;
    }
    const data = await res.json();
    setResult(data);
    toast({ title: "Devaluation saved", description: `£${data.output.zoneARatePsfItza} psf` });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Run Devaluation</DialogTitle>
          <DialogDescription>
            Given an observed comp rent and the unit's zoning, back out the implied
            Zone A psf — the rate Tom benchmarks against.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm font-medium block mb-1.5">Annual rent £ p.a.</label>
            <Input type="number" value={annualRent} onChange={(e) => setAnnualRent(e.target.value)} placeholder="e.g. 75000" />
          </div>
          <ZoningFields state={state} set={setState} />
          {result && (
            <div className="mt-4 border rounded p-3 bg-muted/40 text-sm">
              <div className="font-medium mb-1">Result</div>
              <div className="text-base">
                Implied Zone A: <span className="font-semibold">£{result.output.zoneARatePsfItza} psf ITZA</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                ITZA used: {result.input.itza.itzaSqft} sq ft · saved to workbook
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={compute} disabled={!annualRent}>{result ? "Re-run" : "Compute"}</Button>
          {result && <Button onClick={onComputed}>Save & close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * RelatedPathwayRuns — surfaces any Property Pathway runs for the same
 * property anchor. Stops the matter being blind to a Pathway investigation
 * already done on this asset.
 */
function RelatedPathwayRuns({ propertyId }: { propertyId: string }) {
  const { data: runs = [] } = useQuery<Array<{ id: string; address: string; postcode: string | null; currentStage: number; updatedAt: string }>>({
    queryKey: ["/api/property-pathway", propertyId],
    enabled: !!propertyId,
    queryFn: async () => {
      const r = await fetch(`/api/property-pathway?propertyId=${propertyId}`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) return [];
      return r.json();
    },
  });
  if (runs.length === 0) return null;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm font-medium mb-2 flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" /> Related Pathway investigations · {runs.length}
        </div>
        <div className="space-y-1">
          {runs.map((r) => (
            <Link
              key={r.id}
              to={`/property-intelligence?tab=pathway&runId=${r.id}`}
              className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-accent border-b border-border last:border-0"
            >
              <span className="truncate">
                {r.address}
                {r.postcode && <span className="opacity-60"> · {r.postcode}</span>}
              </span>
              <span className="text-xs text-muted-foreground shrink-0 ml-2">
                Stage {r.currentStage}/9 · {formatDate(r.updatedAt)}
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AddEventDialog({
  open, onClose, matterId, onCreated,
}: { open: boolean; onClose: () => void; matterId: string; onCreated: () => void }) {
  const { toast } = useToast();
  const [eventKind, setEventKind] = useState("note");
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const submit = async () => {
    const res = await fetch(`/api/pla/matters/${matterId}/events`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ eventKind, eventDate, description: description.trim() || undefined }),
    });
    if (!res.ok) {
      toast({ title: "Couldn't add event", variant: "destructive" });
      return;
    }
    setDescription("");
    onCreated();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add event</DialogTitle>
          <DialogDescription>Log a key date — notice, hearing, inspection, expert determination, etc.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-sm font-medium block mb-1.5">Kind</label>
            <Select value={eventKind} onValueChange={setEventKind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="notice_served">Notice served</SelectItem>
                <SelectItem value="counter_notice_deadline">Counter notice deadline</SelectItem>
                <SelectItem value="hearing">Hearing</SelectItem>
                <SelectItem value="inspection">Inspection</SelectItem>
                <SelectItem value="meeting">Meeting</SelectItem>
                <SelectItem value="court">Court</SelectItem>
                <SelectItem value="expert_determination">Expert determination</SelectItem>
                <SelectItem value="agreed">Agreed</SelectItem>
                <SelectItem value="note">Note</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Date</label>
            <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Description (optional)</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. break notice served on tenant" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Document Briefs dialog ──────────────────────────────────────────────────

type BriefMeta = {
  id: string;
  name: string;
  description: string;
  category: string;
  scope: string;
  requiredImagery: string[];
  optionalImagery: string[];
};

function DocumentBriefsDialog({
  open, onClose, propertyId, matterId,
}: { open: boolean; onClose: () => void; propertyId: string; matterId: string }) {
  const { toast } = useToast();
  const [briefs, setBriefs] = useState<BriefMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [output, setOutput] = useState<any | null>(null);

  useMemo(() => {
    if (!open) { setOutput(null); return; }
    setLoading(true);
    fetch("/api/document-briefs", { credentials: "include", headers: getAuthHeaders() })
      .then((r) => r.json())
      .then((data) => setBriefs(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [open]);

  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [renderedBriefId, setRenderedBriefId] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);

  const run = async (briefId: string, withRender: boolean) => {
    setRunning(briefId);
    setOutput(null);
    setRenderedHtml(null);
    setRenderedBriefId(null);
    setSavedUrl(null);
    try {
      const endpoint = withRender ? "render" : "run";
      if (withRender) setRendering(true);
      const res = await fetch(`/api/document-briefs/${briefId}/${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ propertyId, matterId }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        toast({ title: "Brief run failed", description: e?.error || `${res.status}`, variant: "destructive" });
        return;
      }
      const data = await res.json();
      const briefData = withRender ? data.brief : data;
      setOutput(briefData);
      if (withRender && data.html) {
        setRenderedHtml(data.html);
        setRenderedBriefId(briefId);
      }
      const provCounts: Record<string, number> = {};
      for (const p of Object.values(briefData.imageryProvenance || {})) {
        const k = String(p);
        provCounts[k] = (provCounts[k] || 0) + 1;
      }
      const summary = Object.entries(provCounts).map(([k, v]) => `${v} ${k}`).join(", ");
      toast({
        title: `${briefData.briefName} ${withRender ? "rendered" : "ready"}`,
        description: summary || "Brief built",
      });
    } finally {
      setRunning(null);
      setRendering(false);
    }
  };

  const applicable = briefs.filter((b) => b.scope === "matter" || b.scope === "property");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate document</DialogTitle>
          <DialogDescription>
            Pick a brief — server pulls structured data + auto-resolves required imagery (or composes it on the fly), Claude design renders the final document. Briefs are TS-defined recipes shared across matters, properties and Pathway runs.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-2 py-2">
            {applicable.map((b) => (
              <Card key={b.id} className="hover:border-primary/40 transition">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-medium">{b.name}</span>
                        <Badge variant="outline" className="text-[10px]">{b.category}</Badge>
                        <Badge variant="outline" className="text-[10px]">scope: {b.scope}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{b.description}</p>
                      {b.requiredImagery.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Imagery: {b.requiredImagery.map((k) => k.replace(/_/g, " ")).join(" · ")}
                          {b.optionalImagery.length > 0 && (
                            <span className="opacity-60"> (optional: {b.optionalImagery.map((k) => k.replace(/_/g, " ")).join(", ")})</span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => run(b.id, false)} disabled={running !== null}>
                        {running === b.id && !rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : "Run brief"}
                      </Button>
                      <Button size="sm" onClick={() => run(b.id, true)} disabled={running !== null} className="gap-1">
                        {running === b.id && rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                        Render
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {output && (
          <Card className="bg-muted/40">
            <CardContent className="p-4 space-y-2">
              <div className="font-medium text-sm">{output.title}</div>
              {output.subtitle && <div className="text-xs text-muted-foreground">{output.subtitle}</div>}
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Sections:</span> {output.sections.map((s: any) => s.heading).join(" · ")}
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Imagery resolved:</span>{" "}
                {Object.entries(output.imageryProvenance || {})
                  .map(([k, p]) => `${k.replace(/_/g, " ")} (${p})`)
                  .join(" · ")}
              </div>
              {!renderedHtml && (
                <div className="text-[10px] text-muted-foreground italic">
                  Brief built. Click "Render" on a brief to send to Claude design and produce a print-ready HTML document.
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {renderedHtml && (
          <Card>
            <CardContent className="p-2">
              <div className="flex items-center justify-between px-2 py-1 gap-2">
                <div className="text-xs font-medium">Claude design preview</div>
                <div className="flex items-center gap-2">
                  {savedUrl && (
                    <a href={savedUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                      Open in SharePoint ↗
                    </a>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const blob = new Blob([renderedHtml], { type: "text/html" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${(output?.briefName || "document").replace(/[^a-z0-9]+/gi, "-")}.html`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download HTML
                  </Button>
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!renderedBriefId) return;
                      setSaving(true);
                      try {
                        const r = await fetch(`/api/document-briefs/${renderedBriefId}/save-html`, {
                          method: "POST",
                          credentials: "include",
                          headers: { "content-type": "application/json", ...getAuthHeaders() },
                          body: JSON.stringify({ propertyId, matterId }),
                        });
                        if (!r.ok) {
                          const e = await r.json().catch(() => null);
                          toast({ title: "Save failed", description: e?.error || `${r.status}`, variant: "destructive" });
                          return;
                        }
                        const data = await r.json();
                        setSavedUrl(data.sharepointUrl);
                        toast({ title: "Saved to SharePoint", description: data.filename });
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving || !renderedBriefId}
                    className="gap-1"
                  >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Save to SharePoint
                  </Button>
                </div>
              </div>
              <iframe
                srcDoc={renderedHtml}
                className="w-full h-[60vh] border rounded"
                title="Claude design rendered output"
                sandbox="allow-same-origin"
              />
              <div className="text-[10px] text-muted-foreground italic px-2 py-1">
                HTML saves to the canonical SharePoint folder per brief category. PDF export via Cmd/Ctrl+P → Save as PDF in any browser; native PDF export lands when we wire a headless renderer.
              </div>
            </CardContent>
          </Card>
        )}
      </DialogContent>
    </Dialog>
  );
}
