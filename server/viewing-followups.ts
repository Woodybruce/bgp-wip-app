import { calendarDateValue } from "../shared/calendar-date";
import { viewingMissingDetails, viewingNeedsOutcome, type ViewingStatus } from "../shared/viewing-workflow";
import { VIEWING_FOLLOWUP_SCHEMA_SQL } from "./viewing-followups-schema";

interface Queryable { query(text: string, values?: any[]): Promise<{ rows: any[]; rowCount?: number | null }> }
interface Connection extends Queryable { release(): void }
interface Database extends Queryable { connect(): Promise<Connection> }
export interface FollowupViewing {
  id: string; unitId: string | null; companyId: string | null;
  contactId: string | null; agentContactId: string | null; ownerUserId: string | null;
  viewingDate: string | null; viewingTime: string | null; status: ViewingStatus;
  outcome: string | null; detailsConfirmedAt: string | Date | null;
  nextAction?: string | null; followUpDate?: string | null;
  createdAt?: string | Date | null; deletedAt?: string | Date | null;
  companyName?: string | null; unitName?: string | null; propertyName?: string | null;
  propertyId?: string | null; ownerName?: string | null; ownerEmail?: string | null; ownerActive?: boolean | null;
}
export interface ViewingFollowupDecision {
  needed: boolean; kind: "details" | "outcome" | "action" | null;
  dueDate: string | null; title: string; reasons: string[]; emailOverdue: boolean;
}
const SOURCE = "viewing_followup";
const REF_PREFIX = "viewing_followup:";
const DAY_MS = 86_400_000;
function londonDay(value: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function addDays(date: string, amount: number) {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10);
}
export function nextViewingWorkingDay(date: string): string {
  let next = addDays(date, 1);
  while ([0, 6].includes(new Date(`${next}T12:00:00Z`).getUTCDay())) next = addDays(next, 1);
  return next;
}
// No bank-holiday calendar is inferred: "working day" means Monday-Friday.
function londonInstant(date: string, time = "12:00") {
  const desired = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(desired)) return NaN;
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "shortOffset" }).formatToParts(new Date(desired)).find(p => p.type === "timeZoneName")?.value || "GMT";
  const offset = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(local);
  return desired - (offset ? (offset[1] === "+" ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3] || 0)) * 60_000 : 0);
}

export function viewingFollowupDecision(viewing: FollowupViewing, now = new Date()): ViewingFollowupDecision {
  const empty: ViewingFollowupDecision = { needed: false, kind: null, dueDate: null, title: "", reasons: [], emailOverdue: false };
  if (viewing.deletedAt || ["cancelled", "no_show", "not_leasing"].includes(viewing.status)) return empty;
  const today = londonDay(now);
  const date = calendarDateValue(viewing.viewingDate);
  const missing = viewingMissingDetails(viewing);
  if (!viewing.detailsConfirmedAt) missing.push("Review and confirm the booking details");
  const context = [viewing.companyName || "Unconfirmed brand", viewing.unitName, viewing.propertyName].filter(Boolean).join(" · ");
  let kind: ViewingFollowupDecision["kind"] = null, dueDate: string | null = null;
  let reasons: string[] = [];
  if (missing.length) {
    kind = "details"; reasons = missing;
    const created = viewing.createdAt ? new Date(viewing.createdAt) : now;
    dueDate = Number.isFinite(created.getTime()) ? londonDay(created) : today;
  } else if (date && viewingNeedsOutcome({ status: viewing.status, viewingDate: date, outcome: viewing.outcome }, today) && nextViewingWorkingDay(date) <= today) {
    kind = "outcome"; dueDate = nextViewingWorkingDay(date);
    reasons = ["Confirm whether the viewing happened and record its outcome and next step"];
  } else if (viewing.nextAction?.trim() && calendarDateValue(viewing.followUpDate) && viewing.followUpDate! <= today) {
    kind = "action"; dueDate = calendarDateValue(viewing.followUpDate);
    reasons = [viewing.nextAction.trim(), "Complete the action, then clear or move its follow-up date"];
  }
  if (!kind || !dueDate) return empty;
  const reminderFrom = kind === "outcome" && date ? londonInstant(date, viewing.viewingTime || "12:00") : londonInstant(dueDate, "09:00");
  return { needed: true, kind, dueDate, reasons,
    title: `${kind === "details" ? "Confirm viewing details" : kind === "outcome" ? "Log viewing outcome" : "Follow up viewing"} — ${context}`.slice(0, 300),
    emailOverdue: now.getTime() - reminderFrom >= 2 * DAY_MS,
  };
}

