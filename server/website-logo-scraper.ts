// Scrape the highest-quality logo (and a small set of hero images) from
// a company's own homepage. Most retailer / landlord / developer sites
// publish their brand logo in plain HTML — Open Graph, apple-touch-icon,
// schema.org JSON-LD, or as the first <img> in the <header>/<nav>. The
// homepage hero (product shots, flagship store, building photography)
// is almost always in the body as a large <img> too. Both are way
// better than anything logo.dev / Google favicons / brochure scraps
// hand back, but we never looked.
//
// Two entry points:
//   - scrapeLogoFromWebsite(domain) — single best logo, used by the
//     bulk brand-logo importer + on-demand refresh endpoints.
//   - scrapeHeroImagesFromWebsite(domain) — up to N large body images
//     (excluding the logo) for brand-profile / property hero pulls.

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const FETCH_TIMEOUT_MS = 8000;

export interface ScrapedLogo {
  buffer: Buffer;
  mime: string;
  source: "og" | "apple-touch-icon" | "schema" | "header-img" | "favicon-hires";
  url: string;
}

export interface ScrapedHeroImage {
  buffer: Buffer;
  mime: string;
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

export async function scrapeLogoFromWebsite(domain: string): Promise<ScrapedLogo | null> {
  const homepage = await fetchHomepage(domain);
  if (!homepage) return null;
  const { html, finalUrl } = homepage;

  const candidates = collectLogoCandidates(html, finalUrl);
  for (const cand of candidates) {
    const fetched = await downloadImage(cand.url);
    if (!fetched) continue;
    // Reject tiny stuff — anything below 800 bytes is almost certainly a
    // 1x1 tracker or a 16x16 favicon that snuck through.
    if (fetched.buffer.length < 800) continue;
    return { ...fetched, source: cand.source, url: cand.url };
  }
  return null;
}

// Pull body hero images for the brand/property profile. Skips the
// header/nav logo, decorative pixels, and SVG icons — we want big
// editorial / product / building photography. Defaults to 6 images.
export async function scrapeHeroImagesFromWebsite(domain: string, maxImages = 6): Promise<ScrapedHeroImage[]> {
  const homepage = await fetchHomepage(domain);
  if (!homepage) return [];
  const { html, finalUrl } = homepage;

  const candidates = collectHeroCandidates(html, finalUrl);
  const out: ScrapedHeroImage[] = [];
  const seenUrls = new Set<string>();
  for (const cand of candidates) {
    if (out.length >= maxImages) break;
    if (seenUrls.has(cand.url)) continue;
    seenUrls.add(cand.url);
    const fetched = await downloadImage(cand.url);
    if (!fetched) continue;
    // Reject anything tiny. Marketing hero images are 50KB+ at minimum.
    if (fetched.buffer.length < 12_000) continue;
    out.push({
      buffer: fetched.buffer,
      mime: fetched.mime,
      url: cand.url,
      width: cand.width,
      height: cand.height,
      alt: cand.alt,
    });
  }
  return out;
}

// ─── Homepage fetch ──────────────────────────────────────────────────────

async function fetchHomepage(domain: string): Promise<{ html: string; finalUrl: string } | null> {
  const tries = [
    `https://${domain}`,
    `https://www.${domain}`,
  ];
  for (const url of tries) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-GB,en;q=0.9",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") || "";
      if (!ct.toLowerCase().includes("html")) continue;
      const html = await res.text();
      if (html.length < 200) continue;
      return { html, finalUrl: res.url || url };
    } catch {
      // try next variant
    }
  }
  return null;
}

// ─── Candidate extraction ───────────────────────────────────────────────

interface LogoCandidate {
  url: string;
  source: ScrapedLogo["source"];
  priority: number;          // lower is better — used to order candidates
}

