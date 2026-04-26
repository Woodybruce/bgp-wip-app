import { db } from "./db";
import { externalRequirements } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { ScraperSession, isScraperApiAvailable } from "./utils/scraperapi";

const TRL_BASE = "https://www.therequirementlist.com";
const MEMBERSTACK_SITE_ID = process.env.TRL_SITE_ID || "71a8cd36166fbac3ef4f574f428d449b";

// Sticky ScraperAPI session for the entire TRL scrape — keeps the
// Memberstack auth cookie + Webflow session valid across the directory
// pagination + per-agency page loads. Without sticky sessions every
// request would hit a different upstream IP and TRL's Webflow stack
// would either re-issue a fresh anonymous session or rate-limit hard.
let scraperSession: ScraperSession | null = null;
function trlFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isScraperApiAvailable()) return fetch(url, init);
  if (!scraperSession) scraperSession = new ScraperSession();
  return scraperSession.fetch(url, init);
}
/** Reset between scrapes so a stale session number doesn't outlive the data. */
export function resetTrlSession() {
  scraperSession = null;
}

function getTrlToken(): string {
  const token = process.env.TRL_TOKEN;
  if (!token) throw new Error("TRL_TOKEN environment variable is not set. Please set it with a valid Memberstack JWT token.");
  return token;
}

function extractText(html: string, labelPattern: string): string | null {
  const labelRegex = new RegExp(labelPattern, "i");
  const labelIdx = html.search(labelRegex);
  if (labelIdx === -1) return null;
  const after = html.substring(labelIdx, labelIdx + 800);
  const valueMatch = after.match(/class="text-300[^"]*"[^>]*>([^<]+)</) ||
    after.match(/class="[^"]*text-size-small[^"]*"[^>]*>([^<]+)</) ||
    after.match(/class="[^"]*paragraph[^"]*"[^>]*>([^<]+)</) ||
    after.match(/<div[^>]*>([^<]{2,})<\/div>/);
  if (!valueMatch || !valueMatch[1]) return null;
  const val = valueMatch[1].trim().replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  if (val.length < 1 || val === "—" || val === "-") return null;
  return val;
}

function extractContactBlock(html: string): {
  name: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
} {
  const contactSection = html.match(/Contact\(s\)[\s\S]*?(?=Requirements Overview|$)/i);
  if (!contactSection) return { name: null, title: null, phone: null, email: null };
  const section = contactSection[0];

  const nameMatch = section.match(/<strong>([^<]+)<\/strong>/) ||
    section.match(/heading-h3-size[^>]*>([^<]+)/);
  const titleMatch = section.match(/class="text-300 medium mg-bottom-24px"[^>]*>([^<]+)/);
  const phoneMatch = section.match(/Phone Number[\s\S]*?class="text-300[^"]*"[^>]*>([^<]+)/) ||
    section.match(/((?:\+44|0)\d[\d\s]{8,})/);
  const emailMatch = section.match(/Email Address[\s\S]*?class="text-300[^"]*"[^>]*>([^<]+)/) ||
    section.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);

  return {
    name: nameMatch ? nameMatch[1].trim().replace(/&amp;/g, "&") : null,
    title: titleMatch ? titleMatch[1].trim().replace(/&amp;/g, "&") : null,
    phone: phoneMatch ? phoneMatch[1].trim() : null,
    email: emailMatch ? emailMatch[1].trim() : null,
  };
}

