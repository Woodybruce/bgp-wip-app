// Content for the public website (bgp.uk.com): team, case studies, news.
// Public feeds the site reads (CORS open, cached), staff CRUD for the
// dashboard's Website page, and a small action API ChatBGP's
// manage_website_content tool calls. Tables are seeded once from
// assets/website-seed.json (the site's bundled copy) when empty.
import { Router, type Request } from "express";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { requireAuth } from "./auth";
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

export async function listPublic(kind: WebsiteKind) {
  await ensureWebsiteContentSeed();
  if (kind === "team") {
    return db.select().from(websiteTeam).where(eq(websiteTeam.visible, true)).orderBy(asc(websiteTeam.sortOrder), asc(websiteTeam.name));
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
