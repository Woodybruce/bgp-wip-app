// AML training records (Woody, 19 November 2026). The rules are
// shared/aml-training.ts; the table is aml_training_records.
//
//   GET    /api/aml-training/me                 your own records and standing
//   POST   /api/aml-training/me/read-policy     "I have read the AML policy" (once per issue)
//   GET    /api/aml-training/person/:userId     one person's records (them, the officers, admins)
//   GET    /api/aml-training                    everyone's standing (the officers and admins)
//   POST   /api/aml-training                    record a session for one or more people (the officers and admins)
//   DELETE /api/aml-training/:id                remove a record entered by mistake (the officers and admins)
//
// BGP staff signed in as themselves only.

import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import {
  CURRENT_POLICY_KEY, CURRENT_POLICY_READ_TITLE, trainingInput, trainingKindWords, trainingStanding, type AmlTrainingRow,
} from "@shared/aml-training";

export const AML_TRAINING_MIGRATIONS = [
  `ALTER TABLE aml_training_records ADD COLUMN IF NOT EXISTS title TEXT`,
  `ALTER TABLE aml_training_records ADD COLUMN IF NOT EXISTS provider TEXT`,
  `ALTER TABLE aml_training_records ADD COLUMN IF NOT EXISTS recorded_by VARCHAR`,
  `ALTER TABLE aml_training_records ADD COLUMN IF NOT EXISTS batch_id TEXT`,
  `CREATE INDEX IF NOT EXISTS aml_training_records_user_idx ON aml_training_records (user_id)`,
];

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function staffMe(req: Request): Promise<{ id: string; name: string; isAdmin: boolean } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const u = (await pool.query(`SELECT id, name, email, is_admin FROM users WHERE id = $1`, [userId])).rows[0];
  if (!u) return null;
  const { ADMIN_EMAILS } = await import("./auth");
  return { id: String(u.id), name: text(u.name) || text(u.email), isAdmin: u.is_admin === true || ADMIN_EMAILS.has(String(u.email || "").toLowerCase().trim()) };
}

/** May this login record and read everyone's training: the Nominated Officer, the Deputy, or an admin. */
async function managesTraining(req: Request, me: { isAdmin: boolean }): Promise<boolean> {
  if (me.isAdmin) return true;
  const { amlActor } = await import("./aml-authority");
  return (await amlActor(req)).isMlro;
}

const rowOf = (r: any): AmlTrainingRow => ({
  id: Number(r.id), userId: String(r.user_id), userName: text(r.user_name),
  kind: String(r.training_type || ""), kindWords: trainingKindWords(r.training_type),
  title: text(r.title) || trainingKindWords(r.training_type),
  trainedOn: r.training_date ? new Date(r.training_date).toISOString().slice(0, 10) : null,
  topics: Array.isArray(r.topics) ? r.topics.map(String) : [],
  provider: r.provider || null, notes: r.notes || null, recordedBy: r.certified_by || null,
  createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
});

async function recordsFor(userId: string): Promise<AmlTrainingRow[]> {
  const { rows } = await pool.query(`SELECT * FROM aml_training_records WHERE user_id = $1 ORDER BY training_date DESC, id DESC LIMIT 200`, [userId]);
  return rows.map(rowOf);
}

const router = Router();

router.get("/api/aml-training/me", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const records = await recordsFor(me.id);
    res.json({ records, standing: trainingStanding(records), policyKey: CURRENT_POLICY_KEY, policyReadTitle: CURRENT_POLICY_READ_TITLE, manages: await managesTraining(req, me) });
  } catch (err: any) {
    console.error("[aml-training] own records failed:", err?.message);
    res.status(500).json({ message: "Your training records could not be read." });
  }
});

router.post("/api/aml-training/me/read-policy", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const done = (await pool.query(`SELECT id FROM aml_training_records WHERE user_id = $1 AND training_type = 'policy_read' AND title = $2 LIMIT 1`, [me.id, CURRENT_POLICY_READ_TITLE])).rows[0];
    if (!done) {
      await pool.query(
        `INSERT INTO aml_training_records (user_id, user_name, training_type, title, training_date, completed_at, topics, notes, certified_by, recorded_by)
         VALUES ($1, $2, 'policy_read', $3, now(), now(), $4, $5, $6, $1)`,
        [me.id, me.name, CURRENT_POLICY_READ_TITLE, ["procedures"], "Confirmed by the person in My BGP.", me.name]);
    }
    const records = await recordsFor(me.id);
    res.json({ ok: true, records, standing: trainingStanding(records) });
  } catch (err: any) {
    console.error("[aml-training] read-policy failed:", err?.message);
    res.status(500).json({ message: "It could not be recorded." });
  }
});

