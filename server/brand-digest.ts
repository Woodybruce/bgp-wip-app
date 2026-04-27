// ─────────────────────────────────────────────────────────────────────────
// Fortnightly brand intelligence digest.
//
// Every two weeks, compiles what changed for tracked brands (new signals,
// press coverage, status changes) and emails a branded HTML summary to BGP
// team members. Designed to keep the whole team across the brand landscape
// without having to check each profile individually.
//
// Endpoints:
//   GET  /api/brand-digest/preview           — HTML preview for browser
//   POST /api/brand-digest/send              — send right now (admin only)
//   GET  /api/brand-digest/schedule          — next scheduled send info
//
// Scheduled via cron in index.ts every 14 days (alternating Mondays 08:00).
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { sendSharedMailboxEmail } from "./shared-mailbox";

const router = Router();
const BGP_GREEN = "#2E5E3F";

const DIGEST_DAYS = 14;

// ─── Data layer ──────────────────────────────────────────────────────────

async function loadDigestData(sinceDays = DIGEST_DAYS) {
  const since = new Date(Date.now() - sinceDays * 86400000);

  // Tracked brands with new signals or news in the window
  const signalBrands = await pool.query(
    `SELECT DISTINCT bs.brand_company_id, c.name, c.rollout_status, c.hunter_flag,
            c.store_count, c.industry
       FROM brand_signals bs
       JOIN crm_companies c ON c.id = bs.brand_company_id
      WHERE bs.created_at >= $1
        AND c.is_tracked_brand = true
        AND c.merged_into_id IS NULL
      ORDER BY c.name`,
    [since]
  );

  const brandIds = signalBrands.rows.map((r: any) => r.brand_company_id);

  // Signals per brand
  const signalsQ = brandIds.length > 0 ? await pool.query(
    `SELECT brand_company_id, signal_type, headline, sentiment, magnitude,
            COALESCE(signal_date, created_at) AS ts
       FROM brand_signals
      WHERE brand_company_id = ANY($1::varchar[])
        AND created_at >= $2
      ORDER BY COALESCE(signal_date, created_at) DESC`,
    [brandIds, since]
  ) : { rows: [] };

  // Recent press per brand (name match)
  const pressByBrand: Record<string, Array<{ title: string; source: string | null; url: string; days_ago: number }>> = {};
  for (const b of signalBrands.rows) {
    const news = await pool.query(
      `SELECT title, source_name, url, published_at
         FROM news_articles
        WHERE (title ILIKE $1 OR summary ILIKE $1 OR ai_summary ILIKE $1)
          AND published_at >= $2
        ORDER BY published_at DESC LIMIT 3`,
      [`%${b.name}%`, since]
    ).catch(() => ({ rows: [] }));
    if (news.rows.length > 0) {
      pressByBrand[b.brand_company_id] = news.rows.map((r: any) => ({
        title: r.title,
        source: r.source_name,
        url: r.url,
        days_ago: r.published_at ? Math.floor((Date.now() - new Date(r.published_at).getTime()) / 86400000) : 0,
      }));
    }
  }

  // Group signals by brand
  const signalsByBrand: Record<string, any[]> = {};
  for (const s of signalsQ.rows) {
    if (!signalsByBrand[s.brand_company_id]) signalsByBrand[s.brand_company_id] = [];
    signalsByBrand[s.brand_company_id].push(s);
  }

  const brands = signalBrands.rows.map((b: any) => ({
    id: b.brand_company_id,
    name: b.name,
    rollout_status: b.rollout_status,
    hunter_flag: b.hunter_flag,
    signals: (signalsByBrand[b.brand_company_id] || []).slice(0, 4),
    press: pressByBrand[b.brand_company_id] || [],
  })).filter((b: any) => b.signals.length > 0 || b.press.length > 0);

  return { brands, since, until: new Date(), totalBrands: brands.length };
}

// ─── HTML renderer ────────────────────────────────────────────────────────

const SIGNAL_EMOJI: Record<string, string> = {
  opening: "🟢",
  closure: "🔴",
  funding: "💰",
  exec_change: "👤",
  sector_move: "🔄",
  rumour: "💬",
  news: "📰",
};

const ROLLOUT_LABELS: Record<string, string> = {
  entering_uk: "Entering UK",
  scaling: "Scaling",
  rumoured: "Rumoured",
  established: "Established",
  contracting: "Contracting",
};

