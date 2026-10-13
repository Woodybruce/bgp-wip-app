// Content for the public website (bgp.uk.com): team, case studies, news.
// Public feeds the site reads (CORS open, cached), staff CRUD for the
// dashboard's Website page, and a small action API ChatBGP's
// manage_website_content tool calls. Tables are seeded once from
// assets/website-seed.json (the site's bundled copy) when empty.
import { Router, type Request } from "express";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth } from "./auth";
import { scrapeLogoFromWebsite } from "./website-logo-scraper";
import {
  insertWebsiteCaseStudySchema,
  insertWebsiteNewsSchema,
  insertWebsiteTeamSchema,
  websiteCaseStudies,
  websiteNews,
  websiteTeam,
} from "@shared/schema";

export type WebsiteKind = "team" | "case_study" | "news";
const TABLES = {
  team: { table: websiteTeam, insert: insertWebsiteTeamSchema, label: "team member" },
  case_study: { table: websiteCaseStudies, insert: insertWebsiteCaseStudySchema, label: "case study" },
  news: { table: websiteNews, insert: insertWebsiteNewsSchema, label: "news article" },
} as const;

const KIND_FROM_PATH: Record<string, WebsiteKind> = { team: "team", "case-studies": "case_study", news: "news" };
const kindOf = (p: unknown): WebsiteKind | undefined => KIND_FROM_PATH[String(p)];
const str = (p: unknown) => String(Array.isArray(p) ? p[0] : p);

let seeded: Promise<void> | null = null;
export function ensureWebsiteContentSeed(): Promise<void> {
  if (!seeded) {
    seeded = (async () => {
      const [t] = await db.select({ id: websiteTeam.id }).from(websiteTeam).limit(1);
      const [c] = await db.select({ id: websiteCaseStudies.id }).from(websiteCaseStudies).limit(1);
      const [n] = await db.select({ id: websiteNews.id }).from(websiteNews).limit(1);
      const candidates = ["server/assets/website-seed.json", "dist/server/assets/website-seed.json"].map((p) => path.resolve(process.cwd(), p));
      const seedPath = candidates.find((p) => existsSync(p));
      if (!seedPath) {
        console.warn("[website-content] seed file missing:", candidates.join(", "));
        return;
      }
      const seed: any = JSON.parse(readFileSync(seedPath, "utf8"));
      if (!t && seed.team?.length) await db.insert(websiteTeam).values(seed.team.map((r: any) => ({ ...r, updatedBy: "seed" })));
      if (!c && seed.caseStudies?.length) await db.insert(websiteCaseStudies).values(seed.caseStudies.map((r: any) => ({ ...r, updatedBy: "seed" })));
      if (!n && seed.news?.length) await db.insert(websiteNews).values(seed.news.map((r: any) => ({ ...r, updatedBy: "seed" })));
      if (!t || !c || !n) console.log(`[website-content] seeded ${!t ? seed.team.length : 0} team, ${!c ? seed.caseStudies.length : 0} case studies, ${!n ? seed.news.length : 0} news`);
      // Rows nobody has edited in the dashboard (updated_by still "seed")
      // keep tracking the bundled copy, so content changes committed to
      // marketing/ reach the live site on deploy. Anything a person has
      // touched is theirs and is left alone.
      const reconcile = async (table: any, key: string, rows: any[]) => {
        const existing = (await db.select().from(table)) as any[];
        const byKey = new Map(existing.map((r) => [String(r[key]).toLowerCase(), r]));
        let changed = 0;
        for (const r of rows) {
          const cur = byKey.get(String(r[key]).toLowerCase());
          if (!cur) {
            await db.insert(table).values({ ...r, updatedBy: "seed" });
            changed++;
          } else if (cur.updatedBy === "seed") {
            await db.update(table).set({ ...r, updatedBy: "seed", updatedAt: new Date() }).where(eq(table.id, cur.id));
            changed++;
          }
        }
        const keep = new Set(rows.map((r) => String(r[key]).toLowerCase()));
        for (const r of existing) {
          if (r.updatedBy === "seed" && !keep.has(String(r[key]).toLowerCase())) {
            await db.delete(table).where(eq(table.id, r.id));
            changed++;
          }
        }
        return changed;
      };
      const changes = [
        t ? await reconcile(websiteTeam, "name", seed.team || []) : 0,
        c ? await reconcile(websiteCaseStudies, "slug", seed.caseStudies || []) : 0,
        n ? await reconcile(websiteNews, "slug", seed.news || []) : 0,
      ];
      if (changes.some(Boolean)) console.log(`[website-content] reconciled seed rows: ${changes[0]} team, ${changes[1]} case studies, ${changes[2]} news`);
    })().catch((e) => {
      console.error("[website-content] seed failed:", e?.message);
      seeded = null;
    });
  }
  return seeded;
}

