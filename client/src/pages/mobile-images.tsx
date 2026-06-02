// ─── Mobile image gallery ───────────────────────────────────────────────
// Browse every image in the Image Studio table — generated, uploaded,
// or AI-edited — and run another round of AI editing on any of them from
// your phone.
//
// Reuses the existing /api/image-studio + /api/image-studio/ai-edit
// endpoints. The desktop Image Studio page does the same job with a lot
// more chrome (bulk select, collections, tagging, stock import); on
// mobile the focus is purely: pick one, tell the AI what to change,
// apply, look again.
import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sparkles, ChevronLeft, Search, Loader2, RotateCcw, Image as ImageIcon, X, Wand2,
  Camera, Download,
} from "lucide-react";
import { Link } from "wouter";

interface StudioImage {
  id: string;
  fileName: string;
  category: string | null;
  description: string | null;
  tags: string[] | null;
  source: string | null;
  propertyId: string | null;
  brandName: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
}

const QUICK_PROMPTS = [
  "Re-light at golden-hour dusk",
  "Add a moody overcast sky",
  "Brighten and sharpen for a deck",
  "Remove the scaffolding / hoardings",
  "Outpaint to a wider landscape format",
  "Cleaner colour grade, less saturated",
];

export default function MobileImages() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<StudioImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const { data: images = [], isLoading } = useQuery<StudioImage[]>({
    queryKey: ["/api/image-studio"],
  });

  // Upload a photo from camera or library. Tags it so we can filter
  // "phone uploads" later, and drops the user straight into the edit
  // sheet for the freshly-uploaded image.
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("images", file);
      fd.append("category", "Phone Uploads");
      fd.append("tags", "phone-upload");
      const r = await fetch("/api/image-studio/upload", { method: "POST", credentials: "include", body: fd });
      const body = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(body?.error || `Upload failed (${r.status})`);
      // Endpoint returns the inserted rows directly as an array.
      return body as { id: string }[];
    },
    onSuccess: async (body) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      const newId = body?.[0]?.id;
      if (newId) {
        const fresh = queryClient.getQueryData<StudioImage[]>(["/api/image-studio"]) || [];
        const img = fresh.find((i) => i.id === newId);
        if (img) setSelected(img);
      }
      toast({ title: "Uploaded — ready to edit with AI" });
      setUploading(false);
    },
    onError: (e: any) => {
      toast({ title: "Upload failed", description: e?.message, variant: "destructive" });
      setUploading(false);
    },
  });

  const handleUploadChange = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setUploading(true);
    uploadMutation.mutate(file);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return images;
    return images.filter((i) => {
      const hay = [
        i.fileName, i.description, i.category, i.brandName,
        ...(i.tags || []),
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [images, search]);

  return (
    <div className="pb-24" data-testid="mobile-images">
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUploadChange}
        data-testid="mobile-images-upload-input"
      />

      <div
        className="px-4 pb-3 flex items-center gap-3 border-b border-border/40 bg-background/95 backdrop-blur sticky top-0 z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <Link href="/" className="p-2 -ml-2 rounded-full active:bg-gray-100">
          <ChevronLeft className="w-6 h-6" />
        </Link>
        <h1 className="text-2xl font-semibold flex-1">Images</h1>
        <button
          type="button"
          onClick={() => uploadInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 h-10 px-3 rounded-full bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60 active:scale-95 transition-transform"
          data-testid="mobile-images-upload"
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Camera className="w-4 h-4" />
          )}
          {uploading ? "Uploading…" : "Add photo"}
        </button>
      </div>

      <div className="px-4 mt-3 mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search descriptions, brands, tags…"
            className="h-11 pl-9 text-sm rounded-xl"
            data-testid="mobile-images-search"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center pt-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 mt-8 text-center">
          <ImageIcon className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {search ? "No images match that search" : "No images in the studio yet"}
          </p>
        </div>
      ) : (
        <div className="px-3 grid grid-cols-2 gap-2">
          {filtered.map((img) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setSelected(img)}
              className="aspect-square overflow-hidden rounded-xl bg-muted active:opacity-80 text-left relative"
              data-testid={`mobile-image-${img.id}`}
            >
              <img
                src={`/api/image-studio/${img.id}/thumb`}
                alt={img.description || img.fileName}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {img.source === "ai-edited" && (
                <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[9px] font-semibold">
                  <Sparkles className="w-2.5 h-2.5" /> AI
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <ImageEditSheet image={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function ImageEditSheet({ image, onClose }: { image: StudioImage | null; onClose: () => void }) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!image) throw new Error("No image");
      const trimmed = prompt.trim();
      if (!trimmed) throw new Error("Tell the AI what to change");
      const r = await fetch("/api/image-studio/ai-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ imageId: image.id, editPrompt: trimmed }),
      });
      const body = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(body?.error || `AI edit failed (${r.status})`);
      return body as { provider: string };
    },
    onSuccess: (body) => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      toast({ title: "AI edit applied", description: `via ${body.provider}` });
      setPrompt("");
    },
    onError: (e: any) => {
      toast({ title: "Couldn't edit", description: e?.message, variant: "destructive" });
    },
  });

  // Save to device — use Web Share API if available (iOS / Android),
  // fall back to a download anchor. Web Share with files pulls up the
  // native share sheet which includes "Save to Photos".
  const [saving, setSaving] = useState(false);
  const saveToDevice = async () => {
    if (!image) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/image-studio/${image.id}/full`, { credentials: "include" });
      if (!r.ok) throw new Error(`Couldn't fetch image (${r.status})`);
      const blob = await r.blob();
      const filename = `${(image.description || image.fileName || "image").replace(/[^a-z0-9-_]+/gi, "-")}.png`;
      const file = new File([blob], filename, { type: blob.type || "image/png" });
      const navAny = navigator as any;
      if (navAny.canShare && navAny.canShare({ files: [file] })) {
        await navAny.share({ files: [file], title: filename });
        toast({ title: "Shared" });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast({ title: "Downloaded — check your camera roll / Files" });
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {                  // user dismissed share sheet
        toast({ title: "Save failed", description: e?.message, variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const revertMutation = useMutation({
    mutationFn: async () => {
      if (!image) throw new Error("No image");
      const r = await fetch(`/api/image-studio/${image.id}/revert`, { method: "POST", credentials: "include" });
      const body = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(body?.error || `Revert failed (${r.status})`);
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      toast({ title: "Reverted to previous version" });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't revert", description: e?.message, variant: "destructive" });
    },
  });

  const insertPrompt = (text: string) => {
    setPrompt((cur) => cur ? `${cur}. ${text}` : text);
    promptInputRef.current?.focus();
  };

  // Cache-bust the preview so a fresh edit shows the new bytes without
  // having to close + reopen the sheet.
  const previewSrc = image
    ? `/api/image-studio/${image.id}/full?v=${editMutation.isSuccess ? Date.now() : "0"}`
    : "";

  return (
    <Sheet open={!!image} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="h-[95dvh] p-0 rounded-t-3xl flex flex-col"
      >
        {image && (
          <>
            <div className="px-4 pt-4 pb-3 flex items-center gap-2 border-b border-border/40 shrink-0">
              <h2 className="text-base font-semibold flex-1 truncate">
                {image.description || image.fileName}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="p-2 -mr-2 rounded-full active:bg-gray-100"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="bg-muted">
                <img
                  src={previewSrc}
                  alt={image.description || image.fileName}
                  className="w-full max-h-[55dvh] object-contain"
                />
              </div>

              <div className="p-4 space-y-3">
                {(image.tags && image.tags.length > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {image.tags.slice(0, 8).map((t) => (
                      <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-semibold flex items-center gap-1.5">
                    <Wand2 className="w-3.5 h-3.5 text-violet-600" />
                    Edit with AI
                  </label>
                  <Textarea
                    ref={promptInputRef}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="What should change? e.g. 'Re-light at dusk, add a warmer tone, remove the cars on the left'"
                    rows={3}
                    className="text-sm"
                    data-testid="mobile-image-edit-prompt"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_PROMPTS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => insertPrompt(q)}
                        className="text-[11px] px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-100 active:bg-violet-100"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div
              className="border-t border-border/60 bg-background px-4 pt-3 flex items-center gap-2 shrink-0"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
            >
              <Button
                type="button"
                variant="outline"
                onClick={saveToDevice}
                disabled={saving}
                className="h-12"
                aria-label="Save to phone"
                data-testid="mobile-image-save"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              </Button>
              {image.source === "ai-edited" && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => revertMutation.mutate()}
                  disabled={revertMutation.isPending}
                  className="h-12"
                  data-testid="mobile-image-revert"
                >
                  {revertMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4" />
                  )}
                </Button>
              )}
              <Button
                type="button"
                onClick={() => editMutation.mutate()}
                disabled={editMutation.isPending || !prompt.trim()}
                className="flex-1 h-12 text-base font-semibold gap-2"
                data-testid="mobile-image-apply"
              >
                {editMutation.isPending ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> AI is editing…</>
                ) : (
                  <><Sparkles className="w-5 h-5" /> Apply with AI</>
                )}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