const VIEWING_SQL = `SELECT v.id, v.unit_id AS "unitId", v.company_id AS "companyId", v.contact_id AS "contactId",
 v.agent_contact_id AS "agentContactId", v.owner_user_id AS "ownerUserId", v.viewing_date AS "viewingDate",
 v.viewing_time AS "viewingTime", v.status, v.outcome, v.details_confirmed_at AS "detailsConfirmedAt",
 v.next_action AS "nextAction", v.follow_up_date AS "followUpDate", v.created_at AS "createdAt", v.deleted_at AS "deletedAt",
 v.company_name AS "companyName", au.unit_name AS "unitName", p.id AS "propertyId", p.name AS "propertyName",
 u.name AS "ownerName", u.email AS "ownerEmail", u.is_active AS "ownerActive"
 FROM unit_viewings v LEFT JOIN available_units au ON au.id = v.unit_id
 LEFT JOIN crm_properties p ON p.id = au.property_id LEFT JOIN users u ON u.id = v.owner_user_id`;

async function database(db?: Database): Promise<Database> { return db || (await import("./db")).pool; }
const schemaReady = new WeakMap<Database, Promise<void>>();
export async function ensureViewingFollowupSchema(db?: Database) {
  const connection = await database(db);
  let ready = schemaReady.get(connection);
  if (!ready) {
    ready = connection.query(VIEWING_FOLLOWUP_SCHEMA_SQL).then(() => {}, error => { schemaReady.delete(connection); throw error; });
    schemaReady.set(connection, ready);
  }
  await ready;
}

export interface ViewingFollowupResult { created: number; reopened: number; resolved: number; updated: number; skippedNoOwner: number; taskId?: string; viewing?: FollowupViewing; decision?: ViewingFollowupDecision }
/** Atomic per-viewing reconciliation. Manual task completion cannot conceal
 * an incomplete viewing: it is reopened until its source record is resolved. */
export async function reconcileViewingFollowup(viewingId: string, options: { db?: Database; now?: Date } = {}): Promise<ViewingFollowupResult> {
  const db = await database(options.db), now = options.now || new Date();
  const connection = await db.connect();
  const result: ViewingFollowupResult = { created: 0, reopened: 0, resolved: 0, updated: 0, skippedNoOwner: 0 };
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`viewing-followup:${viewingId}`]);
    const viewing = (await connection.query(`${VIEWING_SQL} WHERE v.id = $1 FOR UPDATE OF v`, [viewingId])).rows[0] as FollowupViewing | undefined;
    const tasks = (await connection.query("SELECT id, user_id, status FROM user_tasks WHERE source_ref = $1 ORDER BY created_at, id FOR UPDATE", [`${REF_PREFIX}${viewingId}`])).rows;
    const decision = viewing ? viewingFollowupDecision(viewing, now) : { needed: false };
    const ownerValid = !!viewing?.ownerUserId && viewing.ownerActive !== false && !!viewing.ownerEmail?.toLowerCase().endsWith("@brucegillinghampollard.com");
    if (viewing) { result.viewing = viewing; result.decision = decision as ViewingFollowupDecision; }
    if (!decision.needed || !ownerValid) {
      if (decision.needed && !ownerValid) result.skippedNoOwner++;
      const closed = await connection.query("UPDATE user_tasks SET status = 'done', completed_at = COALESCE(completed_at, $2) WHERE source_ref = $1 AND status <> 'done' RETURNING id", [`${REF_PREFIX}${viewingId}`, now]);
      result.resolved += closed.rows.length;
    } else {
      const activeDecision = decision as ViewingFollowupDecision;
      const description = [...activeDecision.reasons, "", `Open the viewing: /available?tab=viewings&viewingId=${encodeURIComponent(viewingId)}`].join("\n");
      const dueDate = `${activeDecision.dueDate}T12:00:00.000Z`;
      if (tasks[0]) {
        result.taskId = tasks[0].id;
        const changed = await connection.query(`UPDATE user_tasks SET user_id=$2, title=$3, description=$4, priority=$5,
          category='follow-up', status=CASE WHEN status='done' THEN 'todo' ELSE status END, due_date=$6,
          completed_at=NULL, assigned_by_name='ChatBGP', source=$7, linked_property_id=$8, linked_contact_id=$9
          WHERE id=$1 RETURNING id`, [tasks[0].id, viewing!.ownerUserId, activeDecision.title, description, activeDecision.emailOverdue ? "high" : "medium", dueDate, SOURCE, viewing!.propertyId || null, viewing!.contactId || viewing!.agentContactId || null]);
        if (changed.rows.length) { result.updated++; if (tasks[0].status === "done") result.reopened++; }
        // Older non-atomic sweeps may have produced duplicates. Keep one
        // historical task and close extras without deleting their history.
        if (tasks.length > 1) await connection.query("UPDATE user_tasks SET status='done', completed_at=COALESCE(completed_at,$2) WHERE id = ANY($1::varchar[]) AND status <> 'done'", [tasks.slice(1).map(task => task.id), now]);
      } else {
        const inserted = await connection.query(`INSERT INTO user_tasks (user_id,title,description,priority,category,status,due_date,
          assigned_by_name,source,source_ref,linked_property_id,linked_contact_id)
          VALUES ($1,$2,$3,$4,'follow-up','todo',$5,'ChatBGP',$6,$7,$8,$9) RETURNING id`,
        [viewing!.ownerUserId, activeDecision.title, description, activeDecision.emailOverdue ? "high" : "medium", dueDate, SOURCE, `${REF_PREFIX}${viewingId}`, viewing!.propertyId || null, viewing!.contactId || viewing!.agentContactId || null]);
        result.taskId = inserted.rows[0]?.id; result.created++;
      }
    }
    await connection.query("COMMIT");
    return result;
  } catch (error) { await connection.query("ROLLBACK").catch(() => {}); throw error; }
  finally { connection.release(); }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
