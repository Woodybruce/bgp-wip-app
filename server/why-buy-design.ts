// Why Buy — Claude Design variant.
//
// Streams Claude-generated, self-contained HTML for the Why Buy deck so users
// can preview and iterate live in the app. Same brief as the Gamma path; the
// difference is Claude renders the deck inline as HTML (sandboxed iframe in
// the UI) rather than handing it to Gamma. Iterations layer on top — the user
// types "make it more punchy / drop section 3 / use BGP teal" and Claude
// re-emits the full HTML which we save as a new version.

import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { buildBrief } from "./why-buy-gamma";
import { preferencesPromptFor } from "./document-preferences";

const PREFERENCES_SCOPE = "why_buy";

const BGP_BRAND = `
BGP brand cues:
- Primary teal: #15616D
- Cream: #FBF5DF
- Charcoal: #001524
- Accent gold: #FF7D00
- Typography: serif headlines (display), sans-serif body. Tight tracking on headlines.
- Tone: confident, evidence-led, never hyperbolic. UK property language ('instructions', 'completions', 'lease events').
- Layout: generous whitespace, clear sections, big numbers, supporting evidence underneath.
`;

const BASE_PROMPT = `You are designing a Why Buy investment pitch deck for Bruce Gillingham Pollard (BGP), a UK commercial property advisor.

Output a SINGLE self-contained HTML document — no external assets, no scripts, all CSS inline in a <style> tag. Make it print-ready (A4 landscape, one slide per page using @page and page-break-after on each section). It should look like a polished pitch deck, not a webpage.

${BGP_BRAND}

The structure:
1. Cover slide — address, big hero number (price or yield), instructed-by line
2. Executive summary — 3-4 bullet "why this works" items
3. Property — area, use, key stats
4. Tenant / brand — who they are, covenant strength
5. Numbers — model outputs, IRR, equity multiple, exit
6. Comparable evidence — recent comps, market context
7. Risks & mitigants — honest, brief
8. Asks / next steps

Each slide:
- Full-page section with page-break-after: always
- A bold section number top-left, title in serif
- Big hero number or chart-like data viz where relevant
- Supporting data/text below
- BGP footer band on every slide

Return ONLY the HTML, starting with <!DOCTYPE html>. No commentary.`;

function safeHtml(html: string): string {
  // Strip script/iframe/object so the sandboxed preview is safe.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/on[a-z]+="[^"]*"/gi, "")
    .replace(/on[a-z]+='[^']*'/gi, "");
}

