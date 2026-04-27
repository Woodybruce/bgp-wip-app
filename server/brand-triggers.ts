// ─────────────────────────────────────────────────────────────────────────
// Brand triggers — per-event alerts.
//
// Runs daily. For each tracked brand:
//   1. Recomputes hunter score; emits an alert if it crosses 70 (cold→hot)
//      or drops below 50 (hot→cooling).
//   2. Checks covenant signals — new insolvency notice, accounts overdue,
//      new CCJs from Experian. Emits a covenant-deterioration alert.
//   3. Checks for new large/funding signals in the last 24h. Emits a
//      "live deal-scout signal" alert.
//
// Each alert emails the brand's coverers (crm_companies.bgp_contact_user_ids
// → users.email). Falls back to all admin users if no coverer set.
//
// Score history is stored in a `brand_score_history` table — one row per
// scan per brand. Allows the alert engine to detect crossings (compare to
// the previous row).
//
// Endpoints (admin):
//   GET  /api/brand-triggers/preview?dryRun=1  — show what would fire
//   POST /api/brand-triggers/run               — run now
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { sendSharedMailboxEmail } from "./shared-mailbox";
import { computeHunterScore } from "./hunter-score";

const router = Router();
const BGP_GREEN = "#2E5E3F";

const HOT_THRESHOLD = 70;
const COOLING_THRESHOLD = 50;

interface TriggerEvent {
  brandId: string;
  brandName: string;
  type: "hunter_hot" | "hunter_cooling" | "covenant_risk" | "fundraise" | "exec_change_major";
  headline: string;
  detail: string;
  recipients: string[];
}

// ─── Recipients lookup ───────────────────────────────────────────────────

async function getRecipientsForBrand(brandId: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT u.email FROM users u
      WHERE u.id = ANY(
        COALESCE((SELECT bgp_contact_user_ids FROM crm_companies WHERE id = $1), '{}'::text[])
      ) AND u.email IS NOT NULL AND u.email != ''`,
    [brandId]
  );
  if (r.rows.length > 0) return r.rows.map((row: any) => row.email);

  // Fall back to admins so brands without coverers still get watched
  const fallback = await pool.query(
    `SELECT email FROM users WHERE is_admin = true AND email IS NOT NULL AND email != '' LIMIT 5`
  );
  return fallback.rows.map((row: any) => row.email);
}

// ─── Score crossing detection ────────────────────────────────────────────

async function ensureScoreHistoryTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS brand_score_history (
      id SERIAL PRIMARY KEY,
      brand_company_id VARCHAR NOT NULL,
      hunter_score INTEGER NOT NULL,
      flags TEXT[],
      checked_at TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_brand_score_history_brand_time
      ON brand_score_history(brand_company_id, checked_at DESC);
  `);
}

async function getLastScore(brandId: string): Promise<number | null> {
  const r = await pool.query(
    `SELECT hunter_score FROM brand_score_history
      WHERE brand_company_id = $1
      ORDER BY checked_at DESC LIMIT 1`,
    [brandId]
  );
  return r.rows[0]?.hunter_score ?? null;
}

async function recordScore(brandId: string, score: number, flags: string[]): Promise<void> {
  await pool.query(
    `INSERT INTO brand_score_history (brand_company_id, hunter_score, flags) VALUES ($1, $2, $3)`,
    [brandId, score, flags]
  );
}

// ─── Scan logic ──────────────────────────────────────────────────────────

