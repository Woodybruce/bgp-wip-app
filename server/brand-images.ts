// Brand image discovery — sources, in quality order:
//   1. Press / newsroom pages (highest quality, brand-curated, press-cleared)
//   2. Wikipedia / Wikimedia Commons (CC-licensed, good for big brands)
//   3. Homepage og:image + /stores hero (universal, decent quality)
//   4. Google Custom Search Images (paid, long-tail coverage)
//
// Each successful fetch is stored in image_studio_images with tags
// ["brand-auto", brandName, source]. Existing manual uploads are not touched.
//
// Triggered by:
//   - POST /api/brand/:companyId/refresh-images (manual, from brand profile)
//   - Auto on brand profile load when image count < target (in brand-profile.ts)
//   - Bulk admin script (TODO)
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { storeImageFromBuffer } from "./image-studio";

const router = Router();

const TARGET_IMAGES_PER_BRAND = 5;
const MIN_IMAGE_BYTES = 8000;        // reject favicons / 1x1 trackers
const MIN_WIDTH = 480;               // reject thumbnails

interface FoundImage {
  url: string;
  source: "press" | "wikipedia" | "homepage" | "cse";
  caption?: string;
  pageUrl?: string;             // where we discovered it (for attribution)
}

interface BrandRow {
  id: string;
  name: string;
  domain: string | null;
  domain_url: string | null;
  industry: string | null;
}

// ─── Utilities ───────────────────────────────────────────────────────────

function extractDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return String(raw)
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .toLowerCase()
    .trim() || null;
}

function absolutiseUrl(base: string, src: string): string | null {
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

async function fetchHtml(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BGPBrandBot/1.0)",
        "Accept": "text/html",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

async function fetchImage(url: string): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BGPBrandBot/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_IMAGE_BYTES) return null;
    const mime = res.headers.get("content-type") || "image/jpeg";
    if (!mime.startsWith("image/")) return null;
    return { buffer: buf, mime };
  } catch {
    return null;
  }
}

// Image extraction from an HTML page: <img>, og:image, twitter:image, srcset.
// Filters out tiny logos, sprites, and SVG icons. Caller filters duplicates.
function extractImagesFromHtml(html: string, baseUrl: string, limit = 12): string[] {
  const candidates = new Set<string>();
  // og:image / twitter:image first (publisher's chosen hero)
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/gi);
  if (ogMatch) for (const m of ogMatch) {
    const u = m.match(/content=["']([^"']+)["']/i)?.[1];
    if (u) candidates.add(u);
  }
  const twMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/gi);
  if (twMatch) for (const m of twMatch) {
    const u = m.match(/content=["']([^"']+)["']/i)?.[1];
    if (u) candidates.add(u);
  }
  // <img src> + srcset — pick the highest-resolution srcset entry where available.
  const imgRe = /<img\b[^>]*?(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = imgRe.exec(html)) && count < 50) {
    const tag = m[0];
    const srcset = tag.match(/srcset=["']([^"']+)["']/i)?.[1];
    if (srcset) {
      const largest = srcset.split(",").map(s => s.trim()).pop();
      if (largest) {
        const url = largest.split(/\s+/)[0];
        if (url) candidates.add(url);
      }
    }
    candidates.add(m[1]);
    count++;
  }
  // Absolutise + filter
  const absoluted: string[] = [];
  for (const c of candidates) {
    const abs = absolutiseUrl(baseUrl, c);
    if (!abs) continue;
    if (/\.svg(\?|$)/i.test(abs)) continue;           // icons
    if (/sprites?\.|icon|favicon|placeholder|spacer|pixel|tracking|gtm/i.test(abs)) continue;
    if (absoluted.includes(abs)) continue;
    absoluted.push(abs);
    if (absoluted.length >= limit) break;
  }
  return absoluted;
}

// ─── Source 1: Press / newsroom pages ─────────────────────────────────────

const PRESS_PATHS = [
  "/press", "/newsroom", "/news", "/media", "/press-room", "/press-releases",
  "/about/press", "/company/press", "/about/newsroom", "/corporate/press",
];

