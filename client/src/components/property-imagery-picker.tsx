/**
 * PropertyImageryPicker — universal imagery picker, used everywhere a
 * feature needs to show / pick / edit images for a property.
 *
 * Mounted in:
 *   - Pathway Stage 9 (Why Buy / Claude design pane)
 *   - PLA Matter detail page (rent-review reps, dilapidations cover)
 *   - Property Intelligence page (Imagery tab)
 *   - Document Studio briefs (any document that needs property visuals)
 *
 * Renders a tab per kind (hero, internal, secondary external, location plan,
 * floor plan, comps chart, ERV walk, covenant card). Each tab shows
 * candidate cards with thumbnail + source badge + score + pin/hide/edit
 * controls. Pinned candidate per (property, kind) is the canonical pick
 * any consumer reads.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import { Pin, EyeOff, Eye, RefreshCw, ImageIcon, Loader2, ExternalLink, Edit, Wand2 } from "lucide-react";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ImageryKind =
  | "hero" | "internal" | "secondary_external"
  | "location_plan" | "floor_plan" | "covenant_card"
  | "comps_chart" | "erv_walk" | "overlay";

type ImagerySource =
  | "brochure" | "sharepoint" | "street_view" | "planning_portal"
  | "os_ngd" | "google_static" | "edozo" | "cad_measure"
  | "image_studio" | "generated_chart" | "manual_upload";

type ImageryCandidate = {
  id: string;
  kind: ImageryKind;
  source: ImagerySource;
  imageStudioId: string | null;
  sourceUrl: string | null;
  thumbnail: string | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  score: number;
  pinned: boolean;
  hidden: boolean;
  generatedAt: string;
};

type Manifest = {
  propertyId: string;
  byKind: Record<ImageryKind, ImageryCandidate[]>;
  generatedAt: number;
};

const KIND_LABELS: Record<ImageryKind, string> = {
  hero: "Hero",
  internal: "Internal",
  secondary_external: "Secondary external",
  location_plan: "Location plan",
  floor_plan: "Floor plan",
  covenant_card: "Covenant",
  comps_chart: "Comps chart",
  erv_walk: "ERV walk",
  overlay: "Overlay",
};

const SOURCE_LABELS: Record<ImagerySource, string> = {
  brochure: "Brochure",
  sharepoint: "SharePoint",
  street_view: "Street View",
  planning_portal: "Planning",
  os_ngd: "OS NGD",
  google_static: "Google",
  edozo: "Edozo",
  cad_measure: "Cann CAD",
  image_studio: "Studio",
  generated_chart: "Auto-chart",
  manual_upload: "Upload",
};

const DEFAULT_KINDS: ImageryKind[] = [
  "hero", "internal", "secondary_external",
  "location_plan", "floor_plan",
];

interface Props {
  propertyId: string;
  /** Which kinds to show; defaults to the visual ones (no charts/cards). */
  kinds?: ImageryKind[];
  /** Optional Pathway run / matter scope for provenance on newly-discovered assets. */
  pathwayRunId?: string;
  matterId?: string;
  /** Compact single-column layout for narrow side panes. */
  compact?: boolean;
}