export async function scrapeTrlPage(url: string): Promise<{
  companyName: string;
  contact: { name: string | null; title: string | null; phone: string | null; email: string | null };
  tenure: string | null;
  sizeRange: string | null;
  useClass: string | null;
  pitch: string | null;
  locations: string[];
  mappedUse: string[];
  lastUpdated: string | null;
  description: string | null;
  logo: string | null;
} | null> {
  try {
    if (!url.startsWith("https://www.therequirementlist.com/")) {
      throw new Error("URL must be from therequirementlist.com");
    }
    const token = getTrlToken();
    const cookie = `__ms_${MEMBERSTACK_SITE_ID}=${token}`;
    const res = await trlFetch(url, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    if (!res.ok) return null;
    const html = await res.text();

    const companyMatch = html.match(
      /class="heading-h2-size[^"]*"[^>]*>([^<]+)</
    );
    if (!companyMatch) return null;
    const companyName = companyMatch[1].trim().replace(/&amp;/g, "&").replace(/&#x27;/g, "'");

    const contact = extractContactBlock(html);
    const reqOverviewIdx = html.indexOf("Requirements Overview");
    const reqSection = reqOverviewIdx >= 0 ? html.substring(reqOverviewIdx) : html;
    const tenure = extractText(reqSection, ">Tenure<");
    const sizeRange = extractText(reqSection, ">size \\(sqft\\)<|>Size<");
    const useClass = extractText(reqSection, ">use class<|>Use Class<");
    const pitch = extractText(reqSection, ">pitch<|>Pitch<");
    const lastUpdated = extractText(reqSection, ">last updated<|>Last Updated<");

    const descMatch = html.match(
      /class="text-block-98"[^>]*>(?:&quot;|")?([^<]+?)(?:&quot;|")?</
    );
    const description = descMatch
      ? descMatch[1].trim().replace(/&amp;/g, "&").replace(/&quot;/g, "")
      : null;

    const logoMatch = html.match(/class="[^"]*(?:brand-logo|company-single-about-logo)[^"]*"[^>]*src="([^"]+)"/) ||
      html.match(/src="([^"]+)"[^>]*class="[^"]*(?:brand-logo|company-single-about-logo)[^"]*"/);
    const logo = logoMatch ? logoMatch[1] : null;

    const sectors: string[] = [];
    const sectorIdx = html.search(/Sectors/i);
    if (sectorIdx >= 0) {
      const sectorSection = html.substring(sectorIdx, sectorIdx + 1000);
      const sectorRe = /class="text-300[^"]*"[^>]*>([^<]+)</g;
      let sm;
      while ((sm = sectorRe.exec(sectorSection)) !== null) {
        const v = sm[1].trim().replace(/&amp;/g, "&");
        if (v && v.length > 1 && v !== "," && v !== ".") sectors.push(v);
      }
    }

    const VALID_LOCATIONS = new Set([
      "clapham", "east anglia", "ireland", "london", "midlands",
      "n. ireland", "national", "north east", "north west",
      "scotland", "south east", "south west", "wales",
    ]);
    const LOCATION_NORMALIZE: Record<string, string> = {
      "clapham": "Clapham", "east anglia": "East Anglia", "ireland": "Ireland",
      "london": "London", "midlands": "Midlands", "n. ireland": "N. Ireland",
      "national": "National", "north east": "North East", "north west": "North West",
      "scotland": "Scotland", "south east": "South East", "south west": "South West",
      "wales": "Wales",
    };

    const locationMatches: string[] = [];
    const locSection = html.match(/locations[\s\S]*?(?=last updated|Last Updated|Q&amp;A|$)/i);
    if (locSection) {
      const locRegex = /class="text-300[^"]*"[^>]*>([^<]+)</g;
      let locMatch;
      while ((locMatch = locRegex.exec(locSection[0])) !== null) {
        if (locMatch[1]) {
          const loc = locMatch[1].trim().replace(/&amp;/g, "&").toLowerCase();
          if (VALID_LOCATIONS.has(loc)) {
            locationMatches.push(LOCATION_NORMALIZE[loc]);
          }
        }
      }
    }

    const USE_KEYWORDS: [RegExp, string][] = [
      [/restaurant/i, "Restaurant"],
      [/cafe|coffee|bakery/i, "Restaurant"],
      [/food|diner|kebab|pizza|burger|chicken|sushi/i, "A1 Food"],
      [/gym|fitness/i, "Gym"],
      [/padel|spa|pool|sauna/i, "Leisure"],
      [/leisure/i, "Leisure"],
      [/wellness/i, "Wellness"],
      [/retail|shop|store|high street|roadside|retail park/i, "Retail"],
    ];
    function inferUse(text: string): string[] {
      const found = new Set<string>();
      for (const [re, cat] of USE_KEYWORDS) {
        if (re.test(text)) found.add(cat);
      }
      return [...found];
    }
    let mappedUse: string[] = [];
    if (sectors.length > 0) mappedUse = inferUse(sectors.join(" "));
    if (mappedUse.length === 0 && pitch) mappedUse = inferUse(pitch);
    if (mappedUse.length === 0 && useClass) mappedUse = inferUse(useClass);
    if (mappedUse.length === 0 && description) mappedUse = inferUse(description);

    return {
      companyName,
      contact,
      tenure,
      sizeRange,
      useClass,
      pitch,
      locations: locationMatches,
      mappedUse,
      lastUpdated,
      description,
      logo,
    };
  } catch (err) {
    console.error(`TRL scrape error for ${url}:`, err);
    return null;
  }
}