const slugify = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// The HR pages are the one source of truth for who someone is (Woody,
// 2026-10-13): name, job title, email and phone on bgp.uk.com come from
// users + staff_profiles, matched by email. The website row only decides
// the site-specific bits — photo, key-contact groups, order, visibility.
// "Managing Director - Board" style suffixes are dropped, as on the cards.
const cleanTitle = (value: unknown) => String(value || "").split(/\s+[-–—|]\s+/)[0].trim();
export async function overlayHrProfiles<T extends { name: string; title: string; email: string | null; phone: string | null }>(rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  try {
    const r: any = await db.execute(sql`
      SELECT lower(u.email) AS email, u.name, u.phone, u.team, sp.title
        FROM users u LEFT JOIN staff_profiles sp ON sp.user_id = u.id
       WHERE COALESCE(u.is_active, true) AND u.email IS NOT NULL`);
    const byEmail = new Map<string, any>((r.rows || r).map((h: any) => [String(h.email), h]));
    return rows.map((row) => {
      const h = row.email ? byEmail.get(row.email.toLowerCase()) : null;
      if (!h) return row;
      const name = String(h.name || "").trim();
      const title = cleanTitle(h.title);
      const phone = String(h.phone || "").trim();
      return { ...row, name: name || row.name, title: title || row.title, phone: phone || row.phone, team: h.team || null };
    });
  } catch (err: any) {
    console.warn("[website-content] HR overlay skipped:", err?.message);
    return rows;
  }
}

export async function listPublic(kind: WebsiteKind) {
  await ensureWebsiteContentSeed();
  if (kind === "team") {
    return overlayHrProfiles(await db.select().from(websiteTeam).where(eq(websiteTeam.visible, true)).orderBy(asc(websiteTeam.sortOrder), asc(websiteTeam.name)));
  }
  if (kind === "case_study") {
    return db.select().from(websiteCaseStudies).where(eq(websiteCaseStudies.published, true)).orderBy(asc(websiteCaseStudies.sortOrder));
  }
  return db.select().from(websiteNews).where(eq(websiteNews.published, true)).orderBy(asc(websiteNews.sortOrder), desc(websiteNews.updatedAt));
}

export async function listAll(kind: WebsiteKind) {
  await ensureWebsiteContentSeed();
  if (kind === "team") return db.select().from(websiteTeam).orderBy(asc(websiteTeam.sortOrder), asc(websiteTeam.name));
  if (kind === "case_study") return db.select().from(websiteCaseStudies).orderBy(asc(websiteCaseStudies.sortOrder));
  return db.select().from(websiteNews).orderBy(asc(websiteNews.sortOrder), desc(websiteNews.updatedAt));
}

