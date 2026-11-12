import { useEffect, useState, useRef } from "react";
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
import { Target, FileDown, Loader2, Sparkles, Wand2, X, Map as MapIcon, ImagePlus, Plus } from "lucide-react";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { TargetOperatorsTable } from "@/components/target-operators-table";
import { useToast } from "@/hooks/use-toast";
import { TENANT_CATEGORIES } from "@shared/tenant-categories";
import type { AvailableUnit, UnitBrief, UnitTargetOperator } from "@shared/schema";
import { normaliseCommercials, type BriefCommercials, type BriefWorkspace } from "@shared/unit-brief";
import { Pill, PillCount } from "@/components/ui/pill";
import { BriefCommercialsForm, commercialsToDraft, commercialsInvalid, type CommercialsDraft } from "@/components/unit-brief/brief-commercials";
import { BriefPeoplePanel } from "@/components/unit-brief/brief-people";
import { BriefFilesPanel } from "@/components/unit-brief/brief-files";
import { BriefCommentsPanel } from "@/components/unit-brief/brief-comments";
import type { SuggestedBriefPerson } from "@/components/unit-brief/types";

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

type BriefTab = "brief" | "commercials" | "people" | "targets" | "files" | "comments";

const TEXT_FIELDS = ["title", "clientCompany", "objective", "locationContext", "targetCriteria", "priorityCategories", "agentInstruction", "successMeasures", "instructedDate", "deadline1Date", "deadline1Deliverables", "deadline2Date", "deadline2Deliverables"] as const;

