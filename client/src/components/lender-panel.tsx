import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pencil, Check, X, Building2, Landmark, TrendingUp, FileText } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CrmCompany } from "@shared/schema";

const LENDER_TYPE_LABELS: Record<string, string> = {
  clearing_bank: "Clearing Bank",
  investment_bank: "Investment Bank",
  insurance: "Insurance",
  pension: "Pension",
  debt_fund: "Debt Fund",
  private_credit: "Private Credit",
  mezzanine: "Mezzanine",
  bridging: "Bridging",
  development: "Development",
  building_society: "Building Society",
};

const LENDER_TYPE_COLOURS: Record<string, string> = {
  clearing_bank: "bg-blue-50 text-blue-700 border-blue-200",
  investment_bank: "bg-indigo-50 text-indigo-700 border-indigo-200",
  insurance: "bg-purple-50 text-purple-700 border-purple-200",
  pension: "bg-violet-50 text-violet-700 border-violet-200",
  debt_fund: "bg-emerald-50 text-emerald-700 border-emerald-200",
  private_credit: "bg-teal-50 text-teal-700 border-teal-200",
  mezzanine: "bg-orange-50 text-orange-700 border-orange-200",
  bridging: "bg-amber-50 text-amber-700 border-amber-200",
  development: "bg-yellow-50 text-yellow-700 border-yellow-200",
  building_society: "bg-slate-50 text-slate-700 border-slate-200",
};

const ASSET_CLASS_OPTIONS = ["Office", "Retail", "Industrial", "Residential", "Mixed Use", "Hotel", "Student", "Healthcare", "BTR"];
const GEOGRAPHY_OPTIONS = ["London", "SE England", "UK Wide", "International"];
const LOAN_TERM_OPTIONS = ["Short (<3y)", "Medium (3-7y)", "Long (7y+)"];
const LOAN_STRUCTURE_OPTIONS = ["Senior", "Mezzanine", "Whole Loan", "Construction"];
const RECOURSE_OPTIONS = ["Full", "Limited", "Non-recourse"];
const LENDER_TYPE_OPTIONS = Object.keys(LENDER_TYPE_LABELS);

type SecuredProperty = {
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  interestType: "senior" | "junior";
  dealId?: string;
  dealName?: string;
};

type LrCharge = {
  titleNumber: string;
  propertyId?: string;
  propertyName?: string;
  chargeDate: string;
  amount?: number;
  notes?: string;
};

type FormState = {
  lenderType: string;
  lendingActive: boolean;
  typicalLoanSizeMinM: string;
  typicalLoanSizeMaxM: string;
  typicalLtvMax: string;
  typicalMarginBps: string;
  typicalLoanTerm: string;
  typicalLoanStructure: string;
  recourse: string;
  preferredAssetClasses: string[];
  preferredGeographies: string[];
  lendingAppetiteNotes: string;
};

function buildForm(company: CrmCompany): FormState {
  const c = company as any;
  return {
    lenderType: c.lenderType || "",
    lendingActive: c.lendingActive ?? true,
    typicalLoanSizeMinM: c.typicalLoanSizeMinM != null ? String(c.typicalLoanSizeMinM) : "",
    typicalLoanSizeMaxM: c.typicalLoanSizeMaxM != null ? String(c.typicalLoanSizeMaxM) : "",
    typicalLtvMax: c.typicalLtvMax != null ? String(c.typicalLtvMax) : "",
    typicalMarginBps: c.typicalMarginBps != null ? String(c.typicalMarginBps) : "",
    typicalLoanTerm: c.typicalLoanTerm || "",
    typicalLoanStructure: c.typicalLoanStructure || "",
    recourse: c.recourse || "",
    preferredAssetClasses: c.preferredAssetClasses || [],
    preferredGeographies: c.preferredGeographies || [],
    lendingAppetiteNotes: c.lendingAppetiteNotes || "",
  };
}