async function findPressImages(domain: string): Promise<FoundImage[]> {
  const base = `https://${domain}`;
  for (const path of PRESS_PATHS) {
    const url = `${base}${path}`;
    const html = await fetchHtml(url);
    if (!html) continue;
    // Quick sanity check — page must mention "press", "media", "newsroom",
    // or "release". Avoids accidentally scraping a generic landing page.
    if (!/(press|media|newsroom|release)/i.test(html.slice(0, 8000))) continue;
    const imgs = extractImagesFromHtml(html, url, 10);
    if (imgs.length > 0) {
      return imgs.map(u => ({ url: u, source: "press", pageUrl: url }));
    }
  }
  return [];
}

// ─── Source 2: Wikipedia / Wikimedia Commons ──────────────────────────────

async function findWikipediaImages(brandName: string): Promise<FoundImage[]> {
  try {
    // 1. Search for the article
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(brandName)}&format=json&origin=*&srlimit=1`;
    const sr = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });
    if (!sr.ok) return [];
    const sd = await sr.json();
    const title = sd?.query?.search?.[0]?.title;
    if (!title) return [];

    // 2. Get all images on that article — Wikipedia returns the file titles.
    const imagesUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=images&imlimit=20&format=json&origin=*`;
    const ir = await fetch(imagesUrl, { signal: AbortSignal.timeout(8000) });
    if (!ir.ok) return [];
    const id = await ir.json();
    const pages = id?.query?.pages || {};
    const firstPage: any = Object.values(pages)[0];
    const titles: string[] = (firstPage?.images || [])
      .map((i: any) => i.title)
      .filter((t: string) => /\.(jpg|jpeg|png)$/i.test(t))
      .filter((t: string) => !/commons-logo|edit-icon|icon-|flag|coat-of-arms|map/i.test(t));

    if (titles.length === 0) return [];

    // 3. Resolve file titles → actual URLs via the imageinfo endpoint.
    const titlesParam = titles.slice(0, 8).map(t => encodeURIComponent(t)).join("|");
    const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${titlesParam}&prop=imageinfo&iiprop=url&format=json&origin=*`;
    const fr = await fetch(infoUrl, { signal: AbortSignal.timeout(8000) });
    if (!fr.ok) return [];
    const fd = await fr.json();
    const fpages = fd?.query?.pages || {};
    const out: FoundImage[] = [];
    for (const p of Object.values<any>(fpages)) {
      const url: string | undefined = p?.imageinfo?.[0]?.url;
      if (url) out.push({
        url,
        source: "wikipedia",
        pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
        caption: p?.title?.replace(/^File:/, ""),
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ─── Source 3: Homepage hero + store locator ──────────────────────────────

async function findHomepageImages(domain: string): Promise<FoundImage[]> {
  const base = `https://${domain}`;
  const out: FoundImage[] = [];

  const home = await fetchHtml(base);
  if (home) {
    for (const u of extractImagesFromHtml(home, base, 6)) {
      out.push({ url: u, source: "homepage", pageUrl: base });
    }
  }

  // Store locator pages often have stunning flagship interior shots
  for (const path of ["/stores", "/store-locator", "/find-a-store", "/locations"]) {
    if (out.length >= 6) break;
    const url = `${base}${path}`;
    const html = await fetchHtml(url);
    if (!html) continue;
    for (const u of extractImagesFromHtml(html, url, 4)) {
      out.push({ url: u, source: "homepage", pageUrl: url });
    }
  }
  return out;
}

// ─── Source 4: Google Custom Search Images (paid) ─────────────────────────
// Requires GOOGLE_CSE_ID and GOOGLE_CSE_KEY env vars. Set up at
// https://programmablesearchengine.google.com/ — create a CSE configured to
// "Search the entire web" with image search enabled. Free tier is 100
// queries/day; £4/1000 above that.

