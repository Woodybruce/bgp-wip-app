import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, AlertTriangle, CheckCircle2, X, Undo2, Sparkles, Building2, Play, Shield } from "lucide-react";
import { Link } from "wouter";

interface CandidateCompany {
  id: string;
  name: string;
  companies_house_number: string | null;
  domain: string | null;
  company_type: string | null;
  description: string | null;
  created_at: string;
  contact_count: number;
  deal_count: number;
  kyc_doc_count: number;
}

interface Candidate {
  id: string;
  clusterKey: string;
  reason: string;
  aiVerdict: string | null;
  aiConfidence: number | null;
  createdAt: string;
  companies: CandidateCompany[];
}

interface MergeRecord {
  id: string;
  primary_id: string;
  secondary_id: string;
  primary_name: string | null;
  secondary_name: string | null;
  merged_by: string | null;
  merged_at: string;
  notes: string | null;
}

export default function AdminDedupe() {
  const { toast } = useToast();
  const [selectedPrimary, setSelectedPrimary] = useState<Record<string, string>>({});
  const [mergeNotes, setMergeNotes] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery<{ candidates: Candidate[] }>({
    queryKey: ["/api/brand/dedupe/candidates"],
  });
  const { data: mergesData } = useQuery<{ merges: MergeRecord[] }>({
    queryKey: ["/api/brand/dedupe/merges"],
  });

  const scanMutation = useMutation({
    mutationFn: async (useAI: boolean) => {
      const res = await apiRequest("POST", "/api/brand/dedupe/scan", { useAI });
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({ title: "Scan complete", description: `${r.candidatesInserted} candidate clusters · ${r.aiCalls} AI judgements` });
      queryClient.invalidateQueries({ queryKey: ["/api/brand/dedupe/candidates"] });
    },
    onError: (e: any) => toast({ title: "Scan failed", description: e.message, variant: "destructive" }),
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ candidateId, primaryId, secondaryId, notes }: any) => {
      const res = await apiRequest("POST", "/api/brand/dedupe/merge", { candidateId, primaryId, secondaryId, notes });
      return res.json();
    },
    onSuccess: (r: any) => {
      const total = Object.values(r.referenceUpdates || {}).reduce((a: number, b: any) => a + Number(b), 0);
      toast({ title: "Merged", description: `Rewired ${total} references across ${Object.keys(r.referenceUpdates || {}).length} tables` });
      queryClient.invalidateQueries({ queryKey: ["/api/brand/dedupe/candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/brand/dedupe/merges"] });
    },
    onError: (e: any) => toast({ title: "Merge failed", description: e.message, variant: "destructive" }),
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/brand/dedupe/candidates/${id}/dismiss`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Dismissed" });
      queryClient.invalidateQueries({ queryKey: ["/api/brand/dedupe/candidates"] });
    },
  });

  const undoMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/brand/dedupe/undo/${id}`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Merge reversed", description: "References restored" });
      queryClient.invalidateQueries({ queryKey: ["/api/brand/dedupe/candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/brand/dedupe/merges"] });
    },
    onError: (e: any) => toast({ title: "Undo failed", description: e.message, variant: "destructive" }),
  });

  const candidates = data?.candidates || [];

  return (
    <div className="p-4 lg:p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 tracking-tight">
            <Shield className="w-6 h-6 text-primary" />
            CRM Dedupe
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Merge duplicate companies — their references are rewired to the primary, the secondary row is hidden. Reversible.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => scanMutation.mutate(true)}
            disabled={scanMutation.isPending}
            data-testid="button-scan"
          >
            {scanMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Run scan (AI-assisted)
          </Button>
          <Button
            variant="outline"
            onClick={() => scanMutation.mutate(false)}
            disabled={scanMutation.isPending}
          >
            Scan (no AI)
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : candidates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-500" />
            <p className="font-semibold mb-1">No duplicate candidates pending</p>
            <p className="text-sm">Run a scan to check the CRM for duplicates.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {candidates.length} cluster{candidates.length === 1 ? "" : "s"} to review.
            Tick which row to keep as the primary — the others get merged into it.
          </p>

          {candidates.map(c => {
            const primaryId = selectedPrimary[c.id];
            return (
              <Card key={c.id} data-testid={`candidate-${c.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {c.aiVerdict === "duplicate" && <Badge className="bg-red-100 text-red-700 border-red-200">Likely duplicate</Badge>}
                        {c.aiVerdict === "same_group_different_entities" && <Badge className="bg-amber-100 text-amber-700 border-amber-200">Same group · different entities</Badge>}
                        {c.aiVerdict === "unrelated" && <Badge variant="outline">AI says unrelated</Badge>}
                        {c.aiConfidence != null && <span className="text-xs text-muted-foreground">({Math.round(c.aiConfidence * 100)}% conf.)</span>}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">{c.reason}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => dismissMutation.mutate(c.id)}>
                      <X className="w-3.5 h-3.5 mr-1" /> Not a duplicate
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {c.companies.map(co => (
                      <div
                        key={co.id}
                        className={`border rounded-lg p-3 cursor-pointer transition-all ${
                          primaryId === co.id
                            ? "border-emerald-400 bg-emerald-50/40 ring-1 ring-emerald-400"
                            : "border-border/60 hover:border-primary/40"
                        }`}
                        onClick={() => setSelectedPrimary({ ...selectedPrimary, [c.id]: co.id })}
                        data-testid={`candidate-company-${co.id}`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="font-semibold text-sm flex items-center gap-1.5 flex-1 min-w-0">
                            <Building2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{co.name}</span>
                          </div>
                          {primaryId === co.id && <Badge className="bg-emerald-600 text-white">KEEP</Badge>}
                        </div>
                        <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground mb-1.5">
                          {co.companies_house_number && <span>CH {co.companies_house_number}</span>}
                          {co.domain && <span>· {co.domain}</span>}
                          {co.company_type && <span>· {co.company_type}</span>}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                          <span>{co.contact_count} contact{co.contact_count === 1 ? "" : "s"}</span>
                          <span>{co.deal_count} deal{co.deal_count === 1 ? "" : "s"}</span>
                          <span>{co.kyc_doc_count} KYC doc{co.kyc_doc_count === 1 ? "" : "s"}</span>
                        </div>
                        {co.description && <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">{co.description}</p>}
                        <Link href={`/companies/${co.id}`} onClick={(e) => e.stopPropagation()} className="text-[11px] text-primary hover:underline inline-block mt-1.5">
                          Open company →
                        </Link>
                      </div>
                    ))}
                  </div>

                  {primaryId && c.companies.length >= 2 && (
                    <div className="border-t pt-3 mt-3 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Merging {c.companies.filter(x => x.id !== primaryId).length} row{c.companies.length > 2 ? "s" : ""} into <strong>{c.companies.find(x => x.id === primaryId)?.name}</strong>.
                      </p>
                      <Textarea
                        placeholder="Notes (optional)"
                        value={mergeNotes[c.id] || ""}
                        onChange={(e) => setMergeNotes({ ...mergeNotes, [c.id]: e.target.value })}
                        className="text-sm"
                        rows={2}
                      />
                      <div className="flex items-center gap-2">
                        {c.companies.filter(co => co.id !== primaryId).map(sec => (
                          <Button
                            key={sec.id}
                            size="sm"
                            disabled={mergeMutation.isPending}
                            onClick={() => mergeMutation.mutate({
                              candidateId: c.id,
                              primaryId,
                              secondaryId: sec.id,
                              notes: mergeNotes[c.id],
                            })}
                            data-testid={`merge-${sec.id}-into-${primaryId}`}
                          >
                            {mergeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
                            Merge "{sec.name}" into primary
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {mergesData && mergesData.merges.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent merges</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {mergesData.merges.slice(0, 20).map(m => (
                <div key={m.id} className="flex items-center justify-between gap-2 text-sm border border-border/60 rounded p-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="truncate">
                      <strong>{m.secondary_name || m.secondary_id}</strong> → {m.primary_name || m.primary_id}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {m.merged_by} · {new Date(m.merged_at).toLocaleString("en-GB")}
                    </span>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => undoMutation.mutate(m.id)} disabled={undoMutation.isPending}>
                    <Undo2 className="w-3.5 h-3.5 mr-1" /> Undo
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
