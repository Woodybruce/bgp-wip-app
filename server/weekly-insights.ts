// ─────────────────────────────────────────────────────────────────────────
// BGP Insights — weekly round-up (Woody, 2026-08-21: "end of the week round
// up doc... maybe for leasing first" — ChatBGP produced the first edition
// by hand; this schedules it).
//
// Every Friday afternoon, run a full staff-grade ChatBGP turn with the same
// brief as edition one: compile the week's deal flow, instructions, market
// press and pipeline into a designed PDF and email it to Woody to forward.
// Reuses the real ChatBGP (same tools, same quality) via chatbgp-internal;
// auth is a short-lived minted token for Woody's account, deleted after.
// ─────────────────────────────────────────────────────────────────────────
import crypto from "crypto";
import { pool } from "./db";

const RECIPIENT = "woody@brucegillinghampollard.com";
const RUN_DAY = 5;   // Friday
const RUN_HOUR = 14; // server clock (≈15:00 UK in summer)

// House style for the Insights doc (Woody, 2026-08-21: edition one was
// "not very BGP design" — teal/orange, no wordmark). Seeded once into
// document_design_preferences under scope 'bgp_insights'; from then on the
// team evolves the look by adding rows (same pattern as Why Buy decks).
const HOUSE_STYLE_SEED: Array<{ preference: string; category: string }> = [
  { preference: "Use the 2026 BGP rebrand palette (BGP Rebrand v18): Bordeaux #6E0C25 as the signature colour for headlines, stat blocks and emphasis; Nectar #FC9F8D as the single warm accent, used sparingly; Stone #C2BAA3 / stone-tinted off-white grounds for panels and backgrounds. Never green, teal, orange or navy.", category: "branding" },
  { preference: "Put the Bruce Gillingham Pollard wordmark at the top of page 1 and small in every footer — the wordmark, not the name typed out in tracked capitals.", category: "branding" },
  { preference: "Serif headlines with clean sans body text; generous margins; consistent light pages — no alternating dark/light page schemes.", category: "typography" },
  { preference: "Keep the strong information design of edition one: the six-stat strip up front, status pills on deal tables, the horizontal bar chart for scheme deep-dives, and the closing watch list.", category: "layout" },
];

async function ensureHouseStyle(): Promise<void> {
  try {
    // Retire the short-lived green rows (Woody, 2026-08-21: green isn't a
    // BGP colour — the live rebrand is Bordeaux/Nectar/Stone).
    await pool.query(
      `UPDATE document_design_preferences SET enabled = false, disabled_at = now()
        WHERE scope = 'bgp_insights' AND enabled = true
          AND (preference ILIKE '%#2E5E3F%' OR preference ILIKE '%Georgia-style%')`
    );
    for (const p of HOUSE_STYLE_SEED) {
      await pool.query(
        `INSERT INTO document_design_preferences (scope, preference, category, notes)
         SELECT 'bgp_insights', $1, $2, 'Seeded from Woody feedback, 2026-08-21'
          WHERE NOT EXISTS (SELECT 1 FROM document_design_preferences WHERE scope = 'bgp_insights' AND preference = $1)`,
        [p.preference, p.category]
      );
    }
  } catch (e: any) {
    console.warn("[bgp-insights] house-style seed failed:", e?.message);
  }
}

async function mintRunToken(): Promise<{ token: string; cleanup: () => Promise<void> } | null> {
  const u = await pool.query(`SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`, [RECIPIENT]);
  if (!u.rows[0]) return null;
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO auth_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + interval '2 hours')`,
    [token, u.rows[0].id]
  );
  return {
    token,
    cleanup: async () => { await pool.query(`DELETE FROM auth_tokens WHERE token = $1`, [token]).catch(() => {}); },
  };
}

export async function runWeeklyLeasingInsights(): Promise<void> {
  const minted = await mintRunToken();
  if (!minted) {
    console.warn("[bgp-insights] could not mint run token (recipient user missing)");
    return;
  }
  try {
    const { askChatBgp } = await import("./chatbgp-internal");
    await ensureHouseStyle();
    let housePrefs = "";
    try {
      const { preferencesPromptFor } = await import("./document-preferences");
      housePrefs = await preferencesPromptFor("bgp_insights");
    } catch {}
    const weekEnd = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const question = [
      `Compile this week's "BGP Insights — Leasing Week in Review (w/e ${weekEnd})".`,
      ``,
      `Structure it like the 21 August 2026 edition:`,
      `1. BGP deal flow this week — completions, invoicings, exchanges and notable stage moves from the CRM (deals updated in the last 7 days), with fees.`,
      `2. New instructions this week.`,
      `3. Market week — the most relevant press, expansion and distress signals from the news feeds and Propel briefings of the last 7 days; flag anything that intersects a live BGP requirement as pitch-ready.`,
      `4. Pipeline health — live deal count and total fee pipeline.`,
      `5. Watch list for next week with named actions.`,
      ``,
      ``,
      `Also close the loop on accountability: recall LAST week's "Watch list" items (search this thread history / your prior Insights emails if available) and open the new edition's watch-list section with one line each on what actually happened to them.`,
      ``,
      housePrefs ? `${housePrefs}\nFollow these house design preferences exactly when designing the PDF.` : ``,
      ``,
      `Then:`,
      `- Generate the round-up as a designed PDF titled "BGP Insights — Leasing Week in Review (w-e ${weekEnd})".`,
      `- Email that PDF as an attachment to ${RECIPIENT}, subject "BGP Insights — Leasing Week in Review (w/e ${weekEnd})", with a three-bullet summary in the body and a line that it's ready to forward to the leasing team.`,
      `Confirm exactly what you generated and sent.`,
    ].join("\n");
    const fakeReq: any = { headers: { authorization: `Bearer ${minted.token}` } };
    const out = await askChatBgp(question, fakeReq, { timeoutMs: 20 * 60 * 1000 });
    console.log(`[bgp-insights] weekly leasing edition ${out ? `completed (${out.length} chars)` : "FAILED (no reply)"}`);
  } catch (e: any) {
    console.error("[bgp-insights] weekly run failed:", e?.message);
  } finally {
    await minted.cleanup();
  }
}

// 5-minute tick with a persisted once-per-slot guard (same pattern as the
// deal-verdict jobs) so frequent deploys can't skip or double a Friday.
export async function tickWeeklyInsights(): Promise<void> {
  const now = new Date();
  if (now.getDay() !== RUN_DAY || now.getHours() !== RUN_HOUR) return;
  try {
    const slot = JSON.stringify(now.toISOString().slice(0, 10));
    const r = await pool.query(
      `INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb WHERE system_settings.value IS DISTINCT FROM $2::jsonb
       RETURNING key`,
      ["bgp-insights:leasing", slot]
    );
    if ((r.rowCount || 0) > 0) await runWeeklyLeasingInsights();
  } catch (e: any) {
    console.error("[bgp-insights] tick failed:", e?.message);
  }
}
