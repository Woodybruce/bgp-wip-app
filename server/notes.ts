// ─────────────────────────────────────────────────────────────────────────
// Notes — free-form notes that know the CRM (Woody, 2026-08-05: "if we
// make it as good or better than OneNote people will use it more").
//
// A note attaches to a deal / property / brand / contact (or stands alone),
// indexes into the knowledge_base so ChatBGP can quote it, and gets an AI
// action-extraction pass on save: anything that reads like a commitment
// becomes a SUGGESTED task — one tap to accept, never auto-created.
//
// Sources:
//   app    — typed in the app (staff)
//   onenote— imported from a OneNote page (BGP users; per-notebook import
//            via getNotebookFromWebUrl, which still works when account-wide
//            enumeration dies with Graph error 10008 at 5,000+ items)
//   teams  — meeting transcript ingested by the Teams sweep (teams-notes.ts)
//
// Staff-only for now: notes carry BGP-internal candour. Client-safe meeting
// summaries reach Landsec through the Teams sweep's sanitised path instead.
// ─────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";

export async function ensureNotesTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      deal_id VARCHAR, property_id VARCHAR, company_id VARCHAR, contact_id VARCHAR,
      author_id VARCHAR NOT NULL,
      source TEXT NOT NULL DEFAULT 'app',
      onenote_page_url TEXT,
      meeting_ref TEXT,
      suggested_actions JSONB,
      kb_id TEXT,
      created_at TIMESTAMP DEFAULT now(),
      updated_at TIMESTAMP DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notes_entities ON notes (property_id, deal_id, company_id, contact_id)`);
  // knowledge_base ids are uuids — early installs created kb_id as INT.
  await pool.query(`ALTER TABLE notes ALTER COLUMN kb_id TYPE TEXT`).catch(() => {});
}

async function staffOnly(req: Request, res: Response): Promise<boolean> {
  const { isClientRequestUser } = await import("./company-scope");
  if (await isClientRequestUser(req as any)) {
    res.status(403).json({ error: "Not available for client accounts" });
    return false;
  }
  return true;
}

// Keep the knowledge bank in step so "what did we say about X" finds notes.
export async function indexNote(note: any): Promise<void> {
  try {
    const entity = note.property_id ? `/properties/${note.property_id}`
      : note.deal_id ? `/deals/${note.deal_id}`
      : note.company_id ? `/companies/${note.company_id}`
      : note.contact_id ? `/contacts/${note.contact_id}` : "/tasks";
    if (note.kb_id) {
      await pool.query(
        `UPDATE knowledge_base SET file_name = $1, content = $2, summary = $3, last_modified = now(), indexed_at = now() WHERE id = $4`,
        [note.title, note.body, note.body.slice(0, 300), note.kb_id]);
    } else {
      const r = await pool.query(
        `INSERT INTO knowledge_base (file_name, file_path, content, summary, category, source, file_url, ai_tags, last_modified, indexed_at)
         VALUES ($1, $2, $3, $4, 'Note', 'note', $5, ARRAY['note'], now(), now()) RETURNING id`,
        [note.title, `note/${note.id}`, note.body, note.body.slice(0, 300), entity]);
      await pool.query(`UPDATE notes SET kb_id = $1 WHERE id = $2`, [r.rows[0].id, note.id]);
    }
  } catch (e: any) { console.warn("[notes] knowledge index failed:", e?.message); }
}

// AI pass — pull action candidates out of the note. Suggestions only.
export async function extractActions(noteId: number): Promise<void> {
  const note = (await pool.query(`SELECT * FROM notes WHERE id = $1`, [noteId])).rows[0];
  if (!note || !note.body || note.body.length < 30) return;
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `Extract ACTION ITEMS from this commercial-property note. An action is a concrete commitment or next step ("send X", "chase Y by Friday", "book viewing"). Ignore observations and context. 0-6 actions; fewer is better.

NOTE "${note.title}":
${String(note.body).slice(0, 6000)}

