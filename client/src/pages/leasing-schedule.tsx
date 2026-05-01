import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ViewToggle } from "@/components/mobile-card-view";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Building2, ChevronLeft, Search, Filter, Calendar, AlertTriangle,
  Edit2, Plus, Trash2, X, Check, MapPin, Users, TrendingUp,
  Clock, Target, Star, ChevronDown, ChevronRight, Loader2,
  Shield, ShieldCheck, ShieldOff, Download, Upload, History, Lock, Eye, ExternalLink,
  Sparkles, Circle, ThumbsUp, ThumbsDown, UserPlus,
} from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";

interface LeasingProperty {
  id: string;
  name: string;
  address: any;
  asset_class: string;
  bgp_engagement: string[];
  landlord_name: string;
  landlord_id: string;
  unit_count: number;
  occupied_count: number;
  vacant_count: number;
  expiring_soon: number;
  leasing_privacy_enabled: boolean;
}

interface AuditEntry {
  id: number;
  unit_id: string;
  property_id: string;
  user_name: string;
  action: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

interface LeasingUnit {
  id: string;
  property_id: string;
  property_name?: string;
  landlord_name?: string;
  zone: string;
  positioning: string;
  unit_name: string;
  tenant_name: string;
  agent_initials: string;
  lease_expiry: string | null;
  lease_break: string | null;
  rent_review: string | null;
  landlord_break: string | null;
  rent_pa: number | null;
  sqft: number | null;
  mat_psqft: string;
  lfl_percent: string;
  occ_cost_percent: string;
  financial_notes: string;
  target_brands: string;
  target_company_ids: string;
  optimum_target: string;
  priority: string;
  status: string;
  updates: string;
  sort_order: number;
}

function formatDate(d: string | null) {
  if (!d) return "";
  const date = new Date(d);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

function isExpiringSoon(d: string | null) {
  if (!d) return false;
  const expiry = new Date(d);
  const now = new Date();
  const monthsAway = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);
  return monthsAway <= 12 && monthsAway > 0;
}

function isExpired(d: string | null) {
  if (!d) return false;
  return new Date(d) < new Date();
}

function InlineEditCell({ unitId, field, value, onSave, className = "", placeholder = "", multiline = false }: {
  unitId: string; field: string; value: string; onSave: (id: string, field: string, value: string) => void;
  className?: string; placeholder?: string; multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) { const el = multiline ? textareaRef.current : inputRef.current; el?.focus(); } }, [editing, multiline]);
  useEffect(() => { setVal(value); }, [value]);

  const save = () => {
    setEditing(false);
    if (val !== value) onSave(unitId, field, val);
  };

  if (editing) {
    if (multiline) {
      return <textarea ref={textareaRef} value={val} onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === "Escape") { setVal(value); setEditing(false); } }}
        className={`w-full bg-white dark:bg-gray-900 border rounded px-1 py-0.5 text-xs outline-none focus:ring-1 focus:ring-teal-400 resize-none ${className}`} rows={2} data-testid={`inline-edit-${field}-${unitId}`} />;
    }
    return <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setVal(value); setEditing(false); } }}
      className={`w-full bg-white dark:bg-gray-900 border rounded px-1 py-0.5 text-xs outline-none focus:ring-1 focus:ring-teal-400 ${className}`} data-testid={`inline-edit-${field}-${unitId}`} />;
  }

  return <span onClick={() => setEditing(true)} className={`cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 py-0.5 -mx-1 block min-h-[18px] ${className}`} data-testid={`inline-${field}-${unitId}`}>
    {value || <span className="text-gray-300 italic">{placeholder || "—"}</span>}
  </span>;
}