export async function importTrlRequirement(url: string): Promise<string | null> {
  const data = await scrapeTrlPage(url);
  if (!data) return null;

  const existing = await db
    .select()
    .from(externalRequirements)
    .where(
      and(
        eq(externalRequirements.source, "TRL"),
        eq(externalRequirements.companyName, data.companyName)
      )
    )
    .limit(1);

  const record = {
    source: "TRL" as const,
    sourceUrl: url,
    companyName: data.companyName,
    companyLogo: data.logo,
    contactName: data.contact.name,
    contactTitle: data.contact.title,
    contactPhone: data.contact.phone,
    contactEmail: data.contact.email,
    tenure: data.tenure,
    sizeRange: data.sizeRange,
    useClass: data.useClass,
    pitch: data.pitch,
    locations: data.locations.length > 0 ? data.locations : null,
    lastUpdated: data.lastUpdated,
    description: data.description,
    status: "active",
    rawData: data as any,
    updatedAt: new Date(),
  };

  if (existing.length > 0) {
    await db
      .update(externalRequirements)
      .set(record)
      .where(eq(externalRequirements.id, existing[0].id));
    return existing[0].id;
  }

  const [inserted] = await db
    .insert(externalRequirements)
    .values(record)
    .returning({ id: externalRequirements.id });
  return inserted.id;
}

export const KNOWN_TRL_PAGES = [
  "/gdk-german-doner-kebab-property-requirements-25",
  "/padel-land-property-requirements",
  "/amber-taverns-property-requirements",
  "/drive-thru-property-requirements",
  "/popeyes-property-requirements",
  "/five-guys-property-requirements",
  "/nandos-property-requirements",
  "/pret-a-manger-property-requirements",
  "/costa-coffee-property-requirements",
  "/greggs-property-requirements",
  "/taco-bell-property-requirements",
  "/subway-property-requirements",
  "/leon-property-requirements",
  "/tim-hortons-property-requirements",
  "/pizza-hut-property-requirements",
  "/jollibee-property-requirements",
  "/tortilla-property-requirements",
  "/wendy-s-property-requirements",
  "/popeye-s-property-requirements",
  "/starbucks-property-requirements",
  "/mcdonalds-property-requirements",
  "/burger-king-property-requirements",
  "/kfc-property-requirements",
  "/dominos-property-requirements",
  "/wingstop-property-requirements",
  "/the-gym-group-property-requirements",
  "/pure-gym-property-requirements",
  "/anytime-fitness-property-requirements",
  "/jd-sports-property-requirements",
  "/sports-direct-property-requirements",
  "/screwfix-property-requirements",
  "/toolstation-property-requirements",
  "/aldi-property-requirements",
  "/lidl-property-requirements",
  "/b-and-m-property-requirements",
  "/home-bargains-property-requirements",
  "/savers-property-requirements",
  "/iceland-property-requirements",
  "/one-stop-property-requirements",
  "/spar-property-requirements",
].map((p) => TRL_BASE + p);

