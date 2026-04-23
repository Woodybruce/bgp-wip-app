import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sparkles, Target, Loader2, Check, Pencil, Save, ExternalLink } from "lucide-react";

interface Pitch {
  id?: string;
  property_id: string;
  erv: number | null;
  erv_per_sqft: number | null;
  incentive_plan: string | null;
  rent_free_months: number | null;
  capex_contribution: number | null;
  fit_out_contribution: number | null;
  target_brand_ids: string[] | null;
  marketing_strategy: string | null;
  positioning: string | null;
  ai_generated_fields: any;
}

interface BrandMatch {
  id: string;
  name: string;
  is_tracked_brand: boolean;
  rollout_status: string | null;
}

interface RecommendedBrand {
  name: string;
  why: string;
  match: BrandMatch | null;
}

interface RecommendedCategory {
  category: string;
  rationale: string;
  brands: RecommendedBrand[];
}

interface MixResponse {
  headline: string;
  recommendations: RecommendedCategory[];
  trackedBrandCount: number;
}

export function LeasingPitchPanel({ propertyId }: { propertyId: string }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Pitch>>({});
  const [mix, setMix] = useState<MixResponse | null>(null);

  const { data, isLoading } = useQuery<{ pitch: Pitch | null }>({
    queryKey: ["/api/leasing-pitch", propertyId],
  });

  const pitch: Pitch = (data?.pitch as Pitch) || ({ property_id: propertyId } as any);
  const lastMix = (pitch.ai_generated_fields as any)?.tenant_mix as MixResponse | undefined;
  const lastMixAt = (pitch.ai_generated_fields as any)?.tenant_mix_at as string | undefined;
  const currentMix = mix || lastMix || null;

  const saveMutation = useMutation({
    mutationFn: async (patch: Partial<Pitch>) => {
      return apiRequest("PUT", `/api/leasing-pitch/${propertyId}`, patch);
    },
    onSuccess: () => {
      toast({ title: "Leasing pitch saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-pitch", propertyId] });
      setEditing(false);
      setDraft({});
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });

  const recommendMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/leasing-pitch/${propertyId}/recommend-mix`, {
        method: "POST",
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<MixResponse>;
    },
    onSuccess: (r) => {
      setMix(r);
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-pitch", propertyId] });
      toast({ title: "Tenant mix recommended", description: `${r.trackedBrandCount} matched tracked brands` });
    },
    onError: (e: any) => toast({ title: "Recommendation failed", description: e?.message, variant: "destructive" }),
  });

  const addToTargetsMutation = useMutation({
    mutationFn: async (brandId: string) => {
      const current = pitch.target_brand_ids || [];
      if (current.includes(brandId)) return new Response(null);
      return apiRequest("PUT", `/api/leasing-pitch/${propertyId}`, { target_brand_ids: [...current, brandId] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leasing-pitch", propertyId] });
      toast({ title: "Added to target brands" });
    },
  });

  if (isLoading) {
    return (
      <Card><CardContent className="p-4 text-sm text-muted-foreground">Loading leasing pitch…</CardContent></Card>
    );
  }

  const value = <K extends keyof Pitch>(k: K): any => (k in draft ? (draft as any)[k] : (pitch as any)[k]);
  const setVal = <K extends keyof Pitch>(k: K, v: any) => setDraft(d => ({ ...d, [k]: v }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4 text-emerald-700" />
            Leasing pitch
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => recommendMutation.mutate()}
              disabled={recommendMutation.isPending}
            >
              {recommendMutation.isPending
                ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Thinking…</>
                : <><Sparkles className="w-3.5 h-3.5 mr-1" />Recommend mix</>}
            </Button>
            {editing ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft({}); }}>Cancel</Button>
                <Button size="sm" onClick={() => saveMutation.mutate(draft)} disabled={saveMutation.isPending}>
                  <Save className="w-3.5 h-3.5 mr-1" />Save
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className="w-3.5 h-3.5 mr-1" />Edit
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Numbers */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-[10px] text-muted-foreground">ERV £/yr</Label>
            {editing
              ? <Input type="number" value={value("erv") ?? ""} onChange={e => setVal("erv", e.target.value === "" ? null : Number(e.target.value))} />
              : <div className="text-sm font-medium">{pitch.erv ? `£${Number(pitch.erv).toLocaleString()}` : "—"}</div>}
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">ERV £/sqft</Label>
            {editing
              ? <Input type="number" value={value("erv_per_sqft") ?? ""} onChange={e => setVal("erv_per_sqft", e.target.value === "" ? null : Number(e.target.value))} />
              : <div className="text-sm font-medium">{pitch.erv_per_sqft ? `£${pitch.erv_per_sqft}` : "—"}</div>}
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Rent-free mo</Label>
            {editing
              ? <Input type="number" value={value("rent_free_months") ?? ""} onChange={e => setVal("rent_free_months", e.target.value === "" ? null : Number(e.target.value))} />
              : <div className="text-sm font-medium">{pitch.rent_free_months ?? "—"}</div>}
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Fit-out £</Label>
            {editing
              ? <Input type="number" value={value("fit_out_contribution") ?? ""} onChange={e => setVal("fit_out_contribution", e.target.value === "" ? null : Number(e.target.value))} />
              : <div className="text-sm font-medium">{pitch.fit_out_contribution ? `£${Number(pitch.fit_out_contribution).toLocaleString()}` : "—"}</div>}
          </div>
        </div>

        {/* Text fields */}
        <div className="space-y-3">
          <div>
            <Label className="text-[10px] text-muted-foreground">Positioning</Label>
            {editing
              ? <Textarea value={value("positioning") ?? ""} onChange={e => setVal("positioning", e.target.value)} rows={2} />
              : <p className="text-sm whitespace-pre-wrap">{pitch.positioning || <span className="text-muted-foreground">Not set</span>}</p>}
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Incentive plan</Label>
            {editing
              ? <Textarea value={value("incentive_plan") ?? ""} onChange={e => setVal("incentive_plan", e.target.value)} rows={2} />
              : <p className="text-sm whitespace-pre-wrap">{pitch.incentive_plan || <span className="text-muted-foreground">Not set</span>}</p>}
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Marketing strategy</Label>
            {editing
              ? <Textarea value={value("marketing_strategy") ?? ""} onChange={e => setVal("marketing_strategy", e.target.value)} rows={2} />
              : <p className="text-sm whitespace-pre-wrap">{pitch.marketing_strategy || <span className="text-muted-foreground">Not set</span>}</p>}
          </div>
        </div>

        {/* Recommended mix */}
        {currentMix && (
          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <span className="text-sm font-medium">Recommended tenant mix</span>
              </div>
              {lastMixAt && !mix && (
                <span className="text-[10px] text-muted-foreground">
                  {new Date(lastMixAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
            {currentMix.headline && <p className="text-sm italic text-muted-foreground">{currentMix.headline}</p>}
            <div className="space-y-3">
              {currentMix.recommendations.map((cat, i) => (
                <div key={i} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{cat.category}</div>
                    <Badge variant="outline" className="text-[10px]">{cat.brands.length} brands</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{cat.rationale}</p>
                  <div className="space-y-1.5">
                    {cat.brands.map((b, j) => {
                      const alreadyTargeted = b.match && (pitch.target_brand_ids || []).includes(b.match.id);
                      return (
                        <div key={j} className="flex items-start justify-between gap-2 text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {b.match ? (
                                <Link href={`/companies/${b.match.id}`} className="font-medium hover:underline flex items-center gap-1">
                                  {b.name}
                                  <ExternalLink className="w-3 h-3 opacity-50" />
                                </Link>
                              ) : (
                                <span className="font-medium">{b.name}</span>
                              )}
                              {b.match?.is_tracked_brand && (
                                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[9px] py-0 px-1.5">Tracked</Badge>
                              )}
                              {b.match?.rollout_status === "scaling" && (
                                <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-[9px] py-0 px-1.5">Scaling</Badge>
                              )}
                              {!b.match && (
                                <span className="text-[10px] text-muted-foreground">(not in CRM)</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">{b.why}</p>
                          </div>
                          {b.match && (
                            <Button
                              size="sm"
                              variant={alreadyTargeted ? "ghost" : "outline"}
                              disabled={alreadyTargeted || addToTargetsMutation.isPending}
                              onClick={() => b.match && addToTargetsMutation.mutate(b.match.id)}
                              className="text-[10px] h-7"
                            >
                              {alreadyTargeted ? <><Check className="w-3 h-3 mr-1" />Targeted</> : "Add to targets"}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
