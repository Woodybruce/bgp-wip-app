import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, AlertTriangle, Pencil, X, Save, Plus, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const ASSET_CLASSES = ["Retail", "Office", "Leisure", "Industrial", "Residential", "Mixed-use", "Hotel"];
const GEOGRAPHIES = ["London", "UK Regions", "South East", "Europe", "International"];
const CAPITAL_SOURCES = ["balance_sheet", "fund", "jv", "family_office", "sovereign", "reit", "listed"];
const DEBT_EVENT_TYPES = ["refinance", "maturity", "breach", "writedown", "fundraise", "acquisition", "disposal"];

type Company = {
  id: string;
  name: string;
  mandateAssetClass?: string[] | null;
  mandateLotSizeMin?: number | null;
  mandateLotSizeMax?: number | null;
  mandateGeographies?: string[] | null;
  acquiringNow?: boolean | null;
  acquiringNowNotes?: string | null;
  capitalSource?: string | null;
  aum?: number | null;
  fundVintageYear?: number | null;
  fundEndYear?: number | null;
  disposingNow?: boolean | null;
  disposingNowNotes?: string | null;
  distressFlag?: boolean | null;
  distressNotes?: string | null;
};

type DebtEvent = {
  id: string;
  landlordId: string;
  propertyId?: string | null;
  eventType: string;
  eventDate?: string | null;
  lender?: string | null;
  amount?: number | null;
  notes?: string | null;
  source?: string | null;
};

type InvestmentComp = {
  id: string;
  propertyName?: string | null;
  address?: string | null;
  transactionDate?: string | null;
  price?: number | null;
  buyerCompanyId?: string | null;
  sellerCompanyId?: string | null;
};

