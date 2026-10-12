// ── Gossip & market intel channel (Woody, 2026-10-12) ───────────────────
// "A gossip channel in the app so people can add gossip about people moving
// in the industry and general market intel, which can be summarised."
// One group thread in Messages that every active BGP staff login belongs
// to (never client logins — staff are BGP email addresses, as in
// company-scope.ts). Posting doesn't push-notify everyone; it shows as
// unread. summariseGossip() turns a period's posts into a digest — the
// Summarise button on the channel and ChatBGP's summarise_gossip tool.

import type { Express, Request, Response } from "express";
import { pool } from "./db";

export const GOSSIP_LINKED_TYPE = "channel";
export const GOSSIP_LINKED_ID = "gossip";
const GOSSIP_TITLE = "Gossip & market intel";
const STAFF_SQL = `u.is_active IS NOT FALSE AND lower(u.email) LIKE '%@brucegillinghampollard.com' AND COALESCE(u.role, '') <> 'Client'`;

export async function ensureGossipChannel(): Promise<string | null> {
  const found = (await pool.query(
    `SELECT id FROM chat_threads WHERE linked_type = $1 AND linked_id = $2 ORDER BY created_at LIMIT 1`,
    [GOSSIP_LINKED_TYPE, GOSSIP_LINKED_ID])).rows[0];
  let id: string | null = found?.id || null;
  if (!id) {
    const owner = (await pool.query(`SELECT u.id FROM users u WHERE ${STAFF_SQL} ORDER BY u.is_admin DESC NULLS LAST, u.display_order NULLS LAST LIMIT 1`)).rows[0];
    if (!owner) return null;
    id = (await pool.query(
      `INSERT INTO chat_threads (title, created_by, linked_type, linked_id, linked_name, is_ai_chat, has_ai_member)
       VALUES ($1, $2, $3, $4, $1, false, false) RETURNING id`,
      [GOSSIP_TITLE, owner.id, GOSSIP_LINKED_TYPE, GOSSIP_LINKED_ID])).rows[0].id;
  }
  // Its own picture (two speech bubbles in the brand colours) unless someone
  // has set one — without it the list borrowed a member's photo.
  await pool.query(`UPDATE chat_threads SET group_pic_url = '/gossip-channel.svg' WHERE id = $1 AND group_pic_url IS NULL`, [id]);
  // Every active staff login is a member; new starters join on the next sync.
  await pool.query(
    `INSERT INTO chat_thread_members (thread_id, user_id, added_by, seen)
     SELECT $1::varchar, u.id, NULL, true FROM users u
      WHERE ${STAFF_SQL}
        AND NOT EXISTS (SELECT 1 FROM chat_thread_members m WHERE m.thread_id = $1::varchar AND m.user_id = u.id)`, [id]);
  return id;
}

export function isGossipThread(thread: { linkedType?: string | null; linkedId?: string | null; linked_type?: string | null; linked_id?: string | null } | null | undefined): boolean {
  if (!thread) return false;
  return (thread.linkedType ?? thread.linked_type) === GOSSIP_LINKED_TYPE && (thread.linkedId ?? thread.linked_id) === GOSSIP_LINKED_ID;
}

const stripTags = (s: string) => s.replace(/@\[([^\]]+)\]\(tag:[a-z]+\/[^)\s]+\)/g, "$1");

export async function summariseGossip(days = 7, focus?: string | null): Promise<{ summary: string; posts: number; from: string; to: string }> {
  const id = await ensureGossipChannel();
  const span = Math.min(Math.max(Math.round(days) || 7, 1), 365);
  const from = new Date(Date.now() - span * 86_400_000);
  const rows = id ? (await pool.query(
    `SELECT m.content, m.created_at, u.name FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.thread_id = $1 AND m.role = 'user' AND m.created_at >= $2 ORDER BY m.created_at`, [id, from])).rows : [];
  const to = new Date().toISOString().slice(0, 10);
  if (!rows.length) return { summary: `Nothing posted in ${GOSSIP_TITLE} in the last ${span} day${span === 1 ? "" : "s"}.`, posts: 0, from: from.toISOString().slice(0, 10), to };
  let body = rows.map((r: any) => `[${new Date(r.created_at).toISOString().slice(0, 10)}] ${r.name || "Someone"}: ${stripTags(String(r.content || "")).trim()}`).join("\n");
  if (body.length > 120_000) body = body.slice(-120_000);
  const { callClaude, CHATBGP_HELPER_MODEL } = await import("./utils/anthropic-client");
  const completion = await callClaude({
    model: CHATBGP_HELPER_MODEL,
    messages: [
      { role: "system", content: `You summarise BGP's internal "${GOSSIP_TITLE}" channel for a UK property agency (retail, leisure, F&B, investment). Write a tight digest in British English using these headings, leaving out any with nothing under them:
**People moves** — who is moving / has moved, from where to where, and when.
**Deals & market** — lettings, acquisitions, sales, rents, yields, schemes.
**Brands & occupiers** — expansion, closures, new concepts, requirements.
**Landlords & investors** — strategy, disposals, funding.
**To verify** — anything flagged as a rumour or unconfirmed.
One bullet per item, naming who posted it in brackets. Merge duplicates. Keep names, companies and figures exactly as posted; never add facts that aren't in the posts. No introduction or sign-off.` },
      { role: "user", content: `${focus ? `Focus on: ${focus}\n\n` : ""}Posts from ${from.toISOString().slice(0, 10)} to ${to}:\n\n${body}` },
    ],
    max_completion_tokens: 1500,
    temperature: 0.2,
  });
  const summary = completion.choices[0]?.message?.content?.trim() || "Couldn't summarise the channel just now.";
  return { summary, posts: rows.length, from: from.toISOString().slice(0, 10), to };
}

export function setupGossipChannel(app: Express, requireAuth: any) {
  const staffOnly = async (req: Request, res: Response) => {
    const { resolveCompanyScope } = await import("./company-scope");
    if (await resolveCompanyScope(req as any)) { res.status(403).json({ message: "BGP staff only" }); return false; }
    return true;
  };
  app.get("/api/gossip", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!await staffOnly(req, res)) return;
      res.json({ threadId: await ensureGossipChannel() });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.post("/api/gossip/summary", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!await staffOnly(req, res)) return;
      res.json(await summariseGossip(Number(req.body?.days) || 7, req.body?.focus || null));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  const sync = () => ensureGossipChannel().catch((e: any) => console.warn("[gossip] channel sync failed:", e?.message));
  setTimeout(sync, 20_000);
  setInterval(sync, 60 * 60_000).unref?.();
}
