// The deal checklist on a letting (Woody, 2026-11-12; shared/deal-checklist.ts,
// migration 0052). Routes are registered from server/index.ts.
//
// One checklist per tracker unit and its current deal, started from the
// client's standard list the first time someone opens it. Items sit in
// stages; each has at most one responsible person (BGP, the client or a
// joint agent), and the deal as a whole has one, who picks up anything with
// nobody on it. Making someone responsible puts the item on their task list
// (when they have a login) and emails them. Nothing here blocks a status
// change: the checklist reports what is outstanding.
//
// Access is the Targeting Brief's (briefAccess): BGP staff everywhere, a
// client login on its own properties, a Landsec asset manager or joint agent
// on their own schemes. A joint agent reads, and ticks only their own items.
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { resolveCompanyScope, isClientRequestUser, getClientVisibleUserIds } from "./company-scope";
import { briefAccess, briefSchemePropertyIds } from "./unit-brief-workspace";
import { legacyToCode } from "@shared/deal-status";
import { briefRoleLabel } from "@shared/unit-brief";
import { RESTRICTED_LANDSEC_ROLES } from "@shared/landsec";
import {
  CHECKLIST_SIDES, CHECKLIST_STAGES, CHECKLIST_TEMPLATES, checklistStageFor, checklistSummary, checklistTemplateFor,
  type ChecklistItem, type ChecklistPerson, type ChecklistSide, type ChecklistStageKey, type ChecklistSummary, type DealChecklist,
} from "@shared/deal-checklist";

const BGP_EMAIL_DOMAIN = "@brucegillinghampollard.com";
const TASK_CATEGORY = "Deal checklist";
const TASK_REF = "deal_checklist:";
const REMIND_EVERY_MS = 60 * 60 * 1000;

type Access = NonNullable<Awaited<ReturnType<typeof briefAccess>>>;
type Db = { query: (sql: string, params?: any[]) => Promise<any> };
// A person who can be made responsible, with what the server knows and the
// caller may not: the real email, why it may or may not be shown, and
// whether their login has a task list (a Landsec asset manager's or joint
// agent's login cannot open Tasks, so they are emailed and see the item as
// theirs on the checklist instead).
interface PersonRec extends ChecklistPerson { onBrief: boolean; ownCompany: boolean; taskList: boolean }
const hasTaskList = (landsecRole: any) => !(RESTRICTED_LANDSEC_ROLES as string[]).includes(String(landsecRole || ""));
interface EmailResult { emailed: boolean; emailError: string | null }

const iso = (d: any): string | null => (d ? new Date(d).toISOString() : null);
const sameEmail = (a: any, b: any) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const stageIndex = (s: string) => CHECKLIST_STAGES.findIndex(x => x.key === s);
const stageLabel = (s: string) => CHECKLIST_STAGES.find(x => x.key === s)?.label || s;
const isStage = (s: any): s is ChecklistStageKey => typeof s === "string" && stageIndex(s) >= 0;
const isSide = (s: any): s is ChecklistSide => CHECKLIST_SIDES.some(x => x.key === s);
const sideOfBriefRole = (role: string): ChecklistSide => (role === "bgp_agent" ? "bgp" : role === "joint_agent" ? "joint_agent" : "client");
// Today in London, as yyyy-mm-dd (due dates are plain dates).
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const esc = (v: any) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const oneLine = (v: any) => String(v ?? "").replace(/\s+/g, " ").trim();
const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
// A client login (not BGP staff looking at a client's view).
const isClientCaller = (a: Access) => !!a.scope && !a.isStaff;

function appBaseUrl(): string {
  return (process.env.PUBLIC_APP_URL || "https://chatbgp.app").replace(/\/+$/, "");
}

function validDate(v: any): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

async function loadUnit(unitId: string, db: Db = pool): Promise<any | null> {
  return (await db.query(
    `SELECT au.id, au.unit_name, au.property_id, au.marketing_status, au.deal_id,
            p.name AS property_name, c.name AS landlord_name, d.deal_ref
       FROM available_units au
       LEFT JOIN crm_properties p ON p.id = au.property_id
       LEFT JOIN crm_companies c ON c.id = p.landlord_id
       LEFT JOIN crm_deals d ON d.id = au.deal_id
      WHERE au.id = $1`, [unitId])).rows[0] || null;
}

// The checklist of the unit's current deal (an earlier deal's stays in the table).
async function currentChecklist(unit: any, db: Db = pool): Promise<any | null> {
  return (await db.query(
    `SELECT * FROM deal_checklists WHERE unit_id = $1 AND COALESCE(deal_id, '') = COALESCE($2, '')`, [unit.id, unit.deal_id])).rows[0] || null;
}

const unitPlace = (unit: any) => [unit.unit_name || "Unit", unit.property_name].filter(Boolean).join(", ");