export async function importAllTrlRequirements(): Promise<{
  imported: number;
  failed: number;
  errors: string[];
}> {
  let imported = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const url of KNOWN_TRL_PAGES) {
    try {
      const id = await importTrlRequirement(url);
      if (id) {
        imported++;
      } else {
        failed++;
        errors.push(`No data extracted from ${url}`);
      }
    } catch (err: any) {
      failed++;
      errors.push(`${url}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return { imported, failed, errors };
}

export interface TrlDirectoryCompany {
  name: string;
  slug: string;
  url: string;
  type: "occupier" | "agency";
}

export interface TrlAgencyContact {
  name: string;
  phone: string | null;
  email: string | null;
  title: string | null;
  agencySlug: string;
  agencyName: string;
}

export async function scrapeTrlOccupierDirectory(): Promise<TrlDirectoryCompany[]> {
  const token = getTrlToken();
  const cookie = `__ms_${MEMBERSTACK_SITE_ID}=${token}`;
  const companies: TrlDirectoryCompany[] = [];
  let page = 1;
  let pageKey: string | null = null;
  let totalPages = 50;

  while (page <= totalPages) {
    const url = page === 1
      ? `${TRL_BASE}/features/occupier-directory`
      : `${TRL_BASE}/features/occupier-directory?${pageKey}=${page}`;
    const res = await trlFetch(url, { headers: { Cookie: cookie }, redirect: "follow" });
    if (!res.ok) break;
    const html = await res.text();

    if (page === 1) {
      const keyMatch = html.match(/\?([a-f0-9]+_page)=2/);
      if (keyMatch) pageKey = keyMatch[1];
      else pageKey = "page";
      const totalMatch = html.match(/Page \d+ of (\d+)/);
      if (totalMatch) totalPages = parseInt(totalMatch[1], 10);
    }

    const linkRe = /href="\/property-requirements\/([^"]+)"/g;
    let m;
    let foundNew = false;
    while ((m = linkRe.exec(html)) !== null) {
      const slug = m[1];
      if (!companies.find(c => c.slug === slug)) {
        const nameIdx = html.lastIndexOf("heading-h", m.index);
        let name = slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        if (nameIdx > m.index - 500 && nameIdx < m.index) {
          const nameMatch = html.substring(nameIdx).match(/heading-h[34][^"]*"[^>]*>([^<]+)/);
          if (nameMatch) name = nameMatch[1].trim().replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
        }
        companies.push({ name, slug, url: `${TRL_BASE}/property-requirements/${slug}`, type: "occupier" });
        foundNew = true;
      }
    }

    if (!foundNew) break;
    page++;
    await new Promise(r => setTimeout(r, 300));
  }

  return companies;
}

export async function scrapeTrlAgencyListing(): Promise<TrlDirectoryCompany[]> {
  const token = getTrlToken();
  const cookie = `__ms_${MEMBERSTACK_SITE_ID}=${token}`;
  const companies: TrlDirectoryCompany[] = [];
  let page = 1;
  let pageKey: string | null = null;
  let totalPages = 50;

  while (page <= totalPages) {
    const url = page === 1
      ? `${TRL_BASE}/features/agency-directory`
      : `${TRL_BASE}/features/agency-directory?${pageKey}=${page}`;
    const res = await trlFetch(url, { headers: { Cookie: cookie }, redirect: "follow" });
    if (!res.ok) break;
    const html = await res.text();

    if (page === 1) {
      const keyMatch = html.match(/\?([a-f0-9]+_page)=2/);
      if (keyMatch) pageKey = keyMatch[1];
      else pageKey = "page";
      const totalMatch = html.match(/Page \d+ of (\d+)/);
      if (totalMatch) totalPages = parseInt(totalMatch[1], 10);
    }

    const linkRe = /href="\/agency\/([^"]+)"/g;
    let m;
    let foundNew = false;
    while ((m = linkRe.exec(html)) !== null) {
      const slug = m[1];
      if (!companies.find(c => c.slug === slug)) {
        const name = slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        companies.push({ name, slug, url: `${TRL_BASE}/agency/${slug}`, type: "agency" });
        foundNew = true;
      }
    }

    console.log(`[TRL Agency] Page ${page}/${totalPages}: found ${companies.length} agencies so far`);
    if (!foundNew) break;
    page++;
    await new Promise(r => setTimeout(r, 200));
  }

  return companies;
}

export async function scrapeTrlAgencyDetailPage(slug: string): Promise<{ name: string; contacts: TrlAgencyContact[] }> {
  const token = getTrlToken();
  const cookie = `__ms_${MEMBERSTACK_SITE_ID}=${token}`;
  const url = `${TRL_BASE}/agency/${slug}`;
  const contacts: TrlAgencyContact[] = [];

  const res = await trlFetch(url, { headers: { Cookie: cookie }, redirect: "follow" });
  if (!res.ok) return { name: slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()), contacts: [] };
  const html = await res.text();

  const nameMatch = html.match(/class="heading-h2[^"]*"[^>]*>([^<]+)/);
  const name = nameMatch
    ? nameMatch[1].trim().replace(/&amp;/g, "&").replace(/&#x27;/g, "'")
    : slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  const contactCardRe = /heading-h4-size[^"]*"[^>]*>([^<]+)[\s\S]*?(?=heading-h4-size|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>)/g;
  let cm;
  while ((cm = contactCardRe.exec(html)) !== null) {
    const contactName = cm[1].trim().replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
    if (!contactName || contactName.length < 3) continue;

    const block = cm[0];
    const emailMatch = block.match(/mailto:([^"]+)/);
    const phoneBlock = block.match(/Phone Number[\s\S]*?class="text-300[^"]*"[^>]*>([^<]+)/);
    const titleBlock = block.match(/>Title<[\s\S]*?class="text-300[^"]*"[^>]*>([^<]+)/);

    let phone = phoneBlock ? phoneBlock[1].trim() : null;
    if (phone && phone.includes("@")) phone = null;

    contacts.push({
      name: contactName,
      email: emailMatch ? emailMatch[1].trim() : null,
      phone,
      title: titleBlock ? titleBlock[1].trim() : null,
      agencySlug: slug,
      agencyName: name,
    });
  }

  return { name, contacts };
}

export async function scrapeTrlAgencyDirectory(): Promise<{ companies: TrlDirectoryCompany[]; contacts: TrlAgencyContact[] }> {
  const companies = await scrapeTrlAgencyListing();
  const contacts: TrlAgencyContact[] = [];

  console.log(`[TRL Agency] Scraping ${companies.length} agency detail pages for contacts...`);
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    try {
      const detail = await scrapeTrlAgencyDetailPage(company.slug);
      company.name = detail.name;
      contacts.push(...detail.contacts);
      if ((i + 1) % 25 === 0) console.log(`[TRL Agency] Processing ${i + 1}/${companies.length}: ${company.name}`);
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`TRL agency scrape error for ${company.url}:`, err);
    }
  }

  return { companies, contacts };
}

export async function scrapeTrlRequirementSearch(): Promise<{ slug: string; url: string }[]> {
  const token = getTrlToken();
  const cookie = `__ms_${MEMBERSTACK_SITE_ID}=${token}`;
  const results: { slug: string; url: string }[] = [];
  let page = 1;
  let pageKey: string | null = null;
  let totalPages = 50;

  while (page <= totalPages) {
    const url = page === 1
      ? `${TRL_BASE}/features/requirement-search`
      : `${TRL_BASE}/features/requirement-search?${pageKey}=${page}`;
    const res = await trlFetch(url, { headers: { Cookie: cookie }, redirect: "follow" });
    if (!res.ok) break;
    const html = await res.text();

    if (page === 1) {
      const keyMatch = html.match(/\?([a-f0-9]+_page)=2/);
      if (keyMatch) pageKey = keyMatch[1];
      else pageKey = "page";
      const totalMatch = html.match(/Page \d+ of (\d+)/);
      if (totalMatch) totalPages = parseInt(totalMatch[1], 10);
    }

    const linkRe = /href="\/property-requirements\/([^"]+)"/g;
    let m;
    let foundNew = false;
    while ((m = linkRe.exec(html)) !== null) {
      const slug = m[1];
      if (!results.find(r => r.slug === slug)) {
        results.push({ slug, url: `${TRL_BASE}/property-requirements/${slug}` });
        foundNew = true;
      }
    }

    console.log(`[TRL Req Search] Page ${page}/${totalPages}: ${results.length} unique requirements`);
    if (!foundNew) break;
    page++;
    await new Promise(r => setTimeout(r, 300));
  }

  return results;
}

export async function discoverTrlPages(): Promise<string[]> {
  try {
    const token = getTrlToken();
    const cookie = `__ms_${MEMBERSTACK_SITE_ID}=${token}`;
    const allLinks: string[] = [];

    const sources = [
      `${TRL_BASE}/features/requirement-search`,
      `${TRL_BASE}/propertyrequirements`,
      `${TRL_BASE}/features/occupier-directory`,
    ];

    for (const sourceUrl of sources) {
      let page = 1;
      let pageKey: string | null = null;
      let totalPages = 50;
      while (page <= totalPages) {
        const pageUrl = page === 1 ? sourceUrl : `${sourceUrl}?${pageKey}=${page}`;
        const res = await trlFetch(pageUrl, {
          headers: { Cookie: cookie },
          redirect: "follow",
        });
        if (!res.ok) break;
        const html = await res.text();

        if (page === 1) {
          const keyMatch = html.match(/\?([a-f0-9]+_page)=2/);
          if (keyMatch) pageKey = keyMatch[1];
          else pageKey = "page";
          const totalMatch = html.match(/Page \d+ of (\d+)/);
          if (totalMatch) totalPages = parseInt(totalMatch[1], 10);
        }

        const regex = /href="(\/(?:property-requirements\/[^"]+|[^"]*requirement[^"]*?))"/g;
        let match;
        let foundNew = false;
        while ((match = regex.exec(html)) !== null) {
          const path = match[1];
          if (
            path !== "/propertyrequirements" &&
            !path.includes("#") &&
            !path.includes("?") &&
            path !== "/features/occupier-directory" &&
            !allLinks.includes(TRL_BASE + path)
          ) {
            allLinks.push(TRL_BASE + path);
            foundNew = true;
          }
        }

        if (!foundNew) break;
        page++;
        await new Promise(r => setTimeout(r, 300));
      }
    }

    return allLinks;
  } catch {
    return [];
  }
}