// Domains and title tokens that are almost always wrong for retail brand
// imagery. "Stories" is the worst offender (children's books, cartoons),
// but generic brand names like "Apple", "Coach", "Gap" all pull off-topic
// content from these hosts. We drop anything matching post-fetch.
const IMAGE_HOST_DENYLIST = [
  "cartoon",
  "clipart",
  "fairy",
  "fairytale",
  "storybook",
  "childrens",
  "kindergarten",
  "babynames",
  "lego.com/cdn", // toy product pages
  "alamy.com",   // stock photo of unrelated subjects
  "shutterstock.com",
  "istockphoto.com",
  "dreamstime.com",
  "etsy.com",
  "redbubble.com",
  "amazon.com/dp", // generic product detail
];
const IMAGE_TITLE_DENYLIST = [
  "cartoon",
  "clipart",
  "fairy tale",
  "fairytale",
  "story book",
  "storybook",
  "children's book",
  "childrens book",
  "kindergarten",
  "colouring page",
  "coloring page",
  "nursery rhyme",
  "bedtime",
  "illustration vector",
];

export function looksLikeBrandImage(brandName: string, brandDomain: string | null, page: string | undefined, title: string | undefined): boolean {
  const titleLower = (title || "").toLowerCase();
  const pageLower = (page || "").toLowerCase();
  // Drop anything matching the denylists outright.
  for (const bad of IMAGE_TITLE_DENYLIST) if (titleLower.includes(bad)) return false;
  for (const bad of IMAGE_HOST_DENYLIST) if (pageLower.includes(bad)) return false;
  // Strong positive signal: page hosted on the brand's own domain, or
  // page URL mentions the brand domain.
  if (brandDomain) {
    const dStem = brandDomain.split(".")[0]; // "stories" from "stories.com"
    if (pageLower.includes(brandDomain)) return true;
    // Domain stem only counts if it's a recognisable token — skip generic
    // 1-2 char stems and stems that are common English words.
    if (dStem.length >= 4 && pageLower.includes(dStem)) return true;
  }
  // Otherwise require the brand name (or its core token) to appear in the
  // title. For multi-word brands take the most distinctive word (longest).
  const tokens = brandName.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true; // can't filter, let it through
  const distinctive = tokens.slice().sort((a, b) => b.length - a.length)[0];
  // If brand has a unique multi-word phrase, require it in title.
  const phrase = brandName.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (phrase.length > 6 && titleLower.includes(phrase)) return true;
  // Fall back to the distinctive token — but require it to be >=5 chars
  // so we don't whitelist anything just because "the" appears.
  if (distinctive.length >= 5 && titleLower.includes(distinctive)) return true;
  return false;
}