// Start the unit's checklist from the client's standard list. The check and
// the insert run under a lock on the unit, so two people opening it at once
// make one checklist.
async function startChecklist(unit: any, access: Access): Promise<any> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`deal_checklist:${unit.id}`]);
    const fresh = await loadUnit(unit.id, client);
    if (!fresh) throw new Error("That unit is no longer on the tracker");
    const existing = await currentChecklist(fresh, client);
    if (existing) { await client.query("COMMIT"); return existing; }
    const tpl = checklistTemplateFor(fresh.landlord_name);
    const row = (await client.query(
      `INSERT INTO deal_checklists (unit_id, deal_id, template_key, created_by_user_id, created_by_name) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [fresh.id, fresh.deal_id || null, tpl.key, access.userId, access.name])).rows[0];
    const perStage: Record<string, number> = {};
    const orders = tpl.items.map(i => (perStage[i.stage] = (perStage[i.stage] ?? -1) + 1));
    await client.query(
      `INSERT INTO deal_checklist_items (checklist_id, unit_id, stage, label, required, sort_order, created_by_user_id, created_by_name)
       SELECT $1, $2, t.stage, t.label, t.required, t.sort_order, $7, $8
         FROM unnest($3::text[], $4::text[], $5::boolean[], $6::int[]) AS t(stage, label, required, sort_order)`,
      [row.id, fresh.id, tpl.items.map(i => i.stage), tpl.items.map(i => i.label), tpl.items.map(i => i.required), orders, access.userId, access.name]);
    await client.query("COMMIT");
    return row;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

// Who can be made responsible on this unit, for this caller: everyone on the
// unit's Targeting Brief, plus logins. BGP staff may pick any active BGP
// login and the logins of the client that owns the property; a client login
// only the people its account may see. A login restricted to other schemes,
// and a joint agent's login that is not on the brief, are left out: they
// could not open the unit. A joint agent (who cannot make anyone responsible)
// gets the people on the brief only.
async function peopleFor(unit: any, access: Access): Promise<PersonRec[]> {
  const briefPeople: any[] = (await pool.query(
    `SELECT p.id, p.role, p.user_id, p.name, p.email, p.firm
       FROM unit_brief_people p
      WHERE p.brief_id = (SELECT id FROM unit_briefs WHERE unit_id = $1 ORDER BY created_at DESC LIMIT 1)
      ORDER BY p.sort_order, p.created_at`, [unit.id])).rows;

  const clientCaller = isClientCaller(access);
  const USER_COLS = `u.id, u.name, u.email, u.role, u.team, a.landsec_role, a.schemes`;
  const USER_FROM = `FROM users u LEFT JOIN landsec_access a ON a.user_id = u.id WHERE COALESCE(u.is_active, true)`;
  let logins: any[] = [];
  if (access.canEditTerms) {
    if (clientCaller) {
      const ids = Array.from(await getClientVisibleUserIds(access.scope));
      if (access.userId) ids.push(access.userId);
      logins = (await pool.query(`SELECT ${USER_COLS} ${USER_FROM} AND u.id = ANY($1::text[])`, [ids])).rows;
    } else {
      logins = (await pool.query(
        `SELECT ${USER_COLS} ${USER_FROM}
            AND ((lower(u.email) LIKE $1 AND COALESCE(u.role, '') <> 'Client')
              OR (u.role = 'Client' AND $2::text IS NOT NULL AND lower(u.team) = lower($2))
              OR u.id = $3)`, [`%${BGP_EMAIL_DOMAIN}`, unit.landlord_name || null, access.userId])).rows;
    }
  }
  // The scheme this property is, for logins held to named schemes.
  const { schemeForPropertyName } = await import("./landsec-schemes");
  const schemeKey = schemeForPropertyName(unit.property_name)?.key || null;
  logins = logins.filter(u => {
    if (u.id === access.userId) return true;
    if (u.landsec_role === "joint_agent") return false;
    if (u.landsec_role === "asset_manager") return !!schemeKey && (u.schemes || []).includes(schemeKey);
    return true;
  });

  // The logins behind the people on the brief (by link, or by email).
  const briefUserIds = briefPeople.map(p => p.user_id).filter(Boolean);
  const briefEmails = briefPeople.filter(p => !p.user_id && p.email).map(p => String(p.email).trim().toLowerCase());
  const briefLogins: any[] = briefUserIds.length || briefEmails.length
    ? (await pool.query(`SELECT ${USER_COLS} ${USER_FROM} AND (u.id = ANY($1::text[]) OR lower(u.email) = ANY($2::text[]))`, [briefUserIds, briefEmails])).rows
    : [];

  const scopeName = String(access.scopeName || "").trim().toLowerCase();
  const sideOfLogin = (u: any): ChecklistSide => (u.role !== "Client" ? "bgp" : u.landsec_role === "joint_agent" ? "joint_agent" : "client");
  const ownCompany = (u: any) => u.role === "Client" && !!scopeName && String(u.team || "").trim().toLowerCase() === scopeName;
  const out = new Map<string, PersonRec>();

  for (const p of briefPeople) {
    const u = p.user_id ? briefLogins.find(x => x.id === p.user_id) : briefLogins.find(x => sameEmail(x.email, p.email));
    const role = p.role === "joint_agent" && p.firm ? `${briefRoleLabel(p.role)} · ${p.firm}` : briefRoleLabel(p.role);
    const rec: PersonRec = u
      ? { key: `user:${u.id}`, userId: u.id, briefPersonId: p.id, name: u.name || p.name || u.email, email: u.email || null, side: sideOfBriefRole(p.role), role, hasLogin: true, onBrief: true, ownCompany: ownCompany(u), taskList: hasTaskList(u.landsec_role) }
      : { key: `brief:${p.id}`, userId: null, briefPersonId: p.id, name: p.name, email: p.email || null, side: sideOfBriefRole(p.role), role, hasLogin: false, onBrief: true, ownCompany: false, taskList: false };
    if (!out.has(rec.key)) out.set(rec.key, rec);
  }
  for (const u of logins) {
    const key = `user:${u.id}`;
    if (out.has(key)) continue;
    const side = sideOfLogin(u);
    out.set(key, {
      key, userId: u.id, briefPersonId: null, name: u.name || u.email, email: u.email || null, side,
      // A BGP job title is BGP's to see; an asset manager is said to be one.
      role: side === "bgp" ? (clientCaller ? null : u.role || null) : u.landsec_role === "asset_manager" ? "Asset manager" : null,
      hasLogin: true, onBrief: false, ownCompany: ownCompany(u), taskList: hasTaskList(u.landsec_role),
    });
  }
  const sideOrder = (s: ChecklistSide) => CHECKLIST_SIDES.findIndex(x => x.key === s);
  return Array.from(out.values()).sort((a, b) =>
    sideOrder(a.side) - sideOrder(b.side) || Number(b.onBrief) - Number(a.onBrief) || a.name.localeCompare(b.name));
}

// May this caller be given this person's email address? BGP staff: yes. A
// client login: the people on the brief, its own company's logins, itself.
// A joint agent: the people on the brief only.
function mayShowEmail(p: PersonRec, access: Access): boolean {
  if (!isClientCaller(access)) return true;
  if (p.onBrief || p.userId === access.userId) return true;
  return access.landsecRole === "joint_agent" ? false : p.ownCompany;
}

function isMine(item: any, access: Access): boolean {
  if (!item.assignee_name) return false;
  return item.assignee_user_id ? item.assignee_user_id === access.userId : sameEmail(item.assignee_email, access.email);
}

// Everything the screen shows for one checklist.
async function checklistJson(checklist: any, unit: any, access: Access): Promise<DealChecklist> {
  const [itemsQ, people] = await Promise.all([
    pool.query(
      `SELECT i.*, EXISTS (SELECT 1 FROM user_tasks t WHERE t.id = i.task_id) AS has_task
         FROM deal_checklist_items i WHERE i.checklist_id = $1 ORDER BY i.sort_order, i.created_at, i.id`, [checklist.id]),
    peopleFor(unit, access),
  ]);
  const staffView = !isClientCaller(access);
  // A stored email goes out only when the caller may have that person's.
  const emailOf = (userId: string | null, briefPersonId: string | null, stored: string | null): string | null => {
    if (staffView) return stored || null;
    const rec = people.find(p => (userId ? p.userId === userId : !!briefPersonId && p.briefPersonId === briefPersonId && !p.userId));
    return rec && mayShowEmail(rec, access) ? rec.email : null;
  };
  const statusCode = legacyToCode(unit.marketing_status) || "AVA";
  const stage = checklistStageFor(statusCode);
  const items: ChecklistItem[] = itemsQ.rows
    .map((r: any): ChecklistItem => ({
      id: r.id,
      stage: isStage(r.stage) ? r.stage : "enquiry",
      label: r.label,
      required: !!r.required,
      sortOrder: r.sort_order ?? 0,
      assignee: r.assignee_name
        ? { userId: r.assignee_user_id || null, briefPersonId: r.assignee_brief_person_id || null, name: r.assignee_name, email: emailOf(r.assignee_user_id, r.assignee_brief_person_id, r.assignee_email), side: isSide(r.assignee_side) ? r.assignee_side : null }
        : null,
      assignedAt: iso(r.assigned_at),
      assignedByName: r.assigned_by_name || null,
      dueDate: r.due_date || null,
      note: r.note || null,
      doneAt: iso(r.done_at),
      doneByName: r.done_by_name || null,
      notifiedAt: iso(r.notified_at),
      hasTask: !!r.has_task,
      mine: isMine(r, access),
    }))
    .sort((a: ChecklistItem, b: ChecklistItem) => stageIndex(a.stage) - stageIndex(b.stage));
  const responsible = checklist.responsible_name
    ? { userId: checklist.responsible_user_id || null, briefPersonId: checklist.responsible_brief_person_id || null, name: checklist.responsible_name as string,
        email: emailOf(checklist.responsible_user_id, checklist.responsible_brief_person_id, checklist.responsible_email), side: isSide(checklist.responsible_side) ? checklist.responsible_side : null }
    : null;
  return {
    id: checklist.id,
    unit: { id: unit.id, unitName: unit.unit_name, propertyId: unit.property_id || null, propertyName: unit.property_name || null, statusCode, dealId: unit.deal_id || null, dealRef: unit.deal_ref != null ? String(unit.deal_ref) : null },
    templateKey: checklist.template_key || null,
    templateName: CHECKLIST_TEMPLATES.find(t => t.key === checklist.template_key)?.name || null,
    stage,
    responsible,
    items,
    people: people.map((p): ChecklistPerson => ({
      key: p.key, userId: p.userId, briefPersonId: p.briefPersonId, name: p.name, email: mayShowEmail(p, access) ? p.email : null, side: p.side, role: p.role, hasLogin: p.hasLogin,
    })),
    summary: checklistSummary(items, stage, today(), !!responsible),
    viewer: { isStaff: access.isStaff, canEdit: access.canEditTerms, canAssign: access.canEditTerms },
  };
}

// ── Tasks ────────────────────────────────────────────────────────────────
// A row on the person's own task list, the same shape POST /api/tasks makes.
// source_ref marks it as made here, so only these are ever removed here.
async function makeTask(db: Db, t: { userId: string; title: string; description: string; dueDate: string | null; required: boolean; unit: any; ref: string; access: Access }): Promise<string> {
  const self = t.userId === t.access.userId;
  return (await db.query(
    `INSERT INTO user_tasks (user_id, title, description, due_date, priority, category, linked_deal_id, linked_property_id, assigned_by_user_id, assigned_by_name, status, source, source_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'todo', 'deal_checklist', $11) RETURNING id`,
    [t.userId, t.title.slice(0, 500), t.description, t.dueDate, t.required ? "high" : "medium", TASK_CATEGORY,
     t.unit.deal_id || null, t.unit.property_id || null, self ? null : t.access.userId, self ? null : t.access.name, t.ref])).rows[0].id;
}

// Remove a task this feature made, while it is still open (a finished task
// stays on the person's list as their record).
async function dropOpenTask(db: Db, taskId: string | null | undefined): Promise<void> {
  if (!taskId) return;
  await db.query(`DELETE FROM user_tasks WHERE id = $1 AND source_ref LIKE $2 AND COALESCE(status, 'todo') <> 'done'`, [taskId, `${TASK_REF}%`]);
}

// Does this login have a task list to put things on?
async function userHasTaskList(db: Db, userId: string): Promise<boolean> {
  const r = (await db.query(`SELECT a.landsec_role FROM users u LEFT JOIN landsec_access a ON a.user_id = u.id WHERE u.id = $1 AND COALESCE(u.is_active, true)`, [userId])).rows[0];
  return !!r && hasTaskList(r.landsec_role);
}

const itemTaskTitle = (label: string, unit: any) => `${oneLine(label)}: ${unitPlace(unit)}`;
const itemTaskDescription = (item: any, access: Access) =>
  `Deal checklist, ${stageLabel(item.stage)} stage. ${item.required ? "Required" : "Not required"}. Asked by ${access.name || "a colleague"}.`;

// Tell the person in the app, the way a task set from the Tasks page does.
async function notifyTask(userId: string, access: Access, title: string, taskId: string): Promise<void> {
  if (userId === access.userId) return;
  try {
    const [{ emitNotification }, { sendPushNotification }] = await Promise.all([import("./websocket"), import("./push-notifications")]);
    emitNotification(userId, { type: "task_assigned", threadId: "", senderName: access.name || "Someone", preview: title } as any);
    sendPushNotification(userId, { title: `New task from ${access.name || "a colleague"}`, body: title.slice(0, 100), tag: `task-${taskId}`, url: "/tasks" }).catch(() => undefined);
  } catch (e: any) {
    console.warn("[deal-checklist] in-app notification failed:", e?.message);
  }
}

// ── Email ────────────────────────────────────────────────────────────────
function plainEmailReason(e: any): string {
  const m = String(e?.message || e || "");
  if (/timed out/i.test(m)) return "the email service did not answer in time";
  if (/authenticat|token|credential|client.?id|tenant|secret|AADSTS|not configured|missing/i.test(m)) return "the email service is not connected on this server";
  if (/Graph API/i.test(m)) return "the email service refused the message";
  return "the email service is not available";
}

// Never throws: an email that could not be sent is reported, not fatal.
async function sendEmail(to: string | null, name: string, subject: string, html: string): Promise<EmailResult> {
  if (!to) return { emailed: false, emailError: `there is no email address for ${name}` };
  let timer: NodeJS.Timeout | undefined;
  try {
    const { sendSharedMailboxEmail } = await import("./shared-mailbox");
    await Promise.race([
      sendSharedMailboxEmail({ to, subject: oneLine(subject).slice(0, 250), body: html }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timed out")), 20000); }),
    ]);
    return { emailed: true, emailError: null };
  } catch (e: any) {
    console.warn("[deal-checklist] email not sent:", e?.message);
    return { emailed: false, emailError: plainEmailReason(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function emailHtml(opts: { greetingName: string; lead: string; rows: [string, string][]; unitId: string; hasLogin: boolean }): string {
  const link = `${appBaseUrl()}/deals/letting?unit=${encodeURIComponent(opts.unitId)}&checklist=1`;
  const rows = opts.rows.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;vertical-align:top"><strong>${esc(k)}</strong></td><td style="padding:2px 0">${esc(v)}</td></tr>`).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">
<p>Hello ${esc(opts.greetingName.split(" ")[0] || opts.greetingName)},</p>
<p>${esc(opts.lead)}</p>
<table style="border-collapse:collapse;font-size:14px">${rows}</table>
<p><a href="${esc(link)}">Open the deal checklist</a></p>
${opts.hasLogin ? "<p>It is also on your task list in the BGP app.</p>" : ""}
</div>`;
}

function itemEmail(kind: "assigned" | "reminder", item: any, unit: any, person: { name: string; hasLogin: boolean }, access: Access): { subject: string; html: string } {
  const who = access.name || "A colleague";
  const place = unitPlace(unit);
  const rows: [string, string][] = [
    ["Item", item.label],
    ["Letting", place],
    ["Stage", stageLabel(item.stage)],
    ["Required", item.required ? "Yes" : "No"],
  ];
  if (item.due_date) rows.push(["Due", longDate(item.due_date)]);
  if (item.note) rows.push(["Note", item.note]);
  rows.push([kind === "reminder" ? "Reminder from" : "Asked by", who]);
  return {
    subject: kind === "reminder"
      ? `A reminder: ${item.label} (${place})`
      : `${who} has made you responsible: ${item.label} (${place})`,
    html: emailHtml({
      greetingName: person.name,
      lead: kind === "reminder"
        ? `A reminder from ${who}: this item on the deal checklist for ${place} is yours and is still open.`
        : `${who} has made you responsible for this item on the deal checklist for ${place}.`,
      rows, unitId: unit.id, hasLogin: person.hasLogin,
    }),
  };
}

// ── Lookups for the write routes ─────────────────────────────────────────
interface Ctx { checklist: any; unit: any; access: Access }

// The checklist, its unit and the caller's access; answers the refusal itself.
async function checklistCtx(req: Request, res: Response, checklistId: string): Promise<Ctx | null> {
  const checklist = (await pool.query(`SELECT * FROM deal_checklists WHERE id = $1`, [checklistId])).rows[0];
  if (!checklist) { res.status(404).json({ message: "That checklist was not found" }); return null; }
  const unit = await loadUnit(checklist.unit_id);
  if (!unit) { res.status(404).json({ message: "The checklist's unit is no longer on the tracker" }); return null; }
  const access = await briefAccess(req, unit.property_id);
  if (!access) { res.status(403).json({ message: "This checklist is outside your access" }); return null; }
  if ((checklist.deal_id || "") !== (unit.deal_id || "")) {
    res.status(409).json({ message: "This checklist belongs to an earlier letting of the unit and is kept as the record. Open the unit's checklist again for the current letting." });
    return null;
  }
  return { checklist, unit, access };
}

async function itemCtx(req: Request, res: Response, itemId: string): Promise<(Ctx & { item: any }) | null> {
  const item = (await pool.query(`SELECT * FROM deal_checklist_items WHERE id = $1`, [itemId])).rows[0];
  if (!item) { res.status(404).json({ message: "That item was not found. It may have been deleted." }); return null; }
  const ctx = await checklistCtx(req, res, item.checklist_id);
  return ctx ? { ...ctx, item } : null;
}

const READ_ONLY = "Joint agents can read the checklist and tick their own items, not change it";

async function inTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function touch(checklistId: string): Promise<void> {
  await pool.query(`UPDATE deal_checklists SET updated_at = NOW() WHERE id = $1`, [checklistId]).catch(() => undefined);
}

// Remove a unit's checklists, their items and the open tasks made for them.
// For the unit delete (server/routes.ts).
export async function deleteUnitChecklists(unitId: string, db: Db = pool): Promise<void> {
  await db.query(
    `DELETE FROM user_tasks
      WHERE source_ref LIKE $2 AND COALESCE(status, 'todo') <> 'done'
        AND (id IN (SELECT task_id FROM deal_checklist_items WHERE unit_id = $1 AND task_id IS NOT NULL)
          OR source_ref IN (SELECT $3::text || id FROM deal_checklists WHERE unit_id = $1))`, [unitId, `${TASK_REF}%`, `${TASK_REF}deal:`]);
  await db.query(`DELETE FROM deal_checklist_items WHERE unit_id = $1`, [unitId]);
  await db.query(`DELETE FROM deal_checklists WHERE unit_id = $1`, [unitId]);
}

// A task made here was finished or re-opened on the person's own task list:
// carry that to the item. For PATCH /api/tasks/:id (server/routes.ts) to
// call; a task that is not a checklist item's is left alone.
export async function syncChecklistItemFromTask(taskId: string, done: boolean, by: { userId: string | null; name: string | null }, db: Db = pool): Promise<void> {
  if (done) {
    await db.query(`UPDATE deal_checklist_items SET done_at = NOW(), done_by_user_id = $2, done_by_name = $3, updated_at = NOW() WHERE task_id = $1 AND done_at IS NULL`, [taskId, by.userId, by.name]);
  } else {
    await db.query(`UPDATE deal_checklist_items SET done_at = NULL, done_by_user_id = NULL, done_by_name = NULL, updated_at = NOW() WHERE task_id = $1 AND done_at IS NOT NULL`, [taskId]);
  }
}

export function setupDealChecklistRoutes(app: Express) {
  // The headline numbers for every checklist the caller may see, by unit:
  // the chip on each tracker row. One query.
  app.get("/api/deal-checklists/summary", requireAuth, async (req, res) => {
    try {
      const scope = await resolveCompanyScope(req);
      if (!scope && (await isClientRequestUser(req))) return res.json({});
      let propertyIds: string[] | null = null;
      if (scope) {
        propertyIds = (await pool.query(
          `SELECT id FROM crm_properties WHERE landlord_id = $1
           UNION
           SELECT property_id FROM crm_company_properties WHERE company_id = $1`, [scope])).rows.map((r: any) => r.id);
        const schemeIds = await briefSchemePropertyIds(req);
        if (schemeIds) propertyIds = propertyIds!.filter(id => schemeIds.has(id));
        if (propertyIds!.length === 0) return res.json({});
      }
      const rows = (await pool.query(
        `SELECT c.unit_id, c.responsible_name, au.marketing_status,
                i.stage, i.required, i.done_at IS NOT NULL AS done, i.due_date, i.assignee_name IS NOT NULL AS assigned
           FROM deal_checklists c
           JOIN available_units au ON au.id = c.unit_id AND COALESCE(au.deal_id, '') = COALESCE(c.deal_id, '')
           LEFT JOIN deal_checklist_items i ON i.checklist_id = c.id
          WHERE ($1::text[] IS NULL OR au.property_id = ANY($1::text[]))`, [propertyIds])).rows;
      const byUnit = new Map<string, { responsibleName: string | null; stage: ChecklistStageKey; items: { stage: string; required: boolean; doneAt: unknown; dueDate: string | null; assignee: unknown }[] }>();
      for (const r of rows) {
        let u = byUnit.get(r.unit_id);
        if (!u) { u = { responsibleName: r.responsible_name || null, stage: checklistStageFor(legacyToCode(r.marketing_status)), items: [] }; byUnit.set(r.unit_id, u); }
        if (r.stage) u.items.push({ stage: r.stage, required: !!r.required, doneAt: r.done ? true : null, dueDate: r.due_date || null, assignee: r.assigned ? true : null });
      }
      const day = today();
      const out: Record<string, ChecklistSummary & { responsibleName: string | null; stage: ChecklistStageKey }> = {};
      byUnit.forEach((u, unitId) => { out[unitId] = { ...checklistSummary(u.items, u.stage, day, !!u.responsibleName), responsibleName: u.responsibleName, stage: u.stage }; });
      res.json(out);
    } catch (e: any) {
      console.error("[deal-checklist summary]", e?.message);
      res.status(500).json({ message: e?.message || "Failed to load the checklists" });
    }
  });

  // The unit's checklist. The first person to open it (who may change it)
  // starts it from the client's standard list; nobody is emailed or given a
  // task by that.
  app.get("/api/deal-checklists/unit/:unitId", requireAuth, async (req, res) => {
    try {
      const unit = await loadUnit(String(req.params.unitId));
      if (!unit) return res.status(404).json({ message: "That unit is not on the tracker" });
      const access = await briefAccess(req, unit.property_id);
      if (!access) return res.status(403).json({ message: "This unit is outside your access" });
      let checklist = await currentChecklist(unit);
      if (!checklist) {
        if (!access.canEditTerms) return res.json({ started: false, checklist: null });
        checklist = await startChecklist(unit, access);
      }
      res.json({ started: true, checklist: await checklistJson(checklist, unit, access) });
    } catch (e: any) {
      console.error("[deal-checklist open]", e?.message);
      res.status(500).json({ message: e?.message || "Failed to load the checklist" });
    }
  });

  // Who is responsible for the deal. Puts it on their task list and emails them.
  app.put("/api/deal-checklists/:checklistId/responsible", requireAuth, async (req, res) => {
    try {
      const ctx = await checklistCtx(req, res, String(req.params.checklistId));
      if (!ctx) return;
      const { unit, access } = ctx;
      if (!access.canEditTerms) return res.status(403).json({ message: READ_ONLY });
      const key = req.body?.personKey;
      if (key !== null && (typeof key !== "string" || !key.trim())) return res.status(400).json({ message: "Pick the person from the list, or send personKey null to clear it" });
      const person = key === null ? null : (await peopleFor(unit, access)).find(p => p.key === key) || null;
      if (key !== null && !person) return res.status(400).json({ message: "That person cannot be made responsible here. Pick someone from the list." });

      const ref = `${TASK_REF}deal:${ctx.checklist.id}`;
      const title = `Responsible for the letting of ${unitPlace(unit)}`;
      const result = await inTransaction(async db => {
        const row = (await db.query(`SELECT * FROM deal_checklists WHERE id = $1 FOR UPDATE`, [ctx.checklist.id])).rows[0];
        if (!row) return { changed: false, taskId: null as string | null };
        const same = !!person && !!row.responsible_name && (person.userId ? row.responsible_user_id === person.userId : !row.responsible_user_id && row.responsible_brief_person_id === person.briefPersonId);
        if (same || (!person && !row.responsible_name)) return { changed: false, taskId: null as string | null };
        await db.query(`DELETE FROM user_tasks WHERE source_ref = $1 AND COALESCE(status, 'todo') <> 'done'`, [ref]);
        let taskId: string | null = null;
        if (person?.userId && person.taskList) {
          taskId = await makeTask(db, {
            userId: person.userId, title,
            description: `You are responsible for this letting. Any item on its deal checklist with nobody on it falls to you. Asked by ${access.name || "a colleague"}.`,
            dueDate: null, required: false, unit, ref, access,
          });
        }
        await db.query(
          `UPDATE deal_checklists SET responsible_user_id = $2, responsible_brief_person_id = $3, responsible_name = $4, responsible_email = $5, responsible_side = $6, updated_at = NOW() WHERE id = $1`,
          [row.id, person?.userId || null, person?.briefPersonId || null, person?.name || null, person?.email || null, person?.side || null]);
        return { changed: true, taskId };
      });

      let mail: EmailResult = { emailed: false, emailError: null };
      if (result.changed && person && person.userId !== access.userId) {
        if (person.userId && result.taskId) await notifyTask(person.userId, access, title, result.taskId);
        const who = access.name || "A colleague";
        mail = await sendEmail(person.email, person.name, `${who} has made you responsible for the letting of ${unitPlace(unit)}`, emailHtml({
          greetingName: person.name,
          lead: `${who} has made you responsible for the letting of ${unitPlace(unit)}. Any item on its deal checklist with nobody on it falls to you.`,
          rows: [["Letting", unitPlace(unit)], ["Stage", stageLabel(checklistStageFor(legacyToCode(unit.marketing_status)))], ["Asked by", who]],
          unitId: unit.id, hasLogin: person.taskList,
        }));
      }
      const fresh = (await pool.query(`SELECT * FROM deal_checklists WHERE id = $1`, [ctx.checklist.id])).rows[0];
      res.json({ ...(await checklistJson(fresh, unit, access)), ...mail, taskCreated: !!result.taskId, selfAssigned: !!person?.userId && person.userId === access.userId });
    } catch (e: any) {
      console.error("[deal-checklist responsible]", e?.message);
      res.status(500).json({ message: e?.message || "Failed to save who is responsible" });
    }
  });

  // Add an item to a stage.
  app.post("/api/deal-checklists/:checklistId/items", requireAuth, async (req, res) => {
    try {
      const ctx = await checklistCtx(req, res, String(req.params.checklistId));
      if (!ctx) return;
      const { checklist, unit, access } = ctx;
      if (!access.canEditTerms) return res.status(403).json({ message: READ_ONLY });
      const b = req.body || {};
      if (!isStage(b.stage)) return res.status(400).json({ message: `Pick the stage: ${CHECKLIST_STAGES.map(s => s.label).join(", ")}` });
      const label = typeof b.label === "string" ? oneLine(b.label) : "";
      if (!label) return res.status(400).json({ message: "Say what the item is" });
      if (label.length > 300) return res.status(400).json({ message: "Keep the item to 300 characters or fewer" });
      if (b.required !== undefined && typeof b.required !== "boolean") return res.status(400).json({ message: "Required is yes or no" });
      await pool.query(
        `INSERT INTO deal_checklist_items (checklist_id, unit_id, stage, label, required, sort_order, created_by_user_id, created_by_name)
         VALUES ($1::text, $2, $3::text, $4, $5, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM deal_checklist_items WHERE checklist_id = $1::text AND stage = $3::text), $6, $7)`,
        [checklist.id, unit.id, b.stage, label, !!b.required, access.userId, access.name]);
      await touch(checklist.id);
      res.json(await checklistJson(checklist, unit, access));
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to add the item" });
    }
  });

  // Rename an item, change required, the due date, the note or its place in the stage.
  app.patch("/api/deal-checklists/items/:itemId", requireAuth, async (req, res) => {
    try {
      const ctx = await itemCtx(req, res, String(req.params.itemId));
      if (!ctx) return;
      const { checklist, unit, access, item } = ctx;
      if (!access.canEditTerms) return res.status(403).json({ message: READ_ONLY });
      const b = req.body || {};
      const sets: string[] = [];
      const params: any[] = [item.id];
      const put = (col: string, val: any) => { params.push(val); sets.push(`${col} = $${params.length}`); };
      let label: string = item.label, required: boolean = !!item.required, dueDate: string | null = item.due_date || null;
      if (b.label !== undefined) {
        label = typeof b.label === "string" ? oneLine(b.label) : "";
        if (!label) return res.status(400).json({ message: "An item needs a name. Delete it instead." });
        if (label.length > 300) return res.status(400).json({ message: "Keep the item to 300 characters or fewer" });
        put("label", label);
      }
      if (b.required !== undefined) {
        if (typeof b.required !== "boolean") return res.status(400).json({ message: "Required is yes or no" });
        required = b.required; put("required", required);
      }
      if (b.dueDate !== undefined) {
        dueDate = b.dueDate === null || b.dueDate === "" ? null : validDate(b.dueDate);
        if (b.dueDate !== null && b.dueDate !== "" && !dueDate) return res.status(400).json({ message: "The due date is a date, for example 2026-12-17" });
        put("due_date", dueDate);
      }
      if (b.note !== undefined) {
        if (b.note !== null && typeof b.note !== "string") return res.status(400).json({ message: "The note is text" });
        const note = b.note === null ? null : String(b.note).trim() || null;
        if (note && note.length > 2000) return res.status(400).json({ message: "Keep the note to 2,000 characters or fewer" });
        put("note", note);
      }
      let position: number | null = null;
      if (b.sortOrder !== undefined) {
        if (!Number.isInteger(b.sortOrder) || b.sortOrder < 0 || b.sortOrder > 10000) return res.status(400).json({ message: "The position is a whole number, 0 for first in the stage" });
        position = b.sortOrder;
      }
      if (sets.length === 0 && position === null) return res.status(400).json({ message: "Nothing to change" });

      await inTransaction(async db => {
        if (sets.length) await db.query(`UPDATE deal_checklist_items SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1`, params);
        // The open task on the person's list follows the item's name and date.
        if (item.task_id && (label !== item.label || dueDate !== (item.due_date || null) || required !== !!item.required)) {
          await db.query(
            `UPDATE user_tasks SET title = $2, due_date = $3, priority = $4 WHERE id = $1 AND source_ref LIKE $5 AND COALESCE(status, 'todo') <> 'done'`,
            [item.task_id, itemTaskTitle(label, unit).slice(0, 500), dueDate, required ? "high" : "medium", `${TASK_REF}%`]);
        }
        if (position !== null) {
          // Its new place among the stage's items, which are then renumbered 0, 1, 2...
          await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`deal_checklist_order:${checklist.id}:${item.stage}`]);
          const ids: string[] = (await db.query(
            `SELECT id FROM deal_checklist_items WHERE checklist_id = $1 AND stage = $2 AND id <> $3 ORDER BY sort_order, created_at, id`, [checklist.id, item.stage, item.id])).rows.map((r: any) => r.id);
          ids.splice(Math.min(position, ids.length), 0, item.id);
          await db.query(
            `UPDATE deal_checklist_items i SET sort_order = t.n::int - 1 FROM unnest($1::text[]) WITH ORDINALITY AS t(id, n) WHERE i.id = t.id`, [ids]);
        }
      });
      await touch(checklist.id);
      res.json(await checklistJson(checklist, unit, access));
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to save the item" });
    }
  });

  // Delete an item. A done item is the record: only BGP staff may delete one.
  app.delete("/api/deal-checklists/items/:itemId", requireAuth, async (req, res) => {
    try {
      const ctx = await itemCtx(req, res, String(req.params.itemId));
      if (!ctx) return;
      const { checklist, unit, access, item } = ctx;
      if (!access.canEditTerms) return res.status(403).json({ message: READ_ONLY });
      if (item.done_at && !access.isStaff) return res.status(403).json({ message: "A done item is kept as the record. Untick it first, or ask BGP to delete it." });
      await inTransaction(async db => {
        await dropOpenTask(db, item.task_id);
        await db.query(`DELETE FROM deal_checklist_items WHERE id = $1`, [item.id]);
      });
      await touch(checklist.id);
      res.json(await checklistJson(checklist, unit, access));
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to delete the item" });
    }
  });

  // Make someone responsible for an item, change who, or clear it.
  app.put("/api/deal-checklists/items/:itemId/assignee", requireAuth, async (req, res) => {
    try {
      const ctx = await itemCtx(req, res, String(req.params.itemId));
      if (!ctx) return;
      const { checklist, unit, access } = ctx;
      if (!access.canEditTerms) return res.status(403).json({ message: READ_ONLY });
      const key = req.body?.personKey;
      if (key !== null && (typeof key !== "string" || !key.trim())) return res.status(400).json({ message: "Pick the person from the list, or send personKey null to clear it" });
      const person = key === null ? null : (await peopleFor(unit, access)).find(p => p.key === key) || null;
      if (key !== null && !person) return res.status(400).json({ message: "That person cannot be made responsible here. Pick someone from the list." });

      const result = await inTransaction(async db => {
        const item = (await db.query(`SELECT i.*, EXISTS (SELECT 1 FROM user_tasks t WHERE t.id = i.task_id) AS has_task FROM deal_checklist_items i WHERE i.id = $1 FOR UPDATE OF i`, [ctx.item.id])).rows[0];
        if (!item) return { item: null as any, changed: false, taskId: null as string | null };
        const newTask = async () => makeTask(db, {
          userId: person!.userId!, title: itemTaskTitle(item.label, unit), description: itemTaskDescription(item, access),
          dueDate: item.due_date || null, required: !!item.required, unit, ref: `${TASK_REF}item:${item.id}`, access,
        });
        const same = !!person && !!item.assignee_name && (person.userId ? item.assignee_user_id === person.userId : !item.assignee_user_id && item.assignee_brief_person_id === person.briefPersonId);
        if (same) {
          // Already theirs. If they have removed it from their task list, put it back; no second email.
          if (person!.userId && person!.taskList && !item.done_at && !item.has_task) {
            const taskId = await newTask();
            await db.query(`UPDATE deal_checklist_items SET task_id = $2, updated_at = NOW() WHERE id = $1`, [item.id, taskId]);
          }
          return { item, changed: false, taskId: null as string | null };
        }
        if (!person && !item.assignee_name) return { item, changed: false, taskId: null as string | null };
        await dropOpenTask(db, item.task_id);
        // A done item has nothing left to do: the name is recorded, no task.
        const taskId = person?.userId && person.taskList && !item.done_at ? await newTask() : null;
        await db.query(
          `UPDATE deal_checklist_items SET assignee_user_id = $2, assignee_brief_person_id = $3, assignee_name = $4::text, assignee_email = $5, assignee_side = $6,
                  assigned_at = CASE WHEN $4::text IS NULL THEN NULL ELSE NOW() END, assigned_by_name = CASE WHEN $4::text IS NULL THEN NULL ELSE $7::text END,
                  task_id = $8, notified_at = NULL, updated_at = NOW() WHERE id = $1`,
          [item.id, person?.userId || null, person?.briefPersonId || null, person?.name || null, person?.email || null, person?.side || null, access.name, taskId]);
        return { item, changed: true, taskId };
      });
      if (!result.item) return res.status(404).json({ message: "That item was not found. It may have been deleted." });

      let mail: EmailResult = { emailed: false, emailError: null };
      if (result.changed && person && !result.item.done_at && person.userId !== access.userId) {
        if (person.userId && result.taskId) await notifyTask(person.userId, access, itemTaskTitle(result.item.label, unit), result.taskId);
        const { subject, html } = itemEmail("assigned", result.item, unit, { name: person.name, hasLogin: person.taskList }, access);
        mail = await sendEmail(person.email, person.name, subject, html);
        if (mail.emailed) await pool.query(`UPDATE deal_checklist_items SET notified_at = NOW() WHERE id = $1`, [result.item.id]);
      }
      await touch(checklist.id);
      res.json({ ...(await checklistJson(checklist, unit, access)), ...mail, taskCreated: !!result.taskId, selfAssigned: !!person?.userId && person.userId === access.userId });
    } catch (e: any) {
      console.error("[deal-checklist assignee]", e?.message);
      res.status(500).json({ message: e?.message || "Failed to save who is responsible" });
    }
  });

  // Tick an item done, or untick it. Anyone who may change the checklist,
  // and the item's own responsible person whoever they are.
  app.post("/api/deal-checklists/items/:itemId/done", requireAuth, async (req, res) => {
    try {
      const ctx = await itemCtx(req, res, String(req.params.itemId));
      if (!ctx) return;
      const { checklist, unit, access } = ctx;
      const done = req.body?.done;
      if (typeof done !== "boolean") return res.status(400).json({ message: "Say whether the item is done: done true or false" });
      if (!access.canEditTerms && !isMine(ctx.item, access)) return res.status(403).json({ message: "You can tick only the items you are responsible for" });
      const found = await inTransaction(async db => {
        const item = (await db.query(`SELECT i.*, EXISTS (SELECT 1 FROM user_tasks t WHERE t.id = i.task_id) AS has_task FROM deal_checklist_items i WHERE i.id = $1 FOR UPDATE OF i`, [ctx.item.id])).rows[0];
        if (!item) return false;
        // The check again on the locked row: it may have been given to someone else meanwhile.
        if (!access.canEditTerms && !isMine(item, access)) return null;
        if (done && !item.done_at) {
          await db.query(`UPDATE deal_checklist_items SET done_at = NOW(), done_by_user_id = $2, done_by_name = $3, updated_at = NOW() WHERE id = $1`, [item.id, access.userId, access.name]);
          if (item.task_id) await db.query(`UPDATE user_tasks SET status = 'done', completed_at = NOW() WHERE id = $1 AND COALESCE(status, 'todo') <> 'done'`, [item.task_id]);
        } else if (!done && item.done_at) {
          let taskId: string | null = item.has_task ? item.task_id : null;
          if (taskId) await db.query(`UPDATE user_tasks SET status = 'todo', completed_at = NULL WHERE id = $1 AND status = 'done'`, [taskId]);
          // Open again with nothing on the person's task list: put it there.
          else if (item.assignee_user_id && (await userHasTaskList(db, item.assignee_user_id))) {
            taskId = await makeTask(db, {
              userId: item.assignee_user_id, title: itemTaskTitle(item.label, unit), description: itemTaskDescription(item, access),
              dueDate: item.due_date || null, required: !!item.required, unit, ref: `${TASK_REF}item:${item.id}`, access,
            });
          }
          await db.query(`UPDATE deal_checklist_items SET done_at = NULL, done_by_user_id = NULL, done_by_name = NULL, task_id = $2, updated_at = NOW() WHERE id = $1`, [item.id, taskId]);
        }
        return true;
      });
      if (found === false) return res.status(404).json({ message: "That item was not found. It may have been deleted." });
      if (found === null) return res.status(403).json({ message: "You can tick only the items you are responsible for" });
      await touch(checklist.id);
      res.json(await checklistJson(checklist, unit, access));
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to save the item" });
    }
  });

  // Email the item's responsible person again, at most once an hour.
  app.post("/api/deal-checklists/items/:itemId/remind", requireAuth, async (req, res) => {
    try {
      const ctx = await itemCtx(req, res, String(req.params.itemId));
      if (!ctx) return;
      const { checklist, unit, access, item } = ctx;
      if (!access.canEditTerms) return res.status(403).json({ message: READ_ONLY });
      if (!item.assignee_name) return res.status(400).json({ message: "Nobody is responsible for this item yet. Make someone responsible first." });
      if (item.done_at) return res.status(400).json({ message: "This item is done, so there is nothing to remind anyone about" });
      if (!item.assignee_email) return res.status(400).json({ message: `There is no email address for ${item.assignee_name}. Tell them yourself.` });
      // The hour is claimed in one statement, so two presses send one email.
      const claimed = (await pool.query(
        `UPDATE deal_checklist_items SET notified_at = NOW() WHERE id = $1 AND (notified_at IS NULL OR notified_at < NOW() - ($2::int * INTERVAL '1 millisecond')) RETURNING id`,
        [item.id, REMIND_EVERY_MS])).rows[0];
      if (!claimed) {
        const mins = Math.max(1, Math.ceil((new Date(item.notified_at).getTime() + REMIND_EVERY_MS - Date.now()) / 60000));
        return res.status(429).json({ message: `${item.assignee_name} was emailed about this less than an hour ago. You can remind them again in ${mins} minute${mins === 1 ? "" : "s"}.` });
      }
      const { subject, html } = itemEmail("reminder", item, unit, { name: item.assignee_name, hasLogin: !!item.task_id }, access);
      const mail = await sendEmail(item.assignee_email, item.assignee_name, subject, html);
      // Not sent: the hour is given back, so it can be tried again.
      if (!mail.emailed) await pool.query(`UPDATE deal_checklist_items SET notified_at = $2 WHERE id = $1`, [item.id, item.notified_at || null]);
      res.json({ ...(await checklistJson(checklist, unit, access)), ...mail });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to send the reminder" });
    }
  });
}
