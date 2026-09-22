import { useState, useRef, useMemo, useEffect, lazy, Suspense } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pill, pillTabsList, pillTabsTrigger } from "@/components/ui/pill";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Upload,
  FileSpreadsheet,
  Play,
  Download,
  Trash2,
  TrendingUp,
  Building2,
  Percent,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Eye,
  Sparkles,
  FileUp,
  Loader2,
  Check,
  X,
  MessageSquare,
  Send,
  Bot,
  BarChart3,
  GitCompare,
  FileText,
  Layers,
  Network,
  History,
  Plus,
  Minus,
  Zap,
  CloudUpload,
  ExternalLink,
  Info,
  ShieldCheck,
  AlertTriangle,
  PoundSterling,
  Hammer,
  Clock,
  LogIn,
  LogOut,
  Banknote,
  Receipt,
  KeySquare,
  Landmark,
  RefreshCw,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ExcelTemplate, ExcelModelRun } from "@shared/schema";
import bgpLogoDark from "@assets/BGP_BlackHolder_1771853582461.png";
import type { CrmProperty } from "@shared/schema";
import { EmptyState } from "@/components/empty-state";
import type { CellEdit, SheetPayload, WorkbookPayload } from "@/components/univer-spreadsheet";

// Univer is heavy; split it out of the page chunk (same lazy+Suspense pattern as the hub pages).
const UniverSpreadsheet = lazy(() => import("@/components/univer-spreadsheet"));

/** Response shape of the models `/cells` endpoint (one sheet per request). */
interface CellsEndpointResponse extends SheetPayload {
  sheetNames: string[];
  activeSheet: string;
}

interface TemplateWithMeta extends Omit<ExcelTemplate, "inputMapping" | "outputMapping"> {
  inputMapping: Record<string, InputField>;
  outputMapping: Record<string, OutputField>;
  analysis?: { sheets: { name: string; rows: number; cols: number }[]; properties: string[] };
  sampleOutputs?: Record<string, any>;
  sampleInputs?: Record<string, any>;
}

interface InputField {
  sheet: string;
  cell: string;
  label: string;
  type: string;
  group: string;
}

interface OutputField {
  sheet: string;
  cell: string;
  label: string;
  format: string;
  group: string;
}

interface RunWithMeta extends Omit<ExcelModelRun, "inputValues" | "outputValues"> {
  inputValues: Record<string, any>;
  outputValues: Record<string, any> | null;
  inputMapping: Record<string, InputField>;
  outputMapping: Record<string, OutputField>;
  templateName?: string;
}

