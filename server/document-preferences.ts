/**
 * Document design preferences — small helpers for the
 * `document_design_preferences` table.
 *
 * The whole architecture is intentionally minimal: one table of free-text
 * rows, one helper to fetch active rows for a scope, one helper to render
 * them as a "House preferences" prompt fragment. Claude reads them and
 * applies them creatively — no rigid override schema, no per-field tools.
 *
 * Add a preference: ChatBGP sql_write into the table, or the inline UI
 * panel on the Pathway page. Disable a preference: set enabled=false.
 *
 * To support a new document type (e.g. KYC Clouseau briefs), pick a new
 * `scope` string and call getActivePreferences/formatForPrompt with it.
 */

import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";

export interface DesignPreference {
  id: string;
  scope: string;
  preference: string;
  category: string | null;
  addedAt: string;
}

/**
 * Active preferences for a scope, newest-first. Disabled rows are
 * excluded. Cap at 100 — past that the prompt gets unwieldy and the team
 * should tidy stale prefs.
 */
export async function getActivePreferences(scope: string): Promise<DesignPreference[]> {
  const r = await pool.query<any>(
    `SELECT id, scope, preference, category,
            to_char(added_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS added_at
       FROM document_design_preferences
      WHERE scope = $1 AND enabled = true
      ORDER BY added_at DESC
      LIMIT 100`,
    [scope],
  );
  return r.rows.map((row) => ({
    id: row.id,
    scope: row.scope,
    preference: row.preference,
    category: row.category,
    addedAt: row.added_at,
  }));
}

/**
 * Render preferences as a prompt fragment. Empty string when there are
 * no preferences (so the prompt stays clean for fresh document types).
 *
 * Output looks like:
 *
 *   ---
 *   House preferences (apply these unless told otherwise for this doc):
 *   - Always use the brochure hero on the cover.
 *   - Summarise owner as the company name only.
 *   - Hide the Last Paid box if no data.
 *   ---
 */
export function formatForPrompt(prefs: DesignPreference[]): string {
  if (prefs.length === 0) return "";
  // Group by category so related prefs stay together; uncategorised first.
  const byCategory = new Map<string, DesignPreference[]>();
  for (const p of prefs) {
    const k = p.category || "_general";
    if (!byCategory.has(k)) byCategory.set(k, []);
    byCategory.get(k)!.push(p);
  }
  const parts: string[] = [];
  parts.push("---");
  parts.push("House preferences (apply these unless told otherwise for this doc):");
  // _general first
  const general = byCategory.get("_general") || [];
  for (const p of general) parts.push(`- ${p.preference}`);
  // then named categories alphabetically
  const named = Array.from(byCategory.keys()).filter((k) => k !== "_general").sort();
  for (const cat of named) {
    parts.push(`\n${cat.toUpperCase()}:`);
    for (const p of byCategory.get(cat)!) parts.push(`- ${p.preference}`);
  }
  parts.push("---");
  return parts.join("\n");
}

/**
 * Convenience: scope → ready-to-paste prompt fragment. Use this in
 * generation paths that don't need the raw rows.
 */
export async function preferencesPromptFor(scope: string): Promise<string> {
  const prefs = await getActivePreferences(scope);
  return formatForPrompt(prefs);
}

/**
 * REST surface for the inline UI panel. ChatBGP already manages this
 * table via sql_write — these routes are purely for the click-driven
 * "House style" widget on Pathway / wherever else.
 */
export function setupDocumentPreferencesRoutes(app: Express) {
  // List preferences for a scope (or all). Active rows by default; pass
  // ?includeDisabled=1 to see history.
  app.get("/api/document-design-preferences", requireAuth, async (req: Request, res: Response) => {
    try {
      const scope = String(req.query.scope || "").trim();
      const includeDisabled = req.query.includeDisabled === "1";
      const where: string[] = [];
      const params: any[] = [];
      if (scope) { params.push(scope); where.push(`scope = $${params.length}`); }
      if (!includeDisabled) where.push(`enabled = true`);
      const sql = `
        SELECT id, scope, preference, category, enabled, added_by,
               to_char(added_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS added_at,
               to_char(disabled_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS disabled_at,
               notes
          FROM document_design_preferences
          ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY added_at DESC
         LIMIT 200`;
      const r = await pool.query(sql, params);
      res.json(r.rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Add a preference. body: { scope, preference, category?, notes? }
  app.post("/api/document-design-preferences", requireAuth, async (req: any, res: Response) => {
    try {
      const { scope, preference, category, notes } = req.body || {};
      if (!scope || !String(scope).trim()) return res.status(400).json({ error: "scope required" });
      if (!preference || !String(preference).trim()) return res.status(400).json({ error: "preference required" });
      const userId = req.session?.userId || (req as any).tokenUserId || null;
      const r = await pool.query(
        `INSERT INTO document_design_preferences (scope, preference, category, added_by, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, scope, preference, category, enabled,
                   to_char(added_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS added_at`,
        [String(scope).trim(), String(preference).trim(), category || null, userId, notes || null],
      );
      res.json(r.rows[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Disable a preference (soft delete — preserves history). PATCH instead
  // of DELETE because we keep the row.
  app.patch("/api/document-design-preferences/:id/disable", requireAuth, async (req: Request, res: Response) => {
    try {
      const r = await pool.query(
        `UPDATE document_design_preferences
            SET enabled = false, disabled_at = now()
          WHERE id = $1
          RETURNING id`,
        [req.params.id],
      );
      if (!r.rows[0]) return res.status(404).json({ error: "not found" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Re-enable (in case a disabled one needs to come back).
  app.patch("/api/document-design-preferences/:id/enable", requireAuth, async (req: Request, res: Response) => {
    try {
      const r = await pool.query(
        `UPDATE document_design_preferences
            SET enabled = true, disabled_at = NULL
          WHERE id = $1
          RETURNING id`,
        [req.params.id],
      );
      if (!r.rows[0]) return res.status(404).json({ error: "not found" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
