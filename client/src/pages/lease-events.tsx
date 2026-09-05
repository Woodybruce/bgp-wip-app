import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toDateInputValue } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { SOURCE_TYPES, SOURCE_LIST, normaliseSource, type SourceType } from "@shared/source-types";
import { Calendar, Plus, Trash2, ExternalLink, AlertTriangle, Clock, Flame, Eye, Pencil, Info, FileText } from "lucide-react";
import { buildUserIdColorMap } from "@/lib/agent-colors";
import { cn } from "@/lib/utils";
import { pillMetrics, pillInactive } from "@/components/ui/pill";

type LeaseEvent = {
  id: string;
  propertyId?: string | null;
  address?: string | null;
  landlord?: string | null;
  tenant?: string | null;
  unitRef?: string | null;
  eventType: string;
  eventDate?: string | null;
  noticeDate?: string | null;
  currentRent?: string | null;
  estimatedErv?: string | null;
  sqft?: string | null;
  sourceEvidence?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  assignedTo?: string | null;
  status: string;
  notes?: string | null;
  createdAt?: string | null;
};

const EVENT_TYPES = ["Rent Review", "Break Option", "Lease Expiry", "Renewal Option", "Service Charge", "Other"];
const STATUS_OPTIONS = ["Monitoring", "Contacted", "Instructed", "Dormant"];

function urgencyFor(dateStr?: string | null): { label: string; cls: string; icon: any } {
  if (!dateStr) return { label: "Undated", cls: "bg-slate-100 text-slate-700", icon: Clock };
  const d = new Date(dateStr);
  const now = new Date();
  const months = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (months < 0) return { label: "Overdue", cls: "bg-red-100 text-red-700 border-red-200", icon: AlertTriangle };
  if (months < 3) return { label: "< 3 mo", cls: "bg-orange-100 text-orange-700 border-orange-200", icon: Flame };
  if (months < 6) return { label: "< 6 mo", cls: "bg-amber-100 text-amber-700 border-amber-200", icon: Clock };
  if (months < 18) return { label: "< 18 mo", cls: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: Eye };
  return { label: "Future", cls: "bg-slate-100 text-slate-600", icon: Calendar };
}