// The Targeting Brief for one letting-tracker unit (Woody, 2026-11-12): the
// brief itself, its commercials, the people involved and their sign-off,
// the target operators, the plans and marketing files, and everyone's
// comments. One section shows at a time (pill row). Opened from the tracker
// row, the Add brief button and the Landsec unit page.
export function UnitBriefDialog({ unit, open, onClose, initialTab, initialSuggestedPeople }: {
  unit: Pick<AvailableUnit, "id" | "unitName" | "propertyId"> | null;
  open: boolean;
  onClose: () => void;
  initialTab?: BriefTab;
  /** People a client's brief document named (from Add brief), offered on People & sign-off. */
  initialSuggestedPeople?: SuggestedBriefPerson[];
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<BriefTab>(initialTab || "brief");
  const [extracting, setExtracting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [commercials, setCommercials] = useState<CommercialsDraft | null>(null);
  const [pendingTargets, setPendingTargets] = useState<any[]>([]);
  const [suggestedPeople, setSuggestedPeople] = useState<SuggestedBriefPerson[]>([]);

  useEffect(() => { if (open) setTab(initialTab || "brief"); }, [open, unit?.id, initialTab]);
  useEffect(() => { if (open && initialSuggestedPeople?.length) setSuggestedPeople(initialSuggestedPeople); }, [open, unit?.id, initialSuggestedPeople]);

  const briefKey = ["/api/available-units", unit?.id, "brief"];
  const { data: brief, isLoading, error: briefError } = useQuery<BriefWithTargets | null>({
    queryKey: briefKey,
    queryFn: async () => {
      if (!unit) return null;
      const r = await fetch(`/api/available-units/${unit.id}/brief`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || "The brief could not be opened");
      return r.json();
    },
    enabled: !!unit && open,
  });
  const wsKey = ["/api/unit-briefs", brief?.id, "workspace"];
  const { data: ws } = useQuery<BriefWorkspace>({
    queryKey: wsKey,
    queryFn: async () => {
      const r = await fetch(`/api/unit-briefs/${brief!.id}/workspace`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || "The brief could not be opened");
      return r.json();
    },
    enabled: !!brief?.id && open,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: briefKey });
    queryClient.invalidateQueries({ queryKey: ["/api/unit-briefs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/available-units"] });
  };

  // A login that cannot change the terms (a joint agent) reads the brief,
  // comments on it and agrees it.
  const readOnly = !!ws && !ws.viewer.canEditTerms;
  const savedCommercials = commercialsToDraft(ws?.brief.commercials);
  const commercialsDraft = commercials || savedCommercials;
  const commercialsDirty = !!commercials && JSON.stringify(commercials) !== JSON.stringify(savedCommercials);
  const saved = (k: string): string => { const v = (brief as any)?.[k]; return v === null || v === undefined ? "" : String(v); };
  const formDirty = Object.keys(form).some(k => (form[k] || "") !== saved(k));
  const termsDirty = Object.keys(form).some(k => k !== "minTargets" && k !== "priorityTargets" && (form[k] || "") !== saved(k)) || commercialsDirty;
  const dirty = formDirty || commercialsDirty || pendingTargets.length > 0;
  const invalidCommercials = commercialsInvalid(commercialsDraft);

  const reset = () => { setForm({}); setCommercials(null); setPendingTargets([]); setSuggestedPeople([]); };
  // The form as the create route takes it: the two counts are numbers.
  const createBody = (): Record<string, any> => {
    const body: Record<string, any> = { ...form };
    for (const k of ["minTargets", "priorityTargets"]) {
      if (!(k in body)) continue;
      const n = Number(body[k]);
      if (body[k] !== "" && Number.isFinite(n)) body[k] = Math.round(n); else delete body[k];
    }
    return body;
  };

  const save = useMutation({
    mutationFn: async () => {
      if (invalidCommercials.length) throw new Error(`Check the figure for: ${invalidCommercials.join(", ")}`);
      let id = brief?.id;
      if (!id) {
        const created = await (await apiRequest("POST", `/api/available-units/${unit?.id}/brief`, createBody())).json();
        id = created.id as string;
        for (const t of pendingTargets) { try { await apiRequest("POST", `/api/unit-briefs/${id}/targets`, t); } catch {} }
        if (commercialsDirty) await apiRequest("PATCH", `/api/unit-briefs/${id}`, { commercials });
        return { created: true };
      }
      const body: Record<string, any> = {};
      for (const k of Object.keys(form)) if ((form[k] || "") !== saved(k)) body[k] = form[k];
      if (commercialsDirty) body.commercials = commercials;
      const result = Object.keys(body).length ? await (await apiRequest("PATCH", `/api/unit-briefs/${id}`, body)).json() : null;
      for (const t of pendingTargets) { try { await apiRequest("POST", `/api/unit-briefs/${id}/targets`, t); } catch {} }
      return { created: false, termsChanged: !!result?.termsChanged };
    },
    onSuccess: (r) => {
      const hadSignatures = (ws?.approval.agreed || 0) > 0;
      invalidate(); setForm({}); setCommercials(null); setPendingTargets([]);
      toast({ title: r.created ? "Brief created" : "Brief saved", description: !r.created && r.termsChanged && hadSignatures ? "The terms changed, so everyone involved is asked to agree the brief again." : undefined });
    },
    onError: (e: any) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });

  const f = (field: string): string => (field in form ? form[field] : saved(field));
  const setF = (field: string, value: string) => setForm(p => ({ ...p, [field]: value }));
  const setC = (key: keyof BriefCommercials, value: string) => setCommercials(p => ({ ...(p || savedCommercials), [key]: value }));

  // Fields an AI draft or an uploaded client brief returned: into the form
  // for review, never saved until the person presses Save.
  const applyAi = async (data: any, fields: readonly string[]) => {
    const next: Record<string, string> = {};
    for (const k of fields) {
      const v = data[k];
      if (v === null || v === undefined || v === "") continue;
      // Text only: a list comes back joined, anything else is ignored.
      if (Array.isArray(v)) next[k] = v.map(x => String(x)).join(", ");
      else if (typeof v === "string" || typeof v === "number") next[k] = String(v);
    }
    for (const k of ["minTargets", "priorityTargets"]) { const n = Number(data[k]); if (Number.isFinite(n) && n > 0) next[k] = String(Math.round(n)); }
    setForm(p => ({ ...p, ...next }));
    if (data.commercials && typeof data.commercials === "object") {
      const { value } = normaliseCommercials(data.commercials);
      const filled = commercialsToDraft(value);
      setCommercials(p => { const base = { ...(p || savedCommercials) }; for (const k of Object.keys(filled) as (keyof BriefCommercials)[]) if (filled[k] && !base[k]) base[k] = filled[k]; return base; });
    }
    if (Array.isArray(data.people)) setSuggestedPeople(data.people.filter((p: any) => p?.name).map((p: any) => ({ name: String(p.name), role: p.role || null, firm: p.firm || null, email: p.email || null })));
    // Suggested operators wait as chips on Targets until the person saves:
    // nothing an AI returned is written before it has been looked at, and
    // an operator already on the brief (or already suggested) is not added twice.
    if (Array.isArray(data.targets) && data.targets.length > 0) {
      const have = new Set((brief?.targets || []).map(t => (t.operatorName || "").trim().toLowerCase()));
      setPendingTargets(prev => {
        const seen = new Set([...have, ...prev.map((t: any) => String(t.operatorName || "").trim().toLowerCase())]);
        const fresh = data.targets.filter((t: any) => { const n = String(t?.operatorName || "").trim().toLowerCase(); if (!n || seen.has(n)) return false; seen.add(n); return true; });
        return [...prev, ...fresh];
      });
    }
  };

  const handleExtract = async (file: File) => {
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/unit-briefs/extract`, { method: "POST", credentials: "include", headers: getAuthHeaders(), body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || "The document could not be read");
      await applyAi(await res.json(), TEXT_FIELDS);
      toast({ title: "Brief read from the document", description: "Check the brief and the commercials, then save." });
    } catch (e: any) {
      toast({ title: "The document could not be read", description: e.message, variant: "destructive" });
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDraftAi = async () => {
    if (!unit) return;
    setDrafting(true);
    try {
      const res = await fetch(`/api/available-units/${unit.id}/brief/draft-ai`, { method: "POST", credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || "AI could not draft the brief");
      await applyAi(await res.json(), ["title", "objective", "locationContext", "targetCriteria", "priorityCategories", "agentInstruction", "successMeasures"]);
      toast({ title: "Draft ready", description: "AI drafted the brief and suggested operators. Check the Brief and Targets, then save." });
    } catch (e: any) {
      toast({ title: "AI could not draft the brief", description: e.message, variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  };

  const handleGenerateDoc = async () => {
    if (!brief) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/unit-briefs/${brief.id}/generate-document`, { method: "POST", credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || "The document could not be made");
      const data = await res.json();
      invalidate();
      toast({ title: "Brief document made", description: data.sharepoint ? "Saved to the unit's files and SharePoint" : "Saved to the unit's files" });
      if (data.downloadUrl) window.open(data.downloadUrl, "_blank");
    } catch (e: any) {
      toast({ title: "The document could not be made", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const close = () => {
    if (dirty && !window.confirm("You have changes to the brief that are not saved. Close without saving?")) return;
    reset();
    onClose();
  };

  const targets = brief?.targets || [];
  const priorityA = targets.filter(t => t.priority === "A").length;
  const meetings = targets.filter(t => MET_STATUSES.has(t.status || "")).length;
  const inspections = targets.filter(t => INSPECTED_STATUSES.has(t.status || "")).length;
  const approval = ws?.approval;
  const approvalTone = approval?.state === "agreed" ? "border-emerald-600/60 text-emerald-700 dark:text-emerald-400" : approval?.state === "awaiting" || approval?.state === "draft" ? "border-amber-500/60 text-amber-700 dark:text-amber-400" : "border-border text-muted-foreground";
  const commentCount = ws?.comments.filter(c => c.kind === "comment").length || 0;
  const fileCount = (ws?.files.length || 0) + (ws?.plans.filter(p => p.attached).length || 0) + (ws?.brochures.filter(b => b.attached).length || 0);
  const needsBrief = (label: string) => (
    <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground" data-testid="brief-needs-create">
      {label} are added once the brief exists.
      {!readOnly && <Button size="sm" className="ml-2" disabled={save.isPending} onClick={() => save.mutate()} data-testid="button-create-brief-inline">Create the brief</Button>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) close(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="unit-brief-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Target className="h-4 w-4 shrink-0" />
            <span>Targeting Brief · {unit?.unitName}</span>
            {approval && (
              <span className={`rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${approvalTone}`} data-testid="brief-approval-status">
                {approval.label}{approval.state === "agreed" && ws?.brief.agreedAt ? ` · ${new Date(ws.brief.agreedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {ws?.unit.propertyName ? `${ws.unit.propertyName}. ` : ""}The brief, its commercials, who is involved and their sign-off, target operators, plans and files, and everyone's comments.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : briefError ? (
          <div className="py-8 text-center text-sm text-muted-foreground" data-testid="brief-error">{(briefError as any)?.message || "The brief could not be opened."}</div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5" data-testid="brief-tabs">
              <Pill active={tab === "brief"} onClick={() => setTab("brief")} data-testid="brief-tab-brief">Brief</Pill>
              <Pill active={tab === "commercials"} onClick={() => setTab("commercials")} data-testid="brief-tab-commercials">Commercials</Pill>
              <Pill active={tab === "people"} onClick={() => setTab("people")} data-testid="brief-tab-people">People &amp; sign-off{approval && approval.total > 0 ? <PillCount n={approval.agreed} active={tab === "people"} /> : null}{approval && approval.total > 0 ? <span className="font-mono">/{approval.total}</span> : null}</Pill>
              <Pill active={tab === "targets"} onClick={() => setTab("targets")} data-testid="brief-tab-targets">Targets<PillCount n={targets.length + pendingTargets.length} active={tab === "targets"} /></Pill>
              <Pill active={tab === "files"} onClick={() => setTab("files")} data-testid="brief-tab-files">Plans &amp; files<PillCount n={fileCount} active={tab === "files"} /></Pill>
              <Pill active={tab === "comments"} onClick={() => setTab("comments")} data-testid="brief-tab-comments">Comments<PillCount n={commentCount} active={tab === "comments"} /></Pill>
            </div>

            {tab === "brief" && (
              <div className="space-y-4">
                {!readOnly && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) handleExtract(file); }} />
                    <Button variant="outline" size="sm" onClick={handleDraftAi} disabled={drafting} data-testid="button-draft-brief-ai">
                      {drafting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1" />}
                      {drafting ? "Drafting…" : "Draft with AI"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={extracting} data-testid="button-extract-brief">
                      {extracting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                      {extracting ? "Reading…" : "Upload the client's brief"}
                    </Button>
                    {brief && (
                      <Button variant="outline" size="sm" onClick={handleGenerateDoc} disabled={generating || dirty} title={dirty ? "Save your changes first: the document is made from the saved brief" : undefined} data-testid="button-generate-brief-doc">
                        {generating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <FileDown className="h-3.5 w-3.5 mr-1" />}
                        {generating ? "Making…" : "Make the brief document"}
                      </Button>
                    )}
                  </div>
                )}

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

                <fieldset disabled={readOnly} className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
                  <div>
                    <Label className="text-xs">Title</Label>
                    <Input value={f("title")} onChange={e => setF("title", e.target.value)} placeholder="e.g. Operator Targeting Brief: Unit L29A" data-testid="brief-field-title" />
                  </div>
                  <div>
                    <Label className="text-xs">Client</Label>
                    <Input value={f("clientCompany")} onChange={e => setF("clientCompany", e.target.value)} placeholder="e.g. Landsec" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Objective</Label>
                    <Textarea rows={2} value={f("objective")} onChange={e => setF("objective", e.target.value)} placeholder="What the client wants this letting to achieve…" data-testid="brief-field-objective" />
                  </div>
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Location / adjacency context</Label>
                      {unit?.propertyId && unit?.unitName && (
                        <Link href={`/properties/${unit.propertyId}#plan-unit-${encodeURIComponent(unit.unitName)}`} className="text-[11px] text-primary hover:underline inline-flex items-center gap-1" onClick={close} data-testid="brief-view-plan">
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
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Targets wanted</Label>
                      <Input type="number" min={0} inputMode="numeric" value={f("minTargets")} onChange={e => setF("minTargets", e.target.value)} placeholder="5" data-testid="brief-field-min-targets" />
                    </div>
                    <div>
                      <Label className="text-xs">Priority A wanted</Label>
                      <Input type="number" min={0} inputMode="numeric" value={f("priorityTargets")} onChange={e => setF("priorityTargets", e.target.value)} placeholder="2" data-testid="brief-field-priority-targets" />
                    </div>
                  </div>
                  <div className="hidden sm:block" />
                  <div>
                    <Label className="text-xs">Deadline 1 deliverables</Label>
                    <Textarea rows={2} value={f("deadline1Deliverables")} onChange={e => setF("deadline1Deliverables", e.target.value)} placeholder="e.g. Min 5 targets, top 2 priorities, rationale, relationships, feedback, approach" />
                  </div>
                  <div>
                    <Label className="text-xs">Deadline 2 deliverables</Label>
                    <Textarea rows={2} value={f("deadline2Deliverables")} onChange={e => setF("deadline2Deliverables", e.target.value)} placeholder="e.g. Meetings with Priority A operators, inspections, feedback, revised list" />
                  </div>
                </fieldset>

                {brief && !readOnly && (
                  <BriefImages briefId={brief.id} propertyId={unit?.propertyId || null} imageIds={((brief as any).imageIds as string[]) || []} onChanged={invalidate} />
                )}
                {!brief && !dirty && !readOnly && (
                  <p className="text-xs text-muted-foreground">No brief yet for this unit. Fill in the fields, draft it with AI or upload the client's brief, then press Create brief.</p>
                )}
              </div>
            )}

            {tab === "commercials" && (
              <div className="space-y-2">
                {!brief && <p className="text-xs text-muted-foreground">The commercials are saved with the brief.</p>}
                <BriefCommercialsForm draft={commercialsDraft} onChange={setC} defaults={ws?.unitDefaults || {}} readOnly={readOnly} />
              </div>
            )}

            {tab === "people" && (ws ? <BriefPeoplePanel ws={ws} refresh={invalidate} suggested={suggestedPeople} /> : needsBrief("People and sign-off"))}

            {tab === "targets" && readOnly && (
              targets.length === 0 ? <p className="text-sm text-muted-foreground">No target operators have been added yet.</p> : (
                <ul className="rounded-lg border divide-y text-sm" data-testid="brief-targets-readonly">
                  {targets.map(t => (
                    <li key={t.id} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium min-w-0 truncate">{t.operatorName}</span>
                      {t.priority && <span className="text-[11px] font-semibold text-muted-foreground">Priority {t.priority}</span>}
                      {t.category && <span className="text-xs text-muted-foreground">{String(t.category).replace(/^Tenant - /, "")}</span>}
                      <span className="text-xs text-muted-foreground ml-auto">{t.status || "Identified"}</span>
                    </li>
                  ))}
                </ul>
              )
            )}
            {tab === "targets" && !readOnly && (
              <div className="space-y-3">
                {/* Adding the first target creates the brief with whatever
                    is filled in so far (UX #30). */}
                <TargetOperatorsTable
                  targets={targets}
                  clientCompanyId={(brief as any)?.clientCompanyId || null}
                  ensureBriefId={async () => {
                    if (brief) return brief.id;
                    const created = await (await apiRequest("POST", `/api/available-units/${unit?.id}/brief`, createBody())).json();
                    invalidate();
                    setForm({});
                    return created.id;
                  }}
                  onChanged={invalidate}
                />
                {pendingTargets.length > 0 && (
                  <div className="border rounded-lg p-3 bg-muted/30" data-testid="brief-pending-targets">
                    <p className="text-xs font-medium mb-1.5">Suggested target operators ({pendingTargets.length}). Remove any you do not want; the rest are added when you save.</p>
                    <div className="flex flex-wrap gap-1.5">
                      {pendingTargets.map((t, i) => (
                        <Badge key={i} variant="secondary" className="text-[11px] gap-1">
                          {t.priority === "A" && <span className="text-amber-600 font-bold">A</span>}
                          {t.operatorName}
                          {t.category ? <span className="text-muted-foreground">· {String(t.category).replace(/^Tenant - /, "")}</span> : null}
                          <button onClick={() => setPendingTargets(prev => prev.filter((_, j) => j !== i))} className="hover:text-destructive" aria-label={`Remove ${t.operatorName}`}><X className="h-3 w-3" /></button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "files" && (ws ? <BriefFilesPanel ws={ws} refresh={invalidate} /> : needsBrief("Plans and files"))}
            {tab === "comments" && (ws ? <BriefCommentsPanel ws={ws} refresh={invalidate} /> : needsBrief("Comments"))}

            {!readOnly && (dirty || (!brief && (tab === "brief" || tab === "commercials"))) && (
              <div className="sticky bottom-0 -mx-6 px-6 py-2 bg-background border-t flex flex-wrap items-center justify-end gap-2" data-testid="brief-save-bar">
                {brief && (approval?.agreed || 0) > 0 && termsDirty && (
                  <span className="text-xs text-amber-700 dark:text-amber-400 mr-auto">Saving a change to the brief or the commercials restarts sign-off: {approval!.agreed} {approval!.agreed === 1 ? "person has" : "people have"} already agreed.</span>
                )}
                {invalidCommercials.length > 0 && <span className="text-xs text-destructive mr-auto">Check the figure for: {invalidCommercials.join(", ")}</span>}
                {dirty && brief && <Button variant="outline" size="sm" onClick={() => { setForm({}); setCommercials(null); }}>Discard changes</Button>}
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || invalidCommercials.length > 0 || (!dirty && !!brief)} data-testid="button-save-brief">
                  {save.isPending ? "Saving…" : brief ? "Save changes" : "Create brief"}
                </Button>
              </div>
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
