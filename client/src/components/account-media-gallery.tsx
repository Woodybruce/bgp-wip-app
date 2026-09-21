import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X as XIcon } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { Pill } from "@/components/ui/pill";

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
}

interface AccountMediaResponse {
  groups: Record<"corporate" | "properties" | "approved", AccountMediaRow[]>;
  properties: Array<{ propertyId: string; name: string }>;
  total: number;
}

export function accountMediaThumbSrc(img: Pick<AccountMediaRow, "id" | "thumbnail_data" | "mime_type">): string {
  return img.thumbnail_data
    ? (img.thumbnail_data.startsWith("data:")
        ? img.thumbnail_data
        : `data:${img.mime_type || "image/jpeg"};base64,${img.thumbnail_data}`)
    : `/api/brand/gallery-image/${img.id}`;
}

function MediaSection({
  title,
  images,
  canEdit,
  onOpen,
  onDelete,
  testPrefix,
}: {
  title: string;
  images: AccountMediaRow[];
  canEdit: boolean;
  onOpen: (img: AccountMediaRow) => void;
  onDelete: (id: string) => void;
  testPrefix: string;
}) {
  if (images.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] text-muted-foreground mb-1.5">
        {title} <span className="font-mono tabular-nums">({images.length})</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[420px] overflow-y-auto pr-1">
        {images.map(img => {
          const isHero = img.group === "approved";
          return (
            <div
              key={img.id}
              className={`relative aspect-square rounded border overflow-hidden bg-muted cursor-zoom-in group ${isHero ? "border-primary ring-1 ring-primary" : "border-border"}`}
              role="button"
              tabIndex={0}
              aria-label={`Open ${img.file_name || "saved image"}${isHero ? ", saved choice" : ""}`}
              onClick={() => onOpen(img)}
              onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(img); } }}
              data-testid={`${testPrefix}-image-${img.id}`}
            >
              <img
                src={accountMediaThumbSrc(img)}
                alt={img.file_name || "saved image"}
                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              {isHero && <div className="absolute top-1 left-1"><Pill active>Saved choice</Pill></div>}
              {img.group === "properties" && img.property_name && (
                <div className="absolute bottom-0 inset-x-0 bg-background/80 px-1 py-0.5 text-[10px] truncate">{img.property_name}</div>
              )}
              {canEdit && (
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
  const [propertyId, setPropertyId] = useState<string>("");
  const query = new URLSearchParams();
  if (propertyId) query.set("propertyId", propertyId);
  const url = `/api/accounts/${companyId}/media${query.size ? `?${query.toString()}` : ""}`;
  const { data } = useQuery<AccountMediaResponse>({
    queryKey: ["/api/accounts", companyId, "media", propertyId],
    queryFn: async () => {
      const r = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  if (!data || data.total === 0) {
    return data ? <div className="text-[11px] text-muted-foreground">No saved images yet.</div> : null;
  }

  return (
    <div className="space-y-3" data-testid="account-media-gallery">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          <span className="font-mono tabular-nums">{data.total}</span> saved image{data.total === 1 ? "" : "s"}
        </div>
        {data.properties.length > 0 && (
          <select
            value={propertyId}
            onChange={e => setPropertyId(e.target.value)}
            className="text-[11px] border border-border rounded bg-background px-1.5 py-0.5"
            data-testid="account-media-property-filter"
            aria-label="Filter by property"
          >
            <option value="">All properties</option>
            {data.properties.map(p => (
              <option key={p.propertyId} value={p.propertyId}>{p.name}</option>
            ))}
          </select>
        )}
      </div>
      <MediaSection title="BGP-approved" images={data.groups.approved} canEdit={canEdit} onOpen={onOpen} onDelete={onDelete} testPrefix="account-media-approved" />
      <MediaSection title="Corporate" images={data.groups.corporate} canEdit={canEdit} onOpen={onOpen} onDelete={onDelete} testPrefix="account-media-corporate" />
      <MediaSection title="Properties" images={data.groups.properties} canEdit={canEdit} onOpen={onOpen} onDelete={onDelete} testPrefix="account-media-properties" />
    </div>
  );
}