export default function LeaseEventsPage({ embedded }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Partial<LeaseEvent> | null>(null);

  const { data: events = [], isLoading } = useQuery<LeaseEvent[]>({
    queryKey: ["/api/lease-events"],
  });

  // BGP team — for the Owner pill / inline assignee picker.
  const { data: users = [] } = useQuery<{ id: string; name: string; email: string }[]>({
    queryKey: ["/api/users"],
  });
  const userColors = useMemo(() => buildUserIdColorMap(users as any), [users]);
  const ownerLabel = (assignedTo?: string | null) => {
    if (!assignedTo) return null;
    const u = users.find(x => x.id === assignedTo || x.email === assignedTo);
    return { name: u ? u.name.split(" ")[0] : assignedTo.split("@")[0], color: u ? (userColors[u.id] || "bg-zinc-500") : "bg-zinc-500" };
  };

  // Inline partial update (status / owner / landlord) straight from the board,
  // without opening the edit dialog.
  const quickUpdate = useMutation({
    mutationFn: async (body: { id: string } & Partial<LeaseEvent>) =>
      apiRequest("PATCH", `/api/lease-events/${body.id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/lease-events"] }),
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const saveMut = useMutation({
    mutationFn: async (body: Partial<LeaseEvent>) => {
      if (body.id) {
        return await apiRequest("PATCH", `/api/lease-events/${body.id}`, body);
      }
      return await apiRequest("POST", "/api/lease-events", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lease-events"] });
      setEditing(null);
      toast({ title: "Saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/lease-events/${id}`, undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/lease-events"] });
      toast({ title: "Deleted" });
    },
  });

  const filtered = useMemo(() => {
    let rows = events;
    if (statusFilter !== "all") rows = rows.filter(e => e.status === statusFilter);
    if (typeFilter !== "all") rows = rows.filter(e => e.eventType === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(e =>
        (e.tenant || "").toLowerCase().includes(q) ||
        (e.address || "").toLowerCase().includes(q) ||
        (e.unitRef || "").toLowerCase().includes(q) ||
        (e.notes || "").toLowerCase().includes(q)
      );
    }
    return rows;
  }, [events, statusFilter, typeFilter, search]);

  const counts = useMemo(() => {
    const c = { overdue: 0, imminent: 0, near: 0, watching: 0 };
    for (const e of events) {
      if (!e.eventDate || e.status === "Dormant" || e.status === "Instructed") continue;
      const months = (new Date(e.eventDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30);
      if (months < 0) c.overdue++;
      else if (months < 3) c.imminent++;
      else if (months < 6) c.near++;
      else if (months < 18) c.watching++;
    }
    return c;
  }, [events]);

  return (
    <div className={embedded ? "p-4 space-y-4 h-full overflow-auto" : "p-4 sm:p-6 space-y-4 max-w-7xl mx-auto"}>
      {!embedded && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Lease Events
            </h1>
            <p className="text-sm text-muted-foreground">Rent reviews, breaks, expiries, renewal options — forward-looking BD pipeline for lease advisory</p>
          </div>
          <Button onClick={() => setEditing({ eventType: "Rent Review", status: "Monitoring", sourceEvidence: "Manual" })}>
            <Plus className="w-4 h-4 mr-1.5" /> Log event
          </Button>
        </div>
      )}
      {embedded && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing({ eventType: "Rent Review", status: "Monitoring", sourceEvidence: "Manual" })} size="sm">
            <Plus className="w-4 h-4 mr-1.5" /> Log event
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Alert styling only when the count is genuinely non-zero (DESIGN.md §8) */}
        <Card className={counts.overdue > 0 ? "bg-red-50 dark:bg-red-950/30 border-red-200" : undefined}>
          <CardContent className="p-3">
            <p className={`text-[10px] uppercase tracking-wider font-medium ${counts.overdue > 0 ? "text-red-700" : "text-muted-foreground"}`}>Overdue</p>
            <p className={`text-2xl font-bold font-mono tabular-nums ${counts.overdue > 0 ? "text-red-700" : "text-foreground"}`}>{counts.overdue}</p>
          </CardContent>
        </Card>
        <Card className={counts.imminent > 0 ? "bg-orange-50 dark:bg-orange-950/30 border-orange-200" : undefined}>
          <CardContent className="p-3">
            <p className={`text-[10px] uppercase tracking-wider font-medium ${counts.imminent > 0 ? "text-orange-700" : "text-muted-foreground"}`}>Due &lt; 3 months</p>
            <p className={`text-2xl font-bold font-mono tabular-nums ${counts.imminent > 0 ? "text-orange-700" : "text-foreground"}`}>{counts.imminent}</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-200">
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wider text-amber-700 font-medium">Due &lt; 6 months</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-amber-700">{counts.near}</p>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200">
          <CardContent className="p-3">
            <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-medium">Watching (18 mo)</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700">{counts.watching}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input placeholder="Search tenant, address, unit or notes..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
        {/* Filter dropdowns as pill triggers (DESIGN.md §5) */}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger data-no-min-touch className={cn(pillMetrics, pillInactive, "h-auto w-auto")}><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger data-no-min-touch className={cn(pillMetrics, pillInactive, "h-auto w-auto")}><SelectValue placeholder="Event type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {EVENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground ml-auto">{filtered.length} event{filtered.length === 1 ? "" : "s"}</p>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No lease events yet</p>
          <p className="text-xs mt-1">Log rent reviews, breaks and expiries as you spot them — or ask ChatBGP to extract them from emails/brochures</p>
        </div>
      ) : (
        <>
        {/* Phone: one card per event (§7) — the table never ships below md. */}
        <div className="md:hidden rounded-lg border bg-background divide-y divide-border">
          {filtered.map(ev => {
            const u = urgencyFor(ev.eventDate);
            const src = normaliseSource(ev.sourceEvidence);
            const Icon = u.icon;
            const owner = ownerLabel(ev.assignedTo);
            return (
              <div key={ev.id} className="px-4 py-3" data-testid={`lease-event-card-${ev.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium min-w-0 truncate">{ev.tenant || "—"}</span>
                  <div className="text-right shrink-0">
                    {(ev.currentRent || ev.estimatedErv) ? (
                      /* Label which figure the bold number is — an event with
                         only an ERV used to read as passing rent (the desktop
                         table has said "Rent:" / "ERV:" all along). */
                      <p className="text-sm font-mono tabular-nums font-semibold">
                        <span className="text-[10px] font-sans font-normal text-muted-foreground mr-1">{ev.currentRent ? "Rent" : "ERV"}</span>
                        {ev.currentRent || ev.estimatedErv}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">—</p>
                    )}
                    {ev.currentRent && ev.estimatedErv && (
                      <p className="text-[11px] font-mono tabular-nums text-muted-foreground">ERV {ev.estimatedErv}</p>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {[ev.address, ev.unitRef, ev.landlord].filter(Boolean).join(" · ") || "No address"}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border inline-flex items-center gap-1 whitespace-nowrap ${u.cls}`}>
                    <Icon className="w-3 h-3" />
                    {u.label}
                  </span>
                  {ev.eventDate && <span className="text-[11px] text-muted-foreground whitespace-nowrap">{new Date(ev.eventDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>}
                  <span className="text-[11px] font-medium whitespace-nowrap">{ev.eventType}</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="inline-flex items-center gap-1">
                        {src
                          ? <Badge variant="outline" className={`text-[10px] cursor-pointer whitespace-nowrap ${SOURCE_TYPES[src].badgeClass}`}>{SOURCE_TYPES[src].label}</Badge>
                          : <Badge variant="outline" className="text-[10px] cursor-pointer whitespace-nowrap text-muted-foreground"><Info className="w-2.5 h-2.5 mr-0.5" />Source</Badge>}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 text-xs space-y-2" align="start">
                      <div className="flex items-center gap-1.5 font-medium">
                        <FileText className="w-3.5 h-3.5" />
                        {src ? SOURCE_TYPES[src].label : "Unknown source"}
                      </div>
                      {ev.sourceTitle && <p className="text-muted-foreground">{ev.sourceTitle}</p>}
                      {ev.notes && <p className="text-muted-foreground whitespace-pre-wrap line-clamp-4">{ev.notes}</p>}
                      {ev.sourceUrl ? (
                        <a href={ev.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> Open original source
                        </a>
                      ) : (
                        <p className="text-muted-foreground italic">No linked source document.</p>
                      )}
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  <Select value={ev.status} onValueChange={v => quickUpdate.mutate({ id: ev.id, status: v })}>
                    <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={ev.assignedTo || "__none"} onValueChange={v => quickUpdate.mutate({ id: ev.id, assignedTo: v === "__none" ? null : v })}>
                    <SelectTrigger className="h-7 w-[110px] text-xs border-dashed">
                      {owner
                        ? <span className={`inline-flex items-center text-white text-[10px] px-1.5 py-0.5 rounded-full ${owner.color}`}>{owner.name}</span>
                        : <span className="text-muted-foreground">Unassigned</span>}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Unassigned</SelectItem>
                      {users.map(usr => <SelectItem key={usr.id} value={usr.id}>{usr.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-0.5 ml-auto">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(ev)} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title="Edit">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { if (confirm("Delete this event?")) delMut.mutate(ev.id); }} className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="hidden md:block rounded-lg border overflow-x-auto bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Property / Tenant</th>
                <th className="text-left px-3 py-2">Landlord</th>
                <th className="text-left px-3 py-2 w-[140px]">Rent / ERV</th>
                <th className="text-left px-3 py-2">Source</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Owner</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(ev => {
                const u = urgencyFor(ev.eventDate);
                const src = normaliseSource(ev.sourceEvidence);
                const Icon = u.icon;
                const owner = ownerLabel(ev.assignedTo);
                return (
                  <tr key={ev.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${u.cls}`}>
                          <Icon className="w-3 h-3" />
                          {u.label}
                        </span>
                      </div>
                      {ev.eventDate && <p className="text-xs text-muted-foreground mt-0.5">{new Date(ev.eventDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</p>}
                    </td>
                    <td className="px-3 py-2"><span className="font-medium">{ev.eventType}</span></td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{ev.tenant || "—"}</p>
                      <p className="text-xs text-muted-foreground">{[ev.address, ev.unitRef].filter(Boolean).join(" · ") || "No address"}</p>
                    </td>
                    {/* Landlord — inline editable */}
                    <td className="px-3 py-2 text-xs">
                      <input
                        defaultValue={ev.landlord || ""}
                        placeholder="—"
                        onBlur={e => { const v = e.target.value.trim(); if (v !== (ev.landlord || "")) quickUpdate.mutate({ id: ev.id, landlord: v || null }); }}
                        className="w-28 bg-transparent border-b border-transparent hover:border-muted focus:border-primary focus:outline-none"
                      />
                    </td>
                    {/* Rent / ERV — narrowed + truncated */}
                    <td className="px-3 py-2 text-xs w-[140px] max-w-[140px]">
                      {ev.currentRent && <p className="truncate" title={ev.currentRent}>Rent: <span className="font-medium">{ev.currentRent}</span></p>}
                      {ev.estimatedErv && <p className="truncate" title={ev.estimatedErv}>ERV: <span className="font-medium">{ev.estimatedErv}</span></p>}
                      {!ev.currentRent && !ev.estimatedErv && <span className="text-muted-foreground">—</span>}
                    </td>
                    {/* Source — click for a summary of where it came from + link */}
                    <td className="px-3 py-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="inline-flex items-center gap-1">
                            {src
                              ? <Badge variant="outline" className={`text-[10px] cursor-pointer ${SOURCE_TYPES[src].badgeClass}`}>{SOURCE_TYPES[src].label}</Badge>
                              : <Badge variant="outline" className="text-[10px] cursor-pointer text-muted-foreground"><Info className="w-2.5 h-2.5 mr-0.5" />Source</Badge>}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 text-xs space-y-2" align="start">
                          <div className="flex items-center gap-1.5 font-medium">
                            <FileText className="w-3.5 h-3.5" />
                            {src ? SOURCE_TYPES[src].label : "Unknown source"}
                          </div>
                          {ev.sourceTitle && <p className="text-muted-foreground">{ev.sourceTitle}</p>}
                          {ev.notes && <p className="text-muted-foreground whitespace-pre-wrap line-clamp-4">{ev.notes}</p>}
                          {ev.sourceUrl ? (
                            <a href={ev.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" /> Open original source
                            </a>
                          ) : (
                            <p className="text-muted-foreground italic">No linked source document.</p>
                          )}
                        </PopoverContent>
                      </Popover>
                    </td>
                    {/* Status — inline editable on the board */}
                    <td className="px-3 py-2">
                      <Select value={ev.status} onValueChange={v => quickUpdate.mutate({ id: ev.id, status: v })}>
                        <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    {/* Owner — BGP contact pill + inline picker */}
                    <td className="px-3 py-2">
                      <Select value={ev.assignedTo || "__none"} onValueChange={v => quickUpdate.mutate({ id: ev.id, assignedTo: v === "__none" ? null : v })}>
                        <SelectTrigger className="h-7 w-[130px] text-xs border-dashed">
                          {owner
                            ? <span className={`inline-flex items-center text-white text-[10px] px-1.5 py-0.5 rounded-full ${owner.color}`}>{owner.name}</span>
                            : <span className="text-muted-foreground">Unassigned</span>}
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">Unassigned</SelectItem>
                          {users.map(usr => <SelectItem key={usr.id} value={usr.id}>{usr.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(ev)} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { if (confirm("Delete this event?")) delMut.mutate(ev.id); }} className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      <Dialog open={!!editing} onOpenChange={v => { if (!v) setEditing(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit event" : "Log lease event"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="col-span-2">
                <label className="text-xs font-medium mb-1 block">Tenant</label>
                <Input value={editing.tenant || ""} onChange={e => setEditing(x => ({ ...x!, tenant: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium mb-1 block">Address</label>
                <Input value={editing.address || ""} onChange={e => setEditing(x => ({ ...x!, address: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium mb-1 block">Landlord</label>
                <Input value={editing.landlord || ""} onChange={e => setEditing(x => ({ ...x!, landlord: e.target.value }))} placeholder="Landlord / freeholder" />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Unit</label>
                <Input value={editing.unitRef || ""} onChange={e => setEditing(x => ({ ...x!, unitRef: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Event type</label>
                <Select value={editing.eventType} onValueChange={v => setEditing(x => ({ ...x!, eventType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{EVENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Event date <span className="text-destructive">*</span></label>
                <Input type="date" required value={toDateInputValue(editing.eventDate)} onChange={e => setEditing(x => ({ ...x!, eventDate: e.target.value || null }))} className={!editing.eventDate ? "border-destructive" : ""} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Notice date</label>
                <Input type="date" value={toDateInputValue(editing.noticeDate)} onChange={e => setEditing(x => ({ ...x!, noticeDate: e.target.value || null }))} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Current rent (£pa)</label>
                <Input value={editing.currentRent || ""} onChange={e => setEditing(x => ({ ...x!, currentRent: e.target.value }))} placeholder="£125,000" />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Estimated ERV (£pa)</label>
                <Input value={editing.estimatedErv || ""} onChange={e => setEditing(x => ({ ...x!, estimatedErv: e.target.value }))} placeholder="£150,000" />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Status</label>
                <Select value={editing.status} onValueChange={v => setEditing(x => ({ ...x!, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Source</label>
                <Select value={editing.sourceEvidence || "Manual"} onValueChange={v => setEditing(x => ({ ...x!, sourceEvidence: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SOURCE_LIST.map(s => <SelectItem key={s} value={s}>{SOURCE_TYPES[s].label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium mb-1 block">Source URL (link to email / file / message)</label>
                <Input value={editing.sourceUrl || ""} onChange={e => setEditing(x => ({ ...x!, sourceUrl: e.target.value }))} placeholder="https://..." />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Source title</label>
                <Input value={editing.sourceTitle || ""} onChange={e => setEditing(x => ({ ...x!, sourceTitle: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Assigned to</label>
                <Input value={editing.assignedTo || ""} onChange={e => setEditing(x => ({ ...x!, assignedTo: e.target.value }))} placeholder="peter@..." />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium mb-1 block">Notes</label>
                <Textarea rows={3} value={editing.notes || ""} onChange={e => setEditing(x => ({ ...x!, notes: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => editing && saveMut.mutate(editing)} disabled={saveMut.isPending || !editing?.eventDate}>
              {editing?.id ? "Save changes" : "Create event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
