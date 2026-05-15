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
  // 1. logo.dev — best quality if configured. Free signup at logo.dev gives
  //    you a publishable token (pk_...) that goes in LOGO_DEV_TOKEN env.
  const logoDevToken = process.env.LOGO_DEV_TOKEN;
  if (logoDevToken) {
    const hit = await tryFetch(`https://img.logo.dev/${encodeURIComponent(domain)}?token=${logoDevToken}&size=512&format=png`);
    if (hit) return { ...hit, source: "logo.dev" };
  }
  // 2. Clearbit — HubSpot deprecated this March 2025 and is killing it
  //    completely Dec 2025. Most domains 404 now but a few still serve.
  const cb = await tryFetch(`https://logo.clearbit.com/${encodeURIComponent(domain)}?size=512`);
  if (cb) return { ...cb, source: "clearbit" };
  // 3. Google's favicon API — high-res (sz=128) often serves a real logo, not
  //    just the tiny favicon. Free, no key. Better hit rate than DuckDuckGo.
  const google = await tryFetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
  if (google && google.buffer.length > 300) return { ...google, source: "google" };
  // 4. DuckDuckGo icons — last resort. Lowered threshold to 100 bytes so a
  //    small but valid ico still gets through.
  const ddg = await tryFetch(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`);
  if (ddg && ddg.buffer.length > 100) return { ...ddg, source: "duckduckgo" };
  return null;
}

// Background job state — single global since this is a "once in a while
// catch-up" operation, not a concurrent thing. POST starts the job and
// returns immediately; GET status reports progress. Survives Railway proxy
// timeouts that killed the old synchronous path.
interface JobState {
  startedAt: number;
  finishedAt: number | null;
  attempted: number;
  imported: number;
  missed: number;
  errors: number;
  errorSamples: string[];
  sourceCounts: Record<string, number>;
  total: number;
  logoDevConfigured: boolean;
  lastBrand: string | null;
  error: string | null;
}
let job: JobState | null = null;

router.get("/api/admin/import-brand-logos/status", requireAuth, async (_req: Request, res: Response) => {
  if (!job) return res.json({ running: false, message: "No job has been started in this process lifetime." });
  res.json({
    running: job.finishedAt === null,
    startedAt: new Date(job.startedAt).toISOString(),
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    progress: `${job.attempted}/${job.total}`,
    attempted: job.attempted,
    imported: job.imported,
    missed: job.missed,
    errors: job.errors,
    error_samples: job.errorSamples,
    source_counts: job.sourceCounts,
    logo_dev_configured: job.logoDevConfigured,
    last_brand: job.lastBrand,
    error: job.error,
  });
});

router.post("/api/admin/import-brand-logos", requireAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.body?.limit ?? 500), 2000);
    const skipExisting: boolean = req.body?.skipExisting !== false;
    if (job && job.finishedAt === null) {
      return res.status(409).json({ error: "A bulk import is already running", status: `${job.attempted}/${job.total}` });
    }
    console.log(`[bulk-logos] starting — limit=${limit}, skipExisting=${skipExisting}, logo_dev_token=${!!process.env.LOGO_DEV_TOKEN}`);

    // Pull tenant brands with a domain. The skip-existing filter looks ONLY
    // for category='Brands' rows so we don't false-skip when an unrelated
    // image-studio row (e.g. a street-view capture) happened to tag the
    // same brand_name.
    const whereClause = skipExisting
      ? `WHERE c.company_type ILIKE 'Tenant%'
           AND c.merged_into_id IS NULL
           AND (c.domain IS NOT NULL AND c.domain <> '' OR c.domain_url IS NOT NULL AND c.domain_url <> '')
           AND NOT EXISTS (
             SELECT 1 FROM image_studio_images i
             WHERE i.category = 'Brands'
               AND i.brand_name IS NOT NULL
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

    if (brands.length === 0) {
      const total = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM crm_companies WHERE company_type ILIKE 'Tenant%' AND merged_into_id IS NULL`
      );
      const withDomain = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM crm_companies
          WHERE company_type ILIKE 'Tenant%' AND merged_into_id IS NULL
            AND ((domain IS NOT NULL AND domain <> '') OR (domain_url IS NOT NULL AND domain_url <> ''))`
      );
      const note = `0 brands matched the filter. Total tenants: ${total.rows[0]?.count}, with a domain: ${withDomain.rows[0]?.count}.`;
      console.warn(`[bulk-logos] ${note}`);
      return res.json({ started: false, note });
    }

    // Initialise the job and respond immediately. The actual work runs in
    // the background via setImmediate so the HTTP response isn't blocked
    // by Railway's ~60s edge timeout.
    job = {
      startedAt: Date.now(),
      finishedAt: null,
      attempted: 0,
      imported: 0,
      missed: 0,
      errors: 0,
      errorSamples: [],
      sourceCounts: { "logo.dev": 0, clearbit: 0, google: 0, duckduckgo: 0 },
      total: brands.length,
      logoDevConfigured: !!process.env.LOGO_DEV_TOKEN,
      lastBrand: null,
      error: null,
    };

    setImmediate(async () => {
      try {
        for (const brand of brands) {
          if (!job) break;
          job.lastBrand = brand.name;
          job.attempted++;
          const domain = extractDomain(brand.domain_url || brand.domain);
          if (!domain) { job.missed++; continue; }
          try {
            const hit = await fetchLogoForDomain(domain);
            if (!hit) {
              job.missed++;
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
            job.sourceCounts[hit.source] = (job.sourceCounts[hit.source] || 0) + 1;
            job.imported++;
            if (job.imported <= 5 || job.imported % 25 === 0) console.log(`[bulk-logos] imported ${job.imported}: ${brand.name} via ${hit.source}`);
            await new Promise(r => setTimeout(r, 150));
          } catch (err: any) {
            job.errors++;
            const msg = `${brand.name} (${domain}): ${err?.message || err}`;
            if (job.errorSamples.length < 5) job.errorSamples.push(msg);
            console.warn(`[bulk-logos] ${msg}`);
          }
        }
      } catch (err: any) {
        if (job) job.error = err?.message || String(err);
        console.error("[bulk-logos] background job crashed:", err);
      } finally {
        if (job) {
          job.finishedAt = Date.now();
          console.log(`[bulk-logos] done — imported=${job.imported}, missed=${job.missed}, errors=${job.errors}, sources=${JSON.stringify(job.sourceCounts)}`);
        }
      }
    });

    res.json({
      started: true,
      total: brands.length,
      message: "Background import started. Poll /api/admin/import-brand-logos/status for progress.",
    });
  } catch (err: any) {
    console.error("[bulk-logos] error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