// Shared by the REST handlers and ChatBGP. `data` is validated against the
// insert schema (partial for updates); slugs are generated from the title
// when omitted. Returns the affected row(s).
export async function websiteContentAction(
  kind: WebsiteKind,
  action: "list" | "get" | "create" | "update" | "delete" | "publish" | "unpublish",
  args: { id?: string; slug?: string; data?: Record<string, any> },
  actor: string,
): Promise<any> {
  await ensureWebsiteContentSeed();
  const def = TABLES[kind];
  if (!def) throw new Error(`Unknown kind ${kind}`);
  const table: any = def.table;
  const findOne = async () => {
    if (args.id) return ((await db.select().from(table).where(eq(table.id, args.id))) as any[])[0];
    if (args.slug && kind !== "team") return ((await db.select().from(table).where(eq(table.slug, args.slug))) as any[])[0];
    if (args.slug && kind === "team") {
      const rows = (await db.select().from(table)) as any[];
      return rows.find((r: any) => slugify(r.name) === slugify(args.slug!));
    }
    return undefined;
  };

  if (action === "list") return listAll(kind);
  if (action === "get") {
    const row = await findOne();
    if (!row) throw new Error(`${def.label} not found`);
    return row;
  }
  if (action === "create") {
    const data: any = { ...(args.data || {}) };
    if (kind !== "team" && !data.slug && data.title) data.slug = slugify(data.title);
    if (kind === "team" && data.email === "TBC") data.email = null;
    const parsed = def.insert.parse({ ...data, updatedBy: actor });
    const [row] = (await db.insert(table).values(parsed as any).returning()) as any[];
    return row;
  }
  const existing = await findOne();
  if (!existing) throw new Error(`${def.label} not found — pass its id or slug`);
  if (action === "delete") {
    await db.delete(table).where(eq(table.id, existing.id));
    return { deleted: true, id: existing.id };
  }
  let patch: Record<string, any> = {};
  if (action === "update") patch = { ...(args.data || {}) };
  if (action === "publish") patch = kind === "team" ? { visible: true } : { published: true };
  if (action === "unpublish") patch = kind === "team" ? { visible: false } : { published: false };
  delete patch.id;
  const parsed = def.insert.partial().parse(patch);
  const [row] = (await db
    .update(table)
    .set({ ...(parsed as any), updatedBy: actor, updatedAt: new Date() })
    .where(eq(table.id, existing.id))
    .returning()) as any[];
  return row;
}

function actorFrom(req: Request): string {
  const u: any = (req as any).user || (req.session as any)?.user;
  return u?.email || u?.name || u?.id || "staff";
}

const router = Router();

