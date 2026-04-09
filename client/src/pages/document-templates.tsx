import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Upload,
  FileText,
  Check,
  Trash2,
  Sparkles,
  Copy,
  Edit3,
  Eye,
  ChevronRight,
  Loader2,
  FileUp,
  ClipboardCheck,
  PenTool,
  Zap,
  X,
  UploadCloud,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  Scale,
  Shield,
  ShieldAlert,
  ShieldCheck,
  FolderPlus,
  CircleDot,
  ChevronDown,
  ChevronUp,
  Bot,
  Send,
  Palette,
  Type,
  Download,
  FileType,
  Presentation,
  Link2,
  Unlink,
  ExternalLink,
  LayoutTemplate,
  Image,
  RefreshCw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import bgpLogoDark from "@assets/BGP_BlackHolder_1771853582461.png";
import DocumentDesigner from "@/components/document-designer";

interface TemplateField {
  id: string;
  label: string;
  type: string;
  placeholder: string;
  section: string;
}

interface TemplateDesign {
  fontFamily?: string;
  fontSize?: string;
  headingFont?: string;
  headingSize?: string;
  headingColor?: string;
  bodyColor?: string;
  accentColor?: string;
  showLogo?: boolean;
  logoPosition?: string;
  headerText?: string;
  footerText?: string;
  pageMargin?: string;
  lineSpacing?: string;
  letterhead?: boolean;
  borderStyle?: string;
  borderColor?: string;
}

interface DocumentTemplate {
  id: string;
  name: string;
  description: string | null;
  sourceFileName: string;
  templateContent: string;
  fields: TemplateField[];
  design?: string;
  status: string;
  canvaDesignId?: string | null;
  canvaEditUrl?: string | null;
  canvaViewUrl?: string | null;
  hasPageImages?: boolean;
  pageImageCount?: number;
  createdAt: string;
}