interface ReminderEmail { to: string; subject: string; body: string }
export interface ViewingFollowupSweepResult { created: number; reopened: number; resolved: number; updated: number; skippedNoOwner: number; emailsSent: number; emailsFailed: number; emailEnabled: boolean }

/** Email remains off by default. A durable claim prevents two servers or a
 * retry after an uncertain send from emailing the same digest twice. Failed
 * delivery stays visible in the ledger; a later period gets a fresh digest. */
export async function runViewingFollowupSweep(options: {
  db?: Database; now?: Date; emailEnabled?: boolean;
  sendEmail?: (email: ReminderEmail) => Promise<void>;
} = {}): Promise<ViewingFollowupSweepResult> {
  const db = await database(options.db), now = options.now || new Date();
  await ensureViewingFollowupSchema(db);
  const emailEnabled = options.emailEnabled ?? process.env.VIEWING_REMINDER_EMAILS_ENABLED === "true";
  const totals: ViewingFollowupSweepResult = { created: 0, reopened: 0, resolved: 0, updated: 0, skippedNoOwner: 0, emailsSent: 0, emailsFailed: 0, emailEnabled };
  const candidates = (await db.query("SELECT id FROM unit_viewings UNION SELECT substring(source_ref from 18) AS id FROM user_tasks WHERE left(source_ref,17) = 'viewing_followup:' AND status <> 'done'")).rows;
  const byOwner = new Map<string, ViewingFollowupResult[]>();
  for (const candidate of candidates) {
    const result = await reconcileViewingFollowup(String(candidate.id), { db, now });
    for (const key of ["created", "reopened", "resolved", "updated", "skippedNoOwner"] as const) totals[key] += result[key];
    if (result.taskId && result.viewing?.ownerUserId && result.decision?.needed) {
      const owner = result.viewing.ownerUserId;
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner)!.push(result);
    }
  }
  if (!emailEnabled) return totals;
  const today = londonDay(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  // Tasks still reconcile at weekends; outbound nudges resume on Monday.
  if (weekday === 0 || weekday === 6) return totals;
  const monday = addDays(today, -(weekday === 0 ? 6 : weekday - 1));
  for (const [ownerUserId, entries] of byOwner) {
    // Monday combines the weekly review with overdue items into one email.
    const kind = weekday === 1 ? "weekly" : "overdue";
    const selected = kind === "weekly" ? entries : entries.filter(entry => entry.decision?.emailOverdue);
    if (!selected.length) continue;
    const periodKey = kind === "weekly" ? monday : today;
    const claim = (await db.query(`INSERT INTO viewing_reminder_deliveries(owner_user_id,kind,period_key,task_count)
      VALUES($1,$2,$3,$4) ON CONFLICT(owner_user_id,kind,period_key) DO NOTHING RETURNING id`, [ownerUserId, kind, periodKey, selected.length])).rows[0];
    if (!claim) continue;
    const owner = selected[0].viewing!;
    try {
      const send = options.sendEmail || (await import("./shared-mailbox")).sendSharedMailboxEmail;
      await send({ to: owner.ownerEmail!, subject: `${kind === "weekly" ? "Weekly viewing review" : "Viewing follow-ups overdue"} — ${selected.length} action${selected.length === 1 ? "" : "s"}`,
        body: `<p>Hello ${escapeHtml(owner.ownerName || "")},</p><p>${kind === "weekly" ? "Your viewing actions for this week:" : "These viewing actions need attention:"}</p><ul>${selected.map(entry => `<li><a href="https://chatbgp.app/available?tab=viewings&viewingId=${encodeURIComponent(entry.viewing!.id)}">${escapeHtml(entry.decision!.title)}</a><br>${entry.decision!.reasons.map(escapeHtml).join("; ")}</li>`).join("")}</ul><p>Update the viewing record to resolve its task. Completing the task alone does not record the viewing outcome.</p>`,
      });
      await db.query("UPDATE viewing_reminder_deliveries SET status='sent', sent_at=$2 WHERE id=$1", [claim.id, now]);
      totals.emailsSent++;
    } catch (error) {
      await db.query("UPDATE viewing_reminder_deliveries SET status='failed', error=$2 WHERE id=$1", [claim.id, error instanceof Error ? error.message.slice(0, 500) : "Delivery failed"]);
      totals.emailsFailed++;
    }
  }
  return totals;
}