export function PropertyImageryPicker({ propertyId, kinds, pathwayRunId, matterId, compact }: Props) {
  const { toast } = useToast();
  const showKinds = kinds && kinds.length > 0 ? kinds : DEFAULT_KINDS;

  const { data, isLoading, refetch } = useQuery<Manifest>({
    queryKey: ["/api/property-imagery", propertyId, "manifest"],
    queryFn: async () => {
      const res = await fetch(`/api/property-imagery/${propertyId}/manifest`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("manifest fetch failed");
      return res.json();
    },
  });

  const discover = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/property-imagery/${propertyId}/discover`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ pathwayRunId, matterId }),
      });
      if (!res.ok) throw new Error("discover failed");
      return res.json() as Promise<Manifest>;
    },
    onSuccess: () => {
      refetch();
      toast({ title: "Imagery discovery complete" });
    },
    onError: (err: any) => toast({ title: "Discovery failed", description: err?.message, variant: "destructive" }),
  });

  const patch = async (id: string, updates: Partial<{ pinned: boolean; hidden: boolean; kind: ImageryKind; caption: string }>) => {
    const res = await fetch(`/api/property-imagery/asset/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      toast({ title: "Update failed", variant: "destructive" });
      return;
    }
    refetch();
  };

  const totalCount = useMemo(() => {
    if (!data) return 0;
    return showKinds.reduce((sum, k) => sum + (data.byKind[k]?.length || 0), 0);
  }, [data, showKinds]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Imagery</span>
          <Badge variant="outline" className="text-xs">{totalCount} candidates</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => discover.mutate()} disabled={discover.isPending} className="gap-1.5">
          {discover.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {totalCount === 0 ? "Discover" : "Re-discover"}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <Tabs defaultValue={showKinds[0]} className="w-full">
          <TabsList className="flex-wrap h-auto justify-start bg-transparent p-0 gap-1">
            {showKinds.map((k) => {
              const count = data?.byKind[k]?.length || 0;
              return (
                <TabsTrigger
                  key={k}
                  value={k}
                  className="text-xs gap-1.5 px-3 py-1 h-8 data-[state=active]:bg-muted"
                >
                  {KIND_LABELS[k]}
                  {count > 0 && <Badge variant="secondary" className="ml-1 h-4 text-[10px] px-1.5">{count}</Badge>}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {showKinds.map((k) => (
            <TabsContent key={k} value={k} className="m-0 mt-3">
              <KindPanel
                kind={k}
                candidates={data?.byKind[k] || []}
                compact={compact}
                onPatch={patch}
                propertyId={propertyId}
                pathwayRunId={pathwayRunId}
                matterId={matterId}
                onComposed={() => refetch()}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

function KindPanel({
  kind, candidates, compact, onPatch, propertyId, pathwayRunId, matterId, onComposed,
}: {
  kind: ImageryKind;
  candidates: ImageryCandidate[];
  compact?: boolean;
  onPatch: (id: string, updates: any) => Promise<void>;
  propertyId: string;
  pathwayRunId?: string;
  matterId?: string;
  onComposed: () => void;
}) {
  const composable = kind === "location_plan" || kind === "comps_chart";
  const cols = compact ? "grid-cols-1" : "grid-cols-2 md:grid-cols-3";
  return (
    <div className="space-y-3">
      {composable && (
        <ComposeButton
          kind={kind}
          propertyId={propertyId}
          pathwayRunId={pathwayRunId}
          matterId={matterId}
          onComposed={onComposed}
          existingCount={candidates.length}
        />
      )}
      {candidates.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
          {composable
            ? `No ${KIND_LABELS[kind].toLowerCase()} yet — click Generate above to compose one.`
            : `No ${KIND_LABELS[kind].toLowerCase()} candidates yet — try Re-discover, or upload one via Image Studio.`}
        </CardContent></Card>
      ) : (
        <div className={`grid ${cols} gap-3`}>
          {candidates.map((c) => (
            <CandidateCard key={c.id} candidate={c} onPatch={onPatch} />
          ))}
        </div>
      )}
    </div>
  );
}

function ComposeButton({
  kind, propertyId, pathwayRunId, matterId, onComposed, existingCount,
}: {
  kind: ImageryKind;
  propertyId: string;
  pathwayRunId?: string;
  matterId?: string;
  onComposed: () => void;
  existingCount: number;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const compose = async () => {
    setBusy(true);
    try {
      let endpoint = "";
      let body: any = { pathwayRunId, matterId };
      if (kind === "location_plan") {
        endpoint = `/api/property-imagery/${propertyId}/compose/location-plan`;
        body = { ...body, zoom: 16, mapType: "hybrid" };
      } else if (kind === "comps_chart") {
        // For comps chart we need actual comp data — punt with friendly message
        // until we wire it to crmComps / investmentComps server-side.
        toast({
          title: "Comps chart needs comps to plot",
          description: "Link comps to this matter or run from a Pathway Stage 9 brief; bare-property comps-chart auto-pull lands next commit.",
        });
        setBusy(false);
        return;
      }
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        toast({ title: "Compose failed", description: e?.error || `${res.status}`, variant: "destructive" });
        return;
      }
      toast({ title: `${KIND_LABELS[kind]} generated`, description: "Saved to Image Studio + this picker" });
      onComposed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between border rounded-md px-3 py-2 bg-muted/40">
      <div className="text-xs text-muted-foreground">
        {kind === "location_plan" && "Hybrid Google map at zoom 16, BGP red property pin. Layer markers (tube/anchors/comps) land in next commit."}
        {kind === "comps_chart" && "Horizontal bars per comp, BGP-blue, subject highlighted. Auto-pulls from linked comps."}
      </div>
      <Button size="sm" variant="outline" onClick={compose} disabled={busy} className="gap-1.5 h-7">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
        {existingCount > 0 ? "Generate another" : "Generate"}
      </Button>
    </div>
  );
}

function CandidateCard({
  candidate, onPatch,
}: { candidate: ImageryCandidate; onPatch: (id: string, updates: any) => Promise<void> }) {
  const thumbSrc = candidate.thumbnail
    ? (candidate.thumbnail.startsWith("data:") ? candidate.thumbnail : `data:image/jpeg;base64,${candidate.thumbnail}`)
    : (candidate.sourceUrl || "");

  const editUrl = candidate.imageStudioId
    ? `/image-studio?id=${candidate.imageStudioId}`
    : null;
  const externalUrl = candidate.imageStudioId
    ? `/api/image-studio/${candidate.imageStudioId}/full`
    : candidate.sourceUrl;

  return (
    <Card className={`overflow-hidden transition ${candidate.pinned ? "ring-2 ring-primary" : ""}`}>
      <div className="aspect-[4/3] bg-muted relative">
        {thumbSrc ? (
          <img src={thumbSrc} alt={candidate.caption || ""} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-30" />
          </div>
        )}
        {candidate.pinned && (
          <Badge className="absolute top-2 left-2 bg-primary text-primary-foreground">
            <Pin className="h-3 w-3 mr-1" /> Pinned
          </Badge>
        )}
      </div>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">{SOURCE_LABELS[candidate.source]}</Badge>
          {candidate.score > 0 && (
            <span className="text-xs text-muted-foreground">score {candidate.score.toFixed(2)}</span>
          )}
        </div>
        {candidate.caption && (
          <p className="text-xs text-muted-foreground line-clamp-2" title={candidate.caption}>
            {candidate.caption}
          </p>
        )}
        <div className="flex items-center gap-1 pt-1">
          <Button
            size="sm"
            variant={candidate.pinned ? "default" : "outline"}
            onClick={() => onPatch(candidate.id, { pinned: !candidate.pinned })}
            className="h-7 px-2 text-xs gap-1"
          >
            <Pin className="h-3 w-3" />
            {candidate.pinned ? "Pinned" : "Pin"}
          </Button>
          {editUrl && (
            <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs gap-1">
              <a href={editUrl} target="_blank" rel="noreferrer">
                <Edit className="h-3 w-3" />
                Edit
              </a>
            </Button>
          )}
          {externalUrl && (
            <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
              <a href={externalUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onPatch(candidate.id, { hidden: true })}
            className="h-7 px-2 text-xs text-muted-foreground ml-auto"
            title="Hide — not relevant"
          >
            <EyeOff className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
