import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Target, Upload, FileDown, Loader2, Sparkles } from "lucide-react";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { TargetOperatorsTable } from "@/components/target-operators-table";
import { useToast } from "@/hooks/use-toast";
import type { AvailableUnit, UnitBrief, UnitTargetOperator } from "@shared/schema";

type BriefWithTargets = UnitBrief & { targets: UnitTargetOperator[] };

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
              <TargetOperatorsTable
                targets={targets}
                clientCompanyId={briefClientCompanyId}
                ensureBriefId={async () => brief.id}
                onChanged={invalidate}
              />
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