export async function scanBrandTriggers(opts: { dryRun?: boolean } = {}): Promise<TriggerEvent[]> {
  const dryRun = opts.dryRun === true;
  await ensureScoreHistoryTable();

  const brands = await pool.query(
    `SELECT id, name, rollout_status, store_count, backers, instagram_handle,
            tiktok_handle, dept_store_presence, franchise_activity, hunter_flag,
            concept_pitch, description, stock_ticker
       FROM crm_companies
      WHERE is_tracked_brand = true AND merged_into_id IS NULL`
  );

  const events: TriggerEvent[] = [];

  for (const brand of brands.rows) {
    // Fetch recent signals for the score
    const sigs = await pool.query(
      `SELECT signal_type, headline, magnitude, sentiment, created_at, signal_date
         FROM brand_signals
        WHERE brand_company_id = $1
          AND COALESCE(signal_date, created_at) >= now() - interval '365 days'`,
      [brand.id]
    );

    const { expansionScore: score, expansionFlags: flags } = computeHunterScore({
      brand,
      signals: sigs.rows,
      stock: null, // skip stock fetching here — keeps the scan fast
    });

    const prev = await getLastScore(brand.id);

    // 1. Score crossings
    if (prev != null) {
      if (prev < HOT_THRESHOLD && score >= HOT_THRESHOLD) {
        events.push({
          brandId: brand.id, brandName: brand.name, type: "hunter_hot",
          headline: `${brand.name} just turned HOT (${prev} → ${score})`,
          detail: `Expansion score crossed ${HOT_THRESHOLD}. Flags: ${flags.join(", ")}`,
          recipients: await getRecipientsForBrand(brand.id),
        });
      } else if (prev >= HOT_THRESHOLD && score < COOLING_THRESHOLD) {
        events.push({
          brandId: brand.id, brandName: brand.name, type: "hunter_cooling",
          headline: `${brand.name} is cooling (${prev} → ${score})`,
          detail: `Expansion score dropped from ${prev} to ${score}. Worth a check-in before they go dark.`,
          recipients: await getRecipientsForBrand(brand.id),
        });
      }
    }

    if (!dryRun) await recordScore(brand.id, score, flags);

    // 2. Covenant deterioration — new insolvency or accounts overdue in last 7d
    const recentInsolv = sigs.rows.find((s: any) =>
      (s.signal_type === "closure" || s.sentiment === "negative") &&
      new Date(s.created_at) >= new Date(Date.now() - 7 * 86400000) &&
      /insolven|administrat|liquidat|wind.up|ccj|adverse/i.test(s.headline || "")
    );
    if (recentInsolv) {
      events.push({
        brandId: brand.id, brandName: brand.name, type: "covenant_risk",
        headline: `${brand.name} — covenant red flag`,
        detail: `Recent signal: ${recentInsolv.headline}. Review covenant before any new pitch.`,
        recipients: await getRecipientsForBrand(brand.id),
      });
    }

    // 3. Live fundraise — funding signal of any magnitude in last 24h
    const recentFunding = sigs.rows.find((s: any) =>
      s.signal_type === "funding" &&
      new Date(s.created_at) >= new Date(Date.now() - 86400000)
    );
    if (recentFunding) {
      events.push({
        brandId: brand.id, brandName: brand.name, type: "fundraise",
        headline: `${brand.name} just raised`,
        detail: `${recentFunding.headline}. Hot moment to reach out — they're spending.`,
        recipients: await getRecipientsForBrand(brand.id),
      });
    }

    // 4. Major exec change — positive sentiment + magnitude large in last 7d
    const recentExec = sigs.rows.find((s: any) =>
      s.signal_type === "exec_change" &&
      s.magnitude === "large" &&
      new Date(s.created_at) >= new Date(Date.now() - 7 * 86400000)
    );
    if (recentExec) {
      events.push({
        brandId: brand.id, brandName: brand.name, type: "exec_change_major",
        headline: `${brand.name} — major leadership move`,
        detail: `${recentExec.headline}. New leadership often means new property strategy.`,
        recipients: await getRecipientsForBrand(brand.id),
      });
    }
  }

  return events;
}

// ─── Email rendering ─────────────────────────────────────────────────────

function renderAlertEmail(event: TriggerEvent, baseUrl = ""): { subject: string; body: string } {
  const typeEmoji: Record<TriggerEvent["type"], string> = {
    hunter_hot: "🔥",
    hunter_cooling: "❄️",
    covenant_risk: "⚠️",
    fundraise: "💰",
    exec_change_major: "👤",
  };
  const subject = `${typeEmoji[event.type]} BGP alert — ${event.headline}`;

  const url = `${baseUrl}/companies?brand=${event.brandId}`;
  const body = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#fff">
  <div style="background:${BGP_GREEN};padding:14px 18px;border-radius:8px 8px 0 0">
    <h1 style="color:white;margin:0;font-size:18px;font-weight:700">${typeEmoji[event.type]} ${event.headline}</h1>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:18px">
    <p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.5">${event.detail}</p>
    <a href="${url}" style="display:inline-block;background:${BGP_GREEN};color:white;text-decoration:none;padding:8px 14px;border-radius:6px;font-size:13px;font-weight:600">Open ${event.brandName} profile →</a>
    <p style="margin:16px 0 0;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af">
      Bruce Gillingham Pollard · Brand alerts · You're receiving this because you cover this brand.
    </p>
  </div>
</body>
</html>`;
  return { subject, body };
}

// ─── Endpoints ───────────────────────────────────────────────────────────

router.get("/api/brand-triggers/preview", requireAuth, async (req: Request, res: Response) => {
  try {
    const events = await scanBrandTriggers({ dryRun: true });
    res.json({ events: events.map(e => ({ ...e, recipients: e.recipients.length })) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/brand-triggers/run", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const adminCheck = await pool.query(`SELECT is_admin FROM users WHERE id = $1`, [userId]);
    if (!adminCheck.rows[0]?.is_admin) return res.status(403).json({ error: "Admin only" });

    const events = await scanBrandTriggers({ dryRun: false });
    let sent = 0;
    for (const event of events) {
      for (const to of event.recipients) {
        try {
          const { subject, body } = renderAlertEmail(event);
          await sendSharedMailboxEmail({ to, subject, body });
          sent++;
        } catch (e: any) {
          console.warn(`[brand-triggers] email to ${to} failed:`, e.message);
        }
      }
    }
    res.json({ events: events.length, sent });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export async function runDailyBrandTriggers(): Promise<{ events: number; sent: number }> {
  try {
    const events = await scanBrandTriggers({ dryRun: false });
    let sent = 0;
    for (const event of events) {
      for (const to of event.recipients) {
        try {
          const { subject, body } = renderAlertEmail(event);
          await sendSharedMailboxEmail({ to, subject, body });
          sent++;
        } catch {}
      }
    }
    console.log(`[brand-triggers] ${events.length} alerts → ${sent} emails sent`);
    return { events: events.length, sent };
  } catch (err: any) {
    console.error("[brand-triggers] daily run failed:", err?.message);
    return { events: 0, sent: 0 };
  }
}

export default router;
