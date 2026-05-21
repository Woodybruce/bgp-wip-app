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
  source: "press" | "wikipedia" | "homepage" | "cse" | "landlord-website";
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

// Landlord-website source. Reads image_urls cached by the
// landlord-scraper's most recent run for this company. Doesn't fire
// an HTTP fetch of its own — the scraper has already done the heavy
// lifting (render:true × 8 paths). Returns up to 40 candidate URLs.
async function findLandlordWebsiteImages(companyId: string): Promise<FoundImage[]> {
  try {
    const { rows } = await pool.query<{ image_urls: string[] | null; source_urls: any }>(
      `SELECT image_urls, source_urls FROM landlord_website_findings WHERE company_id = $1`,
      [companyId]
    );
    const urls = Array.isArray(rows[0]?.image_urls) ? rows[0].image_urls : [];
    return urls.map(u => ({ url: u, source: "landlord-website" as const, pageUrl: rows[0]?.source_urls?.[0]?.url }));
  } catch {
    return [];
  }
}

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
  const { rows } = await pool.query<BrandRow & { company_type: string | null }>(
    `SELECT id, name, domain, domain_url, industry, company_type FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  const brand = rows[0];
  if (!brand) throw new Error("Brand not found");

  // Landlord-shaped rows reorder sources: their own homepage / portfolio
  // pages have far better property hero shots than Wikipedia (which is mostly
  // logos + boardroom photos for institutional landlords). Detect via
  // company_type so the retail brand pipeline isn't affected.
  const ct = (brand.company_type || "").toLowerCase();
  const isLandlord = ct.includes("landlord") || ct === "client" || ct === "landlord / client";

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

  // Landlord-website images take priority for landlord-shaped rows.
  // Landlords curate big high-quality hero galleries of their assets
  // on /portfolio + /our-places — way better than Google CSE
  // ("Land Securities" on CSE returns logos + headshots + stock
  // photos, none of which are useful in our gallery).
  const landlordImages = await findLandlordWebsiteImages(companyId);
  candidates.push(...landlordImages);

  if (isLandlord) {
    // For landlords: own-website first, then trusted press, skip Wikipedia
    // (institutional landlord Wikipedia articles are mostly corporate logo +
    // boardroom shots — never useful for a property gallery), then CSE.
    if (candidates.length < targetNew * 2 && domain) {
      candidates.push(...await findHomepageImages(domain));
    }
    if (candidates.length < targetNew * 2 && domain) {
      candidates.push(...await findPressImages(domain));
    }
    if (candidates.length < targetNew * 2) {
      candidates.push(...await findCseImages(brand.name, brand.industry, domain));
    }
  } else {
    // Retail brand pipeline — Wikipedia stays useful (logo + flagship store
    // shots from notable retailers like Aesop / Apple / Pret) so keeps its
    // original position between press and homepage.
    if (candidates.length < targetNew * 2 && domain) {
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

// One-shot cleanup — scans crm_properties for business-y names that
// snuck in from a buggy pre-rule resolver run (e.g. "The Pantry Cafe"
// stamped onto 108 Chiswick High Road). For each affected row,
// re-derives the canonical name from its UPRN's OS Places DPA and
// renames in place. Safe to re-run — only rewrites where the name
// changes.
//
//   POST /api/admin/heal-property-names
//
// Body: { dryRun?: boolean, limit?: number }
// Returns: { scanned, renamed, samples: [{ id, oldName, newName }] }
router.post("/api/admin/heal-property-names", requireAuth, async (req: Request, res: Response) => {
  try {
    const dryRun = req.body?.dryRun === true;
    const limit = Math.min(Number(req.body?.limit) || 200, 500);

    // Find rows that genuinely look like business / tenant names.
    // The previous heuristic (letters + no digits + no commas + short)
    // was way too broad — it caught Bluewater Shopping Centre, Brent
    // Cross, Bullring, Buchanan Galleries, etc. (real building names
    // we want to KEEP). Tighten by requiring a business-vocabulary
    // word AND excluding rows whose name carries a landmark suffix
    // ("Shopping Centre", "House", "Tower", "Manor", "Galleries"...).
    const BUSINESS_WORD_PATTERN = "(cafe|café|coffee|restaurant|bistro|brasserie|eatery|kitchen|deli|delicatessen|bakery|patisserie|pizzeria|grill|burger|pub|tavern|bar|lounge|nightclub|club|diner|takeaway|takeout|shop|store|boutique|market|salon|barber|barbers|gym|fitness|spa|pharmacy|clinic|surgery|dentist|optician|opticians|garage|dealership|laundrette|laundromat)";
    const LANDMARK_SUFFIX_PATTERN = "(shopping\\s*centre|shopping\\s*center|mall|plaza|square|park|gardens?|manor|house|tower|towers|galleries|gallery|place|quay|bridge|lights|dock|village|hall|exchange|estate|wharf|works|terrace|crescent|mews|courts?|station|terminal|stadium|arena|arcade|complex|outlet|outlets|island|cross|valley|fields)";
    const { rows } = await pool.query<{ id: string; name: string; uprn: string | null; address: any; postcode: string | null }>(
      `SELECT id, name, uprn, address, postcode
         FROM crm_properties
        WHERE name ~ '[A-Za-z]'
          AND name !~ '[0-9]'
          AND position(',' in name) = 0
          AND char_length(name) < 50
          AND name ~* $2          -- contains a business-vocabulary word
          AND name !~* $3         -- does NOT contain a landmark suffix
        ORDER BY updated_at DESC NULLS LAST
        LIMIT $1`,
      [limit, `\\m${BUSINESS_WORD_PATTERN}\\M`, `\\m${LANDMARK_SUFFIX_PATTERN}\\M`]
    );

    const samples: { id: string; oldName: string; newName: string; source: string }[] = [];
    const skipped: { id: string; oldName: string; reason: string }[] = [];
    let renamed = 0;
    const { osPlacesByUprn } = await import("./os-data");
    const { derivePropertyNameFromDpa } = await import("./property-resolver");

    // Build the same line1-style name from a stored address jsonb when
    // OS Places isn't available. Splits on comma, picks the first chunk
    // that looks like a street (number + words), title-cases the result.
    const deriveFromAddressJsonb = (addr: any): string | null => {
      if (!addr) return null;
      const formatted = typeof addr === "string"
        ? addr
        : (addr.formatted || addr.line1 || "");
      if (!formatted) return null;
      // Reuse the resolver's logic by faking a DPA shape it understands.
      try {
        return (derivePropertyNameFromDpa as any)({ address: formatted } as any);
      } catch {
        // Last-resort split: first comma-separated chunk title-cased.
        const first = String(formatted).split(",")[0]?.trim() || "";
        return first || null;
      }
    };

    for (const r of rows) {
      let newName: string | null = null;
      let source = "";
      try {
        if (r.uprn) {
          const dpa = await osPlacesByUprn(r.uprn);
          if (dpa) {
            const candidate = (derivePropertyNameFromDpa as any)(dpa) as string;
            if (candidate && candidate !== r.name && candidate !== "Unknown property") {
              newName = candidate;
              source = "os-places-uprn";
            }
          }
        }
        if (!newName) {
          // Fallback: use the property's stored address jsonb. Salvages
          // rows whose UPRN is stale / unrecognised by OS Places (or
          // where the row never had a UPRN, but the address survives).
          const fromAddr = deriveFromAddressJsonb(r.address);
          if (fromAddr && fromAddr !== r.name && fromAddr !== "Unknown property") {
            newName = fromAddr;
            source = "address-jsonb";
          }
        }

        if (!newName) {
          skipped.push({
            id: r.id,
            oldName: r.name,
            reason: r.uprn ? "OS Places didn't recognise UPRN + no usable address jsonb" : "no UPRN and no usable address jsonb",
          });
          continue;
        }

        samples.push({ id: r.id, oldName: r.name, newName, source });
        if (!dryRun) {
          await pool.query(
            `UPDATE crm_properties SET name = $2, updated_at = NOW() WHERE id = $1`,
            [r.id, newName]
          );
          renamed++;
        }
      } catch (err: any) {
        console.warn(`[heal-property-names] failed for ${r.id} (${r.name}):`, err?.message);
        skipped.push({ id: r.id, oldName: r.name, reason: err?.message || "error" });
      }
    }

    res.json({
      scanned: rows.length,
      renamed,
      dryRun,
      samples: samples.slice(0, 50),
      skipped: skipped.slice(0, 50),
    });
  } catch (e: any) {
    console.error("[heal-property-names] failed:", e?.message);
    res.status(500).json({ error: e?.message || "heal failed" });
  }
});

// Inspect a single crm_property to decide what to do with it. Returns
// the row's full state plus a count of linked deals / units / etc so
// we can decide whether to safely delete + recreate vs rename in place.
//   GET /api/admin/property-inspect/:id
router.get("/api/admin/property-inspect/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { rows: prop } = await pool.query(
      `SELECT id, name, uprn, postcode, address, latitude, longitude, resolution_status, created_at, updated_at
         FROM crm_properties WHERE id = $1`,
      [id]
    );
    if (!prop[0]) return res.status(404).json({ error: "not found" });

    // Count incoming references so we know what'd break if we deleted.
    const dealCount = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM crm_deals WHERE property_id = $1`, [id]);
    const tenancyCount = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM tenancy_schedule_units WHERE property_id = $1`, [id]);
    const leasingCount = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM leasing_schedule_units WHERE property_id = $1`, [id]);
    const availCount = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM available_units WHERE property_id = $1`, [id]);
    const compCount = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM crm_comps WHERE property_id = $1`, [id]);

    res.json({
      property: prop[0],
      links: {
        deals: dealCount.rows[0]?.n || 0,
        tenancyUnits: tenancyCount.rows[0]?.n || 0,
        leasingUnits: leasingCount.rows[0]?.n || 0,
        availableUnits: availCount.rows[0]?.n || 0,
        comps: compCount.rows[0]?.n || 0,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "inspect failed" });
  }
});