async function findCseImages(brandName: string, industry: string | null, brandDomain: string | null): Promise<FoundImage[]> {
  // Reuses GOOGLE_API_KEY (already used for Places / Street View) — no need
  // for a separate CSE-only key. GOOGLE_CSE_ID is the Custom Search Engine
  // config ID (set up free at programmablesearchengine.google.com).
  const key = process.env.GOOGLE_CSE_KEY || process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) return [];
  try {
    // Bias the query toward the brand's own domain so generic names
    // ("& Other Stories", "Apple", "Coach") don't pull cartoons.
    const concept = industry ? ` ${industry}` : " flagship store";
    const domainHint = brandDomain ? ` "${brandDomain}"` : "";
    const query = `"${brandName}"${domainHint}${concept}`;
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&searchType=image&imgSize=large&num=10&safe=active`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const d = await r.json();
    const items: any[] = d?.items || [];
    return items
      .filter(it => it.link && (it.image?.width ?? 0) >= MIN_WIDTH)
      .filter(it => looksLikeBrandImage(brandName, brandDomain, it.image?.contextLink, it.title))
      .slice(0, 5)
      .map(it => ({
        url: it.link,
        source: "cse" as const,
        pageUrl: it.image?.contextLink,
        caption: it.title,
      }));
  } catch {
    return [];
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────

export async function refreshBrandImages(companyId: string): Promise<{
  attempted: number;
  imported: number;
  bySource: Record<string, number>;
  skipped: string;
}> {
  const { rows } = await pool.query<BrandRow>(
    `SELECT id, name, domain, domain_url, industry FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  const brand = rows[0];
  if (!brand) throw new Error("Brand not found");

  // Skip if we already have enough auto-fetched images. Manual uploads are
  // never counted against the cap — users always get their content back.
  const existingRow = await pool.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM image_studio_images
       WHERE LOWER(brand_name) = LOWER($1)
         AND 'brand-auto' = ANY(tags)`,
    [brand.name]
  );
  const existing = existingRow.rows[0]?.cnt ?? 0;
  if (existing >= TARGET_IMAGES_PER_BRAND) {
    return { attempted: 0, imported: 0, bySource: {}, skipped: `Already have ${existing} auto-images (target ${TARGET_IMAGES_PER_BRAND})` };
  }
  const targetNew = TARGET_IMAGES_PER_BRAND - existing;

  const domain = extractDomain(brand.domain || brand.domain_url);
  const candidates: FoundImage[] = [];

  // Fetch from each source in quality order; bail once we have ~3× target
  // to keep the dedupe + import loop tight.
  if (domain) {
    candidates.push(...await findPressImages(domain));
  }
  if (candidates.length < targetNew * 2) {
    candidates.push(...await findWikipediaImages(brand.name));
  }
  if (candidates.length < targetNew * 2 && domain) {
    candidates.push(...await findHomepageImages(domain));
  }
  if (candidates.length < targetNew * 2) {
    candidates.push(...await findCseImages(brand.name, brand.industry, domain));
  }

  const bySource: Record<string, number> = {};
  let imported = 0;
  let attempted = 0;
  const seenUrls = new Set<string>();

  for (const c of candidates) {
    if (imported >= targetNew) break;
    if (seenUrls.has(c.url)) continue;
    seenUrls.add(c.url);
    attempted++;

    const fetched = await fetchImage(c.url);
    if (!fetched) continue;

    try {
      await storeImageFromBuffer({
        buffer: fetched.buffer,
        fileName: `${brand.name} — ${c.source}${c.caption ? `: ${c.caption.slice(0, 80)}` : ""}`,
        category: "Brand",
        tags: ["brand-auto", brand.name, c.source],
        description: c.pageUrl ? `Auto-fetched from ${c.source} (${c.pageUrl}) for ${brand.name}` : `Auto-fetched from ${c.source} for ${brand.name}`,
        source: c.source,
        brandName: brand.name,
        mimeType: fetched.mime,
        filenameHint: `${brand.name}-${c.source}`,
      });
      imported++;
      bySource[c.source] = (bySource[c.source] || 0) + 1;
    } catch (e: any) {
      console.warn(`[brand-images] store failed for ${brand.name}: ${e?.message}`);
    }
  }

  return { attempted, imported, bySource, skipped: "" };
}

// ─── Routes ───────────────────────────────────────────────────────────────

// Image refresh hits Google Images + downloads each file — can run
// 60s+ on brands with rich galleries. Backgrounded so Railway's edge
// proxy doesn't 504 the client. Client polls /status until done.
router.post("/api/brand/:companyId/refresh-images", requireAuth, async (req: Request, res: Response) => {
  const { startJob, getJobStatus } = await import("./brand-jobs");
  const companyId = String(req.params.companyId);
  const key = `refresh-images:${companyId}`;
  const { alreadyRunning } = startJob(key, () => refreshBrandImages(companyId));
  const status = getJobStatus(key);
  res.status(202).json({ accepted: true, inFlight: true, alreadyRunning, jobKey: key, startedAt: status?.startedAt });
});

router.get("/api/brand/:companyId/refresh-images/status", requireAuth, async (req: Request, res: Response) => {
  const { getJobStatus } = await import("./brand-jobs");
  const status = getJobStatus(`refresh-images:${req.params.companyId}`);
  if (!status) return res.json({ state: "idle" });
  res.json(status);
});

export default router;
