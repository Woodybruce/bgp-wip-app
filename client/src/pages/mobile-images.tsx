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
import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sparkles, ChevronLeft, Search, Loader2, RotateCcw, Image as ImageIcon, X, Wand2,
  Camera, Download, Link2, Building2, Tag, Briefcase, ZoomIn, Trash2, Folder, FolderPlus,
} from "lucide-react";
import { ToastAction } from "@/components/ui/toast";
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

// A user-made folder is just an Image Studio collection with no `kind`
// (pathway / property / brand collections are auto-generated and filtered
// out of this view). Folders — like the photos themselves — live in the
// shared Image Studio library, so everyone on the team sees them.
interface Collection {
  id: string;
  name: string;
  kind: string | null;
  property_id: string | null;
  company_id: string | null;
  image_count: number;
  cover_thumbnail: string | null; // full data URL, or null
}

// Auto-generated folders (pathway runs, brand + property umbrellas) carry a
// `kind`, a CRM link, or a "Pathway · / Brand · / Property · " name prefix.
// Older pathway rows predate the `kind` column but always keep the name
// prefix, so we match on all three. Everything left is a hand-made folder.
const SYSTEM_FOLDER_NAME = /^(Pathway|Brand|Property) · /;
function isUserFolder(c: Collection): boolean {
  return c.kind == null && !c.property_id && !c.company_id && !SYSTEM_FOLDER_NAME.test(c.name);
}