export function LenderPanel({ companyId, company }: { companyId: string; company: CrmCompany }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(buildForm(company));

  const c = company as any;

  const { data: securedProperties = [] } = useQuery<SecuredProperty[]>({
    queryKey: ["/api/lenders/secured-properties", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/lenders/secured-properties?companyId=${companyId}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: lrCharges = [] } = useQuery<LrCharge[]>({
    queryKey: ["/api/lenders/lr-charges", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/lenders/lr-charges?companyId=${companyId}`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  const startEdit = () => {
    setForm(buildForm(company));
    setEditing(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        lender_type: form.lenderType || null,
        lending_active: form.lendingActive,
        typical_loan_size_min_m: form.typicalLoanSizeMinM !== "" ? parseFloat(form.typicalLoanSizeMinM) : null,
        typical_loan_size_max_m: form.typicalLoanSizeMaxM !== "" ? parseFloat(form.typicalLoanSizeMaxM) : null,
        typical_ltv_max: form.typicalLtvMax !== "" ? parseFloat(form.typicalLtvMax) : null,
        typical_margin_bps: form.typicalMarginBps !== "" ? parseInt(form.typicalMarginBps, 10) : null,
        typical_loan_term: form.typicalLoanTerm || null,
        typical_loan_structure: form.typicalLoanStructure || null,
        recourse: form.recourse || null,
        preferred_asset_classes: form.preferredAssetClasses,
        preferred_geographies: form.preferredGeographies,
        lending_appetite_notes: form.lendingAppetiteNotes || null,
      };
      return apiRequest("PATCH", `/api/crm/companies/${companyId}`, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      setEditing(false);
      toast({ title: "Lender profile saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const toggleArray = (key: "preferredAssetClasses" | "preferredGeographies", value: string) => {
    setForm((f) => {
      const current = f[key];
      return { ...f, [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] };
    });
  };

  const lenderTypeColour = LENDER_TYPE_COLOURS[c.lenderType] || "bg-slate-50 text-slate-700 border-slate-200";
  const lenderTypeLabel = LENDER_TYPE_LABELS[c.lenderType] || c.lenderType || "—";

  return (
    <Card data-testid="lender-panel">
      <CardHeader className="p-3 pb-2 flex flex-row items-start justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Landmark className="w-4 h-4 text-blue-600" />
          Lender Profile
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={editing ? () => setEditing(false) : startEdit}>
          {editing ? <X className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
        </Button>
      </CardHeader>

      <CardContent className="p-3 pt-0">
        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="h-8">
            <TabsTrigger value="profile" className="text-xs">Profile</TabsTrigger>
            <TabsTrigger value="secured" className="text-xs">Secured Properties</TabsTrigger>
            <TabsTrigger value="charges" className="text-xs">LR Charges</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-3 mt-2">
            {editing ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px]">Lender Type</Label>
                    <select
                      className="h-8 text-xs w-full border rounded-md bg-background px-2"
                      value={form.lenderType}
                      onChange={(e) => setForm({ ...form, lenderType: e.target.value })}
                    >
                      <option value="">—</option>
                      {LENDER_TYPE_OPTIONS.map((t) => (
                        <option key={t} value={t}>{LENDER_TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-[10px]">Currently Lending</Label>
                    <div className="flex items-center gap-2 mt-1.5">
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, lendingActive: !form.lendingActive })}
                        className={`px-2 py-0.5 rounded text-xs border font-medium transition-colors ${form.lendingActive ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}
                      >
                        {form.lendingActive ? "Active" : "Paused"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-2 space-y-2">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Loan Parameters</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px]">Loan size min (£m)</Label>
                      <Input
                        type="number"
                        value={form.typicalLoanSizeMinM}
                        onChange={(e) => setForm({ ...form, typicalLoanSizeMinM: e.target.value })}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Loan size max (£m)</Label>
                      <Input
                        type="number"
                        value={form.typicalLoanSizeMaxM}
                        onChange={(e) => setForm({ ...form, typicalLoanSizeMaxM: e.target.value })}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Max LTV (%)</Label>
                      <Input
                        type="number"
                        value={form.typicalLtvMax}
                        onChange={(e) => setForm({ ...form, typicalLtvMax: e.target.value })}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Margin (bps)</Label>
                      <Input
                        type="number"
                        value={form.typicalMarginBps}
                        onChange={(e) => setForm({ ...form, typicalMarginBps: e.target.value })}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Loan term</Label>
                      <select
                        className="h-8 text-xs w-full border rounded-md bg-background px-2"
                        value={form.typicalLoanTerm}
                        onChange={(e) => setForm({ ...form, typicalLoanTerm: e.target.value })}
                      >
                        <option value="">—</option>
                        {LOAN_TERM_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label className="text-[10px]">Loan structure</Label>
                      <select
                        className="h-8 text-xs w-full border rounded-md bg-background px-2"
                        value={form.typicalLoanStructure}
                        onChange={(e) => setForm({ ...form, typicalLoanStructure: e.target.value })}
                      >
                        <option value="">—</option>
                        {LOAN_STRUCTURE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-[10px]">Recourse</Label>
                      <select
                        className="h-8 text-xs w-full border rounded-md bg-background px-2"
                        value={form.recourse}
                        onChange={(e) => setForm({ ...form, recourse: e.target.value })}
                      >
                        <option value="">—</option>
                        {RECOURSE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-2 space-y-2">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Mandate</div>
                  <div>
                    <Label className="text-[10px]">Preferred asset classes</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {ASSET_CLASS_OPTIONS.map((a) => (
                        <Badge
                          key={a}
                          variant={form.preferredAssetClasses.includes(a) ? "default" : "outline"}
                          className="cursor-pointer text-[10px]"
                          onClick={() => toggleArray("preferredAssetClasses", a)}
                        >
                          {a}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-[10px]">Preferred geographies</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {GEOGRAPHY_OPTIONS.map((g) => (
                        <Badge
                          key={g}
                          variant={form.preferredGeographies.includes(g) ? "default" : "outline"}
                          className="cursor-pointer text-[10px]"
                          onClick={() => toggleArray("preferredGeographies", g)}
                        >
                          {g}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="border-t pt-2">
                  <Label className="text-[10px]">Appetite notes</Label>
                  <Textarea
                    value={form.lendingAppetiteNotes}
                    onChange={(e) => setForm({ ...form, lendingAppetiteNotes: e.target.value })}
                    className="text-xs min-h-[60px] mt-1"
                    placeholder="Sectors, deal types, current appetite…"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                    <Check className="w-3.5 h-3.5 mr-1" /> Save
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="border border-border/40 rounded p-1.5">
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Lender Type</div>
                    {c.lenderType ? (
                      <Badge className={`text-[10px] border ${lenderTypeColour}`}>{lenderTypeLabel}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                  <div className="border border-border/40 rounded p-1.5">
                    <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-1">Currently Lending</div>
                    <Badge className={`text-[10px] border ${c.lendingActive !== false ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}>
                      {c.lendingActive !== false ? "Active" : "Paused"}
                    </Badge>
                  </div>
                </div>

                <div className="border-t pt-2 space-y-1.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Loan Parameters</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <StatRow label="Loan size" value={c.typicalLoanSizeMinM != null || c.typicalLoanSizeMaxM != null ? `£${c.typicalLoanSizeMinM ?? "?"}m – £${c.typicalLoanSizeMaxM ?? "?"}m` : "—"} />
                    <StatRow label="Max LTV" value={c.typicalLtvMax != null ? `${c.typicalLtvMax}%` : "—"} />
                    <StatRow label="Typical margin" value={c.typicalMarginBps != null ? `${c.typicalMarginBps}bps over SONIA` : "—"} />
                    <StatRow label="Loan term" value={c.typicalLoanTerm || "—"} />
                    <StatRow label="Structure" value={c.typicalLoanStructure || "—"} />
                    <StatRow label="Recourse" value={c.recourse || "—"} />
                  </div>
                </div>

                {(c.preferredAssetClasses?.length || c.preferredGeographies?.length) ? (
                  <div className="border-t pt-2 space-y-1.5">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Mandate</div>
                    {c.preferredAssetClasses?.length ? (
                      <div className="flex gap-1 flex-wrap items-center">
                        <span className="text-[10px] text-muted-foreground">Asset class:</span>
                        {c.preferredAssetClasses.map((a: string) => (
                          <Badge key={a} variant="outline" className="text-[10px]">{a}</Badge>
                        ))}
                      </div>
                    ) : null}
                    {c.preferredGeographies?.length ? (
                      <div className="flex gap-1 flex-wrap items-center">
                        <span className="text-[10px] text-muted-foreground">Geography:</span>
                        {c.preferredGeographies.map((g: string) => (
                          <Badge key={g} variant="outline" className="text-[10px]">{g}</Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {c.lendingAppetiteNotes ? (
                  <div className="border-t pt-2">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">Appetite Notes</div>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{c.lendingAppetiteNotes}</p>
                  </div>
                ) : null}
              </div>
            )}
          </TabsContent>

          <TabsContent value="secured" className="mt-2">
            {securedProperties.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No secured properties on record. Add this lender to a property's Ownership section to track secured interests.
              </p>
            ) : (
              <div className="space-y-1">
                {securedProperties.map((p) => (
                  <div key={p.propertyId} className="flex items-start justify-between gap-2 border-b border-border/40 pb-1.5">
                    <div className="flex-1 min-w-0">
                      <Link href={`/properties/${p.propertyId}`} className="text-xs font-medium text-blue-600 hover:underline truncate block">
                        {p.propertyName}
                      </Link>
                      <div className="text-[10px] text-muted-foreground truncate">{p.propertyAddress}</div>
                      {p.dealName && <div className="text-[10px] text-muted-foreground">{p.dealName}</div>}
                    </div>
                    <Badge
                      className={`text-[10px] border shrink-0 ${p.interestType === "senior" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-orange-50 text-orange-700 border-orange-200"}`}
                    >
                      {p.interestType === "senior" ? "Senior Lender" : "Junior Lender"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="charges" className="mt-2">
            {lrCharges.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No Land Registry charges on record.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40">
                      <th className="text-left text-[10px] text-muted-foreground font-medium pb-1 pr-2">Title No.</th>
                      <th className="text-left text-[10px] text-muted-foreground font-medium pb-1 pr-2">Property</th>
                      <th className="text-left text-[10px] text-muted-foreground font-medium pb-1 pr-2">Date</th>
                      <th className="text-left text-[10px] text-muted-foreground font-medium pb-1 pr-2">Amount</th>
                      <th className="text-left text-[10px] text-muted-foreground font-medium pb-1">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lrCharges.map((ch, i) => (
                      <tr key={i} className="border-b border-border/40 last:border-0">
                        <td className="py-1 pr-2 font-mono text-[10px]">{ch.titleNumber}</td>
                        <td className="py-1 pr-2">
                          {ch.propertyId ? (
                            <Link href={`/properties/${ch.propertyId}`} className="text-blue-600 hover:underline">
                              {ch.propertyName || ch.titleNumber}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">{ch.propertyName || "—"}</span>
                          )}
                        </td>
                        <td className="py-1 pr-2 text-muted-foreground">{ch.chargeDate ? ch.chargeDate.slice(0, 10) : "—"}</td>
                        <td className="py-1 pr-2">{ch.amount != null ? `£${ch.amount.toLocaleString()}` : "—"}</td>
                        <td className="py-1 text-muted-foreground">{ch.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-3">
              Charges are extracted from purchased Land Registry title registers.
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border/40 rounded p-1.5">
      <div className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-xs font-medium">{value}</div>
    </div>
  );
}
