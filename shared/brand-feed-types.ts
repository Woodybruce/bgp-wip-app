// Feed kinds the app follows through RSS.app, shared by server and client.
// Brand-owned channels (news_sources.category = 'brand:<id>') are the brand
// speaking for itself, so their items count as that brand's signals.
export const BRAND_WEB_FEED_TYPES = {
  locations: "rssapp_web_locations",
  website: "rssapp_web_news",
  careers: "rssapp_careers",
  linkedin: "rssapp_linkedin",
} as const;
export type BrandWebFeedKind = keyof typeof BRAND_WEB_FEED_TYPES;

export const BRAND_FEED_TABS: Array<{ type: string; label: string }> = [
  { type: "rssapp_instagram", label: "Instagram" },
  { type: BRAND_WEB_FEED_TYPES.locations, label: "Openings" },
  { type: BRAND_WEB_FEED_TYPES.website, label: "Website news" },
  { type: BRAND_WEB_FEED_TYPES.careers, label: "Jobs" },
  { type: BRAND_WEB_FEED_TYPES.linkedin, label: "LinkedIn" },
];

// Market-wide sources shown on News → Brand watch beside the brand channels.
export const MARKET_FEED_TYPES = { openings: "market_openings", landlords: "market_landlord" } as const;

export const BRAND_WATCH_FILTERS: Array<{ key: string; label: string; types: string[] }> = [
  { key: "all", label: "All", types: [...Object.values(BRAND_WEB_FEED_TYPES), ...Object.values(MARKET_FEED_TYPES)] },
  { key: "openings", label: "Openings", types: [BRAND_WEB_FEED_TYPES.locations, MARKET_FEED_TYPES.openings] },
  { key: "website", label: "Brand websites", types: [BRAND_WEB_FEED_TYPES.website] },
  { key: "careers", label: "Jobs", types: [BRAND_WEB_FEED_TYPES.careers] },
  { key: "linkedin", label: "LinkedIn", types: [BRAND_WEB_FEED_TYPES.linkedin] },
  { key: "landlords", label: "Landlords", types: [MARKET_FEED_TYPES.landlords] },
];
