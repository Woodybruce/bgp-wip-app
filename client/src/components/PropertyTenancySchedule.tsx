import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Building2, Upload, Download, Plus, Trash2, Search, ChevronDown, ChevronRight,
  Link2, FileSpreadsheet, X, Loader2, Lock, ExternalLink
} from "lucide-react";

interface TenancyUnit {
  id: number;
  property_id: string;
  premises: string;
  unit_number: string;
  tenant_name: string;
  trading_name: string;
  permitted_use: string;
  area_basement: number;
  area_ground: number;
  area_first: number;
  area_second: number;
  area_other: number;
  nia_sqft: number;
  gia_sqft: number;
  passing_rent_pa: number;
  rent_psf: number;
  turnover_percent: number;
  landlord_shortfall: number;
  net_income: number;
  epc_rating: string;
  blended_erv: number;
  erv_pa: number;
  lease_start: string;
  term_years: number;
  lease_expiry: string;
  rent_review_1_date: string;
  rent_review_1_amount: string;
  rent_review_2_date: string;
  rent_review_2_amount: string;
  rent_review_3_date: string;
  rent_review_3_amount: string;
  rent_review_4_date: string;
  rent_review_4_amount: string;
  outside_lt_act: string;
  break_type: string;
  break_date: string;
  wault_rent_percent: number;
  unexpired_term: number;
  service_charge: number;
  insurance: number;
  total_occ_costs: number;
  occ_costs_psf: number;
  status: string;
  deal_id: string | null;
  letting_tracker_unit_id: string | null;
  sort_order: number;
}

interface DealLink {
  id: string;
  name: string;
  status: string;
  tenant_id: string;
  rent_pa: number;
}

interface LettingLink {
  id: string;
  unit_name: string;
  marketing_status: string;
  dealId: string | null;
}