// Targeted rename for a single property. Used after /property-inspect
// confirms there are no surprise references, or to clean up a row
// the auto-heal couldn't fix (OS Places doesn't recognise its UPRN
// and there's no stored address jsonb).
//   POST /api/admin/property-rename  { id, newName }
router.post("/api/admin/property-rename", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.body?.id || "");
    const newName = String(req.body?.newName || "").trim();
    if (!id || !newName) return res.status(400).json({ error: "id and newName required" });
    const { rows } = await pool.query(
      `UPDATE crm_properties SET name = $2, updated_at = NOW() WHERE id = $1 RETURNING id, name`,
      [id, newName]
    );
    if (!rows[0]) return res.status(404).json({ error: "property not found" });
    res.json({ ok: true, property: rows[0] });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "rename failed" });
  }
});

// General property update — patch postcode / lat / lng / address / uprn
// on a single row. Used to fix stale fields the resolver stamped from
// a wrong run (e.g. postcode is W4 2ED when it should be W4 1PU). Only
// the keys present in the body get touched; everything else is left
// alone.
//   POST /api/admin/property-update
//   body: { id, name?, postcode?, latitude?, longitude?, uprn?, address? }
router.post("/api/admin/property-update", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.body?.id || "");
    if (!id) return res.status(400).json({ error: "id required" });
    const ALLOWED = ["name", "postcode", "latitude", "longitude", "uprn", "address"] as const;
    const sets: string[] = [];
    const values: any[] = [id];
    let idx = 2;
    for (const k of ALLOWED) {
      if (!(k in (req.body || {}))) continue;
      const v = (req.body as any)[k];
      // address is jsonb — serialize objects via the JSON cast.
      if (k === "address" && v && typeof v === "object") {
        sets.push(`address = $${idx++}::jsonb`);
        values.push(JSON.stringify(v));
      } else {
        sets.push(`${k} = $${idx++}`);
        values.push(v === "" ? null : v);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: "no updatable fields provided" });
    sets.push(`updated_at = NOW()`);
    const { rows } = await pool.query(
      `UPDATE crm_properties SET ${sets.join(", ")} WHERE id = $1 RETURNING id, name, postcode, latitude, longitude, uprn, address`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: "property not found" });
    res.json({ ok: true, property: rows[0] });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "update failed" });
  }
});

