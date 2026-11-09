// Investment Tracker image column (2026-11-09). The image belongs to the
// PROPERTY — its pinned hero in property_imagery_assets — so every tracker
// entry for the same property shows the same photo and a reimport or a
// client / status / price edit can't reset it. Thumbnails come from the
// cached /api/image-studio/:id/thumb route and load lazily.
import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ImageIcon, Pin, Upload, Link2, ExternalLink, Loader2 } from "lucide-react";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type HeroStatus = "selected" | "auto" | "ambiguous" | "missing";
export interface HeroResolution {
  status: HeroStatus;
  assetId: string | null;
  imageStudioId: string | null;
  source: string | null;
  sourceUrl: string | null;
  caption: string | null;
  attribution: string | null;
  candidates: number;
}

const HEROES_KEY = ["/api/investment-tracker/hero-images"];

export function useTrackerHeroes() {
  return useQuery<Record<string, HeroResolution>>({ queryKey: HEROES_KEY, staleTime: 60_000 });
}

function refreshHeroes(propertyId: string) {
  queryClient.invalidateQueries({ queryKey: HEROES_KEY });
  queryClient.invalidateQueries({ queryKey: ["/api/property-imagery", propertyId, "manifest"] });
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || res.statusText);
  return json;
}

export function TrackerHeroThumb({ propertyId, hero, name }: { propertyId: string | null; hero: HeroResolution | undefined; name: string }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const imageId = hero?.imageStudioId || null;

  if (!propertyId) {
    return <div className="w-[80px] h-[55px] rounded bg-muted/60 border border-dashed" title="Link a property to add an image" />;
  }

  const placeholderTitle = hero?.status === "ambiguous"
    ? `${hero.candidates} possible photos — choose one`
    : "No image yet — choose one";

  return (
    <>
      <button
        type="button"
        onClick={() => (imageId ? setPreviewOpen(true) : setChooserOpen(true))}
        className="relative block w-[80px] h-[55px] rounded overflow-hidden border bg-muted/60 hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        title={imageId ? `${name} — click to enlarge` : placeholderTitle}
        data-testid={`tracker-hero-${propertyId}`}
      >
        {imageId ? (
          <img
            src={`/api/image-studio/${imageId}/thumb`}
            alt={name}
            width={80}
            height={55}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-4 w-4" />
            {hero?.status === "ambiguous" && (
              <span className="absolute bottom-0.5 right-1 text-[9px] font-medium">Choose</span>
            )}
          </span>
        )}
      </button>

      {imageId && (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{name}</DialogTitle>
              <DialogDescription>
                {hero?.status === "selected" ? "Pinned photo for this property — shown on every tracker entry for it." : "Picked automatically — pin it, or choose another."}
              </DialogDescription>
            </DialogHeader>
            <img src={`/api/image-studio/${imageId}/full`} alt={name} className="w-full max-h-[65vh] object-contain rounded bg-muted" />
            {(hero?.attribution || hero?.sourceUrl) && (
              <p className="text-xs text-muted-foreground">
                {hero.attribution ? <>Credit: {hero.attribution}</> : null}
                {hero.sourceUrl && (
                  <a href={hero.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 text-primary hover:underline">
                    Source <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </p>
            )}
            <div className="flex justify-end gap-2">
              {hero?.status !== "selected" && hero?.assetId && (
                <PinButton propertyId={propertyId} assetId={hero.assetId} onDone={() => setPreviewOpen(false)} />
              )}
              <Button variant="outline" size="sm" onClick={() => { setPreviewOpen(false); setChooserOpen(true); }} data-testid={`tracker-hero-replace-${propertyId}`}>
                Replace image
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {chooserOpen && (
        <HeroChooser propertyId={propertyId} name={name} currentAssetId={hero?.status === "selected" ? hero.assetId : null} open={chooserOpen} onOpenChange={setChooserOpen} />
      )}
    </>
  );
}

function PinButton({ propertyId, assetId, onDone }: { propertyId: string; assetId: string; onDone: () => void }) {
  const { toast } = useToast();
  const pin = useMutation({
    mutationFn: () => postJson(`/api/property-imagery/${propertyId}/select-hero`, { assetId }),
    onSuccess: () => { refreshHeroes(propertyId); toast({ title: "Photo pinned" }); onDone(); },
    onError: (e: any) => toast({ title: "Couldn't pin the photo", description: e?.message, variant: "destructive" }),
  });
  return (
    <Button size="sm" onClick={() => pin.mutate()} disabled={pin.isPending}>
      {pin.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Pin className="h-3.5 w-3.5 mr-1" />}Pin this photo
    </Button>
  );
}

type ManifestCandidate = { id: string; kind: string; imageStudioId: string | null; thumbnail: string | null; caption: string | null; source: string; pinned: boolean };

function HeroChooser({ propertyId, name, currentAssetId, open, onOpenChange }: {
  propertyId: string; name: string; currentAssetId: string | null; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [webOpen, setWebOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [sourcePage, setSourcePage] = useState("");
  const [attribution, setAttribution] = useState("");
  const [usageConfirmed, setUsageConfirmed] = useState(false);

  const { data, isLoading } = useQuery<{ byKind: Record<string, ManifestCandidate[]> }>({
    queryKey: ["/api/property-imagery", propertyId, "manifest"],
    queryFn: async () => {
      const res = await fetch(`/api/property-imagery/${propertyId}/manifest`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Couldn't load this property's photos");
      return res.json();
    },
  });
  // Photographs only — plans, maps and charts aren't offered as the hero.
  const photos = ["hero", "secondary_external", "internal"]
    .flatMap(k => data?.byKind?.[k] || [])
    .filter(c => c.imageStudioId);

  const done = (title: string) => { refreshHeroes(propertyId); toast({ title }); onOpenChange(false); };
  const fail = (e: any) => toast({ title: "Couldn't set the image", description: e?.message, variant: "destructive" });

  const choose = useMutation({
    mutationFn: (body: { assetId?: string; imageStudioId?: string }) => postJson(`/api/property-imagery/${propertyId}/select-hero`, body),
    onSuccess: () => done("Image pinned for this property"),
    onError: fail,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("images", file);
      fd.append("propertyId", propertyId);
      fd.append("category", "Properties");
      fd.append("tags", "Hero");
      const res = await fetch("/api/image-studio/upload", { method: "POST", credentials: "include", headers: getAuthHeaders(), body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || res.statusText);
      const first = Array.isArray(json) ? json[0] : json?.results?.[0];
      if (!first?.id) throw new Error(json?.failures?.[0]?.error || "Upload failed");
      return postJson(`/api/property-imagery/${propertyId}/select-hero`, { imageStudioId: first.id });
    },
    onSuccess: () => done("Photo uploaded and pinned"),
    onError: fail,
  });

  const fromWeb = useMutation({
    mutationFn: () => postJson(`/api/property-imagery/${propertyId}/hero-from-url`, { imageUrl, sourcePage, attribution, usageConfirmed }),
    onSuccess: () => done("Web photo added and pinned"),
    onError: fail,
  });

  const busy = choose.isPending || upload.isPending || fromWeb.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose image — {name}</DialogTitle>
          <DialogDescription>The pinned photo is shown on every tracker entry for this property.</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-24" />)}</div>
        ) : photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No photos on this property yet. Upload one, add a web photo, or add a brochure to the asset's Files.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[45vh] overflow-y-auto">
            {photos.map(c => {
              const isCurrent = c.id === currentAssetId;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy || isCurrent}
                  onClick={() => choose.mutate({ assetId: c.id })}
                  className={`relative rounded overflow-hidden border text-left ${isCurrent ? "ring-2 ring-primary" : "hover:ring-2 hover:ring-primary/40"}`}
                  title={c.caption || undefined}
                >
                  <img src={c.thumbnail || `/api/image-studio/${c.imageStudioId}/thumb`} alt={c.caption || ""} loading="lazy" className="w-full h-24 object-cover" />
                  <span className="absolute top-1 left-1 rounded bg-background/90 px-1 text-[10px]">
                    {isCurrent ? "Pinned" : c.kind === "hero" ? "Hero" : c.kind === "internal" ? "Interior" : "Exterior"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {upload.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}Upload photo
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setWebOpen(v => !v)}>
            <Link2 className="h-3.5 w-3.5 mr-1" />Photo from the web
          </Button>
        </div>

        {webOpen && (
          <div className="space-y-2 rounded border p-3">
            <p className="text-xs text-muted-foreground">Only a photograph of this exact building, from a source that allows its use. The source and credit are kept with the image.</p>
            <div className="space-y-1">
              <Label className="text-xs">Image address (https://…jpg / png / webp)</Label>
              <Input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Page it came from</Label>
              <Input value={sourcePage} onChange={e => setSourcePage(e.target.value)} placeholder="https://" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Credit / attribution</Label>
              <Input value={attribution} onChange={e => setAttribution(e.target.value)} placeholder="e.g. © Owner name, used with permission" />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={usageConfirmed} onCheckedChange={v => setUsageConfirmed(!!v)} />
              I've checked this photo may be used by BGP
            </label>
            <div className="flex justify-end">
              <Button size="sm" disabled={busy || !imageUrl || !attribution || !usageConfirmed} onClick={() => fromWeb.mutate()}>
                {fromWeb.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Add and pin
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
