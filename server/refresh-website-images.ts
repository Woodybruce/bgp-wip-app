// On-demand company image refresh. Logos remain separate from gallery photos;
// all automatic profile photography uses the canonical identity/quality gate.
import type { Express, Request, Response } from "express";
import { db, pool } from "./db";
import { crmCompanies } from "@shared/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";
import { storeImageFromBuffer } from "./image-studio";
import { scrapeLogoFromWebsite } from "./website-logo-scraper";
import { refreshBrandImages } from "./brand-images";
import { getBrandIdentity, normalizeBrandDomain } from "./brand-identity";
import { brandImageIdentityTag } from "./brand-publishing";

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
  photoRefresh?: Awaited<ReturnType<typeof refreshBrandImages>>;
  photoReason?: string;
  error?: string;
}

async function refreshImagesForCompany(args: {
  companyId: string;
  brandName: string;
  domain: string;
  logoOnly?: boolean;
  maxHero?: number;
}): Promise<RefreshResult> {
  const result: RefreshResult = { ok: true, domain: args.domain, logo: null, hero: [], removedExisting: 0 };
  let companyId = args.companyId;
  let verifiedIdentity: { fingerprint: string; tag: string } | null = null;
  if (!companyId) {
    const found = await pool.query("SELECT * FROM crm_companies WHERE LOWER(name) = LOWER($1)", [args.brandName]);
    const matches = found.rows.filter(company => {
      const identity = getBrandIdentity(company);
      return identity.status === "verified" && identity.domain === normalizeBrandDomain(args.domain);
    });
    if (matches.length === 1) companyId = matches[0].id;
  }
  if (companyId) {
    const company = (await pool.query("SELECT * FROM crm_companies WHERE id = $1", [companyId])).rows[0];
    const identity = getBrandIdentity(company);
    if (identity.status !== "verified" || identity.domain !== normalizeBrandDomain(args.domain)) {
      return { ...result, ok: false, error: "Confirm the official company website before refreshing images." };
    }
    verifiedIdentity = { fingerprint: identity.fingerprint, tag: brandImageIdentityTag(company) };
  }

  // ── Logo ───────────────────────────────────────────────────────────
  try {
    const scraped = await scrapeLogoFromWebsite(args.domain);
    if (scraped) {
      if (verifiedIdentity) {
        const current = (await pool.query("SELECT * FROM crm_companies WHERE id = $1", [companyId])).rows[0];
        const identity = getBrandIdentity(current);
        if (identity.status !== "verified" || identity.fingerprint !== verifiedIdentity.fingerprint) {
          return { ...result, ok: false, error: "The company identity changed during the refresh. No logo was saved; refresh again using its confirmed website." };
        }
      }
      const stored = await storeImageFromBuffer({
        buffer: scraped.buffer,
        fileName: `${args.brandName} — Logo`,
        category: "Brands",
        tags: ["Logo", "brand-logo", REFRESH_TAG, `website-${scraped.source}`, args.brandName, ...(verifiedIdentity ? [verifiedIdentity.tag] : [])],
        description: `Logo scraped from ${args.domain} (${scraped.source}: ${scraped.url})`,
        source: `website-${scraped.source}`,
        brandName: args.brandName,
        companyId: companyId || undefined,
        mimeType: scraped.mime,
        filenameHint: args.brandName,
      });
      result.logo = { source: scraped.source, bytes: scraped.buffer.length, storedId: stored.id };
    }
  } catch (err: any) {
    console.warn(`[refresh-images] logo scrape failed for ${args.domain}: ${err?.message}`);
  }

  // Keep current images recoverable. The canonical pipeline only supersedes
  // old unpinned photos after acceptable replacements have been stored.
  if (!args.logoOnly) {
    if (companyId) {
      try {
        result.photoRefresh = await refreshBrandImages(companyId, { force: true, target: args.maxHero ?? 6 });
        result.photoReason = result.photoRefresh.skipped;
      } catch (err: any) {
        result.photoReason = `Photo refresh could not finish: ${err?.message || "unavailable"}. Existing photos kept.`;
      }
    } else {
      result.photoReason = "Create or confirm the company's CRM identity before automatically importing profile photos. Existing photos kept.";
    }
  }

  return result;
}

export function setupRefreshImageRoutes(app: Express): void {
  // Single-company refresh uses its confirmed official website.
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
