import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
  DollarSign,
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
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ExcelTemplate, ExcelModelRun } from "@shared/schema";
import bgpLogoDark from "@assets/BGP_BlackHolder_1771853582461.png";
import type { CrmProperty } from "@shared/schema";
import { EmptyState } from "@/components/empty-state";

interface TemplateWithMeta extends Omit<ExcelTemplate, "inputMapping" | "outputMapping"> {
  inputMapping: Record<string, InputField>;
  outputMapping: Record<string, OutputField>;
  analysis?: { sheets: { name: string; rows: number; cols: number }[]; properties: string[] };
  sampleOutputs?: Record<string, any>;
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

function OpenInExcelButton({ runId, runName, iconOnly }: { runId: string; runName?: string; iconOnly?: boolean }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleOpenInExcel = async () => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", `/api/models/runs/${runId}/open-in-excel`);
      const data = await res.json();
      if (data.webUrl) {
        window.open(data.webUrl, "_blank");
        toast({ title: "Opening in Excel", description: `${runName || "Model"} synced to SharePoint and opening in Excel` });
      }
    } catch (err: any) {
      toast({ title: "Could not open in Excel", description: err?.message || "SharePoint connection required", variant: "destructive" });
    }
    setLoading(false);
  };

  if (iconOnly) {
    return (
      <Button variant="ghost" size="icon" className="h-7 w-7" title="Open in Excel (via SharePoint)"
        onClick={handleOpenInExcel} disabled={loading}
        data-testid={`button-open-excel-${runId}`}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
      </Button>
    );
  }

  return (
    <Button variant="default" size="sm" onClick={handleOpenInExcel} disabled={loading}
      data-testid={`button-open-excel-${runId}`}
    >
      {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-1" />}
      Open in Excel
    </Button>
  );
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
          Upload Template
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
            {uploadMutation.isPending ? "Uploading..." : "Upload Template"}
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
  const groups = Object.entries(inputMapping).reduce<Record<string, { key: string; field: InputField }[]>>((acc, [key, field]) => {
    const g = field.group || "Other";
    if (!acc[g]) acc[g] = [];
    acc[g].push({ key, field });
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="run-name">Run Name</Label>
        <Input
          id="run-name"
          placeholder="e.g. Chelsea Retail Q1 2025"
          value={runName}
          onChange={(e) => setRunName(e.target.value)}
          data-testid="input-run-name"
        />
      </div>

      {Object.entries(groups).map(([groupName, fields]) => (
        <div key={groupName}>
          <h4 className="text-sm font-medium text-muted-foreground mb-3">{groupName}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {fields.map(({ key, field }) => (
              <div key={key}>
                <Label htmlFor={`input-${key}`} className="text-xs">
                  {field.label}
                </Label>
                <Input
                  id={`input-${key}`}
                  type={field.type === "text" ? "text" : "number"}
                  step={field.type === "percent" ? "0.1" : "1"}
                  placeholder={field.type === "percent" ? "e.g. 5" : field.type === "number" ? "e.g. 72000" : ""}
                  value={inputValues[key] || ""}
                  onChange={(e) => setInputValues((prev) => ({ ...prev, [key]: e.target.value }))}
                  data-testid={`input-field-${key}`}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <Separator />

      <Button
        onClick={() => createRunMutation.mutate()}
        disabled={createRunMutation.isPending}
        className="w-full"
        data-testid="button-run-model"
      >
        {createRunMutation.isPending ? (
          "Running Model..."
        ) : (
          <>
            <Play className="w-4 h-4 mr-2" />
            Run Model
          </>
        )}
      </Button>
    </div>
  );
}

function OutputCard({ outputs, mapping }: { outputs: Record<string, any>; mapping: Record<string, OutputField> }) {
  const groups = Object.entries(mapping).reduce<Record<string, { key: string; field: OutputField; value: any }[]>>(
    (acc, [key, field]) => {
      const g = field.group || "Other";
      if (!acc[g]) acc[g] = [];
      acc[g].push({ key, field, value: outputs[key] });
      return acc;
    },
    {}
  );

  const getIcon = (group: string) => {
    switch (group) {
      case "Returns": return <TrendingUp className="w-4 h-4" />;
      case "Yields": return <Percent className="w-4 h-4" />;
      case "Property": return <Building2 className="w-4 h-4" />;
      default: return <DollarSign className="w-4 h-4" />;
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Object.entries(groups).map(([groupName, fields]) => (
        <Card key={groupName}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {getIcon(groupName)}
              {groupName}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {fields.map(({ key, field, value }) => (
                <div key={key} className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">{field.label}</span>
                  <span className="font-mono font-medium" data-testid={`output-${key}`}>
                    {value !== null && value !== undefined ? String(value) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
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

      <div className="flex border-b">
        <button
          onClick={() => setActiveTab("summary")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === "summary" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-summary"
        >
          <BarChart3 className="w-3.5 h-3.5 inline mr-1.5" />
          Summary
        </button>
        <button
          onClick={() => setActiveTab("excel")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${activeTab === "excel" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          data-testid="tab-excel"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 inline mr-1.5" />
          Excel Model
        </button>
      </div>

      {activeTab === "summary" && (
        <div className="space-y-6">
          {run.outputValues && (
            <OutputCard outputs={run.outputValues} mapping={run.outputMapping || {}} />
          )}

          {run.inputValues && Object.keys(run.inputValues).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  Input Assumptions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                  {Object.entries(run.inputValues).map(([key, value]) => {
                    const fieldLabel = run.inputMapping?.[key]?.label || key;
                    return (
                      <div key={key} className="flex justify-between">
                        <span className="text-muted-foreground">{fieldLabel}:</span>
                        <span className="font-medium">{String(value)}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
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

function ModelDashboard({ outputs, mapping }: {
  outputs: Record<string, any>;
  mapping: Record<string, OutputField>;
}) {
  const groups = Object.entries(mapping).reduce<Record<string, { key: string; field: OutputField; value: any }[]>>(
    (acc, [key, field]) => {
      const g = field.group || "Other";
      if (!acc[g]) acc[g] = [];
      acc[g].push({ key, field, value: outputs[key] });
      return acc;
    },
    {}
  );

  const groupOrder = ["Returns", "Yields", "Property"];
  const sortedGroups = Object.entries(groups).sort(([a], [b]) => {
    const ai = groupOrder.indexOf(a);
    const bi = groupOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const getGroupColor = (group: string) => {
    switch (group) {
      case "Returns": return "border-l-green-500 bg-green-50/50 dark:bg-green-950/20";
      case "Yields": return "border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20";
      case "Property": return "border-l-orange-500 bg-orange-50/50 dark:bg-orange-950/20";
      default: return "border-l-gray-400 bg-muted/30";
    }
  };

  const getValueColor = (group: string) => {
    switch (group) {
      case "Returns": return "text-green-700 dark:text-green-400";
      case "Yields": return "text-blue-700 dark:text-blue-400";
      case "Property": return "text-orange-700 dark:text-orange-400";
      default: return "text-foreground";
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {sortedGroups.map(([groupName, fields]) => (
        <div key={groupName} className={`rounded-md border border-l-4 p-3 ${getGroupColor(groupName)}`}>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">{groupName}</p>
          <div className="space-y-1.5">
            {fields.map(({ key, field, value }) => (
              <div key={key} className="flex justify-between items-baseline gap-2" data-testid={`metric-${key}`}>
                <span className="text-xs text-muted-foreground truncate">{field.label}</span>
                <span className={`text-sm font-semibold font-mono tabular-nums flex-shrink-0 ${getValueColor(groupName)}`}>
                  {value !== null && value !== undefined && value !== "" ? String(value) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
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
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
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

  const { data, isLoading, refetch } = useQuery<{
    sheetNames: string[];
    activeSheet: string;
    totalRows: number;
    totalCols: number;
    rows: (null | { v: any; f?: string; t: string; w?: string })[][];
    merges: { r: number; c: number; rs: number; cs: number }[];
    inputCells: string[];
    outputCells: string[];
  }>({
    queryKey: [endpoint, activeSheet],
    queryFn: async () => {
      const url = activeSheet ? `${endpoint}?sheet=${encodeURIComponent(activeSheet)}` : endpoint;
      const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: open,
  });

  const colLetter = (c: number) => {
    let s = "";
    let n = c;
    while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
    return s;
  };

  const inputSet = new Set(data?.inputCells || []);
  const outputSet = new Set(data?.outputCells || []);

  const mergeMap = new Map<string, { rs: number; cs: number }>();
  const hiddenCells = new Set<string>();
  if (data?.merges) {
    for (const m of data.merges) {
      mergeMap.set(`${m.r}-${m.c}`, { rs: m.rs, cs: m.cs });
      for (let dr = 0; dr < m.rs; dr++) {
        for (let dc = 0; dc < m.cs; dc++) {
          if (dr !== 0 || dc !== 0) hiddenCells.add(`${m.r + dr}-${m.c + dc}`);
        }
      }
    }
  }

  const formatVal = (cell: { v: any; f?: string; t: string; w?: string } | null) => {
    if (!cell) return "";
    if (cell.w) return cell.w;
    if (cell.t === "n" && typeof cell.v === "number") {
      if (Math.abs(cell.v) < 1 && cell.v !== 0) return `${(cell.v * 100).toFixed(1)}%`;
      return cell.v.toLocaleString("en-GB", { maximumFractionDigits: 2 });
    }
    return String(cell.v ?? "");
  };

  const rawVal = (cell: { v: any; f?: string; t: string; w?: string } | null) => {
    if (!cell) return "";
    if (cell.f) return `=${cell.f}`;
    return cell.v !== undefined ? String(cell.v) : "";
  };

  const saveCell = async (cellRef: string, value: string) => {
    if (!editable || !data?.activeSheet) return;
    setSaving(true);
    try {
      await apiRequest("POST", endpoint, {
        sheet: data.activeSheet,
        cell: cellRef,
        value,
      });
      await refetch();
      toast({ title: "Cell updated", description: `${cellRef} = ${value || "(empty)"}` });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err?.message, variant: "destructive" });
    }
    setSaving(false);
    setEditingCell(null);
  };

  const handleCellClick = (cellRef: string, cell: any) => {
    setSelectedCell(cellRef);
    if (editable) {
      setEditingCell(cellRef);
      setEditValue(rawVal(cell));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, cellRef: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveCell(cellRef, editValue);
    } else if (e.key === "Escape") {
      setEditingCell(null);
    } else if (e.key === "Tab") {
      e.preventDefault();
      saveCell(cellRef, editValue);
    }
  };

  const metricGroups = outputMapping && outputs ? Object.entries(outputMapping).reduce<Record<string, { key: string; field: OutputField; value: any }[]>>(
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

          {data?.sheetNames && (
            <div className="flex gap-0.5 px-3 pb-1 flex-shrink-0 overflow-x-auto border-b">
              {data.sheetNames.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={(data.activeSheet === s) ? "default" : "ghost"}
                  className="text-[11px] h-6 px-2 whitespace-nowrap rounded-sm"
                  onClick={() => { setActiveSheet(s); setEditingCell(null); setSelectedCell(null); }}
                  data-testid={`button-sheet-${s}`}
                >
                  {s}
                </Button>
              ))}
            </div>
          )}

          {selectedCell && (
            <div className="flex items-center gap-2 px-3 py-0.5 bg-muted/50 border-b text-[11px] flex-shrink-0">
              <Badge variant="secondary" className="font-mono text-[10px] h-5 px-1.5">{selectedCell}</Badge>
              <span className="text-muted-foreground font-mono truncate">
                {editingCell === selectedCell ? editValue : data?.rows && (() => {
                  const match = selectedCell.match(/^([A-Z]+)(\d+)$/);
                  if (!match) return "";
                  const col = match[1].split("").reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;
                  const row = parseInt(match[2]) - 1;
                  const cell = data.rows[row]?.[col];
                  return cell?.f ? `=${cell.f}` : formatVal(cell);
                })()}
              </span>
            </div>
          )}

          <div className="flex flex-1 min-h-0">
            <div className="flex-1 overflow-auto min-h-0">
              {isLoading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full rounded-lg" />
                  ))}
                </div>
              ) : data?.rows ? (
                <table className="border-collapse text-[11px] font-mono">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-muted">
                      <th className="border border-border px-0.5 py-0 text-center text-muted-foreground w-8 sticky left-0 bg-muted z-20 text-[9px]"></th>
                      {data.rows[0]?.map((_, ci) => (
                        <th key={ci} className="border border-border px-1 py-0 text-center text-muted-foreground font-normal text-[9px]" style={{ minWidth: ci === 0 ? "140px" : "60px" }}>
                          {colLetter(ci)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, ri) => (
                      <tr key={ri} className="hover:bg-muted/20">
                        <td className="border border-border px-0.5 py-0 text-center text-muted-foreground bg-muted sticky left-0 z-10 text-[9px]">
                          {ri + 1}
                        </td>
                        {row.map((cell, ci) => {
                          const key = `${ri}-${ci}`;
                          if (hiddenCells.has(key)) return null;
                          const merge = mergeMap.get(key);
                          const cellRef = `${colLetter(ci)}${ri + 1}`;
                          const isInput = inputSet.has(cellRef);
                          const isOutput = outputSet.has(cellRef);
                          const isFormula = !!cell?.f;
                          const isNumber = cell?.t === "n";
                          const hasContent = cell && (cell.v !== undefined && cell.v !== "" && cell.v !== null);
                          const isBold = hasContent && typeof cell?.v === "string" && (ri < 3 || cell.v === cell.v.toUpperCase());
                          const isEditing = editingCell === cellRef;
                          const isSelected = selectedCell === cellRef;

                          return (
                            <td
                              key={ci}
                              rowSpan={merge?.rs}
                              colSpan={merge?.cs}
                              title={cell?.f ? `=${cell.f}` : undefined}
                              onClick={() => handleCellClick(cellRef, cell)}
                              className={`border px-1 py-0 whitespace-nowrap cursor-cell leading-tight ${
                                isSelected ? "border-blue-500 border-2" :
                                isInput ? "border-blue-300 bg-blue-50 dark:bg-blue-950" :
                                isOutput ? "border-green-300 bg-green-50 dark:bg-green-950" :
                                isFormula ? "border-border bg-gray-50/50 dark:bg-gray-900/50" : "border-border"
                              } ${isNumber && !isEditing ? "text-right" : ""} ${isBold ? "font-semibold" : "font-normal"}`}
                              data-testid={`cell-${cellRef}`}
                            >
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onKeyDown={(e) => handleKeyDown(e, cellRef)}
                                  onBlur={() => saveCell(cellRef, editValue)}
                                  autoFocus
                                  className="w-full bg-white dark:bg-gray-900 outline-none border-none text-[11px] font-mono p-0 m-0"
                                  data-testid={`input-cell-${cellRef}`}
                                />
                              ) : (
                                formatVal(cell)
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                          {value !== null && value !== undefined ? String(value) : "—"}
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
              <span>{data?.totalRows || 0}r x {data?.totalCols || 0}c</span>
              {inputSet.size > 0 && (
                <span className="flex items-center gap-0.5">
                  <span className="w-2 h-2 rounded-sm bg-blue-200 border border-blue-400 inline-block" /> {inputSet.size}
                </span>
              )}
              {outputSet.size > 0 && (
                <span className="flex items-center gap-0.5">
                  <span className="w-2 h-2 rounded-sm bg-green-200 border border-green-400 inline-block" /> {outputSet.size}
                </span>
              )}
              {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            </div>
            <span>{editable ? "Click cell to edit · Enter to save · Esc to cancel" : "Read-only"}</span>
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

function TemplateCard({ template }: { template: ExcelTemplate }) {
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/models/templates/${template.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/models/templates"] });
      toast({ title: "Template deleted" });
    },
  });

  const { data: templateDetail } = useQuery<TemplateWithMeta>({
    queryKey: ["/api/models/templates", template.id],
  });

  const sheetCount = templateDetail?.analysis?.sheets?.length || 0;
  const createdDate = template.createdAt ? new Date(template.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors group"
      onClick={() => window.open(`/api/models/templates/${template.id}/download`, "_blank")}
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
          {createdDate && <> · {createdDate}</>}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Download Excel"
          onClick={() => window.open(`/api/models/templates/${template.id}/download`, "_blank")}
          data-testid={`button-download-template-${template.id}`}
        >
          <Download className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Delete"
          onClick={() => deleteMutation.mutate()}
          data-testid={`button-delete-template-${template.id}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function SmartRunPanel() {
  const { toast } = useToast();
  const [templateId, setTemplateId] = useState("");
  const [runName, setRunName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [step, setStep] = useState<"upload" | "review" | "complete">("upload");

  const { data: templates } = useQuery<ExcelTemplate[]>({
    queryKey: ["/api/models/templates"],
  });

  const extractMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      files.forEach((f) => formData.append("documents", f));
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
            {extractedData.extracted?.summary && (
              <div className="p-3 rounded-lg bg-muted">
                <p className="text-sm font-medium mb-1">Property Summary</p>
                <p className="text-sm text-muted-foreground">{extractedData.extracted.summary}</p>
              </div>
            )}
            {extractedData.outputValues && (
              <>
                <h4 className="font-medium">Model Results</h4>
                <OutputCard
                  outputs={extractedData.outputValues}
                  mapping={Object.entries(extractedData.outputValues).reduce<Record<string, OutputField>>((acc, [key]) => {
                    const defaultOutputs: Record<string, OutputField> = {
                      unleveredIRR: { sheet: "", cell: "", label: "Unlevered IRR", format: "percent", group: "Returns" },
                      leveredPreTaxIRR: { sheet: "", cell: "", label: "Levered Pre-Tax IRR", format: "percent", group: "Returns" },
                      leveredPostTaxIRR: { sheet: "", cell: "", label: "Levered Post-Tax IRR", format: "percent", group: "Returns" },
                      agIRR: { sheet: "", cell: "", label: "AG IRR (Post Promote)", format: "percent", group: "Returns" },
                      unleveredMOIC: { sheet: "", cell: "", label: "Unlevered MOIC", format: "number2", group: "Returns" },
                      leveredPreTaxMOIC: { sheet: "", cell: "", label: "Levered Pre-Tax MOIC", format: "number2", group: "Returns" },
                      agMOIC: { sheet: "", cell: "", label: "AG MOIC (Post Promote)", format: "number2", group: "Returns" },
                      profits: { sheet: "", cell: "", label: "AG Profits (£000s)", format: "number0", group: "Returns" },
                      peakEquity: { sheet: "", cell: "", label: "AG Peak Equity (£000s)", format: "number0", group: "Returns" },
                      griYieldPurchase: { sheet: "", cell: "", label: "GRI Yield on Purchase", format: "percent", group: "Yields" },
                      noiYieldPurchase: { sheet: "", cell: "", label: "NOI Yield on Purchase", format: "percent", group: "Yields" },
                      ervYieldPurchase: { sheet: "", cell: "", label: "ERV Yield on Purchase", format: "percent", group: "Yields" },
                      occupancy: { sheet: "", cell: "", label: "Occupancy (%)", format: "percent", group: "Property" },
                      totalLettableArea: { sheet: "", cell: "", label: "Total Lettable Area (SF)", format: "number0", group: "Property" },
                    };
                    if (defaultOutputs[key]) acc[key] = defaultOutputs[key];
                    return acc;
                  }, {})}
                />
              </>
            )}
            {extractedData.inputValues && Object.keys(extractedData.inputValues).length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Extracted Input Values</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                    {Object.entries(extractedData.inputValues).map(([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <span className="text-muted-foreground">{key}:</span>
                        <span className="font-medium">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
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
                <h4 className="text-sm font-medium mb-3">Extracted Property Data</h4>
                {extractedData.summary && (
                  <div className="p-3 rounded-lg bg-muted mb-3">
                    <p className="text-sm text-muted-foreground">{extractedData.summary}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                  {Object.entries(extractedData)
                    .filter(([key, val]) => val !== null && key !== "summary" && key !== "tenants" && key !== "leaseExpiries")
                    .map(([key, value]) => (
                      <div key={key} className="flex justify-between p-2 rounded bg-accent/50">
                        <span className="text-muted-foreground">{key}:</span>
                        <span className="font-medium">{String(value)}</span>
                      </div>
                    ))}
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

function RunCard({ run }: { run: ExcelModelRun }) {
  const { toast } = useToast();

  const { data: runDetail } = useQuery<RunWithMeta>({
    queryKey: ["/api/models/runs", run.id],
  });

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

  const handleClick = () => {
    if (run.generatedFilePath) {
      window.open(`/api/models/runs/${run.id}/download`, "_blank");
    }
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors group"
      onClick={handleClick}
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
          {runDetail?.templateName || "Model run"}
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
          onClick={() => deleteMutation.mutate()}
          data-testid={`button-delete-run-${run.id}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
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

  const getHeatColor = (value: string) => {
    const num = parseFloat(value?.replace?.(/[%,]/g, "") || "0");
    if (isNaN(num)) return "";
    if (num > 15) return "bg-green-100 dark:bg-green-900/30";
    if (num > 10) return "bg-green-50 dark:bg-green-900/20";
    if (num > 5) return "bg-yellow-50 dark:bg-yellow-900/20";
    if (num > 0) return "bg-orange-50 dark:bg-orange-900/20";
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
                            const firstOutput = match?.outputs ? Object.values(match.outputs)[0] : "—";
                            return (
                              <td key={v2} className={`border p-2 text-center text-xs font-mono ${getHeatColor(String(firstOutput))}`}>
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
                            <td key={k} className={`border p-2 text-center text-xs font-mono ${getHeatColor(String(r.outputs?.[k]))}`}>
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
    { label: "BGP Tenant Covenant Analysis", desc: "A tenant covenant analysis model with financials (revenue, profit, net assets), Dun & Bradstreet score, and covenant strength grading" },
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
              <CardTitle>Claude — Model Studio</CardTitle>
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

  const { data: templates, isLoading: templatesLoading } = useQuery<ExcelTemplate[]>({
    queryKey: ["/api/models/templates"],
  });

  const { data: runs, isLoading: runsLoading } = useQuery<ExcelModelRun[]>({
    queryKey: ["/api/models/runs"],
  });

  const dismissBanner = () => {
    localStorage.setItem("chatbgp-excel-banner-dismissed", "1");
    setAddinBannerDismissed(true);
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Model Generate</h1>
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
              Go to Add-ins to install
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
        <TabsList data-testid="tabs-models" className="flex-wrap h-auto gap-1">
          <TabsTrigger value="ask-claude" data-testid="tab-ask-claude">
            <Sparkles className="w-3.5 h-3.5 mr-1" />
            Claude Studio
          </TabsTrigger>
          <TabsTrigger value="templates" data-testid="tab-templates">
            Templates ({templates?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="runs" data-testid="tab-runs">
            Runs ({runs?.length || 0})
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

      </Tabs>
    </div>
  );
}
