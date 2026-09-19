import { useState } from "react";
import { Image as ImageIcon, Star } from "lucide-react";
import { selectCompanyHeroImage, rankCompanyHeroImages, companyImageHeroIssue } from "@shared/brand-image-selection";
import { BrandImageRefreshButton } from "@/components/brand-profile-overview";
import { Button } from "@/components/ui/button";

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
  if (!hero) {
    return <div className="rounded-lg border border-dashed border-border bg-card p-4 flex flex-wrap items-center justify-between gap-3" data-testid="brand-overview-image-empty">
      <p className="text-sm text-muted-foreground flex items-center gap-2"><ImageIcon className="w-4 h-4 shrink-0" />{candidates.length ? "The saved cover photos could not be loaded." : "No suitable cover photo yet."}</p>
      {canRefresh && <BrandImageRefreshButton companyId={companyId} />}
    </div>;
  }
  return <div key={imageKey} className="rounded-lg overflow-hidden border border-border bg-muted" data-testid="brand-overview-image">
    <img
      src={`/api/brand/gallery-image/${encodeURIComponent(hero.id)}?full=1`}
      alt={`${companyName} cover photo`}
      className="w-full h-44 sm:h-64 object-cover"
      decoding="async"
      onError={() => setFailedImages(previous => imageKey && !previous.includes(imageKey) ? [...previous.filter(key => key.startsWith(`${companyId}:`)), imageKey] : previous)}
    />
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
