import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Target, Upload, FileDown, Trash2, Plus, Loader2, Sparkles } from "lucide-react";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { BrandSearchInput } from "@/components/brand-search-input";
import { useToast } from "@/hooks/use-toast";
import type { AvailableUnit, UnitBrief, UnitTargetOperator } from "@shared/schema";
import { BRIEF_TARGET_STATUSES } from "@shared/schema";

type BriefWithTargets = UnitBrief & { targets: UnitTargetOperator[] };

const TARGET_STATUS_COLORS: Record<string, string> = {
  "Identified": "bg-gray-500",
  "Approached": "bg-sky-500",
  "Meeting Held": "bg-blue-600",
  "Inspection Done": "bg-violet-500",
  "Offer": "bg-amber-500",
  "Let": "bg-green-600",
  "Passed": "bg-zinc-400",
};

const MET_STATUSES = new Set(["Meeting Held", "Inspection Done", "Offer", "Let"]);
const INSPECTED_STATUSES = new Set(["Inspection Done", "Offer", "Let"]);

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
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [newTarget, setNewTarget] = useState<{ operatorName: string; companyId: string | null; category: string; priority: string }>({ operatorName: "", companyId: null, category: "", priority: "B" });
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

  const addTargetMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/unit-briefs/${brief?.id}/targets`, data),
    onSuccess: () => { invalidate(); setNewTarget({ operatorName: "", companyId: null, category: "", priority: "B" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateTargetMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/unit-briefs/targets/${id}`, data),
    onSuccess: invalidate,
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteTargetMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/unit-briefs/targets/${id}`),
    onSuccess: invalidate,
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
                <Label className="text-xs">Location / adjacency context</Label>
                <Textarea rows={2} value={f("locationContext")} onChange={e => setF("locationContext", e.target.value)} placeholder="Surrounding operators, categories already represented…" />
              </div>
              <div>
                <Label className="text-xs">Target operator criteria</Label>
                <Textarea rows={3} value={f("targetCriteria")} onChange={e => setF("targetCriteria", e.target.value)} placeholder="e.g. High volume, no extract, takeaway focussed…" />
              </div>
              <div>
                <Label className="text-xs">Priority categories</Label>
                <Textarea rows={3} value={f("priorityCategories")} onChange={e => setF("priorityCategories", e.target.value)} placeholder="e.g. Fresh food-to-go; premium sandwiches; handheld global…" />
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
              <div className="space-y-2">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  Target operators
                  <Badge variant="outline" className="text-[10px]">{targets.length}</Badge>
                </h4>
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[160px]">Operator</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="w-[70px]">Priority</TableHead>
                        <TableHead className="w-[140px]">Status</TableHead>
                        <TableHead>Rationale</TableHead>
                        <TableHead>Relationship</TableHead>
                        <TableHead>Feedback</TableHead>
                        <TableHead className="w-[40px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {targets.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-muted-foreground text-xs py-6">
                            No target operators yet — add them below or extract from the client brief
                          </TableCell>
                        </TableRow>
                      )}
                      {targets.map(t => (
                        <TableRow key={t.id} data-testid={`row-target-${t.id}`}>
                          <TableCell className="text-xs font-medium">{t.operatorName}</TableCell>
                          <TableCell className="text-xs">{t.category || "—"}</TableCell>
                          <TableCell>
                            <Select value={t.priority || "B"} onValueChange={v => updateTargetMutation.mutate({ id: t.id, data: { priority: v } })}>
                              <SelectTrigger className="h-7 text-xs w-[60px]"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="A">A</SelectItem>
                                <SelectItem value="B">B</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Select value={t.status || "Identified"} onValueChange={v => updateTargetMutation.mutate({ id: t.id, data: { status: v } })}>
                              <SelectTrigger className="h-7 text-xs w-[130px]">
                                <SelectValue>
                                  <Badge className={`text-[10px] text-white ${TARGET_STATUS_COLORS[t.status || "Identified"]}`}>{t.status || "Identified"}</Badge>
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {BRIEF_TARGET_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-xs max-w-[180px]">
                            <EditableCell value={t.rationale} onSave={v => updateTargetMutation.mutate({ id: t.id, data: { rationale: v } })} />
                          </TableCell>
                          <TableCell className="text-xs max-w-[140px]">
                            <EditableCell value={t.existingRelationship} onSave={v => updateTargetMutation.mutate({ id: t.id, data: { existingRelationship: v } })} />
                          </TableCell>
                          <TableCell className="text-xs max-w-[180px]">
                            <EditableCell value={t.feedback} onSave={v => updateTargetMutation.mutate({ id: t.id, data: { feedback: v } })} />
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteTargetMutation.mutate(t.id)} data-testid={`button-delete-target-${t.id}`}>
                              <Trash2 className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center gap-2">
                  <BrandSearchInput
                    className="max-w-[200px] w-[200px]"
                    placeholder="Operator name…"
                    value={newTarget.operatorName}
                    companyId={newTarget.companyId}
                    onPick={p => setNewTarget(prev => ({ ...prev, operatorName: p.name, companyId: p.companyId }))}
                    testId="input-new-target-name"
                  />
                  <Input
                    className="h-8 text-xs max-w-[180px]"
                    placeholder="Category…"
                    value={newTarget.category}
                    onChange={e => setNewTarget(p => ({ ...p, category: e.target.value }))}
                  />
                  <Select value={newTarget.priority} onValueChange={v => setNewTarget(p => ({ ...p, priority: v }))}>
                    <SelectTrigger className="h-8 text-xs w-[60px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">A</SelectItem>
                      <SelectItem value="B">B</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={!newTarget.operatorName || addTargetMutation.isPending}
                    onClick={() => addTargetMutation.mutate(newTarget)}
                    data-testid="button-add-target"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add
                  </Button>
                </div>
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

function EditableCell({ value, onSave }: { value: string | null | undefined; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (editing) {
    return (
      <Textarea
        autoFocus
        rows={2}
        className="text-xs"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft !== (value || "")) onSave(draft); }}
      />
    );
  }
  return (
    <span
      className="cursor-pointer hover:bg-muted/60 rounded px-1 block truncate"
      title={value || ""}
      onClick={() => { setDraft(value || ""); setEditing(true); }}
    >
      {value || <span className="text-muted-foreground italic">—</span>}
    </span>
  );
}
