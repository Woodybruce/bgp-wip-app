// Scrape the highest-quality logo (and a small set of hero images) from
// a company's own homepage. Most retailer sites publish their brand
// logo in plain HTML — Open Graph, apple-touch-icon, schema.org JSON-LD,
// or as the first <img> in the <header>/<nav>. That's almost always
// better than what logo.dev / Google favicons hand back, but we never
// looked.
//
// Used as the FIRST source in fetchLogoForDomain (server/bulk-brand-logos.ts)
// before falling through to logo.dev → Google favicons. Failures here are
// silent — the next source picks up.

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const FETCH_TIMEOUT_MS = 8000;

export interface ScrapedLogo {
  buffer: Buffer;
  mime: string;
  source: "og" | "apple-touch-icon" | "schema" | "header-img" | "favicon-hires";
  url: string;
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
