type CompanyImage = {
  id?: string;
  tags?: string[] | null;
  source?: string | null;
  file_name?: string | null;
  category?: string | null;
  width?: number | null;
  height?: number | null;
};

const tagsFor = (image: CompanyImage) => (Array.isArray(image.tags) ? image.tags : []).map(tag => tag.toLowerCase());
const kindFor = (image: CompanyImage) => {
  const tags = tagsFor(image);
  return tags.find(tag => tag.startsWith("image-kind:"))?.slice(11)
    || ["storefront", "interior", "building", "food", "product", "logo", "graphic", "people"].find(kind => tags.includes(kind))
    || null;
};

export function isCompanyImageLogo(image: CompanyImage): boolean {
  const tags = tagsFor(image);
  return tags.some(tag => /^(?:brand[ -])?logo$|^logo-dev-cache$|^website-logo$|^image-kind:logo$/.test(tag))
    || /logo(?:-dev)?|favicon/.test((image.source || "").toLowerCase())
    || /(?:^|[—–_\s/.-])(?:logo|logotype|wordmark|favicon)(?:[—–_\s/.-]|$)/i.test(image.file_name || "");
}

/** Gallery records remain available; only suitable photos become a cover. */
export function companyImageHeroIssue(image: CompanyImage): string | null {
  const tags = tagsFor(image);
  if (isCompanyImageLogo(image)) return "Logos are shown in the gallery and identity header, rather than as the cover photo.";
  if (tags.includes("identity-review")) return "This image needs an identity review before it can be the cover.";
  if (tags.includes("image-quality-review")) return "This image did not pass the photo quality review.";
  if (["graphic", "people", "headshot", "icon", "menu", "screenshot", "map", "chart", "illustration", "other"].includes(kindFor(image) || "")) {
    return "Choose a clear photograph of the brand's spaces, products or the landlord's properties.";
  }
  const width = Number(image.width), height = Number(image.height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    if (Math.min(width, height) < 360 || Math.max(width, height) < 640 || width * height < 300_000) return "This image is too small for a clear cover photo.";
    if (width / height < .5 || width / height > 2.4) return "This image's proportions would crop poorly as a cover photo.";
    return null;
  }
  // Older explicitly chosen photos keep their place until they are reviewed;
  // unknown gallery rows are not promoted merely because they were added last.
  return tags.includes("brand-hero") || tags.includes("image-quality:v1") ? null : "The original image size has not been checked yet.";
}

export function rankCompanyHeroImages<T extends CompanyImage>(images: T[] | null | undefined, companyType?: string | null): T[] {
  const landlord = /landlord|^client$/i.test(companyType || "");
  const kinds: Record<string, number> = landlord
    ? { building: 50, interior: 40, storefront: 35, product: 5, food: 0 }
    : { storefront: 50, interior: 45, building: 35, product: 25, food: 20 };
  const score = (image: CompanyImage) => {
    const tags = tagsFor(image);
    const value = Number(tags.find(tag => /^image-quality-score:\d+$/.test(tag))?.split(":")[1] || 0);
    return (tags.includes("brand-hero") ? 10_000 : 0)
      + (tags.includes("image-quality:v1") ? 1_000 : 0)
      + (kinds[kindFor(image) || ""] || 0) * 5
      + Math.max(0, Math.min(100, value))
      + Math.min(30, Math.max(0, (Number(image.width) || 0) * (Number(image.height) || 0) / 100_000));
  };
  return (images || []).map((image, index) => ({ image, index }))
    .filter(({ image }) => !companyImageHeroIssue(image))
    .sort((a, b) => score(b.image) - score(a.image) || a.index - b.index)
    .map(({ image }) => image);
}

export function selectCompanyHeroImage<T extends CompanyImage>(images: T[] | null | undefined, companyType?: string | null): T | null {
  return rankCompanyHeroImages(images, companyType)[0] || null;
}
