import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, X as XIcon } from "lucide-react";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { isCompanyImageLogo } from "@shared/brand-image-selection";

// ─────────────────────────────────────────────────────────────────────────
// Landlord account gallery (Delivery 4, Task 2).
//
// One media view over the whole account — company assets AND photos attached
// only to the account's properties — grouped as:
//   BGP-approved — staff-pinned saved choices ('brand-hero' tag). This is the
//     only human marketing-reuse signal; auto-imported public images never
//     appear here by themselves.
//   Corporate    — everything else linked to the account's entities.
//   Properties   — photos linked by property_id, filterable by property.
//
// Rendered as Image Studio-style folders (Woody, 2026-09-28: "use the image
// studio approach of being able to make image folders for properties" +
// "logo and corporate stuff"): a tile per folder, drill in for the photos,
// and hand-made Image Studio collections show as sub-folders inside.
// ─────────────────────────────────────────────────────────────────────────

export interface AccountMediaRow {
  id: string;
  file_name: string | null;
  thumbnail_data: string | null;
  mime_type: string | null;
  tags: string[];
  category: string | null;
  source: string | null;
  description: string | null;
  width: number | null;
  height: number | null;
  created_at: string | null;
  company_id: string | null;
  property_id: string | null;
  property_name: string | null;
  group: "corporate" | "properties" | "approved";
  marketing_cleared: boolean;
  folders?: Array<{ id: string; name: string }>;
}

interface AccountMediaResponse {
  groups: Record<"corporate" | "properties" | "approved", AccountMediaRow[]>;
  properties: Array<{ propertyId: string; name: string }>;
  total: number;
}

// The same logo uploaded twice showed twice (British Land) — one tile per
// identical thumbnail or same file name + size (Woody, 2026-09-28).
function uniqueMedia(images: AccountMediaRow[]): AccountMediaRow[] {
  const seen = new Set<string>();
  return images.filter(img => {
    const keys = [img.thumbnail_data ? `t:${img.thumbnail_data.length}:${img.thumbnail_data.slice(-64)}` : "", img.file_name ? `f:${img.file_name.toLowerCase().replace(/\s*(?:\(\d+\)|copy|-\d+x\d+)(?=\.\w+$)/g, "")}:${img.width}x${img.height}` : ""].filter(Boolean);
    if (keys.some(k => seen.has(k))) return false;
    keys.forEach(k => seen.add(k));
    return true;
  });
}

export function accountMediaThumbSrc(img: Pick<AccountMediaRow, "id" | "thumbnail_data" | "mime_type">): string {
  return img.thumbnail_data
    ? (img.thumbnail_data.startsWith("data:")
        ? img.thumbnail_data
        : `data:${img.mime_type || "image/jpeg"};base64,${img.thumbnail_data}`)
    : `/api/brand/gallery-image/${img.id}`;
}

// Logos get their own folder so they aren't lost among 100 building shots
// (Woody, 2026-09-28) — the shared logo rule plus SVGs, wordmark/brand tags
// and small or very wide PNGs (transparent logo exports).
function isLogoImage(img: AccountMediaRow): boolean {
  if (isCompanyImageLogo(img)) return true;
  if (img.tags.some(t => /^(?:brand|logo|wordmark|image-kind:icon)$|wordmark/i.test(t))) return true;
  if (/^logos?$/i.test(img.category || "")) return true;
  if (/svg/i.test(img.mime_type || "") || /\.svg$/i.test(img.file_name || "")) return true;
  const w = Number(img.width) || 0, h = Number(img.height) || 0;
  const png = /png/i.test(img.mime_type || "") || /\.png$/i.test(img.file_name || "");
  return png && w > 0 && h > 0 && (Math.max(w, h) <= 512 || w / h >= 3);
}

interface MediaFolder {
  key: string;
  label: string;
  images: AccountMediaRow[];
  cover: AccountMediaRow;
  logos?: boolean;
}

interface SubFolder {
  id: string;
  name: string;
  label: string;
  images: AccountMediaRow[];
}

const PAGE = 24;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);

