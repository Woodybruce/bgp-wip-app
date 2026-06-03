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
  const composable = kind === "location_plan" || kind === "comps_chart" || kind === "erv_walk" || kind === "covenant_card";
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
  const [tubeLayer, setTubeLayer] = useState(true);
  const [compsLayer, setCompsLayer] = useState(true);
  const [anchorsLayer, setAnchorsLayer] = useState(false);
  const [restaurantsLayer, setRestaurantsLayer] = useState(false);
  const [mapType, setMapType] = useState<"hybrid" | "roadmap" | "satellite" | "terrain">("hybrid");
  const [mapDest, setMapDest] = useState<"location_plan" | "hero" | "secondary_external">("location_plan");
  const [scope, setScope] = useState<"investment" | "leasing">("investment");

  const compose = async () => {
    setBusy(true);
    try {
      let endpoint = "";
      let body: any = { pathwayRunId, matterId };
      if (kind === "location_plan") {
        endpoint = `/api/property-imagery/${propertyId}/compose/location-plan`;
        const layers: string[] = [];
        if (tubeLayer) layers.push("tube");
        if (compsLayer) layers.push("comps");
        if (anchorsLayer) layers.push("anchors");
        if (restaurantsLayer) layers.push("restaurants");
        body = { ...body, zoom: 16, mapType, layers, kind: mapDest };
      } else if (kind === "comps_chart") {
        // Auto-pull from investment_comps + crm_comps in the same postcode area
        endpoint = `/api/property-imagery/${propertyId}/compose/comps-chart-auto`;
        body = { ...body, scope, limit: 8, monthsBack: 36 };
      } else if (kind === "erv_walk") {
        // Reads passing/quoting rents + dates off the matter when matterId is set
        endpoint = `/api/property-imagery/${propertyId}/compose/erv-walk-auto`;
      } else if (kind === "covenant_card") {
        // Reads tenant + financials off matter.clientCompanyId when matterId is set
        endpoint = `/api/property-imagery/${propertyId}/compose/covenant-card-auto`;
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
      const data = await res.json().catch(() => ({}));
      const desc = kind === "comps_chart" && data?.compsCount
        ? `${data.compsCount} comps from area ${data.postcodePrefix}`
        : "Saved to Image Studio + this picker";
      toast({ title: `${KIND_LABELS[kind]} generated`, description: desc });
      onComposed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border rounded-md px-3 py-2 bg-muted/40 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted-foreground">
          {kind === "location_plan" && "Google Static map + BGP-red subject pin + selected overlays."}
          {kind === "comps_chart" && "Auto-pulls comps in same postcode area (last 36 months), horizontal bars."}
          {kind === "erv_walk" && (matterId
            ? "Reads passing rent + ERV + dates from this matter, draws stepped reversion path."
            : "Needs passing + ERV + dates — open from a matter detail page for one-click, or set them on the matter first.")}
          {kind === "covenant_card" && (matterId
            ? "Reads tenant + Companies House data + AML status off this matter's client company."
            : "Needs a tenant — link a client company to a matter for one-click, or pass tenantName.")}
        </div>
        <Button size="sm" variant="outline" onClick={compose} disabled={busy} className="gap-1.5 h-7">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
          {existingCount > 0 ? "Generate another" : "Generate"}
        </Button>
      </div>
      {kind === "location_plan" && (
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <select value={mapDest} onChange={(e) => setMapDest(e.target.value as any)} className="bg-background border rounded px-2 py-1" title="Where to save this map shot">
            <option value="location_plan">Save as: Location plan</option>
            <option value="hero">Save as: Hero shot</option>
            <option value="secondary_external">Save as: Gallery</option>
          </select>
          <select value={mapType} onChange={(e) => setMapType(e.target.value as any)} className="bg-background border rounded px-2 py-1">
            <option value="hybrid">Hybrid (satellite + labels)</option>
            <option value="satellite">Satellite</option>
            <option value="terrain">Terrain</option>
            <option value="roadmap">Roadmap</option>
          </select>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={tubeLayer} onChange={(e) => setTubeLayer(e.target.checked)} />
            <span>Tube/rail (TfL)</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={compsLayer} onChange={(e) => setCompsLayer(e.target.checked)} />
            <span>Investment comps</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={anchorsLayer} onChange={(e) => setAnchorsLayer(e.target.checked)} />
            <span>Anchor brands (CRM)</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={restaurantsLayer} onChange={(e) => setRestaurantsLayer(e.target.checked)} />
            <span>Restaurants (Google)</span>
          </label>
        </div>
      )}
      {kind === "comps_chart" && (
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <select value={scope} onChange={(e) => setScope(e.target.value as any)} className="bg-background border rounded px-2 py-1">
            <option value="investment">Investment comps (capital £/sqft)</option>
            <option value="leasing">Leasing comps (rent £/sqft)</option>
          </select>
        </div>
      )}
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
          <select
            value={candidate.kind}
            onChange={(e) => onPatch(candidate.id, { kind: e.target.value })}
            className="h-7 text-[10px] bg-background border rounded px-1 ml-auto"
            title="Reclassify as a different kind"
          >
            <option value="hero">Hero</option>
            <option value="internal">Internal</option>
            <option value="secondary_external">Secondary external</option>
            <option value="location_plan">Location plan</option>
            <option value="floor_plan">Floor plan</option>
            <option value="covenant_card">Covenant</option>
            <option value="comps_chart">Comps chart</option>
            <option value="erv_walk">ERV walk</option>
            <option value="overlay">Overlay</option>
          </select>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onPatch(candidate.id, { hidden: true })}
            className="h-7 px-2 text-xs text-muted-foreground"
            title="Hide — not relevant"
          >
            <EyeOff className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
