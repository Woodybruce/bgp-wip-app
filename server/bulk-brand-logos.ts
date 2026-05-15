// Bulk-import brand logos from free public sources, save to Image Studio's
// brand library. Run once to populate the library; afterwards the brand
// thumbnails on Brand Explorer / brand profile / property page resolve to
// our local cache rather than the deprecated Clearbit.
//
// Sources tried in order per brand (first hit wins):
//   1. logo.dev — requires LOGO_DEV_TOKEN env (free signup at logo.dev)
//   2. Clearbit — deprecated but still works for many domains until Dec 2025
//   3. DuckDuckGo icons — works free, no token, lower quality
//
// Endpoint:
//   POST /api/admin/import-brand-logos { limit?: number, skipExisting?: bool }
//   → { attempted, imported, skipped_existing, missed, errors, source_counts }
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { storeImageFromBuffer } from "./image-studio";

const router = Router();

interface BrandRow {
  id: string;
  name: string;
  domain: string | null;
  domain_url: string | null;
}

function extractDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return String(raw)
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .toLowerCase()
    .trim() || null;
}

async function tryFetch(url: string, timeoutMs = 8000): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200) return null; // probably a 1x1 placeholder
    const mime = res.headers.get("content-type") || "image/png";
    if (!mime.startsWith("image/")) return null;
    return { buffer: buf, mime };
  } catch {
    return null;
  }
}

async function fetchLogoForDomain(domain: string): Promise<{ buffer: Buffer; mime: string; source: string } | null> {
  // 1. logo.dev — best quality if configured.
  const logoDevToken = process.env.LOGO_DEV_TOKEN;
  if (logoDevToken) {
    const hit = await tryFetch(`https://img.logo.dev/${encodeURIComponent(domain)}?token=${logoDevToken}&size=512&format=png`);
    if (hit) return { ...hit, source: "logo.dev" };
  }
  // 2. Clearbit — deprecated but still serves a lot of brands until Dec 2025.
  const cb = await tryFetch(`https://logo.clearbit.com/${encodeURIComponent(domain)}?size=512`);
  if (cb) return { ...cb, source: "clearbit" };
  // 3. DuckDuckGo icons — free, no key, always responds. Quality is favicon-tier
  //    but it's something. Skip the .ico tiny fallback by checking size.
  const ddg = await tryFetch(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`);
  if (ddg && ddg.buffer.length > 500) return { ...ddg, source: "duckduckgo" };
  return null;
}

router.post("/api/admin/import-brand-logos", requireAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.body?.limit ?? 500), 2000);
    const skipExisting: boolean = req.body?.skipExisting !== false;
    const userId = (req as any).user?.id || null;
    console.log(`[bulk-logos] starting — limit=${limit}, skipExisting=${skipExisting}, logo_dev_token=${!!process.env.LOGO_DEV_TOKEN}`);

    // Pull tenant brands with a domain. Skip ones that already have a brand
    // logo in image_studio_images unless caller explicitly forces re-import.
    const whereClause = skipExisting
      ? `WHERE c.company_type ILIKE 'Tenant%'
           AND c.merged_into_id IS NULL
           AND (c.domain IS NOT NULL AND c.domain <> '' OR c.domain_url IS NOT NULL AND c.domain_url <> '')
           AND NOT EXISTS (
             SELECT 1 FROM image_studio_images i
             WHERE i.brand_name IS NOT NULL
               AND lower(trim(i.brand_name)) = lower(trim(c.name))
           )`
      : `WHERE c.company_type ILIKE 'Tenant%'
           AND c.merged_into_id IS NULL
           AND (c.domain IS NOT NULL AND c.domain <> '' OR c.domain_url IS NOT NULL AND c.domain_url <> '')`;

    const { rows: brands } = await pool.query<BrandRow>(
      `SELECT c.id, c.name, c.domain, c.domain_url
         FROM crm_companies c
         ${whereClause}
         ORDER BY c.is_tracked_brand DESC NULLS LAST, c.name ASC
         LIMIT $1`,
      [limit]
    );
    console.log(`[bulk-logos] ${brands.length} brands to process`);

    // Diagnose if zero — common case: no domains stored on crm_companies.
    if (brands.length === 0) {
      const total = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM crm_companies WHERE company_type ILIKE 'Tenant%' AND merged_into_id IS NULL`
      );
      const withDomain = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM crm_companies
          WHERE company_type ILIKE 'Tenant%' AND merged_into_id IS NULL
            AND ((domain IS NOT NULL AND domain <> '') OR (domain_url IS NOT NULL AND domain_url <> ''))`
      );
      const note = `0 brands matched the filter. Total tenants: ${total.rows[0]?.count}, with a domain: ${withDomain.rows[0]?.count}. Most likely no tenant brands have a domain stored in crm_companies — set domain on a brand to test, or set skipExisting=false to force re-import existing.`;
      console.warn(`[bulk-logos] ${note}`);
      return res.json({ attempted: 0, imported: 0, missed: 0, errors: 0, note });
    }

    const sourceCounts: Record<string, number> = { "logo.dev": 0, clearbit: 0, duckduckgo: 0 };
    let imported = 0;
    let missed = 0;
    let errors = 0;

    for (const brand of brands) {
      const domain = extractDomain(brand.domain_url || brand.domain);
      if (!domain) { missed++; continue; }
      try {
        const hit = await fetchLogoForDomain(domain);
        if (!hit) {
          missed++;
          if (missed <= 5) console.log(`[bulk-logos] miss: ${brand.name} (${domain})`);
          continue;
        }
        await storeImageFromBuffer({
          buffer: hit.buffer,
          fileName: `${brand.name} — Logo`,
          category: "Brands",
          tags: ["brand-logo", "bulk-import", hit.source],
          description: `Brand logo for ${brand.name}, sourced from ${hit.source}`,
          source: `bulk-${hit.source}`,
          brandName: brand.name,
          mimeType: hit.mime,
          filenameHint: brand.name,
        });
        sourceCounts[hit.source] = (sourceCounts[hit.source] || 0) + 1;
        imported++;
        if (imported <= 5 || imported % 25 === 0) console.log(`[bulk-logos] imported ${imported}: ${brand.name} via ${hit.source}`);
        // Gentle throttle so we don't slam Clearbit / logo.dev / DDG.
        await new Promise(r => setTimeout(r, 150));
      } catch (err: any) {
        errors++;
        console.warn(`[bulk-logos] ${brand.name} (${domain}): ${err?.message || err}`);
      }
    }

    console.log(`[bulk-logos] done — imported=${imported}, missed=${missed}, errors=${errors}, sources=${JSON.stringify(sourceCounts)}`);
    res.json({
      attempted: brands.length,
      imported,
      missed,
      errors,
      source_counts: sourceCounts,
      skipped_existing: skipExisting,
      logo_dev_configured: !!process.env.LOGO_DEV_TOKEN,
      remaining: brands.length === limit ? "maybe more — re-run" : "done",
      conducted_by: userId,
    });
  } catch (err: any) {
    console.error("[bulk-logos] error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
