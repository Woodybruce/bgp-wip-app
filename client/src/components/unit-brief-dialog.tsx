import { useState, useRef } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Target, Upload, FileDown, Loader2, Sparkles, Wand2, X, Map as MapIcon, ImagePlus, Plus } from "lucide-react";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { TargetOperatorsTable } from "@/components/target-operators-table";
import { useToast } from "@/hooks/use-toast";
import { TENANT_CATEGORIES } from "@shared/tenant-categories";
import type { AvailableUnit, UnitBrief, UnitTargetOperator } from "@shared/schema";

type BriefWithTargets = UnitBrief & { targets: UnitTargetOperator[] };

const MET_STATUSES = new Set(["Meeting Held", "Inspection Done", "Offer", "Negotiating", "Heads of Terms", "In Sols", "Let"]);
const INSPECTED_STATUSES = new Set(["Inspection Done", "Offer", "Negotiating", "Heads of Terms", "In Sols", "Let"]);

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function DeadlineChip({ label, date }: { label: string; date: string | null | undefined }) {
  const days = daysUntil(date);
  if (days === null) return null;
  const overdue = days < 0;
  const close = days >= 0 && days <= 3;
  return (
    <div className={`border rounded-lg p-2 text-center ${overdue ? "border-red-400 bg-red-50 dark:bg-red-950/30" : close ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" : ""}`}>
      <p className={`text-lg font-bold ${overdue ? "text-red-600" : close ? "text-amber-600" : ""}`}>
        {overdue ? `${Math.abs(days)}d over` : `${days}d`}
      </p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Kpi({ value, target, label }: { value: number; target?: number | null; label: string }) {
  const met = target != null && value >= target;
  return (
    <div className={`border rounded-lg p-2 text-center ${met ? "border-green-400" : ""}`}>
      <p className={`text-lg font-bold ${met ? "text-green-600" : ""}`}>
        {value}{target != null ? <span className="text-xs text-muted-foreground font-normal">/{target}</span> : null}
      </p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

export function UnitBriefDialog({ unit, open, onClose }: {
  unit: AvailableUnit | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [pendingTargets, setPendingTargets] = useState<any[]>([]);

  const briefKey = ["/api/available-units", unit?.id, "brief"];
  const { data: brief, isLoading } = useQuery<BriefWithTargets | null>({
    queryKey: briefKey,
    queryFn: () => unit
      ? fetch(`/api/available-units/${unit.id}/brief`, { credentials: "include", headers: getAuthHeaders() }).then(r => r.json())
      : Promise.resolve(null),
    enabled: !!unit && open,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: briefKey });
    queryClient.invalidateQueries({ queryKey: ["/api/unit-briefs"] });
  };

  const briefClientCompanyId = (brief as any)?.clientCompanyId || null;

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/available-units/${unit?.id}/brief`, data),
    onSuccess: async (res: any) => {
      const created = await res.json();
      if (pendingTargets.length > 0 && created?.id) {
        for (const t of pendingTargets) {
          try { await apiRequest("POST", `/api/unit-briefs/${created.id}/targets`, t); } catch {}
        }
        setPendingTargets([]);
      }
      invalidate();
      setForm({});
      setDirty(false);
      toast({ title: "Brief created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/unit-briefs/${id}`, data),
    onSuccess: () => { invalidate(); setDirty(false); toast({ title: "Brief saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const f = (field: keyof UnitBrief): string => {
    if (field in form) return form[field as string];
    return (brief?.[field] as string) || "";
  };
  const setF = (field: string, value: string) => { setForm(p => ({ ...p, [field]: value })); setDirty(true); };

  const saveBrief = () => {
    if (!dirty) return;
    if (brief) updateMutation.mutate({ id: brief.id, data: form });
    else createMutation.mutate(form);
  };

  const handleExtract = async (file: File) => {
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/unit-briefs/extract`, {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json())?.message || "Extraction failed");
      const data = await res.json();
      const fields = ["title", "clientCompany", "objective", "locationContext", "targetCriteria", "priorityCategories", "agentInstruction", "successMeasures", "instructedDate", "deadline1Date", "deadline1Deliverables", "deadline2Date", "deadline2Deliverables"];
      const next: Record<string, string> = {};
      for (const k of fields) if (data[k]) next[k] = data[k];
      setForm(p => ({ ...p, ...next }));
      setDirty(true);
      if (Array.isArray(data.targets) && data.targets.length > 0) {
        if (brief) {
          for (const t of data.targets) {
            await apiRequest("POST", `/api/unit-briefs/${brief.id}/targets`, t);
          }
          invalidate();
        } else {
          setPendingTargets(data.targets);
        }
      }
      toast({ title: "Brief extracted", description: "Review the fields below, then Save." });
    } catch (e: any) {
      toast({ title: "Extraction failed", description: e.message, variant: "destructive" });
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDraftAi = async () => {
    if (!unit) return;
    setDrafting(true);
    try {
      const res = await fetch(`/api/available-units/${unit.id}/brief/draft-ai`, {
        method: "POST", credentials: "include", headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error((await res.json())?.message || "Drafting failed");
      const data = await res.json();
      const fields = ["title", "objective", "locationContext", "targetCriteria", "priorityCategories", "agentInstruction", "successMeasures"];
      const next: Record<string, string> = {};
      for (const k of fields) if (data[k]) next[k] = data[k];
      setForm(p => ({ ...p, ...next }));
      setDirty(true);
      // Suggested operators — queue for review; if a brief exists, add them
      // so the user can edit/approve in the table, else hold as pending.
      if (Array.isArray(data.targets) && data.targets.length > 0) {
        if (brief) {
          for (const t of data.targets) { try { await apiRequest("POST", `/api/unit-briefs/${brief.id}/targets`, t); } catch {} }
          invalidate();
        } else {
          setPendingTargets(data.targets);
        }
      }
      toast({ title: "Draft ready", description: "AI drafted the brief and suggested operators — review, edit, then save." });
    } catch (e: any) {
      toast({ title: "Drafting failed", description: e.message, variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  };

  const handleGenerateDoc = async () => {
    if (!brief) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/unit-briefs/${brief.id}/generate-document`, {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error((await res.json())?.message || "Generation failed");
      const data = await res.json();
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["/api/available-units", unit?.id, "files"] });
      toast({ title: "Brief document generated", description: data.sharepoint ? "Saved to unit files and SharePoint" : "Saved to unit files" });
      if (data.downloadUrl) window.open(data.downloadUrl, "_blank");
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const targets = brief?.targets || [];
  const priorityA = targets.filter(t => t.priority === "A").length;
  const meetings = targets.filter(t => MET_STATUSES.has(t.status || "")).length;
  const inspections = targets.filter(t => INSPECTED_STATUSES.has(t.status || "")).length;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { setForm({}); setDirty(false); onClose(); } }}>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Targeting Brief — {unit?.unitName}
          </DialogTitle>
          <DialogDescription>
            Client instruction, target operators and progress against the brief's success measures
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc,.txt"
                className="hidden"
                onChange={e => { const file = e.target.files?.[0]; if (file) handleExtract(file); }}
              />
              <Button variant="default" size="sm" onClick={handleDraftAi} disabled={drafting} data-testid="button-draft-brief-ai">
                {drafting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1" />}
                {drafting ? "Drafting…" : "Draft with AI"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={extracting} data-testid="button-extract-brief">
                {extracting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                {extracting ? "Extracting…" : "Upload client brief (AI extract)"}
              </Button>
              {brief && (
                <Button variant="outline" size="sm" onClick={handleGenerateDoc} disabled={generating} data-testid="button-generate-brief-doc">
                  {generating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <FileDown className="h-3.5 w-3.5 mr-1" />}
                  {generating ? "Generating…" : "Generate brief document"}
                </Button>
              )}
              {dirty && (
                <Button size="sm" onClick={saveBrief} disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-save-brief">
                  {brief ? "Save changes" : "Create brief"}
                </Button>
              )}
            </div>

            {brief && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <Kpi value={targets.length} target={brief.minTargets} label="Targets" />
                <Kpi value={priorityA} target={brief.priorityTargets} label="Priority A" />
                <Kpi value={meetings} label="Meetings" />
                <Kpi value={inspections} label="Inspections" />
                <DeadlineChip label="Deadline 1" date={brief.deadline1Date} />
                <DeadlineChip label="Deadline 2" date={brief.deadline2Date} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Title</Label>
                <Input value={f("title")} onChange={e => setF("title", e.target.value)} placeholder="e.g. Operator Targeting Brief — Unit L29A" />
              </div>
              <div>
                <Label className="text-xs">Client</Label>
                <Input value={f("clientCompany")} onChange={e => setF("clientCompany", e.target.value)} placeholder="e.g. Landsec" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Objective</Label>
                <Textarea rows={2} value={f("objective")} onChange={e => setF("objective", e.target.value)} placeholder="What the client wants this letting to achieve…" />
              </div>
              <div className="col-span-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Location / adjacency context</Label>
                  {unit?.propertyId && unit?.unitName && (
                    <Link
                      href={`/properties/${unit.propertyId}#plan-unit-${encodeURIComponent(unit.unitName)}`}
                      className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                      onClick={onClose}
                      data-testid="brief-view-plan"
                    >
                      <MapIcon className="h-3 w-3" /> View on plan
                    </Link>
                  )}
                </div>
                <Textarea rows={2} value={f("locationContext")} onChange={e => setF("locationContext", e.target.value)} placeholder="Surrounding operators, categories already represented…" />
              </div>
              <div>
                <Label className="text-xs">Target operator criteria</Label>
                <Textarea rows={3} value={f("targetCriteria")} onChange={e => setF("targetCriteria", e.target.value)} placeholder="e.g. High volume, no extract, takeaway focussed…" />
              </div>
              <div>
                <Label className="text-xs">Priority categories</Label>
                <CategoryMultiSelect value={f("priorityCategories")} onChange={v => setF("priorityCategories", v)} />
              </div>
              <div>
                <Label className="text-xs">Agent instruction</Label>
                <Textarea rows={2} value={f("agentInstruction")} onChange={e => setF("agentInstruction", e.target.value)} placeholder="Emphasis, constraints…" />
              </div>
              <div>
                <Label className="text-xs">Success measures</Label>
                <Textarea rows={2} value={f("successMeasures")} onChange={e => setF("successMeasures", e.target.value)} placeholder="How the client will judge progress…" />
              </div>
              <div>
                <Label className="text-xs">Instructed date</Label>
                <Input type="date" value={f("instructedDate")} onChange={e => setF("instructedDate", e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Deadline 1</Label>
                  <Input type="date" value={f("deadline1Date")} onChange={e => setF("deadline1Date", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Deadline 2</Label>
                  <Input type="date" value={f("deadline2Date")} onChange={e => setF("deadline2Date", e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Deadline 1 deliverables</Label>
                <Textarea rows={2} value={f("deadline1Deliverables")} onChange={e => setF("deadline1Deliverables", e.target.value)} placeholder="e.g. Min 5 targets, top 2 priorities, rationale, relationships, feedback, approach" />
              </div>
              <div>
                <Label className="text-xs">Deadline 2 deliverables</Label>
                <Textarea rows={2} value={f("deadline2Deliverables")} onChange={e => setF("deadline2Deliverables", e.target.value)} placeholder="e.g. Meetings with Priority A operators, inspections, feedback, revised list" />
              </div>
            </div>

            {brief && (
              <BriefImages
                briefId={brief.id}
                propertyId={unit?.propertyId || null}
                imageIds={((brief as any).imageIds as string[]) || []}
                onChanged={invalidate}
              />
            )}

            {brief && (
              <TargetOperatorsTable
                targets={targets}
                clientCompanyId={briefClientCompanyId}
                ensureBriefId={async () => brief.id}
                onChanged={invalidate}
              />
            )}

            {!brief && pendingTargets.length > 0 && (
              <div className="border rounded-lg p-3 bg-muted/30">
                <p className="text-xs font-medium mb-1.5">Suggested target operators ({pendingTargets.length}) — saved with the brief</p>
                <div className="flex flex-wrap gap-1.5">
                  {pendingTargets.map((t, i) => (
                    <Badge key={i} variant="secondary" className="text-[11px] gap-1">
                      {t.priority === "A" && <span className="text-amber-600 font-bold">A</span>}
                      {t.operatorName}
                      {t.category ? <span className="text-muted-foreground">· {String(t.category).replace(/^Tenant - /, "")}</span> : null}
                      <button onClick={() => setPendingTargets(prev => prev.filter((_, j) => j !== i))} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">Create the brief to add these to the editable table, then refine.</p>
              </div>
            )}

            {!brief && !dirty && (
              <p className="text-xs text-muted-foreground">
                No brief yet for this unit. Fill in the fields (or upload the client's brief to extract them) and press Create brief.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Priority categories as a searchable multiselect over the Landsec/BGP
// tenant taxonomy, with free-add for anything not on the list. Stored as a
// comma-separated string (the column is text) so it stays compatible with
// the AI extract/draft output and the generated PDF.
function CategoryMultiSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = value.split(",").map(s => s.trim()).filter(Boolean);
  const set = (next: string[]) => onChange(Array.from(new Set(next)).join(", "));
  const toggle = (cat: string) => selected.includes(cat) ? set(selected.filter(c => c !== cat)) : set([...selected, cat]);
  const short = (c: string) => c.replace(/^Tenant - /, "");
  const matches = TENANT_CATEGORIES.filter(c => c.toLowerCase().includes(query.toLowerCase()));
  const canAdd = query.trim() && !TENANT_CATEGORIES.some(c => c.toLowerCase() === query.trim().toLowerCase()) && !selected.some(s => s.toLowerCase() === query.trim().toLowerCase());
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1 min-h-[28px]">
        {selected.length === 0 && <span className="text-[11px] text-muted-foreground italic py-1">No categories yet — pick from the taxonomy or add your own.</span>}
        {selected.map(c => (
          <Badge key={c} variant="secondary" className="text-[11px] gap-1">
            {short(c)}
            <button onClick={() => set(selected.filter(x => x !== c))} className="hover:text-destructive"><X className="h-3 w-3" /></button>
          </Badge>
        ))}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-[11px] w-full justify-start border-dashed" data-testid="brief-category-add">
            <Plus className="h-3 w-3 mr-1" /> Add category
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[280px]" align="start" side="bottom">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search categories…" value={query} onValueChange={setQuery} />
            <CommandList className="max-h-[240px]">
              <CommandEmpty>No categories match.</CommandEmpty>
              {matches.length > 0 && (
                <CommandGroup heading="Taxonomy">
                  {matches.map(c => (
                    <CommandItem key={c} onSelect={() => toggle(c)}>
                      <div className={`w-3 h-3 rounded-sm border mr-2 ${selected.includes(c) ? "bg-primary border-primary" : "border-muted-foreground/30"}`} />
                      {short(c)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {canAdd && (
                <CommandGroup heading="Add">
                  <CommandItem onSelect={() => { set([...selected, query.trim()]); setQuery(""); }}>
                    <Plus className="h-3 w-3 mr-2" /> Add “{query.trim()}”
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Images attached to the brief — picked from the property's Image Studio
// gallery (server-scoped to the client's own buildings) and stored as
// image_ids on the brief. Thumbnails link through to the full image.
function BriefImages({ briefId, propertyId, imageIds, onChanged }: {
  briefId: string; propertyId: string | null; imageIds: string[]; onChanged: () => void;
}) {
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: gallery = [] } = useQuery<any[]>({
    queryKey: ["/api/image-studio"],
    queryFn: () => fetch("/api/image-studio", { credentials: "include", headers: getAuthHeaders() }).then(r => r.json()),
    enabled: pickerOpen,
  });
  const propImages = (gallery || []).filter((i: any) => !propertyId || i.propertyId === propertyId);
  const save = async (ids: string[]) => {
    try {
      await apiRequest("PATCH", `/api/unit-briefs/${briefId}`, { imageIds: ids });
      onChanged();
    } catch (e: any) { toast({ title: "Couldn't update images", description: e.message, variant: "destructive" }); }
  };
  const remove = (id: string) => save(imageIds.filter(x => x !== id));
  const add = (id: string) => { if (!imageIds.includes(id)) save([...imageIds, id]); };
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs flex items-center gap-1.5"><ImagePlus className="h-3.5 w-3.5" /> Images ({imageIds.length})</Label>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-[11px]" data-testid="brief-add-image">
              <Plus className="h-3 w-3 mr-1" /> Add from Image Studio
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[420px] p-2" align="end">
            {propImages.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">No images filed against this property yet. Upload in Image Studio, or add a photo on the unit's Files.</p>
            ) : (
              <div className="grid grid-cols-4 gap-1.5 max-h-[280px] overflow-y-auto">
                {propImages.map((img: any) => (
                  <button key={img.id} onClick={() => add(img.id)} className={`relative rounded overflow-hidden border ${imageIds.includes(img.id) ? "ring-2 ring-primary" : "hover:border-primary"}`} title={img.fileName}>
                    <img src={`/api/image-studio/${img.id}/thumb`} alt="" className="w-full h-16 object-cover" />
                  </button>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      {imageIds.length > 0 && (
        <div className="grid grid-cols-6 gap-1.5">
          {imageIds.map(id => (
            <div key={id} className="relative rounded overflow-hidden border group">
              <img src={`/api/image-studio/${id}/thumb`} alt="" className="w-full h-16 object-cover" />
              <button onClick={() => remove(id)} className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity" title="Remove">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
