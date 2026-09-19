export type CompanyImageKind = "brand" | "landlord";

export interface CompanyImageCandidate {
  url: string;
  pageUrl: string;
  caption?: string;
  width?: number;
  height?: number;
}

const TAG = /<(meta|img|source|[a-z][\w:-]*)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;

function decodeHtml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
    }
    return ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " } as Record<string, string>)[code.toLowerCase()] || entity;
  });
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    out[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return out;
}

/** Syntactic URL guard; network callers still own DNS and redirect checks. */
export function isPublicImageSourceUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return /^(https?:)$/.test(url.protocol) && !url.username && !url.password && !url.port
      && /^[a-z\d.-]+\.[a-z]{2,}$/i.test(host)
      && !/(^|\.)(localhost|local|internal|invalid|test|onion)$/.test(host);
  } catch { return false; }
}

function imageUrl(raw: string, base: string): string | null {
  if (!raw || /^(?:data|blob|javascript):/i.test(raw.trim())) return null;
  try {
    const url = new URL(decodeHtml(raw).trim(), base);
    url.hash = "";
    return isPublicImageSourceUrl(url.href) ? url.href : null;
  } catch { return null; }
}

function srcsetCandidates(value: string, renderedWidth?: number): Array<{ url: string; width?: number; rank: number }> {
  // The descriptor determines size: CMSes do not necessarily sort their sets.
  const out: Array<{ url: string; width?: number; rank: number }> = [];
  let position = 0;
  while (position < value.length) {
    while (/[\s,]/.test(value[position] || "") && position < value.length) position++;
    const start = position;
    while (position < value.length && !/\s/.test(value[position])) position++;
    const token = value.slice(start, position);
    if (!token) break;
    let descriptor = "";
    if (!token.endsWith(",")) {
      const descriptorStart = position;
      while (position < value.length && value[position] !== ",") position++;
      descriptor = value.slice(descriptorStart, position).trim();
    }
    const sizeMatch = descriptor.match(/^(\d*\.?\d+)(w|x)$/i);
    if (descriptor && !sizeMatch) continue;
    const size = Number(sizeMatch?.[1]);
    const width = sizeMatch?.[2].toLowerCase() === "w" ? size : renderedWidth && size ? renderedWidth * size : undefined;
    out.push({ url: token.replace(/,+$/, ""), width, rank: width || (size ? size * 1000 : 0) });
  }
  return out.sort((a, b) => b.rank - a.rank);
}