// Approved first (the staff signal), then logos, corporate, and one folder
// per property with the most photos first — the Image Studio album order.
// Empty folders are simply not built.
function buildFolders(data: AccountMediaResponse): MediaFolder[] {
  const all = uniqueMedia([...data.groups.approved, ...data.groups.properties, ...data.groups.corporate]);
  const logos: AccountMediaRow[] = [];
  const corporate: AccountMediaRow[] = [];
  const byProperty = new Map<string, { label: string; images: AccountMediaRow[] }>();
  for (const img of all) {
    if (img.property_id) {
      const entry = byProperty.get(img.property_id);
      if (entry) entry.images.push(img);
      else byProperty.set(img.property_id, { label: img.property_name || "Linked property", images: [img] });
    } else if (isLogoImage(img)) logos.push(img);
    else corporate.push(img);
  }
  const coverOf = (images: AccountMediaRow[]) =>
    images.find(i => i.group === "approved") ?? images.find(i => !isLogoImage(i)) ?? images[0];
  const folders: MediaFolder[] = [];
  const approved = all.filter(i => i.group === "approved");
  if (approved.length) folders.push({ key: "approved", label: "BGP-approved", images: approved, cover: approved[0] });
  if (logos.length) folders.push({ key: "logos", label: "Logos & brand", images: logos, cover: logos[0], logos: true });
  if (corporate.length) folders.push({ key: "corporate", label: "Corporate", images: corporate, cover: coverOf(corporate) });
  [...byProperty.entries()]
    .sort((a, b) => b[1].images.length - a[1].images.length || a[1].label.localeCompare(b[1].label))
    .forEach(([id, p]) => folders.push({ key: `pid:${id}`, label: p.label, images: p.images, cover: coverOf(p.images) }));
  return folders;
}

// Sub-folders are the hand-made Image Studio collections the folder's photos
// sit in. New ones are named "<Folder> · <Name>" so they read clearly in
// Image Studio's folder list too; the prefix is dropped here.
function subFoldersOf(folder: MediaFolder): SubFolder[] {
  const m = new Map<string, SubFolder>();
  const prefix = `${folder.label} · `;
  for (const img of folder.images) {
    for (const f of img.folders || []) {
      const entry = m.get(f.id);
      if (entry) entry.images.push(img);
      else m.set(f.id, { id: f.id, name: f.name, label: f.name.startsWith(prefix) ? f.name.slice(prefix.length) : f.name, images: [img] });
    }
  }
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function FolderTile({ label, count, cover, logo, onOpen, testId }: {
  label: string;
  count: number;
  cover: AccountMediaRow;
  logo?: boolean;
  onOpen: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-muted text-left"
      data-testid={testId}
    >
      <img
        src={accountMediaThumbSrc(cover)}
        alt=""
        className={`absolute inset-0 w-full h-full transition-transform group-hover:scale-105 ${logo ? "object-contain p-4 bg-card" : "object-cover"}`}
        loading="lazy"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-2 pt-8">
        <p className="text-white text-xs font-semibold leading-tight line-clamp-2">{label}</p>
        <p className="text-white/70 text-[10px]"><span className="font-mono tabular-nums">{count}</span> image{count === 1 ? "" : "s"}</p>
      </div>
    </button>
  );
}

function MediaGrid({
  images,
  canEdit,
  logos,
  showProperty,
  selecting,
  selected,
  onToggle,
  onOpen,
  onDelete,
  testPrefix,
}: {
  images: AccountMediaRow[];
  canEdit: boolean;
  logos?: boolean;
  showProperty?: boolean;
  selecting: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (img: AccountMediaRow) => void;
  onDelete: (id: string) => void;
  testPrefix: string;
}) {
  const [shown, setShown] = useState(PAGE);
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {images.slice(0, shown).map(img => {
          const isHero = img.group === "approved";
          const isSelected = selected.has(img.id);
          const activate = () => (selecting ? onToggle(img.id) : onOpen(img));
          return (
            <div
              key={img.id}
              className={`relative aspect-square rounded border overflow-hidden bg-muted group ${selecting ? "cursor-pointer" : "cursor-zoom-in"} ${isSelected || isHero ? "border-primary ring-1 ring-primary" : "border-border"}`}
              role="button"
              tabIndex={0}
              aria-pressed={selecting ? isSelected : undefined}
              aria-label={`${selecting ? (isSelected ? "Deselect" : "Select") : "Open"} ${img.file_name || "saved image"}${isHero ? ", saved choice" : ""}`}
              onClick={activate}
              onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); activate(); } }}
              data-testid={`${testPrefix}-image-${img.id}`}
            >
              <img
                src={accountMediaThumbSrc(img)}
                alt={img.file_name || "saved image"}
                className={`w-full h-full transition-transform group-hover:scale-105 ${logos || isLogoImage(img) ? "object-contain p-2 bg-card" : "object-cover"}`}
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              {isHero && <div className="absolute top-1 left-1"><Pill active>Saved choice</Pill></div>}
              {showProperty && img.property_name && (
                <div className="absolute bottom-0 inset-x-0 bg-background/80 px-1 py-0.5 text-[10px] truncate">{img.property_name}</div>
              )}
              {selecting ? (
                <div className={`absolute top-1 right-1 h-6 w-6 rounded-full border flex items-center justify-center ${isSelected ? "bg-primary border-primary text-primary-foreground" : "bg-background/90 border-border text-transparent"}`}>
                  <Check className="w-3.5 h-3.5" />
                </div>
              ) : canEdit && (
                <button
                  type="button"
                  className="absolute top-1 right-1 h-6 w-6 rounded-full bg-background text-muted-foreground hover:bg-destructive hover:text-destructive-foreground opacity-100 sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex items-center justify-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Remove this image?")) onDelete(img.id);
                  }}
                  title="Remove image"
                  data-testid={`${testPrefix}-image-delete-${img.id}`}
                >
                  <XIcon className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {images.length > shown && (
        <div className="flex justify-center pt-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setShown(n => n + PAGE)} data-testid={`${testPrefix}-show-more`}>
            Show more · <span className="font-mono tabular-nums">{images.length - shown}</span> left
          </Button>
        </div>
      )}
    </div>
  );
}

