import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import {
  Sparkles,
  Brain,
  Loader2,
  MapPin,
  Settings2,
  X,
  Check,
  Target,
  ThumbsDown,
  Bookmark,
  ArrowRightCircle,
  Wand2,
  MessageSquare,
} from "lucide-react";
import type { LeadProfile, Lead } from "./types";
import { SOURCE_ICONS, CONFIDENCE_COLORS, getConfidenceLevel } from "./helpers";
import { getQueryFn, apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function MyLeadsWidget() {
  const { toast } = useToast();
  const [showSetup, setShowSetup] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [expandedLead, setExpandedLead] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"new" | "saved">("new");

  const profileQuery = useQuery<LeadProfile | null>({
    queryKey: ["/api/leads/profile"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const leadsQuery = useQuery<Lead[]>({
    queryKey: ["/api/leads", activeTab],
    queryFn: async () => {
      const res = await fetch(`/api/leads?status=${activeTab === "new" ? "new" : "saved"}`, { headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!profileQuery.data?.setupComplete,
  });

  const statsQuery = useQuery<Record<string, number>>({
    queryKey: ["/api/leads/stats"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!profileQuery.data?.setupComplete,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/leads/generate");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/stats"] });
      toast({ title: data.length > 0 ? `${data.length} new leads generated` : "No new leads found — try updating your brief" });
    },
    onError: (err: any) => toast({ title: err?.message || "Failed to generate leads", variant: "destructive" }),
  });

  const saveProfileMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/leads/profile", {
        focusAreas: [],
        assetClasses: [],
        dealTypes: [],
        customPrompt: customPrompt || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads/profile"] });
      setShowSetup(false);
      toast({ title: "Brief saved — generating leads..." });
      setTimeout(() => generateMutation.mutate(), 500);
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ leadId, action }: { leadId: string; action: string }) => {
      await apiRequest("POST", `/api/leads/${leadId}/action`, { action });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/stats"] });
    },
  });

  const profile = profileQuery.data;
  const leads = leadsQuery.data || [];
  const stats = statsQuery.data || {};

  if (profileQuery.isLoading) {
    return (
      <Card data-testid="card-my-leads" className="h-full flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-blue-500" />
            <CardTitle className="text-sm font-semibold">My Leads</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!profile || !profile.setupComplete || showSetup) {
    return (
      <Card data-testid="card-my-leads-setup" className="h-full flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-blue-500" />
            <CardTitle className="text-sm font-semibold">My Leads</CardTitle>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 ml-6">{profile?.setupComplete ? "Update your brief" : "Set up your personalised AI lead generation"}</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <Wand2 className="w-4 h-4 text-blue-500" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-2">
                  Describe who you are and what kind of leads you're looking for. The AI will scan your news, deals, properties, and market data to find personalised opportunities.
                </p>
                <Textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="e.g. 'I'm Woody, focused on investment acquisitions in Central London — offices and mixed-use under £10m. I'm also interested in any retail occupiers looking to expand in Mayfair or Soho.'"
                  className="text-xs min-h-[100px]"
                  data-testid="textarea-lead-brief"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              {profile?.setupComplete && (
                <Button size="sm" variant="ghost" onClick={() => { setShowSetup(false); setCustomPrompt(profile.customPrompt || ""); }} data-testid="button-cancel-brief">
                  Cancel
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => saveProfileMutation.mutate()}
                disabled={saveProfileMutation.isPending || !customPrompt.trim()}
                data-testid="button-save-brief"
              >
                {saveProfileMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                )}
                {profile?.setupComplete ? "Update & Generate" : "Generate My Leads"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="card-my-leads" className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-1">
        <div>
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-blue-500" />
            <CardTitle className="text-sm font-semibold">My Leads</CardTitle>
            {(stats.new || 0) > 0 && (
              <span className="text-[10px] font-medium text-blue-600 bg-blue-500/10 rounded-full px-1.5 py-0.5">{stats.new} new</span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 ml-6">AI-generated opportunities from your news, deals, and market data</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setCustomPrompt(profile?.customPrompt || "");
              setShowSetup(true);
            }}
            data-testid="button-edit-lead-profile"
          >
            <Settings2 className="w-3 h-3 mr-1" />
            Brief
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            data-testid="button-generate-leads"
          >
            {generateMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <Wand2 className="w-3 h-3 mr-1" />
            )}
            Generate
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 flex-1 flex flex-col overflow-hidden">
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setActiveTab("new")}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors cursor-pointer ${activeTab === "new" ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            data-testid="tab-leads-new"
          >
            New {(stats.new || 0) > 0 && `(${stats.new})`}
          </button>
          <button
            onClick={() => setActiveTab("saved")}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors cursor-pointer ${activeTab === "saved" ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            data-testid="tab-leads-saved"
          >
            Saved {(stats.saved || 0) > 0 && `(${stats.saved})`}
          </button>
          {(stats.converted || 0) > 0 && (
            <span className="text-[10px] text-emerald-600 flex items-center gap-1 ml-auto">
              <Check className="w-3 h-3" />
              {stats.converted} converted
            </span>
          )}
        </div>

        {leadsQuery.isLoading || generateMutation.isPending ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-md border animate-pulse">
                <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
            {generateMutation.isPending && (
              <p className="text-center text-xs text-muted-foreground py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" />
                Scanning your data for opportunities...
              </p>
            )}
          </div>
        ) : leads.length > 0 ? (
          <div className="space-y-2 flex-1 overflow-y-auto">
            {leads.map((lead) => {
              const SourceIcon = SOURCE_ICONS[lead.sourceType] || Sparkles;
              const level = getConfidenceLevel(lead.confidence);
              const isExpanded = expandedLead === lead.id;
              return (
                <div
                  key={lead.id}
                  className="p-3 rounded-md border hover:bg-muted/30 transition-colors"
                  data-testid={`lead-card-${lead.id}`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      level === "high" ? "bg-emerald-500/10" : level === "medium" ? "bg-amber-500/10" : "bg-slate-500/10"
                    }`}>
                      <SourceIcon className={`w-3.5 h-3.5 ${
                        level === "high" ? "text-emerald-500" : level === "medium" ? "text-amber-500" : "text-slate-400"
                      }`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          onClick={() => setExpandedLead(isExpanded ? null : lead.id)}
                          className="text-xs font-medium text-left hover:text-blue-600 transition-colors cursor-pointer"
                        >
                          {lead.title}
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <div className={`w-2 h-2 rounded-full ${CONFIDENCE_COLORS[level]}`} title={`${lead.confidence}% confidence`} />
                          <span className="text-[10px] text-muted-foreground">{lead.confidence}%</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{lead.summary}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {lead.area && (
                          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded flex items-center gap-0.5">
                            <MapPin className="w-2.5 h-2.5" />{lead.area}
                          </span>
                        )}
                        {lead.assetClass && (
                          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{lead.assetClass}</span>
                        )}
                        {lead.opportunityType && (
                          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{lead.opportunityType}</span>
                        )}
                        <span className="text-[10px] text-muted-foreground capitalize">{lead.sourceType}</span>
                      </div>

                      {isExpanded && (
                        <div className="mt-2.5 space-y-2 border-t pt-2">
                          {lead.suggestedAction && (
                            <div className="flex items-start gap-1.5">
                              <ArrowRightCircle className="w-3 h-3 text-blue-500 mt-0.5 shrink-0" />
                              <p className="text-[11px]"><span className="font-medium">Suggested action:</span> {lead.suggestedAction}</p>
                            </div>
                          )}
                          {lead.aiReasoning && (
                            <div className="flex items-start gap-1.5">
                              <Brain className="w-3 h-3 text-violet-500 mt-0.5 shrink-0" />
                              <p className="text-[11px] text-muted-foreground"><span className="font-medium text-foreground">Why this lead:</span> {lead.aiReasoning}</p>
                            </div>
                          )}
                          {lead.sourceContext && (
                            <div className="flex items-start gap-1.5">
                              <MessageSquare className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                              <p className="text-[11px] text-muted-foreground"><span className="font-medium text-foreground">Source:</span> {lead.sourceContext}</p>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-1 mt-2">
                        {lead.status === "new" && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] px-2"
                              onClick={() => actionMutation.mutate({ leadId: lead.id, action: "saved" })}
                              data-testid={`button-save-lead-${lead.id}`}
                            >
                              <Bookmark className="w-3 h-3 mr-1" />Save
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] px-2"
                              onClick={() => {
                                actionMutation.mutate({ leadId: lead.id, action: "converted" });
                                const prompt = `I want to act on this lead: "${lead.title}". ${lead.suggestedAction || ""}\n\nContext: ${lead.sourceContext || lead.summary || ""}${lead.area ? `\nArea: ${lead.area}` : ""}${lead.assetClass ? `\nAsset class: ${lead.assetClass}` : ""}${lead.opportunityType ? `\nType: ${lead.opportunityType}` : ""}\n\nPlease help me take the next step — create a deal, add a contact, or whatever is most appropriate.`;
                                window.dispatchEvent(new CustomEvent("open-ai-chat-with-prompt", { detail: { prompt } }));
                              }}
                              data-testid={`button-convert-lead-${lead.id}`}
                            >
                              <ArrowRightCircle className="w-3 h-3 mr-1" />Convert
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] px-2 text-muted-foreground"
                              onClick={() => actionMutation.mutate({ leadId: lead.id, action: "dismissed" })}
                              data-testid={`button-dismiss-lead-${lead.id}`}
                            >
                              <ThumbsDown className="w-3 h-3 mr-1" />Not relevant
                            </Button>
                          </>
                        )}
                        {lead.status === "saved" && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] px-2"
                              onClick={() => {
                                actionMutation.mutate({ leadId: lead.id, action: "converted" });
                                const prompt = `I want to act on this lead: "${lead.title}". ${lead.suggestedAction || ""}\n\nContext: ${lead.sourceContext || lead.summary || ""}${lead.area ? `\nArea: ${lead.area}` : ""}${lead.assetClass ? `\nAsset class: ${lead.assetClass}` : ""}${lead.opportunityType ? `\nType: ${lead.opportunityType}` : ""}\n\nPlease help me take the next step — create a deal, add a contact, or whatever is most appropriate.`;
                                window.dispatchEvent(new CustomEvent("open-ai-chat-with-prompt", { detail: { prompt } }));
                              }}
                              data-testid={`button-convert-lead-${lead.id}`}
                            >
                              <ArrowRightCircle className="w-3 h-3 mr-1" />Convert
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] px-2 text-muted-foreground"
                              onClick={() => actionMutation.mutate({ leadId: lead.id, action: "archived" })}
                              data-testid={`button-archive-lead-${lead.id}`}
                            >
                              <X className="w-3 h-3 mr-1" />Archive
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6">
            <Target className="w-8 h-8 mx-auto mb-2 opacity-20" />
            <p className="text-xs text-muted-foreground mb-3">
              {activeTab === "new" ? "No new leads. Generate some!" : "No saved leads yet."}
            </p>
            {activeTab === "new" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                data-testid="button-generate-leads-empty"
              >
                <Wand2 className="w-3.5 h-3.5 mr-1.5" />
                Generate Leads
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