function usefulPhotography(url: string, caption: string, kind: CompanyImageKind): boolean {
  const parsed = new URL(url);
  let filename = parsed.pathname.split("/").pop() || "";
  try { filename = decodeURIComponent(filename); } catch { /* Keep the original filename. */ }
  const clue = `${filename} ${caption}`.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  if (/\.(?:svg|gif|ico)(?:$|\?)/i.test(parsed.pathname)) return false;
  if (/(?:^|[^a-z])(logos?\d*x?|favicon|sprites?|icons?|placeholder|spacer|pixel|tracking|1x1|loader|spinner|social[-_ ]?card|og[-_ ]?default)(?:$|[^a-z])/i.test(clue)) return false;
  if (/(?:^|[^a-z])(voucher|coupon|gift[-_ ]?card|product[-_ ]?(?:shot|pack)|packshot|size[-_ ]?guide|qr[-_ ]?code|app[-_ ]?store|google[-_ ]?play|payment[-_ ]?(?:methods?|icons?)|sale[-_ ]?banner|promo[-_ ]?banner)(?:$|[^a-z])/i.test(clue)) return false;
  if (/(?:^|[^a-z])(headshot|portrait|chart|graph|infographic|annual[-_ ]?report|results[-_ ]?presentation|press[-_ ]?release|board[-_ ]?member|director[-_ ]?profile)(?:$|[^a-z])/i.test(clue)) return false;
  if (/(?:^|[^a-z])(?:top[-_ ]?nav|navigation|footer)(?:$|[^a-z])/i.test(clue)) return false;
  if (kind === "landlord" && /\/(?:investors?|board|leadership)\//i.test(parsed.pathname)) return false;
  return true;
}

/** Collect all useful candidates before ranking/capping, so header assets cannot fill the gallery. */
export function extractCompanyImageCandidates(html: string, pageUrl: string, options: { kind?: CompanyImageKind; limit?: number } = {}): CompanyImageCandidate[] {
  if (!isPublicImageSourceUrl(pageUrl)) return [];
  const kind = options.kind || "brand";
  const candidates = new Map<string, CompanyImageCandidate & { score: number; order: number }>();
  let order = 0;
  const add = (raw: string | undefined, caption = "", width?: number, height?: number, priority = 0) => {
    if (!raw) return false;
    const url = imageUrl(raw, pageUrl);
    if (!url || !usefulPhotography(url, caption, kind)) return false;
    if (width && height && (Math.max(width, height) < 480 || Math.min(width, height) < 240)) return false;
    const photoClue = /(?:storefront|shopfront|interior|exterior|flagship|restaurant|shopping[-_ ]?(?:centre|center)|portfolio|property|building|facade|our[-_ ]?places)/i.test(`${url} ${caption}`);
    const score = priority + (photoClue ? 40 : 0) + Math.min(20, (width || 0) / 100);
    const prev = candidates.get(url);
    if (!prev || prev.score < score) candidates.set(url, { url, pageUrl, caption: caption || undefined, width, height, score, order: prev?.order ?? order++ });
    return true;
  };
  // Script strings can contain marketing templates which are not images on this page.
  const document = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(nav|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    // Global headers often carry dozens of small menu photos. Keep a simple
    // editorial hero header, but remove a header used as site navigation.
    .replace(/<header\b[^>]*>[\s\S]*?<\/header\s*>/gi, header => (header.match(/<a\b/gi)?.length ?? 0) >= 3 ? "" : header);
  const documentLower = document.toLowerCase();
  const imageLinks = [...document.matchAll(/<a\b((?:[^<>"']|"[^"]*"|'[^']*')*)>[\s\S]*?<\/a\s*>/gi)].map(match => ({
    start: match.index, end: match.index + match[0].length, href: attributes(match[1]).href || "",
  }));
  const tags = [...document.matchAll(TAG)];
  for (const match of tags) {
    const type = match[1].toLowerCase();
    const attrs = attributes(match[0]);
    if (type === "meta" && /^(?:og:image(?::url|:secure_url)?|twitter:image(?::src)?)$/i.test(attrs.property || attrs.name || "")) {
      add(attrs.content, "", undefined, undefined, 10);
      continue;
    }
    if (type === "img" || type === "source") {
      const imageLink = imageLinks.find(link => link.start < (match.index ?? 0) && link.end > (match.index ?? 0));
      // Some sites leave photo filenames and alt text uninformative. A photo
      // linking to the company's shops/portfolio is still a useful lead and
      // should outrank an ecommerce product grid before the candidate cap.
      const venueLink = /(?:^|\/)(?:shops?|stores?|locations?|venues?|portfolio|properties|our-places)(?:\/|$|\?)/i.test(imageLink?.href || "");
      const priority = venueLink ? 40 : 0;
      const pictureStart = type === "source" ? documentLower.lastIndexOf("<picture", match.index) : -1;
      const pictureEnd = pictureStart >= 0 ? documentLower.indexOf("</picture", pictureStart) : -1;
      const pictureImg = type === "source" && pictureStart > documentLower.lastIndexOf("</picture", match.index) && pictureEnd > (match.index || 0)
        ? document.slice(pictureStart, pictureEnd).match(/<img\b(?:[^<>"']|"[^"]*"|'[^']*')*>/i)?.[0] : undefined;
      const pictureAttrs = pictureImg ? attributes(pictureImg) : {};
      const caption = (attrs.alt || attrs.title || pictureAttrs.alt || pictureAttrs.title || "").trim();
      const width = /^\d+$/.test(attrs.width || "") ? Number(attrs.width) : undefined;
      const height = /^\d+$/.test(attrs.height || "") ? Number(attrs.height) : undefined;
      if (width && height && width <= 2 && height <= 2) continue;
      const responsive = [attrs["data-srcset"], attrs["data-lazy-srcset"], attrs.srcset].filter(Boolean)
        .flatMap(value => srcsetCandidates(value, width)).sort((a, b) => b.rank - a.rank);
      let found = false;
      for (const image of responsive) {
        const actualHeight = image.width && width && height ? height * image.width / width : undefined;
        if (add(image.url, caption, image.width, actualHeight, priority)) { found = true; break; }
      }
      if (!found) {
        // Lazy attributes beat a low-resolution/transparent src placeholder.
        for (const name of ["data-original", "data-src", "data-lazy-src", "data-image", "src"]) {
          if (add(attrs[name], caption, undefined, undefined, priority)) break;
        }
      }
    }
    const caption = attrs["aria-label"] || attrs.title || "";
    for (const name of ["data-bg", "data-background", "data-background-image", "data-hero", "data-image-src"]) add(attrs[name], caption);
    for (const background of (attrs.style || "").matchAll(/background(?:-image)?\s*:[^;]*?url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/gi)) {
      add(background[1] || background[2] || background[3], caption);
    }
  }
  for (const style of document.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    for (const background of decodeHtml(style[1]).matchAll(/background(?:-image)?\s*:[^;{}]*?url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/gi)) {
      add(background[1] || background[2] || background[3]);
    }
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.max(0, options.limit ?? 30)).map(({ score, order, ...image }) => image);
}

export function extractCompanyImageUrls(html: string, pageUrl: string, limit = 30, kind: CompanyImageKind = "brand"): string[] {
  return extractCompanyImageCandidates(html, pageUrl, { limit, kind }).map(image => image.url);
}

export function companyPhotographyPageKey(raw: string): string {
  const url = new URL(raw);
  return url.hostname.toLowerCase().replace(/^www\./, "") + url.pathname.replace(/\/+$/, "") + url.search;
}

/** Follow observed store/asset links only on the official host, never a search result or external venue. */
export function discoverCompanyPhotographyPages(html: string, pageUrl: string, options: { kind?: CompanyImageKind; limit?: number } = {}): string[] {
  if (!isPublicImageSourceUrl(pageUrl)) return [];
  const base = new URL(pageUrl);
  const host = base.hostname.toLowerCase().replace(/^www\./, "");
  const kind = options.kind || "brand";
  const candidates = new Map<string, { url: string; score: number }>();
  for (const match of html.matchAll(/<a\b((?:[^<>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a\s*>/gi)) {
    const attrs = attributes(match[1]);
    const href = imageUrl(attrs.href || "", pageUrl);
    if (!href) continue;
    const url = new URL(href);
    if (url.hostname.toLowerCase().replace(/^www\./, "") !== host || companyPhotographyPageKey(url.href) === companyPhotographyPageKey(base.href)) continue;
    if (/\.(?:pdf|jpe?g|png|webp|svg|zip|mp4|css|js)$/i.test(url.pathname)) continue;
    const label = decodeHtml(match[2].replace(/<[^>]+>/g, " ")).trim();
    const clue = `${url.pathname} ${label} ${attrs.title || ""}`;
    if (/(?:^|[/\s_-])(?:login|sign-in|account|checkout|cart|privacy|terms|careers|jobs|investors?|board|leadership)(?:$|[/\s_-])/i.test(clue)) continue;
    if (kind === "brand" && /^\/(?:menu|products?|collections?)\//i.test(url.pathname)) continue;
    const venues = kind === "landlord"
      ? /(?:^|[^a-z])(?:portfolio|propert(?:y|ies)|assets?|our[-_ ]?places|destinations?|shopping[-_ ]?(?:centres?|centers?)|retail[-_ ]?parks?|campus)(?:$|[^a-z])/i
      : /(?:^|[^a-z])(?:stores?|shops?|locations?|venues?|restaurants?|cafes?|showrooms?|gyms?|hotels?|flagships?)(?:$|[^a-z])/i;
    const venuePath = venues.test(url.pathname);
    const isVenue = venuePath || venues.test(clue);
    if (!isVenue && !/(?:^|[^a-z])(?:press|media|newsroom)(?:$|[^a-z])/i.test(clue)) continue;
    const depth = url.pathname.split("/").filter(Boolean).length;
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    const key = companyPhotographyPageKey(url.href);
    const score = (venuePath ? 40 : isVenue ? 20 : 0) + Math.min(depth, 4);
    if (!candidates.has(key) || candidates.get(key)!.score < score) candidates.set(key, { url: url.href, score });
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, Math.max(0, options.limit ?? 6)).map(candidate => candidate.url);
}