function fmtCurrency(v: number | string) {
  const n = Number(v);
  if (!n) return "—";
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtNum(v: number | string, dp = 0) {
  const n = Number(v);
  if (!n) return "—";
  return n.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtDate(v: string) {
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return v; }
}

function InlineEdit({ value, field, unitId, onSave, type = "text", className = "" }: {
  value: string; field: string; unitId: number; onSave: (id: number, field: string, val: string) => void;
  type?: string; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const inputRef = useRef<HTMLInputElement>(null);

  if (!editing) {
    return (
      <span
        className={`cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 px-1 rounded text-xs ${className}`}
        onClick={() => { setVal(value || ""); setEditing(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        data-testid={`tenancy-cell-${field}-${unitId}`}
      >
        {type === "number" ? (field.includes("rent") || field.includes("income") || field.includes("charge") || field.includes("insurance") || field.includes("occ_costs") || field.includes("erv") || field.includes("shortfall") ? fmtCurrency(value) : fmtNum(value, field.includes("psf") || field.includes("percent") || field.includes("term") ? 2 : 0)) : (field.includes("lease_start") || field.includes("lease_expiry") ? fmtDate(value) : (value || "—"))}
      </span>
    );
  }

  return (
    <Input
      ref={inputRef}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { setEditing(false); if (val !== (value || "")) onSave(unitId, field, val); }}
      onKeyDown={(e) => { if (e.key === "Enter") { setEditing(false); if (val !== (value || "")) onSave(unitId, field, val); } if (e.key === "Escape") setEditing(false); }}
      className="h-6 text-xs px-1 py-0 w-full"
      type={type === "number" ? "number" : "text"}
      data-testid={`tenancy-input-${field}-${unitId}`}
    />
  );
}

export function PropertyTenancySchedule({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set(["__all__"]));
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: units = [], isLoading, error: unitsError } = useQuery<TenancyUnit[]>({
    queryKey: ["/api/tenancy-schedule/property", propertyId],
    queryFn: async () => {
      const r = await fetch(`/api/tenancy-schedule/property/${propertyId}`, { headers: getAuthHeaders() });
      if (r.status === 403) throw new Error("ACCESS_DENIED");
      if (!r.ok) throw new Error("LOAD_FAILED");
      return r.json();
    },
    enabled: !!propertyId,
    retry: false,
  });

  const { data: links } = useQuery<{ deals: DealLink[]; lettingUnits: LettingLink[] }>({
    queryKey: ["/api/tenancy-schedule/property", propertyId, "links"],
    queryFn: async () => {
      const r = await fetch(`/api/tenancy-schedule/property/${propertyId}/links`, { headers: getAuthHeaders() });
      if (!r.ok) return { deals: [], lettingUnits: [] };
      return r.json();
    },
    enabled: !!propertyId,
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/tenancy-schedule/unit/${data.id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] }); },
    onError: (err: any) => { toast({ title: "Update failed", description: err.message, variant: "destructive" }); },
  });

  const addMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/tenancy-schedule/unit", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
      setShowAddUnit(false);
      toast({ title: "Unit added" });
    },
    onError: (err: any) => { toast({ title: "Failed to add unit", description: err.message, variant: "destructive" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/tenancy-schedule/unit/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
      toast({ title: "Unit removed" });
    },
    onError: (err: any) => { toast({ title: "Failed to delete unit", description: err.message, variant: "destructive" }); },
  });

  const inlineUpdate = useCallback((unitId: number, field: string, value: string) => {
    updateMutation.mutate({ id: unitId, [field]: value });
  }, [updateMutation]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("propertyId", propertyId);
      formData.append("clearExisting", units.length > 0 ? "true" : "false");
      const r = await fetch("/api/tenancy-schedule/import-excel", {
        method: "POST",
        headers: { Authorization: getAuthHeaders().Authorization },
        body: formData,
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      toast({ title: "Import complete", description: result.message });
      queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExport = async () => {
    try {
      const r = await fetch(`/api/tenancy-schedule/property/${propertyId}/export-excel`, { headers: getAuthHeaders() });
      if (!r.ok) throw new Error("Export failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = r.headers.get("content-disposition");
      a.download = cd?.match(/filename="(.+)"/)?.[1] || "Tenancy_Schedule.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Excel exported" });
    } catch { toast({ title: "Export failed", variant: "destructive" }); }
  };

  const toggleZone = (zone: string) => {
    setExpandedZones(prev => {
      const next = new Set(prev);
      if (next.has(zone)) next.delete(zone); else next.add(zone);
      return next;
    });
  };

  const toggleRow = (id: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading tenancy schedule...</div>;

  if (unitsError) {
    const isAccessDenied = (unitsError as Error)?.message === "ACCESS_DENIED";
    return (
      <div className="space-y-3" data-testid="property-tenancy-schedule">
        <h3 className="font-semibold text-sm flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" />Tenancy Schedule</h3>
        <div className="text-center py-6 text-gray-400 border rounded-lg">
          <Lock className="w-6 h-6 mx-auto mb-1 opacity-40" />
          <p className="text-xs">{isAccessDenied ? "Access restricted" : "Failed to load"}</p>
        </div>
      </div>
    );
  }

  const filtered = units.filter(u => {
    if (statusFilter && u.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return [u.unit_number, u.tenant_name, u.trading_name, u.premises, u.permitted_use].some(f => f?.toLowerCase().includes(s));
    }
    return true;
  });

  const zones = [...new Set(filtered.map(u => u.premises || "Unassigned"))];
  const occupied = units.filter(u => u.status === "Occupied").length;
  const vacant = units.filter(u => u.status === "Vacant").length;
  const totalNIA = units.reduce((s, u) => s + Number(u.nia_sqft || 0), 0);
  const totalRent = units.reduce((s, u) => s + Number(u.passing_rent_pa || 0), 0);
  const totalSC = units.reduce((s, u) => s + Number(u.service_charge || 0), 0);
  const avgERV = units.length ? units.reduce((s, u) => s + Number(u.blended_erv || 0), 0) / units.length : 0;
  const avgWAULT = units.filter(u => Number(u.unexpired_term) > 0).length
    ? units.filter(u => Number(u.unexpired_term) > 0).reduce((s, u) => s + Number(u.unexpired_term), 0) / units.filter(u => Number(u.unexpired_term) > 0).length
    : 0;

  const matchDeal = (unit: TenancyUnit): DealLink | undefined => {
    if (unit.deal_id) return links?.deals.find(d => d.id === unit.deal_id);
    return links?.deals.find(d => d.name?.toLowerCase().includes(unit.unit_number?.toLowerCase()) || d.name?.toLowerCase().includes(unit.trading_name?.toLowerCase()));
  };

  const matchLetting = (unit: TenancyUnit): LettingLink | undefined => {
    if (unit.letting_tracker_unit_id) return links?.lettingUnits.find(l => l.id === unit.letting_tracker_unit_id);
    return links?.lettingUnits.find(l => l.unit_name?.toLowerCase().includes(unit.unit_number?.toLowerCase()));
  };

  if (units.length === 0 && !showAddUnit) {
    return (
      <div className="space-y-3" data-testid="property-tenancy-schedule">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" />Tenancy Schedule
          </h3>
          <div className="flex gap-2">
            <input type="file" ref={fileInputRef} accept=".xlsx,.xls" onChange={handleImport} className="hidden" />
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fileInputRef.current?.click()} disabled={importing} data-testid="btn-import-tenancy">
              {importing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Upload className="w-3 h-3 mr-1" />}Import Excel
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAddUnit(true)} data-testid="btn-add-tenancy-unit">
              <Plus className="w-3 h-3 mr-1" />Add Unit
            </Button>
          </div>
        </div>
        <div className="text-center py-8 text-gray-400 border rounded-lg border-dashed">
          <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-xs">No tenancy schedule data</p>
          <p className="text-xs mt-1">Import an Excel tenancy schedule or add units manually</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="property-tenancy-schedule">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4" />Tenancy Schedule
          <Badge variant="secondary" className="text-[10px]">{units.length} units</Badge>
        </h3>
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="h-7 text-xs pl-7 w-40" data-testid="tenancy-search" />
          </div>
          <input type="file" ref={fileInputRef} accept=".xlsx,.xls" onChange={handleImport} className="hidden" />
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => fileInputRef.current?.click()} disabled={importing} data-testid="btn-import-tenancy">
            {importing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Upload className="w-3 h-3 mr-1" />}Import
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExport} data-testid="btn-export-tenancy">
            <Download className="w-3 h-3 mr-1" />Excel
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAddUnit(true)} data-testid="btn-add-tenancy-unit">
            <Plus className="w-3 h-3 mr-1" />Add
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {[
          { label: "Total NIA", value: fmtNum(totalNIA) + " sqft", filter: null },
          { label: "Passing Rent", value: fmtCurrency(totalRent), filter: null },
          { label: "Avg ERV £psf", value: fmtNum(avgERV, 0), filter: null },
          { label: "WAULT", value: fmtNum(avgWAULT, 1) + " yrs", filter: null },
          { label: "Occupied", value: String(occupied), filter: "Occupied" },
          { label: "Vacant", value: String(vacant), filter: "Vacant" },
          { label: "Service Charge", value: fmtCurrency(totalSC), filter: null },
        ].map(s => (
          <div
            key={s.label}
            className={`bg-gray-50 dark:bg-gray-800 rounded-lg p-2 text-center ${s.filter ? "cursor-pointer hover:ring-1 ring-blue-400" : ""} ${statusFilter === s.filter ? "ring-2 ring-blue-500" : ""}`}
            onClick={() => s.filter && setStatusFilter(statusFilter === s.filter ? null : s.filter)}
            data-testid={`tenancy-stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}
          >
            <div className="text-[10px] text-gray-500 uppercase">{s.label}</div>
            <div className="text-sm font-semibold">{s.value}</div>
          </div>
        ))}
      </div>

      {showAddUnit && (
        <AddTenancyUnitForm
          propertyId={propertyId}
          onAdd={(data) => addMutation.mutate(data)}
          onCancel={() => setShowAddUnit(false)}
          isPending={addMutation.isPending}
        />
      )}

      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 border-b">
              <th className="text-left p-2 font-medium w-6"></th>
              <th className="text-left p-2 font-medium min-w-[80px]">Unit</th>
              <th className="text-left p-2 font-medium min-w-[120px]">Tenant</th>
              <th className="text-left p-2 font-medium min-w-[100px]">Trading Name</th>
              <th className="text-left p-2 font-medium">Use</th>
              <th className="text-right p-2 font-medium">NIA sqft</th>
              <th className="text-right p-2 font-medium">Rent PA</th>
              <th className="text-right p-2 font-medium">£ psf</th>
              <th className="text-right p-2 font-medium">ERV PA</th>
              <th className="text-center p-2 font-medium">EPC</th>
              <th className="text-center p-2 font-medium">Lease Start</th>
              <th className="text-center p-2 font-medium">Expiry</th>
              <th className="text-center p-2 font-medium">Break</th>
              <th className="text-right p-2 font-medium">WAULT</th>
              <th className="text-center p-2 font-medium">Status</th>
              <th className="text-center p-2 font-medium">Links</th>
              <th className="text-center p-2 font-medium w-8"></th>
            </tr>
          </thead>
          <tbody>
            {zones.map(zone => {
              const zoneUnits = filtered.filter(u => (u.premises || "Unassigned") === zone);
              const isExpanded = expandedZones.has("__all__") || expandedZones.has(zone);
              return (
                <ZoneGroup
                  key={zone}
                  zone={zone}
                  units={zoneUnits}
                  isExpanded={isExpanded}
                  expandedRows={expandedRows}
                  onToggleZone={() => toggleZone(zone)}
                  onToggleRow={toggleRow}
                  onInlineUpdate={inlineUpdate}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  matchDeal={matchDeal}
                  matchLetting={matchLetting}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ZoneGroup({ zone, units, isExpanded, expandedRows, onToggleZone, onToggleRow, onInlineUpdate, onDelete, matchDeal, matchLetting }: {
  zone: string; units: TenancyUnit[]; isExpanded: boolean; expandedRows: Set<number>;
  onToggleZone: () => void; onToggleRow: (id: number) => void;
  onInlineUpdate: (id: number, field: string, val: string) => void;
  onDelete: (id: number) => void;
  matchDeal: (u: TenancyUnit) => DealLink | undefined;
  matchLetting: (u: TenancyUnit) => LettingLink | undefined;
}) {
  if (units.length === 0) return null;
  const zoneRent = units.reduce((s, u) => s + Number(u.passing_rent_pa || 0), 0);

  return (
    <>
      <tr className="bg-gray-100 dark:bg-gray-700/50 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700" onClick={onToggleZone}>
        <td colSpan={3} className="p-2 font-semibold text-xs">
          {isExpanded ? <ChevronDown className="w-3 h-3 inline mr-1" /> : <ChevronRight className="w-3 h-3 inline mr-1" />}
          {zone}
          <Badge variant="secondary" className="ml-2 text-[10px]">{units.length}</Badge>
        </td>
        <td colSpan={3}></td>
        <td className="text-right p-2 font-semibold text-xs">{fmtCurrency(zoneRent)}</td>
        <td colSpan={10}></td>
      </tr>
      {isExpanded && units.map(unit => (
        <UnitRow
          key={unit.id}
          unit={unit}
          isExpanded={expandedRows.has(unit.id)}
          onToggle={() => onToggleRow(unit.id)}
          onUpdate={onInlineUpdate}
          onDelete={() => onDelete(unit.id)}
          deal={matchDeal(unit)}
          letting={matchLetting(unit)}
        />
      ))}
    </>
  );
}

function UnitRow({ unit, isExpanded, onToggle, onUpdate, onDelete, deal, letting }: {
  unit: TenancyUnit; isExpanded: boolean; onToggle: () => void;
  onUpdate: (id: number, field: string, val: string) => void;
  onDelete: () => void;
  deal?: DealLink; letting?: LettingLink;
}) {
  const isVacant = unit.status === "Vacant";

  return (
    <>
      <tr className={`border-b hover:bg-gray-50 dark:hover:bg-gray-800/50 ${isVacant ? "bg-amber-50/30 dark:bg-amber-900/10" : ""}`} data-testid={`tenancy-row-${unit.id}`}>
        <td className="p-1 text-center">
          <button onClick={onToggle} className="hover:bg-gray-200 dark:hover:bg-gray-600 rounded p-0.5" data-testid={`tenancy-expand-${unit.id}`}>
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        </td>
        <td className="p-1"><InlineEdit value={unit.unit_number} field="unit_number" unitId={unit.id} onSave={onUpdate} /></td>
        <td className="p-1"><InlineEdit value={unit.tenant_name} field="tenant_name" unitId={unit.id} onSave={onUpdate} className={isVacant ? "text-amber-600 font-medium" : ""} /></td>
        <td className="p-1"><InlineEdit value={unit.trading_name} field="trading_name" unitId={unit.id} onSave={onUpdate} /></td>
        <td className="p-1"><InlineEdit value={unit.permitted_use} field="permitted_use" unitId={unit.id} onSave={onUpdate} /></td>
        <td className="p-1 text-right"><InlineEdit value={String(unit.nia_sqft)} field="nia_sqft" unitId={unit.id} onSave={onUpdate} type="number" /></td>
        <td className="p-1 text-right"><InlineEdit value={String(unit.passing_rent_pa)} field="passing_rent_pa" unitId={unit.id} onSave={onUpdate} type="number" /></td>
        <td className="p-1 text-right"><InlineEdit value={String(unit.rent_psf)} field="rent_psf" unitId={unit.id} onSave={onUpdate} type="number" /></td>
        <td className="p-1 text-right"><InlineEdit value={String(unit.erv_pa)} field="erv_pa" unitId={unit.id} onSave={onUpdate} type="number" /></td>
        <td className="p-1 text-center"><InlineEdit value={unit.epc_rating} field="epc_rating" unitId={unit.id} onSave={onUpdate} /></td>
        <td className="p-1 text-center"><InlineEdit value={unit.lease_start} field="lease_start" unitId={unit.id} onSave={onUpdate} /></td>
        <td className="p-1 text-center"><InlineEdit value={unit.lease_expiry} field="lease_expiry" unitId={unit.id} onSave={onUpdate} /></td>
        <td className="p-1 text-center"><InlineEdit value={unit.break_date} field="break_date" unitId={unit.id} onSave={onUpdate} /></td>
        <td className="p-1 text-right">{fmtNum(unit.unexpired_term, 1)}</td>
        <td className="p-1 text-center">
          <Badge variant={isVacant ? "destructive" : "default"} className="text-[10px] cursor-pointer" onClick={() => onUpdate(unit.id, "status", isVacant ? "Occupied" : "Vacant")} data-testid={`tenancy-status-${unit.id}`}>
            {unit.status}
          </Badge>
        </td>
        <td className="p-1 text-center">
          <div className="flex gap-1 justify-center">
            {deal && (
              <a href={`/deals?id=${deal.id}`} className="inline-flex items-center" title={`Deal: ${deal.name} (${deal.status})`} data-testid={`tenancy-deal-link-${unit.id}`}>
                <Badge variant="outline" className="text-[9px] gap-0.5 cursor-pointer hover:bg-blue-50"><Link2 className="w-2.5 h-2.5" />WIP</Badge>
              </a>
            )}
            {letting && (
              <a href={`/available`} className="inline-flex items-center" title={`Letting: ${letting.unit_name} (${letting.marketing_status})`} data-testid={`tenancy-letting-link-${unit.id}`}>
                <Badge variant="outline" className="text-[9px] gap-0.5 cursor-pointer hover:bg-green-50"><ExternalLink className="w-2.5 h-2.5" />LT</Badge>
              </a>
            )}
          </div>
        </td>
        <td className="p-1 text-center">
          <button onClick={onDelete} className="text-red-400 hover:text-red-600 p-0.5" data-testid={`tenancy-delete-${unit.id}`}>
            <Trash2 className="w-3 h-3" />
          </button>
        </td>
      </tr>
      {isExpanded && <ExpandedDetails unit={unit} onUpdate={onUpdate} />}
    </>
  );
}

function ExpandedDetails({ unit, onUpdate }: { unit: TenancyUnit; onUpdate: (id: number, field: string, val: string) => void }) {
  return (
    <tr className="bg-gray-50/50 dark:bg-gray-800/30 border-b" data-testid={`tenancy-detail-${unit.id}`}>
      <td colSpan={17} className="p-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <div className="font-semibold text-[10px] uppercase text-gray-500 mb-1">Floor Areas</div>
            <div className="grid grid-cols-2 gap-1">
              <span className="text-gray-500">Basement:</span><InlineEdit value={String(unit.area_basement)} field="area_basement" unitId={unit.id} onSave={onUpdate} type="number" />
              <span className="text-gray-500">Ground:</span><InlineEdit value={String(unit.area_ground)} field="area_ground" unitId={unit.id} onSave={onUpdate} type="number" />
              <span className="text-gray-500">First:</span><InlineEdit value={String(unit.area_first)} field="area_first" unitId={unit.id} onSave={onUpdate} type="number" />
              <span className="text-gray-500">Second:</span><InlineEdit value={String(unit.area_second)} field="area_second" unitId={unit.id} onSave={onUpdate} type="number" />
              <span className="text-gray-500">Other:</span><InlineEdit value={String(unit.area_other)} field="area_other" unitId={unit.id} onSave={onUpdate} type="number" />
              <span className="text-gray-500">GIA:</span><InlineEdit value={String(unit.gia_sqft)} field="gia_sqft" unitId={unit.id} onSave={onUpdate} type="number" />
            </div>
          </div>
          <div>
            <div className="font-semibold text-[10px] uppercase text-gray-500 mb-1">Rent Reviews</div>
            <div className="grid grid-cols-2 gap-1">
              <span className="text-gray-500">RR1:</span><span><InlineEdit value={unit.rent_review_1_date} field="rent_review_1_date" unitId={unit.id} onSave={onUpdate} /> — <InlineEdit value={unit.rent_review_1_amount} field="rent_review_1_amount" unitId={unit.id} onSave={onUpdate} /></span>
              <span className="text-gray-500">RR2:</span><span><InlineEdit value={unit.rent_review_2_date} field="rent_review_2_date" unitId={unit.id} onSave={onUpdate} /> — <InlineEdit value={unit.rent_review_2_amount} field="rent_review_2_amount" unitId={unit.id} onSave={onUpdate} /></span>
              <span className="text-gray-500">RR3:</span><span><InlineEdit value={unit.rent_review_3_date} field="rent_review_3_date" unitId={unit.id} onSave={onUpdate} /> — <InlineEdit value={unit.rent_review_3_amount} field="rent_review_3_amount" unitId={unit.id} onSave={onUpdate} /></span>
              <span className="text-gray-500">RR4:</span><span><InlineEdit value={unit.rent_review_4_date} field="rent_review_4_date" unitId={unit.id} onSave={onUpdate} /> — <InlineEdit value={unit.rent_review_4_amount} field="rent_review_4_amount" unitId={unit.id} onSave={onUpdate} /></span>
              <span className="text-gray-500">Outside L&T:</span><InlineEdit value={unit.outside_lt_act} field="outside_lt_act" unitId={unit.id} onSave={onUpdate} />
              <span className="text-gray-500">Break Type:</span><InlineEdit value={unit.break_type} field="break_type" unitId={unit.id} onSave={onUpdate} />
            </div>
          </div>
          <div>
            <div className="font-semibold text-[10px] uppercase text-gray-500 mb-1">Income & Costs</div>
            <div className="grid grid-cols-2 gap-1">
              <span className="text-gray-500">Turnover %:</span><InlineEdit value={String(unit.turnover_percent)} field="turnover_percent" unitId={unit.id} onSave={onUpdate} type="number" />
              <span className="text-gray-500">LL Shortfall:</span><InlineEdit value={String(unit.landlord_shortfall)} field="landlord_shortfall" unitId={unit.id} onSave={onUpdate} type="number" />
              <span className="text-gray-500">Net Income:</span><InlineEdit value={String(unit.net_income)} field="net_income" unitId={unit.id} onSave={onUpdate} type="number" />
              <span className="text-gray-500">Service Charge:</span><InlineEdit value={String(unit.service_charge)} field="service_charge" unitId={unit.id} onSave={onUpdate} type="number" />
              <span className="text-gray-500">Insurance:</span><InlineEdit value={String(unit.insurance)} field="insurance" unitId={unit.id} onSave={onUpdate} type="number" />
              <span className="text-gray-500">Total Occ Costs:</span><InlineEdit value={String(unit.total_occ_costs)} field="total_occ_costs" unitId={unit.id} onSave={onUpdate} type="number" />
              <span className="text-gray-500">Occ Costs £psf:</span><InlineEdit value={String(unit.occ_costs_psf)} field="occ_costs_psf" unitId={unit.id} onSave={onUpdate} type="number" />
              <span className="text-gray-500">Blended ERV:</span><InlineEdit value={String(unit.blended_erv)} field="blended_erv" unitId={unit.id} onSave={onUpdate} type="number" />
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function AddTenancyUnitForm({ propertyId, onAdd, onCancel, isPending }: {
  propertyId: string; onAdd: (data: any) => void; onCancel: () => void; isPending: boolean;
}) {
  const [form, setForm] = useState({
    unit_number: "", tenant_name: "", trading_name: "", permitted_use: "", premises: "",
    nia_sqft: "", passing_rent_pa: "", status: "Occupied"
  });

  return (
    <div className="border rounded-lg p-3 bg-gray-50 dark:bg-gray-800 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Add Unit</span>
        <button onClick={onCancel}><X className="w-3 h-3" /></button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Input placeholder="Unit Number" value={form.unit_number} onChange={e => setForm({ ...form, unit_number: e.target.value })} className="h-7 text-xs" data-testid="add-tenancy-unit-number" />
        <Input placeholder="Tenant Name" value={form.tenant_name} onChange={e => setForm({ ...form, tenant_name: e.target.value })} className="h-7 text-xs" data-testid="add-tenancy-tenant" />
        <Input placeholder="Trading Name" value={form.trading_name} onChange={e => setForm({ ...form, trading_name: e.target.value })} className="h-7 text-xs" data-testid="add-tenancy-trading" />
        <Input placeholder="Permitted Use" value={form.permitted_use} onChange={e => setForm({ ...form, permitted_use: e.target.value })} className="h-7 text-xs" data-testid="add-tenancy-use" />
        <Input placeholder="Zone/Premises" value={form.premises} onChange={e => setForm({ ...form, premises: e.target.value })} className="h-7 text-xs" data-testid="add-tenancy-premises" />
        <Input placeholder="NIA sqft" value={form.nia_sqft} onChange={e => setForm({ ...form, nia_sqft: e.target.value })} className="h-7 text-xs" type="number" data-testid="add-tenancy-sqft" />
        <Input placeholder="Rent PA" value={form.passing_rent_pa} onChange={e => setForm({ ...form, passing_rent_pa: e.target.value })} className="h-7 text-xs" type="number" data-testid="add-tenancy-rent" />
        <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="h-7 text-xs border rounded px-2 bg-white dark:bg-gray-700" data-testid="add-tenancy-status">
          <option value="Occupied">Occupied</option>
          <option value="Vacant">Vacant</option>
        </select>
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="h-7 text-xs" onClick={() => onAdd({ ...form, property_id: propertyId })} disabled={isPending || !form.unit_number} data-testid="btn-save-tenancy-unit">
          {isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}Save
        </Button>
      </div>
    </div>
  );
}
