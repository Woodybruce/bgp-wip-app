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
    ALTER TABLE brand_score_history ADD COLUMN IF NOT EXISTS experian_score INTEGER;
    ALTER TABLE brand_score_history ADD COLUMN IF NOT EXISTS experian_ccj_count INTEGER;
  `);
}

async function getLastSnapshot(brandId: string): Promise<{
  hunterScore: number | null;
  experianScore: number | null;
  experianCcjCount: number | null;
}> {
  const r = await pool.query(
    `SELECT hunter_score, experian_score, experian_ccj_count FROM brand_score_history
      WHERE brand_company_id = $1
      ORDER BY checked_at DESC LIMIT 1`,
    [brandId]
  );
  const row = r.rows[0];
  return {
    hunterScore: row?.hunter_score ?? null,
    experianScore: row?.experian_score ?? null,
    experianCcjCount: row?.experian_ccj_count ?? null,
  };
}

async function recordScore(
  brandId: string,
  score: number,
  flags: string[],
  experianScore: number | null,
  experianCcjCount: number | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO brand_score_history (brand_company_id, hunter_score, flags, experian_score, experian_ccj_count)
     VALUES ($1, $2, $3, $4, $5)`,
    [brandId, score, flags, experianScore, experianCcjCount]
  );
}

// Pull the latest Experian snapshot for a brand from companies_house_data JSONB.
// Falls back to the most recent KYC investigation if the brand-level cache is empty.
async function getExperianSnapshot(brandId: string): Promise<{ score: number | null; ccjCount: number | null }> {
  const r = await pool.query(
    `SELECT companies_house_data->'experian' AS exp FROM crm_companies WHERE id = $1`,
    [brandId]
  );
  let exp: any = r.rows[0]?.exp || null;
  if (!exp) {
    const inv = await pool.query(
      `SELECT result->'experian' AS exp FROM kyc_investigations
        WHERE crm_company_id = $1 ORDER BY conducted_at DESC LIMIT 1`,
      [brandId]
    );
    exp = inv.rows[0]?.exp || null;
  }
  if (!exp) return { score: null, ccjCount: null };
  const score = typeof exp.creditScore === "number" ? exp.creditScore : null;
  const ccjCount = typeof exp.ccj === "number" ? exp.ccj : null;
  return { score, ccjCount };
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

    const prev = await getLastSnapshot(brand.id);
    const experian = await getExperianSnapshot(brand.id);

    // 1. Score crossings
    if (prev.hunterScore != null) {
      if (prev.hunterScore < HOT_THRESHOLD && score >= HOT_THRESHOLD) {
        events.push({
          brandId: brand.id, brandName: brand.name, type: "hunter_hot",
          headline: `${brand.name} just turned HOT (${prev.hunterScore} → ${score})`,
          detail: `Expansion score crossed ${HOT_THRESHOLD}. Flags: ${flags.join(", ")}`,
          recipients: await getRecipientsForBrand(brand.id),
        });
      } else if (prev.hunterScore >= HOT_THRESHOLD && score < COOLING_THRESHOLD) {
        events.push({
          brandId: brand.id, brandName: brand.name, type: "hunter_cooling",
          headline: `${brand.name} is cooling (${prev.hunterScore} → ${score})`,
          detail: `Expansion score dropped from ${prev.hunterScore} to ${score}. Worth a check-in before they go dark.`,
          recipients: await getRecipientsForBrand(brand.id),
        });
      }
    }

    if (!dryRun) await recordScore(brand.id, score, flags, experian.score, experian.ccjCount);

    // 2. Covenant deterioration — three triggers, ordered by signal strength.
    //    a) Experian CCJ count went up since the last scan (hard data)
    //    b) Experian credit score dropped 15+ points since the last scan
    //    c) Recent news signal regex-matches insolvency keywords (legacy fallback)
    const recipients = await getRecipientsForBrand(brand.id);

    if (
      experian.ccjCount != null && experian.ccjCount > 0 &&
      prev.experianCcjCount != null && experian.ccjCount > prev.experianCcjCount
    ) {
      events.push({
        brandId: brand.id, brandName: brand.name, type: "covenant_risk",
        headline: `${brand.name} — new CCJ filed`,
        detail: `Experian CCJ count rose from ${prev.experianCcjCount} to ${experian.ccjCount}. Pull the credit report and review covenant before any new pitch.`,
        recipients,
      });
    } else if (
      experian.score != null && prev.experianScore != null &&
      prev.experianScore - experian.score >= 15
    ) {
      events.push({
        brandId: brand.id, brandName: brand.name, type: "covenant_risk",
        headline: `${brand.name} — Experian score dropped`,
        detail: `Credit score fell from ${prev.experianScore} to ${experian.score} (${prev.experianScore - experian.score} points). Worth a quick review of recent filings.`,
        recipients,
      });
    } else {
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
          recipients,
        });
      }
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
        recipients,
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
        recipients,
      });
    }
  }

  return events;
}