// The site is on another origin (bgp.uk.com); browsers need CORS here.
router.use("/api/public/website", (_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Cache-Control", "public, max-age=60");
  if (_req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

router.get("/api/public/website/all", async (_req, res) => {
  try {
    const [team, caseStudies, news] = await Promise.all([listPublic("team"), listPublic("case_study"), listPublic("news")]);
    res.json({ team, caseStudies, news, generatedAt: new Date().toISOString() });
  } catch (err: any) {
    console.error("[website-content] public all failed:", err?.message);
    res.status(500).json({ message: "Failed to load website content" });
  }
});

router.get("/api/public/website/:kind", async (req, res) => {
  const kind = kindOf(req.params.kind);
  if (!kind) return res.status(404).json({ message: "Unknown content type" });
  try {
    res.json(await listPublic(kind));
  } catch (err: any) {
    console.error("[website-content] public list failed:", err?.message);
    res.status(500).json({ message: "Failed to load website content" });
  }
});

// ─── Brand assets for the site, through the dashboard's own keys ─────────
// bgp.uk.com's client rows and Brand Rep case studies need logos and shop
// photos the marketing team never had to hand. logo.dev (LOGO_DEV_TOKEN)
// and Google Places (GOOGLE_API_KEY) are already paid for here, so the
// site pulls through this proxy. Both lists are allowlists: an open
// endpoint must not be able to spend credits on arbitrary lookups.
const WEBSITE_LOGO_DOMAINS = new Set([
  "aberdeeninvestments.com", "ardentcompanies.com", "atisfood.com", "axa-im.com", "bangerslondon.com", "barrys.com",
  "beautypie.com", "bloomberg.com", "brookfield.com", "capitalrealestatepartners.com", "cityoflondon.gov.uk",
  "columbiathreadneedle.com", "danielladraper.com", "dintaifung.co.uk", "earlofeast.com", "hammerson.com", "jabgym.com",
  "johnstonsofelgin.com", "karvestudio.com", "landsec.com", "masaj.london", "oldspike.co.uk", "percivalclo.com", "rains.com",
  "ronning.co", "schroders.com", "stanhopeplc.com", "thecrownestate.co.uk", "thefrankieshop.com", "thenorthbank.london",
  "yolklondon.com",
]);
// Several queries per shop, first result whose name carries the brand wins
// (a street-only match can land on the neighbour: "Davies Street" found
// Hedonism Wines first time round).
const WEBSITE_PLACE_QUERIES: Record<string, { brand: RegExp; queries: string[] }> = {
  "the-frankie-shop-davies-street": { brand: /frankie/i, queries: ["The Frankie Shop Davies Street Mayfair London", "The Frankie Shop London", "The Frankie Shop Mayfair"] },
  "percival-neal-street": { brand: /percival/i, queries: ["Percival Neal Street Seven Dials London", "Percival Covent Garden store"] },
  "atis-loxton-walk": { brand: /atis/i, queries: ["atis Loxton Walk Marylebone London", "atis Marylebone London", "atis Blandford Street London"] },
  "masaj-islington-square": { brand: /masaj/i, queries: ["MASAJ Islington Square Upper Street London", "MASAJ Islington"] },
};
const websiteAssetCache = new Map<string, { at: number; buf: Buffer; mime: string; source: string }>();
const WEBSITE_ASSET_TTL = 6 * 3600 * 1000;

router.get("/api/public/website/logo/:domain", async (req, res) => {
  const domain = str(req.params.domain).toLowerCase();
  if (!WEBSITE_LOGO_DOMAINS.has(domain)) return res.status(404).json({ message: "Not a website client" });
  const key = `logo:${domain}:${req.query.source === "site" ? "site" : "any"}`;
  let hit = websiteAssetCache.get(key);
  if (!hit || Date.now() - hit.at > WEBSITE_ASSET_TTL) {
    hit = undefined;
    const token = process.env.LOGO_DEV_TOKEN;
    // ?source=site skips logo.dev (square icons) for the site's own wordmark.
    if (token && req.query.source !== "site") {
      try {
        const r = await fetch(`https://img.logo.dev/${encodeURIComponent(domain)}?token=${token}&size=512&format=png`, { signal: AbortSignal.timeout(10_000) });
        const mime = r.headers.get("content-type") || "";
        if (r.ok && mime.startsWith("image/")) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 800) hit = { at: Date.now(), buf, mime, source: "logo.dev" };
        }
      } catch { /* fall through to the website scrape */ }
    }
    if (!hit) {
      const scraped = await scrapeLogoFromWebsite(domain).catch(() => null);
      if (scraped) hit = { at: Date.now(), buf: scraped.buffer, mime: scraped.mime, source: `website-${scraped.source}` };
    }
    if (!hit) return res.status(404).json({ message: "No logo found" });
    websiteAssetCache.set(key, hit);
  }
  res.header("Content-Type", hit.mime);
  res.header("X-Logo-Source", hit.source);
  res.header("Cache-Control", "public, max-age=3600");
  res.send(hit.buf);
});

async function websitePlacePhotos(slug: string): Promise<{ place: any; photos: any[] } | null> {
  const spec = WEBSITE_PLACE_QUERIES[slug];
  const googleKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!spec || !googleKey) return null;
  let first: any = null;
  for (const query of spec.queries) {
    const search: any = await (await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&region=uk&key=${googleKey}`,
      { signal: AbortSignal.timeout(10_000) },
    )).json();
    first = (search?.results || []).find((r: any) => spec.brand.test(r.name || "") && /London|United Kingdom|\bUK\b/i.test(r.formatted_address || ""));
    if (first?.place_id) break;
  }
  if (!first?.place_id) return null;
  const details: any = await (await fetch(
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(first.place_id)}&fields=name,formatted_address,photos&key=${googleKey}`,
    { signal: AbortSignal.timeout(10_000) },
  )).json();
  const result = details?.result || {};
  return {
    place: { placeId: first.place_id, name: result.name || first.name, address: result.formatted_address || first.formatted_address },
    photos: (result.photos || []).map((p: any, i: number) => ({ i, width: p.width, height: p.height, attribution: (p.html_attributions || []).join(" "), ref: p.photo_reference })),
  };
}