// Diagnostic — surfaces exactly what's stored for a brand's images and
// which sources have data. Used to debug "why is this brand returning
// 204 / no images" without having to query the DB by hand.
//   GET /api/brand/:companyId/image-diag
router.get("/api/brand/:companyId/image-diag", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);

    const { rows: companyRows } = await pool.query<{
      id: string; name: string; domain: string | null; domain_url: string | null;
      industry: string | null; company_type: string | null;
    }>(
      `SELECT id, name, domain, domain_url, industry, company_type FROM crm_companies WHERE id = $1`,
      [companyId]
    );
    const brand = companyRows[0];
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    // What did the landlord scraper find?
    const { rows: landlordRows } = await pool.query<{
      image_urls: string[] | null;
      source_urls: any;
      created_at: Date | null;
      updated_at: Date | null;
    }>(
      `SELECT image_urls, source_urls, created_at, updated_at
         FROM landlord_website_findings WHERE company_id = $1`,
      [companyId]
    ).catch(() => ({ rows: [] }));
    const landlordImageUrls = Array.isArray(landlordRows[0]?.image_urls) ? landlordRows[0].image_urls : [];

    // What's currently stored in image_studio_images for this brand?
    const { rows: storedRows } = await pool.query<{ source: string | null; cnt: number }>(
      `SELECT source, COUNT(*)::int AS cnt
         FROM image_studio_images
        WHERE LOWER(brand_name) = LOWER($1)
          AND 'brand-auto' = ANY(tags)
        GROUP BY source
        ORDER BY cnt DESC`,
      [brand.name]
    ).catch(() => ({ rows: [] }));
    const storedTotal = storedRows.reduce((s, r) => s + Number(r.cnt || 0), 0);

    // Last refresh job state.
    const { getJobStatus } = await import("./brand-jobs");
    const jobStatus = getJobStatus(`refresh-images:${companyId}`);

    return res.json({
      brand: {
        id: brand.id, name: brand.name, type: brand.company_type, industry: brand.industry,
        domain: brand.domain, domainUrl: brand.domain_url,
      },
      landlordScraper: {
        hasRow: !!landlordRows[0],
        imageUrlCount: landlordImageUrls.length,
        sampleUrls: landlordImageUrls.slice(0, 5),
        lastUpdated: landlordRows[0]?.updated_at || landlordRows[0]?.created_at || null,
      },
      storedImages: {
        total: storedTotal,
        bySource: Object.fromEntries(storedRows.map(r => [r.source || "(null)", r.cnt])),
      },
      lastRefreshJob: jobStatus || { state: "idle" },
    });
  } catch (e: any) {
    console.error("[image-diag] failed:", e?.message);
    res.status(500).json({ error: e?.message || "diag failed" });
  }
});

export default router;