export function LandlordAccountGallery({
  companyId,
  canEdit,
  onOpen,
  onDelete,
}: {
  companyId: string;
  canEdit: boolean;
  onOpen: (img: any) => void;
  onDelete: (imageId: string) => void;
}) {
  const { toast } = useToast();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [openSubId, setOpenSubId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const { data } = useQuery<AccountMediaResponse>({
    queryKey: ["/api/accounts", companyId, "media"],
    queryFn: async () => {
      const r = await fetch(`/api/accounts/${companyId}/media`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const folders = data ? buildFolders(data) : [];
  const folder = folders.find(f => f.key === openKey) ?? null;
  const subFolders = folder ? subFoldersOf(folder) : [];
  const sub = subFolders.find(s => s.id === openSubId) ?? null;
  // BGP-approved is a signal, not a place — photos are filed from their
  // home folder instead.
  const canFile = canEdit && !!folder && folder.key !== "approved";

  const go = (key: string | null, subId: string | null = null) => {
    setOpenKey(key);
    setOpenSubId(subId);
    setSelecting(false);
    setSelected(new Set());
  };
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Same collections endpoints Image Studio's "Add to folder" uses. A move
  // also drops the photos from this folder's other sub-folders; a null
  // target means "Not in a folder".
  const move = useMutation({
    mutationFn: async ({ target, name }: { target: string | null; name?: string }) => {
      if (!folder) return;
      let targetId = target;
      if (!targetId && name) {
        const existing = subFolders.find(s => s.label.toLowerCase() === name.toLowerCase());
        if (existing) targetId = existing.id;
        else {
          const r = await apiRequest("POST", "/api/image-studio/collections", { name: `${folder.label} · ${name}` });
          targetId = (await r.json()).id;
        }
      }
      const ids = [...selected];
      if (targetId) await apiRequest("POST", `/api/image-studio/collections/${targetId}/images`, { imageIds: ids });
      const subIds = new Set(subFolders.map(s => s.id));
      for (const img of folder.images) {
        if (!selected.has(img.id)) continue;
        for (const f of img.folders || []) {
          if (subIds.has(f.id) && f.id !== targetId) await apiRequest("DELETE", `/api/image-studio/collections/${f.id}/images/${img.id}`);
        }
      }
    },
    onSuccess: () => {
      toast({ title: `Moved ${selected.size} image${selected.size === 1 ? "" : "s"}` });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts", companyId, "media"] });
      queryClient.invalidateQueries({ queryKey: ["/api/image-studio/collections"] });
      setMoveOpen(false);
      setNewFolderName("");
      setSelecting(false);
      setSelected(new Set());
    },
    onError: (e: any) => toast({ title: "Move failed", description: e?.message, variant: "destructive" }),
  });

  if (!data || data.total === 0) {
    return data ? <div className="text-[11px] text-muted-foreground">No saved images yet.</div> : null;
  }

  if (!folder) {
    const shown = uniqueMedia([...data.groups.approved, ...data.groups.properties, ...data.groups.corporate]).length;
    return (
      <div className="space-y-2" data-testid="account-media-gallery">
        <div className="text-[11px] text-muted-foreground">
          <span className="font-mono tabular-nums">{shown}</span> saved image{shown === 1 ? "" : "s"} · <span className="font-mono tabular-nums">{folders.length}</span> folder{folders.length === 1 ? "" : "s"}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {folders.map(f => (
            <FolderTile key={f.key} label={f.label} count={f.images.length} cover={f.cover} logo={f.logos} onOpen={() => go(f.key)} testId={`account-media-folder-${slug(f.key.startsWith("pid:") ? f.label : f.key)}`} />
          ))}
        </div>
      </div>
    );
  }

  const inSub = new Set(subFolders.flatMap(s => s.images.map(i => i.id)));
  const loose = sub ? sub.images : folder.images.filter(i => !inSub.has(i.id));
  const selectedInSub = folder.images.some(i => selected.has(i.id) && inSub.has(i.id));
  const testPrefix = `account-media-${slug(sub ? `${folder.label}-${sub.label}` : folder.label)}`;

  return (
    <div className="space-y-2" data-testid="account-media-gallery">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 text-xs min-w-0">
          <button type="button" onClick={() => go(null)} className="font-medium text-primary hover:underline" data-testid="account-media-back">
            ← All folders
          </button>
          <span className="text-muted-foreground">/</span>
          {sub ? (
            <>
              <button type="button" onClick={() => go(folder.key)} className="font-medium text-primary hover:underline truncate">{folder.label}</button>
              <span className="text-muted-foreground">/</span>
              <span className="font-medium truncate">{sub.label}</span>
            </>
          ) : (
            <span className="font-medium truncate">{folder.label}</span>
          )}
          <span className="text-[11px] text-muted-foreground">· <span className="font-mono tabular-nums">{(sub ? sub.images : folder.images).length}</span> images</span>
        </div>
        {canFile && (
          <div className="flex items-center gap-1.5">
            {selecting && (
              <Button type="button" size="sm" variant="outline" disabled={selected.size === 0} onClick={() => setMoveOpen(true)} data-testid="account-media-move">
                Move <span className="font-mono tabular-nums">{selected.size}</span> to folder
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => { setSelecting(v => !v); setSelected(new Set()); }} data-testid="account-media-select">
              {selecting ? "Cancel" : "Select"}
            </Button>
          </div>
        )}
      </div>
      {!sub && subFolders.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {subFolders.map(s => (
            <FolderTile key={s.id} label={s.label} count={s.images.length} cover={s.images[0]} logo={folder.logos} onOpen={() => go(folder.key, s.id)} testId={`account-media-subfolder-${slug(s.label)}`} />
          ))}
        </div>
      )}
      {!sub && subFolders.length > 0 && loose.length > 0 && (
        <div className="text-[11px] text-muted-foreground pt-1">Not in a folder · <span className="font-mono tabular-nums">{loose.length}</span></div>
      )}
      {loose.length > 0 && (
        <MediaGrid
          key={`${folder.key}:${sub?.id || ""}`}
          images={loose}
          canEdit={canEdit}
          logos={folder.logos}
          showProperty={folder.key === "approved"}
          selecting={selecting}
          selected={selected}
          onToggle={toggle}
          onOpen={onOpen}
          onDelete={onDelete}
          testPrefix={testPrefix}
        />
      )}

      <Dialog open={moveOpen} onOpenChange={v => { if (!move.isPending) setMoveOpen(v); }}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="text-sm font-medium">
            Move <span className="font-mono tabular-nums">{selected.size}</span> image{selected.size === 1 ? "" : "s"} to a folder
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Folders inside {folder.label}. They also appear in Image Studio.
          </DialogDescription>
          <div className="space-y-1">
            {subFolders.map(s => (
              <button
                key={s.id}
                type="button"
                disabled={move.isPending}
                onClick={() => move.mutate({ target: s.id })}
                className="w-full flex items-center justify-between rounded border border-border px-3 py-2 text-sm text-left hover:bg-muted disabled:opacity-50"
                data-testid={`account-media-move-to-${slug(s.label)}`}
              >
                <span className="truncate">{s.label}</span>
                <span className="text-[11px] text-muted-foreground font-mono tabular-nums">{s.images.length}</span>
              </button>
            ))}
            {selectedInSub && (
              <button
                type="button"
                disabled={move.isPending}
                onClick={() => move.mutate({ target: null })}
                className="w-full rounded border border-border px-3 py-2 text-sm text-left text-muted-foreground hover:bg-muted disabled:opacity-50"
                data-testid="account-media-move-to-none"
              >
                Not in a folder
              </button>
            )}
          </div>
          <form
            className="space-y-1.5"
            onSubmit={e => { e.preventDefault(); if (newFolderName.trim()) move.mutate({ target: null, name: newFolderName.trim() }); }}
          >
            <label htmlFor="account-media-new-folder" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">New folder</label>
            <div className="flex gap-2">
              <Input
                id="account-media-new-folder"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                placeholder="e.g. Interior, Exterior, Marketing"
                data-testid="account-media-new-folder"
              />
              <Button type="submit" size="sm" disabled={!newFolderName.trim() || move.isPending} data-testid="account-media-create-folder">
                Add folder
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
