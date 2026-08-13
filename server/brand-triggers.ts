// ─────────────────────────────────────────────────────────────────────────
// Brand triggers — per-event alerts.
//
// Runs daily. For each tracked brand:
//   1. Recomputes hunter score; emits an alert if it crosses 70 (cold→hot)
//      or drops below 50 (hot→cooling).
//   2. Checks covenant signals — new insolvency notice, accounts overdue,
//      covenant deterioration from the house engine. Emits a covenant alert.
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
// Claude brand palette — used for transactional emails.
const CLAUDE_CORAL = "#C15F3C";
const CLAUDE_CREAM = "#F0EEE6";
const CLAUDE_INK = "#1F1F1E";
const CLAUDE_MUTED = "#87867F";
const CLAUDE_BORDER = "#E0DEDA";
const CLAUDE_FONT = `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;

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
    ALTER TABLE brand_score_history ADD COLUMN IF NOT EXISTS covenant_score INTEGER;
    ALTER TABLE brand_score_history ADD COLUMN IF NOT EXISTS covenant_red_flags INTEGER;
    ALTER TABLE brand_signals ADD COLUMN IF NOT EXISTS ai_relevant BOOLEAN;
  `);
}

// Alert-grade relevance check. Signals already judged (ai_relevant set at
// ingest or by the profile-page judge) use that verdict; unjudged rows get
// judged NOW — an alert email is exactly the wrong place to let a "Sky News"
// byline or a Fed-governor surname through. Fails open on judge errors.
async function signalIsRelevant(
  brand: { id: string; name: string },
  sig: { id: string; headline: string | null; ai_relevant: boolean | null },
): Promise<boolean> {
  if (sig.ai_relevant === false) return false;
  if (sig.ai_relevant === true) return true;
  try {
    const { aiJudgeSignalRelevance } = await import("./news-brand-linking");
    await aiJudgeSignalRelevance(brand, [{ id: sig.id, headline: sig.headline, detail: null }]);
    const { rows } = await pool.query(`SELECT ai_relevant FROM brand_signals WHERE id = $1`, [sig.id]);
    return rows[0]?.ai_relevant !== false;
  } catch {
    return true;
  }
}

// First signal in the candidate list that survives the relevance check.
async function firstRelevantSignal<T extends { id: string; headline: string | null; ai_relevant: boolean | null }>(
  brand: { id: string; name: string },
  candidates: T[],
): Promise<T | null> {
  for (const c of candidates) {
    if (await signalIsRelevant(brand, c)) return c;
  }
  return null;
}

async function getLastSnapshot(brandId: string): Promise<{
  hunterScore: number | null;
  covenantScore: number | null;
  covenantRedFlags: number | null;
}> {
  const { rows } = await pool.query(
    `SELECT hunter_score, covenant_score, covenant_red_flags FROM brand_score_history
      WHERE brand_company_id = $1 ORDER BY checked_at DESC LIMIT 1`,
    [brandId]
  );
  const row = rows[0];
  return {
    hunterScore: row?.hunter_score ?? null,
    covenantScore: row?.covenant_score ?? null,
    covenantRedFlags: row?.covenant_red_flags ?? null,
  };
}

