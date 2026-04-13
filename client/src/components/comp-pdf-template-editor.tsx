import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Check, Loader2, Eye, Shield, ShieldCheck, ChevronDown, ChevronUp,
  Link2, FileText, ExternalLink,
} from "lucide-react";

export interface CompPdfField {
  key: string;
  label: string;
  enabled: boolean;
}

export interface CompPdfTemplateConfig {
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

export function CompPdfTemplateEditor() {
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