// ─── Email rendering ─────────────────────────────────────────────────────

const TYPE_EMOJI: Record<TriggerEvent["type"], string> = {
  hunter_hot: "🔥",
  hunter_cooling: "❄️",
  covenant_risk: "⚠️",
  fundraise: "💰",
  exec_change_major: "👤",
};

function appBaseUrl(): string {
  const raw = process.env.PUBLIC_APP_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")
    || "https://bgp-wip-app-production-efac.up.railway.app";
  return raw.replace(/\/+$/, "");
}

function renderDigestEmail(events: TriggerEvent[]): { subject: string; body: string } {
  const baseUrl = appBaseUrl();

  const hotCount = events.filter(e => e.type === "hunter_hot").length;
  const riskCount = events.filter(e => e.type === "covenant_risk").length;
  const otherCount = events.length - hotCount - riskCount;

  const summaryParts: string[] = [];
  if (hotCount) summaryParts.push(`${hotCount} brand${hotCount > 1 ? "s" : ""} hot`);
  if (riskCount) summaryParts.push(`${riskCount} covenant risk${riskCount > 1 ? "s" : ""}`);
  if (otherCount) summaryParts.push(`${otherCount} other alert${otherCount > 1 ? "s" : ""}`);
  const subject = `BGP brand alerts — ${summaryParts.join(", ")}`;

  const rows = events.map(e => {
    const url = `${baseUrl}/companies/${e.brandId}`;
    return `
    <tr style="border-bottom:1px solid #e5e7eb">
      <td style="padding:10px 12px;font-size:13px;white-space:nowrap">${TYPE_EMOJI[e.type]}</td>
      <td style="padding:10px 12px">
        <div style="font-weight:600;font-size:13px;color:#111827"><a href="${url}" style="color:${BGP_GREEN};text-decoration:none">${e.brandName}</a></div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px">${e.headline}</div>
        <div style="font-size:12px;color:#374151;margin-top:4px">${e.detail}</div>
      </td>
    </tr>`;
  }).join("");

  const body = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#fff">
  <div style="background:${BGP_GREEN};padding:14px 18px;border-radius:8px 8px 0 0">
    <h1 style="color:white;margin:0;font-size:17px;font-weight:700">BGP Brand Alerts — ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}</h1>
    <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:12px">${events.length} alert${events.length !== 1 ? "s" : ""} today</p>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
    <table style="width:100%;border-collapse:collapse">
      <tbody>${rows}</tbody>
    </table>
  </div>
  <p style="margin:16px 0 0;font-size:11px;color:#9ca3af">
    Bruce Gillingham Pollard · Brand alerts · You're receiving this because you cover these brands.
  </p>
</body>
</html>`;
  return { subject, body };
}

function groupEventsByRecipient(events: TriggerEvent[]): Map<string, TriggerEvent[]> {
  const map = new Map<string, TriggerEvent[]>();
  for (const event of events) {
    for (const to of event.recipients) {
      if (!map.has(to)) map.set(to, []);
      map.get(to)!.push(event);
    }
  }
  return map;
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
    const byRecipient = groupEventsByRecipient(events);
    for (const [to, recipientEvents] of byRecipient) {
      try {
        const { subject, body } = renderDigestEmail(recipientEvents);
        await sendSharedMailboxEmail({ to, subject, body });
        sent++;
      } catch (e: any) {
        console.warn(`[brand-triggers] email to ${to} failed:`, e.message);
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
    const byRecipient = groupEventsByRecipient(events);
    for (const [to, recipientEvents] of byRecipient) {
      try {
        const { subject, body } = renderDigestEmail(recipientEvents);
        await sendSharedMailboxEmail({ to, subject, body });
        sent++;
      } catch {}
    }
    console.log(`[brand-triggers] ${events.length} alerts → ${sent} digest emails sent`);
    return { events: events.length, sent };
  } catch (err: any) {
    console.error("[brand-triggers] daily run failed:", err?.message);
    return { events: 0, sent: 0 };
  }
}

export default router;