export default function DocumentTemplates() {
  const { toast } = useToast();
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplate | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [designMode, setDesignMode] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [editedFields, setEditedFields] = useState<TemplateField[]>([]);
  const [editedName, setEditedName] = useState("");
  const [editedDescription, setEditedDescription] = useState("");
  const [useMode, setUseMode] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("smart-generate");
  const [editingRun, setEditingRun] = useState<DocumentRun | null>(null);
  const [autoDesignRun, setAutoDesignRun] = useState(false);
  const [templateDragging, setTemplateDragging] = useState(false);

  const handleDropUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/doc-templates/upload", {
        method: "POST",
        headers: { ...getAuthHeaders() },
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        let errMsg = "Upload failed";
        try {
          const text = await res.text();
          const parsed = JSON.parse(text);
          errMsg = parsed.message || errMsg;
        } catch {}
        throw new Error(errMsg);
      }
      const template = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/doc-templates"] });
      setSelectedTemplate(template);
      setActiveTab("templates");
      toast({ title: "Document analysed", description: "AI has created a template from your document. Review it below." });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("canva") === "connected") {
      toast({ title: "Canva connected!", description: "Your Canva account is now linked. Generated documents will automatically create Canva designs." });
      window.history.replaceState({}, "", window.location.pathname);
      queryClient.invalidateQueries({ queryKey: ["/api/canva/status"] });
    }
    if (params.get("canva_error")) {
      toast({ title: "Canva connection failed", description: "Please try again.", variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const { data: templates, isLoading } = useQuery<DocumentTemplate[]>({
    queryKey: ["/api/doc-templates"],
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;


    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/doc-templates/upload", {
        method: "POST",
        headers: { ...getAuthHeaders() },
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        let errMsg = "Upload failed";
        try {
          const text = await res.text();
          const parsed = JSON.parse(text);
          errMsg = parsed.message || errMsg;
        } catch {}
        throw new Error(errMsg);
      }

      const template = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/doc-templates"] });
      setSelectedTemplate(template);
      setActiveTab("templates");
      toast({ title: "Document analysed", description: "AI has created a template from your document. Review it below." });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/doc-templates/${id}/approve`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/doc-templates"] });
      setSelectedTemplate(data);
      toast({ title: "Template approved", description: "This template is now ready to use." });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await apiRequest("PUT", `/api/doc-templates/${id}`, updates);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/doc-templates"] });
      setSelectedTemplate(data);
      setEditMode(false);
      toast({ title: "Template updated" });
    },
  });

  const canvaDesignMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/doc-templates/${id}/canva-design`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/doc-templates"] });
      setSelectedTemplate(data);
      toast({ title: "Canva design created", description: "Click 'Edit in Canva' to open the design." });
    },
    onError: (err: any) => {
      toast({ title: "Canva design failed", description: err.message || "Could not create Canva design", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/doc-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doc-templates"] });
      setSelectedTemplate(null);
      toast({ title: "Template deleted" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async ({ id, fieldValues }: { id: string; fieldValues: Record<string, string> }) => {
      const res = await apiRequest("POST", `/api/doc-templates/${id}/generate`, { fieldValues });
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedContent(data.content);
    },
  });


  const startEdit = (template: DocumentTemplate) => {
    setEditMode(true);
    setEditedName(template.name);
    setEditedDescription(template.description || "");
    setEditedContent(template.templateContent);
    setEditedFields([...template.fields]);
  };

  const saveEdit = () => {
    if (!selectedTemplate) return;
    updateMutation.mutate({
      id: selectedTemplate.id,
      updates: {
        name: editedName,
        description: editedDescription,
        templateContent: editedContent,
        fields: editedFields,
      },
    });
  };

  const startUse = (template: DocumentTemplate) => {
    setUseMode(true);
    setDesignMode(false);
    const defaults: Record<string, string> = {};
    template.fields.forEach((f) => {
      defaults[f.id] = "";
    });
    setFieldValues(defaults);
    setGeneratedContent(null);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Document Generate</h1>
          <p className="text-muted-foreground mt-1">
            Create templates from example documents, then smart-generate new documents from source data
          </p>
        </div>
      </div>

      {editingRun ? (
        <div className="mt-4">
          <DocumentEditor
            run={editingRun}
            autoDesign={autoDesignRun}
            onClose={() => { setEditingRun(null); setAutoDesignRun(false); }}
          />
        </div>
      ) : (
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="smart-generate" data-testid="tab-smart-generate">
            <Sparkles className="w-4 h-4 mr-2" />
            Document Studio
          </TabsTrigger>
          <TabsTrigger value="template-builder" data-testid="tab-template-builder">
            <LayoutTemplate className="w-4 h-4 mr-2" />
            Template Builder
          </TabsTrigger>
          <TabsTrigger value="legal-dd" data-testid="tab-legal-dd">
            <Scale className="w-4 h-4 mr-2" />
            Legal & DD
          </TabsTrigger>
          <TabsTrigger value="runs" data-testid="tab-doc-runs">
            <FileText className="w-4 h-4 mr-2" />
            Document Library
          </TabsTrigger>
          <TabsTrigger value="pdf-templates" data-testid="tab-pdf-templates">
            <Presentation className="w-4 h-4 mr-2" />
            PDF Templates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="legal-dd" className="mt-6">
          <LegalDDTab />
        </TabsContent>

        <TabsContent value="smart-generate" className="mt-6">
          <ClaudeDocumentStudio onDocumentCreated={(run) => { setEditingRun(run); setAutoDesignRun(true); }} />
        </TabsContent>

        <TabsContent value="template-builder" className="mt-6">
          <TemplateBuilderWizard />
        </TabsContent>

        <TabsContent value="runs" className="mt-6">
          <DocumentRunsTab onEditRun={(run) => setEditingRun(run)} />
        </TabsContent>

        <TabsContent value="pdf-templates" className="mt-6">
          <CompPdfTemplateEditor />
        </TabsContent>

      </Tabs>
      )}
    </div>
  );
}

async function downloadDocument(content: string, title: string, format: "docx" | "pdf" | "pptx", documentType?: string) {
  const response = await fetch("/api/doc-runs/export", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ content, title, format, documentType }),
    credentials: "include",
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || "Export failed");
  }
  const blob = await response.blob();
  const ext = format;
  const filename = `${(title || "BGP_Document").replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "_")}.${ext}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface CompPdfField {
  key: string;
  label: string;
  enabled: boolean;
}

interface CompPdfTemplateConfig {
  headerTitle: string;
  headerSubtitle: string;
  footerText: string;
  brandColor: number[];
  accentColor: number[];
  showLogo: boolean;
  showDate: boolean;
  showCount: boolean;
  fields: CompPdfField[];
  showBadges: boolean;
  showNotes: boolean;
  showAttachedFiles: boolean;
  columns: number;
  lastUpdatedBy: string | null;
  lastUpdatedAt: string | null;
}

function rgbToHex(rgb: number[]): string {
  return "#" + rgb.map(c => c.toString(16).padStart(2, "0")).join("");
}

function hexToRgb(hex: string): number[] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function CompPdfTemplateEditor() {
  const { toast } = useToast();
  const [dirty, setDirty] = useState(false);

  const { data: currentUser } = useQuery<{ team?: string; isAdmin?: boolean }>({
    queryKey: ["/api/auth/me"],
  });

  const userTeam = (currentUser?.team || "").toLowerCase();
  const canEdit = currentUser?.isAdmin || ["lease advisory", "london leasing", "national leasing"].includes(userTeam);

  const { data: template, isLoading } = useQuery<CompPdfTemplateConfig>({
    queryKey: ["/api/comp-pdf-template"],
  });

  const [config, setConfig] = useState<CompPdfTemplateConfig | null>(null);

  useEffect(() => {
    if (template && !config) setConfig(template);
  }, [template]);

  const saveMutation = useMutation({
    mutationFn: async (data: CompPdfTemplateConfig) => {
      const res = await apiRequest("PUT", "/api/comp-pdf-template", data);
      return res.json();
    },
    onSuccess: (saved) => {
      setConfig(saved);
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["/api/comp-pdf-template"] });
      toast({ title: "Template saved", description: "Changes will apply to all future comp PDF exports." });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const update = (partial: Partial<CompPdfTemplateConfig>) => {
    if (!config) return;
    setConfig({ ...config, ...partial });
    setDirty(true);
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    if (!config) return;
    const fields = [...config.fields];
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= fields.length) return;
    [fields[idx], fields[newIdx]] = [fields[newIdx], fields[idx]];
    update({ fields });
  };

  const toggleField = (idx: number) => {
    if (!config) return;
    const fields = [...config.fields];
    fields[idx] = { ...fields[idx], enabled: !fields[idx].enabled };
    update({ fields });
  };

  const updateFieldLabel = (idx: number, label: string) => {
    if (!config) return;
    const fields = [...config.fields];
    fields[idx] = { ...fields[idx], label };
    update({ fields });
  };

  if (isLoading || !config) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const enabledFields = config.fields.filter(f => f.enabled);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" data-testid="text-pdf-templates-title">Comp PDF Template</h2>
          <p className="text-sm text-muted-foreground">
            Customise the PDF export used on the Leasing Comps page
          </p>
          {config.lastUpdatedBy && (
            <p className="text-xs text-muted-foreground mt-1">
              Last edited by {config.lastUpdatedBy}{config.lastUpdatedAt ? ` on ${new Date(config.lastUpdatedAt).toLocaleDateString("en-GB")}` : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!canEdit && (
            <Badge variant="secondary" className="text-xs" data-testid="badge-readonly">
              <Shield className="w-3 h-3 mr-1" />
              Read Only
            </Badge>
          )}
          {canEdit && (
            <Button
              onClick={() => saveMutation.mutate(config)}
              disabled={!dirty || saveMutation.isPending}
              size="sm"
              data-testid="button-save-pdf-template"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Check className="w-4 h-4 mr-1.5" />}
              Save Template
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Header & Footer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Header Title</Label>
                <Input
                  value={config.headerTitle}
                  onChange={e => update({ headerTitle: e.target.value })}
                  disabled={!canEdit}
                  data-testid="input-header-title"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Header Subtitle</Label>
                <Input
                  value={config.headerSubtitle}
                  onChange={e => update({ headerSubtitle: e.target.value })}
                  disabled={!canEdit}
                  data-testid="input-header-subtitle"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Footer Text</Label>
                <Input
                  value={config.footerText}
                  onChange={e => update({ footerText: e.target.value })}
                  disabled={!canEdit}
                  data-testid="input-footer-text"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Brand Colour</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={rgbToHex(config.brandColor)}
                      onChange={e => update({ brandColor: hexToRgb(e.target.value) })}
                      disabled={!canEdit}
                      className="w-8 h-8 rounded border cursor-pointer"
                      data-testid="input-brand-color"
                    />
                    <span className="text-xs text-muted-foreground font-mono">{rgbToHex(config.brandColor)}</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Accent Colour</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={rgbToHex(config.accentColor)}
                      onChange={e => update({ accentColor: hexToRgb(e.target.value) })}
                      disabled={!canEdit}
                      className="w-8 h-8 rounded border cursor-pointer"
                      data-testid="input-accent-color"
                    />
                    <span className="text-xs text-muted-foreground font-mono">{rgbToHex(config.accentColor)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Display Options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "showDate" as const, label: "Show Date" },
                  { key: "showCount" as const, label: "Show Count" },
                  { key: "showBadges" as const, label: "Show Badges" },
                  { key: "showNotes" as const, label: "Show Notes" },
                  { key: "showAttachedFiles" as const, label: "Show Files" },
                ].map(opt => (
                  <label key={opt.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config[opt.key]}
                      onChange={e => update({ [opt.key]: e.target.checked })}
                      disabled={!canEdit}
                      className="rounded"
                      data-testid={`checkbox-${opt.key}`}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Columns per Row</Label>
                <div className="flex items-center gap-2">
                  {[2, 3, 4, 5].map(n => (
                    <Button
                      key={n}
                      size="sm"
                      variant={config.columns === n ? "default" : "outline"}
                      onClick={() => update({ columns: n })}
                      disabled={!canEdit}
                      className="w-8 h-8 p-0"
                      data-testid={`button-columns-${n}`}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Fields ({enabledFields.length} of {config.fields.length} active)</CardTitle>
              <CardDescription className="text-xs">Drag to reorder, toggle to show/hide, edit labels</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {config.fields.map((field, idx) => (
                  <div
                    key={field.key}
                    className={`flex items-center gap-2 p-2 rounded border text-sm ${field.enabled ? "bg-background" : "bg-muted/50 opacity-60"}`}
                    data-testid={`field-row-${field.key}`}
                  >
                    <input
                      type="checkbox"
                      checked={field.enabled}
                      onChange={() => toggleField(idx)}
                      disabled={!canEdit}
                      className="rounded"
                      data-testid={`checkbox-field-${field.key}`}
                    />
                    <Input
                      value={field.label}
                      onChange={e => updateFieldLabel(idx, e.target.value)}
                      disabled={!canEdit}
                      className="h-7 text-xs flex-1"
                      data-testid={`input-field-label-${field.key}`}
                    />
                    <span className="text-[10px] text-muted-foreground font-mono w-24 truncate">{field.key}</span>
                    <div className="flex gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => moveField(idx, -1)}
                        disabled={!canEdit || idx === 0}
                        data-testid={`button-field-up-${field.key}`}
                      >
                        <ChevronUp className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => moveField(idx, 1)}
                        disabled={!canEdit || idx === config.fields.length - 1}
                        data-testid={`button-field-down-${field.key}`}
                      >
                        <ChevronDown className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Eye className="w-4 h-4" />
                Live Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden bg-white" data-testid="pdf-preview-container">
                <div className="aspect-[210/297] relative p-0">
                  <div className="absolute inset-0 flex flex-col text-black" style={{ fontSize: "6px" }}>
                    <div
                      className="px-3 py-2 flex justify-between items-end"
                      style={{ backgroundColor: rgbToHex(config.brandColor), color: "white" }}
                    >
                      <div>
                        <div style={{ fontSize: "8px", fontWeight: "bold" }}>{config.headerTitle}</div>
                        <div style={{ fontSize: "5px", opacity: 0.9 }}>{config.headerSubtitle}</div>
                      </div>
                      <div className="text-right" style={{ fontSize: "4px", opacity: 0.7 }}>
                        {config.showCount && <div>3 transactions</div>}
                        {config.showDate && <div>{new Date().toLocaleDateString("en-GB")}</div>}
                      </div>
                    </div>

                    <div className="flex-1 px-3 py-2 space-y-2 overflow-hidden">
                      {[
                        { name: "10 New Bond Street, W1S 3PE", tenant: "Luxury Brand Ltd", rent: "£250,000" },
                        { name: "45 Jermyn Street, SW1Y 6DN", tenant: "Fashion House", rent: "£180,000" },
                        { name: "22 Regent Street, W1B 5AH", tenant: "Global Retailer", rent: "£320,000" },
                      ].map((sample, si) => (
                        <div key={si}>
                          {si > 0 && <div className="border-t border-gray-200 my-1" />}
                          <div className="flex items-center gap-1">
                            <div
                              className="w-0.5 h-2 rounded-sm"
                              style={{ backgroundColor: rgbToHex(config.accentColor) }}
                            />
                            <span style={{ fontSize: "6px", fontWeight: "bold" }}>{sample.name}</span>
                            {config.showBadges && (
                              <span className="ml-auto bg-gray-100 text-gray-500 rounded px-0.5" style={{ fontSize: "3px" }}>
                                E(a) Retail
                              </span>
                            )}
                          </div>
                          <div className={`grid gap-x-2 gap-y-0.5 mt-0.5`} style={{ gridTemplateColumns: `repeat(${config.columns}, 1fr)` }}>
                            {enabledFields.slice(0, 8).map((f, fi) => (
                              <div key={fi}>
                                <div className="text-gray-400 uppercase" style={{ fontSize: "3px" }}>{f.label}</div>
                                <div style={{ fontSize: "4px", fontWeight: "bold" }}>
                                  {fi === 0 ? sample.tenant : fi === 3 ? sample.rent : "—"}
                                </div>
                              </div>
                            ))}
                          </div>
                          {config.showNotes && (
                            <div className="mt-0.5">
                              <div className="text-gray-400 uppercase" style={{ fontSize: "3px" }}>NOTES</div>
                              <div className="text-gray-600" style={{ fontSize: "3.5px" }}>Sample lease notes...</div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="px-3 py-1 border-t" style={{ borderColor: rgbToHex(config.brandColor) }}>
                      <div className="text-center text-gray-400" style={{ fontSize: "3px" }}>
                        {config.footerText}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Access Control</CardTitle>
              <CardDescription className="text-xs">Who can edit this template</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-green-600" />
                  <span>Lease Advisory</span>
                  <Badge variant="default" className="text-[10px] ml-auto">Can Edit</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-green-600" />
                  <span>London Leasing</span>
                  <Badge variant="default" className="text-[10px] ml-auto">Can Edit</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-green-600" />
                  <span>National Leasing</span>
                  <Badge variant="default" className="text-[10px] ml-auto">Can Edit</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-green-600" />
                  <span>Admins</span>
                  <Badge variant="default" className="text-[10px] ml-auto">Can Edit</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">All Other Teams</span>
                  <Badge variant="secondary" className="text-[10px] ml-auto">Read Only</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Link2 className="w-4 h-4" />
                Linked Pages
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 p-2 rounded border bg-muted/30">
                <FileText className="w-4 h-4 text-primary" />
                <div className="flex-1">
                  <div className="text-xs font-medium">Leasing Comps</div>
                  <div className="text-[10px] text-muted-foreground">PDF export uses this template</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => window.location.href = "/comps"}
                  data-testid="button-go-to-comps"
                >
                  <ExternalLink className="w-3 h-3 mr-1" />
                  Open
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DownloadButtons({ content, title, documentType, size = "sm" }: { content: string; title: string; documentType?: string; size?: "sm" | "default" | "icon" }) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownload = async (format: "docx" | "pdf" | "pptx") => {
    setDownloading(format);
    try {
      await downloadDocument(content, title, format, documentType);
      toast({ title: `${format.toUpperCase()} downloaded` });
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} disabled={!!downloading} data-testid="button-download-doc">
          {downloading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />}
          {downloading ? `Downloading ${downloading.toUpperCase()}...` : "Download"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleDownload("docx")} data-testid="button-download-docx">
          <FileType className="w-4 h-4 mr-2 text-blue-600" />
          Word Document (.docx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleDownload("pdf")} data-testid="button-download-pdf">
          <FileText className="w-4 h-4 mr-2 text-red-600" />
          PDF Document (.pdf)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleDownload("pptx")} data-testid="button-download-pptx">
          <Presentation className="w-4 h-4 mr-2 text-gray-600" />
          PowerPoint (.pptx)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TemplateBuilderWizard() {
  const { toast } = useToast();
  type WizardStep = "upload" | "analysing" | "review" | "approved";
  const [step, setStep] = useState<WizardStep>("upload");
  const [dragging, setDragging] = useState(false);
  const [template, setTemplate] = useState<DocumentTemplate | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [editedFields, setEditedFields] = useState<TemplateField[]>([]);
  const [editedName, setEditedName] = useState("");
  const [editedDescription, setEditedDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [previewMode, setPreviewMode] = useState<"pages" | "template">("pages");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: existingTemplates } = useQuery<DocumentTemplate[]>({
    queryKey: ["/api/doc-templates"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/doc-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doc-templates"] });
      toast({ title: "Template deleted" });
    },
  });

  const handleUpload = async (file: File) => {
    setUploadedFileName(file.name);
    setStep("analysing");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/doc-templates/upload", {
        method: "POST",
        headers: { ...getAuthHeaders() },
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        let errMsg = "Upload failed";
        try { const parsed = await res.json(); errMsg = parsed.message || errMsg; } catch {}
        throw new Error(errMsg);
      }
      const tmpl = await res.json();
      setTemplate(tmpl);
      setEditedContent(tmpl.templateContent);
      setEditedFields(tmpl.fields || []);
      setEditedName(tmpl.name);
      setEditedDescription(tmpl.description || "");
      setPageImages([]);
      setStep("review");
      queryClient.invalidateQueries({ queryKey: ["/api/doc-templates"] });
      fetchPageImages(tmpl.id);
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      setStep("upload");
    }
  };

  const fetchPageImages = async (templateId: string) => {
    setLoadingImages(true);
    try {
      const res = await fetch(`/api/doc-templates/${templateId}/page-images`, {
        headers: { ...getAuthHeaders() },
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setPageImages(data.images || []);
      }
    } catch (err) {
      console.error("Failed to load page images:", err);
    } finally {
      setLoadingImages(false);
    }
  };

  const handleSave = async (): Promise<boolean> => {
    if (!template) return false;
    setSaving(true);
    try {
      const res = await apiRequest("PUT", `/api/doc-templates/${template.id}`, {
        name: editedName,
        description: editedDescription,
        templateContent: editedContent,
        fields: editedFields,
      });
      const updated = await res.json();
      setTemplate(updated);
      queryClient.invalidateQueries({ queryKey: ["/api/doc-templates"] });
      toast({ title: "Template saved" });
      return true;
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!template) return;
    setApproving(true);
    try {
      const saved = await handleSave();
      if (!saved) {
        setApproving(false);
        return;
      }
      await apiRequest("POST", `/api/doc-templates/${template.id}/approve`);
      queryClient.invalidateQueries({ queryKey: ["/api/doc-templates"] });
      setStep("approved");
      toast({ title: "Template approved!", description: "This template is now ready to use in Document Studio." });
    } catch (err: any) {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    } finally {
      setApproving(false);
    }
  };

  const handleDeleteField = (fieldId: string) => {
    setEditedFields(prev => prev.filter(f => f.id !== fieldId));
    setEditedContent(prev => prev.replace(new RegExp(`\\{\\{${fieldId}\\}\\}`, "g"), editedFields.find(f => f.id === fieldId)?.placeholder || ""));
  };

  const handleAddField = () => {
    const newId = `field${Date.now()}`;
    setEditedFields(prev => [...prev, { id: newId, label: "New Field", type: "text", placeholder: "Enter value", section: "General" }]);
  };

  const resetWizard = () => {
    setStep("upload");
    setTemplate(null);
    setEditedContent("");
    setEditedFields([]);
    setEditedName("");
    setEditedDescription("");
    setUploadedFileName("");
    setPageImages([]);
    setLoadingImages(false);
  };

  const loadExistingTemplate = (tmpl: DocumentTemplate) => {
    setTemplate(tmpl);
    setEditedContent(tmpl.templateContent);
    setEditedFields(tmpl.fields || []);
    setEditedName(tmpl.name);
    setEditedDescription(tmpl.description || "");
    setPageImages([]);
    setStep("review");
    if (tmpl.hasPageImages) {
      fetchPageImages(tmpl.id);
    } else if (tmpl.sourceFileName?.toLowerCase().endsWith(".pdf")) {
      setLoadingImages(true);
      apiRequest("POST", `/api/doc-templates/${tmpl.id}/re-render-pages`)
        .then(res => res.json())
        .then(data => {
          if (data.images && data.images.length > 0) {
            setPageImages(data.images);
            queryClient.invalidateQueries({ queryKey: ["/api/doc-templates"] });
          }
        })
        .catch(() => {})
        .finally(() => setLoadingImages(false));
    }
  };

  const reRenderPages = async () => {
    if (!template) return;
    setLoadingImages(true);
    try {
      const res = await apiRequest("POST", `/api/doc-templates/${template.id}/re-render-pages`);
      const data = await res.json();
      if (data.images && data.images.length > 0) {
        setPageImages(data.images);
        toast({ title: "Pages rendered", description: `${data.count} page${data.count !== 1 ? "s" : ""} rendered from PDF` });
      } else {
        toast({ title: "No pages rendered", description: "The PDF may not contain renderable pages.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Render failed", description: err.message, variant: "destructive" });
    } finally {
      setLoadingImages(false);
    }
  };

  const highlightPlaceholders = (text: string) => {
    const parts = text.split(/(\{\{[^}]+\}\})/g);
    return parts.map((part, i) => {
      if (part.match(/^\{\{[^}]+\}\}$/)) {
        const fieldId = part.replace(/\{\{|\}\}/g, "");
        const field = editedFields.find(f => f.id === fieldId);
        return (
          <span key={i} className="bg-amber-100 text-amber-800 px-1 rounded font-medium cursor-help" title={field ? `${field.label} (${field.section})` : fieldId}>
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  const stepIndicator = (
    <div className="flex items-center gap-2 mb-6">
      {[
        { key: "upload", label: "1. Upload", icon: Upload },
        { key: "analysing", label: "2. Analyse", icon: Sparkles },
        { key: "review", label: "3. Review & Edit", icon: Edit3 },
        { key: "approved", label: "4. Approved", icon: CheckCircle },
      ].map(({ key, label, icon: Icon }, i) => {
        const isActive = key === step;
        const isPast = ["upload", "analysing", "review", "approved"].indexOf(step) > i;
        return (
          <div key={key} className="flex items-center gap-2">
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              isActive ? "bg-primary text-primary-foreground" :
              isPast ? "bg-primary/10 text-primary" :
              "bg-muted text-muted-foreground"
            }`}>
              {isPast && !isActive ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );

  if (step === "upload") {
    return (
      <div className="space-y-6">
        {stepIndicator}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload a Document</CardTitle>
            <CardDescription>
              Drop an existing document (PDF, Word, PowerPoint) and the AI will strip it down to a reusable template, preserving the exact structure and design
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer ${
                dragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"
              }`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
              onDrop={(e) => {
                e.preventDefault(); e.stopPropagation(); setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleUpload(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              data-testid="template-builder-dropzone"
            >
              <div className="flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <UploadCloud className="w-7 h-7 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">Drop your document here</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    PDF, Word (.docx), or PowerPoint (.pptx) — the AI will extract the structure and create a template
                  </p>
                </div>
                <Button variant="outline" size="sm" className="mt-2" data-testid="button-template-builder-browse">
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  Browse files
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.docx,.doc,.pptx,.ppt,.txt,.md"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                  e.target.value = "";
                }}
                data-testid="input-template-builder-file"
              />
            </div>
          </CardContent>
        </Card>

        {existingTemplates && existingTemplates.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Existing Templates</CardTitle>
              <CardDescription className="text-xs">Edit or review templates you've already created</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {existingTemplates.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors group"
                    data-testid={`template-card-${t.id}`}
                  >
                    <div className="flex-1 flex items-center gap-3 min-w-0" onClick={() => loadExistingTemplate(t)}>
                      <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{t.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{t.fields?.length || 0} fields · {t.status}</div>
                      </div>
                    </div>
                    <Badge variant={t.status === "approved" ? "default" : "secondary"} className="text-[10px] shrink-0">
                      {t.status === "approved" ? <Check className="w-2.5 h-2.5 mr-0.5" /> : null}
                      {t.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-muted-foreground hover:text-destructive"
                      data-testid={`button-delete-template-${t.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${t.name}"? This cannot be undone.`)) {
                          deleteMutation.mutate(t.id);
                        }
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  if (step === "analysing") {
    return (
      <div className="space-y-6">
        {stepIndicator}
        <Card>
          <CardContent className="py-16">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-primary animate-pulse" />
                </div>
                <Loader2 className="w-20 h-20 text-primary/30 animate-spin absolute -top-2 -left-2" />
              </div>
              <div>
                <h3 className="font-semibold text-base">Analysing your document</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  The AI is reading <span className="font-medium">{uploadedFileName}</span>, identifying the structure, and creating a reusable template with fillable placeholders
                </p>
              </div>
              <div className="flex items-center gap-6 mt-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-green-500" /> Extracting text</span>
                <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Identifying placeholders</span>
                <span className="flex items-center gap-1.5 opacity-50"><Edit3 className="w-3.5 h-3.5" /> Building template</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "approved") {
    return (
      <div className="space-y-6">
        {stepIndicator}
        <Card>
          <CardContent className="py-16">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-base">Template approved!</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  <span className="font-medium">{editedName}</span> is now ready to use. You can select it in Document Studio to generate new documents from it.
                </p>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <Button variant="outline" onClick={resetWizard} data-testid="button-create-another-template">
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  Create another template
                </Button>
                <Button onClick={() => setStep("review")} data-testid="button-back-to-review">
                  <Edit3 className="w-3.5 h-3.5 mr-1.5" />
                  Edit template
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {stepIndicator}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-base">Review Template</h3>
          <p className="text-xs text-muted-foreground">
            Check the template below. Edit the content, rename or remove placeholder fields, then approve when ready.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={resetWizard} data-testid="button-template-back">
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            Start over
          </Button>
          <Button variant="outline" size="sm" onClick={handleSave} disabled={saving || approving} data-testid="button-template-save-draft">
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 mr-1.5" />}
            Save draft
          </Button>
          <Button size="sm" onClick={handleApprove} disabled={saving || approving} data-testid="button-template-approve">
            {approving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5 mr-1.5" />}
            Approve template
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Edit3 className="w-4 h-4" />
                Template Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Template Name</Label>
                  <Input
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    className="mt-1 text-sm"
                    data-testid="input-template-name"
                  />
                </div>
                <div>
                  <Label className="text-xs">Description</Label>
                  <Input
                    value={editedDescription}
                    onChange={(e) => setEditedDescription(e.target.value)}
                    className="mt-1 text-sm"
                    data-testid="input-template-description"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {(() => {
            try {
              if (!template?.design || template.design === "{}") return null;
              const parsed = JSON.parse(template.design);
              if (!parsed.pages || !Array.isArray(parsed.pages) || parsed.pages.length === 0) return null;
              return (
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Palette className="w-4 h-4" />
                        Design Preview
                      </CardTitle>
                      <Badge variant="secondary" className="text-[10px]">Auto-designed</Badge>
                    </div>
                    <CardDescription className="text-xs">
                      Visual layout generated from your document. You can refine this in the Design view after approving.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[400px]">
                      <div className="flex justify-center py-2">
                        <DesignPreview design={template.design} scale={0.65} allPages />
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              );
            } catch { return null; }
          })()}

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Palette className="w-4 h-4" />
                  {pageImages.length > 0 && previewMode === "pages" ? "Original Document Pages" : "Template Preview"}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {pageImages.length > 0 && (
                    <div className="flex border rounded-md overflow-hidden" data-testid="preview-mode-toggle">
                      <Button
                        variant={previewMode === "pages" ? "default" : "ghost"}
                        size="sm"
                        className="h-6 text-[10px] rounded-none px-2"
                        onClick={() => setPreviewMode("pages")}
                        data-testid="button-preview-pages"
                      >
                        <Image className="w-3 h-3 mr-1" />
                        Original
                      </Button>
                      <Button
                        variant={previewMode === "template" ? "default" : "ghost"}
                        size="sm"
                        className="h-6 text-[10px] rounded-none px-2"
                        onClick={() => setPreviewMode("template")}
                        data-testid="button-preview-template"
                      >
                        <Edit3 className="w-3 h-3 mr-1" />
                        Template
                      </Button>
                    </div>
                  )}
                  {pageImages.length === 0 && !loadingImages && template?.sourceFileName?.toLowerCase().endsWith(".pdf") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] gap-1"
                      onClick={reRenderPages}
                      data-testid="button-render-pages"
                    >
                      <Image className="w-3 h-3" />
                      Render Pages
                    </Button>
                  )}
                  <Badge variant="secondary" className="text-[10px]">
                    {pageImages.length > 0 && previewMode === "pages" ? `${pageImages.length} page${pageImages.length !== 1 ? "s" : ""}` : `${editedFields.length} placeholder${editedFields.length !== 1 ? "s" : ""}`}
                  </Badge>
                </div>
              </div>
              <CardDescription className="text-xs">
                {pageImages.length > 0 && previewMode === "pages"
                  ? "Original pages from the uploaded document. Switch to 'Template' to see live placeholders."
                  : "Live preview showing fillable placeholders that update as you edit."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingImages ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading page images...</span>
                </div>
              ) : pageImages.length > 0 && previewMode === "pages" ? (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-4 py-2">
                    {pageImages.map((img, i) => (
                      <div key={i} className="flex flex-col items-center">
                        <div className="text-[10px] text-muted-foreground mb-1 self-start">Page {i + 1}</div>
                        <div className="shadow-lg border rounded overflow-hidden bg-white">
                          <img
                            src={img}
                            alt={`Page ${i + 1}`}
                            className="w-full max-w-[420px]"
                            style={{ display: "block" }}
                            data-testid={`img-page-${i + 1}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="flex justify-center py-2">
                    <div
                      className="shadow-lg border"
                      style={{
                        width: 420,
                        minHeight: 594,
                        backgroundColor: "#FFFFFF",
                        padding: "36px 32px 28px",
                        fontFamily: "Arial, Helvetica, sans-serif",
                        position: "relative",
                      }}
                    >
                      <div style={{ borderBottom: "2px solid #232323", paddingBottom: 10, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#232323", textTransform: "uppercase" }}>Bruce Gillingham Pollard</span>
                        <span style={{ fontSize: 7, color: "#999" }}>TEMPLATE</span>
                      </div>
                      <h1 style={{ fontSize: 18, fontWeight: 700, color: "#232323", marginBottom: 4, lineHeight: 1.2 }}>{editedName || "Untitled Template"}</h1>
                      {editedDescription && (
                        <p style={{ fontSize: 9, color: "#666", marginBottom: 16, fontStyle: "italic" }}>{editedDescription}</p>
                      )}
                      <div style={{ fontSize: 9.5, color: "#333", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                        {editedContent.split("\n").map((line, i) => {
                          const trimmed = line.trim();
                          const isHeading = /^[A-Z][A-Z\s&/,.\-:]{4,}$/.test(trimmed) && trimmed.length < 60;
                          const isBullet = /^[-•●]\s/.test(trimmed);
                          if (!trimmed) return <div key={i} style={{ height: 8 }} />;
                          return (
                            <div key={i} style={{
                              ...(isHeading ? { fontSize: 11, fontWeight: 700, color: "#232323", marginTop: 14, marginBottom: 4, letterSpacing: 0.5, borderBottom: "1px solid #E8E6DF", paddingBottom: 3 } : {}),
                              ...(isBullet ? { paddingLeft: 12 } : {}),
                            }}>
                              {line.split(/(\{\{[^}]+\}\})/g).map((part, j) => {
                                if (part.startsWith("{{") && part.endsWith("}}")) {
                                  return (
                                    <span key={j} style={{
                                      backgroundColor: "#23232315",
                                      color: "#232323",
                                      border: "1px solid #23232330",
                                      borderRadius: 3,
                                      padding: "1px 4px",
                                      fontSize: "0.9em",
                                      fontFamily: "monospace",
                                    }}>
                                      {part.slice(2, -2)}
                                    </span>
                                  );
                                }
                                return <span key={j}>{part}</span>;
                              })}
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ position: "absolute", bottom: 16, left: 32, right: 32, borderTop: "1px solid #E8E6DF", paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 7, color: "#999" }}>55 Wells Street, London W1T 3PT</span>
                        <span style={{ fontSize: 7, color: "#999" }}>020 7436 1212</span>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Edit3 className="w-4 h-4" />
                  Edit Content
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px]"
                  onClick={() => {
                    const el = document.getElementById("template-content-editor");
                    if (el) el.focus();
                  }}
                  data-testid="button-template-edit-toggle"
                >
                  <Edit3 className="w-3 h-3 mr-1" />
                  Edit
                </Button>
              </div>
              <CardDescription className="text-xs">
                Edit the raw template text below. Use {"{{fieldName}}"} for placeholders.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                id="template-content-editor"
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                className="min-h-[200px] text-xs font-mono"
                placeholder="Template content..."
                data-testid="textarea-template-content"
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Placeholder Fields
                </CardTitle>
                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={handleAddField} data-testid="button-add-field">
                  <FolderPlus className="w-3 h-3 mr-1" />
                  Add field
                </Button>
              </div>
              <CardDescription className="text-xs">
                These fields will be filled in when using the template
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2 pr-3">
                  {editedFields.map((field, idx) => (
                    <div key={field.id} className="p-2.5 rounded-lg border bg-card hover:bg-muted/30 transition-colors group" data-testid={`field-card-${field.id}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <code className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-mono">
                          {`{{${field.id}}}`}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                          onClick={() => handleDeleteField(field.id)}
                          data-testid={`button-delete-field-${field.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                      <Input
                        value={field.label}
                        onChange={(e) => {
                          const updated = [...editedFields];
                          updated[idx] = { ...updated[idx], label: e.target.value };
                          setEditedFields(updated);
                        }}
                        className="h-7 text-xs mb-1"
                        placeholder="Field label"
                        data-testid={`input-field-label-${field.id}`}
                      />
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[9px]">{field.type}</Badge>
                        <span className="text-[9px] text-muted-foreground truncate">{field.section}</span>
                      </div>
                      {field.placeholder && (
                        <p className="text-[9px] text-muted-foreground mt-1 truncate italic">
                          e.g. {field.placeholder}
                        </p>
                      )}
                    </div>
                  ))}
                  {editedFields.length === 0 && (
                    <div className="text-center py-6 text-xs text-muted-foreground">
                      <AlertCircle className="w-5 h-5 mx-auto mb-2 opacity-50" />
                      No fields detected. Add placeholder fields using the button above, or type {`{{fieldName}}`} in the template content.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {template?.sourceFileName && (
            <Card>
              <CardContent className="py-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileUp className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Source: {template.sourceFileName}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

interface CanvaBrandTemplate {
  id: string;
  title: string;
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
}

function ClaudeDocumentStudio({ onDocumentCreated }: { onDocumentCreated?: (run: DocumentRun) => void }) {
  const { toast } = useToast();
  const [description, setDescription] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCanvaTemplates, setShowCanvaTemplates] = useState(false);
  const [selectedCanvaTemplate, setSelectedCanvaTemplate] = useState<CanvaBrandTemplate | null>(null);
  const [canvaConnecting, setCanvaConnecting] = useState(false);
  const [canvaPropertySearch, setCanvaPropertySearch] = useState("");
  const [selectedCanvaProperty, setSelectedCanvaProperty] = useState<any>(null);
  const [showPropertyDropdown, setShowPropertyDropdown] = useState(false);

  const { data: canvaStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/canva/status"],
    refetchInterval: false,
  });

  const { data: canvaBrandTemplates, isLoading: canvaTemplatesLoading, refetch: refetchCanvaTemplates } = useQuery<CanvaBrandTemplate[]>({
    queryKey: ["/api/canva/brand-templates"],
    enabled: !!canvaStatus?.connected && showCanvaTemplates,
  });

  const { data: canvaTemplateDataset } = useQuery<Record<string, any>>({
    queryKey: ["/api/canva/brand-templates", selectedCanvaTemplate?.id, "dataset"],
    queryFn: async () => {
      const res = await fetch(`/api/canva/brand-templates/${selectedCanvaTemplate!.id}/dataset`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!selectedCanvaTemplate?.id && !!canvaStatus?.connected,
  });

  const { data: canvaPropertyResults } = useQuery<any[]>({
    queryKey: ["/api/canva/properties/search", canvaPropertySearch],
    queryFn: async () => {
      const res = await fetch(`/api/canva/properties/search?q=${encodeURIComponent(canvaPropertySearch)}`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) throw new Error("Failed to search properties");
      return res.json();
    },
    enabled: !!selectedCanvaTemplate && canvaPropertySearch.length >= 1,
  });

  const { data: canvaPropertyData } = useQuery<any>({
    queryKey: ["/api/canva/property-data", selectedCanvaProperty?.id],
    queryFn: async () => {
      const res = await fetch(`/api/canva/property-data/${selectedCanvaProperty.id}`, { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) throw new Error("Failed to fetch property data");
      return res.json();
    },
    enabled: !!selectedCanvaProperty?.id,
  });

  const connectCanva = async () => {
    setCanvaConnecting(true);
    try {
      const res = await fetch("/api/canva/auth", { credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) {
        throw new Error("Failed to start Canva authorization");
      }
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No authorization URL returned");
      }
    } catch (err: any) {
      toast({ title: "Connection failed", description: err.message || "Could not connect to Canva", variant: "destructive" });
      setCanvaConnecting(false);
    }
  };

  const disconnectCanva = async () => {
    try {
      const res = await fetch("/api/canva/disconnect", { method: "POST", credentials: "include", headers: { ...getAuthHeaders() } });
      if (!res.ok) throw new Error("Disconnect failed");
      queryClient.invalidateQueries({ queryKey: ["/api/canva/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/canva/brand-templates"] });
      setShowCanvaTemplates(false);
      setSelectedCanvaTemplate(null);
      toast({ title: "Canva disconnected" });
    } catch (err: any) {
      toast({ title: "Disconnect failed", description: err.message, variant: "destructive" });
    }
  };

  const canvaAutofillMutation = useMutation({
    mutationFn: async ({ brandTemplateId, content, title }: { brandTemplateId: string; content: Record<string, string>; title: string }) => {
      const res = await apiRequest("POST", "/api/canva/autofill", {
        brandTemplateId,
        data: content,
        title,
      });
      return res.json();
    },
    onSuccess: async (data) => {
      if (data.jobId) {
        let attempts = 0;
        const poll = async (): Promise<any> => {
          attempts++;
          const statusRes = await fetch(`/api/canva/autofill/${data.jobId}`, { credentials: "include", headers: { ...getAuthHeaders() } });
          const status = await statusRes.json();
          if (status.status === "completed" || status.designId) {
            return status;
          }
          if (attempts > 30) throw new Error("Canva autofill timed out");
          await new Promise(r => setTimeout(r, 2000));
          return poll();
        };
        const result = await poll();
        if (result.designUrl) {
          window.open(result.designUrl, "_blank");
        }
        toast({ title: "Canva design created!", description: "Your branded document is ready in Canva." });
      }
    },
    onError: (err: any) => {
      toast({ title: "Canva autofill failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFiles = (newFiles: FileList | File[]) => {
    const accepted = Array.from(newFiles);
    if (accepted.length === 0) return;
    setFiles(prev => [...prev, ...accepted].slice(0, 10));
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const getPresetDesign = (presetLabel: string): string | undefined => {
    const preset = presets.find(p => p.label === presetLabel);
    return preset?.preview;
  };

  const populateDesignWithContent = (designJson: string, content: string, docTitle: string): string => {
    try {
      const design = JSON.parse(designJson);
      if (!design.pages?.[0]?.elements) return designJson;

      const sections: { heading: string; body: string }[] = [];
      const lines = content.split("\n");
      let currentHeading = "";
      let currentBody: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "---") continue;
        const isHeading = (trimmed === trimmed.toUpperCase() && trimmed.length > 2 && trimmed.length < 80 && !trimmed.startsWith("-") && !trimmed.startsWith(">"));
        if (isHeading) {
          if (currentHeading || currentBody.length > 0) {
            sections.push({ heading: currentHeading, body: currentBody.join(" ").trim().slice(0, 200) });
          }
          currentHeading = trimmed;
          currentBody = [];
        } else {
          currentBody.push(trimmed.replace(/\*\*/g, ""));
        }
      }
      if (currentHeading || currentBody.length > 0) {
        sections.push({ heading: currentHeading, body: currentBody.join(" ").trim().slice(0, 200) });
      }

      const els = design.pages[0].elements;
      const textEls = els.filter((e: any) => e.type === "text" && e.content);

      for (const el of textEls) {
        const c = (el.content || "").toLowerCase();
        if (c.includes("bruce gillingham") || c === "bgp" || c.includes("bruce gillingham pollard")) continue;
        if (el.fontSize >= 18 || el.fontWeight === "700" || el.fontWeight === "bold") {
          if (c.includes("particulars") || c.includes("heads of") || c.includes("presentation") ||
              c.includes("report") || c.includes("cv") || c.includes("release") || c.includes("memo") ||
              c.includes("strategy") || c.includes("letter") || c.includes("handbook") || c.includes("flyer") ||
              c.includes("review")) {
            el.content = docTitle;
          }
        }
      }

      let sectionIdx = 0;
      for (const el of textEls) {
        if (sectionIdx >= sections.length) break;
        const c = (el.content || "").toLowerCase();
        if (c.includes("bruce gillingham") || c.includes("london") || c === "bgp") continue;
        if (el.fontSize <= 9 && (el.color === "#666" || el.color === "#999" || el.color === "#CCC" || el.color === "#CCCCCC")) {
          if (sections[sectionIdx]?.body) {
            el.content = sections[sectionIdx].body.slice(0, el.width ? Math.floor(el.width / 3.5) : 100);
            sectionIdx++;
          }
        }
      }

      return JSON.stringify(design);
    } catch {
      return designJson;
    }
  };

  const generateMutation = useMutation({
    mutationFn: async ({ presetLabel, presetDesc }: { presetLabel?: string; presetDesc?: string }) => {
      const formData = new FormData();
      const desc = description.trim();
      const docTypeToUse = presetLabel || selectedPreset;
      if (docTypeToUse) {
        formData.append("documentType", docTypeToUse);
        if (desc) {
          formData.append("description", desc);
        } else if (presetDesc) {
          formData.append("description", presetDesc);
        }
      } else if (desc) {
        formData.append("description", desc);
      }
      if (docTypeToUse) {
        const presetDesign = getPresetDesign(docTypeToUse);
        if (presetDesign) {
          formData.append("templateDesign", presetDesign);
        }
      }
      files.forEach(f => formData.append("documents", f));
      const response = await fetch("/api/doc-templates/generate", {
        method: "POST",
        headers: { ...getAuthHeaders() },
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || "Failed to generate document");
      }
      return response.json();
    },
    onSuccess: (data: any, variables: { presetLabel?: string; presetDesc?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/doc-runs"] });
      const usedDocType = variables.presetLabel || selectedPreset || data.documentType || "";
      const generatedContent = data.content || data.message || "";
      const docTitle = data.name || "Generated Document";

      if (selectedCanvaTemplate && canvaStatus?.connected) {
        const contentFields: Record<string, string> = {};
        const sections = generatedContent.split(/\n{2,}/);
        sections.forEach((section: string, i: number) => {
          const trimmed = section.trim();
          if (trimmed) {
            const key = `section_${i + 1}`;
            contentFields[key] = trimmed;
          }
        });
        if (generatedContent) {
          contentFields["body"] = generatedContent;
          contentFields["title"] = docTitle;
          contentFields["document_type"] = usedDocType || "Document";
        }

        if (canvaPropertyData?.canvaFields) {
          for (const [k, v] of Object.entries(canvaPropertyData.canvaFields)) {
            if (typeof v === "string" && v) {
              contentFields[k] = v;
            }
          }
        }

        canvaAutofillMutation.mutate({
          brandTemplateId: selectedCanvaTemplate.id,
          content: contentFields,
          title: docTitle,
        });
        toast({ title: "Document generated!", description: "Sending to Canva for branded design..." });
      }

      setDescription("");
      setSelectedPreset("");
      setFiles([]);
      if (onDocumentCreated && data.runId) {
        let runDesign = data.design || null;
        if (runDesign && generatedContent) {
          runDesign = populateDesignWithContent(runDesign, generatedContent, docTitle);
          fetch(`/api/doc-runs/${data.runId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...getAuthHeaders() },
            body: JSON.stringify({ name: docTitle, content: generatedContent, design: runDesign }),
            credentials: "include",
          }).catch(() => {});
        }
        const run: DocumentRun = {
          id: String(data.runId),
          name: docTitle,
          document_type: usedDocType || null,
          description: null,
          content: generatedContent,
          status: "completed",
          source_files: null,
          created_at: new Date().toISOString(),
          canva_design_id: null,
          canva_edit_url: null,
          canva_view_url: null,
          canva_export_url: null,
          design: runDesign,
        };
        onDocumentCreated(run);
        if (!selectedCanvaTemplate) {
          toast({ title: "Document generated!", description: runDesign ? "Ready to edit!" : "Opening in designer..." });
        }
      } else if (!selectedCanvaTemplate) {
        toast({ title: "Document generated!", description: docTitle });
      }
    },
    onError: (err: any) => {
      toast({ title: "Failed to generate document", description: err.message, variant: "destructive" });
    },
  });

  const bgpLogo = "/api/branding/assets/BGP_BlackWordmark_trimmed.png";
  const bgpLogoWhite = "/api/branding/assets/BGP_WhiteWordmark_trimmed.png";

  const bgpHeader = (els: any[]) => [
    { id: "logo", type: "image", src: bgpLogo, x: 40, y: 10, width: 200, height: 50, objectFit: "contain", zIndex: 1 },
    { id: "hline", type: "shape", x: 40, y: 65, width: 515, height: 0.5, backgroundColor: "#232323", zIndex: 1 },
    ...els,
    { id: "fline", type: "shape", x: 40, y: 800, width: 515, height: 0.5, backgroundColor: "#232323", zIndex: 10 },
    { id: "flogo", type: "image", src: bgpLogo, x: 430, y: 808, width: 125, height: 28, objectFit: "contain", zIndex: 11 },
  ];
  const wrap = (els: any[]) => JSON.stringify({ pageWidth: 595, pageHeight: 842, pages: [{ backgroundColor: "#FFFFFF", elements: bgpHeader(els) }] });

  const previewMarketingParticulars = wrap([
    { id: "img", type: "shape", x: 0, y: 72, width: 595, height: 280, backgroundColor: "#E7E5DF", zIndex: 2 },
    { id: "imgLabel", type: "text", x: 220, y: 195, width: 160, height: 16, content: "Property Image", fontSize: 10, fontFamily: "Work Sans, Arial", color: "#999", textAlign: "center", zIndex: 3 },
    { id: "t1", type: "text", x: 40, y: 372, width: 400, height: 28, content: "Marketing\nParticulars", fontSize: 22, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "t2", type: "text", x: 40, y: 422, width: 300, height: 14, content: "PROPERTY ADDRESS, LONDON", fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", letterSpacing: "0.1em", zIndex: 2 },
    { id: "s1", type: "text", x: 40, y: 458, width: 130, height: 12, content: "Accommodation", fontSize: 9, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "tbl1", type: "shape", x: 40, y: 474, width: 250, height: 0.5, backgroundColor: "#232323", zIndex: 2 },
    { id: "r1", type: "text", x: 40, y: 480, width: 120, height: 11, content: "Ground Floor", fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
    { id: "r1v", type: "text", x: 200, y: 480, width: 80, height: 11, content: "2,450 sq ft", fontSize: 8, fontFamily: "Work Sans, Arial", fontWeight: "600", color: "#232323", textAlign: "right", zIndex: 2 },
    { id: "tbl2", type: "shape", x: 40, y: 496, width: 250, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 2 },
    { id: "r2", type: "text", x: 40, y: 502, width: 120, height: 11, content: "First Floor", fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
    { id: "r2v", type: "text", x: 200, y: 502, width: 80, height: 11, content: "1,800 sq ft", fontSize: 8, fontFamily: "Work Sans, Arial", fontWeight: "600", color: "#232323", textAlign: "right", zIndex: 2 },
    { id: "tbl3", type: "shape", x: 40, y: 518, width: 250, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 2 },
    { id: "r3", type: "text", x: 40, y: 524, width: 120, height: 11, content: "Basement", fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
    { id: "r3v", type: "text", x: 200, y: 524, width: 80, height: 11, content: "950 sq ft", fontSize: 8, fontFamily: "Work Sans, Arial", fontWeight: "600", color: "#232323", textAlign: "right", zIndex: 2 },
    { id: "tbl4", type: "shape", x: 40, y: 540, width: 250, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 2 },
    { id: "rtot", type: "text", x: 40, y: 548, width: 120, height: 11, content: "Total NIA", fontSize: 8, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "rtotv", type: "text", x: 200, y: 548, width: 80, height: 11, content: "5,200 sq ft", fontSize: 8, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", textAlign: "right", zIndex: 2 },
    { id: "s2", type: "text", x: 40, y: 578, width: 200, height: 12, content: "Rates & Service Charge", fontSize: 9, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...Array.from({ length: 2 }, (_, i) => ({ id: `b1${i}`, type: "shape", x: 40, y: 595 + i * 12, width: 350 - i * 60, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
    { id: "s3", type: "text", x: 330, y: 458, width: 200, height: 12, content: "Location", fontSize: 9, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `loc${i}`, type: "shape", x: 330, y: 476 + i * 12, width: 200 - i * 20, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
    { id: "s4", type: "text", x: 330, y: 545, width: 200, height: 12, content: "Viewing Arrangements", fontSize: 9, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...Array.from({ length: 3 }, (_, i) => ({ id: `va${i}`, type: "shape", x: 330, y: 562 + i * 12, width: 180 - i * 20, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
  ]);

  const previewHOTs = wrap([
    { id: "t1", type: "text", x: 40, y: 80, width: 400, height: 28, content: "Heads of Terms", fontSize: 22, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "t2", type: "text", x: 40, y: 112, width: 400, height: 12, content: "SUBJECT TO CONTRACT & WITHOUT PREJUDICE", fontSize: 7, fontFamily: "Work Sans, Arial", fontWeight: "600", color: "#596264", letterSpacing: "0.1em", zIndex: 2 },
    { id: "divline", type: "shape", x: 40, y: 132, width: 515, height: 0.5, backgroundColor: "#232323", zIndex: 2 },
    ...[["1. Property", "Unit X, Property Address, London W1"], ["2. Landlord", "ABC Property Holdings Ltd"], ["3. Tenant", "XYZ Retail Ltd"], ["4. Guarantor", "To be confirmed"], ["5. Rent", "£150,000 per annum exclusive"], ["6. Rent-Free", "6 months from the Commencement Date"], ["7. Term", "10 years from completion"], ["8. Break", "Tenant only at the 5th anniversary"], ["9. Rent Review", "Open market at the 5th anniversary"], ["10. Use", "Class E — Retail"], ["11. Repairs", "Full repairing and insuring"]].flatMap(([label, val], i) => [
      { id: `cl${i}`, type: "text", x: 40, y: 145 + i * 48, width: 200, height: 12, content: label, fontSize: 9, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
      { id: `cv${i}`, type: "text", x: 40, y: 159 + i * 48, width: 400, height: 11, content: val, fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
      { id: `cln${i}`, type: "shape", x: 40, y: 177 + i * 48, width: 515, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 2 },
    ]),
  ]);

  const previewPitch = JSON.stringify({ pageWidth: 595, pageHeight: 842, pages: [{ backgroundColor: "#232323", elements: [
    { id: "coverLogo", type: "image", src: bgpLogoWhite, x: 60, y: 80, width: 280, height: 70, objectFit: "contain", zIndex: 3 },
    { id: "divw", type: "shape", x: 60, y: 200, width: 60, height: 0.5, backgroundColor: "#FFFFFF", zIndex: 3 },
    { id: "t3", type: "text", x: 60, y: 225, width: 400, height: 20, content: "Pitch Presentation", fontSize: 16, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#FFFFFF", zIndex: 3 },
    { id: "t4", type: "text", x: 60, y: 255, width: 400, height: 14, content: "Project Name", fontSize: 11, fontFamily: "Work Sans, Arial", color: "#CCCCCC", zIndex: 3 },
    { id: "t5", type: "text", x: 60, y: 280, width: 300, height: 12, content: "PREPARED FOR CLIENT, MONTH YYYY", fontSize: 7, fontFamily: "Work Sans, Arial", color: "#888", letterSpacing: "0.08em", zIndex: 3 },
    { id: "tocBg", type: "shape", x: 0, y: 420, width: 595, height: 422, backgroundColor: "#FFFFFF", zIndex: 2 },
    { id: "s1", type: "text", x: 60, y: 445, width: 200, height: 14, content: "Contents", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 3 },
    { id: "tocLine", type: "shape", x: 60, y: 465, width: 475, height: 0.5, backgroundColor: "#232323", zIndex: 3 },
    ...[["01", "Introduction"], ["02", "Our Services"], ["03", "Track Record"], ["04", "Case Studies"], ["05", "The Team"], ["06", "Our Approach"]].map(([n, t], i) => ({
      id: `ci${i}`, type: "text", x: 60, y: 478 + i * 24, width: 400, height: 14, content: `${n}   ${t}`, fontSize: 9, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 3
    })),
    ...[0,1,2,3,4,5].map(i => ({ id: `tocD${i}`, type: "shape", x: 60, y: 496 + i * 24, width: 475, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 3 })),
    { id: "ftLogo", type: "image", src: bgpLogo, x: 430, y: 808, width: 125, height: 28, objectFit: "contain", zIndex: 4 },
  ]}]});

  const previewClientReport = wrap([
    { id: "stag", type: "text", x: 40, y: 78, width: 200, height: 10, content: "CLIENT ADVISORY", fontSize: 7, fontFamily: "Work Sans, Arial", fontWeight: "600", color: "#596264", letterSpacing: "0.12em", zIndex: 2 },
    { id: "t1", type: "text", x: 40, y: 95, width: 400, height: 28, content: "Client Report", fontSize: 22, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "t2", type: "text", x: 40, y: 125, width: 300, height: 12, content: "Property Address, London", fontSize: 10, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
    { id: "divline", type: "shape", x: 40, y: 145, width: 515, height: 0.5, backgroundColor: "#232323", zIndex: 2 },
    { id: "s1", type: "text", x: 40, y: 163, width: 200, height: 14, content: "Executive Summary", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `p1${i}`, type: "shape", x: 40, y: 183 + i * 12, width: 400 - i * 30, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
    { id: "s2", type: "text", x: 40, y: 263, width: 200, height: 14, content: "Market Overview", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "chart", type: "shape", x: 40, y: 283, width: 250, height: 110, backgroundColor: "#F5F4F0", zIndex: 2 },
    { id: "bar1", type: "shape", x: 65, y: 353, width: 28, height: 30, backgroundColor: "#232323", zIndex: 3 },
    { id: "bar2", type: "shape", x: 105, y: 341, width: 28, height: 42, backgroundColor: "#596264", zIndex: 3 },
    { id: "bar3", type: "shape", x: 145, y: 331, width: 28, height: 52, backgroundColor: "#232323", zIndex: 3 },
    { id: "bar4", type: "shape", x: 185, y: 338, width: 28, height: 45, backgroundColor: "#DDDFE0", zIndex: 3 },
    { id: "bar5", type: "shape", x: 225, y: 323, width: 28, height: 60, backgroundColor: "#232323", zIndex: 3 },
    { id: "sideBox", type: "shape", x: 320, y: 283, width: 235, height: 110, backgroundColor: "#E7E5DF", zIndex: 2 },
    { id: "sbLabel", type: "text", x: 335, y: 295, width: 200, height: 10, content: "KEY METRICS", fontSize: 7, fontFamily: "Work Sans, Arial", fontWeight: "600", color: "#596264", letterSpacing: "0.08em", zIndex: 3 },
    ...[["ERV", "£95 psf"], ["Void Rate", "4.2%"], ["Yield", "5.25%"]].flatMap(([l, v], i) => [
      { id: `km${i}l`, type: "text", x: 335, y: 315 + i * 24, width: 100, height: 10, content: l, fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 3 },
      { id: `km${i}v`, type: "text", x: 335, y: 327 + i * 24, width: 100, height: 14, content: v, fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 3 },
    ]),
    { id: "s3", type: "text", x: 40, y: 418, width: 200, height: 14, content: "Comparable Evidence", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "tblh", type: "shape", x: 40, y: 438, width: 515, height: 18, backgroundColor: "#232323", zIndex: 2 },
    { id: "tblht", type: "text", x: 50, y: 441, width: 400, height: 12, content: "Address                    Rent £psf                    Date", fontSize: 7, fontFamily: "Work Sans, Arial", color: "#FFFFFF", zIndex: 3 },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `tr${i}`, type: "shape", x: 40, y: 461 + i * 18, width: 515, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 2 })),
    { id: "s4", type: "text", x: 40, y: 553, width: 200, height: 14, content: "Recommendations", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...Array.from({ length: 3 }, (_, i) => ({ id: `rec${i}`, type: "shape", x: 40, y: 573 + i * 12, width: 420 - i * 30, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
  ]);

  const previewTeamCV = wrap([
    { id: "stag", type: "text", x: 40, y: 78, width: 200, height: 10, content: "TEAM PROFILE", fontSize: 7, fontFamily: "Work Sans, Arial", fontWeight: "600", color: "#596264", letterSpacing: "0.12em", zIndex: 2 },
    { id: "t1", type: "text", x: 40, y: 95, width: 340, height: 28, content: "Team Member Name", fontSize: 22, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "role", type: "text", x: 40, y: 125, width: 200, height: 12, content: "Director", fontSize: 10, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
    { id: "divline", type: "shape", x: 40, y: 145, width: 515, height: 0.5, backgroundColor: "#232323", zIndex: 2 },
    { id: "avatar", type: "shape", x: 430, y: 78, width: 125, height: 125, backgroundColor: "#E7E5DF", zIndex: 2 },
    { id: "avLabel", type: "text", x: 460, y: 133, width: 65, height: 12, content: "Photo", fontSize: 9, fontFamily: "Work Sans, Arial", color: "#999", textAlign: "center", zIndex: 3 },
    { id: "s1", type: "text", x: 40, y: 163, width: 300, height: 14, content: "Professional Profile", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `bio${i}`, type: "shape", x: 40, y: 183 + i * 12, width: 370 - i * 20, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
    { id: "s2", type: "text", x: 40, y: 273, width: 300, height: 14, content: "Key Instructions", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `ki${i}`, type: "shape", x: 40, y: 293 + i * 12, width: 360 - i * 25, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
    { id: "s3", type: "text", x: 40, y: 363, width: 300, height: 14, content: "Notable Transactions", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `nt${i}`, type: "shape", x: 40, y: 383 + i * 12, width: 380 - i * 15, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
    { id: "contactBox", type: "shape", x: 40, y: 463, width: 250, height: 40, backgroundColor: "#E7E5DF", zIndex: 2 },
    { id: "cl1", type: "text", x: 50, y: 470, width: 200, height: 10, content: "020 7123 4567", fontSize: 8, fontFamily: "Work Sans, Arial", fontWeight: "600", color: "#232323", zIndex: 3 },
    { id: "cl2", type: "text", x: 50, y: 485, width: 200, height: 10, content: "name@brucegillinghampollard.com", fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 3 },
  ]);

  const previewPressRelease = wrap([
    { id: "t1", type: "text", x: 40, y: 78, width: 200, height: 12, content: "PRESS RELEASE", fontSize: 8, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", letterSpacing: "0.2em", zIndex: 2 },
    { id: "date", type: "text", x: 400, y: 78, width: 155, height: 12, content: "20 March 2026", fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", textAlign: "right", zIndex: 2 },
    { id: "divline", type: "shape", x: 40, y: 95, width: 515, height: 0.5, backgroundColor: "#232323", zIndex: 2 },
    { id: "h1", type: "text", x: 40, y: 113, width: 515, height: 28, content: "BGP Completes Landmark Transaction", fontSize: 22, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "h2", type: "text", x: 40, y: 145, width: 515, height: 16, content: "Major letting in the heart of Belgravia", fontSize: 11, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, type: "shape", x: 40, y: 183 + i * 14, width: 500 - (i % 3) * 40, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
    { id: "q1", type: "shape", x: 40, y: 313, width: 2, height: 60, backgroundColor: "#232323", zIndex: 2 },
    { id: "qt", type: "text", x: 55, y: 318, width: 480, height: 50, content: "'We are delighted to have completed this significant transaction.'", fontSize: 10, fontFamily: "Grotta, Work Sans, Arial", fontStyle: "italic", color: "#444", zIndex: 2 },
    { id: "qa", type: "text", x: 55, y: 373, width: 300, height: 12, content: "DIRECTOR NAME, BGP", fontSize: 7, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", letterSpacing: "0.08em", zIndex: 2 },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `b2${i}`, type: "shape", x: 40, y: 408 + i * 14, width: 480 - (i % 3) * 50, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
    { id: "bp", type: "text", x: 40, y: 513, width: 300, height: 12, content: "About Bruce Gillingham Pollard", fontSize: 9, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `bp${i}`, type: "shape", x: 40, y: 531 + i * 12, width: 440 - i * 30, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
  ]);

  const previewTenantHandbook = wrap([
    { id: "stag", type: "text", x: 40, y: 78, width: 200, height: 10, content: "BUILDING GUIDE", fontSize: 7, fontFamily: "Work Sans, Arial", fontWeight: "600", color: "#596264", letterSpacing: "0.12em", zIndex: 2 },
    { id: "t1", type: "text", x: 40, y: 95, width: 400, height: 28, content: "Tenant Handbook", fontSize: 22, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "t2", type: "text", x: 40, y: 125, width: 300, height: 12, content: "Building Name, London", fontSize: 10, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
    { id: "divline", type: "shape", x: 40, y: 145, width: 515, height: 0.5, backgroundColor: "#232323", zIndex: 2 },
    { id: "toc", type: "text", x: 40, y: 163, width: 200, height: 14, content: "Contents", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...["1. Welcome & Introduction", "2. Building Management", "3. Fit-Out Requirements", "4. Health & Safety", "5. Access & Security", "6. Waste Management", "7. Signage Guidelines", "8. General Rules"].map((t, i) => ({
      id: `toc${i}`, type: "text", x: 50, y: 185 + i * 20, width: 350, height: 14, content: t, fontSize: 9, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2
    })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `tocL${i}`, type: "shape", x: 50, y: 203 + i * 20, width: 350, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 2 })),
    { id: "tocline", type: "shape", x: 40, y: 353, width: 515, height: 0.5, backgroundColor: "#232323", zIndex: 2 },
    { id: "s1", type: "text", x: 40, y: 371, width: 400, height: 16, content: "1. Welcome & Introduction", fontSize: 13, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `wb${i}`, type: "shape", x: 40, y: 395 + i * 12, width: 450 - i * 30, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
    { id: "box1", type: "shape", x: 40, y: 468, width: 515, height: 70, backgroundColor: "#E7E5DF", zIndex: 2 },
    { id: "boxT", type: "text", x: 55, y: 481, width: 200, height: 14, content: "Key Contact", fontSize: 10, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 3 },
    { id: "boxV", type: "text", x: 55, y: 501, width: 300, height: 11, content: "Building Manager: 020 7123 4567", fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 3 },
    { id: "boxV2", type: "text", x: 55, y: 516, width: 300, height: 11, content: "Emergency: 020 7123 4568", fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 3 },
  ]);

  const previewRentReview = wrap([
    { id: "tag", type: "text", x: 40, y: 78, width: 200, height: 12, content: "INTERNAL MEMORANDUM", fontSize: 7, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", letterSpacing: "0.15em", zIndex: 2 },
    { id: "conf", type: "text", x: 380, y: 78, width: 175, height: 12, content: "Private & Confidential", fontSize: 8, fontFamily: "Work Sans, Arial", fontWeight: "600", color: "#CC0000", textAlign: "right", zIndex: 2 },
    { id: "t1", type: "text", x: 40, y: 101, width: 400, height: 28, content: "Rent Review\nMemorandum", fontSize: 20, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "divline", type: "shape", x: 40, y: 141, width: 515, height: 0.5, backgroundColor: "#232323", zIndex: 2 },
    ...[["To:", "File"], ["From:", "Lease Advisory Team"], ["Date:", "20 March 2026"], ["Re:", "Rent Review — Property Address"]].flatMap(([l, v], i) => [
      { id: `ml${i}`, type: "text", x: 40, y: 155 + i * 22, width: 60, height: 12, content: l, fontSize: 9, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
      { id: `mv${i}`, type: "text", x: 110, y: 155 + i * 22, width: 350, height: 12, content: v, fontSize: 9, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
    ]),
    { id: "mline", type: "shape", x: 40, y: 251, width: 515, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 2 },
    { id: "s1", type: "text", x: 40, y: 268, width: 200, height: 14, content: "Current Position", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "box1", type: "shape", x: 40, y: 288, width: 250, height: 55, backgroundColor: "#E7E5DF", zIndex: 2 },
    { id: "bx1l", type: "text", x: 50, y: 295, width: 100, height: 10, content: "Current Rent", fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 3 },
    { id: "bx1v", type: "text", x: 50, y: 311, width: 180, height: 16, content: "£125,000 pa", fontSize: 14, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 3 },
    { id: "box2", type: "shape", x: 305, y: 288, width: 250, height: 55, backgroundColor: "#E7E5DF", zIndex: 2 },
    { id: "bx2l", type: "text", x: 315, y: 295, width: 120, height: 10, content: "Recommended ERV", fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 3 },
    { id: "bx2v", type: "text", x: 315, y: 311, width: 180, height: 16, content: "£155,000 pa", fontSize: 14, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 3 },
    { id: "s2", type: "text", x: 40, y: 368, width: 200, height: 14, content: "Comparable Evidence", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "th", type: "shape", x: 40, y: 388, width: 515, height: 18, backgroundColor: "#232323", zIndex: 2 },
    { id: "tht", type: "text", x: 50, y: 391, width: 400, height: 10, content: "Address                    Rent £psf              Review Date", fontSize: 7, fontFamily: "Work Sans, Arial", color: "#FFFFFF", zIndex: 3 },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `rr${i}`, type: "shape", x: 40, y: 408 + i * 16, width: 515, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 2 })),
  ]);

  const previewInstructionLetter = wrap([
    { id: "date", type: "text", x: 40, y: 83, width: 200, height: 12, content: "20 March 2026", fontSize: 9, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
    { id: "to1", type: "text", x: 40, y: 108, width: 300, height: 12, content: "Client Name", fontSize: 9, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "to2", type: "text", x: 40, y: 123, width: 300, height: 12, content: "Company Name", fontSize: 9, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
    { id: "to3", type: "text", x: 40, y: 138, width: 300, height: 12, content: "Address Line 1", fontSize: 9, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
    { id: "to4", type: "text", x: 40, y: 153, width: 300, height: 12, content: "London SW1", fontSize: 9, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
    { id: "dear", type: "text", x: 40, y: 183, width: 300, height: 14, content: "Dear Client Name,", fontSize: 10, fontFamily: "Work Sans, Arial", color: "#232323", zIndex: 2 },
    { id: "re", type: "text", x: 40, y: 208, width: 515, height: 16, content: "Re: Instruction to Act — Property Address", fontSize: 12, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "divline", type: "shape", x: 40, y: 230, width: 515, height: 0.5, backgroundColor: "#232323", zIndex: 2 },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `p1${i}`, type: "shape", x: 40, y: 248 + i * 12, width: 480 - i * 30, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
    { id: "s1", type: "text", x: 40, y: 318, width: 200, height: 14, content: "Scope of Work", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `sw${i}`, type: "shape", x: 40, y: 338 + i * 12, width: 460 - i * 25, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
    { id: "s2", type: "text", x: 40, y: 403, width: 200, height: 14, content: "Fee Basis", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...Array.from({ length: 3 }, (_, i) => ({ id: `fb${i}`, type: "shape", x: 40, y: 423 + i * 12, width: 420 - i * 30, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
    { id: "sign", type: "text", x: 40, y: 523, width: 200, height: 12, content: "Yours sincerely,", fontSize: 9, fontFamily: "Work Sans, Arial", color: "#232323", zIndex: 2 },
    { id: "sigline", type: "shape", x: 40, y: 563, width: 150, height: 0.5, backgroundColor: "#232323", zIndex: 2 },
    { id: "signame", type: "text", x: 40, y: 571, width: 200, height: 12, content: "Director Name", fontSize: 9, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "sigrole", type: "text", x: 40, y: 585, width: 200, height: 10, content: "Bruce Gillingham Pollard", fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
  ]);

  const previewInvestmentMemo = wrap([
    { id: "stag", type: "text", x: 40, y: 78, width: 200, height: 10, content: "INVESTMENT", fontSize: 7, fontFamily: "Work Sans, Arial", fontWeight: "600", color: "#596264", letterSpacing: "0.12em", zIndex: 2 },
    { id: "t1", type: "text", x: 40, y: 95, width: 400, height: 28, content: "Investment\nMemorandum", fontSize: 22, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "t2", type: "text", x: 40, y: 143, width: 300, height: 12, content: "Property Address, London", fontSize: 10, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
    { id: "divline", type: "shape", x: 40, y: 163, width: 515, height: 0.5, backgroundColor: "#232323", zIndex: 2 },
    ...[["Passing Rent", "£450,000 pa"], ["WAULT", "7.2 years"], ["Net Initial Yield", "4.75%"], ["Rev. Yield", "5.25%"]].map(([l, v], i) => ({
      id: `kv${i}`, type: "shape", x: 40 + i * 130, y: 178, width: 120, height: 55, backgroundColor: "#E7E5DF", zIndex: 2,
    })),
    ...[["Passing Rent", "£450,000 pa"], ["WAULT", "7.2 years"], ["Net Initial Yield", "4.75%"], ["Rev. Yield", "5.25%"]].flatMap(([l, v], i) => [
      { id: `kvl${i}`, type: "text", x: 48 + i * 130, y: 185, width: 105, height: 10, content: l, fontSize: 7, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 3 },
      { id: `kvv${i}`, type: "text", x: 48 + i * 130, y: 201, width: 105, height: 16, content: v, fontSize: 12, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 3 },
    ]),
    { id: "s1", type: "text", x: 40, y: 253, width: 200, height: 14, content: "Tenancy Schedule", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "th", type: "shape", x: 40, y: 273, width: 515, height: 18, backgroundColor: "#232323", zIndex: 2 },
    { id: "tht", type: "text", x: 50, y: 276, width: 480, height: 10, content: "Tenant          Demise          Rent          Expiry", fontSize: 7, fontFamily: "Work Sans, Arial", color: "#FFFFFF", zIndex: 3 },
    ...Array.from({ length: 5 }, (_, i) => ({ id: `tr${i}`, type: "shape", x: 40, y: 295 + i * 16, width: 515, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 2 })),
    { id: "s2", type: "text", x: 40, y: 388, width: 200, height: 14, content: "Comparable Transactions", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "th2", type: "shape", x: 40, y: 408, width: 515, height: 18, backgroundColor: "#232323", zIndex: 2 },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `tr2${i}`, type: "shape", x: 40, y: 430 + i * 16, width: 515, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 2 })),
  ]);

  const previewLeasingStrategy = wrap([
    { id: "stag", type: "text", x: 40, y: 78, width: 200, height: 10, content: "LEASING", fontSize: 7, fontFamily: "Work Sans, Arial", fontWeight: "600", color: "#596264", letterSpacing: "0.12em", zIndex: 2 },
    { id: "t1", type: "text", x: 40, y: 95, width: 400, height: 28, content: "Leasing Strategy", fontSize: 22, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "t2", type: "text", x: 40, y: 125, width: 300, height: 12, content: "Scheme Name, London", fontSize: 10, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
    { id: "divline", type: "shape", x: 40, y: 145, width: 515, height: 0.5, backgroundColor: "#232323", zIndex: 2 },
    { id: "s1", type: "text", x: 40, y: 163, width: 200, height: 14, content: "Vision & Overview", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `v${i}`, type: "shape", x: 40, y: 183 + i * 12, width: 440 - i * 30, height: 5, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
    { id: "s2", type: "text", x: 40, y: 243, width: 200, height: 14, content: "Target Tenant Mix", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...["Retail", "F&B", "Leisure", "Wellness"].map((cat, i) => ({
      id: `cat${i}`, type: "shape", x: 40 + i * 130, y: 265, width: 120, height: 35, backgroundColor: i === 0 ? "#232323" : i === 1 ? "#596264" : i === 2 ? "#E7E5DF" : "#DDDFE0", zIndex: 2,
    })),
    ...["Retail", "F&B", "Leisure", "Wellness"].map((cat, i) => ({
      id: `catl${i}`, type: "text", x: 40 + i * 130, y: 275, width: 120, height: 14, content: cat, fontSize: 9, fontFamily: "Work Sans, Arial", fontWeight: "700", color: i < 2 ? "#FFFFFF" : "#232323", textAlign: "center", zIndex: 3,
    })),
    { id: "s3", type: "text", x: 40, y: 323, width: 200, height: 14, content: "Phasing Plan", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...["Phase 1: Q2 2026", "Phase 2: Q4 2026", "Phase 3: Q2 2027"].map((ph, i) => ({
      id: `ph${i}`, type: "shape", x: 40, y: 345 + i * 28, width: 200 + i * 80, height: 18, backgroundColor: "#232323", zIndex: 2,
    })),
    ...["Phase 1: Q2 2026", "Phase 2: Q4 2026", "Phase 3: Q2 2027"].map((ph, i) => ({
      id: `phl${i}`, type: "text", x: 50, y: 348 + i * 28, width: 200, height: 12, content: ph, fontSize: 8, fontFamily: "Work Sans, Arial", fontWeight: "600", color: "#FFFFFF", zIndex: 3,
    })),
    { id: "s4", type: "text", x: 40, y: 443, width: 200, height: 14, content: "Rental Expectations", fontSize: 11, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    { id: "th", type: "shape", x: 40, y: 463, width: 515, height: 18, backgroundColor: "#232323", zIndex: 2 },
    { id: "tht", type: "text", x: 50, y: 466, width: 400, height: 10, content: "Unit           Size (sq ft)           ERV £psf           Total Rent", fontSize: 7, fontFamily: "Work Sans, Arial", color: "#FFFFFF", zIndex: 3 },
    ...Array.from({ length: 4 }, (_, i) => ({ id: `rr${i}`, type: "shape", x: 40, y: 485 + i * 16, width: 515, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 2 })),
  ]);

  const previewRequirementFlyer = wrap([
    { id: "heroBox", type: "shape", x: 0, y: 72, width: 595, height: 270, backgroundColor: "#232323", zIndex: 2 },
    { id: "brandCircle", type: "shape", x: 230, y: 110, width: 135, height: 135, backgroundColor: "#444", zIndex: 3 },
    { id: "brandLabel", type: "text", x: 245, y: 165, width: 105, height: 16, content: "Brand Logo", fontSize: 10, fontFamily: "Work Sans, Arial", color: "#999", textAlign: "center", zIndex: 4 },
    { id: "brandName", type: "text", x: 120, y: 258, width: 355, height: 28, content: "Brand Name", fontSize: 24, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#FFFFFF", textAlign: "center", zIndex: 3 },
    { id: "concept", type: "text", x: 120, y: 290, width: 355, height: 14, content: "Concept Description", fontSize: 10, fontFamily: "Work Sans, Arial", color: "#CCC", textAlign: "center", zIndex: 3 },
    { id: "divw", type: "shape", x: 265, y: 314, width: 65, height: 0.5, backgroundColor: "#FFFFFF", zIndex: 3 },
    { id: "s1", type: "text", x: 40, y: 365, width: 200, height: 14, content: "Requirements", fontSize: 13, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
    ...[["Location", "Prime London — Belgravia, Mayfair, Chelsea"], ["Unit Size", "1,500 – 3,000 sq ft"], ["Lease Term", "10 years minimum"], ["Frontage", "20ft+ ground floor frontage"]].flatMap(([l, v], i) => [
      { id: `rl${i}`, type: "text", x: 40, y: 390 + i * 36, width: 100, height: 12, content: l, fontSize: 9, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
      { id: `rv${i}`, type: "text", x: 40, y: 404 + i * 36, width: 400, height: 11, content: v, fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
      { id: `rln${i}`, type: "shape", x: 40, y: 420 + i * 36, width: 515, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 2 },
    ]),
    { id: "contact", type: "shape", x: 40, y: 545, width: 515, height: 60, backgroundColor: "#E7E5DF", zIndex: 2 },
    { id: "cTitle", type: "text", x: 55, y: 555, width: 200, height: 12, content: "For submissions contact:", fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 3 },
    { id: "cName", type: "text", x: 55, y: 571, width: 200, height: 14, content: "Agent Name — BGP", fontSize: 10, fontFamily: "Grotta, Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 3 },
    { id: "cEmail", type: "text", x: 55, y: 587, width: 200, height: 10, content: "agent@brucegillinghampollard.com", fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 3 },
  ]);

  const deckW = 960;
  const deckH = 540;
  const deckWrap = (pages: any[]) => JSON.stringify({ pageWidth: deckW, pageHeight: deckH, pages });
  const deckCover = (title: string, subtitle: string) => ({ backgroundColor: "#232323", elements: [
    { id: "bar1", type: "shape", x: 750, y: 58, width: 140, height: 30, backgroundColor: "#FFFFFF", zIndex: 2 },
    { id: "bar2", type: "shape", x: 750, y: 25, width: 105, height: 30, backgroundColor: "#FFFFFF", zIndex: 2 },
    { id: "bar3", type: "shape", x: 660, y: 42, width: 190, height: 30, backgroundColor: "#FFFFFF", zIndex: 2 },
    { id: "wlogo", type: "image", src: bgpLogoWhite, x: 665, y: 30, width: 220, height: 55, objectFit: "contain", zIndex: 3 },
    { id: "ct", type: "text", x: 40, y: 340, width: 550, height: 80, content: title, fontSize: 40, fontFamily: "Work Sans, Arial", fontWeight: "400", color: "#FFFFFF", zIndex: 2 },
    { id: "cs", type: "text", x: 40, y: 430, width: 500, height: 30, content: subtitle, fontSize: 16, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#FFFFFF", letterSpacing: "0.06em", zIndex: 2 },
  ]});
  const deckSection = (num: string, title: string) => ({ backgroundColor: "#232323", elements: [
    { id: "bar1", type: "shape", x: 750, y: 430, width: 140, height: 30, backgroundColor: "#FFFFFF", zIndex: 2 },
    { id: "bar2", type: "shape", x: 750, y: 397, width: 105, height: 30, backgroundColor: "#FFFFFF", zIndex: 2 },
    { id: "bar3", type: "shape", x: 660, y: 414, width: 190, height: 30, backgroundColor: "#FFFFFF", zIndex: 2 },
    { id: "sn", type: "text", x: 40, y: 60, width: 300, height: 80, content: num, fontSize: 80, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#FFFFFF", zIndex: 2 },
    { id: "st", type: "text", x: 40, y: 150, width: 500, height: 60, content: title, fontSize: 28, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#FFFFFF", zIndex: 2 },
  ]});

  const previewDeckPitch = deckWrap([
    deckCover("Pitch\nPresentation", "PREPARED FOR CLIENT, MONTH YYYY"),
    deckSection("01", "Introduction"),
    { backgroundColor: "#232323", elements: [
      { id: "stl", type: "text", x: 40, y: 40, width: 400, height: 24, content: "INTRODUCTION", fontSize: 14, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#FFFFFF", letterSpacing: "0.08em", zIndex: 2 },
      { id: "body", type: "text", x: 40, y: 90, width: 480, height: 350, content: "We believe the property market has a responsibility to think ahead and prepare its buildings for the future.\n\nBGP is a specialist commercial property consultancy advising on leasing, investment, development, acquisitions, and lease consultancy across prime London.", fontSize: 14, fontFamily: "Work Sans, Arial", color: "#FFFFFF", zIndex: 2 },
      { id: "img1", type: "shape", x: 560, y: 40, width: 360, height: 460, backgroundColor: "#00FFFF", zIndex: 2 },
      { id: "imgL1", type: "text", x: 680, y: 250, width: 120, height: 16, content: "Image", fontSize: 11, fontFamily: "Work Sans, Arial", color: "#666", textAlign: "center", zIndex: 3 },
    ]},
    deckSection("02", "Our Services"),
    { backgroundColor: "#FFFFFF", elements: [
      { id: "stl", type: "text", x: 30, y: 15, width: 300, height: 18, content: "SECTION TITLE", fontSize: 14, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#232323", letterSpacing: "0.08em", zIndex: 2 },
      { id: "ttl", type: "text", x: 30, y: 38, width: 500, height: 30, content: "Title of page\ntwo lines", fontSize: 22, fontFamily: "Work Sans, Arial", color: "#232323", zIndex: 2 },
      ...[0,1,2,3].map(i => ({ id: `img${i}`, type: "shape", x: 30 + i * 230, y: 100, width: 215, height: 180, backgroundColor: "#00FFFF", zIndex: 2 })),
      ...[0,1,2,3].map(i => ({ id: `cap${i}`, type: "text", x: 30 + i * 230, y: 285, width: 215, height: 14, content: "CAPTION", fontSize: 8, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#596264", letterSpacing: "0.06em", zIndex: 2 })),
      { id: "sum", type: "text", x: 30, y: 310, width: 900, height: 60, content: "Summary text. We are market leaders, we lead with a strong vision, and have a strategic approach.", fontSize: 11, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
    ]},
    { backgroundColor: "#FFFFFF", elements: [
      ...[0,1,2,3].map(i => ({ id: `ph${i}`, type: "shape", x: 30 + i * 230, y: 130, width: 215, height: 220, backgroundColor: "#00FFFF", zIndex: 2 })),
      ...[0,1,2,3].map(i => ({ id: `nm${i}`, type: "text", x: 30 + i * 230, y: 360, width: 215, height: 14, content: "NAME OF PERSON", fontSize: 9, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 })),
      ...[0,1,2,3].map(i => ({ id: `rl${i}`, type: "text", x: 30 + i * 230, y: 377, width: 215, height: 100, content: "Role or Company\n— Bullet point biography\n— Point 2\n— Point 3", fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 })),
      { id: "stl", type: "text", x: 30, y: 15, width: 300, height: 18, content: "THE TEAM", fontSize: 14, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#232323", letterSpacing: "0.08em", zIndex: 2 },
      { id: "ttl", type: "text", x: 30, y: 38, width: 400, height: 60, content: "Title of page\ntwo lines", fontSize: 22, fontFamily: "Work Sans, Arial", color: "#232323", zIndex: 2 },
    ]},
    { backgroundColor: "#232323", elements: [
      { id: "bar1", type: "shape", x: 750, y: 430, width: 140, height: 30, backgroundColor: "#FFFFFF", zIndex: 2 },
      { id: "bar2", type: "shape", x: 750, y: 397, width: 105, height: 30, backgroundColor: "#FFFFFF", zIndex: 2 },
      { id: "bar3", type: "shape", x: 660, y: 414, width: 190, height: 30, backgroundColor: "#FFFFFF", zIndex: 2 },
      { id: "ty", type: "text", x: 40, y: 260, width: 500, height: 60, content: "Thank you", fontSize: 52, fontFamily: "Work Sans, Arial", color: "#FFFFFF", zIndex: 2 },
      { id: "contact", type: "text", x: 40, y: 340, width: 600, height: 50, content: "If you wish to discuss this proposal further\nplease contact Name Surname on 020 7409 8698", fontSize: 14, fontFamily: "Work Sans, Arial", color: "#FFFFFF", zIndex: 2 },
    ]},
  ]);

  const previewDeckPropertyTour = deckWrap([
    deckCover("Property\nPresentation", "PROPERTY ADDRESS, LONDON"),
    { backgroundColor: "#FFFFFF", elements: [
      { id: "heroImg", type: "shape", x: 0, y: 0, width: 960, height: 370, backgroundColor: "#00FFFF", zIndex: 1 },
      { id: "heroL", type: "text", x: 410, y: 170, width: 140, height: 16, content: "Hero Image", fontSize: 11, fontFamily: "Work Sans, Arial", color: "#666", textAlign: "center", zIndex: 2 },
      { id: "addr", type: "text", x: 40, y: 390, width: 500, height: 24, content: "Property Address, London", fontSize: 20, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
      { id: "desc", type: "text", x: 40, y: 420, width: 600, height: 40, content: "A prime commercial property available in the heart of central London.", fontSize: 12, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
      ...[["NIA", "5,200 sq ft"], ["Floors", "Ground + 2"], ["Use Class", "Class E"]].map(([l, v], i) => ({ id: `kv${i}`, type: "shape", x: 700 + i * 0, y: 385 + i * 35, width: 200, height: 28, backgroundColor: "#E7E5DF", zIndex: 2 })),
      ...[["NIA", "5,200 sq ft"], ["Floors", "Ground + 2"], ["Use Class", "Class E"]].flatMap(([l, v], i) => [
        { id: `kvl${i}`, type: "text", x: 710, y: 389 + i * 35, width: 60, height: 12, content: l, fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 3 },
        { id: `kvv${i}`, type: "text", x: 780, y: 389 + i * 35, width: 110, height: 12, content: v, fontSize: 9, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", textAlign: "right", zIndex: 3 },
      ]),
    ]},
    { backgroundColor: "#FFFFFF", elements: [
      ...[0,1,2,3].map(i => ({ id: `img${i}`, type: "shape", x: 30 + (i % 2) * 460, y: 30 + Math.floor(i / 2) * 250, width: 440, height: 235, backgroundColor: "#00FFFF", zIndex: 2 })),
      ...[0,1,2,3].map(i => ({ id: `cap${i}`, type: "text", x: 35 + (i % 2) * 460, y: 215 + Math.floor(i / 2) * 250, width: 200, height: 12, content: "CAPTION", fontSize: 8, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#596264", letterSpacing: "0.06em", zIndex: 3 })),
    ]},
    { backgroundColor: "#FFFFFF", elements: [
      { id: "stl", type: "text", x: 30, y: 15, width: 300, height: 18, content: "FLOOR PLANS", fontSize: 14, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#232323", letterSpacing: "0.08em", zIndex: 2 },
      { id: "plan", type: "shape", x: 30, y: 50, width: 600, height: 440, backgroundColor: "#00FFFF", zIndex: 2 },
      { id: "planL", type: "text", x: 280, y: 260, width: 100, height: 16, content: "Floor Plan", fontSize: 11, fontFamily: "Work Sans, Arial", color: "#666", textAlign: "center", zIndex: 3 },
      { id: "sched", type: "text", x: 660, y: 50, width: 270, height: 18, content: "Accommodation", fontSize: 12, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
      ...["Ground Floor", "First Floor", "Second Floor", "Total NIA"].flatMap((fl, i) => [
        { id: `fl${i}`, type: "text", x: 660, y: 80 + i * 28, width: 140, height: 14, content: fl, fontSize: 10, fontFamily: "Work Sans, Arial", color: i === 3 ? "#232323" : "#596264", fontWeight: i === 3 ? "700" : "400", zIndex: 2 },
        { id: `fv${i}`, type: "text", x: 820, y: 80 + i * 28, width: 100, height: 14, content: i === 3 ? "5,200 sq ft" : `${1800 + i * 200} sq ft`, fontSize: 10, fontFamily: "Work Sans, Arial", fontWeight: i === 3 ? "700" : "400", color: "#232323", textAlign: "right", zIndex: 2 },
        { id: `fln${i}`, type: "shape", x: 660, y: 98 + i * 28, width: 260, height: 0.5, backgroundColor: i === 3 ? "#232323" : "#DDDFE0", zIndex: 2 },
      ]),
    ]},
  ]);

  const previewDeckMarket = deckWrap([
    deckCover("Market\nReport", "CENTRAL LONDON, Q1 2026"),
    deckSection("01", "Market\nOverview"),
    { backgroundColor: "#FFFFFF", elements: [
      { id: "stl", type: "text", x: 30, y: 15, width: 300, height: 18, content: "MARKET OVERVIEW", fontSize: 14, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#232323", letterSpacing: "0.08em", zIndex: 2 },
      { id: "ttl", type: "text", x: 30, y: 38, width: 500, height: 30, content: "Key Market Indicators", fontSize: 22, fontFamily: "Work Sans, Arial", color: "#232323", zIndex: 2 },
      ...[["Take-up", "2.4m sq ft", "+12% YoY"], ["Availability", "8.2%", "−0.4pp"], ["Prime Rent", "£95 psf", "+5% YoY"], ["Under Offer", "1.1m sq ft", "+18%"]].map(([l, v, d], i) => ({
        id: `kv${i}`, type: "shape", x: 30 + i * 230, y: 85, width: 215, height: 90, backgroundColor: "#E7E5DF", zIndex: 2,
      })),
      ...[["Take-up", "2.4m sq ft", "+12% YoY"], ["Availability", "8.2%", "−0.4pp"], ["Prime Rent", "£95 psf", "+5% YoY"], ["Under Offer", "1.1m sq ft", "+18%"]].flatMap(([l, v, d], i) => [
        { id: `kvl${i}`, type: "text", x: 42 + i * 230, y: 95, width: 190, height: 12, content: l, fontSize: 9, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 3 },
        { id: `kvv${i}`, type: "text", x: 42 + i * 230, y: 115, width: 190, height: 24, content: v, fontSize: 22, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 3 },
        { id: `kvd${i}`, type: "text", x: 42 + i * 230, y: 145, width: 190, height: 12, content: d, fontSize: 9, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 3 },
      ]),
      { id: "chart", type: "shape", x: 30, y: 200, width: 580, height: 300, backgroundColor: "#F5F4F0", zIndex: 2 },
      { id: "chartL", type: "text", x: 260, y: 340, width: 100, height: 16, content: "Chart", fontSize: 11, fontFamily: "Work Sans, Arial", color: "#999", textAlign: "center", zIndex: 3 },
      { id: "sidebar", type: "shape", x: 640, y: 200, width: 290, height: 300, backgroundColor: "#232323", zIndex: 2 },
      { id: "sbT", type: "text", x: 660, y: 220, width: 250, height: 14, content: "COMMENTARY", fontSize: 10, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#FFFFFF", letterSpacing: "0.06em", zIndex: 3 },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `sb${i}`, type: "shape", x: 660, y: 250 + i * 18, width: 240 - i * 20, height: 6, backgroundColor: "#444", borderRadius: 2, zIndex: 3 })),
    ]},
    { backgroundColor: "#FFFFFF", elements: [
      { id: "stl", type: "text", x: 30, y: 15, width: 300, height: 18, content: "COMPARABLE EVIDENCE", fontSize: 14, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#232323", letterSpacing: "0.08em", zIndex: 2 },
      { id: "th", type: "shape", x: 30, y: 55, width: 900, height: 24, backgroundColor: "#232323", zIndex: 2 },
      { id: "tht", type: "text", x: 40, y: 59, width: 880, height: 14, content: "Address                                    Size (sq ft)                     Rent (£psf)                     Date", fontSize: 9, fontFamily: "Work Sans, Arial", color: "#FFFFFF", zIndex: 3 },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `tr${i}`, type: "shape", x: 30, y: 83 + i * 28, width: 900, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 2 })),
      ...Array.from({ length: 7 }, (_, i) => ({ id: `td${i}`, type: "shape", x: 40, y: 88 + i * 28, width: 300 - (i % 3) * 30, height: 6, backgroundColor: "#E7E5DF", borderRadius: 2, zIndex: 2 })),
    ]},
  ]);

  const previewDeckInvestment = deckWrap([
    deckCover("Investment\nProposal", "PROPERTY ADDRESS, LONDON"),
    { backgroundColor: "#FFFFFF", elements: [
      { id: "img", type: "shape", x: 0, y: 0, width: 960, height: 340, backgroundColor: "#00FFFF", zIndex: 1 },
      { id: "imgL", type: "text", x: 410, y: 155, width: 140, height: 16, content: "Property Image", fontSize: 11, fontFamily: "Work Sans, Arial", color: "#666", textAlign: "center", zIndex: 2 },
      ...[["Passing Rent", "£450,000 pa"], ["NIY", "4.75%"], ["Rev. Yield", "5.25%"], ["WAULT", "7.2 yrs"]].map(([l, v], i) => ({
        id: `kv${i}`, type: "shape", x: 30 + i * 230, y: 360, width: 215, height: 65, backgroundColor: "#E7E5DF", zIndex: 2,
      })),
      ...[["Passing Rent", "£450,000 pa"], ["NIY", "4.75%"], ["Rev. Yield", "5.25%"], ["WAULT", "7.2 yrs"]].flatMap(([l, v], i) => [
        { id: `kvl${i}`, type: "text", x: 42 + i * 230, y: 368, width: 190, height: 12, content: l, fontSize: 9, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 3 },
        { id: `kvv${i}`, type: "text", x: 42 + i * 230, y: 388, width: 190, height: 20, content: v, fontSize: 18, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 3 },
      ]),
      ...[["Capital Value", "£9.5m"], ["Lot Size", "Freehold"]].flatMap(([l, v], i) => [
        { id: `kv2l${i}`, type: "text", x: 30 + i * 230, y: 445, width: 190, height: 12, content: l, fontSize: 9, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
        { id: `kv2v${i}`, type: "text", x: 30 + i * 230, y: 463, width: 190, height: 18, content: v, fontSize: 16, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
      ]),
    ]},
    { backgroundColor: "#FFFFFF", elements: [
      { id: "stl", type: "text", x: 30, y: 15, width: 300, height: 18, content: "TENANCY SCHEDULE", fontSize: 14, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#232323", letterSpacing: "0.08em", zIndex: 2 },
      { id: "th", type: "shape", x: 30, y: 55, width: 900, height: 24, backgroundColor: "#232323", zIndex: 2 },
      { id: "tht", type: "text", x: 40, y: 59, width: 880, height: 14, content: "Tenant                     Demise                     Rent (£pa)                     Expiry", fontSize: 9, fontFamily: "Work Sans, Arial", color: "#FFFFFF", zIndex: 3 },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `tr${i}`, type: "shape", x: 30, y: 83 + i * 30, width: 900, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 2 })),
    ]},
  ]);

  const previewDeckLeasing = deckWrap([
    deckCover("Leasing\nStrategy", "SCHEME NAME, LONDON"),
    deckSection("01", "Vision &\nOverview"),
    { backgroundColor: "#FFFFFF", elements: [
      { id: "stl", type: "text", x: 30, y: 15, width: 300, height: 18, content: "TARGET TENANT MIX", fontSize: 14, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#232323", letterSpacing: "0.08em", zIndex: 2 },
      { id: "ttl", type: "text", x: 30, y: 38, width: 400, height: 30, content: "Curated mix for the scheme", fontSize: 22, fontFamily: "Work Sans, Arial", color: "#232323", zIndex: 2 },
      ...["Retail", "F&B", "Leisure", "Wellness"].map((cat, i) => ({
        id: `cat${i}`, type: "shape", x: 30 + i * 230, y: 90, width: 215, height: 200, backgroundColor: i === 0 ? "#232323" : i === 1 ? "#596264" : i === 2 ? "#E7E5DF" : "#DDDFE0", zIndex: 2,
      })),
      ...["Retail", "F&B", "Leisure", "Wellness"].map((cat, i) => ({
        id: `catl${i}`, type: "text", x: 30 + i * 230, y: 170, width: 215, height: 30, content: cat, fontSize: 18, fontFamily: "Work Sans, Arial", fontWeight: "700", color: i < 2 ? "#FFFFFF" : "#232323", textAlign: "center", zIndex: 3,
      })),
      { id: "desc", type: "text", x: 30, y: 310, width: 900, height: 60, content: "Strategy text. We curate a balanced tenant mix to create a vibrant destination that drives footfall and builds long-term rental growth.", fontSize: 12, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
      ...["Phase 1: Q2 2026", "Phase 2: Q4 2026", "Phase 3: Q2 2027"].map((ph, i) => ({
        id: `ph${i}`, type: "shape", x: 30, y: 400 + i * 38, width: 300 + i * 120, height: 26, backgroundColor: "#232323", zIndex: 2,
      })),
      ...["Phase 1: Q2 2026", "Phase 2: Q4 2026", "Phase 3: Q2 2027"].map((ph, i) => ({
        id: `phl${i}`, type: "text", x: 45, y: 404 + i * 38, width: 300, height: 18, content: ph, fontSize: 11, fontFamily: "Work Sans, Arial", fontWeight: "600", color: "#FFFFFF", zIndex: 3,
      })),
    ]},
  ]);

  const previewDeckTeam = deckWrap([
    deckCover("Team\nProfiles", "BRUCE GILLINGHAM POLLARD"),
    { backgroundColor: "#FFFFFF", elements: [
      ...[0,1,2,3].map(i => ({ id: `ph${i}`, type: "shape", x: 30 + i * 230, y: 130, width: 215, height: 220, backgroundColor: "#00FFFF", zIndex: 2 })),
      ...[0,1,2,3].map(i => ({ id: `nm${i}`, type: "text", x: 30 + i * 230, y: 360, width: 215, height: 14, content: "NAME OF PERSON", fontSize: 10, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 })),
      ...[0,1,2,3].map(i => ({ id: `rl${i}`, type: "text", x: 30 + i * 230, y: 378, width: 215, height: 120, content: "ROLE OR COMPANY\n— Bullet point biography\n— Point 2\n— Point 3\n— Point 4", fontSize: 8, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 })),
      { id: "stl", type: "text", x: 30, y: 15, width: 300, height: 18, content: "THE TEAM", fontSize: 14, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#232323", letterSpacing: "0.08em", zIndex: 2 },
      { id: "ttl", type: "text", x: 30, y: 38, width: 400, height: 60, content: "Key people\non this instruction", fontSize: 22, fontFamily: "Work Sans, Arial", color: "#232323", zIndex: 2 },
    ]},
    { backgroundColor: "#FFFFFF", elements: [
      { id: "ph0", type: "shape", x: 30, y: 130, width: 380, height: 320, backgroundColor: "#00FFFF", zIndex: 2 },
      { id: "nm0", type: "text", x: 440, y: 130, width: 480, height: 20, content: "NAME OF PERSON, ROLE OR COMPANY", fontSize: 12, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
      { id: "bio0", type: "text", x: 440, y: 160, width: 480, height: 260, content: "Description. Professional biography text covering background, specialisms, key transactions, and approach to advising clients.\n\nFurther details about notable instructions and market expertise.", fontSize: 11, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
      { id: "stl", type: "text", x: 30, y: 15, width: 300, height: 18, content: "THE TEAM", fontSize: 14, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#232323", letterSpacing: "0.08em", zIndex: 2 },
      { id: "ttl", type: "text", x: 30, y: 38, width: 400, height: 60, content: "Detailed\nbiography", fontSize: 22, fontFamily: "Work Sans, Arial", color: "#232323", zIndex: 2 },
    ]},
  ]);

  const previewDeckCaseStudy = deckWrap([
    deckCover("Case\nStudies", "TRACK RECORD"),
    { backgroundColor: "#FFFFFF", elements: [
      { id: "img", type: "shape", x: 0, y: 0, width: 550, height: 540, backgroundColor: "#00FFFF", zIndex: 1 },
      { id: "imgL", type: "text", x: 225, y: 260, width: 100, height: 16, content: "Image", fontSize: 11, fontFamily: "Work Sans, Arial", color: "#666", textAlign: "center", zIndex: 2 },
      { id: "stl", type: "text", x: 580, y: 40, width: 340, height: 18, content: "CASE STUDY", fontSize: 14, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#232323", letterSpacing: "0.08em", zIndex: 2 },
      { id: "ttl", type: "text", x: 580, y: 65, width: 340, height: 40, content: "Property\nAddress", fontSize: 22, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
      { id: "desc", type: "text", x: 580, y: 120, width: 340, height: 180, content: "Description of the project, transaction, or advisory work completed. Include key details, challenges overcome, and results achieved.\n\nOutcome metrics and client feedback.", fontSize: 11, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
      ...[["Size", "15,000 sq ft"], ["Sector", "Retail"], ["Value", "£8.5m"]].flatMap(([l, v], i) => [
        { id: `kl${i}`, type: "text", x: 580, y: 340 + i * 30, width: 100, height: 14, content: l, fontSize: 9, fontFamily: "Work Sans, Arial", color: "#596264", zIndex: 2 },
        { id: `kv${i}`, type: "text", x: 700, y: 340 + i * 30, width: 200, height: 14, content: v, fontSize: 10, fontFamily: "Work Sans, Arial", fontWeight: "700", color: "#232323", zIndex: 2 },
        { id: `kln${i}`, type: "shape", x: 580, y: 358 + i * 30, width: 340, height: 0.5, backgroundColor: "#DDDFE0", zIndex: 2 },
      ]),
    ]},
    { backgroundColor: "#FFFFFF", elements: [
      ...[0,1,2,3,4,5].map(i => ({ id: `img${i}`, type: "shape", x: 30 + (i % 3) * 305, y: 30 + Math.floor(i / 3) * 255, width: 290, height: 240, backgroundColor: "#00FFFF", zIndex: 2 })),
      ...[0,1,2,3,4,5].map(i => ({ id: `cap${i}`, type: "text", x: 35 + (i % 3) * 305, y: 225 + Math.floor(i / 3) * 255, width: 280, height: 12, content: "CAPTION", fontSize: 8, fontFamily: "Work Sans, Arial", fontWeight: "500", color: "#596264", letterSpacing: "0.06em", zIndex: 3 })),
    ]},
  ]);

  const [previewingPreset, setPreviewingPreset] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");

  const { data: scopeInfo } = useQuery<{ isScoped: boolean; companyId: string | null; team: string | null; isBgpStaff: boolean }>({
    queryKey: ["/api/client-templates/scope-info"],
  });

  const { data: clientTemplates } = useQuery<Array<{ id: string; company_id: string; company_name: string; label: string; description: string; category: string; preview_data: any }>>({
    queryKey: ["/api/client-templates"],
  });

  const isClientScoped = scopeInfo?.isScoped === true;

  const presets = [
    { label: "Marketing Particulars", desc: "Property marketing details: property image, accommodation schedule (NIA sq ft/sq m by floor), rates & service charge, location description, viewing arrangements, and agent contact. Based on BGP marketing details template.", preview: previewMarketingParticulars },
    { label: "Heads of Terms", desc: "Heads of Terms for a commercial lease: property address & NIA, parties (landlord, tenant, guarantor), rent & rent-free period, lease term & break options, rent review mechanism, repair obligations, permitted use, deposits, capital contribution, and legal costs. Subject to contract.", preview: previewHOTs },
    { label: "Pitch Presentation", desc: "Client pitch/brand book presentation: introduction to BGP, what makes us different, service lines (leasing, investment, development, acquisitions, lease consultancy), track record with named case studies, our clients, unique approach (execution, global inspirations, occupier trends, landlord trends), team CVs, and thank you page.", preview: previewPitch },
    { label: "Client Report", desc: "Client advisory report: executive summary, market overview & trends, property analysis (location, accommodation, condition), comparable evidence schedule, valuation commentary with ERV/capital value, SWOT analysis, recommendations, next steps, and appendices.", preview: previewClientReport },
    { label: "Team CV", desc: "Professional team member CV: full name & job title, biographical summary of expertise and specialisms, key landlord instructions & notable transactions, relevant experience & achievements. In BGP branded format.", preview: previewTeamCV },
    { label: "Press Release", desc: "BGP press release: headline, date, main body text covering the news/announcement, relevant quotes, property/transaction details, and BGP boilerplate (areas of expertise: leasing, investment, development, acquisitions, lease consultancy).", preview: previewPressRelease },
    { label: "Tenant Handbook", desc: "Tenant handbook/fit-out guide: property introduction, building management contacts, fit-out requirements & specifications, health & safety procedures, building access & security, waste management, signage guidelines, and general building rules.", preview: previewTenantHandbook },
    { label: "Rent Review Memo", desc: "Internal rent review memorandum: property address, current passing rent, lease term & review pattern, comparable evidence analysis, recommended ERV, negotiation strategy, timeline, and fee estimate.", preview: previewRentReview },
    { label: "Instruction Letter", desc: "Formal instruction letter: addressee details, scope of work, fee basis (% of rent or fixed fee), terms of engagement, conflict of interest disclosure, regulatory disclosures (RICS), and signature block.", preview: previewInstructionLetter },
    { label: "Investment Memo", desc: "Investment memorandum: property summary, tenancy schedule, passing rent & WAULT, market context, comparable investment transactions, pricing analysis (NIY, reversionary yield), recommendation, and risk factors.", preview: previewInvestmentMemo },
    { label: "Leasing Strategy", desc: "Leasing strategy report: scheme overview & vision, catchment analysis, footfall data, competitor audit, target tenant mix by category (retail, F&B, leisure, wellness), phasing plan, rental expectations by unit, marketing plan, and timeline.", preview: previewLeasingStrategy },
    { label: "Requirement Flyer", desc: "Tenant requirement flyer: brand name & logo, concept description, target locations & demographics, unit size requirements (sq ft range), preferred lease terms, brand imagery, and BGP contact details for landlord submissions.", preview: previewRequirementFlyer },
    { label: "Pitch Deck", desc: "Widescreen pitch presentation based on BGP master deck: cover slide, numbered section dividers, introduction with imagery, services overview, 4-image grid page, team profiles with photos, and thank you closing slide. Work Sans font throughout. Add property or project photos.", preview: previewDeckPitch },
    { label: "Property Tour Deck", desc: "Widescreen property presentation: cover slide, hero property image, 4-photo gallery grid, floor plan with accommodation schedule. Designed for property viewings and marketing walkthroughs with photo placeholders.", preview: previewDeckPropertyTour },
    { label: "Market Report Deck", desc: "Widescreen market report presentation: cover slide, section divider, key market indicators (take-up, availability, prime rent, under offer), chart area with commentary sidebar, and comparable evidence table. For quarterly market updates and client briefings.", preview: previewDeckMarket },
    { label: "Investment Deck", desc: "Widescreen investment proposal presentation: cover slide, hero property image with key metrics (passing rent, NIY, reversionary yield, WAULT, capital value), tenancy schedule table. For investment pitches and acquisition proposals.", preview: previewDeckInvestment },
    { label: "Leasing Deck", desc: "Widescreen leasing strategy presentation: cover slide, section divider, target tenant mix categories (retail, F&B, leisure, wellness), phasing timeline, and strategy commentary. For leasing proposals and scheme positioning.", preview: previewDeckLeasing },
    { label: "Team Deck", desc: "Widescreen team profiles presentation: cover slide, 4-person overview page with photos and bullet biographies, detailed single-person biography with large photo. For team introductions and credentials presentations.", preview: previewDeckTeam },
    { label: "Case Study Deck", desc: "Widescreen case study presentation: cover slide, property image with project details and key metrics (size, sector, value), 6-image photo grid with captions. For track record presentations and pitch credentials.", preview: previewDeckCaseStudy },
  ];

  const isBusy = generateMutation.isPending || canvaAutofillMutation.isPending;

  const handlePresetClick = (preset: { label: string; desc: string }) => {
    if (isBusy) return;
    setSelectedPreset(selectedPreset === preset.label ? "" : preset.label);
  };

  const selectedPresetData = presets.find(p => p.label === selectedPreset);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#232323] to-[#444] flex items-center justify-center shadow-sm">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Document Studio</h2>
            <p className="text-sm text-muted-foreground">{isClientScoped ? `${scopeInfo?.team} document templates` : "AI-powered documents with BGP branding"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isClientScoped && canvaStatus?.connected ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs gap-1.5 border-green-200 text-green-700 bg-green-50 hover:bg-green-100" data-testid="button-canva-connected">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Canva
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { setShowCanvaTemplates(!showCanvaTemplates); if (!showCanvaTemplates) refetchCanvaTemplates(); }}>
                  <LayoutTemplate className="w-3.5 h-3.5 mr-2" />
                  Brand Templates
                </DropdownMenuItem>
                <DropdownMenuItem onClick={disconnectCanva} className="text-destructive">
                  <Unlink className="w-3.5 h-3.5 mr-2" />
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : !isClientScoped ? (
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              onClick={connectCanva}
              disabled={canvaConnecting}
              data-testid="button-connect-canva"
            >
              {canvaConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
              Connect Canva
            </Button>
          ) : null}
        </div>
      </div>

      {!isClientScoped && showCanvaTemplates && canvaStatus?.connected && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm flex items-center gap-2">
                  <LayoutTemplate className="w-4 h-4 text-purple-600" />
                  Canva Brand Templates
                </CardTitle>
                <CardDescription className="text-xs">
                  Select a Canva template to auto-fill with generated content. Set up your brand kit and templates at{" "}
                  <a href="https://www.canva.com/brand" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                    canva.com/brand <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => refetchCanvaTemplates()} data-testid="button-refresh-canva-templates">
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {canvaTemplatesLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {[1,2,3,4].map(i => (
                  <Skeleton key={i} className="h-32 rounded-lg" />
                ))}
              </div>
            ) : canvaBrandTemplates && canvaBrandTemplates.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {canvaBrandTemplates.map((t) => (
                  <div
                    key={t.id}
                    className={`relative rounded-lg border cursor-pointer transition-all overflow-hidden hover:shadow-md ${
                      selectedCanvaTemplate?.id === t.id ? "border-purple-500 ring-2 ring-purple-200" : "border-border hover:border-purple-300"
                    }`}
                    onClick={() => { const next = selectedCanvaTemplate?.id === t.id ? null : t; setSelectedCanvaTemplate(next); if (!next) { setSelectedCanvaProperty(null); setCanvaPropertySearch(""); setShowPropertyDropdown(false); } }}
                    data-testid={`canva-template-${t.id}`}
                  >
                    {t.thumbnail ? (
                      <div className="aspect-[4/3] bg-muted">
                        <img src={t.thumbnail} alt={t.title} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="aspect-[4/3] bg-muted flex items-center justify-center">
                        <Image className="w-8 h-8 text-muted-foreground/30" />
                      </div>
                    )}
                    <div className="p-2">
                      <div className="font-medium text-xs truncate">{t.title}</div>
                    </div>
                    {selectedCanvaTemplate?.id === t.id && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <LayoutTemplate className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                <p className="font-medium">No brand templates found</p>
                <p className="text-xs mt-1">
                  Create templates in your Canva account with placeholder text fields, then they'll appear here.
                </p>
                <a href="https://www.canva.com/brand" target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="mt-3" data-testid="button-open-canva-templates">
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    Open Canva Brand Kit
                  </Button>
                </a>
              </div>
            )}
            {selectedCanvaTemplate && (
              <div className="mt-3 space-y-3">
                <div className="p-3 rounded-lg bg-purple-50 border border-purple-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-purple-600" />
                    <span className="text-sm font-medium text-purple-900">
                      Template selected: {selectedCanvaTemplate.title}
                    </span>
                  </div>
                  {canvaTemplateDataset && Object.keys(canvaTemplateDataset).length > 0 ? (
                    <span className="text-xs text-purple-600">
                      {Object.keys(canvaTemplateDataset).length} autofill field{Object.keys(canvaTemplateDataset).length !== 1 ? "s" : ""}: {Object.keys(canvaTemplateDataset).join(", ")}
                    </span>
                  ) : canvaTemplateDataset && Object.keys(canvaTemplateDataset).length === 0 ? (
                    <span className="text-xs text-amber-600">
                      No autofill placeholders found. Open this template in Canva and add data-connected text elements first.
                    </span>
                  ) : (
                    <span className="text-xs text-purple-600">
                      Checking template fields...
                    </span>
                  )}
                </div>

                <div className="p-3 rounded-lg border border-blue-200 bg-blue-50/50">
                  <Label className="text-xs font-medium text-blue-900 mb-1.5 block">
                    Link CRM Property (optional)
                  </Label>
                  <p className="text-[10px] text-blue-700 mb-2">
                    Pull structured property data (address, rent, area, agents) directly into template fields
                  </p>
                  {selectedCanvaProperty ? (
                    <div className="flex items-center gap-2 p-2 rounded bg-white border">
                      <CircleDot className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{selectedCanvaProperty.name}</div>
                        {selectedCanvaProperty.status && (
                          <div className="text-[10px] text-muted-foreground">{selectedCanvaProperty.status}</div>
                        )}
                      </div>
                      {canvaPropertyData && (
                        <Badge variant="secondary" className="text-[10px] shrink-0" data-testid="badge-canva-fields-count">
                          {Object.keys(canvaPropertyData.canvaFields || {}).length} fields
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0"
                        onClick={() => { setSelectedCanvaProperty(null); setCanvaPropertySearch(""); }}
                        data-testid="button-clear-canva-property"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setShowPropertyDropdown(false); }}>
                      <Input
                        placeholder="Search properties..."
                        value={canvaPropertySearch}
                        onChange={(e) => { setCanvaPropertySearch(e.target.value); setShowPropertyDropdown(true); }}
                        onFocus={() => setShowPropertyDropdown(true)}
                        className="h-8 text-xs"
                        data-testid="input-canva-property-search"
                      />
                      {showPropertyDropdown && canvaPropertySearch.length >= 1 && (
                        <div className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {!canvaPropertyResults ? (
                            <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                              <Loader2 className="w-3 h-3 animate-spin" /> Searching...
                            </div>
                          ) : canvaPropertyResults.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-muted-foreground">No properties found</div>
                          ) : (
                            canvaPropertyResults.map((p: any) => (
                              <button
                                key={p.id}
                                className="w-full text-left px-3 py-2 hover:bg-accent text-xs border-b last:border-b-0 transition-colors"
                                onClick={() => {
                                  setSelectedCanvaProperty(p);
                                  setCanvaPropertySearch("");
                                  setShowPropertyDropdown(false);
                                }}
                                data-testid={`canva-property-option-${p.id}`}
                              >
                                <div className="font-medium">{p.name}</div>
                                <div className="text-[10px] text-muted-foreground flex gap-2 mt-0.5">
                                  {p.status && <span>{p.status}</span>}
                                  {p.asset_class && <span>{p.asset_class}</span>}
                                  {p.sqft && <span>{Number(p.sqft).toLocaleString()} sq ft</span>}
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {canvaPropertyData && selectedCanvaProperty && (
                    <div className="mt-2 p-2 rounded bg-white border max-h-32 overflow-y-auto">
                      <div className="text-[10px] font-medium text-muted-foreground mb-1">Mapped Fields Preview</div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                        {Object.entries(canvaPropertyData.canvaFields || {}).slice(0, 12).map(([key, val]) => (
                          <div key={key} className="flex gap-1 text-[10px]">
                            <span className="text-muted-foreground font-mono">{key}:</span>
                            <span className="truncate">{String(val)}</span>
                          </div>
                        ))}
                        {Object.keys(canvaPropertyData.canvaFields || {}).length > 12 && (
                          <div className="text-[10px] text-muted-foreground col-span-2">
                            +{Object.keys(canvaPropertyData.canvaFields || {}).length - 12} more fields
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(() => {
        const categories = [
          { key: "all", label: "All" },
          { key: "presentations", label: "Presentations" },
          { key: "proposals", label: "Proposals" },
          { key: "reports", label: "Reports" },
          { key: "legal", label: "Legal" },
          { key: "internal", label: "Internal" },
          { key: "marketing", label: "Marketing" },
        ];
        const categoryMap: Record<string, string> = {
          "Marketing Particulars": "marketing",
          "Heads of Terms": "legal",
          "Pitch Presentation": "proposals",
          "Client Report": "reports",
          "Team CV": "marketing",
          "Press Release": "marketing",
          "Tenant Handbook": "reports",
          "Rent Review Memo": "internal",
          "Instruction Letter": "legal",
          "Investment Memo": "reports",
          "Leasing Strategy": "proposals",
          "Requirement Flyer": "marketing",
          "Pitch Deck": "presentations",
          "Property Tour Deck": "presentations",
          "Market Report Deck": "presentations",
          "Investment Deck": "presentations",
          "Leasing Deck": "presentations",
          "Team Deck": "presentations",
          "Case Study Deck": "presentations",
        };

        const clientPresetItems = (clientTemplates || []).map(ct => ({
          label: ct.label,
          desc: ct.description || `${ct.company_name} template`,
          preview: ct.preview_data ? (typeof ct.preview_data === "string" ? ct.preview_data : JSON.stringify(ct.preview_data)) : null,
          isClientTemplate: true,
          clientCompany: ct.company_name,
        }));

        const visiblePresets = isClientScoped
          ? clientPresetItems
          : [...presets.map(p => ({ ...p, isClientTemplate: false, clientCompany: "" })), ...clientPresetItems];

        const filteredPresets = activeCategory === "all" ? visiblePresets : visiblePresets.filter(p => {
          if (p.isClientTemplate) return activeCategory === "all";
          return categoryMap[p.label] === activeCategory;
        });

        if (isClientScoped && clientPresetItems.length === 0) {
          return (
            <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 p-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
                <FileText className="w-7 h-7 text-muted-foreground/50" />
              </div>
              <h3 className="font-semibold text-lg mb-2">No templates available yet</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Your {scopeInfo?.team} templates will appear here once they've been set up by your BGP team. You can still use the conversation below to generate documents.
              </p>
            </div>
          );
        }

        return (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  {isClientScoped ? `${scopeInfo?.team} Templates` : "Choose Template"}
                </Label>
                {clientPresetItems.length > 0 && !isClientScoped && (
                  <Badge variant="secondary" className="text-[10px]">{clientPresetItems.length} client</Badge>
                )}
              </div>
              {!isClientScoped && (
                <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
                  {categories.map(cat => (
                    <button
                      key={cat.key}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${activeCategory === cat.key ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      onClick={() => setActiveCategory(cat.key)}
                      data-testid={`filter-cat-${cat.key}`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredPresets.map((p, i) => (
                <div
                  key={p.label}
                  className={`group relative rounded-xl border-2 cursor-pointer transition-all overflow-hidden hover:shadow-lg hover:scale-[1.02] ${
                    selectedPreset === p.label ? "border-[#232323] ring-2 ring-[#232323]/20 shadow-lg" : "border-transparent bg-white shadow-sm hover:border-[#232323]/30"
                  } ${isBusy ? "opacity-50 pointer-events-none" : ""}`}
                  onClick={() => handlePresetClick(p)}
                  data-testid={`preset-doc-${i}`}
                >
                  {(() => {
                    if (!p.preview) {
                      return (
                        <div className="relative bg-[#f5f4f0] overflow-hidden flex items-center justify-center" style={{ height: 220 }}>
                          <div className="text-center">
                            <FileText className="w-12 h-12 text-muted-foreground/20 mx-auto mb-2" />
                            {p.isClientTemplate && <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">Custom Template</span>}
                          </div>
                          <div className="absolute inset-0 bg-gradient-to-t from-white/80 via-transparent to-transparent" />
                          {selectedPreset === p.label && (
                            <div className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-[#232323] flex items-center justify-center shadow-md">
                              <Check className="w-3.5 h-3.5 text-white" />
                            </div>
                          )}
                          <div className="absolute bottom-0 left-0 right-0 px-3 pb-2">
                            {p.isClientTemplate ? (
                              <Badge className="text-[10px] bg-blue-500/90 text-white backdrop-blur-sm border-0 shadow-sm">{p.clientCompany}</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px] bg-white/80 backdrop-blur-sm border-0 shadow-sm">{categoryMap[p.label]?.charAt(0).toUpperCase()}{categoryMap[p.label]?.slice(1)}</Badge>
                            )}
                          </div>
                        </div>
                      );
                    }
                    const isDeck = p.preview.includes('"pageWidth":960');
                    return (
                    <div className="relative bg-[#f5f4f0] overflow-hidden" style={{ height: 220 }}>
                      <div className={`absolute inset-0 flex ${isDeck ? "items-center" : "items-start"} justify-center ${isDeck ? "" : "pt-3"} pointer-events-none`}>
                        <DesignPreview design={p.preview} scale={isDeck ? 0.2 : 0.25} />
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-t from-white/80 via-transparent to-transparent" />
                      {selectedPreset === p.label && (
                        <div className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-[#232323] flex items-center justify-center shadow-md">
                          <Check className="w-3.5 h-3.5 text-white" />
                        </div>
                      )}
                      <button
                        className="absolute top-2.5 left-2.5 px-2.5 py-1.5 rounded-lg bg-white/95 backdrop-blur-sm border shadow-sm flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white"
                        onClick={(e) => { e.stopPropagation(); setPreviewingPreset(p.label); }}
                        title="Preview full template"
                        data-testid={`preview-btn-${i}`}
                      >
                        <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-[10px] font-medium text-muted-foreground">Preview</span>
                      </button>
                      <div className="absolute bottom-0 left-0 right-0 px-3 pb-2">
                        {p.isClientTemplate ? (
                          <Badge className="text-[10px] bg-blue-500/90 text-white backdrop-blur-sm border-0 shadow-sm">
                            {p.clientCompany}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] bg-white/80 backdrop-blur-sm border-0 shadow-sm">
                            {categoryMap[p.label]?.charAt(0).toUpperCase()}{categoryMap[p.label]?.slice(1)}
                          </Badge>
                        )}
                      </div>
                    </div>
                    );
                  })()}
                  <div className="p-3">
                    <div className="font-semibold text-sm text-[#232323]">{p.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{p.desc.split(":")[0]}</div>
                  </div>
                </div>
              ))}
            </div>

            {previewingPreset && (() => {
              const preset = presets.find(p => p.label === previewingPreset);
              if (!preset?.preview) return null;
              let pw = 595, ph = 842, pageCount = 1;
              try { const parsed = JSON.parse(preset.preview); pw = parsed.pageWidth || 595; ph = parsed.pageHeight || 842; pageCount = parsed.pages?.length || 1; } catch {}
              const dialogMaxW = Math.min(window.innerWidth * 0.85, 960);
              const contentW = dialogMaxW - 48;
              const previewScale = contentW / pw;
              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setPreviewingPreset(null)}>
                  <div className="relative bg-white rounded-2xl shadow-2xl w-full mx-4 overflow-hidden" style={{ maxWidth: dialogMaxW }} onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-6 py-3 border-b">
                      <div>
                        <h3 className="font-semibold text-base">{preset.label}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">Template preview — {pageCount} page{pageCount !== 1 ? "s" : ""}</p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setPreviewingPreset(null)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="py-6 px-6 bg-[#f5f4f0]" style={{ maxHeight: "75vh", overflowY: "auto" }}>
                      <DesignPreview design={preset.preview} scale={previewScale} allPages />
                    </div>
                    <div className="px-6 py-3 border-t bg-gray-50/50 flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[#232323]" />
                        <span className="text-xs text-muted-foreground">AI will generate content and imagery for this template</span>
                      </div>
                      <Button size="sm" className="bg-[#232323] hover:bg-[#444] text-white rounded-lg px-4" onClick={() => { setPreviewingPreset(null); setSelectedPreset(preset.label); }}>
                        <Check className="w-3.5 h-3.5 mr-1.5" /> Use Template
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      <Card className={selectedPreset ? "border-[#232323]/20 shadow-md" : "shadow-sm"}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <PenTool className="w-4 h-4 text-[#232323]" />
                {selectedPreset ? `Create ${selectedPreset}` : "Add Details & Generate"}
              </CardTitle>
              <CardDescription className="text-xs">
                {selectedPreset
                  ? "Add specific details, attach reference files, then generate with AI"
                  : "Select a template above, or describe what you need below"}
              </CardDescription>
            </div>
            {selectedPreset && (
              <Badge className="text-xs bg-[#232323]/10 text-[#232323] border-[#232323]/20 hover:bg-[#232323]/15">
                <Sparkles className="w-3 h-3 mr-1" />
                {selectedPreset}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
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
              id="doc-description"
              placeholder={selectedPreset
                ? `Add specific details for your ${selectedPreset} — property address, tenant name, rent, dates, etc. Or leave blank for a standard template...`
                : "Describe the document you need — property address, parties involved, key terms..."}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[80px] text-sm border-0 focus-visible:ring-0 resize-none"
              data-testid="input-doc-studio-description"
            />
            <div className="flex items-center justify-between px-3 pb-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-doc-attach-files"
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
                  data-testid="input-doc-studio-files"
                />
                {dragging && <span className="text-xs text-primary font-medium">Drop files here</span>}
              </div>
              <span className="text-[10px] text-muted-foreground">All file types supported</span>
            </div>
          </div>

          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <Badge key={i} variant="secondary" className="text-xs gap-1 pr-1" data-testid={`badge-doc-file-${i}`}>
                  <FileUp className="w-3 h-3" />
                  {f.name.length > 25 ? f.name.slice(0, 22) + "..." : f.name}
                  <Button variant="ghost" size="icon" className="h-4 w-4 ml-0.5 hover:bg-destructive/20" onClick={() => removeFile(i)} data-testid={`button-remove-doc-file-${i}`}>
                    <X className="w-2.5 h-2.5" />
                  </Button>
                </Badge>
              ))}
            </div>
          )}

          {selectedCanvaTemplate && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-purple-50 border border-purple-200">
                <LayoutTemplate className="w-4 h-4 text-purple-600 shrink-0" />
                <span className="text-xs text-purple-900">
                  Will auto-fill into Canva template: <span className="font-medium">{selectedCanvaTemplate.title}</span>
                </span>
                <Button variant="ghost" size="icon" className="h-5 w-5 ml-auto shrink-0" onClick={() => { setSelectedCanvaTemplate(null); setSelectedCanvaProperty(null); setCanvaPropertySearch(""); setShowPropertyDropdown(false); }}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
              {selectedCanvaProperty && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-50 border border-blue-200">
                  <CircleDot className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span className="text-xs text-blue-900">
                    Property data: <span className="font-medium">{selectedCanvaProperty.name}</span>
                    {canvaPropertyData && <span className="text-blue-600 ml-1">({Object.keys(canvaPropertyData.canvaFields || {}).length} fields)</span>}
                  </span>
                  <Button variant="ghost" size="icon" className="h-5 w-5 ml-auto shrink-0" onClick={() => { setSelectedCanvaProperty(null); setCanvaPropertySearch(""); }}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </div>
          )}

          <Button
            onClick={() => generateMutation.mutate({ presetLabel: selectedPreset || undefined, presetDesc: selectedPresetData?.desc })}
            disabled={(!description.trim() && !selectedPreset && files.length === 0) || isBusy}
            className="w-full bg-[#232323] hover:bg-[#333] text-white rounded-xl h-12 text-sm font-medium"
            size="lg"
            data-testid="button-generate-document"
          >
            {isBusy ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating{selectedPreset ? ` ${selectedPreset}` : " document"}...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate{files.length > 0 ? ` from ${files.length} file${files.length > 1 ? "s" : ""}` : ""}
                {selectedCanvaTemplate ? " → Canva" : ""}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

interface DocumentRun {
  id: string;
  name: string;
  document_type: string | null;
  description: string | null;
  content: string;
  status: string;
  source_files: string[] | null;
  created_at: string;
  canva_design_id: string | null;
  canva_edit_url: string | null;
  canva_view_url: string | null;
  canva_export_url: string | null;
  design?: string | null;
}

function DocumentEditor({ run, onClose, autoDesign }: { run: DocumentRun; onClose: () => void; autoDesign?: boolean }) {
  const { toast } = useToast();

  return (
    <DocumentDesigner
      templateId={`run-${run.id}`}
      templateName={run.name}
      templateContent={run.content}
      initialDesign={run.design || undefined}
      autoDesign={autoDesign && !run.design}
      onSave={async (designJson: string) => {
        await apiRequest("PATCH", `/api/doc-runs/${run.id}`, { name: run.name, content: run.content, design: designJson });
        queryClient.invalidateQueries({ queryKey: ["/api/doc-runs"] });
        toast({ title: "Document saved" });
        onClose();
      }}
      onCancel={onClose}
    />
  );
}

const BGP_PREVIEW_FONTS = `
@font-face {
  font-family: 'Grotta';
  src: url('/api/branding/fonts/Grotta-Regular-q93rrw.otf') format('opentype');
  font-weight: normal; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Neue Machina';
  src: url('/api/branding/fonts/Neue%20Machina%20Regular-e896.otf') format('opentype');
  font-weight: normal; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'MinionPro';
  src: url('/api/branding/fonts/MinionPro-Regular.otf') format('opentype');
  font-weight: normal; font-style: normal; font-display: swap;
}
@font-face {
  font-family: 'Space Mono';
  src: url('https://fonts.gstatic.com/s/spacemono/v13/i7dPIFZifjKcF5UAWdDRYEF8RQ.woff2') format('woff2');
  font-weight: normal; font-style: normal; font-display: swap;
}
`;

let bgpFontsInjected = false;
function injectBGPFonts() {
  if (bgpFontsInjected) return;
  bgpFontsInjected = true;
  const style = document.createElement("style");
  style.textContent = BGP_PREVIEW_FONTS;
  document.head.appendChild(style);
}

function DesignPreview({ design, scale = 0.35, allPages = false }: { design: string; scale?: number; allPages?: boolean }) {
  useEffect(() => { injectBGPFonts(); }, []);
  try {
    const parsed = JSON.parse(design);
    if (!parsed.pages || !Array.isArray(parsed.pages) || parsed.pages.length === 0) return null;
    const pw = parsed.pageWidth || 595;
    const ph = parsed.pageHeight || 842;
    const pagesToRender = allPages ? parsed.pages : [parsed.pages[0]];
    return (
      <div className="flex flex-col gap-3">
        {pagesToRender.map((page: any, pageIdx: number) => (
          <div
            key={page.id || pageIdx}
            className="relative overflow-hidden border rounded-md shadow-sm"
            style={{
              width: pw * scale,
              height: ph * scale,
              backgroundColor: page.backgroundColor || "#ffffff",
            }}
          >
            {(page.elements || []).map((el: any) => {
              const style: React.CSSProperties = {
                position: "absolute",
                left: el.x * scale,
                top: el.y * scale,
                width: el.width * scale,
                height: el.height * scale,
                opacity: el.opacity ?? 1,
                zIndex: el.zIndex ?? 0,
                overflow: "hidden",
              };
              if (el.type === "text") {
                return (
                  <div
                    key={el.id}
                    style={{
                      ...style,
                      fontSize: (el.fontSize || 12) * scale,
                      fontFamily: el.fontFamily || "Arial, sans-serif",
                      fontWeight: el.fontWeight || "normal",
                      fontStyle: el.fontStyle || "normal",
                      textAlign: (el.textAlign as any) || "left",
                      color: el.color || "#000000",
                      backgroundColor: el.backgroundColor || "transparent",
                      borderWidth: (el.borderWidth || 0) * scale,
                      borderColor: el.borderColor || "transparent",
                      borderStyle: el.borderWidth ? "solid" : "none",
                      borderRadius: (el.borderRadius || 0) * scale,
                      lineHeight: 1.3,
                      letterSpacing: el.letterSpacing ? (typeof el.letterSpacing === 'number' ? `${el.letterSpacing * scale}px` : el.letterSpacing) : undefined,
                      textTransform: (el.textTransform as any) || undefined,
                    }}
                  >
                    {el.content}
                  </div>
                );
              }
              if (el.type === "shape") {
                return (
                  <div
                    key={el.id}
                    style={{
                      ...style,
                      backgroundColor: el.backgroundColor || "transparent",
                      borderWidth: (el.borderWidth || 0) * scale,
                      borderColor: el.borderColor || "transparent",
                      borderStyle: el.borderWidth ? "solid" : "none",
                      borderRadius: el.shapeType === "circle" ? "50%" : (el.borderRadius || 0) * scale,
                    }}
                  />
                );
              }
              if (el.type === "image" && el.src) {
                return (
                  <img
                    key={el.id}
                    src={el.src}
                    style={{ ...style, objectFit: el.objectFit || "cover" }}
                    alt=""
                  />
                );
              }
              return null;
            })}
          </div>
        ))}
      </div>
    );
  } catch {
    return null;
  }
}

function DocumentRunsTab({ onEditRun }: { onEditRun?: (run: DocumentRun) => void }) {
  const { toast } = useToast();
  const [previewRun, setPreviewRun] = useState<string | null>(null);

  const { data: runs, isLoading } = useQuery<DocumentRun[]>({
    queryKey: ["/api/doc-runs"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/doc-runs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/doc-runs"] });
      toast({ title: "Document deleted" });
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-72 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!runs?.length) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-medium text-lg mb-2">No documents yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Go to Document Studio to generate your first document. All documents will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (previewRun) {
    const run = runs.find(r => r.id === previewRun);
    if (run) {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setPreviewRun(null)} data-testid="button-back-to-library">
              <ChevronRight className="w-4 h-4 mr-1 rotate-180" />
              Back to Library
            </Button>
            <div className="flex-1" />
            {onEditRun && (
              <Button variant="default" size="sm" onClick={() => onEditRun(run)} data-testid={`button-edit-preview-${run.id}`}>
                <Edit3 className="w-3.5 h-3.5 mr-1" />
                Edit in Designer
              </Button>
            )}
            <DownloadButtons content={run.content} title={run.name} documentType={run.document_type || undefined} size="sm" />
            <Button variant="ghost" size="sm" onClick={() => copyToClipboard(run.content)} data-testid={`button-copy-preview-${run.id}`}>
              <Copy className="w-3.5 h-3.5 mr-1" /> Copy
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Delete"
              onClick={() => { deleteMutation.mutate(run.id); setPreviewRun(null); }}
              data-testid={`button-delete-preview-${run.id}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="text-center">
            <h3 className="font-semibold text-lg">{run.name}</h3>
            <p className="text-xs text-muted-foreground mt-1">
              {run.created_at ? new Date(run.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
              {run.document_type && <> · {run.document_type}</>}
            </p>
          </div>
          {run.design ? (
            <div className="flex justify-center" style={{ maxHeight: "600px", overflowY: "auto" }}>
              <DesignPreview design={run.design} scale={0.75} allPages />
            </div>
          ) : (
            <Card>
              <CardContent className="py-6">
                <ScrollArea className="max-h-[600px]">
                  <div className="whitespace-pre-wrap text-sm leading-relaxed" data-testid={`text-doc-preview-content-${run.id}`}>
                    {run.content}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{runs.length} document{runs.length !== 1 ? "s" : ""}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {runs.map((run) => (
          <Card
            key={run.id}
            className="overflow-hidden cursor-pointer hover:shadow-md transition-all hover:border-primary/30 group"
            onClick={() => setPreviewRun(run.id)}
            data-testid={`card-doc-run-${run.id}`}
          >
            <div className="p-3 flex justify-center bg-muted/30">
              {run.design ? (
                <DesignPreview design={run.design} scale={0.28} />
              ) : (
                <div
                  className="border rounded-md bg-white shadow-sm flex items-start p-2 overflow-hidden"
                  style={{ width: 595 * 0.28, height: 842 * 0.28 }}
                >
                  <div className="text-[3.5px] text-muted-foreground leading-tight line-clamp-[30] font-mono">
                    {run.content.slice(0, 800)}
                  </div>
                </div>
              )}
            </div>
            <div className="p-3 border-t">
              <h4 className="text-xs font-medium truncate" data-testid={`text-doc-run-name-${run.id}`}>{run.name}</h4>
              <div className="flex items-center gap-1.5 mt-1">
                <p className="text-[10px] text-muted-foreground truncate">
                  {run.created_at ? new Date(run.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
                </p>
                {run.document_type && (
                  <Badge variant="secondary" className="text-[8px] h-3.5 px-1">{run.document_type}</Badge>
                )}
                {run.design && (
                  <Badge variant="outline" className="text-[8px] h-3.5 px-1 border-blue-200 text-blue-600">Designed</Badge>
                )}
              </div>
              <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                {onEditRun && (
                  <Button variant="ghost" size="icon" className="h-6 w-6" title="Edit"
                    onClick={() => onEditRun(run)}
                    data-testid={`button-edit-doc-run-${run.id}`}
                  >
                    <Edit3 className="w-3 h-3" />
                  </Button>
                )}
                <DownloadButtons content={run.content} title={run.name} documentType={run.document_type || undefined} size="sm" />
                <Button variant="ghost" size="icon" className="h-6 w-6" title="Copy"
                  onClick={() => copyToClipboard(run.content)}
                  data-testid={`button-copy-doc-run-${run.id}`}
                >
                  <Copy className="w-3 h-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" title="Delete"
                  onClick={() => deleteMutation.mutate(run.id)}
                  data-testid={`button-delete-doc-run-${run.id}`}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function TemplatePreview({
  template,
  onApprove,
  onEdit,
  onDesign,
  onUse,
  onSmartGenerate,
  onDelete,
  approving,
  deleting,
}: {
  template: DocumentTemplate;
  onApprove: () => void;
  onEdit: () => void;
  onDesign: () => void;
  onUse: () => void;
  onSmartGenerate: () => void;
  onDelete: () => void;
  approving: boolean;
  deleting: boolean;
}) {
  const sections = Array.from(new Set(template.fields.map((f) => f.section)));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle data-testid="text-preview-title">{template.name}</CardTitle>
              <CardDescription className="mt-1">{template.description}</CardDescription>
              <p className="text-xs text-muted-foreground mt-2">
                Source: {template.sourceFileName}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              {template.status === "draft" && (
                <Button onClick={onApprove} disabled={approving} data-testid="button-approve-template">
                  {approving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  Approve
                </Button>
              )}
              {template.status === "approved" && (
                <>
                  <Button onClick={onSmartGenerate} data-testid="button-smart-generate-template">
                    <Sparkles className="w-4 h-4 mr-2" />
                    Document Studio
                  </Button>
                  <Button variant="outline" onClick={onUse} data-testid="button-use-template">
                    <PenTool className="w-4 h-4 mr-2" />
                    Fill Manually
                  </Button>
                </>
              )}
              <Button variant="outline" onClick={onDesign} data-testid="button-design-template">
                <Palette className="w-4 h-4 mr-2" />
                Visual Designer
              </Button>
              <Button variant="outline" onClick={onEdit} data-testid="button-edit-template">
                <Edit3 className="w-4 h-4 mr-2" />
                Edit
              </Button>
              <Button variant="destructive" size="icon" onClick={onDelete} disabled={deleting} data-testid="button-delete-template">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4" />
            Fillable Fields ({template.fields.length})
          </CardTitle>
          <CardDescription>These are the fields the AI identified that you can fill in when using this template</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {sections.map((section) => (
              <div key={section}>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">{section}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {template.fields
                    .filter((f) => f.section === section)
                    .map((field) => (
                      <div
                        key={field.id}
                        className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-sm"
                        data-testid={`field-preview-${field.id}`}
                      >
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {field.type}
                        </Badge>
                        <span className="font-medium">{field.label}</span>
                        <span className="text-muted-foreground text-xs truncate ml-auto">
                          e.g. {field.placeholder}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="w-4 h-4" />
            Template Preview
          </CardTitle>
          <CardDescription>The template content with placeholders shown in highlighted text</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed">
              {renderTemplateContent(template.templateContent)}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function renderTemplateContent(content: string) {
  const parts = content.split(/(\{\{[^}]+\}\})/g);
  return parts.map((part, i) => {
    if (part.startsWith("{{") && part.endsWith("}}")) {
      const fieldId = part.slice(2, -2);
      return (
        <span
          key={i}
          className="inline-block bg-primary/10 text-primary border border-primary/20 rounded px-1.5 py-0.5 text-xs font-mono"
        >
          {fieldId}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function EditTemplateView({
  name,
  description,
  content,
  fields,
  onNameChange,
  onDescriptionChange,
  onContentChange,
  onFieldsChange,
  onSave,
  onCancel,
  saving,
}: {
  name: string;
  description: string;
  content: string;
  fields: TemplateField[];
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onContentChange: (v: string) => void;
  onFieldsChange: (v: TemplateField[]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const removeField = (id: string) => {
    onFieldsChange(fields.filter((f) => f.id !== id));
  };

  const updateField = (id: string, key: keyof TemplateField, value: string) => {
    onFieldsChange(
      fields.map((f) => (f.id === id ? { ...f, [key]: value } : f))
    );
  };

  const addField = () => {
    const newId = `field${Date.now()}`;
    onFieldsChange([
      ...fields,
      { id: newId, label: "New Field", type: "text", placeholder: "", section: "General" },
    ]);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Edit Template</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onCancel} data-testid="button-cancel-edit">
                Cancel
              </Button>
              <Button onClick={onSave} disabled={saving} data-testid="button-save-edit">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Save Changes
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Template Name</Label>
              <Input value={name} onChange={(e) => onNameChange(e.target.value)} data-testid="input-edit-name" />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={description} onChange={(e) => onDescriptionChange(e.target.value)} data-testid="input-edit-description" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Fields ({fields.length})</CardTitle>
            <Button variant="outline" size="sm" onClick={addField} data-testid="button-add-field">
              Add Field
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {fields.map((field) => (
              <div key={field.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                <Input
                  value={field.label}
                  onChange={(e) => updateField(field.id, "label", e.target.value)}
                  className="h-8 text-sm flex-1"
                  placeholder="Label"
                  data-testid={`input-field-label-${field.id}`}
                />
                <select
                  value={field.type}
                  onChange={(e) => updateField(field.id, "type", e.target.value)}
                  className="h-8 text-sm border rounded-md px-2 bg-background"
                  data-testid={`select-field-type-${field.id}`}
                >
                  <option value="text">Text</option>
                  <option value="textarea">Long Text</option>
                  <option value="number">Number</option>
                  <option value="currency">Currency</option>
                  <option value="date">Date</option>
                  <option value="list">List</option>
                </select>
                <Input
                  value={field.section}
                  onChange={(e) => updateField(field.id, "section", e.target.value)}
                  className="h-8 text-sm w-32"
                  placeholder="Section"
                  data-testid={`input-field-section-${field.id}`}
                />
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeField(field.id)} data-testid={`button-remove-field-${field.id}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Template Content</CardTitle>
          <CardDescription>Use {"{{fieldId}}"} to insert placeholder fields</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
            className="min-h-[400px] font-mono text-sm"
            data-testid="textarea-edit-content"
          />
        </CardContent>
      </Card>
    </div>
  );
}

const DEFAULT_DESIGN: TemplateDesign = {
  fontFamily: "Georgia, serif",
  fontSize: "11pt",
  headingFont: "Helvetica Neue, Arial, sans-serif",
  headingSize: "16pt",
  headingColor: "#1a1a1a",
  bodyColor: "#333333",
  accentColor: "#1a1a1a",
  showLogo: true,
  logoPosition: "top-left",
  headerText: "Bruce Gillingham Pollard",
  footerText: "",
  pageMargin: "normal",
  lineSpacing: "1.5",
  letterhead: true,
  borderStyle: "none",
  borderColor: "#cccccc",
};

const FONT_OPTIONS = [
  { label: "Georgia (Serif)", value: "Georgia, serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Helvetica Neue", value: "'Helvetica Neue', Arial, sans-serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Garamond", value: "Garamond, serif" },
  { label: "Calibri", value: "Calibri, sans-serif" },
];

const LOGO_POSITIONS = [
  { label: "Top Left", value: "top-left" },
  { label: "Top Centre", value: "top-center" },
  { label: "Top Right", value: "top-right" },
];

const MARGIN_OPTIONS = [
  { label: "Narrow", value: "narrow" },
  { label: "Normal", value: "normal" },
  { label: "Wide", value: "wide" },
];

const BORDER_OPTIONS = [
  { label: "None", value: "none" },
  { label: "Thin Line", value: "thin" },
  { label: "Double Line", value: "double" },
  { label: "Thick Line", value: "thick" },
];

function DesignTemplateView({
  template,
  onSave,
  onCancel,
}: {
  template: DocumentTemplate;
  onSave: (design: TemplateDesign) => Promise<void>;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const existing: TemplateDesign = (() => {
    try { return template.design ? { ...DEFAULT_DESIGN, ...JSON.parse(template.design) } : { ...DEFAULT_DESIGN }; }
    catch { return { ...DEFAULT_DESIGN }; }
  })();
  const [design, setDesign] = useState<TemplateDesign>(existing);
  const [saving, setSaving] = useState(false);
  const [autoDesigning, setAutoDesigning] = useState(false);

  const handleAutoDesign = async () => {
    setAutoDesigning(true);
    try {
      const res = await apiRequest("POST", `/api/doc-templates/${template.id}/auto-design`);
      const updated = await res.json();
      const newDesign: TemplateDesign = (() => {
        try { return updated.design ? { ...DEFAULT_DESIGN, ...JSON.parse(updated.design) } : { ...DEFAULT_DESIGN }; }
        catch { return { ...DEFAULT_DESIGN }; }
      })();
      setDesign(newDesign);
      toast({ title: "Auto Design applied", description: "Your template has been designed based on BGP branding guidelines." });
    } catch (err: any) {
      toast({ title: "Auto Design failed", description: err.message, variant: "destructive" });
    }
    setAutoDesigning(false);
  };

  const update = (key: keyof TemplateDesign, value: any) => {
    setDesign(prev => ({ ...prev, [key]: value }));
  };

  const marginPx = design.pageMargin === "narrow" ? "24px" : design.pageMargin === "wide" ? "64px" : "40px";
  const borderCss = design.borderStyle === "thin" ? `1px solid ${design.borderColor}`
    : design.borderStyle === "double" ? `3px double ${design.borderColor}`
    : design.borderStyle === "thick" ? `3px solid ${design.borderColor}` : "none";

  const previewContent = template.templateContent.slice(0, 1500) + (template.templateContent.length > 1500 ? "\n..." : "");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Palette className="w-5 h-5" />
              Design Template
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onCancel} data-testid="button-cancel-design">Cancel</Button>
              <Button
                onClick={async () => { setSaving(true); await onSave(design); setSaving(false); }}
                disabled={saving}
                data-testid="button-save-design"
              >
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Save Design
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Typography</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Body Font</Label>
                <select
                  value={design.fontFamily}
                  onChange={e => update("fontFamily", e.target.value)}
                  className="w-full h-9 text-sm border rounded-md px-3 bg-background"
                  data-testid="select-body-font"
                >
                  {FONT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Body Size</Label>
                  <select
                    value={design.fontSize}
                    onChange={e => update("fontSize", e.target.value)}
                    className="w-full h-9 text-sm border rounded-md px-3 bg-background"
                    data-testid="select-body-size"
                  >
                    {["9pt","10pt","11pt","12pt","13pt","14pt"].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Line Spacing</Label>
                  <select
                    value={design.lineSpacing}
                    onChange={e => update("lineSpacing", e.target.value)}
                    className="w-full h-9 text-sm border rounded-md px-3 bg-background"
                    data-testid="select-line-spacing"
                  >
                    {["1","1.15","1.5","1.75","2"].map(s => <option key={s} value={s}>{s + "×"}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Heading Font</Label>
                <select
                  value={design.headingFont}
                  onChange={e => update("headingFont", e.target.value)}
                  className="w-full h-9 text-sm border rounded-md px-3 bg-background"
                  data-testid="select-heading-font"
                >
                  {FONT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Heading Size</Label>
                  <select
                    value={design.headingSize}
                    onChange={e => update("headingSize", e.target.value)}
                    className="w-full h-9 text-sm border rounded-md px-3 bg-background"
                    data-testid="select-heading-size"
                  >
                    {["12pt","14pt","16pt","18pt","20pt","24pt"].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Page Margins</Label>
                  <select
                    value={design.pageMargin}
                    onChange={e => update("pageMargin", e.target.value)}
                    className="w-full h-9 text-sm border rounded-md px-3 bg-background"
                    data-testid="select-page-margins"
                  >
                    {MARGIN_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Colours</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Heading</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="color" value={design.headingColor} onChange={e => update("headingColor", e.target.value)} className="w-8 h-8 rounded border cursor-pointer" data-testid="input-heading-color" />
                    <span className="text-xs text-muted-foreground font-mono">{design.headingColor}</span>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Body Text</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="color" value={design.bodyColor} onChange={e => update("bodyColor", e.target.value)} className="w-8 h-8 rounded border cursor-pointer" data-testid="input-body-color" />
                    <span className="text-xs text-muted-foreground font-mono">{design.bodyColor}</span>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Accent</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="color" value={design.accentColor} onChange={e => update("accentColor", e.target.value)} className="w-8 h-8 rounded border cursor-pointer" data-testid="input-accent-color" />
                    <span className="text-xs text-muted-foreground font-mono">{design.accentColor}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Branding & Layout</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Show BGP Logo</Label>
                <button
                  onClick={() => update("showLogo", !design.showLogo)}
                  className={`w-10 h-5 rounded-full transition-colors ${design.showLogo ? "bg-primary" : "bg-muted"}`}
                  data-testid="toggle-show-logo"
                >
                  <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${design.showLogo ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </div>
              {design.showLogo && (
                <div>
                  <Label className="text-xs">Logo Position</Label>
                  <select
                    value={design.logoPosition}
                    onChange={e => update("logoPosition", e.target.value)}
                    className="w-full h-9 text-sm border rounded-md px-3 bg-background"
                    data-testid="select-logo-position"
                  >
                    {LOGO_POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              )}
              <div className="flex items-center justify-between">
                <Label className="text-xs">Letterhead Style</Label>
                <button
                  onClick={() => update("letterhead", !design.letterhead)}
                  className={`w-10 h-5 rounded-full transition-colors ${design.letterhead ? "bg-primary" : "bg-muted"}`}
                  data-testid="toggle-letterhead"
                >
                  <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${design.letterhead ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </div>
              <div>
                <Label className="text-xs">Header Text</Label>
                <Input value={design.headerText || ""} onChange={e => update("headerText", e.target.value)} className="h-8 text-sm" data-testid="input-header-text" />
              </div>
              <div>
                <Label className="text-xs">Footer Text</Label>
                <Input value={design.footerText || ""} onChange={e => update("footerText", e.target.value)} className="h-8 text-sm" placeholder="e.g. Confidential — BGP" data-testid="input-footer-text" />
              </div>
              <div>
                <Label className="text-xs">Border</Label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={design.borderStyle}
                    onChange={e => update("borderStyle", e.target.value)}
                    className="h-9 text-sm border rounded-md px-3 bg-background"
                    data-testid="select-border-style"
                  >
                    {BORDER_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                  </select>
                  {design.borderStyle !== "none" && (
                    <div className="flex items-center gap-2">
                      <input type="color" value={design.borderColor} onChange={e => update("borderColor", e.target.value)} className="w-8 h-8 rounded border cursor-pointer" data-testid="input-border-color" />
                      <span className="text-xs text-muted-foreground font-mono">{design.borderColor}</span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Live Preview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-white rounded-lg shadow-md overflow-hidden" style={{ border: borderCss }}>
              {design.letterhead && (
                <div className="border-b px-4 py-3" style={{ borderColor: design.accentColor || "#1a1a1a" }}>
                  <div className={`flex items-center gap-3 ${design.logoPosition === "top-center" ? "justify-center" : design.logoPosition === "top-right" ? "justify-end" : "justify-start"}`}>
                    {design.showLogo && (
                      <img src={bgpLogoDark} alt="BGP" className="h-8 w-auto" />
                    )}
                    {design.headerText && (
                      <span style={{ fontFamily: design.headingFont, color: design.headingColor, fontSize: "10pt", fontWeight: 600, letterSpacing: "0.5px" }}>
                        {design.headerText}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {!design.letterhead && design.showLogo && (
                <div className={`px-4 pt-4 flex ${design.logoPosition === "top-center" ? "justify-center" : design.logoPosition === "top-right" ? "justify-end" : "justify-start"}`}>
                  <img src={bgpLogoDark} alt="BGP" className="h-10 w-auto" />
                </div>
              )}

              <div style={{ padding: marginPx }}>
                <h2 style={{
                  fontFamily: design.headingFont,
                  fontSize: design.headingSize,
                  color: design.headingColor,
                  fontWeight: 700,
                  marginBottom: "12px",
                }}>
                  {template.name}
                </h2>
                <div style={{
                  fontFamily: design.fontFamily,
                  fontSize: design.fontSize,
                  color: design.bodyColor,
                  lineHeight: design.lineSpacing,
                  whiteSpace: "pre-wrap",
                }}>
                  {previewContent.split(/(\{\{[^}]+\}\})/g).map((part, i) => {
                    if (part.startsWith("{{") && part.endsWith("}}")) {
                      return (
                        <span key={i} style={{
                          backgroundColor: `${design.accentColor}15`,
                          color: design.accentColor,
                          border: `1px solid ${design.accentColor}30`,
                          borderRadius: "3px",
                          padding: "1px 5px",
                          fontSize: "0.85em",
                          fontFamily: "monospace",
                        }}>
                          {part.slice(2, -2)}
                        </span>
                      );
                    }
                    return <span key={i}>{part}</span>;
                  })}
                </div>
              </div>

              {design.footerText && (
                <div className="border-t px-4 py-2 text-center" style={{ borderColor: `${design.accentColor}40` }}>
                  <span style={{ fontFamily: design.fontFamily, fontSize: "8pt", color: design.bodyColor, opacity: 0.6 }}>
                    {design.footerText}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function UseTemplateView({
  template,
  fieldValues,
  setFieldValues,
  generatedContent,
  generateMutation,
  onCopy,
  onBack,
}: {
  template: DocumentTemplate;
  fieldValues: Record<string, string>;
  setFieldValues: (v: Record<string, string>) => void;
  generatedContent: string | null;
  generateMutation: any;
  onCopy: (text: string) => void;
  onBack: () => void;
}) {
  const sections = Array.from(new Set(template.fields.map((f) => f.section)));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Fill Manually: {template.name}</CardTitle>
              <CardDescription>Fill in the fields below and generate your document</CardDescription>
            </div>
            <Button variant="outline" onClick={onBack} data-testid="button-back-to-preview">
              Back
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {sections.map((section) => (
              <div key={section}>
                <h4 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">{section}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {template.fields
                    .filter((f) => f.section === section)
                    .map((field) => (
                      <div key={field.id}>
                        <Label className="text-sm">{field.label}</Label>
                        {field.type === "textarea" ? (
                          <Textarea
                            value={fieldValues[field.id] || ""}
                            onChange={(e) =>
                              setFieldValues({ ...fieldValues, [field.id]: e.target.value })
                            }
                            placeholder={field.placeholder}
                            className="mt-1"
                            data-testid={`input-use-${field.id}`}
                          />
                        ) : (
                          <Input
                            type={field.type === "number" || field.type === "currency" ? "text" : field.type === "date" ? "date" : "text"}
                            value={fieldValues[field.id] || ""}
                            onChange={(e) =>
                              setFieldValues({ ...fieldValues, [field.id]: e.target.value })
                            }
                            placeholder={field.placeholder}
                            className="mt-1"
                            data-testid={`input-use-${field.id}`}
                          />
                        )}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <Button
              onClick={() =>
                generateMutation.mutate({ id: template.id, fieldValues })
              }
              disabled={generateMutation.isPending}
              className="w-full"
              data-testid="button-generate-document"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Document
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {generatedContent && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Check className="w-4 h-4 text-green-500" />
                Generated Document
              </CardTitle>
              <Button variant="outline" size="sm" onClick={() => onCopy(generatedContent)} data-testid="button-copy-document">
                <Copy className="w-4 h-4 mr-2" />
                Copy to Clipboard
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px]">
              <div className="whitespace-pre-wrap text-sm leading-relaxed font-serif" data-testid="text-generated-content">
                {generatedContent}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface LegalIssue {
  severity: "red" | "amber" | "green";
  category: string;
  title: string;
  detail: string;
  clause?: string;
  recommendation: string;
}

interface LegalAnalysisResult {
  documentType: string;
  parties: string[];
  summary: string;
  keyTerms: { label: string; value: string }[];
  issues: LegalIssue[];
  overallRisk: "high" | "medium" | "low";
  nextSteps: string[];
}

interface DDFileResult {
  fileName: string;
  category: string;
  summary: string;
  issues: LegalIssue[];
  suggestedFolder: string;
}

interface DDResult {
  dealName: string;
  overallSummary: string;
  overallRisk: "high" | "medium" | "low";
  fileAnalyses: DDFileResult[];
  redFlags: number;
  amberFlags: number;
  greenFlags: number;
  folderMapping: { fileName: string; targetFolder: string }[];
  keyRisks: string[];
  recommendations: string[];
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "red") return <Badge className="bg-red-500 text-white border-0 text-[10px]" data-testid="badge-severity-red"><ShieldAlert className="w-3 h-3 mr-1" />Red</Badge>;
  if (severity === "amber") return <Badge className="bg-amber-500 text-white border-0 text-[10px]" data-testid="badge-severity-amber"><Shield className="w-3 h-3 mr-1" />Amber</Badge>;
  return <Badge className="bg-green-500 text-white border-0 text-[10px]" data-testid="badge-severity-green"><ShieldCheck className="w-3 h-3 mr-1" />Green</Badge>;
}

function RiskBadge({ risk }: { risk: string }) {
  const classes = risk === "high" ? "bg-red-500/10 text-red-600 border-red-500/30" : risk === "medium" ? "bg-amber-500/10 text-amber-600 border-amber-500/30" : "bg-green-500/10 text-green-600 border-green-500/30";
  return <Badge variant="outline" className={`${classes} text-xs`} data-testid="badge-risk">{risk.charAt(0).toUpperCase() + risk.slice(1)} Risk</Badge>;
}

function IssueCard({ issue, index }: { issue: LegalIssue; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const borderClass = issue.severity === "red" ? "border-l-red-500" : issue.severity === "amber" ? "border-l-amber-500" : "border-l-green-500";

  return (
    <div className={`border-l-4 ${borderClass} rounded-r-lg border border-border p-3 space-y-2`} data-testid={`issue-card-${index}`}>
      <div className="flex items-start justify-between gap-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <SeverityBadge severity={issue.severity} />
          <Badge variant="outline" className="text-[10px] shrink-0">{issue.category}</Badge>
          <span className="text-sm font-medium truncate">{issue.title}</span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />}
      </div>
      {expanded && (
        <div className="space-y-2 pt-1">
          <p className="text-sm text-muted-foreground">{issue.detail}</p>
          {issue.clause && <p className="text-xs text-muted-foreground"><span className="font-medium">Clause:</span> {issue.clause}</p>}
          <div className="flex items-start gap-1.5 bg-primary/5 rounded-md p-2">
            <Sparkles className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
            <p className="text-xs">{issue.recommendation}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function LegalDDTab() {
  const { toast } = useToast();
  const [mode, setMode] = useState<"legal" | "dd">("legal");
  const [legalFiles, setLegalFiles] = useState<File[]>([]);
  const [ddFiles, setDdFiles] = useState<File[]>([]);
  const [dealName, setDealName] = useState("");
  const [ddTeam, setDdTeam] = useState("Investment");
  const [legalResults, setLegalResults] = useState<LegalAnalysisResult[] | null>(null);
  const [ddResult, setDdResult] = useState<DDResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectCreated, setProjectCreated] = useState<string | null>(null);
  const [activeDocIndex, setActiveDocIndex] = useState(0);
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [expandedDDFile, setExpandedDDFile] = useState<number | null>(null);

  const handleLegalAnalysis = async () => {
    if (legalFiles.length === 0) return;
    setAnalyzing(true);
    setLegalResults(null);
    try {
      const formData = new FormData();
      legalFiles.forEach(f => formData.append("files", f));
      const res = await fetch("/api/legal-dd/analyze", { method: "POST", headers: { ...getAuthHeaders() }, body: formData, credentials: "include" });
      if (!res.ok) { let errMsg = "Analysis failed"; try { const t = await res.text(); errMsg = JSON.parse(t).message || errMsg; } catch {} throw new Error(errMsg); }
      const data = await res.json();
      setLegalResults(data.analyses);
      setActiveDocIndex(0);
      toast({ title: "Analysis complete", description: `${data.analyses.length} document(s) analysed` });
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleDealDD = async () => {
    if (ddFiles.length === 0 || !dealName.trim()) return;
    setAnalyzing(true);
    setDdResult(null);
    setProjectCreated(null);
    try {
      const formData = new FormData();
      ddFiles.forEach(f => formData.append("files", f));
      formData.append("dealName", dealName);
      formData.append("team", ddTeam);
      const res = await fetch("/api/legal-dd/deal-dd", { method: "POST", headers: { ...getAuthHeaders() }, body: formData, credentials: "include" });
      if (!res.ok) { let errMsg = "DD analysis failed"; try { const t = await res.text(); errMsg = JSON.parse(t).message || errMsg; } catch {} throw new Error(errMsg); }
      const data = await res.json();
      setDdResult(data.analysis);
      toast({ title: "Due Diligence complete", description: `${data.analysis.fileAnalyses?.length || 0} files analysed` });
    } catch (err: any) {
      toast({ title: "DD analysis failed", description: err.message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCreateProject = async () => {
    if (!ddResult) return;
    setCreatingProject(true);
    try {
      const res = await fetch("/api/legal-dd/create-project", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ dealName, team: ddTeam, folderMapping: ddResult.folderMapping }),
      });
      if (!res.ok) { let errMsg = "Failed to create project"; try { const t = await res.text(); errMsg = JSON.parse(t).message || errMsg; } catch {} throw new Error(errMsg); }
      const data = await res.json();
      setProjectCreated(data.projectPath);
      toast({ title: "Project created", description: data.message });
    } catch (err: any) {
      toast({ title: "Failed to create project", description: err.message, variant: "destructive" });
    } finally {
      setCreatingProject(false);
    }
  };

  const currentAnalysis = legalResults?.[activeDocIndex];
  const filteredIssues = currentAnalysis?.issues?.filter(i => filterSeverity === "all" || i.severity === filterSeverity) || [];
  const redCount = currentAnalysis?.issues?.filter(i => i.severity === "red").length || 0;
  const amberCount = currentAnalysis?.issues?.filter(i => i.severity === "amber").length || 0;
  const greenCount = currentAnalysis?.issues?.filter(i => i.severity === "green").length || 0;

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Button variant={mode === "legal" ? "default" : "outline"} onClick={() => setMode("legal")} data-testid="button-mode-legal">
          <Scale className="w-4 h-4 mr-2" />
          Legal Analysis
        </Button>
        <Button variant={mode === "dd" ? "default" : "outline"} onClick={() => setMode("dd")} data-testid="button-mode-dd">
          <Shield className="w-4 h-4 mr-2" />
          Deal Due Diligence
        </Button>
      </div>

      {mode === "legal" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Scale className="w-5 h-5 text-primary" />
                Legal Document Analysis
              </CardTitle>
              <CardDescription>
                Upload legal documents (leases, contracts, agreements) for AI-powered analysis with traffic light issue flagging
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => document.getElementById("legal-files-input")?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const files = Array.from(e.dataTransfer.files); setLegalFiles(prev => [...prev, ...files]); }}
                data-testid="dropzone-legal"
              >
                <UploadCloud className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm font-medium">Drop legal documents here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, DOC, TXT — up to 10 files</p>
                <input
                  id="legal-files-input"
                  type="file"
                  className="hidden"
                  multiple
                  onChange={(e) => { const files = Array.from(e.target.files || []); setLegalFiles(prev => [...prev, ...files]); e.target.value = ""; }}
                />
              </div>

              {legalFiles.length > 0 && (
                <div className="space-y-2">
                  {legalFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-md bg-muted/50" data-testid={`legal-file-${i}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="text-sm truncate">{f.name}</span>
                        <span className="text-xs text-muted-foreground">({(f.size / 1024).toFixed(0)} KB)</span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setLegalFiles(legalFiles.filter((_, idx) => idx !== i))} data-testid={`button-remove-legal-file-${i}`}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Button
                onClick={handleLegalAnalysis}
                disabled={legalFiles.length === 0 || analyzing}
                className="w-full"
                data-testid="button-analyze-legal"
              >
                {analyzing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analysing...</> : <><Scale className="w-4 h-4 mr-2" />Analyse Documents</>}
              </Button>
            </CardContent>
          </Card>

          {legalResults && currentAnalysis && (
            <div className="space-y-4">
              {legalResults.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {legalResults.map((r, i) => (
                    <Button
                      key={i}
                      variant={i === activeDocIndex ? "default" : "outline"}
                      size="sm"
                      className="shrink-0 text-xs"
                      onClick={() => { setActiveDocIndex(i); setFilterSeverity("all"); }}
                      data-testid={`button-doc-tab-${i}`}
                    >
                      <FileText className="w-3.5 h-3.5 mr-1.5" />
                      Doc {i + 1}
                    </Button>
                  ))}
                </div>
              )}

              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">{currentAnalysis.documentType}</CardTitle>
                      <CardDescription className="mt-1">
                        {currentAnalysis.parties?.join(" & ")}
                      </CardDescription>
                    </div>
                    <RiskBadge risk={currentAnalysis.overallRisk} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm leading-relaxed">{currentAnalysis.summary}</p>

                  {currentAnalysis.keyTerms?.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {currentAnalysis.keyTerms.map((term, i) => (
                        <div key={i} className="flex gap-2 p-2 rounded-md bg-muted/50" data-testid={`key-term-${i}`}>
                          <span className="text-xs font-medium shrink-0 text-muted-foreground">{term.label}:</span>
                          <span className="text-xs">{term.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Issues & Flags</CardTitle>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setFilterSeverity("all")} className={`text-xs px-2 py-1 rounded-full border ${filterSeverity === "all" ? "bg-black text-white dark:bg-white dark:text-black" : ""}`} data-testid="filter-all">All ({currentAnalysis.issues?.length || 0})</button>
                      <button onClick={() => setFilterSeverity("red")} className={`text-xs px-2 py-1 rounded-full border ${filterSeverity === "red" ? "bg-red-500 text-white border-red-500" : "border-red-300 text-red-600"}`} data-testid="filter-red"><CircleDot className="w-3 h-3 inline mr-0.5" />{redCount}</button>
                      <button onClick={() => setFilterSeverity("amber")} className={`text-xs px-2 py-1 rounded-full border ${filterSeverity === "amber" ? "bg-amber-500 text-white border-amber-500" : "border-amber-300 text-amber-600"}`} data-testid="filter-amber"><CircleDot className="w-3 h-3 inline mr-0.5" />{amberCount}</button>
                      <button onClick={() => setFilterSeverity("green")} className={`text-xs px-2 py-1 rounded-full border ${filterSeverity === "green" ? "bg-green-500 text-white border-green-500" : "border-green-300 text-green-600"}`} data-testid="filter-green"><CircleDot className="w-3 h-3 inline mr-0.5" />{greenCount}</button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {filteredIssues.map((issue, i) => (
                      <IssueCard key={i} issue={issue} index={i} />
                    ))}
                    {filteredIssues.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">No issues found for this filter</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {currentAnalysis.nextSteps?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Recommended Next Steps</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ol className="space-y-2">
                      {currentAnalysis.nextSteps.map((step, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm" data-testid={`next-step-${i}`}>
                          <span className="text-xs font-bold text-primary bg-primary/10 w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {mode === "dd" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Deal Due Diligence
              </CardTitle>
              <CardDescription>
                Upload a data room of documents for full DD analysis. AI will review all files, flag issues with traffic lights, and create a SharePoint project folder structure.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Deal Name</Label>
                  <Input
                    placeholder="e.g. 67 Pimlico Road Acquisition"
                    value={dealName}
                    onChange={(e) => setDealName(e.target.value)}
                    data-testid="input-deal-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Team</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={ddTeam}
                    onChange={(e) => setDdTeam(e.target.value)}
                    data-testid="select-dd-team"
                  >
                    <option value="Investment">Investment</option>
                    <option value="London Leasing">London Leasing</option>
                    <option value="Lease Advisory">Lease Advisory</option>
                    <option value="National Leasing">National Leasing</option>
                    <option value="Tenant Rep">Tenant Rep</option>
                    <option value="Development">Development</option>
                  </select>
                </div>
              </div>

              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => document.getElementById("dd-files-input")?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const files = Array.from(e.dataTransfer.files); setDdFiles(prev => [...prev, ...files]); }}
                data-testid="dropzone-dd"
              >
                <UploadCloud className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm font-medium">Drop data room files here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, DOC, TXT, XLSX — up to 30 files</p>
                <input
                  id="dd-files-input"
                  type="file"
                  className="hidden"
                  multiple
                  onChange={(e) => { const files = Array.from(e.target.files || []); setDdFiles(prev => [...prev, ...files]); e.target.value = ""; }}
                />
              </div>

              {ddFiles.length > 0 && (
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                  {ddFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-md bg-muted/50" data-testid={`dd-file-${i}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="text-sm truncate">{f.name}</span>
                        <span className="text-xs text-muted-foreground">({(f.size / 1024).toFixed(0)} KB)</span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDdFiles(ddFiles.filter((_, idx) => idx !== i))} data-testid={`button-remove-dd-file-${i}`}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground text-right">{ddFiles.length} file(s) selected</p>
                </div>
              )}

              <Button
                onClick={handleDealDD}
                disabled={ddFiles.length === 0 || !dealName.trim() || analyzing}
                className="w-full"
                data-testid="button-run-dd"
              >
                {analyzing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running Due Diligence...</> : <><Shield className="w-4 h-4 mr-2" />Run Due Diligence</>}
              </Button>
            </CardContent>
          </Card>

          {ddResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card data-testid="stat-overall-risk">
                  <CardContent className="p-4 text-center">
                    <RiskBadge risk={ddResult.overallRisk} />
                    <p className="text-xs text-muted-foreground mt-1">Overall Risk</p>
                  </CardContent>
                </Card>
                <Card data-testid="stat-red-flags">
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-red-500">{ddResult.redFlags}</p>
                    <p className="text-xs text-muted-foreground">Red Flags</p>
                  </CardContent>
                </Card>
                <Card data-testid="stat-amber-flags">
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-amber-500">{ddResult.amberFlags}</p>
                    <p className="text-xs text-muted-foreground">Amber Flags</p>
                  </CardContent>
                </Card>
                <Card data-testid="stat-green-flags">
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-500">{ddResult.greenFlags}</p>
                    <p className="text-xs text-muted-foreground">Green Flags</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Executive Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">{ddResult.overallSummary}</p>
                </CardContent>
              </Card>

              {ddResult.keyRisks?.length > 0 && (
                <Card className="border-red-500/20">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-red-500" />
                      Key Risks
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {ddResult.keyRisks.map((risk, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm" data-testid={`key-risk-${i}`}>
                          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                          {risk}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">File Analysis</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {ddResult.fileAnalyses?.map((file, i) => {
                    const fileRed = file.issues?.filter(iss => iss.severity === "red").length || 0;
                    const fileAmber = file.issues?.filter(iss => iss.severity === "amber").length || 0;
                    const fileGreen = file.issues?.filter(iss => iss.severity === "green").length || 0;
                    const isExpanded = expandedDDFile === i;

                    return (
                      <div key={i} className="border rounded-lg" data-testid={`dd-file-analysis-${i}`}>
                        <div
                          className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                          onClick={() => setExpandedDDFile(isExpanded ? null : i)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium truncate">{file.fileName}</span>
                            <Badge variant="outline" className="text-[10px] shrink-0">{file.category}</Badge>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {fileRed > 0 && <span className="text-[10px] text-red-500 font-bold">{fileRed}R</span>}
                            {fileAmber > 0 && <span className="text-[10px] text-amber-500 font-bold">{fileAmber}A</span>}
                            {fileGreen > 0 && <span className="text-[10px] text-green-500 font-bold">{fileGreen}G</span>}
                            <Badge variant="secondary" className="text-[10px]">{file.suggestedFolder}</Badge>
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="border-t p-3 space-y-3">
                            <p className="text-sm text-muted-foreground">{file.summary}</p>
                            {file.issues?.map((issue, j) => (
                              <IssueCard key={j} issue={issue} index={j} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <FolderPlus className="w-4 h-4 text-primary" />
                        SharePoint Project Structure
                      </CardTitle>
                      <CardDescription>Create the folder structure in SharePoint based on the DD analysis</CardDescription>
                    </div>
                    {projectCreated && <Badge className="bg-green-500 text-white border-0"><CheckCircle className="w-3 h-3 mr-1" />Created</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Proposed folder mapping:</p>
                    {ddResult.folderMapping?.map((m, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs" data-testid={`folder-mapping-${i}`}>
                        <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="truncate">{m.fileName}</span>
                        <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        <Badge variant="outline" className="text-[10px] shrink-0">{m.targetFolder}</Badge>
                      </div>
                    ))}
                  </div>

                  {projectCreated ? (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <span className="text-sm">Project folders created at: <strong>{projectCreated}</strong></span>
                    </div>
                  ) : (
                    <Button
                      onClick={handleCreateProject}
                      disabled={creatingProject}
                      className="w-full"
                      data-testid="button-create-project"
                    >
                      {creatingProject ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating in SharePoint...</> : <><FolderPlus className="w-4 h-4 mr-2" />Create Project in SharePoint</>}
                    </Button>
                  )}
                </CardContent>
              </Card>

              {ddResult.recommendations?.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Recommendations</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ol className="space-y-2">
                      {ddResult.recommendations.map((rec, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm" data-testid={`recommendation-${i}`}>
                          <span className="text-xs font-bold text-primary bg-primary/10 w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                          {rec}
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