function renderDigestHtml(data: Awaited<ReturnType<typeof loadDigestData>>, baseUrl = ""): string {
  const { brands, since, until } = data;
  const dateRange = `${since.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

  const brandBlocks = brands.map(b => {
    const url = `${baseUrl}/companies?brand=${b.id}`;
    const rolloutTag = b.rollout_status ? `<span style="display:inline-block;padding:1px 6px;background:#e7f3eb;color:${BGP_GREEN};border-radius:4px;font-size:11px;font-weight:600;margin-left:6px">${ROLLOUT_LABELS[b.rollout_status] || b.rollout_status}</span>` : "";
    const hunterTag = b.hunter_flag ? `<span style="display:inline-block;padding:1px 6px;background:#fef3c7;color:#92400e;border-radius:4px;font-size:11px;font-weight:600;margin-left:4px">🔥 Hunter</span>` : "";

    const signalRows = b.signals.map((s: any) => {
      const emoji = SIGNAL_EMOJI[s.signal_type] || "•";
      const sentColor = s.sentiment === "positive" ? "#065f46" : s.sentiment === "negative" ? "#991b1b" : "#374151";
      return `<tr>
        <td style="padding:3px 0;font-size:12px;color:${sentColor}">${emoji} <strong>${(s.signal_type || "").replace(/_/g, " ")}</strong> — ${s.headline || ""}</td>
      </tr>`;
    }).join("");

    const pressRows = b.press.map((p: any) => {
      const daysLabel = p.days_ago === 0 ? "Today" : p.days_ago === 1 ? "Yesterday" : `${p.days_ago}d ago`;
      return `<tr>
        <td style="padding:2px 0;font-size:11px;color:#6b7280">📰 <a href="${p.url}" style="color:#374151;text-decoration:none">${p.title}</a> ${p.source ? `<span style="color:#9ca3af">· ${p.source}</span>` : ""} <span style="color:#9ca3af">${daysLabel}</span></td>
      </tr>`;
    }).join("");

    return `
      <div style="margin-bottom:20px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#f9fafb;padding:10px 14px;border-bottom:1px solid #e5e7eb">
          <a href="${url}" style="font-size:14px;font-weight:700;color:${BGP_GREEN};text-decoration:none">${b.name}</a>${rolloutTag}${hunterTag}
        </div>
        <div style="padding:10px 14px">
          ${b.signals.length > 0 ? `<table style="width:100%;border-collapse:collapse">${signalRows}</table>` : ""}
          ${b.press.length > 0 ? `<table style="width:100%;border-collapse:collapse;margin-top:${b.signals.length > 0 ? 6 : 0}px">${pressRows}</table>` : ""}
        </div>
      </div>`;
  }).join("");

  const emptyNote = brands.length === 0
    ? `<p style="color:#6b7280;text-align:center;padding:24px">No brand activity detected in the past ${DIGEST_DAYS} days.</p>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#ffffff">
  <div style="background:${BGP_GREEN};padding:16px 20px;border-radius:8px 8px 0 0;margin-bottom:0">
    <h1 style="color:white;margin:0;font-size:20px;font-weight:700">BGP Brand Intelligence</h1>
    <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px">Fortnightly digest · ${dateRange}</p>
  </div>
  <div style="background:#f0f4f2;padding:10px 20px;border-radius:0 0 8px 8px;margin-bottom:20px">
    <p style="margin:0;font-size:13px;color:#374151">
      <strong>${brands.length} tracked brand${brands.length === 1 ? "" : "s"}</strong> with new signals or press coverage this fortnight.
    </p>
  </div>
  ${emptyNote}
  ${brandBlocks}
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center">
    Bruce Gillingham Pollard · Brand Intelligence Digest · Auto-generated by BGP Dashboard
  </div>
</body>
</html>`;
}

// ─── Endpoints ────────────────────────────────────────────────────────────

router.get("/api/brand-digest/preview", requireAuth, async (req: Request, res: Response) => {
  try {
    const days = Number(req.query.days) || DIGEST_DAYS;
    const data = await loadDigestData(days);
    const html = renderDigestHtml(data);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/brand-digest/send", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId as string;
    const adminCheck = await pool.query(`SELECT is_admin FROM users WHERE id = $1`, [userId]);
    if (!adminCheck.rows[0]?.is_admin) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const days = Number(req.body.days) || DIGEST_DAYS;
    // Recipients: all users with email addresses
    const usersQ = await pool.query(
      `SELECT email, name FROM users WHERE email IS NOT NULL AND email != '' ORDER BY name`
    );
    if (!usersQ.rows.length) {
      return res.status(400).json({ error: "No users with email addresses found" });
    }

    const data = await loadDigestData(days);
    const html = renderDigestHtml(data);
    const dateRange = `${data.since.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${data.until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
    const subject = `BGP Brand Intelligence Digest — ${dateRange}`;

    // Send to each recipient
    let sent = 0;
    const errors: string[] = [];
    for (const user of usersQ.rows) {
      try {
        await sendSharedMailboxEmail({ to: user.email, subject, body: html });
        sent++;
      } catch (e: any) {
        errors.push(`${user.email}: ${e.message}`);
      }
    }

    res.json({ sent, errors: errors.length > 0 ? errors : undefined, brands: data.totalBrands, dateRange });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export async function runFortnightlyBrandDigest(): Promise<{ sent: number; brands: number }> {
  const usersQ = await pool.query(
    `SELECT email FROM users WHERE email IS NOT NULL AND email != ''`
  );
  if (!usersQ.rows.length) return { sent: 0, brands: 0 };

  const data = await loadDigestData(DIGEST_DAYS);
  if (data.totalBrands === 0) {
    console.log("[brand-digest] No brand activity this fortnight — skipping email");
    return { sent: 0, brands: 0 };
  }

  const html = renderDigestHtml(data);
  const dateRange = `${data.since.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${data.until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  const subject = `BGP Brand Intelligence Digest — ${dateRange}`;

  let sent = 0;
  for (const user of usersQ.rows) {
    try {
      await sendSharedMailboxEmail({ to: user.email, subject, body: html });
      sent++;
    } catch {}
  }
  console.log(`[brand-digest] Sent to ${sent}/${usersQ.rows.length} users covering ${data.totalBrands} brands`);
  return { sent, brands: data.totalBrands };
}

export default router;