function collectLogoCandidates(html: string, baseUrl: string): LogoCandidate[] {
  const out: LogoCandidate[] = [];

  // 1. Schema.org Organization.logo from JSON-LD — when present this is
  //    the company's official logo, intended for machine consumption.
  for (const jsonld of extractJsonLdBlocks(html)) {
    const logos = extractSchemaLogos(jsonld);
    for (const u of logos) {
      out.push({ url: absolutise(u, baseUrl), source: "schema", priority: 1 });
    }
  }

  // 2. Open Graph image — used by Twitter / LinkedIn / Slack previews.
  //    Often a high-quality brand asset.
  const og = matchAttr(html, /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
    || matchAttr(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i);
  if (og) out.push({ url: absolutise(og, baseUrl), source: "og", priority: 2 });

  // 3. apple-touch-icon — required by iOS, almost always 180×180 PNG.
  //    Sometimes the only place a retailer publishes a clean square logo.
  const appleIcons = matchAllAttrs(html, /<link[^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*>/gi);
  for (const tag of appleIcons) {
    const href = matchAttr(tag, /href=["']([^"']+)["']/i);
    const sizes = matchAttr(tag, /sizes=["']([^"']+)["']/i);
    if (!href) continue;
    // Bigger icons score better.
    const px = sizes ? parseInt(sizes.split("x")[0], 10) || 0 : 0;
    out.push({ url: absolutise(href, baseUrl), source: "apple-touch-icon", priority: 3 + Math.max(0, 200 - px) / 100 });
  }

  // 4. High-res favicon variants.
  const iconLinks = matchAllAttrs(html, /<link[^>]+rel=["'](?:icon|shortcut icon|fluid-icon|mask-icon)["'][^>]*>/gi);
  for (const tag of iconLinks) {
    const href = matchAttr(tag, /href=["']([^"']+)["']/i);
    const sizes = matchAttr(tag, /sizes=["']([^"']+)["']/i);
    if (!href) continue;
    // Skip favicons below 64×64.
    const px = sizes ? parseInt(sizes.split("x")[0], 10) || 0 : 0;
    if (px > 0 && px < 64) continue;
    out.push({ url: absolutise(href, baseUrl), source: "favicon-hires", priority: 5 + Math.max(0, 256 - px) / 100 });
  }

  // 5. First plausible <img> inside <header>/<nav> — the navbar logo.
  //    Many sites use a clean SVG/PNG of the wordmark here.
  const navMatch = html.match(/<header[\s\S]{0,4000}?<\/header>|<nav[\s\S]{0,4000}?<\/nav>/i);
  if (navMatch) {
    const imgMatch = navMatch[0].match(/<img[^>]+>/gi) || [];
    for (const tag of imgMatch.slice(0, 3)) {
      const src = matchAttr(tag, /src=["']([^"']+)["']/i);
      if (!src) continue;
      // Skip data URIs (almost always tiny placeholders) and any image
      // that looks like a tracking pixel.
      if (src.startsWith("data:")) continue;
      if (/pixel|track|beacon|sprite/i.test(src)) continue;
      out.push({ url: absolutise(src, baseUrl), source: "header-img", priority: 4 });
    }
  }

  // De-dup by URL, keep best-priority entry.
  const bestByUrl = new Map<string, LogoCandidate>();
  for (const c of out) {
    const existing = bestByUrl.get(c.url);
    if (!existing || c.priority < existing.priority) bestByUrl.set(c.url, c);
  }
  return [...bestByUrl.values()].sort((a, b) => a.priority - b.priority);
}

function extractJsonLdBlocks(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function extractSchemaLogos(jsonld: string): string[] {
  try {
    const data = JSON.parse(jsonld);
    const out: string[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node.logo === "string") out.push(node.logo);
      else if (node.logo && typeof node.logo === "object" && typeof node.logo.url === "string") out.push(node.logo.url);
      if (Array.isArray((node as any)["@graph"])) walk((node as any)["@graph"]);
    };
    walk(data);
    return out;
  } catch {
    return [];
  }
}

// ─── Image download + sanity check ──────────────────────────────────────

async function downloadImage(url: string): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/*,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/png";
    if (!ct.toLowerCase().startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    return { buffer: buf, mime: ct };
  } catch {
    return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function matchAttr(haystack: string, re: RegExp): string | null {
  const m = haystack.match(re);
  return m && m[1] ? m[1] : null;
}

function matchAllAttrs(haystack: string, re: RegExp): string[] {
  return haystack.match(re) || [];
}

function absolutise(href: string, baseUrl: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

// ─── Hero / body image candidates ───────────────────────────────────────

interface HeroCandidate {
  url: string;
  priority: number;       // lower = better
  width?: number;
  height?: number;
  alt?: string;
}

// Pick body images that look like editorial / product / building hero
// shots. Skip:
//   - Anything in <header>/<nav> (that's the logo, already handled)
//   - Data URIs (placeholders, base64 thumbs)
//   - SVGs (icons / logos, rarely hero material)
//   - Anything with width/height < 400px declared
//   - Tracking pixels (alt names like "pixel", "track", "beacon", "sprite")
function collectHeroCandidates(html: string, baseUrl: string): HeroCandidate[] {
  // Strip header/nav so their images don't sneak into hero results.
  const body = html
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  const out: HeroCandidate[] = [];

  // og:image counts as a hero candidate too — many sites set it to a
  // marketing shot rather than a logo.
  const og = matchAttr(html, /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i);
  if (og) {
    out.push({ url: absolutise(og, baseUrl), priority: 1 });
  }

  // Walk every <img> tag in the body.
  const imgRe = /<img\b([^>]+)>/gi;
  let m;
  let order = 0;
  while ((m = imgRe.exec(body)) !== null) {
    order++;
    const attrs = m[1];
    const src = matchAttr(attrs, /(?:^|\s)src=["']([^"']+)["']/i)
      || matchAttr(attrs, /(?:^|\s)data-src=["']([^"']+)["']/i)
      || matchAttr(attrs, /(?:^|\s)data-original=["']([^"']+)["']/i);
    if (!src) continue;
    if (src.startsWith("data:")) continue;
    if (/\.svg(\?|$)/i.test(src)) continue;
    if (/pixel|track|beacon|sprite|logo|icon|avatar|favicon/i.test(src)) continue;

    const widthStr = matchAttr(attrs, /(?:^|\s)width=["']?(\d+)/i);
    const heightStr = matchAttr(attrs, /(?:^|\s)height=["']?(\d+)/i);
    const w = widthStr ? parseInt(widthStr, 10) : undefined;
    const h = heightStr ? parseInt(heightStr, 10) : undefined;
    if (w && w < 400) continue;
    if (h && h < 250) continue;

    const alt = matchAttr(attrs, /(?:^|\s)alt=["']([^"']*)["']/i) || undefined;

    // Earlier-in-page images are usually hero / above-the-fold. Priority
    // is order-based with a tiny bonus for declared dimensions.
    const priority = 10 + order - (w && w >= 800 ? 2 : 0) - (h && h >= 500 ? 1 : 0);
    out.push({
      url: absolutise(src, baseUrl),
      priority,
      width: w,
      height: h,
      alt: alt?.trim() || undefined,
    });
  }

  return out.sort((a, b) => a.priority - b.priority);
}