export function LandlordInvestmentPanel({ company }: { company: Company }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Company>>({});

  const { data: comps = [] } = useQuery<InvestmentComp[]>({
    queryKey: ["/api/investment-comps/by-company", company.id],
    queryFn: async () => {
      const res = await fetch(`/api/investment-comps/by-company?companyId=${company.id}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: debtEvents = [] } = useQuery<DebtEvent[]>({
    queryKey: ["/api/landlord-debt-events", company.id],
    queryFn: async () => {
      const res = await fetch(`/api/landlord-debt-events?landlordId=${company.id}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const acquisitions = useMemo(
    () => comps.filter((c) => c.buyerCompanyId === company.id).sort((a, b) => (b.transactionDate || "").localeCompare(a.transactionDate || "")),
    [comps, company.id]
  );
  const disposals = useMemo(
    () => comps.filter((c) => c.sellerCompanyId === company.id).sort((a, b) => (b.transactionDate || "").localeCompare(a.transactionDate || "")),
    [comps, company.id]
  );

  const acquisitions12mo = acquisitions.filter((c) => {
    if (!c.transactionDate) return false;
    return Date.now() - new Date(c.transactionDate).getTime() < 365 * 864e5;
  });
  const disposals12mo = disposals.filter((c) => {
    if (!c.transactionDate) return false;
    return Date.now() - new Date(c.transactionDate).getTime() < 365 * 864e5;
  });

  const fundsAge = company.fundVintageYear ? new Date().getFullYear() - company.fundVintageYear : null;
  const yearsToFundEnd = company.fundEndYear ? company.fundEndYear - new Date().getFullYear() : null;

  const startEdit = () => {
    setForm({
      mandateAssetClass: company.mandateAssetClass || [],
      mandateLotSizeMin: company.mandateLotSizeMin,
      mandateLotSizeMax: company.mandateLotSizeMax,
      mandateGeographies: company.mandateGeographies || [],
      acquiringNow: company.acquiringNow,
      acquiringNowNotes: company.acquiringNowNotes,
      capitalSource: company.capitalSource,
      aum: company.aum,
      fundVintageYear: company.fundVintageYear,
      fundEndYear: company.fundEndYear,
      disposingNow: company.disposingNow,
      disposingNowNotes: company.disposingNowNotes,
      distressFlag: company.distressFlag,
      distressNotes: company.distressNotes,
    });
    setEditing(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => apiRequest("PUT", `/api/crm/companies/${company.id}`, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      qc.invalidateQueries({ queryKey: [`/api/crm/companies/${company.id}`] });
      setEditing(false);
      toast({ title: "Investor profile saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const toggleArrayValue = (key: "mandateAssetClass" | "mandateGeographies", value: string) => {
    setForm((f) => {
      const current = (f[key] as string[]) || [];
      return { ...f, [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] };
    });
  };

  return (
    <Card data-testid="landlord-investment-panel">
      <CardHeader className="p-3 pb-2 flex flex-row items-start justify-between">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <TrendingUp className="w-4 h-4 text-emerald-600" />
          Investment Hunter
          {company.acquiringNow && <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">Buying now</Badge>}
          {company.disposingNow && <Badge className="bg-orange-50 text-orange-700 border-orange-200 text-[10px]">Selling now</Badge>}
          {company.distressFlag && (
            <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px]">
              <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> Distressed
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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px]">AUM (£m)</Label>
                <Input type="number" value={form.aum ?? ""} onChange={(e) => setForm({ ...form, aum: e.target.value ? parseFloat(e.target.value) : null })} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[10px]">Capital source</Label>
                <select className="h-8 text-xs w-full border rounded-md bg-background px-2" value={form.capitalSource || ""} onChange={(e) => setForm({ ...form, capitalSource: e.target.value || null })}>
                  <option value="">—</option>
                  {CAPITAL_SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-[10px]">Fund vintage</Label>
                <Input type="number" value={form.fundVintageYear ?? ""} onChange={(e) => setForm({ ...form, fundVintageYear: e.target.value ? parseInt(e.target.value) : null })} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[10px]">Fund end year</Label>
                <Input type="number" value={form.fundEndYear ?? ""} onChange={(e) => setForm({ ...form, fundEndYear: e.target.value ? parseInt(e.target.value) : null })} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[10px]">Lot size min (£m)</Label>
                <Input type="number" value={form.mandateLotSizeMin ?? ""} onChange={(e) => setForm({ ...form, mandateLotSizeMin: e.target.value ? parseFloat(e.target.value) : null })} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[10px]">Lot size max (£m)</Label>
                <Input type="number" value={form.mandateLotSizeMax ?? ""} onChange={(e) => setForm({ ...form, mandateLotSizeMax: e.target.value ? parseFloat(e.target.value) : null })} className="h-8 text-xs" />
              </div>
            </div>

            <div>
              <Label className="text-[10px]">Asset class mandate</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {ASSET_CLASSES.map((a) => (
                  <Badge key={a} variant={(form.mandateAssetClass || []).includes(a) ? "default" : "outline"} className="cursor-pointer text-[10px]" onClick={() => toggleArrayValue("mandateAssetClass", a)}>{a}</Badge>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-[10px]">Geographies</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {GEOGRAPHIES.map((g) => (
                  <Badge key={g} variant={(form.mandateGeographies || []).includes(g) ? "default" : "outline"} className="cursor-pointer text-[10px]" onClick={() => toggleArrayValue("mandateGeographies", g)}>{g}</Badge>
                ))}
              </div>
            </div>

            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Buying now</Label>
                <Switch checked={!!form.acquiringNow} onCheckedChange={(v) => setForm({ ...form, acquiringNow: v })} />
              </div>
              <Textarea placeholder="What are they actively chasing?" value={form.acquiringNowNotes || ""} onChange={(e) => setForm({ ...form, acquiringNowNotes: e.target.value })} className="text-xs min-h-[50px]" />
            </div>

            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Selling now</Label>
                <Switch checked={!!form.disposingNow} onCheckedChange={(v) => setForm({ ...form, disposingNow: v })} />
              </div>
              <Textarea placeholder="What's coming to market?" value={form.disposingNowNotes || ""} onChange={(e) => setForm({ ...form, disposingNowNotes: e.target.value })} className="text-xs min-h-[50px]" />
            </div>

            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-red-700">Distressed flag</Label>
                <Switch checked={!!form.distressFlag} onCheckedChange={(v) => setForm({ ...form, distressFlag: v })} />
              </div>
              <Textarea placeholder="Refinance pressure, breaches, writedowns…" value={form.distressNotes || ""} onChange={(e) => setForm({ ...form, distressNotes: e.target.value })} className="text-xs min-h-[50px]" />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                <Save className="w-3.5 h-3.5 mr-1" /> Save
              </Button>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="buyers" className="w-full">
            <TabsList className="h-8">
              <TabsTrigger value="buyers" className="text-xs">Buyer profile</TabsTrigger>
              <TabsTrigger value="sellers" className="text-xs">Seller / Distress</TabsTrigger>
              <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="buyers" className="space-y-2 mt-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label="AUM" value={company.aum ? `£${company.aum.toLocaleString()}m` : "—"} />
                <Stat label="Capital" value={company.capitalSource?.replace(/_/g, " ") || "—"} />
                <Stat label="Fund age" value={fundsAge != null ? `${fundsAge}y vintage ${company.fundVintageYear}` : "—"} />
                <Stat label="Yrs to fund end" value={yearsToFundEnd != null ? `${yearsToFundEnd}y` : "—"} />
                <Stat label="Lot size" value={company.mandateLotSizeMin || company.mandateLotSizeMax ? `£${company.mandateLotSizeMin || "?"}–${company.mandateLotSizeMax || "?"}m` : "—"} />
                <Stat label="Acq. last 12mo" value={acquisitions12mo.length.toString()} />
              </div>
              {(company.mandateAssetClass?.length || company.mandateGeographies?.length) ? (
                <div className="space-y-1">
                  {company.mandateAssetClass?.length ? (
                    <div className="flex gap-1 flex-wrap"><span className="text-[10px] text-muted-foreground">Asset class:</span>{company.mandateAssetClass.map((a) => <Badge key={a} variant="outline" className="text-[10px]">{a}</Badge>)}</div>
                  ) : null}
                  {company.mandateGeographies?.length ? (
                    <div className="flex gap-1 flex-wrap"><span className="text-[10px] text-muted-foreground">Geog:</span>{company.mandateGeographies.map((g) => <Badge key={g} variant="outline" className="text-[10px]">{g}</Badge>)}</div>
                  ) : null}
                </div>
              ) : null}
              {company.acquiringNow && company.acquiringNowNotes && (
                <div className="bg-emerald-50 border border-emerald-200 rounded p-2 text-xs">
                  <div className="font-semibold text-emerald-800 text-[10px] mb-0.5">BUYING NOW</div>
                  {company.acquiringNowNotes}
                </div>
              )}
            </TabsContent>

            <TabsContent value="sellers" className="space-y-2 mt-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Stat label="Disposals last 12mo" value={disposals12mo.length.toString()} />
                <Stat label="Total disposals" value={disposals.length.toString()} />
                <Stat label="Debt events" value={debtEvents.length.toString()} />
                <Stat label="Yrs to fund end" value={yearsToFundEnd != null ? `${yearsToFundEnd}y` : "—"} />
              </div>
              {company.disposingNow && company.disposingNowNotes && (
                <div className="bg-orange-50 border border-orange-200 rounded p-2 text-xs">
                  <div className="font-semibold text-orange-800 text-[10px] mb-0.5">SELLING NOW</div>
                  {company.disposingNowNotes}
                </div>
              )}
              {company.distressFlag && (
                <div className="bg-red-50 border border-red-200 rounded p-2 text-xs">
                  <div className="font-semibold text-red-800 text-[10px] mb-0.5 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />DISTRESSED</div>
                  {company.distressNotes || "Flagged as distressed — see notes."}
                </div>
              )}
              <DebtEventsList events={debtEvents} landlordId={company.id} />
            </TabsContent>

            <TabsContent value="activity" className="space-y-2 mt-2">
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">Recent acquisitions ({acquisitions.length})</div>
                {acquisitions.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">None on record</div>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {acquisitions.slice(0, 10).map((c) => (
                      <div key={c.id} className="flex justify-between text-xs border-b border-border/40 pb-1">
                        <div className="truncate flex-1">{c.propertyName || c.address || "—"}</div>
                        <div className="text-muted-foreground shrink-0 ml-2">{c.transactionDate} · {c.price ? `£${c.price.toLocaleString()}` : "—"}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground mb-1">Recent disposals ({disposals.length})</div>
                {disposals.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">None on record</div>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {disposals.slice(0, 10).map((c) => (
                      <div key={c.id} className="flex justify-between text-xs border-b border-border/40 pb-1">
                        <div className="truncate flex-1">{c.propertyName || c.address || "—"}</div>
                        <div className="text-muted-foreground shrink-0 ml-2">{c.transactionDate} · {c.price ? `£${c.price.toLocaleString()}` : "—"}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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

function DebtEventsList({ events, landlordId }: { events: DebtEvent[]; landlordId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<DebtEvent>>({ eventType: "refinance" });

  const addMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/landlord-debt-events", { ...draft, landlordId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/landlord-debt-events", landlordId] });
      setAdding(false);
      setDraft({ eventType: "refinance" });
      toast({ title: "Debt event added" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/landlord-debt-events/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/landlord-debt-events", landlordId] }),
  });

  return (
    <div className="border-t pt-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] text-muted-foreground">Debt / capital events ({events.length})</div>
        <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setAdding(!adding)}>
          <Plus className="w-3 h-3" />
        </Button>
      </div>
      {adding && (
        <div className="bg-muted/30 rounded p-2 mb-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            <select className="h-7 text-xs border rounded bg-background px-2" value={draft.eventType || "refinance"} onChange={(e) => setDraft({ ...draft, eventType: e.target.value })}>
              {DEBT_EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Input type="date" value={draft.eventDate?.slice(0, 10) || ""} onChange={(e) => setDraft({ ...draft, eventDate: e.target.value || null })} className="h-7 text-xs" />
            <Input placeholder="Lender" value={draft.lender || ""} onChange={(e) => setDraft({ ...draft, lender: e.target.value })} className="h-7 text-xs" />
            <Input type="number" placeholder="£m" value={draft.amount ?? ""} onChange={(e) => setDraft({ ...draft, amount: e.target.value ? parseFloat(e.target.value) : null })} className="h-7 text-xs" />
          </div>
          <Textarea placeholder="Notes" value={draft.notes || ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className="text-xs min-h-[40px]" />
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" className="h-6 text-[10px]" onClick={() => addMutation.mutate()} disabled={addMutation.isPending}>Add</Button>
          </div>
        </div>
      )}
      {events.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">No events recorded</div>
      ) : (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {events.map((e) => (
            <div key={e.id} className="flex justify-between text-xs border-b border-border/40 pb-1 group">
              <div className="flex-1 truncate">
                <Badge variant="outline" className="text-[10px] mr-1">{e.eventType}</Badge>
                <span className="text-muted-foreground">{e.eventDate?.slice(0, 10) || ""}</span>
                {e.lender && <span> · {e.lender}</span>}
                {e.amount && <span> · £{e.amount}m</span>}
                {e.notes && <span className="text-muted-foreground"> — {e.notes}</span>}
              </div>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100" onClick={() => deleteMutation.mutate(e.id)}>
                <Trash2 className="w-3 h-3 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