// What a drop lands on: another photo (→ make a new folder) or an existing
// folder tile (→ drop the photo straight in).
type DropTarget = { type: "image" | "folder"; id: string } | null;

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

  // Poll the gallery while ANY image is mid-edit so the Processing chip
  // disappears (and the new thumbnail appears) without the user having
  // to refresh. Once everything's settled, drop back to no polling.
  const [anyPending, setAnyPending] = useState(false);
  const { data: images = [], isLoading } = useQuery<StudioImage[]>({
    queryKey: ["/api/image-studio"],
    refetchInterval: anyPending ? 4000 : false,
  });

  // Upload a photo from camera or library. Tags it so we can filter
  // "phone uploads" later, and drops the user straight into the edit
  // sheet for the freshly-uploaded image.
  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const fd = new FormData();
      for (const f of files) fd.append("images", f);
      fd.append("category", "Phone Uploads");
      fd.append("tags", "phone-upload");
      const r = await fetch("/api/image-studio/upload", { method: "POST", credentials: "include", body: fd });
      const body = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(body?.error || `Upload failed (${r.status})`);
      // Server returns the raw Drizzle rows on success (or {results,failures}
      // on partial). We only need the ids back — the gallery refetch below
      // gives us properly-shaped StudioImage rows for rendering. (Earlier
      // attempt to use the upload response directly broke the edit sheet:
      // the raw row's thumbnailData comes back as a Buffer-shaped object
      // instead of the data URI the renderer expects.)
      const results: { id: string }[] = Array.isArray(body) ? body : (body?.results || []);
      const failures: { filename: string; error: string }[] = Array.isArray(body) ? [] : (body?.failures || []);
      return { results, failures };
    },
    onSuccess: async ({ results, failures }) => {
      // Await the invalidate so the refetch lands BEFORE we read from
      // cache — otherwise getQueryData returns the stale list and the
      // edit sheet (and grid) appear not to update.
      await queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      if (results.length === 1 && failures.length === 0) {
        const fresh = queryClient.getQueryData<StudioImage[]>(["/api/image-studio"]) || [];
        const img = fresh.find((i) => i.id === results[0].id);
        if (img) setSelected(img);
        toast({ title: "Uploaded — ready to edit with AI" });
      } else if (results.length > 0 && failures.length === 0) {
        toast({ title: `${results.length} photos uploaded`, description: "Tap any one to edit with AI." });
      } else if (results.length > 0 && failures.length > 0) {
        toast({
          title: `${results.length} uploaded, ${failures.length} failed`,
          description: failures[0].error,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Upload failed",
          description: failures[0]?.error || "Couldn't process the photo",
          variant: "destructive",
        });
      }
      setUploading(false);
    },
    onError: (e: any) => {
      toast({ title: "Upload failed", description: e?.message, variant: "destructive" });
      setUploading(false);
    },
  });

  const handleUploadChange = (ev: React.ChangeEvent<HTMLInputElement>) => {
    // CRITICAL on iOS Safari: snapshot the FileList into an array BEFORE
    // touching ev.target.value. Setting .value = "" empties the input's
    // files list, and on iOS the FileList we already grabbed is a LIVE
    // reference — clearing the input wipes it out from under us, leaving
    // arr.length === 0 and the function silently returning. That was the
    // "tap Add → pick photo → nothing happens" bug Woody hit on /m/images.
    const fileList = ev.target.files;
    if (!fileList || fileList.length === 0) return;
    const arr = Array.from(fileList).slice(0, 20); // server cap is 20
    ev.target.value = ""; // safe now — arr is detached
    if (arr.length === 0) return;
    setUploading(true);
    uploadMutation.mutate(arr);
  };

  // Keep the polling flag in sync with the current list.
  useEffect(() => {
    const hasPending = images.some((i) => (i.tags || []).includes("ai-pending"));
    setAnyPending(hasPending);
  }, [images]);

  // Image ids that already live in a hand-made folder — used to keep the
  // default grid showing only *unfiled* photos.
  const { data: filed } = useQuery<{ imageIds: string[] }>({
    queryKey: ["/api/image-studio/filed-image-ids"],
  });
  const filedSet = useMemo(() => new Set(filed?.imageIds || []), [filed]);

  // Mobile gallery is intentionally scoped to photos that came off the
  // phone — keeps the grid tight and focused on Woody's own captures
  // instead of the 6k+ brand library. Everything is still saved to the
  // central Image Studio (just filtered on the way out). Trashed images
  // are also filtered here so soft-deleted ones vanish immediately. Photos
  // already filed into a folder drop out of this default view too.
  const filtered = useMemo(() => {
    const own = images.filter((i) =>
      ((i.tags || []).includes("phone-upload") || i.category === "Phone Uploads")
      && !(i.tags || []).includes("trashed")
      && !filedSet.has(i.id)
    );
    const q = search.trim().toLowerCase();
    if (!q) return own;
    return own.filter((i) => {
      const hay = [
        i.fileName, i.description, i.category, i.brandName,
        ...(i.tags || []),
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [images, search, filedSet]);

  // ─── Folders (shared Image Studio collections) ─────────────────────────
  // Only ad-hoc, user-made folders (kind === null) — pathway/property/brand
  // collections are auto-managed elsewhere and would just be noise here.
  const { data: allCollections = [] } = useQuery<Collection[]>({
    queryKey: ["/api/image-studio/collections"],
  });
  const folders = useMemo(
    () => allCollections.filter(isUserFolder),
    [allCollections],
  );

  // imageIds waiting for the user to name a brand-new folder (set when a
  // photo is dropped onto another photo).
  const [pendingGroup, setPendingGroup] = useState<string[] | null>(null);
  // id of the folder whose contents are open in the bottom sheet.
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);

  const createGroupMutation = useMutation({
    mutationFn: async ({ name, imageIds }: { name: string; imageIds: string[] }) => {
      const created = await apiRequest("POST", "/api/image-studio/collections", { name });
      const collection = (await created.json()) as { id: string };
      await apiRequest("POST", `/api/image-studio/collections/${collection.id}/images`, { imageIds });
      return collection;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/filed-image-ids"] });
      setPendingGroup(null);
      toast({ title: "Folder created", description: "Everyone on the team can see it." });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't create folder", description: e?.message, variant: "destructive" });
    },
  });

  const addToFolderMutation = useMutation({
    mutationFn: async ({ folderId, imageIds }: { folderId: string; imageIds: string[] }) => {
      await apiRequest("POST", `/api/image-studio/collections/${folderId}/images`, { imageIds });
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections", vars.folderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/filed-image-ids"] });
      const name = folders.find((f) => f.id === vars.folderId)?.name;
      toast({ title: name ? `Added to ${name}` : "Added to folder" });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't add to folder", description: e?.message, variant: "destructive" });
    },
  });

  // ─── Inline folder view ────────────────────────────────────────────────
  // Tapping a folder swaps the default (unfiled) grid for that folder's
  // contents, right here in the page — no pop-out sheet.
  const openFolder = useMemo(
    () => folders.find((f) => f.id === openFolderId) || null,
    [folders, openFolderId],
  );
  const { data: folderData, isLoading: folderLoading } = useQuery<{ id: string; name: string; images: any[] }>({
    queryKey: ["/api/image-studio/collections", openFolderId],
    enabled: !!openFolderId,
  });
  const folderImages = folderData?.images || [];

  const toStudioImage = (r: any): StudioImage => ({
    id: r.id, fileName: r.file_name, category: r.category, description: r.description,
    tags: r.tags, source: r.source, propertyId: r.property_id, brandName: r.brand_name,
    width: r.width, height: r.height, createdAt: r.created_at,
  });

  const removeFromFolderMutation = useMutation({
    mutationFn: async (imageId: string) => {
      if (!openFolderId) return;
      await apiRequest("DELETE", `/api/image-studio/collections/${openFolderId}/images/${imageId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections", openFolderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/filed-image-ids"] });
    },
    onError: (e: any) => toast({ title: "Couldn't remove", description: e?.message, variant: "destructive" }),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async () => {
      if (!openFolderId) return;
      await apiRequest("DELETE", `/api/image-studio/collections/${openFolderId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/filed-image-ids"] });
      toast({ title: "Folder deleted", description: "The photos themselves are still in your library." });
      setOpenFolderId(null);
    },
    onError: (e: any) => toast({ title: "Couldn't delete folder", description: e?.message, variant: "destructive" }),
  });

  // ─── Long-press to drag, drop to group ─────────────────────────────────
  // HTML5 drag-and-drop is a no-op on touch, so we run our own pointer
  // gesture: hold a tile ~250ms to pick it up, drag it over another tile,
  // release to act. A short hold-then-release (no real drag) falls through
  // to the normal tap so browsing still works.
  const rootRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragImageRef = useRef<StudioImage | null>(null);
  const pressTimer = useRef<number | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  // While a drag is live we must stop the page from scrolling under the
  // finger. React's onTouchMove is passive (can't preventDefault), so attach
  // a non-passive listener directly and gate it on draggingRef.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => { if (draggingRef.current) e.preventDefault(); };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  const clearPressTimer = () => {
    if (pressTimer.current != null) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };

  const finishDrag = () => {
    draggingRef.current = false;
    dragImageRef.current = null;
    setDragId(null);
    setGhostPos(null);
    setDropTarget(null);
    clearPressTimer();
  };

  const onTilePointerDown = (e: React.PointerEvent, img: StudioImage) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const { clientX, clientY, pointerId } = e;
    const target = e.currentTarget as HTMLElement;
    suppressClick.current = false;
    startPos.current = { x: clientX, y: clientY };
    clearPressTimer();
    pressTimer.current = window.setTimeout(() => {
      draggingRef.current = true;
      dragImageRef.current = img;
      setDragId(img.id);
      setGhostPos({ x: clientX, y: clientY });
      try { target.setPointerCapture(pointerId); } catch {}
      if (navigator.vibrate) navigator.vibrate(12);
    }, 250);
  };

  const onTilePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) {
      // Moved before the hold landed → it's a scroll, not a drag. Bail.
      if (startPos.current && pressTimer.current != null) {
        if (Math.abs(e.clientX - startPos.current.x) > 8 || Math.abs(e.clientY - startPos.current.y) > 8) {
          clearPressTimer();
        }
      }
      return;
    }
    setGhostPos({ x: e.clientX, y: e.clientY });
    const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const dropEl = under?.closest("[data-drop-id]") as HTMLElement | null;
    const id = dropEl?.getAttribute("data-drop-id") || null;
    const type = dropEl?.getAttribute("data-drop-type") as "image" | "folder" | null;
    if (id && type && !(type === "image" && id === dragImageRef.current?.id)) {
      setDropTarget({ type, id });
    } else {
      setDropTarget(null);
    }
  };

  const onTilePointerUp = () => {
    const wasDragging = draggingRef.current;
    const dragged = dragImageRef.current;
    const target = dropTarget;
    if (wasDragging) suppressClick.current = true; // don't open the edit sheet on release
    finishDrag();
    if (wasDragging && dragged && target) {
      if (target.type === "folder") {
        addToFolderMutation.mutate({ folderId: target.id, imageIds: [dragged.id] });
      } else if (target.type === "image" && target.id !== dragged.id) {
        setPendingGroup([dragged.id, target.id]);
      }
    }
  };

  const handleTileClick = (img: StudioImage) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setSelected(img);
  };

  return (
    <div ref={rootRef} className="pb-24" data-testid="mobile-images">
      <div
        className="px-4 pb-3 flex items-center gap-3 border-b border-border/40 bg-background/95 backdrop-blur sticky top-0 z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        {openFolder ? (
          <>
            <button
              type="button"
              onClick={() => setOpenFolderId(null)}
              className="p-2 -ml-2 rounded-full active:bg-gray-100"
              aria-label="Back to all photos"
              data-testid="mobile-folder-back"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <h1 className="text-2xl font-semibold flex-1 truncate">{openFolder.name}</h1>
            <button
              type="button"
              onClick={() => { if (window.confirm("Delete this folder? The photos stay in your library.")) deleteFolderMutation.mutate(); }}
              disabled={deleteFolderMutation.isPending}
              className="p-2 -mr-2 rounded-full active:bg-gray-100 text-red-600"
              aria-label="Delete folder"
              data-testid="mobile-folder-delete"
            >
              {deleteFolderMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
            </button>
          </>
        ) : (
          <>
            <Link href="/" className="p-2 -ml-2 rounded-full active:bg-gray-100">
              <ChevronLeft className="w-6 h-6" />
            </Link>
            <h1 className="text-2xl font-semibold flex-1">Images</h1>
            {/* iOS Safari is unreliable about firing a hidden-input change event
                when triggered programmatically with .click(). Using a real
                <label htmlFor> + sr-only input is the rock-solid pattern — iOS
                treats the label tap as a direct user gesture on the input. */}
            <label
              htmlFor="mobile-images-upload-input"
              aria-disabled={uploading}
              className={`inline-flex items-center gap-1.5 h-10 px-3 rounded-full bg-primary text-primary-foreground text-sm font-semibold active:scale-95 transition-transform cursor-pointer ${uploading ? "opacity-60 pointer-events-none" : ""}`}
              data-testid="mobile-images-upload"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
              {uploading ? "Uploading…" : "Add photos"}
            </label>
          </>
        )}
        {/* sr-only keeps the input in the DOM + accessible (so iOS treats it
            as visible enough to deliver the change event) but invisible. */}
        <input
          ref={uploadInputRef}
          id="mobile-images-upload-input"
          type="file"
          // image/* alone misses HEIC on some iOS versions when the file
          // comes via the share sheet — list the extensions explicitly so
          // every photo on the Camera Roll is selectable.
          accept="image/*,.heic,.heif,.jpg,.jpeg,.png,.webp"
          multiple
          disabled={uploading}
          onChange={handleUploadChange}
          className="sr-only"
          data-testid="mobile-images-upload-input"
        />
      </div>

      {openFolder ? (
        folderLoading ? (
          <div className="flex items-center justify-center pt-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : folderImages.length === 0 ? (
          <div className="px-4 mt-8 text-center">
            <Folder className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">This folder is empty.</p>
            <p className="text-[11px] text-muted-foreground/70 mt-1">
              Open a photo and tap the folder button to add it here, or drag one onto this folder.
            </p>
          </div>
        ) : (
          <div className="px-3 mt-3 grid grid-cols-2 gap-2">
            {folderImages.map((r) => (
              <div key={r.id} className="aspect-square overflow-hidden rounded-xl bg-muted relative">
                <button
                  type="button"
                  onClick={() => setSelected(toStudioImage(r))}
                  className="block w-full h-full active:opacity-80"
                  data-testid={`mobile-folder-image-${r.id}`}
                >
                  <img src={`/api/image-studio/${r.id}/thumb`} alt={r.description || r.file_name} className="w-full h-full object-cover" loading="lazy" />
                </button>
                <button
                  type="button"
                  onClick={() => removeFromFolderMutation.mutate(r.id)}
                  className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/60 text-white inline-flex items-center justify-center active:bg-black/80"
                  aria-label="Remove from folder"
                  data-testid={`mobile-folder-remove-${r.id}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
      <>
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

      {/* Folders — tap to open, or drop a photo on one to file it. */}
      {folders.length > 0 && (
        <div className="px-3 mb-3">
          <h2 className="px-1 mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Folders
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {folders.map((f) => {
              const isDropTarget = dropTarget?.type === "folder" && dropTarget.id === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  data-drop-id={f.id}
                  data-drop-type="folder"
                  onClick={() => setOpenFolderId(f.id)}
                  className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left bg-white dark:bg-card active:bg-muted/40 transition-shadow ${
                    isDropTarget ? "border-primary ring-2 ring-primary shadow-lg" : "border-border/60"
                  }`}
                  data-testid={`mobile-folder-${f.id}`}
                >
                  <div className="w-11 h-11 rounded-lg overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                    {f.cover_thumbnail ? (
                      <img src={f.cover_thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Folder className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{f.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {f.image_count} {f.image_count === 1 ? "photo" : "photos"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center pt-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 mt-8 text-center">
          <ImageIcon className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {search
              ? "No phone photos match that search"
              : folders.length > 0
                ? "All your photos are filed into folders"
                : "No photos uploaded from your phone yet"}
          </p>
          {!search && (
            <p className="text-[11px] text-muted-foreground/70 mt-1">
              {folders.length > 0
                ? "Open a folder above to see them, or tap Add photos for more."
                : "Tap Add photos to take one or pick several — AI edits land here too."}
            </p>
          )}
        </div>
      ) : (
        <div className="px-3 grid grid-cols-2 gap-2">
          {filtered.map((img) => {
            const isDragging = dragId === img.id;
            const isDropTarget = dropTarget?.type === "image" && dropTarget.id === img.id;
            return (
            <button
              key={img.id}
              type="button"
              data-drop-id={img.id}
              data-drop-type="image"
              onClick={() => handleTileClick(img)}
              onPointerDown={(e) => onTilePointerDown(e, img)}
              onPointerMove={onTilePointerMove}
              onPointerUp={onTilePointerUp}
              onPointerCancel={finishDrag}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                touchAction: "pan-y",
                userSelect: "none",
                WebkitUserSelect: "none",
                WebkitTouchCallout: "none",
              } as React.CSSProperties}
              className={`aspect-square overflow-hidden rounded-xl bg-muted active:opacity-80 text-left relative transition-all select-none ${
                isDragging ? "opacity-40 scale-95" : ""
              } ${isDropTarget ? "ring-2 ring-primary shadow-lg scale-[1.02]" : ""}`}
              data-testid={`mobile-image-${img.id}`}
            >
              <img
                src={`/api/image-studio/${img.id}/thumb`}
                alt={img.description || img.fileName}
                className="w-full h-full object-cover pointer-events-none select-none"
                loading="lazy"
                draggable={false}
              />
              {(img.tags || []).includes("ai-pending") ? (
                <>
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center">
                    <div className="flex flex-col items-center gap-1.5">
                      <Loader2 className="w-6 h-6 animate-spin text-white" />
                      <span className="text-[10px] font-semibold text-white">AI editing…</span>
                    </div>
                  </div>
                  <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[9px] font-semibold">
                    <Sparkles className="w-2.5 h-2.5" /> Working
                  </span>
                </>
              ) : (img.tags || []).includes("ai-failed") ? (
                <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[9px] font-semibold">
                  AI failed
                </span>
              ) : img.source === "ai-edited" && (
                <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[9px] font-semibold">
                  <Sparkles className="w-2.5 h-2.5" /> AI
                </span>
              )}
              {isDropTarget && (
                <div className="absolute inset-0 bg-primary/30 backdrop-blur-[1px] flex items-center justify-center">
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold shadow">
                    <FolderPlus className="w-3.5 h-3.5" /> New folder
                  </span>
                </div>
              )}
            </button>
            );
          })}
        </div>
      )}
      </>
      )}

      {dragId && (
        <p className="text-center text-[11px] text-muted-foreground mt-4 px-6">
          Drop on another photo to group them, or onto a folder to file it.
        </p>
      )}

      {/* Floating preview that tracks the finger while dragging. */}
      {ghostPos && dragId && (
        <div
          className="fixed z-[150] w-20 h-20 rounded-xl overflow-hidden shadow-2xl ring-2 ring-primary pointer-events-none -translate-x-1/2 -translate-y-1/2"
          style={{ left: ghostPos.x, top: ghostPos.y }}
        >
          <img src={`/api/image-studio/${dragId}/thumb`} alt="" className="w-full h-full object-cover" />
        </div>
      )}

      <ImageEditSheet image={selected} onClose={() => setSelected(null)} />
      <NameFolderSheet
        open={!!pendingGroup}
        count={pendingGroup?.length || 0}
        busy={createGroupMutation.isPending}
        onCancel={() => setPendingGroup(null)}
        onCreate={(name) => pendingGroup && createGroupMutation.mutate({ name, imageIds: pendingGroup })}
      />
    </div>
  );
}

// Bottom sheet that asks for a folder name when two photos are dropped
// together. Kept dead simple — name in, Create out.
function NameFolderSheet({
  open, count, busy, onCancel, onCreate,
}: {
  open: boolean; count: number; busy: boolean; onCancel: () => void; onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => { if (open) setName(""); }, [open]);
  const submit = () => { const n = name.trim(); if (n) onCreate(n); };
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onCancel()}>
      <SheetContent side="bottom" className="rounded-t-3xl p-0">
        <div className="px-4 pt-4 pb-3 flex items-center gap-2 border-b border-border/40">
          <FolderPlus className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold flex-1">New folder</h2>
          <button type="button" onClick={onCancel} className="p-2 -mr-2 rounded-full active:bg-gray-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Grouping {count} photos. Everyone on the team will see this folder.
          </p>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="Folder name e.g. 'High Street frontages'"
            className="h-12 text-base rounded-xl"
            data-testid="mobile-folder-name-input"
          />
          <Button
            type="button"
            onClick={submit}
            disabled={!name.trim() || busy}
            className="w-full h-12 text-base font-semibold gap-2"
            data-testid="mobile-folder-create"
          >
            {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Creating…</> : <><FolderPlus className="w-5 h-5" /> Create folder</>}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Tap-driven path to grouping (works on every device — no drag needed):
// from an open photo, pick an existing folder or spin up a new one.
function FolderPickerSheet({ open, onClose, imageId }: { open: boolean; onClose: () => void; imageId: string }) {
  const { toast } = useToast();
  const { data: collections = [] } = useQuery<Collection[]>({
    queryKey: ["/api/image-studio/collections"],
    enabled: open,
  });
  const folders = useMemo(() => collections.filter(isUserFolder), [collections]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  useEffect(() => { if (open) { setCreating(false); setNewName(""); } }, [open]);

  const addMutation = useMutation({
    mutationFn: async (folderId: string) => {
      await apiRequest("POST", `/api/image-studio/collections/${folderId}/images`, { imageIds: [imageId] });
      return folderId;
    },
    onSuccess: (folderId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections", folderId] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/filed-image-ids"] });
      toast({ title: "Added to folder" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Couldn't add", description: e?.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const r = await apiRequest("POST", "/api/image-studio/collections", { name });
      const c = (await r.json()) as { id: string };
      await apiRequest("POST", `/api/image-studio/collections/${c.id}/images`, { imageIds: [imageId] });
      return c;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/filed-image-ids"] });
      toast({ title: "Folder created", description: "Everyone on the team can see it." });
      onClose();
    },
    onError: (e: any) => toast({ title: "Couldn't create folder", description: e?.message, variant: "destructive" }),
  });

  const submitNew = () => { const n = newName.trim(); if (n) createMutation.mutate(n); };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="h-[70dvh] p-0 rounded-t-3xl flex flex-col">
        <div className="px-4 pt-4 pb-3 flex items-center gap-2 border-b border-border/40 shrink-0">
          <Folder className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold flex-1">Add to folder</h2>
          <button type="button" onClick={onClose} className="p-2 -mr-2 rounded-full active:bg-gray-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {creating ? (
            <div className="space-y-3 p-1">
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitNew(); }}
                placeholder="Folder name e.g. 'High Street frontages'"
                className="h-12 text-base rounded-xl"
                data-testid="mobile-folder-pick-name"
              />
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="h-12 flex-1" onClick={() => setCreating(false)}>
                  Back
                </Button>
                <Button
                  type="button"
                  className="h-12 flex-1 gap-2 font-semibold"
                  onClick={submitNew}
                  disabled={!newName.trim() || createMutation.isPending}
                  data-testid="mobile-folder-pick-create"
                >
                  {createMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <FolderPlus className="w-5 h-5" />}
                  Create
                </Button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-3 rounded-xl border border-dashed border-primary/50 px-3 py-3 text-left active:bg-muted/40 text-primary"
                data-testid="mobile-folder-pick-new"
              >
                <FolderPlus className="w-5 h-5" />
                <span className="text-sm font-semibold">New folder…</span>
              </button>
              {folders.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center mt-6">No folders yet — make one above.</p>
              ) : (
                folders.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => addMutation.mutate(f.id)}
                    disabled={addMutation.isPending}
                    className="w-full flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5 text-left bg-white dark:bg-card active:bg-muted/40 disabled:opacity-60"
                    data-testid={`mobile-folder-pick-${f.id}`}
                  >
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                      {f.cover_thumbnail ? (
                        <img src={f.cover_thumbnail} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Folder className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{f.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {f.image_count} {f.image_count === 1 ? "photo" : "photos"}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ImageEditSheet({ image, onClose }: { image: StudioImage | null; onClose: () => void }) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [folderPickOpen, setFolderPickOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!image) throw new Error("No image");
      const trimmed = prompt.trim();
      if (!trimmed) throw new Error("Tell the AI what to change");
      // Fire-and-forget — the server runs the edit in the background so
      // we don't lose the result when iOS suspends the app.
      const r = await fetch("/api/image-studio/ai-edit-async", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ imageId: image.id, editPrompt: trimmed }),
      });
      const body = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(body?.error || `AI edit failed (${r.status})`);
      return body as { ok: true; status: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      toast({
        title: "AI is editing in the background",
        description: "You can close this and check back — it'll appear in the gallery when done.",
      });
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

  // Soft-delete with an Undo action on the toast. Trashed images are
  // hidden from the gallery but keep their bytes in case the user taps
  // Undo within the toast window (5s by default).
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!image) throw new Error("No image");
      const r = await fetch(`/api/image-studio/${image.id}/trash`, { method: "POST", credentials: "include" });
      const body = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(body?.error || `Delete failed (${r.status})`);
      return body;
    },
    onSuccess: () => {
      const deletedId = image?.id;
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
      onClose();
      toast({
        title: "Photo deleted",
        description: "Tap Undo to bring it back.",
        action: deletedId ? (
          <ToastAction
            altText="Undo delete"
            onClick={async () => {
              try {
                await fetch(`/api/image-studio/${deletedId}/restore`, { method: "POST", credentials: "include" });
                queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
                toast({ title: "Restored" });
              } catch (e: any) {
                toast({ title: "Couldn't restore", description: e?.message, variant: "destructive" });
              }
            }}
          >
            Undo
          </ToastAction>
        ) : undefined,
      });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't delete", description: e?.message, variant: "destructive" });
    },
  });

  const askDelete = () => {
    if (!image) return;
    if (!window.confirm("Delete this photo? You'll have a few seconds to undo.")) return;
    deleteMutation.mutate();
  };

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
              <button
                type="button"
                onClick={() => setZoomOpen(true)}
                className="block w-full bg-muted relative active:opacity-90"
                aria-label="Zoom in"
                data-testid="mobile-image-zoom-trigger"
              >
                <img
                  src={previewSrc}
                  alt={image.description || image.fileName}
                  className="w-full max-h-[55dvh] object-contain"
                />
                <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-black/60 text-white text-[10px] font-semibold backdrop-blur-sm">
                  <ZoomIn className="w-3 h-3" /> Tap to zoom
                </span>
              </button>

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
              <Button
                type="button"
                variant="outline"
                onClick={() => setFolderPickOpen(true)}
                className="h-12"
                aria-label="Add to a folder"
                data-testid="mobile-image-folder"
              >
                <FolderPlus className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAttachOpen(true)}
                className="h-12"
                aria-label="Attach to property, brand or pathway"
                data-testid="mobile-image-attach"
              >
                <Link2 className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={askDelete}
                disabled={deleteMutation.isPending}
                className="h-12 text-red-600 hover:text-red-700"
                aria-label="Delete photo"
                data-testid="mobile-image-delete"
              >
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
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
            <AttachPickerSheet
              open={attachOpen}
              onClose={() => setAttachOpen(false)}
              imageId={image.id}
            />
            <FolderPickerSheet
              open={folderPickOpen}
              onClose={() => setFolderPickOpen(false)}
              imageId={image.id}
            />
            <ImageZoomLightbox
              open={zoomOpen}
              onClose={() => setZoomOpen(false)}
              src={previewSrc}
              alt={image.description || image.fileName}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

