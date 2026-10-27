import { isNewsErrorTitle } from "../../../shared/news-title";
import { snippetAddsNothing } from "../../../shared/news-snippet";

export type FeedItem = {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  image_url: string | null;
  at: string;
  type: string;
  baseline?: boolean;
  followed_at?: string | null;
  publisher?: string | null;
};
export type FeedTab = { type: string; label: string; sourceUrl: string | null; items: FeedItem[] };
export type LandlordNewsArticle = {
  id: string;
  title: string;
  url: string;
  summary?: string | null;
  ai_summary?: string | null;
  image_url?: string | null;
  published_at?: string | null;
  source_name?: string | null;
};

const WEBSITE = "rssapp_web_news";
const MEDIA = "landlord_media";
const LINKEDIN = "rssapp_linkedin";
const INSTAGRAM = "rssapp_instagram";
const LABELS: Record<string, string> = { [WEBSITE]: "Website news", [MEDIA]: "Media", [LINKEDIN]: "LinkedIn", [INSTAGRAM]: "Instagram" };
const normalName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

function safeUrl(value?: string | null): URL | null {
  try {
    const url = new URL(value || "");
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

function canonicalUrl(value: string): string {
  const url = safeUrl(value)!;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.+|fbclid|gclid|msclkid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

function instagramProfile(value?: string | null): string | null {
  if (!value) return null;
  let handle = value.trim().replace(/^@/, "");
  if (/^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i.test(handle)) {
    const url = safeUrl(/^https?:/i.test(handle) ? handle : `https://${handle}`);
    if (!url || !/^(?:www\.)?instagram\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 1) return null;
    handle = parts[0];
  }
  return /^[a-zA-Z0-9._]{1,30}$/.test(handle) && !/^(?:p|reel|reels|stories|explore|accounts|direct)$/i.test(handle)
    ? `https://www.instagram.com/${handle}/` : null;
}

function headline(article: LandlordNewsArticle, companyName: string): { title: string; publisher: string | null } {
  let title = String(article.title || "").trim().replace(/^(?:news|latest news|press release)\s*[|:–—-]\s*/i, "");
  const source = String(article.source_name || "").trim();
  const isSearch = /\(Google News\)\s*$/i.test(source);
  const tail = title.match(/^(.{20,}?)\s+[-–—|]\s+([^|–—]{2,65})$/);
  let publisher: string | null = isSearch ? null : source || null;
  // Google News appends a publisher. On direct sources only strip a tail
  // that agrees with known attribution, not arbitrary words in a headline.
  if (tail && (isSearch || [companyName, source].some(name => !!name && normalName(tail[2]) === normalName(name)))) {
    title = tail[1].trim();
    publisher = tail[2].trim();
  }
  if (publisher && /^(?:unknown|source|news|press|media|google news)$/i.test(publisher)) publisher = null;
  return { title, publisher };
}

const titleKey = (title: string) => title.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").replace(/[.!]+$/, "").trim();
const validDate = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? value : "";

/** Landlord-only presentation merge. It never writes sources, dates or summaries. */
export function mergeLandlordNewsTabs(
  sourceTabs: FeedTab[],
  news: LandlordNewsArticle[] | null | undefined,
  context: { companyName: string; domain?: string | null; instagramHandle?: string | null },
): FeedTab[] {
  const officialUrl = safeUrl(/^https?:\/\//i.test(context.domain || "") ? context.domain : context.domain ? `https://${context.domain}` : null);
  const officialHost = officialUrl?.hostname.toLowerCase().replace(/^www\./, "") || null;
  const companyKey = normalName(context.companyName);
  const tabs = sourceTabs.map(tab => ({
    ...tab,
    sourceUrl: safeUrl(tab.sourceUrl)?.href || null,
    items: tab.items.filter(item => safeUrl(item.url) && !isNewsErrorTitle(item.title)).map(item => ({ ...item })),
  }));
  const byType = new Map(tabs.map(tab => [tab.type, tab]));
  const ensure = (type: string, sourceUrl: string | null = null) => {
    let tab = byType.get(type);
    if (!tab) { tab = { type, label: LABELS[type] || type, sourceUrl, items: [] }; tabs.push(tab); byType.set(type, tab); }
    else if (!tab.sourceUrl && sourceUrl) tab.sourceUrl = sourceUrl;
    return tab;
  };
  const profile = instagramProfile(context.instagramHandle);
  if (profile) ensure(INSTAGRAM, profile).sourceUrl = profile;

  const seenUrls = new Set(tabs.flatMap(tab => tab.items.map(item => canonicalUrl(item.url))));
  // Exact, substantial headlines catch the same story retrieved through
  // Google News and the official website. Short labels are not story IDs.
  const seenTitles = new Set(tabs.flatMap(tab => tab.items.map(item => titleKey(headline({ ...item, source_name: item.publisher }, context.companyName).title))).filter(title => title.length >= 35));
  for (const article of news || []) {
    const url = safeUrl(article.url);
    if (!url || isNewsErrorTitle(article.title)) continue;
    const parsed = headline(article, context.companyName);
    if (!parsed.title || isNewsErrorTitle(parsed.title)) continue;
    const canonical = canonicalUrl(article.url);
    const key = titleKey(parsed.title);
    if (seenUrls.has(canonical) || key.length >= 35 && seenTitles.has(key)) continue;

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const source = String(article.source_name || "").trim();
    const ownSource = !/\(Google News\)\s*$/i.test(source)
      && !!companyKey && normalName(source.replace(/\s*(?:\((?:website news|openings)\)|[—–-]\s*news)\s*$/i, "")) === companyKey;
    const ownDomain = !!officialHost && (host === officialHost || host.endsWith(`.${officialHost}`));
    const ownPublisher = !!companyKey && normalName(parsed.publisher || "") === companyKey;
    const type = /(^|\.)instagram\.com$/.test(host) ? INSTAGRAM
      : /(^|\.)linkedin\.com$/.test(host) ? LINKEDIN
      : ownDomain || ownSource || ownPublisher ? WEBSITE : MEDIA;
    // Other social platforms stay out of media coverage; their source links
    // belong to their channel, rather than masquerading as news articles.
    if (/(^|\.)(?:facebook|twitter|x|tiktok|youtube)\.com$/.test(host)) continue;
    const tab = ensure(type, type === WEBSITE ? officialUrl?.href || null : type === INSTAGRAM ? profile : null);
    const summary = article.ai_summary || article.summary || null;
    tab.items.push({
      id: `media-${article.id}`,
      title: parsed.title,
      summary: snippetAddsNothing(parsed.title, summary) ? null : summary,
      url: url.href,
      image_url: safeUrl(article.image_url)?.href || null,
      at: validDate(article.published_at),
      type,
      publisher: ownDomain || ownSource || ownPublisher ? context.companyName : parsed.publisher || (/^(?:news\.)?google\.com$/.test(host) ? null : host),
    });
    seenUrls.add(canonical);
    if (key.length >= 35) seenTitles.add(key);
  }
  for (const tab of tabs) tab.items.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  return tabs;
}
