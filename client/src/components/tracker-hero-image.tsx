// Investment Tracker image column (2026-11-09). The image belongs to the
// PROPERTY — its pinned hero in property_imagery_assets — so every tracker
// entry for the same property shows the same photo and a reimport or a
// client / status / price edit can't reset it. Filled automatically from
// the cover photo of a brochure on the asset's Files, or of one found in
// the investment team's email by exact match; otherwise the box says
// "Choose image" and a person uploads or picks one. Asset files and
// web photos only when a person picks one. Rule + server side: server/property-imagery.ts. Thumbnails
// come from the cached /api/image-studio/:id/thumb route and load lazily.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { ImageIcon, Upload, Link2, ExternalLink, Loader2, Search, Move, Check } from "lucide-react";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type HeroStatus = "selected" | "ambiguous" | "missing" | "no_brochure";
export interface HeroResolution {
  status: HeroStatus;
  assetId: string | null;
  imageStudioId: string | null;
  source: string | null;
  sourceUrl: string | null;
  caption: string | null;
  attribution: string | null;
  candidates: number;
  crop?: { x: number; y: number; zoom: number } | null;
}

/** The tracker's 3:2 thumbnail — cut to the person's chosen position when one is saved. */
export function heroThumbUrl(imageStudioId: string, crop?: { x: number; y: number; zoom: number } | null) {
  return `/api/image-studio/${imageStudioId}/thumb?fit=box${crop ? `&cx=${crop.x}&cy=${crop.y}&z=${crop.zoom}` : ""}`;
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
  const [positioning, setPositioning] = useState<{ assetId: string; imageStudioId: string; crop?: { x: number; y: number; zoom: number } | null } | null>(null);
  const imageId = hero?.imageStudioId || null;

  if (!propertyId) {
    return <div className="w-[144px] h-[96px] rounded-md border border-dashed border-border bg-muted/40" title="Link a property to add an image" />;
  }

  const placeholderTitle = hero?.status === "ambiguous"
    ? `${hero.candidates} possible brochure photos — choose one`
    : hero?.status === "missing"
      ? "The brochure on file has no usable photo — choose one"
      : "No image yet — choose or upload one";
  const placeholderLabel = "Choose image";

  return (
    <>
      {/* One frame for every row: a card with a thin mat, the photo (or the
          empty state) filling the same 3:2 window inside it. */}
      <button
        type="button"
        onClick={() => (imageId ? setPreviewOpen(true) : setChooserOpen(true))}
        className="block w-[144px] h-[96px] rounded-md border border-border bg-card p-[3px] shadow-sm transition-shadow hover:shadow-md hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        title={imageId ? `${name} — click to enlarge` : placeholderTitle}
        data-testid={`tracker-hero-${propertyId}`}
      >
        <span className="relative block h-full w-full overflow-hidden rounded-[4px] bg-muted">
          {imageId ? (
            <img
              src={heroThumbUrl(imageId, hero?.crop)}
              alt={name}
              width={136}
              height={88}
              loading="lazy"
              decoding="async"
              className="block h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
              <ImageIcon className="h-5 w-5" />
              <span className="text-[10px] font-medium leading-none">{placeholderLabel}</span>
            </span>
          )}
        </span>
      </button>

      {imageId && (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{name}</DialogTitle>
              <DialogDescription>Pinned photo for this property — shown on every tracker entry for it.</DialogDescription>
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
              {hero?.assetId && (
                <Button variant="outline" size="sm" onClick={() => { setPreviewOpen(false); setPositioning({ assetId: hero.assetId!, imageStudioId: imageId, crop: hero.crop }); }} data-testid={`tracker-hero-position-${propertyId}`}>
                  <Move className="h-3.5 w-3.5 mr-1" />Adjust position
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => { setPreviewOpen(false); setChooserOpen(true); }} data-testid={`tracker-hero-replace-${propertyId}`}>
                Replace image
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {chooserOpen && (
        <HeroChooser propertyId={propertyId} name={name} status={hero?.status} currentAssetId={hero?.status === "selected" ? hero.assetId : null} open={chooserOpen} onOpenChange={setChooserOpen} onPinned={setPositioning} />
      )}
      {positioning && (
        <HeroPositioner propertyId={propertyId} name={name} assetId={positioning.assetId} imageStudioId={positioning.imageStudioId} initial={positioning.crop} onClose={() => setPositioning(null)} />
      )}
    </>
  );
}

// What the brochure search is doing while it runs (Jack, 2026-11-11: with
// only a spinner people think it's stuck). The server works through these
// steps in this order but doesn't report back mid-way, so the step shown
// moves on the usual timings — it says what is happening, not a measured
// percentage — and the bar keeps moving until the answer comes back.
const SEARCH_STEPS: Array<[number, string]> = [
  [0, "Checking the brochures already on this asset's Files"],
  [4, "Searching the investment team's mailboxes for its brochure"],
  [22, "Opening the PDFs it found and checking they are for this exact asset"],
  [45, "Looking through the brochure for a photo of the whole building"],
];

function BrochureSearchProgress() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const current = SEARCH_STEPS.reduce((at, [from], i) => (seconds >= from ? i : at), 0);
  // Eases towards full without ever claiming to be finished.
  const filled = Math.round(92 * (1 - Math.exp(-seconds / 28)));
  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3" role="status" aria-live="polite" data-testid="brochure-search-progress">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">Looking for the brochure…</span>
        <span className="tabular-nums text-muted-foreground">{seconds}s · usually under a minute</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${filled}%` }} />
      </div>
      <ol className="space-y-1">
        {SEARCH_STEPS.map(([, label], i) => (
          <li key={label} className={`flex items-center gap-2 text-xs ${i === current ? "text-foreground" : "text-muted-foreground"}`}>
            {i < current ? <Check className="h-3.5 w-3.5 shrink-0" /> : i === current ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <span className="inline-block h-3.5 w-3.5 shrink-0" />}
            {label}
          </li>
        ))}
      </ol>
      {seconds >= 75 && <p className="text-[11px] text-muted-foreground">Still working — a large mailbox or a long brochure can take a couple of minutes.</p>}
    </div>
  );
}

type ManifestCandidate = { id: string; kind: string; imageStudioId: string | null; thumbnail: string | null; caption: string | null; source: string; pinned: boolean };

function HeroChooser({ propertyId, name, status, currentAssetId, open, onOpenChange, onPinned }: {
  propertyId: string; name: string; status: HeroStatus | undefined; currentAssetId: string | null; open: boolean; onOpenChange: (v: boolean) => void;
  /** A person picked or uploaded a photo — next they position it in the frame. */
  onPinned: (p: { assetId: string; imageStudioId: string }) => void;
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

  const done = (title: string, asset?: any) => {
    refreshHeroes(propertyId);
    toast({ title });
    onOpenChange(false);
    if (asset?.id && asset?.imageStudioId) onPinned({ assetId: asset.id, imageStudioId: asset.imageStudioId });
  };
  const fail = (e: any) => toast({ title: "Couldn't set the image", description: e?.message, variant: "destructive" });

  const choose = useMutation({
    mutationFn: (body: { assetId?: string; imageStudioId?: string }) => postJson(`/api/property-imagery/${propertyId}/select-hero`, body),
    onSuccess: (asset: any) => done("Image pinned — now position it in the frame", asset),
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
    onSuccess: (asset: any) => done("Photo uploaded — now position it in the frame", asset),
    onError: fail,
  });

  const fromWeb = useMutation({
    mutationFn: () => postJson(`/api/property-imagery/${propertyId}/hero-from-url`, { imageUrl, sourcePage, attribution, usageConfirmed }),
    onSuccess: (asset: any) => done("Web photo added — now position it in the frame", asset),
    onError: fail,
  });

  // Runs the automatic rule now: brochure cover on file, else a brochure
  // found in the investment team's email by exact match (saved to Files).
  const findBrochure = useMutation({
    mutationFn: () => postJson(`/api/property-imagery/${propertyId}/find-brochure-hero`, {}),
    onSuccess: (r: { outcome: string }) => {
      refreshHeroes(propertyId);
      if (r.outcome === "selected" || r.outcome === "kept") { toast({ title: "Brochure cover photo pinned" }); onOpenChange(false); }
      else if (r.outcome === "ambiguous") toast({ title: "Several brochure photos — pick one below" });
      else if (r.outcome === "missing") toast({ title: "The brochure has no usable photo", description: "Choose or upload one." });
      else toast({ title: "No brochure found in files or email", description: "Upload a photo, or add the PDF brochure to the asset's Files." });
    },
    onError: fail,
  });

  const busy = choose.isPending || upload.isPending || fromWeb.isPending || findBrochure.isPending;

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

        {status === "no_brochure" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">No brochure on file for this asset — request the PDF brochure from the agent, then add it to the asset's Files and its cover photo is used.</p>
        )}
        {findBrochure.isPending && <BrochureSearchProgress />}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" disabled={busy} onClick={() => findBrochure.mutate()} title="Use the brochure's cover photo — from the asset's Files, or found in the investment team's email">
            {findBrochure.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Search className="h-3.5 w-3.5 mr-1" />}Find brochure photo
          </Button>
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


// Position a photo in the tracker's frame (Jack, 2026-11-10): every image
// box on the board is the same 3:2 shape, so the person who picks a photo
// drags it and zooms until the frame shows what it should. Opens straight
// after a photo is chosen or uploaded, and from "Adjust position" on any
// pinned photo. The frame's centre and zoom are saved on the asset; the
// thumbnail is cut to them (server: /thumb?fit=box&cx&cy&z).
const FRAME_W = 480;
const FRAME_H = 320;

function HeroPositioner({ propertyId, name, assetId, imageStudioId, initial, onClose }: {
  propertyId: string; name: string; assetId: string; imageStudioId: string;
  initial?: { x: number; y: number; zoom: number } | null; onClose: () => void;
}) {
  const { toast } = useToast();
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [pos, setPos] = useState({ x: initial?.x ?? 0.5, y: initial?.y ?? 0.5, zoom: initial?.zoom ?? 1 });
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // Scale that makes the picture just fill the frame, times the zoom.
  const scale = dims ? Math.max(FRAME_W / dims.w, FRAME_H / dims.h) * pos.zoom : 1;
  // The frame must stay inside the picture: clamp its centre.
  const clamp = (x: number, y: number, zoom: number) => {
    if (!dims) return { x, y, zoom };
    const sc = Math.max(FRAME_W / dims.w, FRAME_H / dims.h) * zoom;
    const hx = FRAME_W / (2 * dims.w * sc), hy = FRAME_H / (2 * dims.h * sc);
    return { x: Math.min(1 - hx, Math.max(hx, x)), y: Math.min(1 - hy, Math.max(hy, y)), zoom };
  };
  const shown = clamp(pos.x, pos.y, pos.zoom);

  const save = useMutation({
    mutationFn: () => postJson(`/api/property-imagery/asset/${assetId}/crop`, shown),
    onSuccess: () => { refreshHeroes(propertyId); toast({ title: "Photo positioned" }); onClose(); },
    onError: (e: any) => toast({ title: "Couldn't save the position", description: e?.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Position photo — {name}</DialogTitle>
          <DialogDescription>Drag the photo and use the zoom so the frame shows the asset as you want it on the tracker.</DialogDescription>
        </DialogHeader>
        <div
          className="relative mx-auto overflow-hidden rounded-md border bg-muted touch-none select-none cursor-grab active:cursor-grabbing"
          style={{ width: "100%", maxWidth: FRAME_W, aspectRatio: `${FRAME_W} / ${FRAME_H}` }}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, x: shown.x, y: shown.y }; }}
          onPointerMove={(e) => {
            if (!drag.current || !dims) return;
            // The frame may be drawn narrower than 480 on a small screen.
            const k = FRAME_W / (e.currentTarget as HTMLElement).getBoundingClientRect().width;
            const dx = (e.clientX - drag.current.px) * k, dy = (e.clientY - drag.current.py) * k;
            setPos(p => clamp(drag.current!.x - dx / (dims.w * scale), drag.current!.y - dy / (dims.h * scale), p.zoom));
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
          data-testid="hero-positioner-frame"
        >
          <img
            src={`/api/image-studio/${imageStudioId}/full`}
            alt={name}
            draggable={false}
            onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="absolute max-w-none"
            style={dims ? {
              width: `${(dims.w * scale / FRAME_W) * 100}%`,
              left: `${(0.5 - shown.x * dims.w * scale / FRAME_W) * 100}%`,
              top: `${(0.5 - shown.y * dims.h * scale / FRAME_H) * 100}%`,
            } : { width: "100%", opacity: 0 }}
          />
          {!dims && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        </div>
        <div className="flex items-center gap-3">
          <Label className="text-xs shrink-0">Zoom</Label>
          <Slider min={1} max={3} step={0.05} value={[pos.zoom]} onValueChange={([z]) => setPos(p => clamp(p.x, p.y, z))} aria-label="Zoom" data-testid="hero-positioner-zoom" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Leave as it is</Button>
          <Button size="sm" disabled={!dims || save.isPending} onClick={() => save.mutate()} data-testid="hero-positioner-save">
            {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Save position
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Rule (Jack, 2026-11-10): when an asset is added, the app looks for its
// brochure — the asset's Files, then the investment team's email by exact
// match — files it and pins its photo. When there's none, the person who
// added it is asked for the brochure there and then.
export function NewAssetBrochureFlow({ asset, onClose }: { asset: { id: string; propertyId: string; name: string }; onClose: () => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<"searching" | "ask" | "no-photo" | "uploading">("searching");

  const finish = (title: string) => { refreshHeroes(asset.propertyId); toast({ title }); onClose(); };

  useEffect(() => {
    let live = true;
    postJson(`/api/property-imagery/${asset.propertyId}/find-brochure-hero`, {})
      .then((r: { outcome: string }) => {
        if (!live) return;
        if (r.outcome === "selected" || r.outcome === "kept") finish("Brochure found and filed — photo pinned");
        else if (r.outcome === "missing" || r.outcome === "ambiguous") { refreshHeroes(asset.propertyId); setStage("no-photo"); }
        else setStage("ask");
      })
      .catch(() => { if (live) setStage("ask"); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.propertyId]);

  async function upload(file: File) {
    setStage("uploading");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/investment-tracker/${asset.id}/marketing-files`, { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(await res.text());
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker", asset.id, "marketing-files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/investment-tracker/all-marketing-files"] });
      // The server lifts the photo out of the brochure after the upload returns.
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 4000));
        const heroes = await fetch("/api/investment-tracker/hero-images", { credentials: "include", headers: getAuthHeaders(), cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null);
        if (heroes?.[asset.propertyId]?.status === "selected") return finish("Brochure filed — photo pinned");
      }
      refreshHeroes(asset.propertyId);
      setStage("no-photo");
    } catch (e: any) {
      toast({ title: "Couldn't upload the brochure", description: e?.message, variant: "destructive" });
      setStage("ask");
    }
  }

  const busy = stage === "searching" || stage === "uploading";
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Brochure — {asset.name}</DialogTitle>
          <DialogDescription>
            {stage === "searching" && "Looking for this asset's brochure in its files and the investment team's email…"}
            {stage === "uploading" && "Filing the brochure and finding its photo…"}
            {stage === "ask" && "No brochure was found for this asset. Please upload the brochure PDF — it's filed on the asset and its cover photo becomes the tracker image."}
            {stage === "no-photo" && "The brochure is filed on the asset, but it has no photo showing the whole asset. Upload another brochure, or choose an image from the Image box on the row."}
          </DialogDescription>
        </DialogHeader>
        {stage === "searching" && <BrochureSearchProgress />}
        {stage === "uploading" && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>{busy ? "Carry on in the background" : "Not now"}</Button>
          {!busy && (
            <Button size="sm" onClick={() => fileRef.current?.click()} data-testid="button-upload-brochure-new-asset">
              <Upload className="h-3.5 w-3.5 mr-1" />Upload brochure
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