interface AttachTarget {
  id: string;
  label: string;
  sublabel?: string | null;
}

function AttachPickerSheet({ open, onClose, imageId }: { open: boolean; onClose: () => void; imageId: string }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"property" | "brand" | "pathway">("property");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Reset state on each open so the previous picker doesn't leak.
  useMemo(() => { if (open) { setSearch(""); setTab("property"); } }, [open]);

  const { data: properties = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/properties"],
    enabled: open,
  });
  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ["/api/crm/companies"],
    enabled: open,
  });
  const { data: pathways = [] } = useQuery<any[]>({
    queryKey: ["/api/property-pathway"],
    enabled: open,
  });

  const targets: AttachTarget[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filter = (rows: AttachTarget[]) =>
      q ? rows.filter((r) => r.label.toLowerCase().includes(q) || (r.sublabel || "").toLowerCase().includes(q)) : rows;
    if (tab === "property") {
      return filter(properties.map((p: any) => ({ id: p.id, label: p.name || p.address || "Unnamed property", sublabel: p.postcode || p.area || null })));
    }
    if (tab === "brand") {
      return filter(companies.map((c: any) => ({ id: c.id, label: c.name || "Unnamed company", sublabel: c.companyType || c.website || null })));
    }
    return filter((pathways as any[]).map((p: any) => ({ id: p.id, label: p.address || "Unnamed pathway", sublabel: p.currentStage ? `Stage ${p.currentStage}` : null })));
  }, [tab, search, properties, companies, pathways]);

  const attachMutation = useMutation({
    mutationFn: async (args: { targetType: string; targetId: string }) => {
      const r = await fetch(`/api/image-studio/${imageId}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(args),
      });
      const body = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(body?.error || `Attach failed (${r.status})`);
      return body;
    },
    onSuccess: (body, vars) => {
      const label = targets.find((t) => t.id === vars.targetId)?.label || "target";
      toast({ title: `Attached to ${label}`, description: body.where === "pathway" ? "Filed under the pathway's property" : undefined });
      setBusyId(null);
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Couldn't attach", description: e?.message, variant: "destructive" });
      setBusyId(null);
    },
  });

  const pick = (t: AttachTarget) => {
    setBusyId(t.id);
    attachMutation.mutate({ targetType: tab, targetId: t.id });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="h-[85dvh] p-0 rounded-t-3xl flex flex-col">
        <div className="px-4 pt-4 pb-3 flex items-center gap-2 border-b border-border/40 shrink-0">
          <h2 className="text-base font-semibold flex-1">Attach to…</h2>
          <button type="button" onClick={onClose} className="p-2 -mr-2 rounded-full active:bg-gray-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 pt-3 flex gap-2 shrink-0">
          {[
            { id: "property", label: "Property", icon: Building2 },
            { id: "brand", label: "Brand", icon: Tag },
            { id: "pathway", label: "Pathway", icon: Briefcase },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id as any)}
              className={`flex-1 h-10 rounded-full inline-flex items-center justify-center gap-1.5 text-sm font-medium ${
                tab === id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
              data-testid={`mobile-image-attach-tab-${id}`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="px-4 mt-3 mb-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${tab === "property" ? "properties" : tab === "brand" ? "brands" : "pathways"}…`}
              className="h-11 pl-9 text-sm rounded-xl"
              data-testid="mobile-image-attach-search"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {targets.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center mt-6">No matches</p>
          ) : (
            <div className="space-y-1.5">
              {targets.slice(0, 100).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pick(t)}
                  disabled={busyId === t.id}
                  className="w-full text-left rounded-xl bg-white dark:bg-card border border-border/60 px-3 py-2.5 active:bg-muted/40 flex items-center gap-3 disabled:opacity-60"
                  data-testid={`mobile-image-attach-pick-${t.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t.label}</div>
                    {t.sublabel && <div className="text-[11px] text-muted-foreground truncate">{t.sublabel}</div>}
                  </div>
                  {busyId === t.id && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Fullscreen image viewer with one-finger drag-to-pan when zoomed,
// double-tap to toggle 2.25× ↔ 1×, and +/− buttons. Pinch is a future
// add — current iOS Safari fights with manual pan so we run a single
// gesture model.
function ImageZoomLightbox({ open, onClose, src, alt }: { open: boolean; onClose: () => void; src: string; alt: string }) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const lastTapRef = useRef(0);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; pointerId: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (open) { setScale(1); setPan({ x: 0, y: 0 }); }
  }, [open]);

  // Lock body scroll while open so background doesn't bounce on iOS.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Clamp pan so the image edges can't fly past the viewport centre —
  // gives a natural "spring stop" feel without rubber-banding.
  const clampPan = (x: number, y: number, s: number) => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img || s <= 1) return { x: 0, y: 0 };
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const iw = img.clientWidth * s;
    const ih = img.clientHeight * s;
    const maxX = Math.max(0, (iw - cw) / 2);
    const maxY = Math.max(0, (ih - ch) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  };

  const onDoubleTapToggle = () => {
    setScale((s) => {
      const next = s > 1 ? 1 : 2.25;
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleTap = (ev: React.MouseEvent | React.TouchEvent) => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      ev.preventDefault();
      onDoubleTapToggle();
    }
    lastTapRef.current = now;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (scale <= 1) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y, pointerId: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const nx = d.baseX + (e.clientX - d.startX);
    const ny = d.baseY + (e.clientY - d.startY);
    setPan(clampPan(nx, ny, scale));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  };

  const zoomIn = () => setScale((s) => {
    const next = Math.min(4, +(s + 0.5).toFixed(2));
    setPan((p) => clampPan(p.x, p.y, next));
    return next;
  });
  const zoomOut = () => setScale((s) => {
    const next = Math.max(1, +(s - 0.5).toFixed(2));
    if (next === 1) setPan({ x: 0, y: 0 });
    else setPan((p) => clampPan(p.x, p.y, next));
    return next;
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-black flex flex-col"
      data-testid="mobile-image-lightbox"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center justify-between px-3 py-2 shrink-0">
        <span className="text-white/80 text-xs truncate max-w-[55%]">{alt}</span>
        <div className="flex items-center gap-1">
          <span className="text-white/60 text-[11px] mr-1 tabular-nums w-10 text-right">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={zoomOut} className="w-10 h-10 rounded-full bg-white/10 text-white text-lg active:bg-white/20" aria-label="Zoom out">−</button>
          <button type="button" onClick={zoomIn} className="w-10 h-10 rounded-full bg-white/10 text-white text-lg active:bg-white/20" aria-label="Zoom in">+</button>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-white/10 text-white inline-flex items-center justify-center active:bg-white/20 ml-1"
            aria-label="Close"
            data-testid="mobile-image-lightbox-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden flex items-center justify-center select-none"
        style={{ touchAction: "none", cursor: scale > 1 ? "grab" : "auto" }}
        onClick={handleTap}
        onTouchEnd={handleTap}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          className="origin-center transition-transform duration-100 max-w-full max-h-full"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
            willChange: "transform",
            pointerEvents: "none",
          }}
          draggable={false}
        />
      </div>
      <div className="text-center text-white/50 text-[11px] pb-2">
        {scale > 1 ? "Drag to pan · double-tap to reset" : "Double-tap or + to zoom"}
      </div>
    </div>
  );
}
