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
import { Plus, Scale, Calendar as CalendarIcon, MapPin, AlertCircle, Loader2 } from "lucide-react";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PropertyResolverBar } from "@/components/property-resolver-bar";
import { InlineNumber, InlineDate, InlineText } from "@/components/inline-edit";
import type { PlaMatter } from "@shared/schema";

const MATTER_TYPES: Array<{ value: string; label: string }> = [
  { value: "rent_review", label: "Rent Review" },
  { value: "lease_renewal", label: "Lease Renewal" },
  { value: "dilapidations", label: "Dilapidations" },
  { value: "service_charge", label: "Service Charge" },
  { value: "general", label: "General Advisory" },
];

const STATUSES: Array<{ value: string; label: string; color: string }> = [
  { value: "open",            label: "Open",            color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  { value: "in_negotiation",  label: "In negotiation",  color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  { value: "agreed",          label: "Agreed",          color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  { value: "settled",         label: "Settled",         color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  { value: "on_hold",         label: "On hold",         color: "bg-zinc-100 text-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400" },
  { value: "closed",          label: "Closed",          color: "bg-zinc-100 text-zinc-500 dark:bg-zinc-900/30 dark:text-zinc-500" },
];

function statusBadge(status: string | null | undefined) {
  const s = STATUSES.find((x) => x.value === status);
  return s ? <Badge className={s.color} variant="secondary">{s.label}</Badge> : <Badge variant="outline">{status}</Badge>;
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
            <Badge variant="outline" className="text-xs">{filtered.length} matters</Badge>
          </div>
          <Button onClick={() => setCreateOpen(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" /> New Matter
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
            <p className="font-medium mb-1">No matters {statusFilter !== "all" ? `with status "${statusFilter}"` : "yet"}</p>
            <p className="text-sm">Click "New Matter" to start one — anchor it to a property via the resolver.</p>
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
  const [matterType, setMatterType] = useState<string>("rent_review");
  const [actingFor, setActingFor] = useState<string>("landlord");
  const [notes, setNotes] = useState("");

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
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "create failed");
      return res.json() as Promise<PlaMatter>;
    },
    onSuccess: (m) => {
      toast({ title: "Matter created", description: typeLabel(m.matterType) });
      // reset for next use
      setProperty(null);
      setNotes("");
      onCreated(m.id);
    },
    onError: (err: any) => toast({ title: "Couldn't create matter", description: err?.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Matter</DialogTitle>
          <DialogDescription>
            Anchor this matter to a canonical property — type any address, postcode, UPRN or title number and the resolver will pick it up.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium block mb-2">Property</label>
            <PropertyResolverBar
              current={property}
              onResolve={(id, prop) => setProperty({ id, name: prop.name, postcode: prop.postcode })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium block mb-2">Matter type</label>
              <Select value={matterType} onValueChange={setMatterType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MATTER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">Acting for</label>
              <Select value={actingFor} onValueChange={setActingFor}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="landlord">Landlord</SelectItem>
                  <SelectItem value="tenant">Tenant</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium block mb-2">Notes <span className="text-muted-foreground font-normal">(optional)</span></label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Brief description of the matter…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!property || create.isPending}>
            {create.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Create matter
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
      toast({ title: "Matter closed" });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/pla/matters"] });
    },
  });

  if (isLoading) {
    return <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  }
  if (!data) {
    return <div className="p-6 text-center text-muted-foreground">Matter not found.</div>;
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
            onValueChange={(v) => updateField.mutate({ status: v } as any)}
          >
            <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            {matter.sharepointFolderUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={matter.sharepointFolderUrl} target="_blank" rel="noreferrer">SharePoint folder</a>
              </Button>
            )}
            {matter.status !== "closed" && (
              <Button variant="outline" size="sm" onClick={() => closeMatter.mutate()}>Close matter</Button>
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
            <Button variant="outline" size="sm" disabled>Add comp (coming)</Button>
          </div>
          {comps.length === 0 ? (
            <div className="text-sm text-muted-foreground">None linked yet — comps drive the valuation engine when it lands.</div>
          ) : (
            <div className="space-y-1">
              {comps.map((c) => (
                <div key={c.compId} className="flex items-center justify-between text-sm py-1">
                  <span className="font-mono text-xs">{c.compId.slice(0, 8)}…</span>
                  <span className="text-muted-foreground">weight {c.weight.toFixed(2)}</span>
                </div>
              ))}
            </div>
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

        {/* Workbooks (placeholder) */}
        <Card><CardContent className="p-4">
          <div className="text-sm font-medium mb-3">Valuation workbooks · {workbooks.length}</div>
          {workbooks.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Net Effective / Devaluation / Comparables Schedule generation lands with the valuation engine.
              For now, drop workbooks into the matter's SharePoint folder manually.
            </div>
          ) : (
            <div className="space-y-1">
              {workbooks.map((w) => (
                <div key={w.id} className="flex items-center justify-between text-sm py-1">
                  <span>{w.kind}</span>
                  {w.sharepointUrl && <a href={w.sharepointUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open</a>}
                </div>
              ))}
            </div>
          )}
        </CardContent></Card>

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
    </div>
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
          format="money"
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
