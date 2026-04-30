import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, Flame, Clock, Pencil, X, Save } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

type Company = {
  id: string;
  name: string;
  lettingHunterFlag?: boolean | null;
  lettingHunterNotes?: string | null;
};

type Property = {
  id: string;
  name: string;
  address?: any;
  postcode?: string | null;
  landlordId?: string | null;
  competitorAgent?: string | null;
  competitorAgentInstructedAt?: string | null;
  competitorAgentStatus?: string | null;
  sqft?: number | null;
};

type LeaseEvent = {
  id: string;
  propertyId?: string | null;
  tenant?: string | null;
  eventType: string;
  eventDate?: string | null;
  sqft?: string | null;
  estimatedErv?: string | null;
};

export function LandlordLettingPanel({ company }: { company: Company }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Company>>({});

  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/crm/properties"],
  });

  const { data: leaseEvents = [] } = useQuery<LeaseEvent[]>({
    queryKey: ["/api/lease-events"],
  });

  const ownedProps = useMemo(
    () => properties.filter((p) => p.landlordId === company.id),
    [properties, company.id]
  );

  const ownedPropIds = useMemo(() => new Set(ownedProps.map((p) => p.id)), [ownedProps]);

  const upcomingEvents = useMemo(() => {
    const cutoff = Date.now() + 365 * 864e5;
    return leaseEvents
      .filter((e) => e.propertyId && ownedPropIds.has(e.propertyId))
      .filter((e) => e.eventDate && new Date(e.eventDate).getTime() < cutoff && new Date(e.eventDate).getTime() > Date.now())
      .sort((a, b) => (a.eventDate || "").localeCompare(b.eventDate || ""));
  }, [leaseEvents, ownedPropIds]);

  const upcomingSqft = upcomingEvents.reduce((s, e) => s + (parseInt(e.sqft || "0") || 0), 0);

  const competitorInstructed = ownedProps.filter((p) => p.competitorAgent && p.competitorAgentStatus === "active");
  const staleAgent = competitorInstructed.filter((p) => {
    if (!p.competitorAgentInstructedAt) return false;
    return Date.now() - new Date(p.competitorAgentInstructedAt).getTime() > 365 * 864e5;
  });

  const startEdit = () => {
    setForm({
      lettingHunterFlag: company.lettingHunterFlag,
      lettingHunterNotes: company.lettingHunterNotes,
    });
    setEditing(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => apiRequest("PUT", `/api/crm/companies/${company.id}`, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      qc.invalidateQueries({ queryKey: [`/api/crm/companies/${company.id}`] });
      setEditing(false);
      toast({ title: "Letting hunter saved" });
    },
  });

  return (
    <Card data-testid="landlord-letting-panel">
      <CardHeader className="p-3 pb-2 flex flex-row items-start justify-between">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Building2 className="w-4 h-4 text-blue-600" />
          Letting Hunter
          {company.lettingHunterFlag && (
            <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
              <Flame className="w-2.5 h-2.5 mr-0.5" /> Hunter pick
            </Badge>
          )}
          {staleAgent.length > 0 && (
            <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">
              {staleAgent.length} stale agent
            </Badge>
          )}
          {upcomingEvents.length > 0 && (
            <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
              <Clock className="w-2.5 h-2.5 mr-0.5" /> {upcomingEvents.length} events 12mo
            </Badge>
          )}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={editing ? () => setEditing(false) : startEdit}>
          {editing ? <X className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
        </Button>
      </CardHeader>

      <CardContent className="p-3 pt-0 space-y-3">
        {editing ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Letting Hunter pick</Label>
              <Switch checked={!!form.lettingHunterFlag} onCheckedChange={(v) => setForm({ ...form, lettingHunterFlag: v })} />
            </div>
            <Textarea placeholder="Why are we hunting them? (e.g. portfolio voids, agent rotation, recent acquisition)" value={form.lettingHunterNotes || ""} onChange={(e) => setForm({ ...form, lettingHunterNotes: e.target.value })} className="text-xs min-h-[80px]" />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                <Save className="w-3.5 h-3.5 mr-1" /> Save
              </Button>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="signals" className="w-full">
            <TabsList className="h-8">
              <TabsTrigger value="signals" className="text-xs">Signals</TabsTrigger>
              <TabsTrigger value="portfolio" className="text-xs">Portfolio ({ownedProps.length})</TabsTrigger>
              <TabsTrigger value="events" className="text-xs">Events ({upcomingEvents.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="signals" className="space-y-2 mt-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label="Owned properties" value={ownedProps.length.toString()} />
                <Stat label="Upcoming events 12mo" value={upcomingEvents.length.toString()} />
                <Stat label="Sqft in events" value={upcomingSqft ? upcomingSqft.toLocaleString() : "—"} />
                <Stat label="Competitor instructed" value={competitorInstructed.length.toString()} />
                <Stat label="Stale agent (>12mo)" value={staleAgent.length.toString()} />
                <Stat label="BGP-instructed" value={(ownedProps.length - competitorInstructed.length).toString()} />
              </div>
              {company.lettingHunterFlag && company.lettingHunterNotes && (
                <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs">
                  <div className="font-semibold text-amber-800 text-[10px] mb-0.5 flex items-center gap-1">
                    <Flame className="w-3 h-3" /> WHY WE'RE HUNTING
                  </div>
                  {company.lettingHunterNotes}
                </div>
              )}
              {staleAgent.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded p-2 text-xs">
                  <div className="font-semibold text-orange-800 text-[10px] mb-1">STALE COMPETITOR AGENT</div>
                  <div className="space-y-0.5">
                    {staleAgent.slice(0, 5).map((p) => (
                      <div key={p.id} className="flex justify-between">
                        <Link href={`/properties/${p.id}`} className="hover:underline truncate flex-1">{p.name}</Link>
                        <span className="text-muted-foreground ml-2">{p.competitorAgent} · {p.competitorAgentInstructedAt?.slice(0, 7)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="portfolio" className="space-y-1 mt-2 max-h-72 overflow-y-auto">
              {ownedProps.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">No linked properties</div>
              ) : (
                ownedProps.map((p) => (
                  <div key={p.id} className="flex justify-between items-center text-xs border-b border-border/40 pb-1">
                    <Link href={`/properties/${p.id}`} className="hover:underline truncate flex-1">{p.name}</Link>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {p.sqft ? <span className="text-muted-foreground">{p.sqft.toLocaleString()} sqft</span> : null}
                      {p.competitorAgent && (
                        <Badge variant="outline" className="text-[10px]">{p.competitorAgent}</Badge>
                      )}
                    </div>
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="events" className="space-y-1 mt-2 max-h-72 overflow-y-auto">
              {upcomingEvents.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">No upcoming lease events in 12mo</div>
              ) : (
                upcomingEvents.map((e) => {
                  const prop = ownedProps.find((p) => p.id === e.propertyId);
                  return (
                    <div key={e.id} className="flex justify-between text-xs border-b border-border/40 pb-1">
                      <div className="flex-1 truncate">
                        <Badge variant="outline" className="text-[10px] mr-1">{e.eventType}</Badge>
                        {prop ? <Link href={`/properties/${prop.id}`} className="hover:underline">{prop.name}</Link> : "—"}
                        {e.tenant && <span className="text-muted-foreground"> · {e.tenant}</span>}
                      </div>
                      <span className="text-muted-foreground shrink-0 ml-2">
                        {e.eventDate?.slice(0, 10)}{e.sqft ? ` · ${e.sqft} sqft` : ""}
                      </span>
                    </div>
                  );
                })
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border/40 rounded p-1.5">
      <div className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-xs font-medium">{value}</div>
    </div>
  );
}