function InlineStatusCell({ unitId, value, onSave }: { unitId: string; value: string; onSave: (id: string, field: string, value: string) => void }) {
  const statuses = ["Occupied", "Vacant", "Under Offer", "In Negotiation", "Archived"];
  const [open, setOpen] = useState(false);
  const colors: Record<string, string> = {
    "Occupied": "border-emerald-300 text-emerald-700 bg-emerald-50",
    "Vacant": "border-gray-300 text-gray-500 bg-gray-50",
    "Under Offer": "border-blue-300 text-blue-700 bg-blue-50",
    "In Negotiation": "border-amber-300 text-amber-700 bg-amber-50",
    "Archived": "border-gray-300 text-gray-400 bg-gray-100 line-through",
  };
  return (
    <div className="relative">
      <Badge variant="outline" className={`text-[9px] cursor-pointer ${colors[value] || "border-gray-300"}`} onClick={() => setOpen(!open)} data-testid={`inline-status-${unitId}`}>
        {value}
      </Badge>
      {open && (
        <div className="absolute z-50 mt-1 bg-white dark:bg-gray-900 border rounded-md shadow-lg py-1 min-w-[120px]" data-testid={`status-menu-${unitId}`}>
          {statuses.map(s => (
            <button key={s} onClick={() => { onSave(unitId, "status", s); setOpen(false); }}
              className={`w-full text-left px-3 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 ${s === value ? "font-bold" : ""}`} data-testid={`status-option-${s}-${unitId}`}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function InlineDateCell({ unitId, field, value, onSave, className = "" }: {
  unitId: string; field: string; value: string | null; onSave: (id: string, field: string, value: string) => void; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.showPicker?.(); } }, [editing]);

  if (editing) {
    return <input ref={ref} type="date" defaultValue={value || ""} onBlur={e => { setEditing(false); if (e.target.value !== (value || "")) onSave(unitId, field, e.target.value); }}
      className={`bg-white dark:bg-gray-900 border rounded px-1 py-0.5 text-xs outline-none focus:ring-1 focus:ring-teal-400 w-[110px] ${className}`} data-testid={`inline-date-${field}-${unitId}`} />;
  }

  return <span onClick={() => setEditing(true)} className={`cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 py-0.5 -mx-1 block min-h-[18px] ${className}`} data-testid={`inline-${field}-${unitId}`}>
    {value ? formatDate(value) : <span className="text-gray-300">—</span>}
  </span>;
}

interface CrmCompanyBasic { id: string; name: string; }

function TargetCompaniesCell({ unitId, targetCompanyIds, targetBrands, onUpdate }: {
  unitId: string;
  targetCompanyIds: string;
  targetBrands: string;
  onUpdate: (id: string, field: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  let ids: string[] = [];
  try { ids = JSON.parse(targetCompanyIds || "[]"); } catch { ids = []; }

  const { data: allCompanies } = useQuery<CrmCompanyBasic[]>({
    queryKey: ["/api/crm/companies-basic"],
    queryFn: async () => {
      const res = await fetch("/api/crm/companies?limit=5000", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      const data = await res.json();
      const arr = Array.isArray(data) ? data : (data.companies || []);
      return arr.map((c: any) => ({ id: String(c.id), name: c.name }));
    },
    staleTime: 120000,
  });

  const linkedCompanies = useMemo(() => {
    if (!allCompanies || ids.length === 0) return [];
    return ids.map(id => allCompanies.find(c => c.id === id)).filter(Boolean) as CrmCompanyBasic[];
  }, [allCompanies, ids]);

  const filtered = useMemo(() => {
    if (!allCompanies || !search.trim()) return [];
    const s = search.toLowerCase();
    return allCompanies.filter(c => !ids.includes(c.id) && c.name.toLowerCase().includes(s)).slice(0, 8);
  }, [allCompanies, search, ids]);

  const addCompany = (companyId: string) => {
    const newIds = [...ids, companyId];
    onUpdate(unitId, "target_company_ids", JSON.stringify(newIds));
    setSearch("");
  };

  const removeCompany = (companyId: string) => {
    const newIds = ids.filter(id => id !== companyId);
    onUpdate(unitId, "target_company_ids", JSON.stringify(newIds));
  };

  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <div
        onClick={() => setOpen(true)}
        className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 py-0.5 -mx-1 min-h-[18px] flex flex-wrap gap-0.5"
        data-testid={`target-companies-${unitId}`}
      >
        {linkedCompanies.length > 0 ? (
          linkedCompanies.map(c => (
            <Link key={c.id} href={`/companies/${c.id}`} onClick={e => e.stopPropagation()}>
              <Badge variant="outline" className="text-[9px] cursor-pointer border-teal-300 text-teal-700 bg-teal-50 hover:bg-teal-100 px-1.5 py-0">
                {c.name}
              </Badge>
            </Link>
          ))
        ) : targetBrands ? (
          <span className="text-[10px] text-gray-500">{targetBrands}</span>
        ) : (
          <span className="text-gray-300 italic text-[10px]">+ Target</span>
        )}
      </div>
      {open && (
        <div className="absolute z-50 mt-1 bg-white dark:bg-gray-900 border rounded-lg shadow-lg w-[220px] left-0" data-testid={`target-picker-${unitId}`}>
          <div className="p-1.5">
            <div className="flex flex-wrap gap-0.5 mb-1">
              {linkedCompanies.map(c => (
                <Badge key={c.id} variant="outline" className="text-[9px] border-teal-300 text-teal-700 bg-teal-50 pl-1.5 pr-0.5 py-0 gap-0.5">
                  {c.name}
                  <button onClick={() => removeCompany(c.id)} className="hover:text-red-500 ml-0.5 p-0.5" data-testid={`remove-target-${c.id}-${unitId}`}>
                    <X className="w-2.5 h-2.5" />
                  </button>
                </Badge>
              ))}
            </div>
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search companies..."
              className="w-full bg-transparent border rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-teal-400"
              data-testid={`target-search-${unitId}`}
            />
          </div>
          {filtered.length > 0 && (
            <div className="border-t max-h-[160px] overflow-y-auto">
              {filtered.map(c => (
                <button
                  key={c.id}
                  onClick={() => addCompany(c.id)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-1.5"
                  data-testid={`target-option-${c.id}-${unitId}`}
                >
                  <Building2 className="w-3 h-3 text-gray-400 shrink-0" />
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </div>
          )}
          {search.trim() && filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground border-t">No companies found</div>
          )}
        </div>
      )}
    </div>
  );
}

interface TargetTenant {
  id: string;
  unit_id: string;
  property_id: string;
  company_id: string | null;
  brand_name: string;
  rationale: string | null;
  quality_rating: "green" | "amber" | "red";
  status: "suggested" | "approved" | "rejected" | "converted";
  suggested_by: "ai" | "manual";
  approved_by: string | null;
  outcome: string | null;
  company_name: string | null;
  company_domain: string | null;
  created_at: string;
}

function TrafficLightDot({ rating, size = "sm" }: { rating: string; size?: "sm" | "md" }) {
  const s = size === "md" ? "w-3 h-3" : "w-2.5 h-2.5";
  const colors: Record<string, string> = {
    green: "text-emerald-500",
    amber: "text-amber-500",
    red: "text-red-500",
  };
  return <Circle className={`${s} ${colors[rating] || colors.amber} fill-current`} />;
}

function TrafficLightLabel({ rating }: { rating: string }) {
  const labels: Record<string, { text: string; bg: string; border: string; color: string }> = {
    green: { text: "A-Tier", bg: "bg-emerald-50", border: "border-emerald-300", color: "text-emerald-700" },
    amber: { text: "B-Tier", bg: "bg-amber-50", border: "border-amber-300", color: "text-amber-700" },
    red: { text: "C-Tier", bg: "bg-red-50", border: "border-red-300", color: "text-red-700" },
  };
  const l = labels[rating] || labels.amber;
  return <Badge variant="outline" className={`text-[8px] px-1 py-0 ${l.bg} ${l.border} ${l.color}`}>{l.text}</Badge>;
}

function TargetTenantRow({ target, onUpdate, onDelete }: {
  target: TargetTenant;
  onUpdate: (id: string, updates: any) => void;
  onDelete: (id: string) => void;
}) {
  const [showRationale, setShowRationale] = useState(false);
  const ratings: ("green" | "amber" | "red")[] = ["green", "amber", "red"];

  return (
    <div className={`flex items-start gap-2 px-2 py-1.5 rounded-md text-xs group ${
      target.status === "rejected" ? "opacity-40" : target.status === "converted" ? "bg-emerald-50/50 dark:bg-emerald-950/20" : ""
    }`} data-testid={`target-row-${target.id}`}>
      <div className="flex items-center gap-1 shrink-0 mt-0.5">
        {ratings.map(r => (
          <button
            key={r}
            onClick={() => onUpdate(target.id, { quality_rating: r })}
            className={`p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 ${target.quality_rating === r ? "" : "opacity-20 hover:opacity-60"}`}
            data-testid={`rating-${r}-${target.id}`}
          >
            <TrafficLightDot rating={r} size="md" />
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {target.company_id ? (
            <Link href={`/companies/${target.company_id}`}>
              <span className="font-medium text-blue-600 hover:underline cursor-pointer" data-testid={`target-link-${target.id}`}>
                {target.company_name || target.brand_name}
              </span>
            </Link>
          ) : (
            <span className="font-medium">{target.brand_name}</span>
          )}
          <TrafficLightLabel rating={target.quality_rating} />
          {target.suggested_by === "ai" && (
            <Badge variant="outline" className="text-[7px] px-1 py-0 border-violet-200 text-violet-500">AI</Badge>
          )}
          {target.status === "converted" && (
            <Badge variant="outline" className="text-[7px] px-1 py-0 border-emerald-300 text-emerald-600 bg-emerald-50">Signed</Badge>
          )}
        </div>
        {target.rationale && (
          <button onClick={() => setShowRationale(!showRationale)} className="text-[10px] text-gray-400 hover:text-gray-600 mt-0.5" data-testid={`rationale-toggle-${target.id}`}>
            {showRationale ? target.rationale : "View rationale..."}
          </button>
        )}
      </div>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {target.status === "suggested" && (
          <>
            <button onClick={() => onUpdate(target.id, { status: "approved" })} className="p-1 hover:bg-emerald-100 rounded" title="Approve" data-testid={`approve-${target.id}`}>
              <ThumbsUp className="w-3 h-3 text-emerald-500" />
            </button>
            <button onClick={() => onUpdate(target.id, { status: "rejected" })} className="p-1 hover:bg-red-100 rounded" title="Reject" data-testid={`reject-${target.id}`}>
              <ThumbsDown className="w-3 h-3 text-red-400" />
            </button>
          </>
        )}
        {target.status === "rejected" && (
          <button onClick={() => onUpdate(target.id, { status: "suggested" })} className="p-1 hover:bg-gray-100 rounded" title="Restore" data-testid={`restore-${target.id}`}>
            <Check className="w-3 h-3 text-gray-400" />
          </button>
        )}
        <button onClick={() => onDelete(target.id)} className="p-1 hover:bg-red-100 rounded" title="Remove" data-testid={`delete-target-${target.id}`}>
          <X className="w-3 h-3 text-gray-300" />
        </button>
      </div>
    </div>
  );
}

function TargetTenantPanel({ unitId, propertyId, targets, onRefresh }: {
  unitId: string;
  propertyId: string;
  targets: TargetTenant[];
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newBrand, setNewBrand] = useState("");
  const [newRating, setNewRating] = useState("amber");

  const unitTargets = targets.filter(t => t.unit_id === unitId);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/leasing-schedule/unit/${unitId}/generate-targets`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) { toast({ title: "Generation failed", variant: "destructive" }); return; }
      toast({ title: "Target tenants generated" });
      onRefresh();
    } catch { toast({ title: "Generation failed", variant: "destructive" }); }
    finally { setGenerating(false); }
  };

  const handleUpdate = async (id: string, updates: any) => {
    try {
      const res = await fetch(`/api/leasing-schedule/target/${id}`, {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) { toast({ title: "Update failed", variant: "destructive" }); return; }
      onRefresh();
    } catch { toast({ title: "Update failed", variant: "destructive" }); }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/leasing-schedule/target/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (!res.ok) { toast({ title: "Delete failed", variant: "destructive" }); return; }
      onRefresh();
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
  };

  const handleAdd = async () => {
    if (!newBrand.trim()) return;
    try {
      const res = await fetch(`/api/leasing-schedule/unit/${unitId}/targets`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ brand_name: newBrand, quality_rating: newRating }),
      });
      if (!res.ok) { toast({ title: "Failed to add target", variant: "destructive" }); return; }
      setNewBrand("");
      setShowAdd(false);
      onRefresh();
      toast({ title: "Target added" });
    } catch { toast({ title: "Failed to add target", variant: "destructive" }); }
  };

  if (unitTargets.length === 0 && !generating) {
    return (
      <div className="flex items-center gap-2">
        <button onClick={handleGenerate} className="flex items-center gap-1 text-[10px] text-violet-500 hover:text-violet-700 hover:bg-violet-50 rounded px-1.5 py-0.5" data-testid={`generate-targets-${unitId}`}>
          <Sparkles className="w-3 h-3" />AI Targets
        </button>
        <button onClick={() => setShowAdd(true)} className="text-[10px] text-gray-400 hover:text-gray-600" data-testid={`manual-target-${unitId}`}>
          <Plus className="w-3 h-3" />
        </button>
        {showAdd && (
          <div className="flex items-center gap-1">
            <input value={newBrand} onChange={e => setNewBrand(e.target.value)} placeholder="Brand name..." className="border rounded px-1.5 py-0.5 text-[10px] w-[120px]" data-testid={`new-target-input-${unitId}`}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setShowAdd(false); }} autoFocus />
            <button onClick={handleAdd} className="text-emerald-500 p-0.5"><Check className="w-3 h-3" /></button>
            <button onClick={() => setShowAdd(false)} className="text-gray-400 p-0.5"><X className="w-3 h-3" /></button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-0.5" data-testid={`target-panel-${unitId}`}>
      {generating && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] text-violet-500">
          <Loader2 className="w-3 h-3 animate-spin" />Generating AI targets...
        </div>
      )}
      {unitTargets.map(t => (
        <TargetTenantRow key={t.id} target={t} onUpdate={handleUpdate} onDelete={handleDelete} />
      ))}
      <div className="flex items-center gap-1 pt-0.5">
        <button onClick={handleGenerate} disabled={generating} className="flex items-center gap-1 text-[9px] text-violet-400 hover:text-violet-600 px-1 py-0.5 rounded hover:bg-violet-50" data-testid={`regenerate-${unitId}`}>
          <Sparkles className="w-2.5 h-2.5" />{generating ? "Generating..." : "More"}
        </button>
        <button onClick={() => setShowAdd(!showAdd)} className="text-[9px] text-gray-400 hover:text-gray-600 px-1 py-0.5" data-testid={`add-manual-${unitId}`}>
          <Plus className="w-2.5 h-2.5 inline" />Add
        </button>
      </div>
      {showAdd && (
        <div className="flex items-center gap-1 px-2 py-1">
          <input value={newBrand} onChange={e => setNewBrand(e.target.value)} placeholder="Brand name..." className="border rounded px-1.5 py-0.5 text-[10px] w-[120px]" data-testid={`new-target-input-${unitId}`}
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setShowAdd(false); }} autoFocus />
          <select value={newRating} onChange={e => setNewRating(e.target.value)} className="border rounded px-1 py-0.5 text-[10px]" data-testid={`new-target-rating-${unitId}`}>
            <option value="green">Green</option>
            <option value="amber">Amber</option>
            <option value="red">Red</option>
          </select>
          <button onClick={handleAdd} className="text-emerald-500 p-0.5"><Check className="w-3 h-3" /></button>
          <button onClick={() => setShowAdd(false)} className="text-gray-400 p-0.5"><X className="w-3 h-3" /></button>
        </div>
      )}
    </div>
  );
}

function PropertyCard({ prop }: { prop: LeasingProperty }) {
  const occupancy = prop.unit_count > 0 ? Math.round((prop.occupied_count / prop.unit_count) * 100) : 0;
  return (
    <Link href={`/leasing-schedule/${prop.id}`}>
      <div className="border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer bg-white dark:bg-gray-900" data-testid={`property-card-${prop.id}`}>
        <div className="flex items-start justify-between mb-2">
          <div>
            <h3 className="font-semibold text-sm">{prop.name}</h3>
            {prop.landlord_name && <p className="text-xs text-gray-500">{prop.landlord_name}</p>}
          </div>
          <div className="flex gap-1.5 items-center">
            {prop.leasing_privacy_enabled && (
              <Badge variant="outline" className="text-[10px] border-violet-300 text-violet-700 bg-violet-50" data-testid={`privacy-badge-${prop.id}`}>
                <Lock className="w-2.5 h-2.5 mr-0.5" />Private
              </Badge>
            )}
            {prop.expiring_soon > 0 && (
              <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 bg-amber-50">
                <AlertTriangle className="w-3 h-3 mr-0.5" />{prop.expiring_soon} expiring
              </Badge>
            )}
          </div>
        </div>
        <div className="flex gap-3 text-xs text-gray-500 mb-3">
          {prop.asset_class && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{prop.asset_class}</span>}
          <span className="flex items-center gap-1"><Users className="w-3 h-3" />{prop.unit_count} units</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${occupancy}%` }} />
          </div>
          <span className="text-[11px] font-medium text-gray-600">{occupancy}%</span>
        </div>
        <div className="flex gap-3 mt-2 text-[10px]">
          <span className="text-emerald-600">{prop.occupied_count} occupied</span>
          <span className="text-gray-400">{prop.vacant_count} vacant</span>
        </div>
      </div>
    </Link>
  );
}

function UnitEditDialog({ unit, open, onClose, onSave }: {
  unit: LeasingUnit | null; open: boolean; onClose: () => void; onSave: (data: any) => void;
}) {
  const [form, setForm] = useState<any>({});
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));

  useState(() => {
    if (unit) setForm({ ...unit });
  });

  if (!unit) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Unit — {unit.unit_name}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Unit / Tenant Name</label>
            <Input value={form.unit_name || ""} onChange={e => set("unit_name", e.target.value)} data-testid="edit-unit-name" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Agent</label>
            <Input value={form.agent_initials || ""} onChange={e => set("agent_initials", e.target.value)} data-testid="edit-agent" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Zone</label>
            <Input value={form.zone || ""} onChange={e => set("zone", e.target.value)} data-testid="edit-zone" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Positioning</label>
            <Input value={form.positioning || ""} onChange={e => set("positioning", e.target.value)} data-testid="edit-positioning" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Status</label>
            <Select value={form.status || "Occupied"} onValueChange={v => set("status", v)}>
              <SelectTrigger data-testid="edit-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Occupied">Occupied</SelectItem>
                <SelectItem value="Vacant">Vacant</SelectItem>
                <SelectItem value="Under Offer">Under Offer</SelectItem>
                <SelectItem value="In Negotiation">In Negotiation</SelectItem>
                <SelectItem value="Archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Priority</label>
            <Input value={form.priority || ""} onChange={e => set("priority", e.target.value)} data-testid="edit-priority" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Lease Expiry</label>
            <Input type="date" value={form.lease_expiry?.split("T")[0] || ""} onChange={e => set("lease_expiry", e.target.value)} data-testid="edit-expiry" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Tenant Break</label>
            <Input type="date" value={form.lease_break?.split("T")[0] || ""} onChange={e => set("lease_break", e.target.value)} data-testid="edit-break" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Rent Review</label>
            <Input type="date" value={form.rent_review?.split("T")[0] || ""} onChange={e => set("rent_review", e.target.value)} data-testid="edit-rr" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Landlord Break</label>
            <Input type="date" value={form.landlord_break?.split("T")[0] || ""} onChange={e => set("landlord_break", e.target.value)} data-testid="edit-lb" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">MAT/psqft</label>
            <Input value={form.mat_psqft || ""} onChange={e => set("mat_psqft", e.target.value)} data-testid="edit-mat" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">LFL %</label>
            <Input value={form.lfl_percent || ""} onChange={e => set("lfl_percent", e.target.value)} data-testid="edit-lfl" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Occ. Cost %</label>
            <Input value={form.occ_cost_percent || ""} onChange={e => set("occ_cost_percent", e.target.value)} data-testid="edit-occ" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Optimum Target</label>
            <Input value={form.optimum_target || ""} onChange={e => set("optimum_target", e.target.value)} data-testid="edit-optimum" />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium text-gray-500 mb-1 block">Target Brands</label>
            <Textarea value={form.target_brands || ""} onChange={e => set("target_brands", e.target.value)} rows={2} data-testid="edit-targets" />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium text-gray-500 mb-1 block">Updates / Notes</label>
            <Textarea value={form.updates || ""} onChange={e => set("updates", e.target.value)} rows={3} data-testid="edit-updates" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="edit-cancel">Cancel</Button>
          <Button size="sm" onClick={() => onSave(form)} data-testid="edit-save">
            <Check className="w-3.5 h-3.5 mr-1" />Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PropertyScheduleView({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [editUnit, setEditUnit] = useState<LeasingUnit | null>(null);
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());
  const [expandedRowZones, setExpandedRowZones] = useState<Set<string>>(new Set());
  const ZONE_ROW_LIMIT = 40;
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [statFilter, setStatFilter] = useState<string | null>(null);
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [importParsing, setImportParsing] = useState(false);
  const [importPreview, setImportPreview] = useState<{ sheetName: string; sheetCount: number; rowsScanned: number; units: any[] } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const handleImportExcel = async (file: File) => {
    setImportParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}/parse-excel`, {
        method: "POST", headers: getAuthHeaders(), body: fd,
      });
      if (!r.ok) { toast({ title: "Parse failed", description: (await r.json()).error || "Could not read file", variant: "destructive" }); return; }
      const data = await r.json();
      if (!data.units?.length) { toast({ title: "No units found", description: "AI could not extract rows from that sheet", variant: "destructive" }); return; }
      setImportPreview(data);
    } catch (e: any) {
      toast({ title: "Parse failed", description: e.message, variant: "destructive" });
    } finally {
      setImportParsing(false);
    }
  };

  const confirmImport = async () => {
    if (!importPreview?.units?.length) return;
    try {
      const r = await fetch(`/api/leasing-schedule/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ property_id: propertyId, units: importPreview.units }),
      });
      if (!r.ok) { toast({ title: "Import failed", variant: "destructive" }); return; }
      const data = await r.json();
      toast({ title: `${data.imported} units imported` });
      setImportPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    }
  };

  const { data: currentUser } = useQuery<{ id: string; username: string; is_admin: boolean }>({
    queryKey: ["/api/auth/me"],
  });

  const { data: units = [], isLoading, error: unitsError } = useQuery<LeasingUnit[]>({
    queryKey: ["/api/leasing-schedule/property", propertyId],
    queryFn: async () => {
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}`, { headers: getAuthHeaders() });
      if (r.status === 403) throw new Error("ACCESS_DENIED");
      return r.json();
    },
  });

  const { data: privacyInfo } = useQuery<{ privacy_enabled: boolean; assigned_agents: { user_id: string; username: string }[] }>({
    queryKey: ["/api/leasing-schedule/property", propertyId, "privacy"],
    queryFn: () => fetch(`/api/leasing-schedule/property/${propertyId}/privacy`, { headers: getAuthHeaders() }).then(r => r.json()),
  });

  const { data: allTargets = [], refetch: refetchTargets } = useQuery<TargetTenant[]>({
    queryKey: ["/api/leasing-schedule/property", propertyId, "targets"],
    queryFn: async () => {
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}/targets`, { headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const [generatingAll, setGeneratingAll] = useState(false);
  const handleGenerateAll = async () => {
    setGeneratingAll(true);
    try {
      const res = await fetch(`/api/leasing-schedule/property/${propertyId}/generate-targets`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) { toast({ title: "Batch generation failed", variant: "destructive" }); return; }
      const data = await res.json();
      const genCount = data.results?.reduce((s: number, r: any) => s + (r.generated || 0), 0) || 0;
      toast({ title: `Generated targets for ${genCount} units` });
      refetchTargets();
    } catch { toast({ title: "Generation failed", variant: "destructive" }); }
    finally { setGeneratingAll(false); }
  };

  const { data: auditLog = [] } = useQuery<AuditEntry[]>({
    queryKey: ["/api/leasing-schedule/property", propertyId, "audit"],
    queryFn: () => fetch(`/api/leasing-schedule/property/${propertyId}/audit`, { headers: getAuthHeaders() }).then(r => r.json()),
    enabled: showAuditLog,
  });

  const privacyMutation = useMutation({
    mutationFn: (enabled: boolean) => apiRequest("PUT", `/api/leasing-schedule/property/${propertyId}/privacy`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId, "privacy"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/properties"] });
      toast({ title: privacyInfo?.privacy_enabled ? "Privacy mode disabled" : "Privacy mode enabled" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/leasing-schedule/unit/${data.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      setEditUnit(null);
      toast({ title: "Unit updated" });
    },
  });

  const addMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/leasing-schedule/unit", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      setShowAddUnit(false);
      toast({ title: "Unit added" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/leasing-schedule/unit/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      toast({ title: "Unit removed" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/leasing-schedule/units/${id}/archive`),
    onSuccess: (_data: any, _id: string) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      toast({ title: "Unit archived" });
    },
  });

  const [includeArchived, setIncludeArchived] = useState(false);

  const inlineUpdate = (unitId: string, field: string, value: string) => {
    updateMutation.mutate({ id: unitId, [field]: value });
  };

  const propertyName = units[0]?.property_name || "Property";
  const landlordName = units[0]?.landlord_name || "";

  const archivedCount = useMemo(() => units.filter(u => u.status === "Archived").length, [units]);

  const filteredUnits = useMemo(() => {
    return units.filter(u => {
      if (!includeArchived && u.status === "Archived") return false;
      if (debouncedSearch) {
        const s = debouncedSearch.toLowerCase();
        if (!u.unit_name?.toLowerCase().includes(s) && !u.zone?.toLowerCase().includes(s) &&
          !u.positioning?.toLowerCase().includes(s) && !u.target_brands?.toLowerCase().includes(s) &&
          !u.updates?.toLowerCase().includes(s) && !u.agent_initials?.toLowerCase().includes(s)) return false;
      }
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (statFilter === "occupied" && u.status !== "Occupied") return false;
      if (statFilter === "vacant" && u.status !== "Vacant") return false;
      if (statFilter === "expiring" && !isExpiringSoon(u.lease_expiry)) return false;
      if (statFilter === "expired" && !isExpired(u.lease_expiry)) return false;
      return true;
    });
  }, [units, debouncedSearch, statusFilter, statFilter, includeArchived]);

  const zoneGroups = useMemo(() => {
    const groups: Record<string, LeasingUnit[]> = {};
    for (const u of filteredUnits) {
      const zone = u.zone || "Unzoned";
      if (!groups[zone]) groups[zone] = [];
      groups[zone].push(u);
    }
    return Object.entries(groups);
  }, [filteredUnits]);

  const allZones = useMemo(() => new Set(zoneGroups.map(([z]) => z)), [zoneGroups]);
  const allExpanded = expandedZones.size === 0 || allZones.size === expandedZones.size;

  const toggleZone = (zone: string) => {
    setExpandedZones(prev => {
      const next = new Set(prev);
      if (prev.size === 0) {
        for (const z of allZones) { if (z !== zone) next.add(z); }
        return next;
      }
      if (next.has(zone)) next.delete(zone); else next.add(zone);
      return next;
    });
  };

  const isZoneExpanded = (zone: string) => expandedZones.size === 0 || expandedZones.has(zone);

  const stats = useMemo(() => ({
    total: units.length,
    occupied: units.filter(u => u.status === "Occupied").length,
    vacant: units.filter(u => u.status === "Vacant").length,
    expiringSoon: units.filter(u => isExpiringSoon(u.lease_expiry)).length,
    expired: units.filter(u => isExpired(u.lease_expiry)).length,
  }), [units]);

  const handleExport = async () => {
    try {
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}/export`, { headers: getAuthHeaders() });
      if (!r.ok) { toast({ title: "Export denied", variant: "destructive" }); return; }
      const data = await r.json();
      const headers = ["Unit", "Zone", "Positioning", "Tenant", "Agent", "Status", "Lease Expiry", "Break", "Rent Review", "Rent PA", "SqFt", "MAT/psqft", "LFL%", "Occ Cost%", "Target Brands", "Optimum Target", "Priority", "Updates"];
      const csvRows = [headers.join(",")];
      for (const u of data) {
        csvRows.push([u.unit_name, u.zone, u.positioning, u.tenant_name, u.agent_initials, u.status,
          u.lease_expiry, u.lease_break, u.rent_review, u.rent_pa, u.sqft, u.mat_psqft,
          u.lfl_percent, u.occ_cost_percent, u.target_brands, u.optimum_target, u.priority, u.updates
        ].map(v => `"${(v ?? "").toString().replace(/"/g, '""')}"`).join(","));
      }
      const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${propertyName}_leasing_schedule.csv`; a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Exported successfully" });
    } catch { toast({ title: "Export failed", variant: "destructive" }); }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  );

  if ((unitsError as Error)?.message === "ACCESS_DENIED") return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <ShieldOff className="w-10 h-10 text-gray-300" />
      <h3 className="text-lg font-semibold text-gray-600">Access Restricted</h3>
      <p className="text-sm text-gray-400 text-center max-w-sm">This property's leasing schedule is in privacy mode. Only assigned team members can view it.</p>
      <Link href="/leasing-schedule">
        <Button variant="outline" size="sm" data-testid="btn-back-denied">
          <ChevronLeft className="w-4 h-4 mr-1" />Back to Properties
        </Button>
      </Link>
    </div>
  );

  const isAssigned = currentUser && privacyInfo?.assigned_agents?.some(a => a.user_id === currentUser.id);
  const canTogglePrivacy = currentUser?.is_admin || isAssigned;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/leasing-schedule">
          <Button variant="ghost" size="sm" data-testid="btn-back-schedule">
            <ChevronLeft className="w-4 h-4 mr-1" />Back
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <Link href={`/properties/${propertyId}`}>
              <h2 className="text-lg font-bold hover:text-blue-600 hover:underline cursor-pointer transition-colors" data-testid="property-title">{propertyName}</h2>
            </Link>
            {privacyInfo?.privacy_enabled && (
              <Badge variant="outline" className="text-[10px] border-violet-300 text-violet-700 bg-violet-50">
                <Lock className="w-2.5 h-2.5 mr-0.5" />Private
              </Badge>
            )}
          </div>
          {landlordName && <p className="text-xs text-muted-foreground">{landlordName}</p>}
        </div>
        <div className="ml-auto flex gap-2">
          {canTogglePrivacy && (
            <Button variant="outline" size="sm" onClick={() => privacyMutation.mutate(!privacyInfo?.privacy_enabled)}
              className={privacyInfo?.privacy_enabled ? "border-violet-300 text-violet-700" : ""}
              data-testid="btn-toggle-privacy">
              {privacyInfo?.privacy_enabled ? <><ShieldCheck className="w-3.5 h-3.5 mr-1" />Privacy On</> : <><Shield className="w-3.5 h-3.5 mr-1" />Privacy Off</>}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleGenerateAll} disabled={generatingAll}
            className="border-violet-300 text-violet-700 hover:bg-violet-50" data-testid="btn-generate-all-targets">
            {generatingAll ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
            {generatingAll ? "Generating..." : "AI Targets"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAuditLog(!showAuditLog)} data-testid="btn-audit-log">
            <History className="w-3.5 h-3.5 mr-1" />Audit Log
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} data-testid="btn-export">
            <Download className="w-3.5 h-3.5 mr-1" />Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAddUnit(true)} data-testid="btn-add-unit">
            <Plus className="w-3.5 h-3.5 mr-1" />Add Unit
          </Button>
        </div>
      </div>

      {privacyInfo?.privacy_enabled && privacyInfo.assigned_agents.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 rounded-lg text-xs">
          <Eye className="w-3.5 h-3.5 text-violet-500 shrink-0" />
          <span className="text-violet-700 dark:text-violet-300">
            Visible to: {currentUser?.is_admin ? "You (admin)" : ""}{currentUser?.is_admin && privacyInfo.assigned_agents.length > 0 ? ", " : ""}
            {privacyInfo.assigned_agents.map(a => a.username).join(", ")}
          </span>
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <button onClick={() => { setStatFilter(null); setStatusFilter("all"); }} className={`px-3 py-1.5 rounded-lg text-center transition-all ${!statFilter ? "ring-2 ring-gray-400 bg-gray-100 dark:bg-gray-700" : "bg-gray-50 dark:bg-gray-800 hover:bg-gray-100"}`} data-testid="stat-total">
          <p className="text-lg font-bold">{stats.total}</p>
          <p className="text-[10px] text-gray-500">Total Units</p>
        </button>
        <button onClick={() => { setStatFilter(statFilter === "occupied" ? null : "occupied"); setStatusFilter("all"); }} className={`px-3 py-1.5 rounded-lg text-center transition-all ${statFilter === "occupied" ? "ring-2 ring-emerald-400 bg-emerald-100 dark:bg-emerald-900/40" : "bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100"}`} data-testid="stat-occupied">
          <p className="text-lg font-bold text-emerald-700">{stats.occupied}</p>
          <p className="text-[10px] text-emerald-600">Occupied</p>
        </button>
        <button onClick={() => { setStatFilter(statFilter === "vacant" ? null : "vacant"); setStatusFilter("all"); }} className={`px-3 py-1.5 rounded-lg text-center transition-all ${statFilter === "vacant" ? "ring-2 ring-gray-400 bg-gray-200 dark:bg-gray-600" : "bg-gray-50 dark:bg-gray-800 hover:bg-gray-100"}`} data-testid="stat-vacant">
          <p className="text-lg font-bold text-gray-500">{stats.vacant}</p>
          <p className="text-[10px] text-gray-500">Vacant</p>
        </button>
        {stats.expiringSoon > 0 && (
          <button onClick={() => { setStatFilter(statFilter === "expiring" ? null : "expiring"); setStatusFilter("all"); }} className={`px-3 py-1.5 rounded-lg text-center transition-all ${statFilter === "expiring" ? "ring-2 ring-amber-400 bg-amber-100 dark:bg-amber-900/40" : "bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100"}`} data-testid="stat-expiring">
            <p className="text-lg font-bold text-amber-700">{stats.expiringSoon}</p>
            <p className="text-[10px] text-amber-600">Expiring &lt;12m</p>
          </button>
        )}
        {stats.expired > 0 && (
          <button onClick={() => { setStatFilter(statFilter === "expired" ? null : "expired"); setStatusFilter("all"); }} className={`px-3 py-1.5 rounded-lg text-center transition-all ${statFilter === "expired" ? "ring-2 ring-red-400 bg-red-100 dark:bg-red-900/40" : "bg-red-50 dark:bg-red-950/20 hover:bg-red-100"}`} data-testid="stat-expired">
            <p className="text-lg font-bold text-red-700">{stats.expired}</p>
            <p className="text-[10px] text-red-600">Expired</p>
          </button>
        )}
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search units..." className="pl-8 h-8 text-xs" data-testid="search-units" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setStatFilter(null); }}>
          <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="filter-status">
            <Filter className="w-3 h-3 mr-1" /><SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="Occupied">Occupied</SelectItem>
            <SelectItem value="Vacant">Vacant</SelectItem>
            <SelectItem value="Under Offer">Under Offer</SelectItem>
            <SelectItem value="In Negotiation">In Negotiation</SelectItem>
            <SelectItem value="Archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        {archivedCount > 0 && (
          <button
            onClick={() => setIncludeArchived(!includeArchived)}
            className={`flex items-center gap-1.5 px-2.5 h-8 rounded-md border text-xs transition-colors ${includeArchived ? "border-gray-400 bg-gray-100 dark:bg-gray-700 text-foreground" : "border-gray-200 dark:border-gray-700 text-muted-foreground hover:bg-gray-50 dark:hover:bg-gray-800"}`}
            data-testid="toggle-include-archived"
          >
            <Eye className="w-3 h-3" />
            Archived ({archivedCount})
          </button>
        )}
        <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => setExpandedZones(new Set())} data-testid="btn-expand-all">
          {allExpanded ? "Collapse All" : "Expand All"}
        </Button>
      </div>

      <div className="space-y-3">
        {zoneGroups.map(([zone, zoneUnits]) => (
          <div key={zone} className="border rounded-lg overflow-hidden" data-testid={`zone-${zone}`}>
            <button
              onClick={() => toggleZone(zone)}
              className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-left"
              data-testid={`zone-toggle-${zone}`}
            >
              {isZoneExpanded(zone) ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              <span className="font-semibold text-sm">{zone}</span>
              <Badge variant="secondary" className="text-[10px] ml-1">{zoneUnits.length}</Badge>
              {zoneUnits[0]?.positioning && (
                <span className="text-[10px] text-gray-400 ml-2 truncate">{zoneUnits[0].positioning}</span>
              )}
            </button>
            {isZoneExpanded(zone) && (
              <div className="overflow-x-auto">
                <table className="w-full" data-testid={`zone-table-${zone}`}>
                  <thead>
                    <tr className="bg-gray-50/50 dark:bg-gray-800/50 border-b text-left text-sm">
                      <th className="px-3 py-1.5 font-medium text-gray-500 min-w-[140px]">Tenant</th>
                      <th className="px-3 py-1.5 font-medium text-gray-500 min-w-[50px]">Agent</th>
                      <th className="px-3 py-1.5 font-medium text-gray-500 min-w-[70px]">Status</th>
                      <th className="px-3 py-1.5 font-medium text-gray-500 min-w-[80px]">Expiry</th>
                      <th className="px-3 py-1.5 font-medium text-gray-500 min-w-[70px]">Break</th>
                      <th className="px-3 py-1.5 font-medium text-gray-500 min-w-[70px]">RR</th>
                      <th className="px-3 py-1.5 font-medium text-gray-500 min-w-[100px]">Performance</th>
                      <th className="px-3 py-1.5 font-medium text-gray-500 min-w-[220px]">Target Tenants</th>
                      <th className="px-3 py-1.5 font-medium text-gray-500 min-w-[200px]">Updates</th>
                      <th className="px-3 py-1.5 font-medium text-gray-500 w-[60px]"></th>
                    </tr>
                  </thead>
                  <tbody className="text-xs">
                    {(() => {
                      const showAll = expandedRowZones.has(zone);
                      const visible = showAll ? zoneUnits : zoneUnits.slice(0, ZONE_ROW_LIMIT);
                      const hasMore = zoneUnits.length > ZONE_ROW_LIMIT && !showAll;
                      return (<>
                        {visible.map(u => {
                          const expired = isExpired(u.lease_expiry);
                          const expSoon = isExpiringSoon(u.lease_expiry);
                          return (
                            <tr key={u.id} className={`border-b hover:bg-gray-50 dark:hover:bg-gray-800/30 ${u.status === "Vacant" ? "bg-gray-50/50 dark:bg-gray-800/20" : ""}`} data-testid={`unit-row-${u.id}`}>
                              <td className="px-3 py-2">
                                <InlineEditCell unitId={u.id} field="unit_name" value={u.unit_name || ""} onSave={inlineUpdate} className="font-medium" />
                              </td>
                              <td className="px-3 py-2">
                                <InlineEditCell unitId={u.id} field="agent_initials" value={u.agent_initials || ""} onSave={inlineUpdate} className="text-gray-500" />
                              </td>
                              <td className="px-3 py-2">
                                <InlineStatusCell unitId={u.id} value={u.status} onSave={inlineUpdate} />
                              </td>
                              <td className={`px-3 py-2 ${expired ? "text-red-600 font-medium" : expSoon ? "text-amber-600 font-medium" : "text-gray-600"}`}>
                                <InlineDateCell unitId={u.id} field="lease_expiry" value={u.lease_expiry} onSave={inlineUpdate} />
                              </td>
                              <td className="px-3 py-2">
                                <InlineDateCell unitId={u.id} field="lease_break" value={u.lease_break} onSave={inlineUpdate} className="text-gray-500" />
                              </td>
                              <td className="px-3 py-2">
                                <InlineDateCell unitId={u.id} field="rent_review" value={u.rent_review} onSave={inlineUpdate} className="text-gray-500" />
                              </td>
                              <td className="px-3 py-2">
                                <div className="space-y-0.5">
                                  <InlineEditCell unitId={u.id} field="mat_psqft" value={u.mat_psqft || ""} onSave={inlineUpdate} className="text-[10px]" placeholder="MAT" />
                                  <InlineEditCell unitId={u.id} field="lfl_percent" value={u.lfl_percent || ""} onSave={inlineUpdate} className={`text-[10px] ${u.lfl_percent?.startsWith("-") ? "text-red-500" : "text-emerald-600"}`} placeholder="LFL%" />
                                  <InlineEditCell unitId={u.id} field="occ_cost_percent" value={u.occ_cost_percent || ""} onSave={inlineUpdate} className="text-[10px] text-gray-400" placeholder="Occ%" />
                                </div>
                              </td>
                              <td className="px-3 py-2 min-w-[220px]">
                                <TargetTenantPanel unitId={u.id} propertyId={propertyId} targets={allTargets} onRefresh={() => refetchTargets()} />
                              </td>
                              <td className="px-3 py-2">
                                <InlineEditCell unitId={u.id} field="updates" value={u.updates || ""} onSave={inlineUpdate} className="text-[10px] text-gray-600" placeholder="Updates" multiline />
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-0.5">
                                  <button
                                    onClick={() => { if (confirm(u.status === "Archived" ? "Restore this unit from archive?" : "Archive this unit?")) archiveMutation.mutate(u.id); }}
                                    className={`p-1 rounded ${u.status === "Archived" ? "hover:bg-emerald-100 text-emerald-500" : "hover:bg-amber-100 text-gray-400"}`}
                                    title={u.status === "Archived" ? "Restore" : "Archive"}
                                    data-testid={`archive-${u.id}`}
                                  >
                                    {u.status === "Archived" ? <History className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
                                  </button>
                                  <button onClick={() => { if (confirm("Remove this unit permanently?")) deleteMutation.mutate(u.id); }} className="p-1 hover:bg-red-100 rounded" data-testid={`delete-${u.id}`}>
                                    <Trash2 className="w-3 h-3 text-gray-400" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {hasMore && (
                          <tr>
                            <td colSpan={10} className="text-center py-2">
                              <button
                                onClick={() => setExpandedRowZones(prev => { const n = new Set(prev); n.add(zone); return n; })}
                                className="text-xs text-primary hover:underline font-medium"
                              >
                                Show all {zoneUnits.length} units ({zoneUnits.length - ZONE_ROW_LIMIT} more)
                              </button>
                            </td>
                          </tr>
                        )}
                      </>);
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      <UnitEditDialog
        unit={editUnit}
        open={!!editUnit}
        onClose={() => setEditUnit(null)}
        onSave={(data) => updateMutation.mutate(data)}
      />

      <Dialog open={showAddUnit} onOpenChange={setShowAddUnit}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Unit</DialogTitle></DialogHeader>
          <AddUnitForm propertyId={propertyId} onSave={(data) => addMutation.mutate(data)} />
        </DialogContent>
      </Dialog>

      <Dialog open={showAuditLog} onOpenChange={setShowAuditLog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle><History className="w-4 h-4 inline mr-2" />Audit Log — {propertyName}</DialogTitle></DialogHeader>
          {auditLog.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No changes recorded yet</p>
          ) : (
            <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
              {auditLog.map(entry => (
                <div key={entry.id} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-xs" data-testid={`audit-${entry.id}`}>
                  <div className="shrink-0 w-[100px] text-gray-400">
                    {new Date(entry.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{" "}
                    {new Date(entry.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div className="shrink-0 font-medium text-gray-600 w-[80px]">{entry.user_name}</div>
                  <div className="flex-1">
                    <Badge variant="outline" className={`text-[9px] mr-1.5 ${
                      entry.action === "create" ? "border-emerald-300 text-emerald-700" :
                      entry.action === "delete" ? "border-red-300 text-red-700" :
                      entry.action === "privacy_toggle" ? "border-violet-300 text-violet-700" :
                      entry.action === "export" ? "border-blue-300 text-blue-700" :
                      entry.action === "import" ? "border-teal-300 text-teal-700" :
                      "border-gray-300 text-gray-600"
                    }`}>{entry.action}</Badge>
                    {entry.field_name && <span className="text-gray-500">{entry.field_name}</span>}
                    {entry.old_value && entry.new_value && (
                      <span className="text-gray-400"> : <span className="line-through text-red-400">{entry.old_value}</span> → <span className="text-emerald-600">{entry.new_value}</span></span>
                    )}
                    {!entry.old_value && entry.new_value && <span className="text-gray-400"> : {entry.new_value}</span>}
                    {entry.old_value && !entry.new_value && <span className="text-gray-400"> : <span className="line-through text-red-400">{entry.old_value}</span> removed</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddUnitForm({ propertyId, onSave }: { propertyId: string; onSave: (data: any) => void }) {
  const [form, setForm] = useState<any>({ property_id: propertyId, status: "Occupied" });
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));
  return (
    <div className="space-y-3 text-sm">
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Unit / Tenant Name *</label>
        <Input value={form.unit_name || ""} onChange={e => set("unit_name", e.target.value)} data-testid="add-unit-name" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Zone</label>
          <Input value={form.zone || ""} onChange={e => set("zone", e.target.value)} data-testid="add-zone" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Agent</label>
          <Input value={form.agent_initials || ""} onChange={e => set("agent_initials", e.target.value)} data-testid="add-agent" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Status</label>
          <Select value={form.status} onValueChange={v => set("status", v)}>
            <SelectTrigger data-testid="add-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Occupied">Occupied</SelectItem>
              <SelectItem value="Vacant">Vacant</SelectItem>
              <SelectItem value="Under Offer">Under Offer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">Lease Expiry</label>
          <Input type="date" value={form.lease_expiry || ""} onChange={e => set("lease_expiry", e.target.value)} data-testid="add-expiry" />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 mb-1 block">Positioning</label>
        <Input value={form.positioning || ""} onChange={e => set("positioning", e.target.value)} data-testid="add-positioning" />
      </div>
      <Button size="sm" onClick={() => { if (form.unit_name) onSave(form); }} disabled={!form.unit_name} data-testid="add-save">
        <Plus className="w-3.5 h-3.5 mr-1" />Add Unit
      </Button>
    </div>
  );
}

function TargetCompanyNames({ targetCompanyIds, targetBrands }: { targetCompanyIds: string; targetBrands: string }) {
  let ids: string[] = [];
  try { ids = JSON.parse(targetCompanyIds || "[]"); } catch { ids = []; }
  const { data: allCompanies } = useQuery<CrmCompanyBasic[]>({
    queryKey: ["/api/crm/companies-basic"],
    queryFn: async () => {
      const res = await fetch("/api/crm/companies?limit=5000", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      const data = await res.json();
      const arr = Array.isArray(data) ? data : (data.companies || []);
      return arr.map((c: any) => ({ id: c.id, name: c.name }));
    },
    staleTime: 120000,
  });
  if (ids.length > 0 && allCompanies) {
    const resolved = ids
      .map(id => ({ id, name: allCompanies.find(c => c.id === id)?.name }))
      .filter(x => x.name);
    if (resolved.length > 0) return <span className="flex flex-wrap gap-0.5">{resolved.map((r, i) => (
      <Link
        key={i}
        href={`/companies/${r.id}`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center hover:underline"
      >
        <Badge variant="outline" className="text-[8px] border-teal-300 text-teal-700 bg-teal-50 px-1 py-0 cursor-pointer">
          {r.name}
        </Badge>
      </Link>
    ))}</span>;
  }
  return <span>{targetBrands || "—"}</span>;
}

export function PropertyLeasingSchedule({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set(["__all__"]));
  // Excel import state — referenced by the "Import Excel" button + preview
  // dialog rendered further down. These were missing in this component
  // (only declared in the standalone PropertyScheduleView), which crashed
  // the property detail page with `ReferenceError: importParsing is not
  // defined` whenever the schedule was rendered.
  const [importParsing, setImportParsing] = useState(false);
  const [importPreview, setImportPreview] = useState<{ sheetName: string; sheetCount: number; rowsScanned: number; units: any[] } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const handleImportExcel = async (file: File) => {
    setImportParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}/parse-excel`, {
        method: "POST", headers: getAuthHeaders(), body: fd,
      });
      if (!r.ok) { toast({ title: "Parse failed", description: (await r.json()).error || "Could not read file", variant: "destructive" }); return; }
      const data = await r.json();
      if (!data.units?.length) { toast({ title: "No units found", description: "AI could not extract rows from that sheet", variant: "destructive" }); return; }
      setImportPreview(data);
    } catch (e: any) {
      toast({ title: "Parse failed", description: e.message, variant: "destructive" });
    } finally {
      setImportParsing(false);
    }
  };

  const confirmImport = async () => {
    if (!importPreview?.units?.length) return;
    try {
      const r = await fetch(`/api/leasing-schedule/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ property_id: propertyId, units: importPreview.units }),
      });
      if (!r.ok) { toast({ title: "Import failed", variant: "destructive" }); return; }
      const data = await r.json();
      toast({ title: `${data.imported} units imported` });
      setImportPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    }
  };

  const { data: units = [], isLoading, error: unitsError } = useQuery<LeasingUnit[]>({
    queryKey: ["/api/leasing-schedule/property", propertyId],
    queryFn: async () => {
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}`, { headers: getAuthHeaders() });
      if (r.status === 403) throw new Error("ACCESS_DENIED");
      if (!r.ok) throw new Error("LOAD_FAILED");
      return r.json();
    },
    enabled: !!propertyId,
    retry: false,
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", `/api/leasing-schedule/unit/${data.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
    },
    onError: (err: any) => { toast({ title: "Update failed", description: err.message, variant: "destructive" }); },
  });

  const addMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/leasing-schedule/unit", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      setShowAddUnit(false);
      toast({ title: "Unit added" });
    },
    onError: (err: any) => { toast({ title: "Failed to add unit", description: err.message, variant: "destructive" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/leasing-schedule/unit/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      toast({ title: "Unit removed" });
    },
    onError: (err: any) => { toast({ title: "Failed to delete unit", description: err.message, variant: "destructive" }); },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/leasing-schedule/units/${id}/archive`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/property", propertyId] });
      toast({ title: "Unit archived" });
    },
    onError: (err: any) => { toast({ title: "Archive failed", description: err.message, variant: "destructive" }); },
  });

  const [includeArchived, setIncludeArchived] = useState(false);

  const inlineUpdate = (unitId: string, field: string, value: string) => {
    updateMutation.mutate({ id: unitId, [field]: value });
  };

  const archivedCount = useMemo(() => units.filter(u => u.status === "Archived").length, [units]);

  const stats = useMemo(() => {
    const active = includeArchived ? units : units.filter(u => u.status !== "Archived");
    return {
      total: active.length,
      occupied: active.filter(u => u.status === "Occupied").length,
      vacant: active.filter(u => u.status === "Vacant").length,
      expiring: active.filter(u => isExpiringSoon(u.lease_expiry)).length,
      expired: active.filter(u => isExpired(u.lease_expiry)).length,
    };
  }, [units, includeArchived]);

  const filteredUnits = useMemo(() => {
    return units.filter(u => {
      if (!includeArchived && u.status === "Archived") return false;
      if (debouncedSearch) {
        const s = debouncedSearch.toLowerCase();
        if (!u.unit_name?.toLowerCase().includes(s) && !u.zone?.toLowerCase().includes(s) &&
          !u.tenant_name?.toLowerCase().includes(s) && !u.target_brands?.toLowerCase().includes(s) &&
          !u.updates?.toLowerCase().includes(s)) return false;
      }
      if (statusFilter === "occupied" && u.status !== "Occupied") return false;
      if (statusFilter === "vacant" && u.status !== "Vacant") return false;
      if (statusFilter === "expiring" && !isExpiringSoon(u.lease_expiry)) return false;
      if (statusFilter === "expired" && !isExpired(u.lease_expiry)) return false;
      return true;
    });
  }, [units, debouncedSearch, statusFilter, includeArchived]);

  const zoneGroups = useMemo(() => {
    const groups: Record<string, LeasingUnit[]> = {};
    for (const u of filteredUnits) {
      const zone = u.zone || "Unzoned";
      if (!groups[zone]) groups[zone] = [];
      groups[zone].push(u);
    }
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredUnits]);

  const handleExportExcel = async () => {
    try {
      const r = await fetch(`/api/leasing-schedule/property/${propertyId}/export-excel`, { headers: getAuthHeaders() });
      if (!r.ok) { toast({ title: "Export failed", variant: "destructive" }); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Leasing_Schedule.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Excel exported" });
    } catch { toast({ title: "Export failed", variant: "destructive" }); }
  };

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading leasing schedule...</div>;
  if (unitsError) {
    const isAccessDenied = (unitsError as Error)?.message === "ACCESS_DENIED";
    return (
      <div className="space-y-3" data-testid="property-leasing-schedule">
        <h3 className="font-semibold text-sm flex items-center gap-2"><Building2 className="w-4 h-4" />Leasing Schedule</h3>
        <div className="text-center py-6 text-gray-400 border rounded-lg">
          <Lock className="w-6 h-6 mx-auto mb-1 opacity-40" />
          <p className="text-xs">{isAccessDenied ? "You don't have access to this property's leasing schedule" : "Failed to load leasing schedule"}</p>
        </div>
      </div>
    );
  }
  if (units.length === 0 && !showAddUnit) return (
    <div className="space-y-3" data-testid="property-leasing-schedule">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Building2 className="w-4 h-4" />Leasing Schedule
        </h3>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => importFileRef.current?.click()} disabled={importParsing} data-testid="btn-import-first">
            {importParsing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}Import Excel
          </Button>
          <input
            ref={importFileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportExcel(f);
              e.target.value = "";
            }}
          />
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAddUnit(true)} data-testid="btn-add-first-unit">
            <Plus className="w-3 h-3 mr-1" />Add Unit
          </Button>
          <Link href={`/leasing-schedule/${propertyId}`}>
            <span className="text-[10px] text-indigo-500 hover:underline flex items-center gap-1 cursor-pointer">
              <ExternalLink className="w-3 h-3" />Full Board
            </span>
          </Link>
        </div>
      </div>
      {showAddUnit && <PropAddUnitForm propertyId={propertyId} onSave={(data: any) => addMutation.mutate(data)} onCancel={() => setShowAddUnit(false)} isPending={addMutation.isPending} />}
      <div className="text-center py-6 text-gray-400 border rounded-lg">
        <Building2 className="w-6 h-6 mx-auto mb-1 opacity-40" />
        <p className="text-xs">No units in leasing schedule</p>
        <p className="text-[10px] mt-0.5">Add units or import a landlord Excel to track this property's leasing schedule</p>
      </div>

      <Dialog open={!!importPreview} onOpenChange={(v) => !v && setImportPreview(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Preview import — {importPreview?.units.length} units from "{importPreview?.sheetName}"
            </DialogTitle>
          </DialogHeader>
          <div className="text-[11px] text-muted-foreground mb-2">
            AI mapped {importPreview?.rowsScanned} rows. Review before importing — you can edit rows after.
          </div>
          <div className="overflow-auto flex-1 border rounded">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/40 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">Unit</th>
                  <th className="text-left px-2 py-1">Tenant</th>
                  <th className="text-right px-2 py-1">Sq ft</th>
                  <th className="text-right px-2 py-1">Rent £ p.a.</th>
                  <th className="text-left px-2 py-1">Expiry</th>
                  <th className="text-left px-2 py-1">Break</th>
                  <th className="text-left px-2 py-1">Review</th>
                  <th className="text-left px-2 py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {importPreview?.units.map((u, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1 font-mono">{u.unit_name || "—"}</td>
                    <td className="px-2 py-1">{u.tenant_name || "—"}</td>
                    <td className="px-2 py-1 text-right">{u.sqft ? Number(u.sqft).toLocaleString() : "—"}</td>
                    <td className="px-2 py-1 text-right">{u.rent_pa ? "£" + Number(u.rent_pa).toLocaleString() : "—"}</td>
                    <td className="px-2 py-1">{u.lease_expiry || "—"}</td>
                    <td className="px-2 py-1">{u.lease_break || "—"}</td>
                    <td className="px-2 py-1">{u.rent_review || "—"}</td>
                    <td className="px-2 py-1">{u.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setImportPreview(null)}>Cancel</Button>
            <Button size="sm" onClick={confirmImport}>Import {importPreview?.units.length} units</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  const toggleZone = (zone: string) => {
    setExpandedZones(p => {
      const next = new Set(p);
      if (next.has(zone)) next.delete(zone); else next.add(zone);
      return next;
    });
  };

  const allExpanded = expandedZones.has("__all__") || expandedZones.size === zoneGroups.length;
  const toggleAll = () => {
    if (allExpanded) {
      setExpandedZones(new Set());
    } else {
      setExpandedZones(new Set(["__all__", ...zoneGroups.map(([z]) => z)]));
    }
  };

  return (
    <div className="space-y-3" data-testid="property-leasing-schedule">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Building2 className="w-4 h-4" />Leasing Schedule
          <Badge variant="secondary" className="text-[10px]">{stats.total} units</Badge>
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2 top-1.5 w-3 h-3 text-gray-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search units..."
              className="pl-6 pr-2 h-7 text-[11px] border rounded-md bg-background w-[140px] outline-none focus:ring-1 focus:ring-teal-400"
              data-testid="search-prop-units"
            />
          </div>
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={handleExportExcel} data-testid="btn-export-excel">
            <Download className="w-3 h-3" />Excel
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => importFileRef.current?.click()} disabled={importParsing} data-testid="btn-import-excel">
            {importParsing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}Import
          </Button>
          <input
            ref={importFileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportExcel(f);
              e.target.value = "";
            }}
          />
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setShowAddUnit(true)} data-testid="btn-add-unit-prop">
            <Plus className="w-3 h-3" />Add
          </Button>
          <Link href={`/leasing-schedule/${propertyId}`}>
            <span className="text-[10px] text-indigo-500 hover:underline flex items-center gap-1 cursor-pointer" data-testid="link-full-board">
              <ExternalLink className="w-3 h-3" />Full Board
            </span>
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
          {[
            { label: "Occupied", count: stats.occupied, color: "text-emerald-600 bg-emerald-50 border-emerald-200", key: "occupied" },
            { label: "Vacant", count: stats.vacant, color: "text-gray-600 bg-gray-50 border-gray-200", key: "vacant" },
            { label: "Expiring", count: stats.expiring, color: "text-amber-600 bg-amber-50 border-amber-200", key: "expiring" },
            { label: "Expired", count: stats.expired, color: "text-red-600 bg-red-50 border-red-200", key: "expired" },
          ].map(s => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(statusFilter === s.key ? null : s.key)}
              className={`rounded-lg border px-3 py-2 text-left transition-all ${statusFilter === s.key ? "ring-2 ring-teal-400 " + s.color : "border-gray-200 dark:border-gray-700 hover:border-gray-300"}`}
              data-testid={`stat-${s.key}`}
            >
              <div className={`text-lg font-bold ${statusFilter === s.key ? "" : "text-foreground"}`}>{s.count}</div>
              <div className={`text-[10px] font-medium ${statusFilter === s.key ? "" : "text-muted-foreground"}`}>{s.label}</div>
            </button>
          ))}
        </div>
        {archivedCount > 0 && (
          <button
            onClick={() => setIncludeArchived(!includeArchived)}
            className={`flex items-center gap-1 px-2 py-1 rounded border text-[10px] transition-colors ${includeArchived ? "border-gray-400 bg-gray-100 dark:bg-gray-700 text-foreground" : "border-gray-200 dark:border-gray-700 text-muted-foreground hover:bg-gray-50"}`}
            data-testid="toggle-include-archived-prop"
          >
            <Eye className="w-3 h-3" />
            Archived ({archivedCount})
          </button>
        )}
      </div>

      {showAddUnit && <PropAddUnitForm propertyId={propertyId} onSave={(data: any) => addMutation.mutate(data)} onCancel={() => setShowAddUnit(false)} isPending={addMutation.isPending} />}

      <div className="border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border-b">
          <button onClick={toggleAll} className="text-[10px] text-gray-500 hover:text-gray-700 flex items-center gap-1" data-testid="btn-toggle-all-zones">
            {allExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
          <span className="text-[10px] text-gray-400">{filteredUnits.length} of {units.length} units</span>
        </div>

        {zoneGroups.map(([zone, zoneUnits]) => {
          const isExpanded = expandedZones.has("__all__") || expandedZones.has(zone);
          const zoneOcc = zoneUnits.filter(u => u.status === "Occupied").length;
          return (
            <div key={zone}>
              <button
                onClick={() => toggleZone(zone)}
                className="w-full flex items-center gap-2 px-3 py-1.5 bg-gray-50/50 dark:bg-gray-800/50 hover:bg-gray-100 border-b text-left"
                data-testid={`zone-header-${zone}`}
              >
                {isExpanded ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
                <span className="font-medium text-xs">{zone}</span>
                <Badge variant="secondary" className="text-[9px]">{zoneUnits.length}</Badge>
                <span className="text-[9px] text-emerald-600 ml-auto">{zoneOcc}/{zoneUnits.length} occ</span>
              </button>
              {isExpanded && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50/30 border-b text-left text-sm">
                        <th className="px-2 py-1 font-medium text-gray-500 w-[140px]">Unit</th>
                        <th className="px-2 py-1 font-medium text-gray-500 w-[120px]">Tenant</th>
                        <th className="px-2 py-1 font-medium text-gray-500 w-[75px]">Status</th>
                        <th className="px-2 py-1 font-medium text-gray-500 w-[85px]">Expiry</th>
                        <th className="px-2 py-1 font-medium text-gray-500 w-[85px]">Break</th>
                        <th className="px-2 py-1 font-medium text-gray-500 w-[80px]">Rent PA</th>
                        <th className="px-2 py-1 font-medium text-gray-500 w-[60px]">Sq Ft</th>
                        <th className="px-2 py-1 font-medium text-gray-500 w-[70px]">MAT/psf</th>
                        <th className="px-2 py-1 font-medium text-gray-500">Targets</th>
                        <th className="px-2 py-1 font-medium text-gray-500 w-[140px]">Updates</th>
                        <th className="px-2 py-1 w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="text-xs">
                      {zoneUnits.map(u => (
                        <tr key={u.id} className={`border-b hover:bg-gray-50 dark:hover:bg-gray-900/50 group ${u.status === "Archived" ? "opacity-50" : ""}`} data-testid={`unit-row-${u.id}`}>
                          <td className="px-2 py-1">
                            <InlineEditCell unitId={u.id} field="unit_name" value={u.unit_name || ""} onSave={inlineUpdate} className="font-medium" placeholder="Unit name" />
                          </td>
                          <td className="px-2 py-1">
                            <InlineEditCell unitId={u.id} field="tenant_name" value={u.tenant_name || ""} onSave={inlineUpdate} placeholder="Tenant" />
                          </td>
                          <td className="px-2 py-1">
                            <InlineStatusCell unitId={u.id} value={u.status} onSave={inlineUpdate} />
                          </td>
                          <td className="px-2 py-1">
                            <InlineDateCell unitId={u.id} field="lease_expiry" value={u.lease_expiry} onSave={inlineUpdate}
                              className={isExpired(u.lease_expiry) ? "text-red-600" : isExpiringSoon(u.lease_expiry) ? "text-amber-600" : ""} />
                          </td>
                          <td className="px-2 py-1">
                            <InlineDateCell unitId={u.id} field="lease_break" value={u.lease_break} onSave={inlineUpdate} />
                          </td>
                          <td className="px-2 py-1">
                            <InlineEditCell unitId={u.id} field="rent_pa" value={u.rent_pa?.toString() || ""} onSave={inlineUpdate} placeholder="£" />
                          </td>
                          <td className="px-2 py-1">
                            <InlineEditCell unitId={u.id} field="sqft" value={u.sqft?.toString() || ""} onSave={inlineUpdate} placeholder="sqft" />
                          </td>
                          <td className="px-2 py-1 text-[10px]">
                            <InlineEditCell unitId={u.id} field="mat_psqft" value={u.mat_psqft || ""} onSave={inlineUpdate} placeholder="—" />
                          </td>
                          <td className="px-2 py-1">
                            <TargetCompaniesCell unitId={u.id} targetCompanyIds={u.target_company_ids || "[]"} targetBrands={u.target_brands || ""} onUpdate={inlineUpdate} />
                          </td>
                          <td className="px-2 py-1">
                            <InlineEditCell unitId={u.id} field="updates" value={u.updates || ""} onSave={inlineUpdate} placeholder="Notes..." multiline />
                          </td>
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => { if (confirm(u.status === "Archived" ? "Restore this unit?" : "Archive this unit?")) archiveMutation.mutate(u.id); }}
                                className={u.status === "Archived" ? "text-emerald-500 hover:text-emerald-700" : "text-gray-400 hover:text-amber-600"}
                                title={u.status === "Archived" ? "Restore" : "Archive"}
                                data-testid={`btn-archive-unit-${u.id}`}
                              >
                                {u.status === "Archived" ? <History className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
                              </button>
                              <button
                                onClick={() => { if (confirm("Delete this unit permanently?")) deleteMutation.mutate(u.id); }}
                                className="text-red-400 hover:text-red-600"
                                data-testid={`btn-delete-unit-${u.id}`}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {filteredUnits.length === 0 && (
          <div className="text-center py-4 text-gray-400 text-xs">No units match your filters</div>
        )}
      </div>

      <Dialog open={!!importPreview} onOpenChange={(v) => !v && setImportPreview(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Preview import — {importPreview?.units.length} units from "{importPreview?.sheetName}"
            </DialogTitle>
          </DialogHeader>
          <div className="text-[11px] text-muted-foreground mb-2">
            AI mapped {importPreview?.rowsScanned} rows. Review before importing — you can edit individual rows after.
          </div>
          <div className="overflow-auto flex-1 border rounded">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/40 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">Unit</th>
                  <th className="text-left px-2 py-1">Tenant</th>
                  <th className="text-right px-2 py-1">Sq ft</th>
                  <th className="text-right px-2 py-1">Rent £ p.a.</th>
                  <th className="text-left px-2 py-1">Expiry</th>
                  <th className="text-left px-2 py-1">Break</th>
                  <th className="text-left px-2 py-1">Review</th>
                  <th className="text-left px-2 py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {importPreview?.units.map((u, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1 font-mono">{u.unit_name || "—"}</td>
                    <td className="px-2 py-1">{u.tenant_name || "—"}</td>
                    <td className="px-2 py-1 text-right">{u.sqft ? Number(u.sqft).toLocaleString() : "—"}</td>
                    <td className="px-2 py-1 text-right">{u.rent_pa ? "£" + Number(u.rent_pa).toLocaleString() : "—"}</td>
                    <td className="px-2 py-1">{u.lease_expiry || "—"}</td>
                    <td className="px-2 py-1">{u.lease_break || "—"}</td>
                    <td className="px-2 py-1">{u.rent_review || "—"}</td>
                    <td className="px-2 py-1">{u.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setImportPreview(null)}>Cancel</Button>
            <Button size="sm" onClick={confirmImport} data-testid="btn-confirm-import">Import {importPreview?.units.length} units</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PropAddUnitForm({ propertyId, onSave, onCancel, isPending }: {
  propertyId: string; onSave: (data: any) => void; onCancel: () => void; isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [zone, setZone] = useState("");
  const [status, setStatus] = useState("Vacant");

  return (
    <div className="border rounded-lg p-3 bg-gray-50 dark:bg-gray-800/50 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-gray-500 block mb-0.5">Unit Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Unit 1A"
            className="w-full h-7 text-xs border rounded px-2 bg-background" data-testid="input-new-unit-name" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block mb-0.5">Zone</label>
          <input value={zone} onChange={e => setZone(e.target.value)} placeholder="e.g. Ground Floor"
            className="w-full h-7 text-xs border rounded px-2 bg-background" data-testid="input-new-unit-zone" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block mb-0.5">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="w-full h-7 text-xs border rounded px-2 bg-background" data-testid="select-new-unit-status">
            <option value="Occupied">Occupied</option>
            <option value="Vacant">Vacant</option>
            <option value="Under Offer">Under Offer</option>
            <option value="In Negotiation">In Negotiation</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel} data-testid="btn-cancel-add-unit">Cancel</Button>
        <Button size="sm" className="h-7 text-xs" disabled={!name.trim() || isPending} data-testid="btn-save-new-unit"
          onClick={() => onSave({ property_id: propertyId, unit_name: name.trim(), zone: zone.trim() || null, status })}>
          {isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}Add Unit
        </Button>
      </div>
    </div>
  );
}

export function CompanyLeasingSchedule({ companyId }: { companyId: string }) {
  const [expandedProps, setExpandedProps] = useState<Set<string>>(new Set());
  const { data: units = [], isLoading } = useQuery<LeasingUnit[]>({
    queryKey: ["/api/leasing-schedule/company", companyId],
    queryFn: () => fetch(`/api/leasing-schedule/company/${companyId}`, { credentials: "include", headers: { ...getAuthHeaders() } }).then(r => r.json()),
    enabled: !!companyId,
  });

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading leasing schedule...</div>;
  if (units.length === 0) return null;

  const byProperty = new Map<string, { name: string; units: LeasingUnit[] }>();
  for (const u of units) {
    const key = u.property_id;
    if (!byProperty.has(key)) byProperty.set(key, { name: u.property_name || "Unknown", units: [] });
    byProperty.get(key)!.units.push(u);
  }

  const allExpanded = expandedProps.size === byProperty.size;
  const toggleProp = (id: string) => {
    setExpandedProps(p => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const totalUnits = units.length;
  const occupied = units.filter(u => u.status === "Occupied").length;
  const expiring = units.filter(u => isExpiringSoon(u.lease_expiry)).length;

  return (
    <Card>
    <CardContent className="p-3 space-y-3" data-testid="company-leasing-schedule">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Building2 className="w-4 h-4" />Leasing Schedule
          <Badge variant="secondary" className="text-[10px]">{totalUnits} units across {byProperty.size} properties</Badge>
        </h3>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-emerald-600">{occupied} occupied</span>
          {expiring > 0 && <span className="text-amber-600">{expiring} expiring</span>}
          <Link href="/leasing-schedule">
            <span className="text-indigo-500 hover:underline flex items-center gap-1 cursor-pointer" data-testid="link-leasing-board">
              <ExternalLink className="w-3 h-3" />Open Board
            </span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
    {Array.from(byProperty.entries()).map(([propId, { name, units: propUnits }]) => {
        const expanded = expandedProps.has(propId);
        const propOccupied = propUnits.filter(u => u.status === "Occupied").length;
        const propExpiring = propUnits.filter(u => isExpiringSoon(u.lease_expiry)).length;
        return (
          <div key={propId} className="border rounded-lg overflow-hidden">
            <button
              onClick={() => toggleProp(propId)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 text-left"
              data-testid={`company-prop-${propId}`}
            >
              {expanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
              <span className="font-medium text-sm">{name}</span>
              <Badge variant="secondary" className="text-[10px]">{propUnits.length}</Badge>
              <span className="text-[10px] text-emerald-600 ml-auto">{propOccupied} occ</span>
              {propExpiring > 0 && <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-600 ml-1">{propExpiring} exp</Badge>}
              <Link href={`/leasing-schedule/${propId}`}>
                <span className="text-[10px] text-indigo-500 hover:underline ml-2" onClick={e => e.stopPropagation()}>View Full</span>
              </Link>
            </button>
            {expanded && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50/50 border-b text-left text-sm">
                      <th className="px-3 py-1 font-medium text-gray-500">Zone</th>
                      <th className="px-3 py-1 font-medium text-gray-500">Tenant</th>
                      <th className="px-3 py-1 font-medium text-gray-500">Status</th>
                      <th className="px-3 py-1 font-medium text-gray-500">Expiry</th>
                      <th className="px-3 py-1 font-medium text-gray-500">Performance</th>
                      <th className="px-3 py-1 font-medium text-gray-500">Targets</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs">
                    {propUnits.slice(0, 20).map(u => (
                      <tr key={u.id} className="border-b hover:bg-gray-50">
                        <td className="px-3 py-1.5 text-gray-500 max-w-[120px] truncate">{u.zone}</td>
                        <td className="px-3 py-1.5 font-medium">{u.unit_name}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant="outline" className={`text-[9px] ${u.status === "Occupied" ? "border-emerald-300 text-emerald-700" : "border-gray-300 text-gray-500"}`}>{u.status}</Badge>
                        </td>
                        <td className={`px-3 py-1.5 ${isExpired(u.lease_expiry) ? "text-red-600" : isExpiringSoon(u.lease_expiry) ? "text-amber-600" : "text-gray-600"}`}>
                          {u.lease_expiry ? formatDate(u.lease_expiry) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-[10px]">
                          {u.mat_psqft && <span>{u.mat_psqft}</span>}
                          {u.lfl_percent && <span className={`ml-1 ${u.lfl_percent.startsWith("-") ? "text-red-500" : "text-emerald-600"}`}>{u.lfl_percent}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-[10px] text-gray-500 max-w-[150px]">
                          <TargetCompanyNames targetCompanyIds={u.target_company_ids || "[]"} targetBrands={u.target_brands || ""} />
                        </td>
                      </tr>
                    ))}
                    {propUnits.length > 20 && <tr><td colSpan={6} className="px-3 py-1 text-center text-[10px] text-gray-400">+{propUnits.length - 20} more</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
      </div>
    </CardContent>
    </Card>
  );
}

export default function LeasingSchedulePage() {
  const { toast } = useToast();
  const [, params] = useRoute("/leasing-schedule/:propertyId");
  const propertyId = params?.propertyId;
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "card" | "board">(
    typeof window !== "undefined" && window.innerWidth < 768 ? "card" : "card"
  );
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [exporting, setExporting] = useState(false);

  // ─── Board-level import (xlsx → pick a CRM property → parse → import) ───
  const [importOpen, setImportOpen] = useState(false);
  const [importPropertyId, setImportPropertyId] = useState<string>("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStep, setImportStep] = useState<"pick" | "parsing" | "preview" | "importing">("pick");
  const [importPreview, setImportPreview] = useState<{ sheetName: string; units: any[] } | null>(null);
  // Multi-scheme: each scheme from the xlsx gets its own property mapping
  const [multiSchemes, setMultiSchemes] = useState<Array<{
    sheetName: string;
    schemeHint: string;
    units: any[];
    propertyId: string;
    skipped?: boolean;
    skipReason?: string;
    error?: string;
  }> | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const { data: properties = [], isLoading } = useQuery<LeasingProperty[]>({
    queryKey: ["/api/leasing-schedule/properties"],
    enabled: !propertyId,
  });

  const { data: crmPropertiesResp } = useQuery<any>({
    queryKey: ["/api/crm/properties", "for-leasing-import"],
    queryFn: () => fetch(`/api/crm/properties?limit=2000`, { headers: getAuthHeaders() }).then(r => r.json()),
    enabled: !propertyId,
  });
  const crmProperties: { id: string; name: string; address?: string }[] = useMemo(() => {
    const raw = Array.isArray(crmPropertiesResp) ? crmPropertiesResp : (crmPropertiesResp?.data || []);
    return raw.map((p: any) => ({ id: p.id, name: p.name || p.address || "(unnamed)", address: p.address }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  }, [crmPropertiesResp]);

  const resetImport = () => {
    setImportOpen(false);
    setImportPropertyId("");
    setImportFile(null);
    setImportStep("pick");
    setImportPreview(null);
    setMultiSchemes(null);
  };

  // Parse: always calls the multi endpoint. If it returns one scheme we drop
  // back to the single-property preview; if it returns several we go into the
  // scheme→property mapping view.
  const runBoardParse = async () => {
    if (!importFile) return;
    setImportStep("parsing");
    try {
      const fd = new FormData();
      fd.append("file", importFile);
      const r = await fetch(`/api/leasing-schedule/parse-excel-multi`, {
        method: "POST", headers: getAuthHeaders(), body: fd,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        toast({ title: "Parse failed", description: err.error || "Could not read file", variant: "destructive" });
        setImportStep("pick");
        return;
      }
      const data = await r.json();
      const schemes: Array<{ sheetName: string; schemeHint?: string; units: any[]; skipped?: boolean; skipReason?: string; error?: string }> =
        Array.isArray(data.schemes) ? data.schemes : [];

      if (schemes.length === 0) {
        toast({ title: "No sheets found", description: "The workbook appears to be empty", variant: "destructive" });
        setImportStep("pick");
        return;
      }

      const usableCount = schemes.filter(s => Array.isArray(s.units) && s.units.length > 0).length;

      if (usableCount === 0) {
        toast({
          title: "No unit rows extracted",
          description: `Read ${schemes.length} sheet${schemes.length === 1 ? "" : "s"} but AI couldn't find unit rows on any of them`,
          variant: "destructive",
        });
        setImportStep("pick");
        return;
      }

      // If exactly one sheet has units AND it's the only sheet full-stop,
      // use the simple single-scheme preview. Otherwise always show the multi
      // view so the user can see every sheet including skipped ones.
      if (usableCount === 1 && schemes.length === 1) {
        const only = schemes.find(s => s.units.length > 0)!;
        setImportPreview({ sheetName: only.sheetName, units: only.units });
        setMultiSchemes(null);
        setImportStep("preview");
        return;
      }

      // Multi-scheme workbook: keep all sheets — including skipped/errored —
      // so the user can see and debug why a particular tab wasn't parsed.
      setMultiSchemes(schemes.map(s => ({
        sheetName: s.sheetName,
        schemeHint: s.schemeHint || s.sheetName,
        units: s.units || [],
        propertyId: importPropertyId || "",
        skipped: s.skipped,
        skipReason: s.skipReason,
        error: s.error,
      })));
      setImportPreview(null);
      setImportStep("preview");
    } catch (e: any) {
      toast({ title: "Parse failed", description: e.message, variant: "destructive" });
      setImportStep("pick");
    }
  };

  const runBoardImport = async () => {
    // Multi path
    if (multiSchemes && multiSchemes.length > 0) {
      const mapped = multiSchemes.filter(s => s.propertyId && s.units.length > 0);
      if (mapped.length === 0) {
        toast({ title: "Pick a property for at least one scheme", variant: "destructive" });
        return;
      }
      setImportStep("importing");
      try {
        const r = await fetch(`/api/leasing-schedule/import-multi`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ imports: mapped.map(s => ({ property_id: s.propertyId, units: s.units })) }),
        });
        if (!r.ok) { toast({ title: "Import failed", variant: "destructive" }); setImportStep("preview"); return; }
        const data = await r.json();
        toast({ title: `${data.totalImported} units imported across ${mapped.length} scheme${mapped.length === 1 ? "" : "s"}` });
        queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/properties"] });
        resetImport();
      } catch (e: any) {
        toast({ title: "Import failed", description: e.message, variant: "destructive" });
        setImportStep("preview");
      }
      return;
    }

    // Single path
    if (!importPreview?.units?.length || !importPropertyId) {
      toast({ title: "Pick a property for this schedule", variant: "destructive" });
      return;
    }
    setImportStep("importing");
    try {
      const r = await fetch(`/api/leasing-schedule/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ property_id: importPropertyId, units: importPreview.units }),
      });
      if (!r.ok) { toast({ title: "Import failed", variant: "destructive" }); setImportStep("preview"); return; }
      const data = await r.json();
      toast({ title: `${data.imported} units imported` });
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-schedule/properties"] });
      resetImport();
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
      setImportStep("preview");
    }
  };

  const handleExportAll = async () => {
    if (properties.length === 0) return;
    setExporting(true);
    try {
      const res = await fetch("/api/leasing-schedule/export-multi-excel", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ propertyIds: properties.map(p => p.id) }),
      });
      if (!res.ok) { toast({ title: "Export failed", variant: "destructive" }); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "BGP_Leasing_Schedules.xlsx"; a.click();
      URL.revokeObjectURL(url);
      toast({ title: "All schedules exported to Excel" });
    } catch { toast({ title: "Export failed", variant: "destructive" }); }
    finally { setExporting(false); }
  };

  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const handleDownloadExcel = async () => {
    setDownloadingExcel(true);
    try {
      const res = await fetch("/api/leasing-schedule/export-excel", { headers: getAuthHeaders() });
      if (!res.ok) { toast({ title: "Export failed", variant: "destructive" }); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date().toISOString().slice(0, 10);
      a.href = url; a.download = `BGP_Leasing_Schedule_${today}.xlsx`; a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Excel downloaded" });
    } catch { toast({ title: "Export failed", variant: "destructive" }); }
    finally { setDownloadingExcel(false); }
  };

  const filtered = useMemo(() => {
    if (!debouncedSearch) return properties;
    const s = debouncedSearch.toLowerCase();
    return properties.filter(p =>
      p.name.toLowerCase().includes(s) || p.landlord_name?.toLowerCase().includes(s)
    );
  }, [properties, debouncedSearch]);

  const stats = useMemo(() => {
    const totalProps = filtered.length;
    const totalUnits = filtered.reduce((s, p) => s + p.unit_count, 0);
    const occupied = filtered.reduce((s, p) => s + p.occupied_count, 0);
    const vacant = filtered.reduce((s, p) => s + p.vacant_count, 0);
    const expiring = filtered.reduce((s, p) => s + p.expiring_soon, 0);
    const occupancy = totalUnits > 0 ? Math.round((occupied / totalUnits) * 100) : 0;
    return { totalProps, totalUnits, occupied, vacant, expiring, occupancy };
  }, [filtered]);

  const byLandlord = useMemo(() => {
    const groups: Record<string, LeasingProperty[]> = {};
    for (const p of filtered) {
      const key = p.landlord_name || "Other";
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  if (propertyId) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <PropertyScheduleView propertyId={propertyId} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="page-title">
            <Building2 className="w-5 h-5" />Leasing Schedule Board
          </h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "property" : "properties"} · {stats.totalUnits} units
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle view={viewMode} onToggle={setViewMode} />
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search properties..." className="pl-8 h-8 text-xs w-[200px]" data-testid="search-properties" />
          </div>
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setImportOpen(true)} data-testid="btn-import-board">
            <Upload className="w-3.5 h-3.5" />
            Import Excel
          </Button>
          {properties.length > 0 && (
            <>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleDownloadExcel} disabled={downloadingExcel} data-testid="btn-download-excel">
                {downloadingExcel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Download Excel
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleExportAll} disabled={exporting} data-testid="btn-export-all">
                {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Export All
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stat cards — matching WIP / investment tracker style */}
      <ScrollArea className="w-full shrink-0">
        <div className="flex items-center gap-3 pb-1">
          <Card className="flex-shrink-0 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <div>
                  <p className="text-lg font-bold">{stats.totalProps}</p>
                  <p className="text-xs text-muted-foreground">Properties</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-shrink-0 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                <div>
                  <p className="text-lg font-bold">{stats.totalUnits}</p>
                  <p className="text-xs text-muted-foreground">Total Units</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-shrink-0 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <div>
                  <p className="text-lg font-bold">{stats.occupied}</p>
                  <p className="text-xs text-muted-foreground">Occupied</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-shrink-0 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                <div>
                  <p className="text-lg font-bold">{stats.vacant}</p>
                  <p className="text-xs text-muted-foreground">Vacant</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-shrink-0 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <div>
                  <p className="text-lg font-bold">{stats.expiring}</p>
                  <p className="text-xs text-muted-foreground">Expiring Soon</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-shrink-0 min-w-[120px]">
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                <div>
                  <p className="text-lg font-bold">{stats.occupancy}%</p>
                  <p className="text-xs text-muted-foreground">Occupancy</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : viewMode === "table" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Landlord</TableHead>
                  <TableHead>Asset Class</TableHead>
                  <TableHead className="text-center">Units</TableHead>
                  <TableHead className="text-center">Occupied</TableHead>
                  <TableHead className="text-center">Vacant</TableHead>
                  <TableHead className="text-center">Expiring</TableHead>
                  <TableHead className="text-center">Occupancy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(p => {
                  const occ = p.unit_count > 0 ? Math.round((p.occupied_count / p.unit_count) * 100) : 0;
                  return (
                    <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell>
                        <Link href={`/leasing-schedule/${p.id}`} className="font-medium text-sm hover:underline">{p.name}</Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.landlord_id ? (
                          <Link href={`/companies/${p.landlord_id}`} className="hover:underline text-blue-600 dark:text-blue-400" onClick={(e: any) => e.stopPropagation()}>{p.landlord_name}</Link>
                        ) : p.landlord_name || "—"}
                      </TableCell>
                      <TableCell className="text-sm">{p.asset_class || "—"}</TableCell>
                      <TableCell className="text-center text-sm font-medium">{p.unit_count}</TableCell>
                      <TableCell className="text-center text-sm text-emerald-600">{p.occupied_count}</TableCell>
                      <TableCell className="text-center text-sm text-gray-400">{p.vacant_count}</TableCell>
                      <TableCell className="text-center text-sm">
                        {p.expiring_soon > 0 ? (
                          <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 bg-amber-50">{p.expiring_soon}</Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="w-16 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${occ}%` }} />
                          </div>
                          <span className="text-xs font-medium">{occ}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {filtered.length === 0 && (
            <EmptyBoardImport onImportClick={() => setImportOpen(true)} />
          )}
        </Card>
      ) : (
        <div className="space-y-6">
          {byLandlord.map(([landlord, props]) => {
            const landlordId = props[0]?.landlord_id;
            return (
            <div key={landlord}>
              <h2 className="font-semibold text-sm text-muted-foreground mb-3 flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5" />
                {landlordId ? (
                  <Link href={`/companies/${landlordId}`}>
                    <span className="hover:underline cursor-pointer text-blue-600 dark:text-blue-400" data-testid={`link-landlord-${landlordId}`}>{landlord}</span>
                  </Link>
                ) : landlord}
                <Badge variant="secondary" className="text-[10px]">{props.reduce((s, p) => s + p.unit_count, 0)} units</Badge>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {props.map(p => <PropertyCard key={p.id} prop={p} />)}
              </div>
            </div>
            );
          })}
          {filtered.length === 0 && (
            <EmptyBoardImport onImportClick={() => setImportOpen(true)} />
          )}
        </div>
      )}

      {/* Board-level Import Excel dialog */}
      <Dialog open={importOpen} onOpenChange={(o) => { if (!o) resetImport(); else setImportOpen(true); }}>
        <DialogContent className={multiSchemes ? "max-w-3xl" : "max-w-lg"}>
          <DialogHeader>
            <DialogTitle>Import Leasing Schedule from Excel</DialogTitle>
          </DialogHeader>
          {importStep === "pick" && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Drop an Excel file. If it contains <strong>multiple schemes</strong> (one per tab), you'll be able to map each one to a property after parsing.
              </p>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Excel file (.xlsx / .xls / .csv)</label>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={e => setImportFile(e.target.files?.[0] || null)}
                  data-testid="input-import-file"
                />
                <div
                  role="button"
                  onClick={() => importFileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); }}
                  onDrop={e => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) setImportFile(f);
                  }}
                  className="border-2 border-dashed rounded-md p-6 text-center cursor-pointer hover:bg-muted/40 transition"
                >
                  <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                  {importFile ? (
                    <>
                      <p className="text-sm font-medium">{importFile.name}</p>
                      <p className="text-[11px] text-muted-foreground">{(importFile.size / 1024).toFixed(0)} KB · click to change</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm">Drop your schedule here</p>
                      <p className="text-[11px] text-muted-foreground">or click to browse</p>
                    </>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Default property <span className="text-[10px] opacity-70">(used when the file has only one scheme; for multi-scheme files you'll map each scheme individually next)</span>
                </label>
                <Select value={importPropertyId} onValueChange={setImportPropertyId}>
                  <SelectTrigger className="h-9 text-sm" data-testid="select-import-property">
                    <SelectValue placeholder="Pick a property (optional for multi-scheme files)…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {crmProperties.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={resetImport}>Cancel</Button>
                <Button size="sm" onClick={runBoardParse} disabled={!importFile} data-testid="btn-import-parse">
                  Parse file
                </Button>
              </div>
            </div>
          )}
          {importStep === "parsing" && (
            <div className="py-10 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm">Reading workbook — AI is extracting the rows…</p>
              <p className="text-[11px] text-muted-foreground mt-1">This can take 10-30 seconds for large schedules.</p>
            </div>
          )}
          {importStep === "preview" && importPreview && !multiSchemes && (
            <div className="space-y-3">
              <div className="text-sm">
                Detected <strong>{importPreview.units.length}</strong> units on sheet <strong>{importPreview.sheetName}</strong>.
              </div>
              {!importPropertyId && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Which property is this schedule for?</label>
                  <Select value={importPropertyId} onValueChange={setImportPropertyId}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Pick a property…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {crmProperties.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="max-h-[300px] overflow-auto border rounded text-xs">
                <table className="w-full">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Unit</th>
                      <th className="text-left p-2">Tenant</th>
                      <th className="text-left p-2">Rent pa</th>
                      <th className="text-left p-2">Sqft</th>
                      <th className="text-left p-2">Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.units.slice(0, 50).map((u: any, i: number) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">{u.unit_name || u.unit || "—"}</td>
                        <td className="p-2">{u.tenant_name || u.tenant || "—"}</td>
                        <td className="p-2">{u.rent_pa || u.rent || "—"}</td>
                        <td className="p-2">{u.sqft || u.area || "—"}</td>
                        <td className="p-2">{u.lease_expiry || u.expiry || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importPreview.units.length > 50 && (
                  <p className="text-[11px] text-muted-foreground p-2">Showing first 50 of {importPreview.units.length} rows.</p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setImportStep("pick")}>Back</Button>
                <Button size="sm" onClick={runBoardImport} disabled={!importPropertyId} data-testid="btn-import-confirm">
                  Import {importPreview.units.length} units
                </Button>
              </div>
            </div>
          )}
          {importStep === "preview" && multiSchemes && (() => {
            const mapable = multiSchemes.filter(s => s.units.length > 0);
            const skippedCount = multiSchemes.length - mapable.length;
            const mappedReady = mapable.filter(s => s.propertyId);
            return (
              <div className="space-y-3">
                <div className="text-sm">
                  Found <strong>{multiSchemes.length}</strong> sheet{multiSchemes.length === 1 ? "" : "s"}.
                  {" "}<strong>{mapable.length}</strong> with unit rows
                  ({mapable.reduce((s, x) => s + x.units.length, 0)} units total)
                  {skippedCount > 0 && <>, <strong>{skippedCount}</strong> skipped</>}.
                </div>
                <div className="max-h-[420px] overflow-auto border rounded divide-y">
                  {multiSchemes.map((scheme, idx) => {
                    const hasUnits = scheme.units.length > 0;
                    const showError = !!scheme.error;
                    const showSkipped = !hasUnits && !showError;
                    return (
                      <div key={idx} className={`p-3 space-y-2 ${!hasUnits ? "bg-muted/20" : ""}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium truncate">{scheme.schemeHint}</p>
                              {showError && <Badge variant="destructive" className="text-[10px]">error</Badge>}
                              {showSkipped && <Badge variant="secondary" className="text-[10px]">skipped</Badge>}
                              {hasUnits && <Badge variant="outline" className="text-[10px] border-emerald-500 text-emerald-700">{scheme.units.length} units</Badge>}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              Sheet "{scheme.sheetName}"
                              {scheme.skipReason && <> · {scheme.skipReason}</>}
                              {scheme.error && <> · {scheme.error}</>}
                            </p>
                          </div>
                          <div className="w-[260px] shrink-0">
                            <Select
                              value={scheme.propertyId}
                              onValueChange={(v) => {
                                setMultiSchemes(prev => prev ? prev.map((s, i) => i === idx ? { ...s, propertyId: v } : s) : prev);
                              }}
                              disabled={!hasUnits}
                            >
                              <SelectTrigger className="h-8 text-xs" data-testid={`select-scheme-${idx}`}>
                                <SelectValue placeholder={hasUnits ? "Map to property…" : "No units to import"} />
                              </SelectTrigger>
                              <SelectContent className="max-h-[260px]">
                                {crmProperties.map(p => (
                                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        {hasUnits && (
                          <div className="text-[11px] text-muted-foreground">
                            Preview:{" "}
                            {scheme.units.slice(0, 3).map((u: any) => u.tenant_name || u.unit_name || "?").join(" · ")}
                            {scheme.units.length > 3 && ` · +${scheme.units.length - 3} more`}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <p className="text-[11px] text-muted-foreground">
                    {mappedReady.length} of {mapable.length} mappable schemes ready
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setImportStep("pick")}>Back</Button>
                    <Button
                      size="sm"
                      onClick={runBoardImport}
                      disabled={mappedReady.length === 0}
                      data-testid="btn-import-multi-confirm"
                    >
                      Import {mappedReady.reduce((s, x) => s + x.units.length, 0)} units
                    </Button>
                  </div>
                </div>
              </div>
            );
          })()}
          {importStep === "importing" && (
            <div className="py-10 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm">Writing units to the schedule…</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyBoardImport({ onImportClick }: { onImportClick: () => void }) {
  return (
    <div className="text-center py-14 px-4">
      <div className="mx-auto w-14 h-14 rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center mb-3">
        <Building2 className="w-7 h-7 text-blue-500" />
      </div>
      <h3 className="text-base font-semibold mb-1">No leasing schedules yet</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
        Import a landlord's Excel schedule — AI will extract units, tenants, rents, breaks and expiries into the board.
      </p>
      <Button onClick={onImportClick} className="gap-1.5" data-testid="btn-empty-import">
        <Upload className="w-4 h-4" />
        Import Excel schedule
      </Button>
      <p className="text-[11px] text-muted-foreground mt-3">
        Supports .xlsx, .xls, .csv — any landlord format.
      </p>
    </div>
  );
}