router.get("/api/aml-training/person/:userId", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    const userId = String(req.params.userId);
    if (userId !== me.id && !(await managesTraining(req, me))) return res.status(403).json({ message: "Only the person, the Nominated Officer, the Deputy or an admin can see someone's AML training." });
    const records = await recordsFor(userId);
    res.json({ records, standing: trainingStanding(records), policyReadTitle: CURRENT_POLICY_READ_TITLE });
  } catch (err: any) {
    console.error("[aml-training] person failed:", err?.message);
    res.status(500).json({ message: "The training records could not be read." });
  }
});

router.get("/api/aml-training", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    if (!(await managesTraining(req, me))) return res.status(403).json({ message: "Only the Nominated Officer, the Deputy or an admin can see everyone's AML training." });
    const people = (await pool.query(
      `SELECT id, name, email, team FROM users WHERE COALESCE(is_active, true) = true AND email ILIKE '%@brucegillinghampollard.com' ORDER BY name`)).rows;
    const records = (await pool.query(`SELECT * FROM aml_training_records ORDER BY training_date DESC, id DESC LIMIT 5000`)).rows.map(rowOf);
    const byUser = new Map<string, AmlTrainingRow[]>();
    for (const r of records) byUser.set(r.userId, [...(byUser.get(r.userId) || []), r]);
    res.json({
      people: people.map((p: any) => {
        const own = byUser.get(String(p.id)) || [];
        return { userId: String(p.id), name: text(p.name) || text(p.email), team: p.team || null, records: own.length, ...trainingStanding(own) };
      }),
      recent: records.slice(0, 100),
      policyReadTitle: CURRENT_POLICY_READ_TITLE,
    });
  } catch (err: any) {
    console.error("[aml-training] list failed:", err?.message);
    res.status(500).json({ message: "The training records could not be read." });
  }
});

router.post("/api/aml-training", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    if (!(await managesTraining(req, me))) return res.status(403).json({ message: "Only the Nominated Officer, the Deputy or an admin records AML training." });
    const input = trainingInput(req.body, londonToday());
    if (!input.ok) return res.status(400).json({ message: input.error });
    const v = input.value;
    const users = (await pool.query(
      `SELECT id, name, email FROM users WHERE id = ANY($1::varchar[]) AND COALESCE(is_active, true) = true AND email ILIKE '%@brucegillinghampollard.com'`, [v.userIds])).rows;
    if (users.length !== v.userIds.length) return res.status(400).json({ message: "Everyone recorded must be an active BGP login." });
    const batch = `training-${Date.now().toString(36)}`;
    for (const u of users) {
      await pool.query(
        `INSERT INTO aml_training_records (user_id, user_name, training_type, title, training_date, completed_at, topics, provider, notes, certified_by, recorded_by, batch_id)
         VALUES ($1, $2, $3, $4, $5::date, $5::date, $6, $7, $8, $9, $10, $11)`,
        [String(u.id), text(u.name) || text(u.email), v.kind, v.title, v.trainedOn, v.topics, v.provider, v.notes, me.name, me.id, batch]);
    }
    res.json({ ok: true, recorded: users.length });
  } catch (err: any) {
    console.error("[aml-training] not recorded:", err?.message);
    res.status(500).json({ message: "The training could not be recorded." });
  }
});

router.delete("/api/aml-training/:id", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only, signed in as themselves." });
    if (!(await managesTraining(req, me))) return res.status(403).json({ message: "Only the Nominated Officer, the Deputy or an admin removes a training record." });
    const row = (await pool.query(`DELETE FROM aml_training_records WHERE id = $1 RETURNING id, user_name, title, training_type`, [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ message: "No such record." });
    console.log(`[aml-training] record ${row.id} (${row.user_name}, ${row.title || row.training_type}) removed by ${me.name}`);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[aml-training] not removed:", err?.message);
    res.status(500).json({ message: "The record could not be removed." });
  }
});

export default router;