function formatOutputValue(value: any, format?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" && value.trim().endsWith("%")) return value;
  const num = typeof value === "number" ? value : parseFloat(String(value).replace(/[,£$\s]/g, ""));
  if (!isNaN(num) && format) {
    switch (format) {
      case "percent": {
        const pct = Math.abs(num) <= 1 ? num * 100 : num;
        return `${pct.toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`;
      }
      case "number0":
        return num.toLocaleString("en-GB", { maximumFractionDigits: 0 });
      case "number2":
        return num.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }
  return String(value);
}

// ── Sectioned model chrome ────────────────────────────────────────────────
// Templates declare `group` per mapped field (the REX flagship mirrors its own
// Inputs sheet sections: Timing / Entry / Acquisition / Exit / …). These order
// lists keep the scenario builder and the results view in the modeller's
// mental order instead of JSON key order; unknown groups sort after, "Other"
// last.
const INPUT_GROUP_ORDER = [
  "Timing", "Entry", "Acquisition", "Exit", "Fees & Growth",
  "Leasing", "Senior Debt", "Refinance", "Income", "Costs", "Tax", "Financing",
];
const OUTPUT_GROUP_ORDER = [
  "Returns — Levered", "Returns — Unlevered", "Returns",
  "Pricing & Capital", "Yields & Income", "Yields", "Capex", "Property",
];

function sortGroupEntries<T>(groups: Record<string, T>, order: string[]): [string, T][] {
  return Object.entries(groups).sort(([a], [b]) => {
    if (a === "Other" && b !== "Other") return 1;
    if (b === "Other" && a !== "Other") return -1;
    const ai = order.findIndex((o) => o.toLowerCase() === a.toLowerCase());
    const bi = order.findIndex((o) => o.toLowerCase() === b.toLowerCase());
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
  });
}

function groupIcon(group: string, className = "w-3.5 h-3.5") {
  const g = group.toLowerCase();
  if (g.includes("check")) return <ShieldCheck className={className} />;
  if (g.includes("return")) return <TrendingUp className={className} />;
  if (g.includes("pricing") || g.includes("capital")) return <PoundSterling className={className} />;
  if (g.includes("yield") || g.includes("income")) return <Percent className={className} />;
  if (g.includes("capex")) return <Hammer className={className} />;
  if (g.includes("timing")) return <Clock className={className} />;
  if (g.includes("entry")) return <LogIn className={className} />;
  if (g.includes("acquisition")) return <Banknote className={className} />;
  if (g.includes("exit")) return <LogOut className={className} />;
  if (g.includes("debt") || g.includes("financ")) return <Landmark className={className} />;
  if (g.includes("refi")) return <RefreshCw className={className} />;
  if (g.includes("leas")) return <KeySquare className={className} />;
  if (g.includes("property")) return <Building2 className={className} />;
  if (g.includes("fee") || g.includes("growth") || g.includes("cost") || g.includes("tax")) return <Receipt className={className} />;
  return <Layers className={className} />;
}

/** Format a template's cached input value for display as the field's default
 *  (users type percents as raw numbers — 5.5 means 5.5% — so fractions come
 *  back ×100). */
function formatInputDefault(value: any, type: string): string {
  if (value === null || value === undefined || value === "") return "";
  if (type === "percent" && typeof value === "number") {
    const pct = value * 100;
    return String(parseFloat(pct.toFixed(4)));
  }
  if (typeof value === "number") {
    return Math.abs(value) >= 1000
      ? value.toLocaleString("en-GB", { maximumFractionDigits: 0 })
      : value.toLocaleString("en-GB");
  }
  return String(value);
}

function inputUnit(field: InputField): string {
  if (field.type === "percent") return "%";
  if (field.label.includes("£")) return "£";
  return "";
}

function TemplateUpload() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileDrop = (droppedFile: File) => {
    setFile(droppedFile);
    if (!name) setName(droppedFile.name.replace(/\.[^.]+$/, ""));
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const formData = new FormData();
      formData.append("file", file);
      if (name) formData.append("name", name);
      if (description) formData.append("description", description);

      const response = await fetch("/api/models/templates", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || "Upload failed");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/models/templates"] });
      toast({ title: "Template uploaded successfully" });
      setName("");
      setDescription("");
      setFile(null);
      setOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-upload-template">
          <Upload className="w-4 h-4 mr-2" />
          Upload template
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Excel Model Template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div
            className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
              dragging ? "border-primary bg-primary/5" : file ? "border-green-500 bg-green-50 dark:bg-green-950/20" : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation(); setDragging(false);
              const droppedFile = e.dataTransfer.files?.[0];
              if (droppedFile) handleFileDrop(droppedFile);
            }}
            onClick={() => fileInputRef.current?.click()}
            data-testid="dropzone-template-file"
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileDrop(f); }}
              data-testid="input-template-file"
            />
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-green-600" />
                <span className="text-sm font-medium">{file.name}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setFile(null); }} data-testid="button-remove-file">
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm font-medium">{dragging ? "Drop your Excel file here" : "Drag & drop an Excel file"}</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse · all file types</p>
              </>
            )}
          </div>
          <div>
            <Label htmlFor="template-name">Model Name</Label>
            <Input
              id="template-name"
              placeholder="e.g. Neighbourhood Portfolio Model"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-template-name"
            />
          </div>
          <div>
            <Label htmlFor="template-desc">Description (optional)</Label>
            <Input
              id="template-desc"
              placeholder="Brief description of this model"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-template-description"
            />
          </div>
          <Button
            onClick={() => uploadMutation.mutate()}
            disabled={!file || uploadMutation.isPending}
            className="w-full"
            data-testid="button-submit-upload"
          >
            {uploadMutation.isPending ? "Uploading..." : "Upload template"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RunModelForm({ template, onClose }: { template: TemplateWithMeta; onClose: () => void }) {
  const { toast } = useToast();
  const [runName, setRunName] = useState("");
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  const createRunMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/models/runs", {
        templateId: template.id,
        name: runName || `Run ${new Date().toLocaleDateString()}`,
        inputValues,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/models/runs"] });
      toast({ title: "Model run created successfully" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Failed to create run", description: err.message, variant: "destructive" });
    },
  });

  const inputMapping = template.inputMapping || {};
  const defaults = template.sampleInputs || {};
  const groups = useMemo(() => {
    const grouped = Object.entries(inputMapping).reduce<Record<string, { key: string; field: InputField }[]>>((acc, [key, field]) => {
      const g = field.group || "Other";
      if (!acc[g]) acc[g] = [];
      acc[g].push({ key, field });
      return acc;
    }, {});
    return sortGroupEntries(grouped, INPUT_GROUP_ORDER);
  }, [inputMapping]);

  const overrideCount = Object.values(inputValues).filter((v) => v !== "").length;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="run-name">Scenario name</Label>
        <Input
          id="run-name"
          placeholder={`e.g. ${template.name} — Base case`}
          value={runName}
          onChange={(e) => setRunName(e.target.value)}
          data-testid="input-run-name"
        />
      </div>

      <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Grey values are the template's current assumptions — leave a field blank to keep it, or type to override.
        </p>
      </div>

      {groups.map(([groupName, fields]) => (
        <section key={groupName}>
          <header className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
              {groupIcon(groupName)}
            </span>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
              {groupName}
            </h4>
            <div className="flex-1 h-px bg-border" />
            <span className="text-[10px] text-muted-foreground/70 font-mono">{fields.length}</span>
          </header>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            {fields.map(({ key, field }) => {
              const unit = inputUnit(field);
              const defaultHint = formatInputDefault(defaults[key], field.type);
              return (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`input-${key}`} className="text-xs">
                    {field.label}
                  </Label>
                  <div className="relative">
                    {unit === "£" && (
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">£</span>
                    )}
                    <Input
                      id={`input-${key}`}
                      type={field.type === "text" ? "text" : "number"}
                      step={field.type === "percent" ? "0.01" : "any"}
                      placeholder={defaultHint || (field.type === "percent" ? "e.g. 5.5" : "")}
                      value={inputValues[key] || ""}
                      onChange={(e) => setInputValues((prev) => ({ ...prev, [key]: e.target.value }))}
                      className={`${unit === "%" ? "pr-7" : ""} ${unit === "£" ? "pl-6" : ""} placeholder:text-muted-foreground/60`}
                      data-testid={`input-field-${key}`}
                    />
                    {unit === "%" && (
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <Separator />

      <Button
        onClick={() => createRunMutation.mutate()}
        disabled={createRunMutation.isPending}
        className="w-full"
        data-testid="button-run-model"
      >
        {createRunMutation.isPending ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Running scenario…
          </>
        ) : (
          <>
            <Play className="w-4 h-4 mr-2" />
            Run scenario{overrideCount > 0 ? ` · ${overrideCount} override${overrideCount === 1 ? "" : "s"}` : " · template defaults"}
          </>
        )}
      </Button>
    </div>
  );
}

function ChecksBanner({ outputs, mapping }: { outputs: Record<string, any>; mapping: Record<string, OutputField> }) {
  const checkEntries = Object.entries(mapping).filter(
    ([key, f]) => (f.group || "").toLowerCase().includes("check") || key.toLowerCase().includes("check"),
  );
  if (checkEntries.length === 0) return null;
  const values = checkEntries.map(([key]) => String(outputs[key] ?? "").trim()).filter(Boolean);
  const ok = values.length > 0 && values.every((v) => /^(ok|pass|passed|true|✓)$/i.test(v));

  if (ok) {
    return (
      <div
        className="flex items-center gap-2.5 rounded-lg border border-emerald-600/30 bg-emerald-50 dark:bg-emerald-950/20 px-4 py-2.5"
        data-testid="banner-checks-ok"
      >
        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
        <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">All model checks passed</p>
      </div>
    );
  }
  return (
    <div
      className="flex items-start gap-2.5 rounded-lg border border-red-600/30 bg-red-50 dark:bg-red-950/20 px-4 py-2.5"
      data-testid="banner-checks-failed"
    >
      <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-red-800 dark:text-red-300">Model checks need attention</p>
        <p className="text-xs text-red-700/80 dark:text-red-400/80 mt-0.5 break-words">{values.join(" · ") || "No check output"}</p>
      </div>
    </div>
  );
}

interface OutputEntry { key: string; field: OutputField; value: any }

function OutputsOverview({ outputs, mapping }: { outputs: Record<string, any>; mapping: Record<string, OutputField> }) {
  const returnsGroups: Record<string, OutputEntry[]> = {};
  const statGroups: Record<string, OutputEntry[]> = {};
  for (const [key, field] of Object.entries(mapping)) {
    const g = field.group || "Other";
    if (g.toLowerCase().includes("check") || key.toLowerCase().includes("check")) continue;
    const bucket = g.toLowerCase().startsWith("returns") ? returnsGroups : statGroups;
    if (!bucket[g]) bucket[g] = [];
    bucket[g].push({ key, field, value: outputs[key] });
  }
  const returnsList = sortGroupEntries(returnsGroups, OUTPUT_GROUP_ORDER);
  const statsList = sortGroupEntries(statGroups, OUTPUT_GROUP_ORDER);

  return (
    <div className="space-y-4">
      {returnsList.length > 0 && (
        <div className={`grid gap-4 ${returnsList.length > 1 ? "md:grid-cols-2" : "md:grid-cols-1 max-w-xl"}`}>
          {returnsList.map(([groupName, fields], idx) => {
            const headline = fields.find((f) => /irr/i.test(f.key) || /\birr\b/i.test(f.field.label));
            const rest = headline ? fields.filter((f) => f.key !== headline.key) : fields;
            const subtitle = groupName.replace(/^returns\s*[—-]\s*/i, "") || "Returns";
            return (
              <Card key={groupName} className={idx === 0 ? "border-primary/40 shadow-sm" : ""} data-testid={`card-returns-${idx}`}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {groupIcon(groupName)}
                    {subtitle}
                  </div>
                  {headline && (
                    <div className="mt-2">
                      <p className="text-4xl font-serif font-semibold tracking-tight" data-testid={`output-${headline.key}`}>
                        {formatOutputValue(headline.value, headline.field.format)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{headline.field.label}</p>
                    </div>
                  )}
                  {rest.length > 0 && (
                    <div className={`mt-4 grid gap-3 ${rest.length > 1 ? "grid-cols-2" : ""}`}>
                      {rest.map(({ key, field, value }) => (
                        <div key={key} className="rounded-md bg-muted/40 px-3 py-2" data-testid={`output-${key}`}>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{field.label}</p>
                          <p className="text-base font-semibold font-mono tabular-nums mt-0.5">
                            {formatOutputValue(value, field.format)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {statsList.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {statsList.map(([groupName, fields]) => (
            <Card key={groupName}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  {groupIcon(groupName, "w-4 h-4")}
                  {groupName}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {fields.map(({ key, field, value }) => (
                    <div key={key} className="flex justify-between items-center gap-3 text-sm">
                      <span className="text-muted-foreground truncate" title={field.label}>{field.label}</span>
                      <span className="font-mono font-medium tabular-nums shrink-0" data-testid={`output-${key}`}>
                        {formatOutputValue(value, field.format)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function EmbeddedExcel({ runId, runName }: { runId: string; runName?: string }) {
  const { toast } = useToast();
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [webUrl, setWebUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const loadEmbed = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("POST", `/api/models/runs/${runId}/embed-excel`);
      const data = await res.json();
      if (data.embedUrl) {
        setEmbedUrl(data.embedUrl);
        setWebUrl(data.webUrl || null);
      } else {
        setError("Could not generate embed URL");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load Excel — Microsoft 365 connection required");
    }
    setLoading(false);
  };

  const refreshEmbed = () => {
    if (iframeRef.current && embedUrl) {
      iframeRef.current.src = embedUrl + (embedUrl.includes("?") ? "&" : "?") + "_t=" + Date.now();
    }
  };

  if (!embedUrl && !loading && !error) {
    return (
      <Card>
        <CardContent className="py-8 flex flex-col items-center gap-3">
          <FileSpreadsheet className="w-10 h-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground text-center">
            Load the live Excel spreadsheet to view and edit the model directly
          </p>
          <Button onClick={loadEmbed} data-testid="button-load-excel">
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Load Excel Model
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Syncing to SharePoint and loading Excel...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 flex flex-col items-center gap-3">
          <X className="w-8 h-8 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={loadEmbed}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-green-600" />
          <span className="text-sm font-medium">Live Excel Model</span>
          <Badge variant="outline" className="text-[10px] h-5 bg-green-50 text-green-700 border-green-200">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1 inline-block" />
            Synced
          </Badge>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={refreshEmbed} title="Refresh Excel" data-testid="button-refresh-excel">
            <History className="w-3.5 h-3.5 mr-1" /> Refresh
          </Button>
          {webUrl && (
            <Button variant="ghost" size="sm" onClick={() => window.open(webUrl, "_blank")} title="Open in full Excel" data-testid="button-fullscreen-excel">
              <ExternalLink className="w-3.5 h-3.5 mr-1" /> Full Screen
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => window.open(`/api/models/runs/${runId}/download`, "_blank")} title="Download Excel" data-testid="button-download-excel">
            <Download className="w-3.5 h-3.5 mr-1" /> Download
          </Button>
        </div>
      </div>
      <div className="border rounded-lg overflow-hidden bg-white" style={{ height: "600px" }}>
        <iframe
          ref={iframeRef}
          src={embedUrl || ""}
          className="w-full h-full border-0"
          allow="clipboard-read; clipboard-write"
          data-testid="embedded-excel-iframe"
        />
      </div>
    </div>
  );
}

function RunDetails({ runId }: { runId: string }) {
  const { data: run, isLoading } = useQuery<RunWithMeta>({
    queryKey: ["/api/models/runs", runId],
  });
  const [activeTab, setActiveTab] = useState<"summary" | "excel">("summary");

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!run) return <p className="text-muted-foreground">Run not found</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold" data-testid="text-run-name">{run.name}</h3>
          <p className="text-sm text-muted-foreground">
            Template: {run.templateName} | Created: {run.createdAt ? new Date(run.createdAt).toLocaleDateString() : "—"}
          </p>
        </div>
        <Badge variant={run.status === "completed" ? "default" : "secondary"}>
          {run.status}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Pill
          active={activeTab === "summary"}
          onClick={() => setActiveTab("summary")}
          data-testid="tab-summary"
        >
          Summary
        </Pill>
        <Pill
          active={activeTab === "excel"}
          onClick={() => setActiveTab("excel")}
          data-testid="tab-excel"
        >
          Excel Model
        </Pill>
      </div>

      {activeTab === "summary" && (
        <div className="space-y-6">
          {run.outputValues && (
            <>
              <ChecksBanner outputs={run.outputValues} mapping={run.outputMapping || {}} />
              <OutputsOverview outputs={run.outputValues} mapping={run.outputMapping || {}} />
            </>
          )}

          {run.inputValues && Object.keys(run.inputValues).length > 0 && (
            <InputAssumptionsCard inputValues={run.inputValues} inputMapping={run.inputMapping || {}} />
          )}

          <Separator />
          <ModelQA
            endpoint={`/api/models/runs/${runId}/ask`}
            title={run.name}
          />
        </div>
      )}

      {activeTab === "excel" && (
        <EmbeddedExcel runId={runId} runName={run.name} />
      )}
    </div>
  );
}

function InputAssumptionsCard({ inputValues, inputMapping }: {
  inputValues: Record<string, any>;
  inputMapping: Record<string, InputField>;
}) {
  const overridden = Object.entries(inputValues).filter(([, v]) => v !== "" && v !== null && v !== undefined);
  if (overridden.length === 0) return null;

  const groups: Record<string, { key: string; label: string; display: string }[]> = {};
  for (const [key, value] of overridden) {
    const field = inputMapping[key];
    const g = field?.group || "Other";
    if (!groups[g]) groups[g] = [];
    const unit = field ? inputUnit(field) : "";
    const display = unit === "%" ? `${value}%` : unit === "£" ? `£${Number(value).toLocaleString("en-GB")}` : String(value);
    groups[g].push({ key, label: field?.label || key, display });
  }
  const sorted = sortGroupEntries(groups, INPUT_GROUP_ORDER);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Layers className="w-4 h-4" />
          Scenario inputs
        </CardTitle>
        <CardDescription className="text-xs">
          Overrides vs the template defaults — blank fields kept the workbook's own values.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sorted.map(([groupName, fields]) => (
          <div key={groupName}>
            <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {groupIcon(groupName, "w-3 h-3")}
              {groupName}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
              {fields.map(({ key, label, display }) => (
                <div key={key} className="flex justify-between gap-2">
                  <span className="text-muted-foreground truncate">{label}</span>
                  <span className="font-medium font-mono tabular-nums shrink-0" data-testid={`assumption-${key}`}>{display}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ModelQA({ endpoint, title }: { endpoint: string; title: string }) {
  const { toast } = useToast();
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState<Array<{ role: "user" | "ai"; text: string }>>([]);
  const [open, setOpen] = useState(false);

  const askMutation = useMutation({
    mutationFn: async (q: string) => {
      const res = await apiRequest("POST", endpoint, { question: q });
      return res.json();
    },
    onSuccess: (data: { answer: string; question: string }) => {
      setConversation((prev) => [
        ...prev,
        { role: "user", text: data.question },
        { role: "ai", text: data.answer },
      ]);
      setQuestion("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to get answer", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!question.trim() || askMutation.isPending) return;
    askMutation.mutate(question.trim());
  };

  const suggestedQuestions = [
    "What does this model calculate and how?",
    "What are the key inputs and how do they affect the outputs?",
    "Are there any potential issues or errors in this model?",
    "Explain the IRR calculation methodology",
    "What assumptions are hardcoded vs adjustable?",
  ];

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="button-model-qa"
      >
        <MessageSquare className="w-4 h-4 mr-1" />
        Ask About Model
      </Button>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" />
            Model Q&A — {title}
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}>
            <X className="w-3 h-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {conversation.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Suggested questions:</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestedQuestions.map((q, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="cursor-pointer hover:bg-accent text-xs"
                  onClick={() => {
                    setQuestion(q);
                    askMutation.mutate(q);
                  }}
                  data-testid={`button-suggested-q-${i}`}
                >
                  {q}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {conversation.length > 0 && (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {conversation.map((msg, i) => (
              <div
                key={i}
                className={`text-sm ${msg.role === "user" ? "text-right" : ""}`}
              >
                {msg.role === "user" ? (
                  <div className="inline-block p-2 rounded-lg bg-primary text-primary-foreground max-w-[85%] text-left">
                    {msg.text}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-muted whitespace-pre-wrap">
                    {msg.text}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Textarea
            placeholder="Ask about this model... e.g. 'How is the IRR calculated?' or 'What assumptions drive the returns?'"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            className="min-h-[40px] resize-none text-sm"
            rows={1}
            data-testid="input-model-question"
          />
          <Button
            size="icon"
            onClick={handleSubmit}
            disabled={!question.trim() || askMutation.isPending}
            data-testid="button-ask-model"
          >
            {askMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>

        {askMutation.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Analysing model with full formula visibility...
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SpreadsheetViewer({ endpoint, title, editable, outputs, outputMapping, externalOpen, onExternalClose }: {
  endpoint: string;
  title: string;
  editable?: boolean;
  outputs?: Record<string, any>;
  outputMapping?: Record<string, OutputField>;
  externalOpen?: boolean;
  onExternalClose?: () => void;
}) {
  const { toast } = useToast();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = (val: boolean) => {
    if (externalOpen !== undefined) { if (!val && onExternalClose) onExternalClose(); }
    else setInternalOpen(val);
  };
  const [activeSheet, setActiveSheet] = useState("");
  const [saving, setSaving] = useState(false);
  const [designChatOpen, setDesignChatOpen] = useState(false);
  const [designMessages, setDesignMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [designInput, setDesignInput] = useState("");
  const [designLoading, setDesignLoading] = useState(false);
  const designEndRef = useRef<HTMLDivElement>(null);

  const templateId = endpoint.match(/templates\/([^/]+)/)?.[1] || "";

  const sendDesignMessage = async () => {
    const msg = designInput.trim();
    if (!msg || designLoading || !templateId) return;
    setDesignInput("");
    setDesignMessages((prev) => [...prev, { role: "user", content: msg }]);
    setDesignLoading(true);
    try {
      const res = await fetch(`/api/models/templates/${templateId}/design-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: msg, conversationHistory: designMessages }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Request failed");
      }
      const data = await res.json();
      const reply = data.changesApplied > 0
        ? `${data.reply}\n\n✓ ${data.changesApplied} cell${data.changesApplied > 1 ? "s" : ""} updated.`
        : data.reply;
      setDesignMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      if (data.changesApplied > 0) {
        refetch();
        queryClient.invalidateQueries({ queryKey: ["/api/models/templates", templateId] });
      }
    } catch (err: any) {
      setDesignMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    }
    setDesignLoading(false);
    setTimeout(() => designEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  // Univer renders the whole workbook at once, so fetch every sheet up front instead of
  // one sheet per tab click. The parameterless first request also returns sheetNames.
  const { data, isLoading, refetch } = useQuery<WorkbookPayload>({
    queryKey: [endpoint, "workbook"],
    queryFn: async (): Promise<WorkbookPayload> => {
      const fetchSheet = async (sheet?: string): Promise<CellsEndpointResponse> => {
        const url = sheet ? `${endpoint}?sheet=${encodeURIComponent(sheet)}` : endpoint;
        const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      };
      const first = await fetchSheet();
      const rest = await Promise.all(first.sheetNames.slice(1).map((s) => fetchSheet(s)));
      const sheets: Record<string, SheetPayload> = {};
      for (const res of [first, ...rest]) {
        sheets[res.activeSheet] = {
          totalRows: res.totalRows,
          totalCols: res.totalCols,
          rows: res.rows,
          merges: res.merges,
          colWidths: res.colWidths,
          inputCells: res.inputCells,
          outputCells: res.outputCells,
        };
      }
      return { sheetNames: first.sheetNames, sheets };
    },
    enabled: open,
  });

  const { data: templateDetail } = useQuery<TemplateWithMeta>({
    queryKey: ["/api/models/templates", templateId],
    enabled: open && !!templateId && !outputMapping,
  });
  const effectiveOutputMapping = outputMapping || templateDetail?.outputMapping;

  const formatHints = useMemo(() => {
    const hints: Record<string, Record<string, string>> = {};
    if (effectiveOutputMapping) {
      for (const f of Object.values(effectiveOutputMapping)) {
        if (f.sheet && f.cell && f.format) (hints[f.sheet] ||= {})[f.cell] = f.format;
      }
    }
    return hints;
  }, [effectiveOutputMapping]);

  const postCellEdit = async (edit: CellEdit) => {
    if (!editable) return;
    setSaving(true);
    try {
      await apiRequest("POST", endpoint, {
        sheet: edit.sheet,
        cell: edit.cell,
        value: edit.value,
      });
      await refetch();
      toast({ title: "Cell updated", description: `${edit.cell} = ${edit.value || "(empty)"}` });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err?.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const currentSheet = data?.sheets[activeSheet || data.sheetNames[0]];

  const metricGroups = effectiveOutputMapping && outputs ? Object.entries(effectiveOutputMapping).reduce<Record<string, { key: string; field: OutputField; value: any }[]>>(
    (acc, [key, field]) => {
      const g = field.group || "Key Metrics";
      if (!acc[g]) acc[g] = [];
      acc[g].push({ key, field, value: outputs[key] });
      return acc;
    },
    {}
  ) : null;

  const getMetricColor = (group: string) => {
    switch (group) {
      case "Returns": return "text-green-600";
      case "Yields": return "text-blue-600";
      case "Property": return "text-orange-600";
      default: return "text-purple-600";
    }
  };

  return (
    <>
      {externalOpen === undefined && (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="button-view-spreadsheet">
          <Eye className="w-4 h-4 mr-2" />
          View Spreadsheet
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] w-[95vw] max-h-[90vh] h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-3 pt-3 pb-1 flex-shrink-0">
            <DialogTitle className="flex items-center gap-3">
              <img src={bgpLogoDark} alt="BGP" className="h-6 w-auto" />
              <span className="text-muted-foreground text-sm font-normal">|</span>
              <div className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="w-4 h-4 text-green-600" />
                {title}
              </div>
              {editable && (
                <Badge variant="outline" className="ml-1 text-[9px]">Editable</Badge>
              )}
              {editable && templateId && (
                <Button
                  variant={designChatOpen ? "default" : "outline"}
                  size="sm"
                  className="ml-auto h-7 text-xs gap-1.5"
                  onClick={() => setDesignChatOpen(!designChatOpen)}
                  data-testid="button-design-assistant-toggle"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Design Assistant
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-1 min-h-0">
            <div className="flex-1 min-h-0 min-w-0">
              {isLoading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full rounded-lg" />
                  ))}
                </div>
              ) : data ? (
                <Suspense
                  fallback={
                    <div className="space-y-3 p-4">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-full rounded-lg" />
                      ))}
                    </div>
                  }
                >
                  <UniverSpreadsheet
                    workbookName={title}
                    payload={data}
                    formatHints={formatHints}
                    editable={editable}
                    onCellEdit={postCellEdit}
                    onActiveSheetChange={setActiveSheet}
                  />
                </Suspense>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  No data
                </div>
              )}
            </div>

            {metricGroups && Object.keys(metricGroups).length > 0 && !designChatOpen && (
              <div className="w-56 flex-shrink-0 border-l overflow-y-auto bg-muted/30 p-2 space-y-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-1">Summary Metrics</p>
                {Object.entries(metricGroups).map(([groupName, fields]) => (
                  <div key={groupName} className="space-y-0.5">
                    <p className={`text-[10px] uppercase tracking-wider font-semibold px-1 ${getMetricColor(groupName)}`}>{groupName}</p>
                    {fields.map(({ key, field, value }) => (
                      <div key={key} className="flex justify-between items-center px-1 py-0.5 rounded hover:bg-muted/50 text-[11px]">
                        <span className="text-muted-foreground truncate mr-1" title={field.label}>{field.label}</span>
                        <span className="font-mono font-semibold flex-shrink-0" data-testid={`metric-sidebar-${key}`}>
                          {formatOutputValue(value, field.format)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {designChatOpen && (
              <div className="w-80 flex-shrink-0 border-l flex flex-col bg-background">
                <div className="px-3 py-2 border-b flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold">Design Assistant</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDesignChatOpen(false)} data-testid="button-close-design-chat">
                    <X className="w-3 h-3" />
                  </Button>
                </div>

                <ScrollArea className="flex-1 min-h-0">
                  <div className="p-3 space-y-3">
                    {designMessages.length === 0 && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Ask the AI to improve your model — update labels, fix formulas, add calculations, restructure sheets.</p>
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            "Add a summary dashboard sheet",
                            "Fix the IRR formula",
                            "Improve the labels and formatting",
                            "Add a rent roll section",
                            "Create a sensitivity table",
                          ].map((q, i) => (
                            <Badge
                              key={i}
                              variant="outline"
                              className="cursor-pointer hover:bg-accent text-[10px]"
                              onClick={() => {
                                setDesignInput(q);
                              }}
                              data-testid={`badge-design-suggestion-${i}`}
                            >
                              {q}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {designMessages.map((msg, i) => (
                      <div key={i} className={`text-xs ${msg.role === "user" ? "text-right" : ""}`}>
                        {msg.role === "user" ? (
                          <div className="inline-block p-2 rounded-lg bg-primary text-primary-foreground max-w-[90%] text-left">
                            {msg.content}
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                              <Bot className="w-3 h-3 text-primary" />
                            </div>
                            <div className="p-2 rounded-lg bg-muted whitespace-pre-wrap flex-1">
                              {msg.content}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}

                    {designLoading && (
                      <div className="flex gap-2">
                        <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                          <Bot className="w-3 h-3 text-primary" />
                        </div>
                        <div className="p-2 rounded-lg bg-muted flex items-center gap-2">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span className="text-[10px] text-muted-foreground">Analysing model...</span>
                        </div>
                      </div>
                    )}
                    <div ref={designEndRef} />
                  </div>
                </ScrollArea>

                <div className="p-2 border-t flex gap-1.5">
                  <Textarea
                    placeholder="Describe changes..."
                    value={designInput}
                    onChange={(e) => setDesignInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendDesignMessage();
                      }
                    }}
                    className="min-h-[36px] max-h-[80px] resize-none text-xs"
                    rows={1}
                    data-testid="input-design-chat"
                  />
                  <Button
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={sendDesignMessage}
                    disabled={!designInput.trim() || designLoading}
                    data-testid="button-send-design-chat"
                  >
                    {designLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-3 py-1 border-t text-[10px] text-muted-foreground flex-shrink-0">
            <div className="flex items-center gap-3">
              <span>{currentSheet?.totalRows || 0}r x {currentSheet?.totalCols || 0}c</span>
              {(currentSheet?.inputCells.length || 0) > 0 && (
                <span className="flex items-center gap-0.5" title="Input cells">
                  <span className="w-2 h-2 rounded-sm bg-blue-200 border border-blue-400 inline-block" /> {currentSheet?.inputCells.length}
                </span>
              )}
              {(currentSheet?.outputCells.length || 0) > 0 && (
                <span className="flex items-center gap-0.5" title="Output cells">
                  <span className="w-2 h-2 rounded-sm bg-green-200 border border-green-400 inline-block" /> {currentSheet?.outputCells.length}
                </span>
              )}
              {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            </div>
            <span>{editable ? "Double-click or type to edit · Enter/Tab to save · Esc to cancel" : "Read-only"}</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PropertyLinkBadge({
  propertyId,
  onLink,
  size = "sm",
}: {
  propertyId: string | null | undefined;
  onLink: (propertyId: string | null) => void;
  size?: "sm" | "xs";
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: properties } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });

  const linked = properties?.find((p) => p.id === propertyId);
  const filtered = properties?.filter(
    (p) => !search || p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors hover:bg-accent ${
            linked ? "border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800" : "border-dashed border-muted-foreground/30"
          } ${size === "xs" ? "text-[10px]" : "text-xs"}`}
          onClick={(e) => e.stopPropagation()}
          data-testid="button-link-property"
        >
          <Building2 className={size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5"} />
          {linked ? linked.name : "Link Property"}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Link to CRM Property</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Search properties..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-property"
          />
          {linked && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-destructive"
              onClick={() => { onLink(null); setOpen(false); }}
              data-testid="button-unlink-property"
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Remove link to {linked.name}
            </Button>
          )}
          <ScrollArea className="h-[300px]">
            <div className="space-y-1">
              {filtered?.map((p) => (
                <button
                  key={p.id}
                  className={`w-full text-left p-2.5 rounded-md text-sm hover:bg-accent transition-colors flex items-center gap-2 ${
                    p.id === propertyId ? "bg-primary/10 border border-primary/20" : ""
                  }`}
                  onClick={() => { onLink(p.id); setOpen(false); }}
                  data-testid={`button-select-property-${p.id}`}
                >
                  <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <div className="font-medium">{p.name}</div>
                    {p.assetClass && (
                      <span className="text-xs text-muted-foreground">{p.assetClass}</span>
                    )}
                  </div>
                </button>
              ))}
              {filtered?.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No properties found</p>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AutoMapDialog({ template, open, onClose }: { template: ExcelTemplate; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [proposal, setProposal] = useState<any>(null);

  const proposeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/models/templates/${template.id}/auto-map`, {});
      return res.json();
    },
    onSuccess: (data) => setProposal(data),
    onError: (e: any) => toast({ title: "Auto-map failed", description: e.message, variant: "destructive" }),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/models/templates/${template.id}/auto-map`, {
        apply: true,
        inputMapping: proposal.inputs,
        outputMapping: proposal.outputs,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/models/templates"] });
      toast({ title: "Mappings applied", description: "Template is now drivable — Run, Sensitivity, Smart Run and Compare will use it." });
      onClose();
    },
    onError: (e: any) => toast({ title: "Failed to apply mappings", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (open) { setProposal(null); proposeMutation.mutate(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const renderGroup = (entries: [string, any][], field: "type" | "format") => {
    const groups = entries.reduce<Record<string, [string, any][]>>((acc, e) => {
      const g = e[1].group || "Other";
      (acc[g] ||= []).push(e);
      return acc;
    }, {});
    return Object.entries(groups).map(([g, items]) => (
      <div key={g} className="mb-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{g}</p>
        {items.map(([key, m]) => (
          <div key={key} className="flex items-center justify-between text-sm py-0.5">
            <span>{m.label}</span>
            <span className="text-xs text-muted-foreground font-mono">{m.sheet}!{m.cell} · {m[field]}</span>
          </div>
        ))}
      </div>
    ));
  };

  const inputEntries = proposal ? Object.entries(proposal.inputs) : [];
  const outputEntries = proposal ? Object.entries(proposal.outputs) : [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Auto-map — {template.name}
          </DialogTitle>
        </DialogHeader>
        {proposeMutation.isPending && (
          <div className="py-10 text-center text-sm text-muted-foreground">Claude is reading the workbook structure…</div>
        )}
        {proposal && (
          <div className="space-y-4">
            {proposal.source === "heuristic" && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                AI unavailable — this proposal came from keyword heuristics. Review carefully before applying.
              </p>
            )}
            {proposal.warnings?.length > 0 && (
              <div className="text-xs text-muted-foreground border rounded px-2 py-1 space-y-0.5">
                {proposal.warnings.slice(0, 8).map((w: string, i: number) => <p key={i}>⚠ {w}</p>)}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-semibold mb-1">Inputs ({inputEntries.length})</p>
                {inputEntries.length ? renderGroup(inputEntries, "type") : <p className="text-xs text-muted-foreground">None found</p>}
              </div>
              <div>
                <p className="text-sm font-semibold mb-1">Outputs ({outputEntries.length})</p>
                {outputEntries.length ? renderGroup(outputEntries, "format") : <p className="text-xs text-muted-foreground">None found</p>}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button variant="outline" onClick={() => proposeMutation.mutate()} disabled={proposeMutation.isPending}>
                Regenerate
              </Button>
              <Button
                onClick={() => applyMutation.mutate()}
                disabled={applyMutation.isPending || (!inputEntries.length && !outputEntries.length)}
                data-testid={`button-apply-automap-${template.id}`}
              >
                {applyMutation.isPending ? "Applying…" : "Apply mappings"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TemplateCard({ template }: { template: ExcelTemplate & { sheetCount?: number } }) {
  const { toast } = useToast();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [autoMapOpen, setAutoMapOpen] = useState(false);

  const { data: templateDetail } = useQuery<TemplateWithMeta>({
    queryKey: ["/api/models/templates", template.id],
    enabled: runOpen,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/models/templates/${template.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/models/templates"] });
      toast({ title: "Template deleted" });
    },
  });

  const sheetCount = template.sheetCount || 0;
  const createdDate = template.createdAt ? new Date(template.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  const mappingCounts = useMemo(() => {
    try {
      const inputs = Object.keys(JSON.parse((template.inputMapping as unknown as string) || "{}")).length;
      const outputs = Object.keys(JSON.parse((template.outputMapping as unknown as string) || "{}")).length;
      return { inputs, outputs };
    } catch {
      return { inputs: 0, outputs: 0 };
    }
  }, [template.inputMapping, template.outputMapping]);

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors group"
      onClick={() => setViewerOpen(true)}
      data-testid={`card-template-${template.id}`}
    >
      <FileSpreadsheet className="w-8 h-8 text-green-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" data-testid={`text-template-name-${template.id}`}>
          {template.name}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {template.originalFileName || template.description}
          {sheetCount > 0 && <> · {sheetCount} sheets</>}
          {mappingCounts.inputs > 0 && <> · {mappingCounts.inputs} inputs / {mappingCounts.outputs} outputs</>}
          {createdDate && <> · {createdDate}</>}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" className="h-7 px-2.5 text-xs"
          onClick={() => setRunOpen(true)}
          data-testid={`button-run-template-${template.id}`}
        >
          <Play className="w-3.5 h-3.5 mr-1" />
          Run
        </Button>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Auto-map inputs/outputs with AI"
            onClick={() => setAutoMapOpen(true)}
            data-testid={`button-automap-template-${template.id}`}
          >
            <Sparkles className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Download Excel"
            onClick={() => window.open(`/api/models/templates/${template.id}/download`, "_blank")}
            data-testid={`button-download-template-${template.id}`}
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Delete"
            onClick={() => setConfirmDelete(true)}
            data-testid={`button-delete-template-${template.id}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <SpreadsheetViewer
        endpoint={`/api/models/templates/${template.id}/cells`}
        title={template.name}
        editable
        externalOpen={viewerOpen}
        onExternalClose={() => setViewerOpen(false)}
      />

      <AutoMapDialog template={template} open={autoMapOpen} onClose={() => setAutoMapOpen(false)} />

      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Run scenario — {template.name}</DialogTitle>
          </DialogHeader>
          {templateDetail ? (
            <RunModelForm template={templateDetail} onClose={() => setRunOpen(false)} />
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading template…</div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template</AlertDialogTitle>
            <AlertDialogDescription>Delete "{template.name}"? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteMutation.mutate()} data-testid={`button-confirm-delete-template-${template.id}`}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SmartRunPanel() {
  const { toast } = useToast();
  const [templateId, setTemplateId] = useState("");
  const [runName, setRunName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"upload" | "review" | "complete">("upload");

  const { data: templates } = useQuery<ExcelTemplate[]>({
    queryKey: ["/api/models/templates"],
  });

  const { data: templateDetail } = useQuery<TemplateWithMeta>({
    queryKey: ["/api/models/templates", templateId],
    enabled: !!templateId,
  });

  const extractMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      files.forEach((f) => formData.append("documents", f));
      if (templateId) formData.append("templateId", templateId);
      const response = await fetch("/api/models/smart-extract", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || "Extraction failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setExtractedData(data.extracted);
      // Seed the editable review state with every scalar the AI returned; the
      // user edits these in place and they are sent back as editedInputs.
      const initial: Record<string, string> = {};
      for (const [key, value] of Object.entries(data.extracted || {})) {
        if (key === "summary" || key === "tenants" || key === "leaseExpiries") continue;
        if (value !== null && value !== undefined) initial[key] = String(value);
      }
      setEditedValues(initial);
      if (data.extracted?.dealName) setRunName(data.extracted.dealName);
      setStep("review");
      toast({ title: "Data extracted from documents" });
    },
    onError: (err: any) => {
      toast({ title: "Extraction failed", description: err.message, variant: "destructive" });
    },
  });

  const smartRunMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      files.forEach((f) => formData.append("documents", f));
      formData.append("templateId", templateId);
      if (runName) formData.append("name", runName);
      if (Object.keys(editedValues).length > 0) {
        formData.append("editedInputs", JSON.stringify(editedValues));
      }
      const response = await fetch("/api/models/smart-run", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || "Smart run failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/models/runs"] });
      setExtractedData(data);
      setStep("complete");
      toast({ title: "Model run completed" });
    },
    onError: (err: any) => {
      toast({ title: "Smart run failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleReset = () => {
    setFiles([]);
    setExtractedData(null);
    setEditedValues({});
    setRunName("");
    setTemplateId("");
    setStep("upload");
  };

  if (step === "complete" && extractedData) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <Check className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <CardTitle data-testid="text-smart-run-complete">Model Run Complete</CardTitle>
                <CardDescription>
                  {extractedData.documentsProcessed?.join(", ")}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.isArray(extractedData.overriddenKeys) && extractedData.overriddenKeys.length > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800" data-testid="note-smart-run-overrides">
                <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-400 shrink-0">
                  {extractedData.overriddenKeys.length} edited
                </Badge>
                <p className="text-xs text-muted-foreground">
                  Your reviewed values were used for:{" "}
                  {extractedData.overriddenKeys.map((k: string) => templateDetail?.inputMapping?.[k]?.label || k).join(", ")}
                </p>
              </div>
            )}
            {extractedData.extracted?.summary && (
              <div className="p-3 rounded-lg bg-muted">
                <p className="text-sm font-medium mb-1">Property Summary</p>
                <p className="text-sm text-muted-foreground">{extractedData.extracted.summary}</p>
              </div>
            )}
            {extractedData.outputValues && (
              <>
                <h4 className="font-medium">Model Results</h4>
                {(() => {
                  const smartMapping = Object.entries(extractedData.outputValues).reduce<Record<string, OutputField>>((acc, [key]) => {
                    const mapped = templateDetail?.outputMapping?.[key];
                    acc[key] = mapped || { sheet: "", cell: "", label: key, format: "", group: "Results" };
                    return acc;
                  }, {});
                  return (
                    <>
                      <ChecksBanner outputs={extractedData.outputValues} mapping={smartMapping} />
                      <OutputsOverview outputs={extractedData.outputValues} mapping={smartMapping} />
                    </>
                  );
                })()}
              </>
            )}
            {extractedData.inputValues && Object.keys(extractedData.inputValues).length > 0 && (
              <InputAssumptionsCard
                inputValues={extractedData.inputValues}
                inputMapping={templateDetail?.inputMapping || {}}
              />
            )}
            {extractedData.id && (
              <EmbeddedExcel runId={extractedData.id} runName={extractedData.name} />
            )}
            <div className="flex gap-2">
              {extractedData.id && (
                <Button
                  variant="outline"
                  onClick={() => window.open(`/api/models/runs/${extractedData.id}/download`, "_blank")}
                  data-testid="button-download-smart-run"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              )}
              <Button onClick={handleReset} data-testid="button-new-smart-run">
                <Sparkles className="w-4 h-4 mr-2" />
                New Smart Run
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle>Smart Model Run</CardTitle>
              <CardDescription>
                Upload a tenancy schedule and/or brochure — AI will extract the data and run your model automatically
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Select Model Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger className="mt-1" data-testid="select-smart-template">
                <SelectValue placeholder="Choose a template..." />
              </SelectTrigger>
              <SelectContent>
                {templates?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Upload Documents</Label>
            <div className="mt-1 border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
              <FileUp className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground mb-2">
                Tenancy schedule (.xlsx) and/or brochure (.pdf)
              </p>
              <Input
                type="file"
                multiple
                onChange={handleFileChange}
                className="max-w-xs mx-auto"
                data-testid="input-smart-documents"
              />
            </div>
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-md bg-muted text-sm">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
                    <span>{f.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {(f.size / 1024).toFixed(0)} KB
                    </Badge>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeFile(i)}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {step === "review" && extractedData && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-medium mb-1">Extracted Property Data</h4>
                <p className="text-xs text-muted-foreground mb-3">
                  These values will be used in the model run — edit anything the AI misread.
                </p>
                {extractedData.summary && (
                  <div className="p-3 rounded-lg bg-muted mb-3">
                    <p className="text-sm text-muted-foreground">{extractedData.summary}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  {Object.entries(extractedData)
                    .filter(([key]) => key !== "summary" && key !== "tenants" && key !== "leaseExpiries")
                    .map(([key, value]) => {
                      const mappedField = templateDetail?.inputMapping?.[key];
                      const fieldType = mappedField?.type || (typeof value === "number" ? "number" : "text");
                      return (
                        <div key={key}>
                          <Label htmlFor={`smart-edit-${key}`} className="text-xs text-muted-foreground">
                            {mappedField?.label || key}
                          </Label>
                          <Input
                            id={`smart-edit-${key}`}
                            type={fieldType === "text" ? "text" : "number"}
                            step={fieldType === "percent" ? "0.1" : "any"}
                            value={editedValues[key] ?? ""}
                            onChange={(e) => setEditedValues((prev) => ({ ...prev, [key]: e.target.value }))}
                            data-testid={`input-smart-edit-${key}`}
                          />
                        </div>
                      );
                    })}
                </div>
                {extractedData.tenants && extractedData.tenants.length > 0 && (
                  <div className="mt-3 p-3 rounded-lg bg-muted">
                    <p className="text-xs font-medium mb-1">Tenants</p>
                    <p className="text-sm text-muted-foreground">{extractedData.tenants.join(", ")}</p>
                  </div>
                )}
              </div>
              <div>
                <Label htmlFor="smart-run-name">Run Name</Label>
                <Input
                  id="smart-run-name"
                  placeholder="e.g. 67 Pimlico Road Analysis"
                  value={runName}
                  onChange={(e) => setRunName(e.target.value)}
                  data-testid="input-smart-run-name"
                />
              </div>
            </>
          )}

          <div className="flex gap-2">
            {step === "upload" && (
              <Button
                onClick={() => extractMutation.mutate()}
                disabled={files.length === 0 || extractMutation.isPending}
                className="flex-1"
                variant="outline"
                data-testid="button-extract-data"
              >
                {extractMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Extracting data...
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4 mr-2" />
                    Preview Extracted Data
                  </>
                )}
              </Button>
            )}
            <Button
              onClick={() => smartRunMutation.mutate()}
              disabled={files.length === 0 || !templateId || smartRunMutation.isPending}
              className="flex-1"
              data-testid="button-smart-run"
            >
              {smartRunMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Running model...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Extract & Run Model
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RunCard({ run }: { run: ExcelModelRun & { templateName?: string | null } }) {
  const { toast } = useToast();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/models/runs/${run.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/models/runs"] });
      toast({ title: "Run deleted" });
    },
  });

  const createdDate = run.createdAt ? new Date(run.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors group"
      onClick={() => setDetailsOpen(true)}
      data-testid={`card-run-${run.id}`}
    >
      <FileSpreadsheet className="w-8 h-8 text-blue-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate" data-testid={`text-run-name-${run.id}`}>
            {run.name}
          </p>
          <Badge variant={run.status === "completed" ? "default" : "secondary"} className="text-[9px] h-4 px-1">{run.status}</Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {run.templateName || "Model run"}
          {createdDate && <> · {createdDate}</>}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
        {run.generatedFilePath && (
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Download Excel"
            onClick={() => window.open(`/api/models/runs/${run.id}/download`, "_blank")}
            data-testid={`button-download-run-${run.id}`}
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Delete"
          onClick={() => setConfirmDelete(true)}
          data-testid={`button-delete-run-${run.id}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="sr-only">{run.name}</DialogTitle>
          </DialogHeader>
          <RunDetails runId={run.id} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete run</AlertDialogTitle>
            <AlertDialogDescription>Delete "{run.name}"? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteMutation.mutate()} data-testid={`button-confirm-delete-run-${run.id}`}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SensitivityPanel() {
  const { toast } = useToast();
  const [templateId, setTemplateId] = useState("");
  const [var1Key, setVar1Key] = useState("");
  const [var2Key, setVar2Key] = useState("");
  const [var1Values, setVar1Values] = useState(""); 
  const [var2Values, setVar2Values] = useState("");
  const [results, setResults] = useState<any>(null);

  const { data: templates } = useQuery<ExcelTemplate[]>({ queryKey: ["/api/models/templates"] });
  const { data: templateDetail } = useQuery<TemplateWithMeta>({
    queryKey: ["/api/models/templates", templateId],
    enabled: !!templateId,
  });

  const inputFields = templateDetail?.inputMapping ? Object.entries(templateDetail.inputMapping) : [];

  const sensitivityMutation = useMutation({
    mutationFn: async () => {
      const v1 = var1Values.split(",").map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      const hasVar2 = var2Key && var2Key !== "none" && var2Values;
      const v2 = hasVar2 ? var2Values.split(",").map(v => parseFloat(v.trim())).filter(v => !isNaN(v)) : null;
      if (v1.length < 2) throw new Error("Enter at least 2 comma-separated values for Variable 1");

      const res = await apiRequest("POST", `/api/models/templates/${templateId}/sensitivity`, {
        variable1: { key: var1Key, values: v1 },
        variable2: v2 && v2.length >= 2 ? { key: var2Key, values: v2 } : undefined,
        baseInputs: {},
      });
      return res.json();
    },
    onSuccess: (data) => {
      setResults(data);
      toast({ title: "Sensitivity analysis complete" });
    },
    onError: (err: any) => {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const parseHeatValue = (value: any): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const num = typeof value === "number" ? value : parseFloat(String(value).replace(/[%,£$\s]/g, ""));
    return isNaN(num) ? null : num;
  };

  const outputRanges: Record<string, { min: number; max: number }> = {};
  if (results?.results && results?.outputLabels) {
    for (const key of Object.keys(results.outputLabels)) {
      const vals = results.results
        .map((r: any) => parseHeatValue(r.outputs?.[key]))
        .filter((v: number | null): v is number => v !== null);
      if (vals.length > 0) outputRanges[key] = { min: Math.min(...vals), max: Math.max(...vals) };
    }
  }

  const getHeatColor = (value: any, outputKey?: string) => {
    const num = parseHeatValue(value);
    if (num === null) return "";
    const range = outputKey ? outputRanges[outputKey] : undefined;
    if (!range || range.max === range.min) return "bg-yellow-50 dark:bg-yellow-900/20";
    const t = (num - range.min) / (range.max - range.min);
    if (t >= 0.8) return "bg-green-100 dark:bg-green-900/30";
    if (t >= 0.6) return "bg-green-50 dark:bg-green-900/20";
    if (t >= 0.4) return "bg-yellow-50 dark:bg-yellow-900/20";
    if (t >= 0.2) return "bg-orange-50 dark:bg-orange-900/20";
    return "bg-red-50 dark:bg-red-900/20";
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <CardTitle>Sensitivity Analysis</CardTitle>
              <CardDescription>See how varying key inputs affects your model's returns</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Select Model</Label>
            <Select value={templateId} onValueChange={(v) => { setTemplateId(v); setVar1Key(""); setVar2Key(""); setResults(null); }}>
              <SelectTrigger className="mt-1" data-testid="select-sensitivity-template">
                <SelectValue placeholder="Choose a template..." />
              </SelectTrigger>
              <SelectContent>
                {templates?.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {templateId && inputFields.length > 0 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Variable 1 (required)</Label>
                  <Select value={var1Key} onValueChange={setVar1Key}>
                    <SelectTrigger data-testid="select-var1">
                      <SelectValue placeholder="Select input to vary..." />
                    </SelectTrigger>
                    <SelectContent>
                      {inputFields.map(([k, f]) => <SelectItem key={k} value={k}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input
                    className="mt-2"
                    placeholder="e.g. 3, 4, 5, 6, 7"
                    value={var1Values}
                    onChange={e => setVar1Values(e.target.value)}
                    data-testid="input-var1-values"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Comma-separated values to test</p>
                </div>
                <div>
                  <Label className="text-xs">Variable 2 (optional — creates matrix)</Label>
                  <Select value={var2Key} onValueChange={setVar2Key}>
                    <SelectTrigger data-testid="select-var2">
                      <SelectValue placeholder="Optional second variable..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {inputFields.filter(([k]) => k !== var1Key).map(([k, f]) => (
                        <SelectItem key={k} value={k}>{f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {var2Key && var2Key !== "none" && (
                    <>
                      <Input
                        className="mt-2"
                        placeholder="e.g. 50, 55, 60, 65"
                        value={var2Values}
                        onChange={e => setVar2Values(e.target.value)}
                        data-testid="input-var2-values"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">Comma-separated values</p>
                    </>
                  )}
                </div>
              </div>

              <Button
                onClick={() => sensitivityMutation.mutate()}
                disabled={!var1Key || !var1Values || sensitivityMutation.isPending}
                data-testid="button-run-sensitivity"
              >
                {sensitivityMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analysing model...</>
                ) : (
                  <><BarChart3 className="w-4 h-4 mr-2" />Run Sensitivity Analysis</>
                )}
              </Button>
            </>
          )}

          {results && (
            <div className="space-y-4 mt-4">
              <Separator />
              <h4 className="font-medium">Results</h4>

              {results.variable2 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr>
                        <th className="border p-2 bg-muted text-left text-xs">
                          {results.variable1.label} ↓ / {results.variable2.label} →
                        </th>
                        {results.variable2.values.map((v: number) => (
                          <th key={v} className="border p-2 bg-muted text-center text-xs">{v}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.variable1.values.map((v1: number) => (
                        <tr key={v1}>
                          <td className="border p-2 font-medium bg-muted text-xs">{v1}</td>
                          {results.variable2.values.map((v2: number) => {
                            const match = results.results.find((r: any) =>
                              r.var1Value === v1 && r.var2Value === v2
                            );
                            const firstOutputKey = Object.keys(results.outputLabels || {})[0];
                            const firstOutput = (firstOutputKey && match?.outputs?.[firstOutputKey] !== undefined)
                              ? match.outputs[firstOutputKey]
                              : (match?.outputs ? Object.values(match.outputs)[0] : "—");
                            return (
                              <td key={v2} className={`border p-2 text-center text-xs font-mono ${getHeatColor(firstOutput, firstOutputKey)}`}>
                                {String(firstOutput)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Showing: {Object.values(results.outputLabels)[0] as string}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr>
                        <th className="border p-2 bg-muted text-left text-xs">{results.variable1.label}</th>
                        {Object.entries(results.outputLabels).map(([k, label]) => (
                          <th key={k} className="border p-2 bg-muted text-center text-xs">{label as string}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.results.map((r: any, i: number) => (
                        <tr key={i}>
                          <td className="border p-2 font-medium bg-muted text-xs">{r.var1Value}</td>
                          {Object.keys(results.outputLabels).map((k: string) => (
                            <td key={k} className={`border p-2 text-center text-xs font-mono ${getHeatColor(r.outputs?.[k], k)}`}>
                              {r.outputs?.[k] ?? "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {results.insights && (
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-xs font-medium mb-1">AI Insights</p>
                  <p className="text-sm text-muted-foreground">{results.insights}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ComparePanel() {
  const { toast } = useToast();
  const [selectedRuns, setSelectedRuns] = useState<Set<string>>(new Set());
  const [comparison, setComparison] = useState<any>(null);

  const { data: runs } = useQuery<ExcelModelRun[]>({ queryKey: ["/api/models/runs"] });

  const toggleRun = (id: string) => {
    setSelectedRuns(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
    setComparison(null);
  };

  const compareMutation = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selectedRuns).join(",");
      const res = await apiRequest("GET", `/api/models/runs/compare?ids=${ids}`);
      return res.json();
    },
    onSuccess: (data) => {
      setComparison(data);
      toast({ title: "Comparison ready" });
    },
    onError: (err: any) => {
      toast({ title: "Comparison failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <GitCompare className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <CardTitle>Scenario Comparison</CardTitle>
              <CardDescription>Compare model runs side by side to evaluate different scenarios</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">
              Select 2-5 runs to compare ({selectedRuns.size} selected)
            </Label>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {runs?.map(run => (
                <div
                  key={run.id}
                  className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors ${
                    selectedRuns.has(run.id) ? "bg-primary/10 border border-primary/20" : "bg-muted/50 hover:bg-muted"
                  }`}
                  onClick={() => toggleRun(run.id)}
                  data-testid={`compare-run-${run.id}`}
                >
                  <Checkbox checked={selectedRuns.has(run.id)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{run.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {run.createdAt ? new Date(run.createdAt).toLocaleDateString() : ""}
                    </p>
                  </div>
                </div>
              ))}
              {(!runs || runs.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">No model runs to compare yet</p>
              )}
            </div>
          </div>

          <Button
            onClick={() => compareMutation.mutate()}
            disabled={selectedRuns.size < 2 || compareMutation.isPending}
            data-testid="button-compare"
          >
            {compareMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Comparing...</>
            ) : (
              <><GitCompare className="w-4 h-4 mr-2" />Compare Selected ({selectedRuns.size})</>
            )}
          </Button>

          {comparison && (
            <div className="space-y-4 mt-4">
              <Separator />
              <h4 className="font-medium">Comparison Results</h4>

              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      <th className="border p-2 bg-muted text-left text-xs sticky left-0">Metric</th>
                      {comparison.runs.map((r: any) => (
                        <th key={r.id} className="border p-2 bg-muted text-center text-xs min-w-[120px]">
                          <div>{r.name}</div>
                          <div className="font-normal text-muted-foreground">{r.templateName}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.outputKeys.map((key: string) => (
                      <tr key={key}>
                        <td className="border p-2 font-medium text-xs bg-muted/50 sticky left-0">
                          {comparison.outputLabels[key] || key}
                        </td>
                        {comparison.runs.map((r: any) => (
                          <td key={r.id} className="border p-2 text-center text-xs font-mono">
                            {r.outputValues?.[key] ?? "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {comparison.inputKeys.length > 0 && (
                      <tr>
                        <td colSpan={comparison.runs.length + 1} className="border p-2 bg-muted text-xs font-medium">
                          Input Differences
                        </td>
                      </tr>
                    )}
                    {comparison.inputKeys.map((key: string) => {
                      const values = comparison.runs.map((r: any) => r.inputValues?.[key]);
                      const allSame = values.every((v: any) => String(v) === String(values[0]));
                      if (allSame) return null;
                      return (
                        <tr key={`input-${key}`}>
                          <td className="border p-2 text-xs text-muted-foreground sticky left-0">
                            {comparison.inputLabels[key] || key}
                          </td>
                          {comparison.runs.map((r: any) => (
                            <td key={r.id} className="border p-2 text-center text-xs font-mono bg-yellow-50/50 dark:bg-yellow-900/10">
                              {r.inputValues?.[key] ?? "—"}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BatchRunPanel() {
  const { toast } = useToast();
  const [templateId, setTemplateId] = useState("");
  const [scenarios, setScenarios] = useState<Array<{ name: string; inputs: Record<string, string> }>>([
    { name: "Scenario 1", inputs: {} },
  ]);
  const [results, setResults] = useState<any>(null);

  const { data: templates } = useQuery<ExcelTemplate[]>({ queryKey: ["/api/models/templates"] });

  const selectedTemplate = templates?.find(t => t.id === templateId);
  const inputMapping: Record<string, any> = selectedTemplate ? JSON.parse(selectedTemplate.inputMapping || "{}") : {};
  const inputKeys = Object.keys(inputMapping);

  const addScenario = () => {
    if (scenarios.length >= 20) return;
    setScenarios(prev => [...prev, { name: `Scenario ${prev.length + 1}`, inputs: {} }]);
  };

  const removeScenario = (index: number) => {
    if (scenarios.length <= 1) return;
    setScenarios(prev => prev.filter((_, i) => i !== index));
  };

  const updateScenarioName = (index: number, name: string) => {
    setScenarios(prev => prev.map((s, i) => i === index ? { ...s, name } : s));
  };

  const updateScenarioInput = (index: number, key: string, value: string) => {
    setScenarios(prev => prev.map((s, i) => i === index ? { ...s, inputs: { ...s.inputs, [key]: value } } : s));
  };

  const batchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/models/templates/${templateId}/batch-run`, { scenarios });
      return res.json();
    },
    onSuccess: (data) => {
      setResults(data);
      queryClient.invalidateQueries({ queryKey: ["/api/models/runs"] });
      toast({ title: `${data.runs?.length || 0} batch runs completed` });
    },
    onError: (err: any) => {
      toast({ title: "Batch run failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <Zap className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <CardTitle>Batch Runs</CardTitle>
              <CardDescription>Run up to 20 scenarios at once against a template</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-1 block">Template</Label>
            <Select value={templateId} onValueChange={(v) => { setTemplateId(v); setResults(null); setScenarios([{ name: "Scenario 1", inputs: {} }]); }}>
              <SelectTrigger data-testid="select-batch-template"><SelectValue placeholder="Select template" /></SelectTrigger>
              <SelectContent>
                {templates?.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {templateId && inputKeys.length > 0 && (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Scenarios ({scenarios.length}/20)
                  </Label>
                  <Button variant="outline" size="sm" onClick={addScenario} disabled={scenarios.length >= 20} data-testid="button-add-scenario">
                    <Plus className="w-3 h-3 mr-1" />Add
                  </Button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr>
                        <th className="border p-2 bg-muted text-left text-xs min-w-[140px]">Name</th>
                        {inputKeys.map(key => (
                          <th key={key} className="border p-2 bg-muted text-center text-xs min-w-[100px]">
                            {inputMapping[key]?.label || key}
                          </th>
                        ))}
                        <th className="border p-2 bg-muted text-center text-xs w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarios.map((scenario, i) => (
                        <tr key={i}>
                          <td className="border p-1">
                            <Input
                              value={scenario.name}
                              onChange={e => updateScenarioName(i, e.target.value)}
                              className="h-7 text-xs"
                              data-testid={`input-scenario-name-${i}`}
                            />
                          </td>
                          {inputKeys.map(key => (
                            <td key={key} className="border p-1">
                              <Input
                                value={scenario.inputs[key] || ""}
                                onChange={e => updateScenarioInput(i, key, e.target.value)}
                                placeholder={inputMapping[key]?.type === "percent" ? "%" : "value"}
                                className="h-7 text-xs font-mono"
                                data-testid={`input-scenario-${i}-${key}`}
                              />
                            </td>
                          ))}
                          <td className="border p-1 text-center">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeScenario(i)} disabled={scenarios.length <= 1} data-testid={`button-remove-scenario-${i}`}>
                              <Minus className="w-3 h-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <Button
                onClick={() => batchMutation.mutate()}
                disabled={batchMutation.isPending || scenarios.length === 0}
                data-testid="button-run-batch"
              >
                {batchMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running {scenarios.length} scenarios...</>
                ) : (
                  <><Zap className="w-4 h-4 mr-2" />Run Batch ({scenarios.length} scenarios)</>
                )}
              </Button>
            </>
          )}

          {templateId && inputKeys.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">This template has no mapped inputs. Upload or configure input mappings first.</p>
          )}

          {results && (
            <div className="space-y-4 mt-4">
              <Separator />
              <h4 className="font-medium">Batch Results</h4>
              {results.summary && (
                <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">{results.summary}</p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      <th className="border p-2 bg-muted text-left text-xs sticky left-0">Output</th>
                      {results.runs?.map((r: any) => (
                        <th key={r.id} className="border p-2 bg-muted text-center text-xs min-w-[120px]">{r.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(results.outputLabels || {}).map(([key, label]: [string, any]) => (
                      <tr key={key}>
                        <td className="border p-2 font-medium text-xs bg-muted/50 sticky left-0">{label}</td>
                        {results.runs?.map((r: any) => (
                          <td key={r.id} className="border p-2 text-center text-xs font-mono">{r.outputs?.[key] ?? "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DependencyMap({ templateId, templateName }: { templateId: string; templateName: string }) {
  const [open, setOpen] = useState(false);

  const { data: deps, isLoading } = useQuery<any>({
    queryKey: ["/api/models/templates", templateId, "dependencies"],
    enabled: open,
  });

  return (
    <>
      <Button variant="ghost" size="icon" className="h-7 w-7" title="Formula Dependency Map" onClick={() => setOpen(true)} data-testid={`button-dependency-map-${templateId}`}>
        <Network className="w-3.5 h-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Network className="w-5 h-5 text-violet-600" />
              Formula Dependency Map
            </DialogTitle>
            {deps && (
              <p className="text-sm text-muted-foreground">
                {deps.totalInputs} inputs → {deps.totalFormulas} formulas → {deps.totalOutputs} outputs
              </p>
            )}
          </DialogHeader>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : deps?.dependencies ? (
            <div className="space-y-4">
              {deps.dependencies.map((dep: any, i: number) => (
                <div key={i} className="border rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-300 border-0">
                      OUTPUT
                    </Badge>
                    <span className="text-sm font-medium">{dep.output.label}</span>
                    <span className="text-xs text-muted-foreground font-mono">{dep.output.cell}</span>
                  </div>

                  {dep.chain.length > 0 && (
                    <div className="ml-4 mb-2 space-y-1">
                      {dep.chain.slice(0, 3).map((step: any, j: number) => (
                        <div key={j} className="flex items-center gap-2 text-xs">
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          <span className="font-mono text-muted-foreground">{step.cell}</span>
                          <span className="text-muted-foreground truncate max-w-[300px]">{step.formula}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {dep.inputs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 ml-4">
                      <ArrowRight className="w-3 h-3 text-muted-foreground mt-1" />
                      {dep.inputs.map((inp: any, k: number) => (
                        <Badge key={k} variant="outline" className="text-[10px] bg-green-500/5">
                          {inp.label} ({inp.cell})
                        </Badge>
                      ))}
                    </div>
                  )}

                  {dep.inputs.length === 0 && dep.chain.length === 0 && (
                    <p className="text-xs text-muted-foreground ml-4">No direct input dependencies traced</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No dependency data available</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function VersionHistory({ templateId }: { templateId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/models/templates", templateId, "versions"],
    enabled: open,
  });

  return (
    <>
      <Button variant="ghost" size="icon" className="h-7 w-7" title="Version History" onClick={() => setOpen(true)} data-testid={`button-versions-${templateId}`}>
        <History className="w-3.5 h-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-amber-600" />
              Version History
            </DialogTitle>
          </DialogHeader>
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : data?.versions?.length > 0 ? (
            <div className="space-y-2">
              {data.versions.map((v: any) => (
                <div
                  key={v.id}
                  className={`flex items-center justify-between p-2 rounded-md text-sm ${
                    v.isCurrent ? "bg-primary/10 border border-primary/20" : "bg-muted/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={v.isCurrent ? "default" : "outline"} className="text-[10px]">
                      v{v.version}
                    </Badge>
                    <span className="font-medium">{v.name}</span>
                    {v.isCurrent && <span className="text-[10px] text-primary">(current)</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {v.createdAt ? new Date(v.createdAt).toLocaleDateString() : ""}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Single version — no history yet</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ClaudeModelStudio() {
  const { toast } = useToast();
  const [description, setDescription] = useState("");
  const [modelType, setModelType] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  const [conversation, setConversation] = useState<Array<{ role: "user" | "ai"; text: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<Array<{ role: "user" | "ai"; text: string }>>([]);

  const handleFiles = (newFiles: FileList | File[]) => {
    const accepted = Array.from(newFiles);
    if (accepted.length === 0) return;
    setFiles(prev => [...prev, ...accepted].slice(0, 10));
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      let startRes: Response;
      const authHeaders = getAuthHeaders();
      if (files.length > 0) {
        const formData = new FormData();
        formData.append("description", description.trim());
        if (modelType) formData.append("modelType", modelType);
        formData.append("useAdvanced", "true");
        files.forEach(f => formData.append("documents", f));
        startRes = await fetch("/api/models/create-model", {
          method: "POST",
          body: formData,
          headers: { ...authHeaders },
          credentials: "include",
        });
      } else {
        startRes = await fetch("/api/models/create-model", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          credentials: "include",
          body: JSON.stringify({
            description: description.trim(),
            modelType: modelType || undefined,
            useAdvanced: true,
          }),
        });
      }
      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}));
        throw new Error(err.message || "Failed to start model creation");
      }
      const { jobId } = await startRes.json();
      if (!jobId) throw new Error("Failed to start model creation");

      const maxWait = 300000;
      const pollInterval = 3000;
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, pollInterval));
        const pollRes = await fetch(`/api/models/create-model/status/${jobId}`, { headers: { ...authHeaders }, credentials: "include" });
        if (!pollRes.ok) {
          if (pollRes.status === 401) throw new Error("Session expired. Please refresh the page and try again.");
          continue;
        }
        const status = await pollRes.json();
        if (status.status === "done") return status.result;
        if (status.status === "error") throw new Error(status.message || "Model creation failed");
      }
      throw new Error("Model creation timed out. Please try a simpler description.");
    },
    onSuccess: (data: any) => {
      toast({
        title: "Model created!",
        description: `"${data.name}" with ${data.sheetsCreated?.length || 0} sheets has been saved as a template.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/models/templates"] });
      setDescription("");
      setModelType("");
      setFiles([]);
    },
    onError: (err: any) => {
      toast({ title: "Failed to create model", description: err.message, variant: "destructive" });
    },
  });

  const askMutation = useMutation({
    mutationFn: async (q: string) => {
      const res = await apiRequest("POST", "/api/models/claude-agent", {
        question: q,
        conversationHistory: conversationRef.current,
      });
      return res.json();
    },
    onSuccess: (data: { answer: string; question: string; toolsUsed?: string[] }) => {
      const newMessages: Array<{ role: "user" | "ai"; text: string }> = [
        { role: "user", text: data.question },
        { role: "ai", text: data.answer },
      ];
      setConversation((prev) => [...prev, ...newMessages]);
      conversationRef.current = [...conversationRef.current, ...newMessages];
      setDescription("");

      if (data.toolsUsed?.some(t => ["update_cells", "add_sheet", "delete_sheet", "rename_template", "duplicate_template", "update_mappings", "create_model"].includes(t))) {
        queryClient.invalidateQueries({ queryKey: ["/api/models/templates"] });
        queryClient.invalidateQueries({ queryKey: ["/api/models/runs"] });
      }

      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 100);
    },
    onError: (err: any) => {
      toast({ title: "Failed to get answer", description: err.message, variant: "destructive" });
    },
  });

  const handleAsk = () => {
    if (!description.trim() || askMutation.isPending) return;
    askMutation.mutate(description.trim());
  };

  const handleClearConversation = () => {
    setConversation([]);
    conversationRef.current = [];
    setDescription("");
  };

  const presets = [
    { label: "BGP Investment Appraisal (DCF)", desc: "A discounted cash flow model for a commercial property investment with 10-year hold period, rental income, exit cap rate, IRR and equity multiple calculations" },
    { label: "BGP Development Appraisal", desc: "A property development appraisal with land cost, build costs, professional fees, finance costs, GDV, profit on cost, and development yield" },
    { label: "BGP Rent Review / Lease Analysis", desc: "A rent review analysis comparing passing rent to ERV with uplift calculations, lease terms, break options, and effective rent calculation" },
    { label: "BGP Portfolio Summary", desc: "A portfolio summary model tracking multiple properties with rental income, yields, void rates, WAULT, and total portfolio valuation" },
    { label: "BGP Acquisition Comparison", desc: "A side-by-side acquisition comparison for 3 properties comparing purchase price, net initial yield, reversionary yield, capital value per sq ft, and risk scoring" },
    { label: "BGP Tenant Covenant Analysis", desc: "A tenant covenant analysis model with financials (revenue, profit, net assets), house covenant grade (CH + Gazette), and covenant strength grading" },
  ];

  const isBusy = createMutation.isPending || askMutation.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <CardTitle>Claude Studio</CardTitle>
              <CardDescription>Create new models, ask questions, edit formulas, and manage templates</CardDescription>
            </div>
          </div>
          {conversation.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClearConversation} data-testid="button-claude-clear">
              <X className="w-3.5 h-3.5 mr-1" />
              Clear chat
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Quick Start — Choose a Template Type</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {presets.map((p, i) => (
              <div
                key={i}
                className={`p-3 rounded-lg border cursor-pointer transition-all text-sm hover:border-primary/40 hover:bg-accent ${
                  description === p.desc ? "border-primary bg-primary/5" : "border-border"
                }`}
                onClick={() => { setDescription(p.desc); setModelType(p.label); }}
                data-testid={`preset-model-${i}`}
              >
                <div className="font-medium text-xs">{p.label}</div>
                <div className="text-muted-foreground text-xs mt-1 line-clamp-2">{p.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {conversation.length > 0 && (
          <>
            <Separator />
            <div ref={scrollRef} className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
              {conversation.map((msg, i) => (
                <div
                  key={i}
                  className={`text-sm ${msg.role === "user" ? "text-right" : ""}`}
                >
                  {msg.role === "user" ? (
                    <div className="inline-block p-2.5 rounded-lg bg-primary text-primary-foreground max-w-[85%] text-left">
                      {msg.text}
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <div className="w-6 h-6 rounded-full bg-green-500/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-3.5 h-3.5 text-green-600" />
                      </div>
                      <div className="p-3 rounded-lg bg-muted whitespace-pre-wrap flex-1">
                        {msg.text}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {askMutation.isPending && (
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-full bg-green-500/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5 text-green-600" />
                  </div>
                  <div className="p-3 rounded-lg bg-muted flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-green-600" />
                    <span className="text-xs text-muted-foreground">Claude is working...</span>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div
          className={`relative rounded-lg border transition-colors ${dragging ? "border-primary bg-primary/5" : "border-input"}`}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
          onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
          onDrop={(e) => {
            e.preventDefault(); e.stopPropagation(); setDragging(false);
            if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
          }}
        >
          <Textarea
            id="model-description"
            placeholder={conversation.length > 0
              ? "Ask Claude anything — edit formulas, add sheets, update values, or create a new model..."
              : "Describe the model you need, or ask Claude a question about your existing models..."
            }
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAsk();
              }
            }}
            className="min-h-[80px] text-sm border-0 focus-visible:ring-0 resize-none"
            data-testid="input-create-model-description"
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-attach-files"
              >
                <FileUp className="w-3.5 h-3.5 mr-1" />
                Attach files
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ""; }}
                data-testid="input-create-model-files"
              />
              {dragging && <span className="text-xs text-primary font-medium">Drop files here</span>}
            </div>
            <span className="text-[10px] text-muted-foreground">Excel, PDF, Word, CSV, images</span>
          </div>
        </div>

        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <Badge key={i} variant="secondary" className="text-xs gap-1 pr-1" data-testid={`badge-file-${i}`}>
                <FileUp className="w-3 h-3" />
                {f.name.length > 25 ? f.name.slice(0, 22) + "..." : f.name}
                <Button variant="ghost" size="icon" className="h-4 w-4 ml-0.5 hover:bg-destructive/20" onClick={() => removeFile(i)} data-testid={`button-remove-file-${i}`}>
                  <X className="w-2.5 h-2.5" />
                </Button>
              </Badge>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!description.trim() || isBusy}
            className="flex-1"
            size="lg"
            data-testid="button-create-model"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Building model...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Create Model{files.length > 0 ? ` (${files.length} file${files.length > 1 ? "s" : ""})` : ""}
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleAsk}
            disabled={!description.trim() || isBusy}
            size="lg"
            data-testid="button-claude-send"
          >
            {askMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Ask Claude
              </>
            )}
          </Button>
        </div>

        {createMutation.isPending && (
          <p className="text-xs text-muted-foreground text-center">
            This usually takes 30-60 seconds — Claude is writing all the formulas and building the spreadsheet
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MemoButton({ runId, runName }: { runId: string; runName: string }) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/models/runs/${runId}/memo`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to generate memo");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${runName.replace(/[^a-zA-Z0-9 _-]/g, "_")}_Memo.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Investment memo downloaded" });
    } catch (err: any) {
      toast({ title: "Memo generation failed", description: err?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleDownload} disabled={loading} data-testid="button-memo">
      {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />}
      {loading ? "Generating..." : "Investment Memo"}
    </Button>
  );
}

export default function ModelsPage() {
  const [addinBannerDismissed, setAddinBannerDismissed] = useState(() =>
    localStorage.getItem("chatbgp-excel-banner-dismissed") === "1"
  );

  const { data: templates, isLoading: templatesLoading } = useQuery<(ExcelTemplate & { sheetCount?: number })[]>({
    queryKey: ["/api/models/templates"],
  });

  const { data: runs, isLoading: runsLoading } = useQuery<(ExcelModelRun & { templateName?: string | null })[]>({
    queryKey: ["/api/models/runs"],
  });

  const dismissBanner = () => {
    localStorage.setItem("chatbgp-excel-banner-dismissed", "1");
    setAddinBannerDismissed(true);
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Model Studio</h1>
          <p className="text-muted-foreground">Upload Excel models, run scenarios, and analyse results</p>
        </div>
        <TemplateUpload />
      </div>

      {!addinBannerDismissed && (
        <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3" data-testid="banner-excel-addin">
          <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Get ChatBGP inside Excel</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Install the ChatBGP Excel add-in to get AI-powered formula help, financial modelling, and CRM data lookups directly in your spreadsheets — no need to switch tabs.
            </p>
            <a
              href="/addins"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline mt-1.5"
              data-testid="link-install-addin"
            >
              <FileSpreadsheet className="w-3 h-3" />
              Open in Add-ins
              <ArrowRight className="w-3 h-3" />
            </a>
          </div>
          <button
            onClick={dismissBanner}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            data-testid="button-dismiss-addin-banner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <Tabs defaultValue="ask-claude">
        <TabsList data-testid="tabs-models" className={pillTabsList}>
          <TabsTrigger value="ask-claude" className={pillTabsTrigger} data-testid="tab-ask-claude">
            Claude Studio
          </TabsTrigger>
          <TabsTrigger value="templates" className={pillTabsTrigger} data-testid="tab-templates">
            Templates <span className="font-mono normal-case opacity-70">{templates?.length || 0}</span>
          </TabsTrigger>
          <TabsTrigger value="runs" className={pillTabsTrigger} data-testid="tab-runs">
            Runs <span className="font-mono normal-case opacity-70">{runs?.length || 0}</span>
          </TabsTrigger>
          <TabsTrigger value="smart-run" data-testid="tab-smart-run">
            <Sparkles className="w-3.5 h-3.5 mr-1" />
            Smart Run
          </TabsTrigger>
          <TabsTrigger value="sensitivity" data-testid="tab-sensitivity">
            <BarChart3 className="w-3.5 h-3.5 mr-1" />
            Sensitivity
          </TabsTrigger>
          <TabsTrigger value="compare" data-testid="tab-compare">
            <GitCompare className="w-3.5 h-3.5 mr-1" />
            Compare
          </TabsTrigger>
          <TabsTrigger value="batch" data-testid="tab-batch">
            <Zap className="w-3.5 h-3.5 mr-1" />
            Batch
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ask-claude" className="mt-4 space-y-6">
          <ClaudeModelStudio />
        </TabsContent>

        <TabsContent value="templates" className="space-y-4 mt-4">
          {templatesLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : templates && templates.length > 0 ? (
            templates.map((t) => <TemplateCard key={t.id} template={t} />)
          ) : (
            <EmptyState
              icon={FileSpreadsheet}
              title="No models yet"
              description="Upload an Excel property model to get started. The system will detect the inputs and outputs automatically."
            />
          )}
        </TabsContent>

        <TabsContent value="runs" className="space-y-4 mt-4">
          {runsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : runs && runs.length > 0 ? (
            runs.map((r) => <RunCard key={r.id} run={r} />)
          ) : (
            <EmptyState
              icon={TrendingUp}
              title="No model runs yet"
              description="Select a template and run a model with your property inputs to see results here."
            />
          )}
        </TabsContent>

        <TabsContent value="smart-run" className="mt-4">
          <SmartRunPanel />
        </TabsContent>

        <TabsContent value="sensitivity" className="mt-4">
          <SensitivityPanel />
        </TabsContent>

        <TabsContent value="compare" className="mt-4">
          <ComparePanel />
        </TabsContent>

        <TabsContent value="batch" className="mt-4">
          <BatchRunPanel />
        </TabsContent>

      </Tabs>
    </div>
  );
}
