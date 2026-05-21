// On-demand "refresh images from the company website" admin endpoints.
//
// Companion to the bulk import in bulk-brand-logos.ts. The bulk path
// runs across hundreds of brands at once; this one runs against a
// single CRM company — useful when:
//   - We've just added a new tenant brand and want decent imagery now
//   - The existing logo is rubbish (old Clearbit / favicon) and the
//     team wants to wipe + re-pull from the company site
//   - A landlord / freeholder appears on the brochure pipeline output
//     and we want their corporate identity in the CRM for context
//
// What it does:
//   1. Pulls the canonical domain off the crm_companies row.
//   2. Scrapes the homepage for a logo (schema.org / Open Graph /
//      apple-touch-icon / header img) and up to 6 hero body images.
//   3. Wipes any existing 'website-refresh' tagged image_studio_images
//      for this company (so re-runs replace rather than pile up).
//   4. Writes new images into image_studio_images tagged with the
//      brand name + 'website-refresh' + 'website-<source>' so the
//      provenance is clear and re-runs are deterministic.
//
// Routes:
//   POST /api/companies/:id/refresh-images   {logoOnly?: boolean, maxHero?: number}
//   POST /api/brands/refresh-images-by-name  {name: string, domain?: string}

import type { Express, Request, Response } from "express";
import { db, pool } from "./db";
import { crmCompanies } from "@shared/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";
import { storeImageFromBuffer } from "./image-studio";
import { scrapeLogoFromWebsite, scrapeHeroImagesFromWebsite } from "./website-logo-scraper";

function extractDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return String(raw)
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .toLowerCase()
    .trim() || null;
}

const REFRESH_TAG = "website-refresh";

interface RefreshResult {
  ok: boolean;
  domain?: string;
  logo?: { source: string; bytes: number; storedId: string } | null;
  hero?: Array<{ source: string; bytes: number; storedId: string; alt?: string | null }>;
  removedExisting?: number;
  error?: string;
}

async function refreshImagesForCompany(args: {
  companyId: string;
  brandName: string;
  domain: string;
  logoOnly?: boolean;
  maxHero?: number;
}): Promise<RefreshResult> {
  // Wipe prior website-refresh rows for this brand so we don't pile up
  // duplicates across runs. Manual uploads (no REFRESH_TAG) survive.
  const wipe = await pool.query(
    `DELETE FROM image_studio_images
      WHERE brand_name = $1
        AND $2 = ANY(tags)
      RETURNING id`,
    [args.brandName, REFRESH_TAG],
  ).catch(() => ({ rows: [] as { id: string }[] }));

  const result: RefreshResult = {
    ok: true,
    domain: args.domain,
    logo: null,
    hero: [],
    removedExisting: wipe.rows.length,
  };

  // ── Logo ───────────────────────────────────────────────────────────
  try {
    const scraped = await scrapeLogoFromWebsite(args.domain);
    if (scraped) {
      const stored = await storeImageFromBuffer({
        buffer: scraped.buffer,
        fileName: `${args.brandName} — Logo`,
        category: "Brands",
        tags: ["Logo", "brand-logo", REFRESH_TAG, `website-${scraped.source}`, args.brandName],
        description: `Logo scraped from ${args.domain} (${scraped.source}: ${scraped.url})`,
        source: `website-${scraped.source}`,
        brandName: args.brandName,
        mimeType: scraped.mime,
        filenameHint: args.brandName,
      });
      result.logo = { source: scraped.source, bytes: scraped.buffer.length, storedId: stored.id };
    }
  } catch (err: any) {
    console.warn(`[refresh-images] logo scrape failed for ${args.domain}: ${err?.message}`);
  }

  // ── Hero imagery (skip if logoOnly) ────────────────────────────────
  if (!args.logoOnly) {
    try {
      const hero = await scrapeHeroImagesFromWebsite(args.domain, args.maxHero ?? 6);
      for (let i = 0; i < hero.length; i++) {
        const img = hero[i];
        const fileName = img.alt
          ? `${args.brandName} — ${img.alt.slice(0, 60)}`
          : `${args.brandName} — Website hero ${i + 1}`;
        try {
          const stored = await storeImageFromBuffer({
            buffer: img.buffer,
            fileName,
            category: "Brands",
            tags: ["Brand Hero", REFRESH_TAG, "website-hero", args.brandName],
            description: img.alt
              ? `${img.alt} — scraped from ${args.domain}`
              : `Hero image #${i + 1} scraped from ${args.domain} (${img.url})`,
            source: "website-hero",
            brandName: args.brandName,
            mimeType: img.mime,
            filenameHint: `${args.brandName}-hero-${i + 1}`,
          });
          result.hero!.push({
            source: "website-hero",
            bytes: img.buffer.length,
            storedId: stored.id,
            alt: img.alt || null,
          });
        } catch (err: any) {
          console.warn(`[refresh-images] hero store failed: ${err?.message}`);
        }
      }
    } catch (err: any) {
      console.warn(`[refresh-images] hero scrape failed: ${err?.message}`);
    }
  }

  return result;
}

export function setupRefreshImageRoutes(app: Express): void {
  // Single-company refresh — pulls fresh imagery from whatever domain
  // sits on the row. Wipes prior website-refresh entries so re-runs
  // replace rather than accumulate.
  app.post("/api/companies/:id/refresh-images", requireAuth, async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const [co] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, id)).limit(1);
      if (!co) return res.status(404).json({ error: "Company not found" });
      const domain = extractDomain(co.domainUrl || co.domain);
      if (!domain) return res.status(400).json({ error: "Company has no domain set — add domain or domain_url to the row first." });

      const result = await refreshImagesForCompany({
        companyId: id,
        brandName: co.name,
        domain,
        logoOnly: !!req.body?.logoOnly,
        maxHero: typeof req.body?.maxHero === "number" ? req.body.maxHero : undefined,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // By-name refresh — for cases where the company isn't in crm_companies
  // yet (or the brand name doesn't match a row). Caller supplies the
  // brand name + domain explicitly.
  app.post("/api/brands/refresh-images-by-name", requireAuth, async (req: Request, res: Response) => {
    try {
      const name = String(req.body?.name || "").trim();
      const domain = extractDomain(String(req.body?.domain || ""));
      if (!name || !domain) return res.status(400).json({ error: "name and domain required" });

      const result = await refreshImagesForCompany({
        companyId: "",
        brandName: name,
        domain,
        logoOnly: !!req.body?.logoOnly,
        maxHero: typeof req.body?.maxHero === "number" ? req.body.maxHero : undefined,
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });
}
