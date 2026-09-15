// Decks — REST surface for the app-wide composable document primitive.
// Schema and architectural notes live in shared/schema.ts.
//
// This file owns CRUD for decks + their cards + the template catalogue.
// Assembly (deck → designed PDF) is deliberately a separate concern and
// will land in deck-assembler.ts once Phase 1.5 starts. Until then the
// /assemble endpoint returns 501.

import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

interface TemplateCardSeed {
  type: string;
  title?: string;
  sortOrder?: number;
  state?: "draft" | "locked";
  content?: any;
  assetRefs?: any;
}

export function setupDeckRoutes(app: Express) {
  // ── Templates ───────────────────────────────────────────────────────
  app.get("/api/deck-templates", requireAuth, async (_req, res) => {
    try {
      const r = await pool.query(
        `SELECT key, name, description, default_cards, pdf_scope, active, created_at
         FROM deck_templates WHERE active = true ORDER BY name`
      );
      res.json(r.rows);
    } catch (e: any) {
      console.error("[decks] list templates:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Decks list ──────────────────────────────────────────────────────
  // Supports filtering by template, status, propertyId, companyId, dealId.
  // Used by both the /decks page and contextual panels on property /
  // brand / deal pages.
  app.get("/api/decks", requireAuth, async (req, res) => {
    try {
      const where: string[] = [];
      const params: any[] = [];
      const push = (clause: string, value: any) => {
        params.push(value);
        where.push(clause.replace("$$", `$${params.length}`));
      };
      if (req.query.template) push(`template_key = $$`, String(req.query.template));
      if (req.query.status) push(`status = $$`, String(req.query.status));
      if (req.query.propertyId) push(`property_id = $$`, String(req.query.propertyId));
      if (req.query.companyId) push(`company_id = $$`, String(req.query.companyId));
      if (req.query.dealId) push(`deal_id = $$`, String(req.query.dealId));
      const sql = `
        SELECT d.id, d.name, d.template_key, d.property_id, d.company_id, d.deal_id,
               d.status, d.notes, d.created_by, d.created_at, d.updated_at,
               (SELECT COUNT(*)::int FROM deck_cards c WHERE c.deck_id = d.id) AS card_count,
               (SELECT COUNT(*)::int FROM deck_cards c WHERE c.deck_id = d.id AND c.state = 'locked') AS locked_count,
               t.name AS template_name,
               t.pdf_scope AS template_pdf_scope
        FROM decks d
        LEFT JOIN deck_templates t ON t.key = d.template_key
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY d.updated_at DESC
        LIMIT 200`;
      const r = await pool.query(sql, params);
      res.json(r.rows);
    } catch (e: any) {
      console.error("[decks] list:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Create deck ─────────────────────────────────────────────────────
  // Required: name, templateKey. Optional anchors: propertyId / companyId
  // / dealId. Cards are seeded from the template's defaultCards unless
  // the caller supplies their own `cards` payload (used by populators
  // that already have content to insert — Pathway, ChatBGP).
  app.post("/api/decks", requireAuth, async (req: any, res: Response) => {
    try {
      const { name, templateKey, propertyId, companyId, dealId, notes, cards } = req.body || {};
      if (!name || !templateKey) {
        return res.status(400).json({ error: "name and templateKey are required" });
      }
      const userId = req.session?.userId || req.tokenUserId || null;

      const template = await pool.query(
        `SELECT key, default_cards FROM deck_templates WHERE key = $1 AND active = true`,
        [templateKey]
      );
      if (!template.rows[0]) {
        return res.status(400).json({ error: `Unknown or inactive template '${templateKey}'` });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const deckRow = await client.query(
          `INSERT INTO decks (name, template_key, property_id, company_id, deal_id, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [name, templateKey, propertyId || null, companyId || null, dealId || null, notes || null, userId]
        );
        const deck = deckRow.rows[0];

        const seeds: TemplateCardSeed[] = Array.isArray(cards) && cards.length
          ? cards
          : (template.rows[0].default_cards as TemplateCardSeed[]);

        const cardRows: any[] = [];
        for (const seed of seeds) {
          const inserted = await client.query(
            `INSERT INTO deck_cards (deck_id, type, sort_order, state, title, content, asset_refs)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
              deck.id,
              seed.type,
              typeof seed.sortOrder === "number" ? seed.sortOrder : 0,
              seed.state || "draft",
              seed.title || null,
              seed.content ? JSON.stringify(seed.content) : null,
              seed.assetRefs ? JSON.stringify(seed.assetRefs) : null,
            ]
          );
          cardRows.push(inserted.rows[0]);
        }
        await client.query("COMMIT");
        res.json({ deck, cards: cardRows });
      } catch (e: any) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } catch (e: any) {
      console.error("[decks] create:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Get a deck with its cards ───────────────────────────────────────
  app.get("/api/decks/:id", requireAuth, async (req, res) => {
    try {
      const deckRow = await pool.query(
        `SELECT d.*, t.name AS template_name, t.pdf_scope AS template_pdf_scope
         FROM decks d
         LEFT JOIN deck_templates t ON t.key = d.template_key
         WHERE d.id = $1`,
        [req.params.id]
      );
      if (!deckRow.rows[0]) return res.status(404).json({ error: "Deck not found" });
      const cards = await pool.query(
        `SELECT * FROM deck_cards WHERE deck_id = $1 ORDER BY sort_order, created_at`,
        [req.params.id]
      );
      res.json({ deck: deckRow.rows[0], cards: cards.rows });
    } catch (e: any) {
      console.error("[decks] get:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Update deck metadata (name, notes, anchors, status) ─────────────
  app.patch("/api/decks/:id", requireAuth, async (req, res) => {
    try {
      const updates: string[] = [];
      const params: any[] = [];
      const push = (col: string, val: any) => {
        params.push(val);
        updates.push(`${col} = $${params.length}`);
      };
      if (req.body.name !== undefined) push("name", req.body.name);
      if (req.body.notes !== undefined) push("notes", req.body.notes);
      if (req.body.status !== undefined) push("status", req.body.status);
      if (req.body.propertyId !== undefined) push("property_id", req.body.propertyId || null);
      if (req.body.companyId !== undefined) push("company_id", req.body.companyId || null);
      if (req.body.dealId !== undefined) push("deal_id", req.body.dealId || null);
      if (!updates.length) return res.status(400).json({ error: "No fields to update" });
      updates.push("updated_at = NOW()");
      params.push(req.params.id);
      const r = await pool.query(
        `UPDATE decks SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING *`,
        params
      );
      if (!r.rows[0]) return res.status(404).json({ error: "Deck not found" });
      res.json(r.rows[0]);
    } catch (e: any) {
      console.error("[decks] patch:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Delete a deck (cascades to its cards) ───────────────────────────
  app.delete("/api/decks/:id", requireAuth, async (req, res) => {
    try {
      await pool.query(`DELETE FROM deck_cards WHERE deck_id = $1`, [req.params.id]);
      const r = await pool.query(`DELETE FROM decks WHERE id = $1`, [req.params.id]);
      res.json({ deleted: (r.rowCount ?? 0) > 0 });
    } catch (e: any) {
      console.error("[decks] delete:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Update a card's content / title / sort order / state ────────────
  app.patch("/api/decks/:id/cards/:cardId", requireAuth, async (req, res) => {
    try {
      const updates: string[] = [];
      const params: any[] = [];
      const push = (col: string, val: any) => {
        params.push(val);
        updates.push(`${col} = $${params.length}`);
      };
      if (req.body.title !== undefined) push("title", req.body.title);
      if (req.body.content !== undefined) push("content", JSON.stringify(req.body.content));
      if (req.body.assetRefs !== undefined) push("asset_refs", JSON.stringify(req.body.assetRefs));
      if (req.body.sortOrder !== undefined) push("sort_order", Number(req.body.sortOrder));
      if (req.body.state !== undefined) {
        // Auto-clear lock metadata when transitioning back to draft so we
        // don't show stale 'locked by X' on a card the user is editing.
        push("state", req.body.state);
        if (req.body.state !== "locked") {
          push("locked_at", null);
          push("locked_by", null);
        }
      }
      if (!updates.length) return res.status(400).json({ error: "No fields to update" });
      updates.push("updated_at = NOW()");
      params.push(req.params.id, req.params.cardId);
      const r = await pool.query(
        `UPDATE deck_cards SET ${updates.join(", ")}
         WHERE deck_id = $${params.length - 1} AND id = $${params.length}
         RETURNING *`,
        params
      );
      if (!r.rows[0]) return res.status(404).json({ error: "Card not found" });
      // Touch the parent deck so list views surface recent edits.
      await pool.query(`UPDATE decks SET updated_at = NOW() WHERE id = $1`, [req.params.id]).catch(() => {});
      res.json(r.rows[0]);
    } catch (e: any) {
      console.error("[decks] patch card:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Lock / unlock a card ────────────────────────────────────────────
  // Distinct from a generic PATCH because it stamps locked_by / locked_at.
  app.post("/api/decks/:id/cards/:cardId/lock", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId || null;
      const r = await pool.query(
        `UPDATE deck_cards
         SET state = 'locked', locked_at = NOW(), locked_by = $1, updated_at = NOW()
         WHERE deck_id = $2 AND id = $3
         RETURNING *`,
        [userId, req.params.id, req.params.cardId]
      );
      if (!r.rows[0]) return res.status(404).json({ error: "Card not found" });
      res.json(r.rows[0]);
    } catch (e: any) {
      console.error("[decks] lock card:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/decks/:id/cards/:cardId/unlock", requireAuth, async (req, res) => {
    try {
      const r = await pool.query(
        `UPDATE deck_cards
         SET state = 'draft', locked_at = NULL, locked_by = NULL, updated_at = NOW()
         WHERE deck_id = $1 AND id = $2
         RETURNING *`,
        [req.params.id, req.params.cardId]
      );
      if (!r.rows[0]) return res.status(404).json({ error: "Card not found" });
      res.json(r.rows[0]);
    } catch (e: any) {
      console.error("[decks] unlock card:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Add a card to an existing deck ──────────────────────────────────
  app.post("/api/decks/:id/cards", requireAuth, async (req, res) => {
    try {
      const { type, title, content, assetRefs, sortOrder } = req.body || {};
      if (!type) return res.status(400).json({ error: "type is required" });
      // Default sort order = max + 10 so new cards land at the bottom
      // without colliding with existing ones.
      let order = typeof sortOrder === "number" ? sortOrder : null;
      if (order === null) {
        const m = await pool.query(
          `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM deck_cards WHERE deck_id = $1`,
          [req.params.id]
        );
        order = m.rows[0]?.next ?? 10;
      }
      const r = await pool.query(
        `INSERT INTO deck_cards (deck_id, type, sort_order, title, content, asset_refs)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          req.params.id,
          type,
          order,
          title || null,
          content ? JSON.stringify(content) : null,
          assetRefs ? JSON.stringify(assetRefs) : null,
        ]
      );
      await pool.query(`UPDATE decks SET updated_at = NOW() WHERE id = $1`, [req.params.id]).catch(() => {});
      res.json(r.rows[0]);
    } catch (e: any) {
      console.error("[decks] add card:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/decks/:id/cards/:cardId", requireAuth, async (req, res) => {
    try {
      const r = await pool.query(
        `DELETE FROM deck_cards WHERE deck_id = $1 AND id = $2`,
        [req.params.id, req.params.cardId]
      );
      res.json({ deleted: (r.rowCount ?? 0) > 0 });
    } catch (e: any) {
      console.error("[decks] delete card:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Assemble ────────────────────────────────────────────────────────
  // Pipes the deck's locked cards through the assembler → designed PDF.
  app.post("/api/decks/:id/assemble", requireAuth, async (req, res) => {
    try {
      const { assembleDeck } = await import("./deck-assembler");
      const result = await assembleDeck(req.params.id as string);
      if (!result.success) return res.status(400).json(result);
      res.json(result);
    } catch (e: any) {
      console.error("[decks] assemble:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Lightweight change-request creator (general utility) ────────────
  // Closes the gap where Claude Code / external callers had no way to
  // log a change request without going through ChatBGP. Mirrors the
  // shape of the request_app_change ChatBGP tool.
  app.post("/api/change-requests", requireAuth, async (req: any, res) => {
    try {
      const { description, category, priority } = req.body || {};
      if (!description || String(description).trim().length < 5) {
        return res.status(400).json({ error: "description (min 5 chars) is required" });
      }
      const userId = req.session?.userId || req.tokenUserId || null;
      let userName = "API caller";
      if (userId) {
        try {
          const { storage } = await import("./storage");
          const u = await storage.getUser(userId);
          if (u?.name) userName = u.name;
        } catch { /* keep default */ }
      }
      const r = await pool.query(
        `INSERT INTO app_change_requests (description, requested_by, requested_by_user_id, category, priority, status)
         VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`,
        [String(description).trim(), userName, userId, category || "feature", priority || "normal"]
      );
      res.json(r.rows[0]);
    } catch (e: any) {
      console.error("[change-requests] create:", e?.message);
      res.status(500).json({ error: e.message });
    }
  });
}
