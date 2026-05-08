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
import { Link, useLocation } from "wouter";
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