async function recordScore(
  brandId: string,
  score: number,
  flags: string[],
  covenantScore: number | null,
  covenantRedFlags: number | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO brand_score_history (brand_company_id, hunter_score, flags, covenant_score, covenant_red_flags)
     VALUES ($1, $2, $3, $4, $5)`,
    [brandId, score, flags, covenantScore, covenantRedFlags]
  );
}

// Falls back to the most recent KYC investigation if the brand-level cache is empty.
// Current covenant position from the house engine's cached reports (written by
// the covenant engine — Companies House + Gazette + accounts, no Experian).
async function getCovenantSnapshot(brandId: string): Promise<{ score: number | null; redFlags: number | null; grade: string | null }> {
  const { rows } = await pool.query(
    `SELECT r.score, r.grade, jsonb_array_length(COALESCE(r.report->'flags', '[]'::jsonb)) AS n,
            (SELECT count(*) FROM jsonb_array_elements(COALESCE(r.report->'flags','[]'::jsonb)) fl WHERE fl->>'level' = 'red') AS reds
       FROM crm_companies c JOIN covenant_reports r
         ON r.company_number = regexp_replace(upper(c.companies_house_number), '\s', '', 'g')
      WHERE c.id = $1 LIMIT 1`,
    [brandId]
  ).catch(() => ({ rows: [] as any[] }));
  const row = rows[0];
  return { score: row?.score ?? null, redFlags: row?.reds != null ? Number(row.reds) : null, grade: row?.grade ?? null };
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
    // ai_relevant = false rows are judged junk (wrong-entity matches). The
    // profile page already filters them — the alert scan and the expansion
    // score must too, or the email digests exactly the noise the UI hides.
    const sigs = await pool.query(
      `SELECT id, signal_type, headline, magnitude, sentiment, created_at, signal_date, ai_relevant
         FROM brand_signals
        WHERE brand_company_id = $1
          AND ai_relevant IS DISTINCT FROM FALSE
          AND COALESCE(signal_date, created_at) >= now() - interval '365 days'`,
      [brand.id]
    );

    const { expansionScore: score, expansionFlags: flags } = computeHunterScore({
      brand,
      signals: sigs.rows,
      stock: null, // skip stock fetching here — keeps the scan fast
    });

    const prev = await getLastSnapshot(brand.id);
    const covenant = await getCovenantSnapshot(brand.id);

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

    if (!dryRun) await recordScore(brand.id, score, flags, covenant.score, covenant.redFlags);

    // 2. Covenant deterioration — three triggers, ordered by signal strength,
    //    all fed by the house covenant engine (CH + Gazette + accounts):
    //    a) new red flag on the covenant report (petition, insolvency, overdue)
    //    b) covenant score dropped 15+ points since the last scan
    //    c) recent news signal regex-matches insolvency keywords (fallback)
    const recipients = await getRecipientsForBrand(brand.id);

    if (
      covenant.redFlags != null && covenant.redFlags > 0 &&
      prev.covenantRedFlags != null && covenant.redFlags > prev.covenantRedFlags
    ) {
      events.push({
        brandId: brand.id, brandName: brand.name, type: "covenant_risk",
        headline: `${brand.name} — new covenant red flag`,
        detail: `House covenant red flags rose from ${prev.covenantRedFlags} to ${covenant.redFlags} (grade ${covenant.grade ?? "?"}). Open the covenant report before any new pitch.`,
        recipients,
      });
    } else if (
      covenant.score != null && prev.covenantScore != null &&
      prev.covenantScore - covenant.score >= 15
    ) {
      events.push({
        brandId: brand.id, brandName: brand.name, type: "covenant_risk",
        headline: `${brand.name} — covenant score dropped`,
        detail: `House covenant score fell from ${prev.covenantScore} to ${covenant.score} (grade ${covenant.grade ?? "?"}). Worth a quick review of recent filings.`,
        recipients,
      });
    } else {
      const recentInsolv = await firstRelevantSignal(brand, sigs.rows.filter((s: any) =>
        (s.signal_type === "closure" || s.sentiment === "negative") &&
        new Date(s.created_at) >= new Date(Date.now() - 7 * 86400000) &&
        /insolven|administrat|liquidat|wind.up|ccj|adverse/i.test(s.headline || "")
      ));
      if (recentInsolv) {
        events.push({
          brandId: brand.id, brandName: brand.name, type: "covenant_risk",
          headline: `${brand.name} — covenant red flag`,
          detail: `Recent signal: ${recentInsolv.headline}. Review covenant before any new pitch.`,
          recipients,
        });
      }
    }

    // 3. Live fundraise — funding signal of any magnitude in last 24h.
    // The classifier lumps raises, acquisitions and IPOs under "funding" —
    // only word the alert as "just raised" when the headline actually reads
    // like a raise (TfL defending its borrowing is not a hot spending moment).
    const recentFunding = await firstRelevantSignal(brand, sigs.rows.filter((s: any) =>
      s.signal_type === "funding" &&
      new Date(s.created_at) >= new Date(Date.now() - 86400000)
    ));
    if (recentFunding) {
      const isRaise = /\b(rais(e|es|ed|ing)|funding|investment|invests?|series [a-e]|secures|backs|backed)\b/i.test(recentFunding.headline || "");
      events.push({
        brandId: brand.id, brandName: brand.name, type: "fundraise",
        headline: isRaise ? `${brand.name} just raised` : `${brand.name} — money in motion`,
        detail: `${recentFunding.headline}. ${isRaise ? "Hot moment to reach out — they're spending." : "Funding/M&A signal — worth a look before someone else calls."}`,
        recipients,
      });
    }

    // 4. Major exec change — magnitude large in last 7d. Belt and braces on
    // top of the relevance judge: the brand must actually be named in the
    // headline. Retail round-ups name-drop half the high street; "River
    // Island — major leadership move" over a John Lewis story came from one.
    const brandToken = brand.name.trim().toLowerCase();
    const recentExec = await firstRelevantSignal(brand, sigs.rows.filter((s: any) =>
      s.signal_type === "exec_change" &&
      s.magnitude === "large" &&
      new Date(s.created_at) >= new Date(Date.now() - 7 * 86400000) &&
      (s.headline || "").toLowerCase().includes(brandToken)
    ));
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
    <tr style="border-bottom:1px solid ${CLAUDE_BORDER}">
      <td style="padding:12px 14px;font-size:14px;white-space:nowrap;vertical-align:top">${TYPE_EMOJI[e.type]}</td>
      <td style="padding:12px 14px">
        <div style="font-weight:600;font-size:14px;color:${CLAUDE_INK};letter-spacing:-0.01em"><a href="${url}" style="color:${CLAUDE_CORAL};text-decoration:none">${e.brandName}</a></div>
        <div style="font-size:13px;color:${CLAUDE_MUTED};margin-top:3px">${e.headline}</div>
        <div style="font-size:13px;color:${CLAUDE_INK};margin-top:5px;line-height:1.45">${e.detail}</div>
      </td>
    </tr>`;
  }).join("");

  const bgpLogo = `${baseUrl}/api/branding/assets/BGP_BlackWordmark_trimmed.png`;
  const sparkleSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-2px;margin-right:4px"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3z" fill="${CLAUDE_CORAL}"/><path d="M19 14l.8 2.4L22 17l-2.2.6L19 20l-.8-2.4L16 17l2.2-.6L19 14z" fill="${CLAUDE_CORAL}"/></svg>`;

  const body = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:${CLAUDE_FONT};max-width:600px;margin:0 auto;padding:24px;background:${CLAUDE_CREAM};color:${CLAUDE_INK}">
  <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
    <tr>
      <td style="vertical-align:middle">
        <img src="${bgpLogo}" alt="Bruce Gillingham Pollard" height="28" style="display:block;height:28px;width:auto"/>
      </td>
      <td style="vertical-align:middle;text-align:right;font-size:13px;font-weight:600;color:${CLAUDE_INK};letter-spacing:-0.01em">
        ${sparkleSvg}<span style="vertical-align:middle">ChatBGP</span>
      </td>
    </tr>
  </table>
  <div style="background:#fff;border:1px solid ${CLAUDE_BORDER};border-radius:12px;overflow:hidden">
    <div style="padding:20px 22px;border-bottom:1px solid ${CLAUDE_BORDER}">
      <h1 style="color:${CLAUDE_INK};margin:0;font-size:20px;font-weight:600;letter-spacing:-0.02em;font-family:${CLAUDE_FONT}">BGP Brand Alerts</h1>
      <p style="color:${CLAUDE_MUTED};margin:4px 0 0;font-size:13px">${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })} · ${events.length} alert${events.length !== 1 ? "s" : ""} today</p>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <tbody>${rows}</tbody>
    </table>
  </div>
  <p style="margin:18px 4px 0;font-size:12px;color:${CLAUDE_MUTED};font-family:${CLAUDE_FONT}">
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
      } catch (e: any) {
        // Never swallow silently — a mail-transport failure (e.g. an expired
        // Azure client secret) is exactly how these alerts went dark before.
        console.error(`[brand-triggers] digest email to ${to} failed:`, e?.message);
      }
    }
    console.log(`[brand-triggers] ${events.length} alerts → ${sent}/${byRecipient.size} digest emails sent`);
    return { events: events.length, sent };
  } catch (err: any) {
    console.error("[brand-triggers] daily run failed:", err?.message);
    return { events: 0, sent: 0 };
  }
}

export default router;
