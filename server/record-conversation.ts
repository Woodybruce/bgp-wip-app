import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { storage } from "./storage";
import { propertyReadBlocked } from "./property-units";

// One shared conversation per property (Woody, 2026-11-14: Letting Tracker
// comments "all just go into the property chat"). Until then the property
// page's conversation box made a private thread for each person who opened
// it. The shared thread belongs to no person: its creator is this marker, so
// it is never anyone's own chat and nobody can delete it. Everyone who can
// open the property joins it by opening the box, and reads and writes it
// through the ordinary chat routes as a member. Earlier private threads stay
// private to the people in them.
//
// It is quiet: a member's unread mark is set on each message, but a push is
// sent only to the people a message tags. ChatBGP answers there only when it
// is asked by name, and never joins for good (routes.ts, the message POST).
export const RECORD_THREAD_CREATOR = "__record__";

export function isSharedRecordThread(thread: { createdBy?: string | null } | null | undefined): boolean {
  return thread?.createdBy === RECORD_THREAD_CREATOR;
}

export async function sharedPropertyThreadId(propertyId: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`record-thread:property:${propertyId}`]);
    const found = await client.query(
      `SELECT id FROM chat_threads WHERE created_by = $1 AND linked_type = 'property' AND linked_id = $2 ORDER BY created_at LIMIT 1`,
      [RECORD_THREAD_CREATOR, propertyId]);
    if (found.rows[0]) { await client.query("COMMIT"); return found.rows[0].id; }
    const property = await client.query(`SELECT name FROM crm_properties WHERE id = $1`, [propertyId]);
    if (!property.rows[0]) { await client.query("ROLLBACK"); return null; }
    const name = String(property.rows[0].name || "Property");
    const made = await client.query(
      `INSERT INTO chat_threads (title, created_by, property_id, property_name, linked_type, linked_id, linked_name, is_ai_chat, has_ai_member)
       VALUES ($1, $2, $3, $4, 'property', $3, $4, false, false) RETURNING id`,
      [`${name} — conversation`, RECORD_THREAD_CREATOR, propertyId, name]);
    await client.query("COMMIT");
    return made.rows[0].id;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// A person tagged in a shared conversation is pulled in only when they are
// BGP staff: a client login joins by opening the property, which checks it
// may. A failed read counts as no.
export async function mayBeTaggedIntoRecordThread(userId: string): Promise<boolean> {
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM users WHERE id = $1 AND lower(COALESCE(email, '')) LIKE '%@brucegillinghampollard.com'
         AND COALESCE(role, '') <> 'Client' AND is_active IS DISTINCT FROM false`, [userId]);
    return rows.length > 0;
  } catch { return false; }
}

const router = Router();

// Open (or start) the property's shared conversation and join it. POST,
// under /api/chat/threads so a client login reaches it through the gateway's
// chat write; the property check is the same one the property page uses.
router.post("/api/chat/threads/record/property/:propertyId", requireAuth, async (req: Request, res: Response) => {
  try {
    const propertyId = String(req.params.propertyId);
    const userId = String(req.session?.userId || (req as any).tokenUserId || "");
    if (!userId) return res.status(401).json({ message: "Sign in again" });
    if (await propertyReadBlocked(req, propertyId)) return res.status(403).json({ message: "Not available for this account" });
    const threadId = await sharedPropertyThreadId(propertyId);
    if (!threadId) return res.status(404).json({ message: "Property not found" });
    try {
      await storage.addChatThreadMember({ threadId, userId, addedBy: userId, seen: true });
    } catch (e: any) {
      if (e?.code === "CHAT_MEMBER_REFUSED") return res.status(403).json({ message: e.message });
      throw e;
    }
    res.json({ threadId });
  } catch (error: any) {
    console.error("[record-conversation]", error?.message);
    res.status(500).json({ message: "The conversation could not be opened" });
  }
});

// The Letting Tracker's comment counts: for each unit tagged in the shared
// conversations of the properties asked about, how many messages tag it and
// the latest one. Only properties the caller may open are read.
router.get("/api/chat/threads/record/unit-comments", requireAuth, async (req: Request, res: Response) => {
  try {
    const asked = [...new Set(String(req.query.propertyIds || "").split(",").map(s => s.trim()).filter(Boolean))].slice(0, 300);
    const allowed: string[] = [];
    for (const id of asked) if (!(await propertyReadBlocked(req, id))) allowed.push(id);
    if (!allowed.length) return res.json({ units: {} });
    const { rows } = await pool.query(
      `WITH tagged AS (
         SELECT m.id, m.content, m.created_at, u.name AS sender, (regexp_matches(m.content, '\\(tag:unit/([^)\\s]+)\\)', 'g'))[1] AS unit_id
           FROM chat_threads t
           JOIN chat_messages m ON m.thread_id = t.id AND m.role = 'user'
           LEFT JOIN users u ON u.id = m.user_id
          WHERE t.created_by = $1 AND t.linked_type = 'property' AND t.linked_id = ANY($2::text[])
       )
       SELECT unit_id, count(DISTINCT id)::int AS n,
              (array_agg(content ORDER BY created_at DESC))[1] AS last_content,
              (array_agg(sender ORDER BY created_at DESC))[1] AS last_sender,
              max(created_at) AS last_at
         FROM tagged GROUP BY unit_id`,
      [RECORD_THREAD_CREATOR, allowed]);
    const units: Record<string, { count: number; last: { text: string; sender: string | null; at: string } }> = {};
    for (const r of rows) units[r.unit_id] = { count: r.n, last: { text: String(r.last_content || ""), sender: r.last_sender || null, at: new Date(r.last_at).toISOString() } };
    res.json({ units });
  } catch (error: any) {
    console.error("[record-conversation unit-comments]", error?.message);
    res.status(500).json({ message: "Comments could not be loaded" });
  }
});

export default router;