router.get("/api/public/website/place-photos/:slug", async (req, res) => {
  try {
    const found = await websitePlacePhotos(str(req.params.slug));
    if (!found) return res.status(404).json({ message: "No place photos" });
    res.json({ place: found.place, photos: found.photos.map(({ ref: _ref, ...p }) => p) });
  } catch (err: any) {
    res.status(502).json({ message: err?.message || "Places lookup failed" });
  }
});

router.get("/api/public/website/place-photos/:slug/:i", async (req, res) => {
  const slug = str(req.params.slug);
  const i = Math.max(0, parseInt(str(req.params.i), 10) || 0);
  const key = `place:${slug}:${i}`;
  let hit = websiteAssetCache.get(key);
  if (!hit || Date.now() - hit.at > WEBSITE_ASSET_TTL) {
    try {
      const found = await websitePlacePhotos(slug);
      const photo = found?.photos[i];
      const googleKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
      if (!photo || !googleKey) return res.status(404).json({ message: "No such photo" });
      const r = await fetch(
        `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1800&photo_reference=${encodeURIComponent(photo.ref)}&key=${googleKey}`,
        { redirect: "follow", signal: AbortSignal.timeout(15_000) },
      );
      if (!r.ok) return res.status(502).json({ message: `Photo fetch ${r.status}` });
      hit = { at: Date.now(), buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get("content-type") || "image/jpeg", source: photo.attribution };
      websiteAssetCache.set(key, hit);
    } catch (err: any) {
      return res.status(502).json({ message: err?.message || "Places photo failed" });
    }
  }
  res.header("Content-Type", hit.mime);
  res.header("Cache-Control", "public, max-age=3600");
  res.send(hit.buf);
});

// Staff CRUD for the dashboard Website page.
router.get("/api/website/:kind", requireAuth, async (req, res) => {
  const kind = kindOf(req.params.kind);
  if (!kind) return res.status(404).json({ message: "Unknown content type" });
  try {
    res.json(await listAll(kind));
  } catch (err: any) {
    res.status(500).json({ message: err?.message || "Failed to load" });
  }
});

router.post("/api/website/:kind", requireAuth, async (req, res) => {
  const kind = kindOf(req.params.kind);
  if (!kind) return res.status(404).json({ message: "Unknown content type" });
  try {
    res.status(201).json(await websiteContentAction(kind, "create", { data: req.body }, actorFrom(req)));
  } catch (err: any) {
    res.status(400).json({ message: err?.message || "Failed to create" });
  }
});

router.patch("/api/website/:kind/:id", requireAuth, async (req, res) => {
  const kind = kindOf(req.params.kind);
  if (!kind) return res.status(404).json({ message: "Unknown content type" });
  try {
    res.json(await websiteContentAction(kind, "update", { id: str(req.params.id), data: req.body }, actorFrom(req)));
  } catch (err: any) {
    res.status(400).json({ message: err?.message || "Failed to update" });
  }
});

router.delete("/api/website/:kind/:id", requireAuth, async (req, res) => {
  const kind = kindOf(req.params.kind);
  if (!kind) return res.status(404).json({ message: "Unknown content type" });
  try {
    res.json(await websiteContentAction(kind, "delete", { id: str(req.params.id) }, actorFrom(req)));
  } catch (err: any) {
    res.status(400).json({ message: err?.message || "Failed to delete" });
  }
});

export default router;
