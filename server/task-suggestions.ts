// AI-suggested tasks — the system watches the letting workflow and drops
// suggested next actions onto the responsible agent's task list (Woody,
// 2026-08-03: "maybe the AI can add them as things they need to do as they
// work on the app"). Three deterministic detectors, no AI call needed:
//
//   stale_offer      — an offer sat Pending 10+ days with nothing logged
//   viewing_followup — a viewing happened 2+ days ago, no outcome recorded
//   stale_target     — a target operator stuck on Identified 14+ days
//
// Every suggestion is deduped by source_ref, lands with assigned_by_name
// "ChatBGP" (so the task row carries the from-badge), and the assignee gets
// one summary push per sweep, not one per task. Marking a suggestion done —
// or deleting it — won't resurrect it: the source_ref check looks at every
// historical row, live or done.
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";

let columnsEnsured = false;
async function ensureColumns() {
  if (columnsEnsured) return;
  await pool.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS source TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS source_ref TEXT`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_tasks_source_ref ON user_tasks(source_ref)`).catch(() => {});
  columnsEnsured = true;
}

// First BGP agent on the unit's property — deterministic (alphabetical) so
// reruns pick the same person. Returns null when the property has no agents;
// those suggestions are skipped rather than spammed to admins.
const AGENT_SQL = `
  SELECT u.id, u.name
    FROM crm_property_agents pa
    JOIN users u ON u.id = pa.user_id
   WHERE pa.property_id = $1 AND u.is_active IS NOT FALSE
     AND u.email ILIKE '%@brucegillinghampollard.com'
   ORDER BY u.name ASC
   LIMIT 1`;

interface Suggestion {
  sourceRef: string;
  propertyId: string;
  title: string;
  description: string;
  dueInDays: number;
}

async function detectStaleOffers(): Promise<Suggestion[]> {
  const { rows } = await pool.query(`
    SELECT o.id, o.company_name, o.offer_date, au.unit_name, au.property_id, p.name AS property_name
      FROM unit_offers o
      JOIN available_units au ON au.id = o.unit_id
      JOIN crm_properties p ON p.id = au.property_id
     WHERE o.status ILIKE 'pending%'
       AND o.offer_date ~ '^\\d{4}-\\d{2}-\\d{2}'
       AND o.offer_date::date < (now() - interval '10 days')::date
       AND o.offer_date::date > (now() - interval '120 days')::date
  `);
  return rows.map((o: any) => ({
    sourceRef: `stale_offer:${o.id}`,
    propertyId: o.property_id,
    title: `Chase ${o.company_name || "the"} offer — ${o.unit_name}, ${o.property_name}`,
    description: `Offer dated ${o.offer_date} is still Pending with nothing logged since. Chase the tenant/agent or update the offer status on the letting tracker.`,
    dueInDays: 2,
  }));
}

async function detectViewingFollowups(): Promise<Suggestion[]> {
  const { rows } = await pool.query(`
    SELECT v.id, v.company_name, v.viewing_date, au.unit_name, au.property_id, p.name AS property_name
      FROM unit_viewings v
      JOIN available_units au ON au.id = v.unit_id
      JOIN crm_properties p ON p.id = au.property_id
     WHERE v.outcome IS NULL
       AND v.viewing_date ~ '^\\d{4}-\\d{2}-\\d{2}'
       AND v.viewing_date::date < (now() - interval '2 days')::date
       AND v.viewing_date::date > (now() - interval '21 days')::date
  `);
  return rows.map((v: any) => ({
    sourceRef: `viewing_followup:${v.id}`,
    propertyId: v.property_id,
    title: `Log outcome of ${v.company_name || "the"} viewing — ${v.unit_name}, ${v.property_name}`,
    description: `Viewing on ${v.viewing_date} has no outcome recorded. Log how it went (and next steps) on the letting tracker so the client sees live progress.`,
    dueInDays: 1,
  }));
}

