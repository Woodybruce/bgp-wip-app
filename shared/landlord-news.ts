export interface LandlordIndustryArticle {
  id: string;
  title: string;
  url: string;
  summary?: string | null;
  ai_summary?: string | null;
  image_url?: string | null;
  published_at?: string | null;
  source_name?: string | null;
  coverage: "company" | "industry";
}
export interface LandlordIndustryNews {
  items: LandlordIndustryArticle[];
  checkedAt: string;
  research: { configured: boolean; status: "not-run" | "ready" | "unavailable"; checkedAt: string | null; cached?: boolean };
}

/** Mirrors the staff-only news endpoint. Feed setup privileges are separate. */
export function canReadLandlordIndustryNews(viewer: { email?: string | null; role?: string | null; companyScopeId?: string | null; isActive?: boolean; is_active?: boolean } | null | undefined): boolean {
  return !!viewer && viewer.role !== "Client" && !viewer.companyScopeId && viewer.isActive !== false && viewer.is_active !== false
    && !!viewer.email?.toLowerCase().endsWith("@brucegillinghampollard.com");
}