Reply with ONLY JSON: {"actions": [{"title": "<imperative, max 80 chars>", "due_hint": "<e.g. 'Friday' or null>", "priority": "high"|"medium"|"low"}]}`,
      }],
    });
    const text = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const actions = (parsed.actions || []).slice(0, 6).map((a: any) => ({ ...a, accepted: false }));
    await pool.query(`UPDATE notes SET suggested_actions = $1 WHERE id = $2`, [JSON.stringify(actions), noteId]);
  } catch (e: any) { console.warn("[notes] action extraction failed:", e?.message); }
}

export function setupNotesRoutes(app: Express): void {
  app.get("/api/notes", requireAuth, async (req, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      await ensureNotesTables();
      const filters: string[] = []; const params: any[] = [];
      for (const [q, col] of [["propertyId", "property_id"], ["dealId", "deal_id"], ["companyId", "company_id"], ["contactId", "contact_id"]] as const) {
        if (req.query[q]) { params.push(String(req.query[q])); filters.push(`${col} = $${params.length}`); }
      }
      params.push(Math.min(100, parseInt(String(req.query.limit || "50")) || 50));
      const rows = await pool.query(
        `SELECT n.*, COALESCE(u.name, u.username) AS author_name
           FROM notes n LEFT JOIN users u ON u.id = n.author_id
          ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
          ORDER BY n.updated_at DESC LIMIT $${params.length}`, params);
      res.json({ notes: rows.rows });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/notes", requireAuth, async (req: any, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      await ensureNotesTables();
      const userId = req.session?.userId || req.tokenUserId;
      const { title, body, propertyId, dealId, companyId, contactId } = req.body || {};
      if (!title?.trim() && !body?.trim()) return res.status(400).json({ error: "Title or body required" });
      const r = await pool.query(
        `INSERT INTO notes (title, body, property_id, deal_id, company_id, contact_id, author_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [(title || body.slice(0, 60)).trim(), body || "", propertyId || null, dealId || null, companyId || null, contactId || null, userId]);
      const note = r.rows[0];
      indexNote(note);
      extractActions(note.id).catch(() => {});
      res.status(201).json(note);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/notes/:id", requireAuth, async (req: any, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const { title, body } = req.body || {};
      const r = await pool.query(
        `UPDATE notes SET title = COALESCE($1, title), body = COALESCE($2, body), updated_at = now() WHERE id = $3 RETURNING *`,
        [title ?? null, body ?? null, req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
      indexNote(r.rows[0]);
      extractActions(r.rows[0].id).catch(() => {});
      res.json(r.rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/notes/:id", requireAuth, async (req: any, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const userId = req.session?.userId || req.tokenUserId;
      const note = (await pool.query(`SELECT author_id, kb_id FROM notes WHERE id = $1`, [req.params.id])).rows[0];
      if (!note) return res.status(404).json({ error: "Not found" });
      const isAdmin = (await pool.query(`SELECT is_admin FROM users WHERE id = $1`, [userId])).rows[0]?.is_admin === true;
      if (!isAdmin && String(note.author_id) !== String(userId)) return res.status(403).json({ error: "Only the author can delete this note" });
      if (note.kb_id) await pool.query(`DELETE FROM knowledge_base WHERE id = $1`, [note.kb_id]).catch(() => {});
      await pool.query(`DELETE FROM notes WHERE id = $1`, [req.params.id]);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Accept one suggested action → real task, linked to the note's entity.
  app.post("/api/notes/:id/actions/:index/accept", requireAuth, async (req: any, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const userId = req.session?.userId || req.tokenUserId;
      const note = (await pool.query(`SELECT * FROM notes WHERE id = $1`, [req.params.id])).rows[0];
      if (!note) return res.status(404).json({ error: "Not found" });
      const idx = parseInt(String(req.params.index));
      const actions = Array.isArray(note.suggested_actions) ? note.suggested_actions : [];
      const action = actions[idx];
      if (!action) return res.status(400).json({ error: "No such action" });
      if (action.accepted) return res.status(409).json({ error: "Already accepted" });
      const task = await pool.query(
        `INSERT INTO user_tasks (user_id, title, priority, status, linked_property_id, linked_deal_id, linked_contact_id, source, source_ref)
         VALUES ($1, $2, $3, 'todo', $4, $5, $6, 'note', $7) RETURNING id, title`,
        [userId, action.title, action.priority || "medium", note.property_id, note.deal_id, note.contact_id, String(note.id)]);
      actions[idx] = { ...action, accepted: true, task_id: task.rows[0].id };
      await pool.query(`UPDATE notes SET suggested_actions = $1 WHERE id = $2`, [JSON.stringify(actions), note.id]);
      res.json({ ok: true, task: task.rows[0] });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // OneNote import for BGP users — bypasses the 5,000-item enumeration wall
  // by resolving ONE notebook from a pasted URL (Graph's documented escape
  // hatch), then walking its sections/pages by direct id.
  app.post("/api/notes/import/onenote/resolve", requireAuth, async (req: any, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const url = String(req.body?.url || "").trim();
      if (!url) return res.status(400).json({ error: "Paste a OneNote notebook link (Copy Link to Notebook)" });
      const { getValidMsToken } = await import("./microsoft");
      const msToken = await getValidMsToken(req);
      if (!msToken) return res.status(401).json({ error: "Microsoft not connected — sign out and back in" });
      const nb = await fetch("https://graph.microsoft.com/v1.0/me/onenote/notebooks/getNotebookFromWebUrl", {
        method: "POST", headers: { Authorization: `Bearer ${msToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ webUrl: url.split("?")[0] }),
      });
      if (!nb.ok) {
        const t = await nb.text().catch(() => "");
        return res.status(nb.status).json({ error: `Couldn't resolve that notebook (${nb.status}). ${t.slice(0, 150)}` });
      }
      const notebook = await nb.json();
      const secs = await fetch(`https://graph.microsoft.com/v1.0/me/onenote/notebooks/${notebook.id}/sections?$select=id,displayName`, {
        headers: { Authorization: `Bearer ${msToken}` } });
      const sections = secs.ok ? ((await secs.json()).value || []) : [];
      const out: any[] = [];
      for (const s of sections.slice(0, 20)) {
        const pg = await fetch(`https://graph.microsoft.com/v1.0/me/onenote/sections/${s.id}/pages?$select=id,title,lastModifiedDateTime&$top=30&$orderby=lastModifiedDateTime desc`, {
          headers: { Authorization: `Bearer ${msToken}` } });
        out.push({ id: s.id, name: s.displayName, pages: pg.ok ? ((await pg.json()).value || []).map((p: any) => ({ id: p.id, title: p.title, lastModified: p.lastModifiedDateTime })) : [] });
      }
      res.json({ notebook: { id: notebook.id, name: notebook.displayName }, sections: out });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/notes/import/onenote/page", requireAuth, async (req: any, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      await ensureNotesTables();
      const userId = req.session?.userId || req.tokenUserId;
      const { pageId, propertyId, dealId, companyId, contactId } = req.body || {};
      if (!pageId) return res.status(400).json({ error: "pageId required" });
      const { getValidMsToken } = await import("./microsoft");
      const msToken = await getValidMsToken(req);
      if (!msToken) return res.status(401).json({ error: "Microsoft not connected" });
      const meta = await fetch(`https://graph.microsoft.com/v1.0/me/onenote/pages/${pageId}?$select=id,title,links,lastModifiedDateTime`, {
        headers: { Authorization: `Bearer ${msToken}` } });
      if (!meta.ok) return res.status(meta.status).json({ error: "Couldn't read that page" });
      const page = await meta.json();
      const contentRes = await fetch(`https://graph.microsoft.com/v1.0/me/onenote/pages/${pageId}/content`, {
        headers: { Authorization: `Bearer ${msToken}` } });
      const html = contentRes.ok ? await contentRes.text() : "";
      const text = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 20000);
      const r = await pool.query(
        `INSERT INTO notes (title, body, property_id, deal_id, company_id, contact_id, author_id, source, onenote_page_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'onenote', $8) RETURNING *`,
        [page.title || "OneNote page", text, propertyId || null, dealId || null, companyId || null, contactId || null, userId,
         page.links?.oneNoteWebUrl?.href || null]);
      indexNote(r.rows[0]);
      extractActions(r.rows[0].id).catch(() => {});
      res.status(201).json(r.rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
