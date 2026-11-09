import { useState } from "react";
import { Image as ImageIcon, Star } from "lucide-react";
import { selectCompanyHeroImage, rankCompanyHeroImages, companyImageHeroIssue } from "@shared/brand-image-selection";
import { BrandImageRefreshButton } from "@/components/brand-profile-overview";
import { Button } from "@/components/ui/button";

// One tile per picture: the same row id or the exact source URL (query
// kept). Name + size matching merged distinct photos, so Gail's strip showed
// 3 while the gallery counted "2 shown above" (Woody, 2026-09-28).
export function dedupeGalleryImages<T extends { id?: any; source?: string | null }>(images: T[]): T[] {
  const seen = new Set<string>();
  return images.filter(img => {
    const src = /^https?:\/\//i.test(String(img.source || "")) ? `u:${String(img.source).trim()}` : null;
    const keys = [img.id != null ? `i:${img.id}` : null, src].filter(Boolean) as string[];
    if (keys.some(k => seen.has(k))) return false;
    keys.forEach(k => seen.add(k));
    return true;
  });
}
// What the header strip shows (before any load failures): the cover + up to
// three more. The gallery's "shown above" count reads this same list.
export const companyStripImages = <T extends { id?: any; source?: string | null }>(images: T[] | null | undefined, companyType?: string | null): T[] =>
  rankCompanyHeroImages(dedupeGalleryImages(images || []), companyType).slice(0, 4);

// `images` arrive deduped (dedupeGalleryImages) from both callers, so the
// strip ranks the same list the gallery counts.
export function CompanyProfileImage({ companyId, companyName, companyType, images, canRefresh = false }: {
  companyId: string;
  companyName: string;
  companyType?: string | null;
  images: any[];
  canRefresh?: boolean;
}) {
  const candidates = rankCompanyHeroImages(images, companyType);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const hero = candidates.find(image => !failedImages.includes(`${companyId}:${image.id}`));
  const imageKey = hero ? `${companyId}:${hero.id}` : null;
  // No cover photo → nothing here; the gallery below keeps Refresh images
  // (the empty box was noise on every brand without photos — 2026-09-23).
  if (!hero && !candidates.length) return null;
  if (!hero) {
    return <div className="rounded-lg border border-dashed border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3" data-testid="brand-overview-image-empty">
      <p className="text-sm text-muted-foreground flex items-center gap-2"><ImageIcon className="w-4 h-4 shrink-0" />{candidates.length ? "The saved cover photos could not be loaded." : "No suitable cover photo yet."}</p>
      {canRefresh && <BrandImageRefreshButton companyId={companyId} />}
    </div>;
  }
  const markFailed = (key: string) => setFailedImages(previous => previous.includes(key) ? previous : [...previous.filter(k => k.startsWith(`${companyId}:`)), key]);
  // The cover plus up to three more reviewed photos beside it (Woody,
  // 2026-09-24: "still only one image").
  const extras = candidates.filter(image => image.id !== hero.id && !failedImages.includes(`${companyId}:${image.id}`)).slice(0, 3);
  // Desktop: 4×2 grid, cover takes the left half; the others fill the right
  // half (one → whole half, two → a row each, three → one wide + two squares).
  const tileCls = (index: number, extraCount: number) => {
    if (index === 0 || extraCount === 1) return "col-span-2 sm:row-span-2 aspect-[2/1] sm:aspect-auto";
    if (extraCount === 2 || index === 1) return "col-span-2 aspect-[2/1] sm:aspect-auto";
    return "aspect-square sm:aspect-auto";
  };
  if (!extras.length) {
    return <div key={imageKey} className="rounded-xl overflow-hidden border border-card-border shadow-sm bg-muted" data-testid="brand-overview-image">
      <img
        src={`/api/brand/gallery-image/${encodeURIComponent(hero.id)}?full=1`}
        alt={`${companyName} cover photo`}
        className="block w-full h-auto max-h-72 sm:max-h-80 object-contain"
        decoding="async"
        onError={() => imageKey && markFailed(imageKey)}
      />
    </div>;
  }
  return <div key={imageKey} className="grid grid-cols-2 sm:grid-cols-4 sm:grid-rows-2 gap-1 rounded-xl overflow-hidden border border-card-border shadow-sm bg-muted h-auto sm:h-80" data-testid="brand-overview-image">
    {[hero, ...extras].map((image, index) => (
      <img
        key={image.id}
        src={`/api/brand/gallery-image/${encodeURIComponent(image.id)}?full=1`}
        alt={index === 0 ? `${companyName} cover photo` : `${companyName} photo`}
        // Phones: the cover alone — four photos filled the whole first
        // screen before the name (Woody, 2026-09-27).
        className={`block w-full h-full min-h-0 object-cover ${tileCls(index, extras.length)}${index > 0 ? " hidden sm:block" : ""}`}
        loading={index === 0 ? "eager" : "lazy"}
        decoding="async"
        onError={() => markFailed(`${companyId}:${image.id}`)}
      />
    ))}
  </div>;
}

export function CompanyImageCoverChoice({ image, images, companyType, pending, onToggle }: {
  image: any;
  images: any[];
  companyType?: string | null;
  pending: boolean;
  onToggle: (isPinned: boolean) => void;
}) {
  const isPinned = Array.isArray(image.tags) && image.tags.includes("brand-hero");
  const issue = companyImageHeroIssue(image);
  const otherPinned = images.some(candidate => candidate.id !== image.id && Array.isArray(candidate.tags) && candidate.tags.includes("brand-hero") && !companyImageHeroIssue(candidate));
  const selected = selectCompanyHeroImage(images, companyType);
  const explanation = issue || (isPinned
    ? selected?.id === image.id ? "This is the cover photo." : "This saved choice is behind another pinned photo. Unpin that photo to use this one."
    : otherPinned ? "One cover photo is shown. Unpin the current choice before choosing another." : "Use this photo above the company profile on desktop and phone.");
  return <div className="space-y-2" data-testid="company-cover-choice">
    <Button
      variant={isPinned ? "default" : "outline"}
      size="sm"
      onClick={() => onToggle(isPinned)}
      disabled={pending || (!isPinned && (!!issue || otherPinned))}
      data-testid="lightbox-toggle-hero"
    >
      <Star className={`w-4 h-4 ${isPinned ? "fill-current" : ""}`} />
      {isPinned ? "Unpin cover photo" : "Use as cover photo"}
    </Button>
    <p className="text-[11px] text-muted-foreground max-w-prose">{explanation}</p>
  </div>;
}