export function setupWhyBuyDesignRoutes(app: Express) {
  // List versions for a run
  app.get("/api/property-pathway/:runId/why-buy-design", requireAuth, async (req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, version, prompt, created_at, created_by_user_id
         FROM why_buy_designs WHERE run_id = $1 ORDER BY version DESC`,
        [req.params.runId]
      );
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get a specific version (full HTML)
  app.get("/api/property-pathway/:runId/why-buy-design/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, version, prompt, html, created_at FROM why_buy_designs WHERE id = $1 AND run_id = $2`,
        [req.params.id, req.params.runId]
      );
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      res.json(rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Render a single version as HTML for the iframe — text/html, X-Frame-
  // Options: SAMEORIGIN so the parent page can sandbox-embed it.
  app.get("/api/property-pathway/:runId/why-buy-design/:id/render", requireAuth, async (req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(`SELECT html FROM why_buy_designs WHERE id = $1`, [req.params.id]);
      if (!rows[0]) return res.status(404).send("Not found");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("Content-Security-Policy", "default-src 'unsafe-inline' data: blob:; img-src * data: blob:; font-src * data:; style-src 'unsafe-inline' *;");
      res.send(rows[0].html);
    } catch (e: any) {
      res.status(500).send(`<pre>${e.message}</pre>`);
    }
  });

  // Generate first version from the brief
  app.post("/api/property-pathway/:runId/why-buy-design/generate", requireAuth, async (req: any, res: Response) => {
    try {
      const userId = req.session?.userId || (req as any).tokenUserId || null;
      const built = await buildBrief(req.params.runId);
      // Active house preferences are injected as a prompt fragment so
      // every generation respects accumulated team direction (Nick saying
      // "always use the brochure hero on the cover" etc.) without
      // hardcoding it. Empty string when there are no prefs yet.
      const housePrefs = await preferencesPromptFor(PREFERENCES_SCOPE);
      const userPrompt = housePrefs
        ? `${BASE_PROMPT}\n\n${housePrefs}\n\n--- DEAL BRIEF ---\n\n${built.brief}`
        : `${BASE_PROMPT}\n\n--- DEAL BRIEF ---\n\n${built.brief}`;

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 16000,
        messages: [{ role: "user", content: userPrompt }],
      });
      const raw = msg.content?.[0]?.type === "text" ? msg.content[0].text : "";
      const html = safeHtml(raw.replace(/^```html\s*/i, "").replace(/```\s*$/i, "").trim());

      const next = await pool.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM why_buy_designs WHERE run_id = $1`,
        [req.params.runId]
      );
      const version = next.rows[0].v;

      const inserted = await pool.query(
        `INSERT INTO why_buy_designs (run_id, version, prompt, html, brief_snapshot, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id, version, created_at`,
        [req.params.runId, version, "Initial generation from brief", html, JSON.stringify({ title: built.title, address: built.address }), userId]
      );
      res.json({ id: inserted.rows[0].id, version, createdAt: inserted.rows[0].created_at });
    } catch (e: any) {
      console.error("[why-buy-design] generate error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Iterate — user types a prompt, Claude re-emits the full HTML based on the
  // last version. Saves a new row so the version history is preserved.
  app.post("/api/property-pathway/:runId/why-buy-design/iterate", requireAuth, async (req: any, res: Response) => {
    const { prompt, baseVersionId } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    try {
      const userId = req.session?.userId || (req as any).tokenUserId || null;

      // Find the base HTML — caller-provided id wins, else latest.
      let baseRows = baseVersionId
        ? await pool.query("SELECT html, version FROM why_buy_designs WHERE id = $1 AND run_id = $2", [baseVersionId, req.params.runId])
        : await pool.query("SELECT html, version FROM why_buy_designs WHERE run_id = $1 ORDER BY version DESC LIMIT 1", [req.params.runId]);
      if (!baseRows.rows[0]) return res.status(400).json({ error: "No base design — generate first" });
      const baseHtml = baseRows.rows[0].html;

      // House preferences also flow into iterations so the team's
      // accumulated direction stays in scope as the deck evolves — the
      // user's per-iteration prompt is layered on top.
      const housePrefs = await preferencesPromptFor(PREFERENCES_SCOPE);
      const prefsBlock = housePrefs ? `\n\n${housePrefs}\n` : "";

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 16000,
        messages: [{
          role: "user",
          content: `Here is the current HTML of a BGP Why Buy investment deck:\n\n${baseHtml}${prefsBlock}\n---\n\nUser request: ${prompt}\n\nReturn the FULL updated HTML (single self-contained document, inline CSS, print-ready A4 landscape). Apply the user's change while keeping everything else intact AND respecting the house preferences above. Return ONLY the HTML, starting with <!DOCTYPE html>. No commentary.`,
        }],
      });
      const raw = msg.content?.[0]?.type === "text" ? msg.content[0].text : "";
      const html = safeHtml(raw.replace(/^```html\s*/i, "").replace(/```\s*$/i, "").trim());

      const next = await pool.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM why_buy_designs WHERE run_id = $1`,
        [req.params.runId]
      );
      const version = next.rows[0].v;
      const inserted = await pool.query(
        `INSERT INTO why_buy_designs (run_id, version, prompt, html, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, version, created_at`,
        [req.params.runId, version, prompt, html, userId]
      );
      res.json({ id: inserted.rows[0].id, version, createdAt: inserted.rows[0].created_at });
    } catch (e: any) {
      console.error("[why-buy-design] iterate error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
}