async function detectStaleTargets(): Promise<Suggestion[]> {
  const { rows } = await pool.query(`
    SELECT t.id, t.operator_name, t.created_at, au.unit_name, au.property_id, p.name AS property_name
      FROM unit_target_operators t
      JOIN unit_briefs b ON b.id = t.brief_id
      JOIN available_units au ON au.id = b.unit_id
      JOIN crm_properties p ON p.id = au.property_id
     WHERE t.status = 'Identified'
       AND t.created_at < now() - interval '14 days'
       AND t.created_at > now() - interval '180 days'
  `);
  return rows.map((t: any) => ({
    sourceRef: `stale_target:${t.id}`,
    propertyId: t.property_id,
    title: `Pitch ${t.operator_name} — ${t.unit_name}, ${t.property_name}`,
    description: `${t.operator_name} has sat on the target list as Identified since ${new Date(t.created_at).toLocaleDateString("en-GB")} with no approach logged. Make contact or move them to Approached / Not proceeding.`,
    dueInDays: 3,
  }));
}

export async function runTaskSuggestionSweep(): Promise<{ created: number; skippedNoAgent: number; alreadySuggested: number; notified: number }> {
  await ensureColumns();
  const all = [
    ...(await detectStaleOffers().catch(() => [])),
    ...(await detectViewingFollowups().catch(() => [])),
    ...(await detectStaleTargets().catch(() => [])),
  ];

  let created = 0;
  let skippedNoAgent = 0;
  let alreadySuggested = 0;
  const createdByUser = new Map<string, number>();

  for (const s of all) {
    const dupe = await pool.query(`SELECT 1 FROM user_tasks WHERE source_ref = $1 LIMIT 1`, [s.sourceRef]);
    if (dupe.rows[0]) { alreadySuggested++; continue; }
    const agent = (await pool.query(AGENT_SQL, [s.propertyId])).rows[0];
    if (!agent) { skippedNoAgent++; continue; }
    await pool.query(
      `INSERT INTO user_tasks (user_id, title, description, priority, category, status, due_date,
                               assigned_by_user_id, assigned_by_name, source, source_ref)
       VALUES ($1, $2, $3, 'medium', 'follow-up', 'todo', now() + ($4 || ' days')::interval,
               NULL, 'ChatBGP', 'ai_suggested', $5)`,
      [agent.id, s.title.slice(0, 300), s.description, String(s.dueInDays), s.sourceRef]
    );
    created++;
    createdByUser.set(agent.id, (createdByUser.get(agent.id) || 0) + 1);
  }

  // One summary notification per agent per sweep — never one per task.
  let notified = 0;
  for (const [userId, count] of createdByUser) {
    try {
      const { emitNotification } = await import("./websocket");
      emitNotification(userId, {
        type: "task_assigned",
        threadId: "",
        senderName: "ChatBGP",
        preview: `${count} suggested task${count === 1 ? "" : "s"} added from the letting tracker — offers to chase, viewings to log, targets to pitch.`,
      } as any);
      const { sendPushNotification } = await import("./push-notifications");
      sendPushNotification(userId, {
        title: "ChatBGP suggested tasks",
        body: `${count} next action${count === 1 ? "" : "s"} from the letting tracker are on your list.`,
      } as any);
      notified++;
    } catch { /* notification channels are best-effort */ }
  }

  if (created || skippedNoAgent) {
    console.log(`[task-suggestions] created ${created}, deduped ${alreadySuggested}, no-agent ${skippedNoAgent}`);
  }
  return { created, skippedNoAgent, alreadySuggested, notified };
}

let sweepTimer: NodeJS.Timeout | null = null;

export function registerTaskSuggestionRoutes(app: Express) {
  // Twice a day is plenty — the detectors look at multi-day staleness.
  // First run 5 minutes after boot so deploy storms don't hammer it; the
  // source_ref dedupe makes reruns free.
  if (!sweepTimer) {
    setTimeout(() => { runTaskSuggestionSweep().catch(e => console.warn("[task-suggestions] sweep failed:", e?.message)); }, 5 * 60 * 1000);
    sweepTimer = setInterval(() => {
      runTaskSuggestionSweep().catch(e => console.warn("[task-suggestions] sweep failed:", e?.message));
    }, 12 * 60 * 60 * 1000);
  }

  // Manual kick for testing / "run it now" — staff only.
  app.post("/api/tasks/suggestions/run", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).session?.userId || (req as any).tokenUserId;
      const { rows } = await pool.query(`SELECT email FROM users WHERE id = $1`, [userId]);
      if (!(rows[0]?.email || "").toLowerCase().endsWith("@brucegillinghampollard.com")) {
        return res.status(403).json({ error: "Staff only" });
      }
      res.json(await runTaskSuggestionSweep());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
