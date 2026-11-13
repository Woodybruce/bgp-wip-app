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
// on their own schemes. A joint agent on their scheme runs the checklist as
// BGP does (start, assign, edit, remind, tick, delete a ticked item) and has
// a task list of their own; they pick people from the client-side list, never
// BGP's staff directory.
//
// "Waiting on" (Woody, 2026-11-13): the deal clock's waiting-on can point at
// one item here (landsec_deal_clock.checklist_item_id, migration 0058; the
// rules are shared/deal-waiting.ts). Ticking that item, from the checklist or
// from the person's task list, moves the waiting-on to the next required item
// or clears it; giving the item to someone else carries the name across (only
// when the clock named the person it was with before); deleting it drops the
// link. A deal nobody has set a waiting-on for shows the one read from its
// checklist, worked out on read and never stored. A deal that has closed is
// waiting on no one: no marker here, no flag on a task, nothing derived.
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
  checklistHasTaskList, checklistLinkPath, checklistTasksPath, checklistWayFor,
  type ChecklistItem, type ChecklistPerson, type ChecklistSide, type ChecklistStageKey, type ChecklistSummary, type ChecklistWay, type DealChecklist,
} from "@shared/deal-checklist";
import {
  daysWaiting, reusableWaitingItem, validWaitingSince, waitedOnItem, waitingAfterAssign, waitingAfterTick, waitingClosed, waitingFlagFor, waitingFlagForResponsible,
  waitingPartyFor, waitingPersonFor, waitingPreviousOf, waitingTargetFor,
  type StoredWaiting, type WaitingChange, type WaitingChecklist, type WaitingFlag, type WaitingItem, type WaitingOptions, type WaitingPerson, type WaitingPrevious,
} from "@shared/deal-waiting";

const BGP_EMAIL_DOMAIN = "@brucegillinghampollard.com";
const TASK_CATEGORY = "Deal checklist";
const TASK_REF = "deal_checklist:";
const REMIND_EVERY_MS = 60 * 60 * 1000;

type Access = NonNullable<Awaited<ReturnType<typeof briefAccess>>>;
type Db = { query: (sql: string, params?: any[]) => Promise<any> };
// A person who can be made responsible, with what the server knows and the
// caller may not: the real email, why it may or may not be shown, whether
// their login has a task list (every login has one now; a login with a
// Landsec role has it at /landsec/tasks), and their Landsec role, which
// decides where their links go.
interface PersonRec extends ChecklistPerson { onBrief: boolean; ownCompany: boolean; taskList: boolean; landsecRole: string | null }
const hasTaskList = (landsecRole: any) => checklistHasTaskList(landsecRole);
const wayOf = (p: Pick<PersonRec, "hasLogin" | "landsecRole">): ChecklistWay => checklistWayFor(p.hasLogin, p.landsecRole);
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
            p.name AS property_name, c.name AS landlord_name, d.deal_ref, d.status AS deal_status
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

// Has the letting closed (withdrawn, completed, invoiced, archived)? The
// deal's own status, the test the Deals feed and the unit page make; the
// tracker unit's when the deal has none. A closed deal is waiting on no one.
const lettingClosed = (dealStatus: any, unitStatus: any): boolean => waitingClosed(legacyToCode(dealStatus) || legacyToCode(unitStatus));

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
// could not open the unit. A joint agent is a client caller here: the people
// on the brief plus the names their account may see, never BGP's directory.
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
      ? { key: `user:${u.id}`, userId: u.id, briefPersonId: p.id, name: u.name || p.name || u.email, email: u.email || null, side: sideOfBriefRole(p.role), role, hasLogin: true, onBrief: true, ownCompany: ownCompany(u), taskList: hasTaskList(u.landsec_role), landsecRole: u.landsec_role || null }
      : { key: `brief:${p.id}`, userId: null, briefPersonId: p.id, name: p.name, email: p.email || null, side: sideOfBriefRole(p.role), role, hasLogin: false, onBrief: true, ownCompany: false, taskList: false, landsecRole: null };
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
      hasLogin: true, onBrief: false, ownCompany: ownCompany(u), taskList: hasTaskList(u.landsec_role), landsecRole: u.landsec_role || null,
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
  const [itemsQ, people, waiting, canSetWaiting] = await Promise.all([
    pool.query(
      `SELECT i.*, EXISTS (SELECT 1 FROM user_tasks t WHERE t.id = i.task_id) AS has_task
         FROM deal_checklist_items i WHERE i.checklist_id = $1 ORDER BY i.sort_order, i.created_at, i.id`, [checklist.id]),
    peopleFor(unit, access),
    waitingOnChecklist(checklist, unit),
    unit.deal_id && !lettingClosed(unit.deal_status, unit.marketing_status) ? clockOpenAt(access, unit.property_id) : Promise.resolve(false),
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
    waiting,
    viewer: { isStaff: access.isStaff, canEdit: access.canEditTerms, canAssign: access.canEditTerms, canDeleteDone: access.agentControl, canSetWaiting },
  };
}

// The item on this checklist the deal is waiting on: the one set on the deal
// clock, else the one read from the checklist. Null when there is none here
// (also when the deal's waiting-on was typed with no item behind it, and when
// the deal has closed: waitedOnItem in shared/deal-waiting.ts is the rule).
async function waitingOnChecklist(checklist: any, unit: any): Promise<DealChecklist["waiting"]> {
  if (!unit.deal_id || (checklist.deal_id || "") !== unit.deal_id) return null;
  try {
    const [loaded, clock] = await Promise.all([
      loadWaitingChecklists(pool, "c.id", [checklist.id]).then(r => r[0] || null),
      pool.query(`SELECT * FROM landsec_deal_clock WHERE deal_id = $1`, [unit.deal_id]).then(r => r.rows[0] || null),
    ]);
    if (!loaded) return null;
    const stored = clock ? storedWaitingOf(clock) : null;
    const on = waitedOnItem(stored, loaded);
    if (!on) return null;
    if (!on.derived && stored) return { itemId: on.item.id, derived: false, days: daysWaiting(on.since), party: stored.party, name: stored.name };
    const target = waitingTargetFor(on.item, loaded);
    return { itemId: on.item.id, derived: true, days: daysWaiting(on.since), party: target.party, name: target.name };
  } catch (e: any) {
    console.warn("[deal-checklist] waiting-on could not be read:", e?.message);
    return null;
  }
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

// The Landsec role of a login, when it has one (for where its links go).
async function landsecRoleOf(db: Db, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  return (await db.query(`SELECT landsec_role FROM landsec_access WHERE user_id = $1`, [userId])).rows[0]?.landsec_role || null;
}

const itemTaskTitle = (label: string, unit: any) => `${oneLine(label)}: ${unitPlace(unit)}`;
const itemTaskDescription = (item: any, access: Access) =>
  `Deal checklist, ${stageLabel(item.stage)} stage. ${item.required ? "Required" : "Not required"}. Asked by ${access.name || "a colleague"}.`;

// Tell the person in the app, the way a task set from the Tasks page does.
async function notifyTask(userId: string, access: Access, title: string, taskId: string, landsecRole: string | null = null): Promise<void> {
  if (userId === access.userId) return;
  try {
    const [{ emitNotification }, { sendPushNotification }] = await Promise.all([import("./websocket"), import("./push-notifications")]);
    emitNotification(userId, { type: "task_assigned", threadId: "", senderName: access.name || "Someone", preview: title } as any);
    sendPushNotification(userId, { title: `New task from ${access.name || "a colleague"}`, body: title.slice(0, 100), tag: `task-${taskId}`, url: checklistTasksPath(landsecRole) }).catch(() => undefined);
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
async function sendEmail(to: string | null, name: string, subject: string, html: string, landlordName?: string | null): Promise<EmailResult> {
  if (!to) return { emailed: false, emailError: `there is no email address for ${name}` };
  let timer: NodeJS.Timeout | undefined;
  try {
    const { sendWorkspaceEmail } = await import("./shared-mailbox");
    await Promise.race([
      sendWorkspaceEmail({ to, subject: oneLine(subject).slice(0, 250), body: html, landlordName }),
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

function emailHtml(opts: { greetingName: string; lead: string; rows: [string, string][]; unitId: string; hasLogin: boolean; way?: ChecklistWay }): string {
  // A login that has the Letting Tracker goes to it. A joint agent goes to
  // their own tracker (/landsec/tracker). An asset manager's way in is the
  // Landsec unit page, which opens the same checklist. hasLogin here means
  // "has a task list"; way says where the link goes.
  const link = `${appBaseUrl()}${checklistLinkPath(opts.way || (opts.hasLogin ? "tracker" : "landsec_unit"), opts.unitId)}`;
  const rows = opts.rows.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;vertical-align:top"><strong>${esc(k)}</strong></td><td style="padding:2px 0">${esc(v)}</td></tr>`).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">
<p>Hello ${esc(opts.greetingName.split(" ")[0] || opts.greetingName)},</p>
<p>${esc(opts.lead)}</p>
<table style="border-collapse:collapse;font-size:14px">${rows}</table>
<p><a href="${esc(link)}">Open the deal checklist</a></p>
${opts.hasLogin ? "<p>It is also on your task list in the BGP app.</p>" : ""}
</div>`;
}

// The email to an item's responsible person (exported so it can be checked
// without sending anything).
export function itemEmail(kind: "assigned" | "reminder", item: any, unit: any, person: { name: string; hasLogin: boolean; way?: ChecklistWay }, access: Pick<Access, "name">): { subject: string; html: string } {
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
      rows, unitId: unit.id, hasLogin: person.hasLogin, way: person.way,
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

// The item, locked for this transaction, and whether its task still exists.
// The task is looked up in a statement of its own, after the lock is held:
// asked in the same statement it would be read as things stood before the
// wait, and a task another request had just made would be missed.
async function lockItem(db: Db, itemId: string): Promise<any | null> {
  const item = (await db.query(`SELECT * FROM deal_checklist_items WHERE id = $1 FOR UPDATE`, [itemId])).rows[0];
  if (!item) return null;
  item.has_task = !!item.task_id && (await db.query(`SELECT 1 FROM user_tasks WHERE id = $1`, [item.task_id])).rows.length > 0;
  return item;
}

const READ_ONLY = "You can read this checklist and tick your own items, not change it";

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

// ── Waiting on (shared/deal-waiting.ts) ──────────────────────────────────
// A checklist as the waiting-on rules read it: the unit's CURRENT checklist
// only (the unit's deal is the checklist's deal), each person with what is
// known of their role, so the party they stand for can be worked out.
type LoadedItem = WaitingItem & { personKey: string | null };
type LoadedChecklist = Omit<WaitingChecklist, "items"> & { unitId: string; responsibleKey: string | null; responsibleUserId: string | null; items: LoadedItem[] };

const WAITING_SQL = `SELECT c.id AS checklist_id, c.unit_id, c.deal_id, au.marketing_status, d.status AS deal_status,
         c.responsible_user_id, c.responsible_brief_person_id, c.responsible_name, c.responsible_side, COALESCE(rb.role, ra.landsec_role) AS responsible_role,
         i.id AS item_id, i.stage, i.label, i.required, i.sort_order, i.done_at, i.assigned_at,
         i.assignee_user_id, i.assignee_brief_person_id, i.assignee_name, i.assignee_side, COALESCE(ib.role, ia.landsec_role) AS assignee_role
    FROM deal_checklists c
    JOIN available_units au ON au.id = c.unit_id AND au.deal_id = c.deal_id
    LEFT JOIN crm_deals d ON d.id = c.deal_id
    LEFT JOIN landsec_access ra ON ra.user_id = c.responsible_user_id
    LEFT JOIN unit_brief_people rb ON rb.id = c.responsible_brief_person_id
    LEFT JOIN deal_checklist_items i ON i.checklist_id = c.id
    LEFT JOIN landsec_access ia ON ia.user_id = i.assignee_user_id
    LEFT JOIN unit_brief_people ib ON ib.id = i.assignee_brief_person_id`;

const personKeyOf = (userId: any, briefPersonId: any): string | null => (userId ? `user:${userId}` : briefPersonId ? `brief:${briefPersonId}` : null);

async function loadWaitingChecklists(db: Db, by: "c.deal_id" | "c.id", ids: string[]): Promise<LoadedChecklist[]> {
  if (ids.length === 0) return [];
  const rows: any[] = (await db.query(`${WAITING_SQL} WHERE ${by} = ANY($1::text[]) ORDER BY c.created_at, c.id, i.sort_order, i.created_at, i.id`, [ids])).rows;
  const out = new Map<string, LoadedChecklist>();
  for (const r of rows) {
    let c = out.get(r.checklist_id);
    if (!c) {
      c = {
        id: r.checklist_id, unitId: r.unit_id, dealId: r.deal_id || null,
        stage: checklistStageFor(legacyToCode(r.marketing_status) || "AVA"),
        closed: lettingClosed(r.deal_status, r.marketing_status),
        responsible: r.responsible_name
          ? { userId: r.responsible_user_id || null, name: r.responsible_name, side: isSide(r.responsible_side) ? r.responsible_side : null, role: r.responsible_role || null }
          : null,
        responsibleKey: r.responsible_name ? personKeyOf(r.responsible_user_id, r.responsible_brief_person_id) : null,
        responsibleUserId: r.responsible_name ? r.responsible_user_id || null : null,
        items: [],
      };
      out.set(r.checklist_id, c);
    }
    if (!r.item_id) continue;
    c.items.push({
      id: r.item_id, stage: isStage(r.stage) ? r.stage : "enquiry", label: r.label, required: !!r.required, sortOrder: r.sort_order ?? 0,
      done: !!r.done_at, assignedAt: r.assigned_at || null,
      assignee: r.assignee_name
        ? { userId: r.assignee_user_id || null, name: r.assignee_name, side: isSide(r.assignee_side) ? r.assignee_side : null, role: r.assignee_role || null }
        : null,
      personKey: r.assignee_name ? personKeyOf(r.assignee_user_id, r.assignee_brief_person_id) : null,
    });
  }
  return Array.from(out.values());
}

const storedWaitingOf = (c: any): StoredWaiting => ({
  dealId: c.deal_id, party: c.waiting_on_party || null, name: c.waiting_on_name || null,
  since: c.waiting_since || null, note: c.waiting_note || null, checklistItemId: c.checklist_item_id || null,
});

// The checklist of each deal, for the Deals feed and the unit page, which
// read a deal's waiting-on from it when nobody has set one. Never throws: a
// feed must not fail because the checklists could not be read.
export async function waitingChecklistsForDeals(dealIds: string[]): Promise<Map<string, WaitingChecklist>> {
  const out = new Map<string, WaitingChecklist>();
  try {
    for (const c of await loadWaitingChecklists(pool, "c.deal_id", Array.from(new Set(dealIds.filter(Boolean))))) {
      if (c.dealId && !out.has(c.dealId)) out.set(c.dealId, c);
    }
  } catch (e: any) {
    console.warn("[deal-checklist] checklists for the waiting-on could not be read:", e?.message);
  }
  return out;
}

// What is stored on the deal clock for each of these checklists' deals.
async function storedWaitingFor(checklists: LoadedChecklist[]): Promise<Map<string, StoredWaiting>> {
  const dealIds = checklists.map(c => c.dealId).filter((d): d is string => !!d);
  const clocks: any[] = dealIds.length ? (await pool.query(`SELECT * FROM landsec_deal_clock WHERE deal_id = ANY($1::text[])`, [dealIds])).rows : [];
  return new Map<string, StoredWaiting>(clocks.map(c => [c.deal_id, storedWaitingOf(c)]));
}

// For the task lists (GET /api/tasks): is the deal waiting on each of these
// checklist items, and for how many days? The stored link when someone has
// set the deal's waiting-on, else the item read from the checklist. Every id
// asked for is answered; an item of an earlier letting, a done item, an item
// on a deal that has closed or one that is not found is false. Never throws.
export async function waitingFlagsForChecklistItems(itemIds: string[]): Promise<Map<string, WaitingFlag>> {
  const out = new Map<string, WaitingFlag>();
  const ids = Array.from(new Set((itemIds || []).filter(id => typeof id === "string" && !!id)));
  for (const id of ids) out.set(id, { waitingOnDeal: false, waitingDays: null });
  if (ids.length === 0) return out;
  try {
    const checklistIds: string[] = (await pool.query(`SELECT DISTINCT checklist_id FROM deal_checklist_items WHERE id = ANY($1::text[])`, [ids])).rows.map((r: any) => r.checklist_id);
    const checklists = await loadWaitingChecklists(pool, "c.id", checklistIds);
    const stored = await storedWaitingFor(checklists);
    const now = Date.now();
    for (const c of checklists) {
      for (const i of c.items) if (out.has(i.id)) out.set(i.id, waitingFlagFor(i.id, c.dealId ? stored.get(c.dealId) : null, c, now));
    }
  } catch (e: any) {
    console.warn("[deal-checklist] waiting flags could not be read:", e?.message);
  }
  return out;
}

// The same for the "Responsible for the letting" task of each checklist
// ('deal_checklist:deal:<checklistId>'): the deal is waiting on the person
// responsible for it when the item it is waiting on has nobody of its own.
// userId is that person's login, so a task left with someone else is never
// flagged. Every id asked for is answered; never throws.
export async function waitingFlagsForChecklists(checklistIds: string[]): Promise<Map<string, WaitingFlag & { userId: string | null }>> {
  const out = new Map<string, WaitingFlag & { userId: string | null }>();
  const ids = Array.from(new Set((checklistIds || []).filter(id => typeof id === "string" && !!id)));
  for (const id of ids) out.set(id, { waitingOnDeal: false, waitingDays: null, userId: null });
  if (ids.length === 0) return out;
  try {
    const checklists = await loadWaitingChecklists(pool, "c.id", ids);
    const stored = await storedWaitingFor(checklists);
    const now = Date.now();
    for (const c of checklists) out.set(c.id, { ...waitingFlagForResponsible(c.dealId ? stored.get(c.dealId) : null, c, now), userId: c.responsibleUserId });
  } catch (e: any) {
    console.warn("[deal-checklist] waiting flags for the deal's person could not be read:", e?.message);
  }
  return out;
}

const CHECKLIST_AS_WRITER = "The deal checklist";

async function applyWaitingChange(db: Db, dealId: string, change: WaitingChange): Promise<void> {
  if (change.action === "move") {
    await db.query(
      `UPDATE landsec_deal_clock SET checklist_item_id = $2, waiting_on_party = $3, waiting_on_name = $4, waiting_since = NOW(), waiting_note = $5,
              updated_by = NULL, updated_by_name = $6, updated_at = NOW() WHERE deal_id = $1`,
      [dealId, change.itemId, change.party, change.name, change.note, CHECKLIST_AS_WRITER]);
  } else if (change.action === "clear") {
    await db.query(
      `UPDATE landsec_deal_clock SET checklist_item_id = NULL, waiting_on_party = NULL, waiting_on_name = NULL, waiting_since = NULL, waiting_note = NULL,
              updated_by = NULL, updated_by_name = $2, updated_at = NOW() WHERE deal_id = $1`, [dealId, CHECKLIST_AS_WRITER]);
  } else if (change.action === "unlink") {
    await db.query(`UPDATE landsec_deal_clock SET checklist_item_id = NULL, updated_at = NOW() WHERE deal_id = $1`, [dealId]);
  }
}

// The item was ticked: a deal waiting on it moves on to the next required
// item with someone responsible, or its waiting-on is cleared. Runs in the
// tick's own transaction, so it reads the item as done.
async function advanceWaitingAfterTick(db: Db, itemId: string): Promise<void> {
  const clocks: any[] = (await db.query(`SELECT * FROM landsec_deal_clock WHERE checklist_item_id = $1 FOR UPDATE`, [itemId])).rows;
  if (clocks.length === 0) return;
  const checklistId = (await db.query(`SELECT checklist_id FROM deal_checklist_items WHERE id = $1`, [itemId])).rows[0]?.checklist_id;
  const checklist = checklistId ? (await loadWaitingChecklists(db, "c.id", [checklistId]))[0] || null : null;
  for (const c of clocks) await applyWaitingChange(db, c.deal_id, waitingAfterTick(storedWaitingOf(c), itemId, true, checklist));
}

// Before the responsible person changes (on these items, or for the whole
// deal): who each item a deal is waiting on was with, as the clock would have
// named them (their name and the party they stand for). Null when no deal is
// waiting on any of them, so the common case costs one small query. With no
// item ids it is the deal's own person who is changing: only an item with
// nobody of its own falls to them, so only those are read.
async function waitingPeopleBefore(db: Db, checklistId: string, itemIds: string[] | null): Promise<Map<string, WaitingPrevious | null> | null> {
  const linked: string[] = (await db.query(
    `SELECT i.id FROM landsec_deal_clock k JOIN deal_checklist_items i ON i.id = k.checklist_item_id
      WHERE i.checklist_id = $1 AND CASE WHEN $2::text[] IS NULL THEN i.assignee_name IS NULL ELSE i.id = ANY($2::text[]) END`, [checklistId, itemIds])).rows.map((r: any) => r.id);
  if (linked.length === 0) return null;
  const checklist = (await loadWaitingChecklists(db, "c.id", [checklistId]))[0] || null;
  const out = new Map<string, WaitingPrevious | null>();
  for (const id of linked) {
    const item = checklist?.items.find(i => i.id === id) || null;
    out.set(id, item && checklist ? waitingPreviousOf(waitingPersonFor(item, checklist)) : null);
  }
  return out;
}

// The responsible person changed: a deal waiting on one of the items follows
// the person, when its clock named the person the item was with before and
// its party was theirs (waitingAfterAssign). A waiting-on typed by hand is
// left as typed, and its clock keeps running.
async function followWaitingAfterAssign(db: Db, checklistId: string, before: Map<string, WaitingPrevious | null>): Promise<void> {
  const clocks: any[] = (await db.query(
    `SELECT k.* FROM landsec_deal_clock k JOIN deal_checklist_items i ON i.id = k.checklist_item_id
      WHERE i.checklist_id = $1 AND i.id = ANY($2::text[]) FOR UPDATE OF k`, [checklistId, Array.from(before.keys())])).rows;
  if (clocks.length === 0) return;
  const checklist = (await loadWaitingChecklists(db, "c.id", [checklistId]))[0] || null;
  for (const c of clocks) {
    const change = waitingAfterAssign(storedWaitingOf(c), c.checklist_item_id, checklist, before.get(c.checklist_item_id) || null);
    if (change.action !== "update") continue;
    await db.query(
      `UPDATE landsec_deal_clock SET waiting_on_party = $2, waiting_on_name = $3, waiting_since = CASE WHEN $4::boolean THEN NOW() ELSE waiting_since END,
              updated_by = NULL, updated_by_name = $5, updated_at = NOW() WHERE deal_id = $1`,
      [c.deal_id, change.party, change.name, change.restart, CHECKLIST_AS_WRITER]);
  }
}

// The waiting-on follows the checklist, but a checklist write never fails
// because of it: inside the caller's transaction, under a savepoint.
async function alongside(db: Db, what: string, fn: () => Promise<void>): Promise<void> {
  await db.query("SAVEPOINT waiting_on");
  try {
    await fn();
    await db.query("RELEASE SAVEPOINT waiting_on");
  } catch (e: any) {
    await db.query("ROLLBACK TO SAVEPOINT waiting_on").catch(() => undefined);
    console.warn(`[deal-checklist] waiting-on not updated (${what}):`, e?.message);
  }
}

// May this caller write the deal clock of this deal? The same check the
// clock's own route makes (unitAccess in server/landsec-unit.ts): a Landsec
// scheme, and for an asset manager or joint agent one of their own.
async function mayWriteClock(req: Request, dealId: string | null | undefined): Promise<boolean> {
  if (!dealId) return false;
  const propertyId = (await pool.query(`SELECT property_id FROM crm_deals WHERE id = $1`, [dealId])).rows[0]?.property_id;
  if (!propertyId) return false;
  const { unitAccess } = await import("./landsec-unit");
  return !!(await unitAccess(req, propertyId));
}

// Is this property one of the Landsec schemes, for a caller who has already
// passed briefAccess on it? That is who the clock route lets write: the
// checklist offers "Deal is waiting on this" to them. The route itself checks
// again with mayWriteClock.
async function clockOpenAt(access: Access, propertyId: string | null | undefined): Promise<boolean> {
  if (!propertyId) return false;
  try {
    const { landsecCompanyId, isLandsecCompany, resolveLandsecPortfolio } = await import("./landsec-schemes");
    const companyId = access.scope ? ((await isLandsecCompany(access.scope)) ? access.scope : null) : await landsecCompanyId();
    if (!companyId) return false;
    return (await resolveLandsecPortfolio(companyId)).schemes.some(s => s.properties.some(p => p.id === propertyId));
  } catch {
    return false;
  }
}

// The tracker unit a deal is the current letting of.
async function unitOfDeal(dealId: string): Promise<any | null> {
  const id = (await pool.query(`SELECT id FROM available_units WHERE deal_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1`, [dealId])).rows[0]?.id;
  return id ? loadUnit(id) : null;
}

// What the Waiting on editor offers for a deal: the open items on its
// checklist and the people who can be made responsible. Reading this never
// starts a checklist. A caller with no way into the unit's checklist is
// given nothing to pick from.
export async function waitingOptionsForDeal(req: Request, dealId: string): Promise<WaitingOptions> {
  const none: WaitingOptions = { trackerUnitId: null, started: false, canStart: false, canLink: false, stage: null, items: [], people: [] };
  const unit = await unitOfDeal(dealId);
  const access = unit ? await briefAccess(req, unit.property_id) : null;
  if (!unit || !access) return none;
  const stage = checklistStageFor(legacyToCode(unit.marketing_status) || "AVA");
  const checklist = await currentChecklist(unit);
  if (!checklist) return { ...none, trackerUnitId: unit.id, canStart: access.canEditTerms, stage };
  const [loaded, people] = await Promise.all([
    loadWaitingChecklists(pool, "c.id", [checklist.id]).then(r => r[0] || null),
    access.canEditTerms ? peopleFor(unit, access) : Promise.resolve([] as PersonRec[]),
  ]);
  const items = (loaded?.items || [])
    .filter(i => !i.done)
    .sort((a, b) => stageIndex(a.stage) - stageIndex(b.stage) || a.sortOrder - b.sortOrder)
    .map(i => {
      const person = waitingPersonFor(i, loaded!);
      return {
        id: i.id, stage: i.stage as ChecklistStageKey, label: i.label, required: i.required,
        person: person ? { key: i.assignee ? i.personKey : loaded!.responsibleKey, name: person.name, side: person.side } : null,
        party: waitingPartyFor(person), viaDeal: !i.assignee && !!person,
      };
    });
  return {
    trackerUnitId: unit.id, started: true, canStart: false, canLink: access.canEditTerms, stage, items,
    people: people.map(p => ({
      key: p.key, userId: p.userId, briefPersonId: p.briefPersonId, name: p.name, email: mayShowEmail(p, access) ? p.email : null, side: p.side, role: p.role, hasLogin: p.hasLogin,
      party: waitingPartyFor({ side: p.side, role: p.landsecRole || p.role }),
    })),
  };
}

// The checklist half of saving a deal's waiting-on (PUT
// /api/landsec/deal/:id/clock, which has already checked the caller may
// write the clock at the deal's scheme). It checks the link, adds a typed
// item, and hands back the item, the party and name to default to, and the
// step that makes the named person responsible. That step is the checklist's
// own assign: one task, one email, none when it is already theirs and none to
// the person saving.
export type WaitingLink =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      itemId: string | null;            // null = no link (the waiting-on is free text)
      label: string | null;
      party: string | null;
      name: string | null;
      assign: () => Promise<{ personName: string; emailed: boolean; emailError: string | null; taskCreated: boolean; selfAssigned: boolean; changed: boolean } | null>;
    };

export async function prepareWaitingLink(req: Request, dealId: string, body: { checklistItemId?: unknown; newItemLabel?: unknown; personKey?: unknown; waitingSince?: unknown }): Promise<WaitingLink> {
  const refuse = (status: number, error: string): WaitingLink => ({ ok: false, status, error });
  // The clock route writes this date after the link is prepared. A date it
  // cannot read is refused here, before a typed item is added.
  if (!validWaitingSince(body.waitingSince)) return refuse(400, "The Since date is a date, for example 2026-11-13");
  if (body.checklistItemId != null && typeof body.checklistItemId !== "string") return refuse(400, "The checklist item is its id, or null for none");
  if (body.newItemLabel != null && typeof body.newItemLabel !== "string") return refuse(400, "The new item is text");
  if (body.personKey != null && typeof body.personKey !== "string") return refuse(400, "Pick the person from the list");
  const itemId = typeof body.checklistItemId === "string" ? body.checklistItemId.trim() : "";
  const newLabel = typeof body.newItemLabel === "string" ? oneLine(body.newItemLabel) : "";
  const personKey = typeof body.personKey === "string" ? body.personKey.trim() : "";
  if (itemId && newLabel) return refuse(400, "Pick an item on the checklist or type a new one, not both");
  if (!itemId && !newLabel) {
    if (personKey) return refuse(400, "Pick what the deal is waiting for before choosing who is responsible for it");
    return { ok: true, itemId: null, label: null, party: null, name: null, assign: async () => null };
  }
  if (newLabel.length > 300) return refuse(400, "Keep the item to 300 characters or fewer");

  const unit = await unitOfDeal(dealId);
  if (!unit) return refuse(400, "This deal is not on the Letting Tracker, so it has no checklist to link to");
  const access = await briefAccess(req, unit.property_id);
  if (!access) return refuse(403, "This deal's checklist is outside your access");
  const checklist = await currentChecklist(unit);
  if (!checklist || (checklist.deal_id || "") !== dealId) return refuse(409, "This deal has no checklist yet. Start the checklist, then pick what the deal is waiting for.");

  let item: any = null;
  if (itemId) {
    item = (await pool.query(`SELECT * FROM deal_checklist_items WHERE id = $1`, [itemId])).rows[0] || null;
    if (!item || item.checklist_id !== checklist.id) return refuse(400, "That item is not on this deal's checklist");
    if (item.done_at) return refuse(400, "That item is already done. Pick an open one.");
  } else if (!access.canEditTerms) {
    return refuse(403, READ_ONLY);
  }
  let person: PersonRec | null = null;
  if (personKey) {
    if (!access.canEditTerms) return refuse(403, READ_ONLY);
    person = (await peopleFor(unit, access)).find(p => p.key === personKey) || null;
    if (!person) return refuse(400, "That person cannot be made responsible here. Pick someone from the list.");
  }
  // A typed item joins the checklist at the deal's current stage, not
  // required. An open item with the same words at that stage is reused, so a
  // repeated save never adds a second item (or a second task).
  if (!item) {
    const added = await addItemOnce(checklist, unit, access, checklistStageFor(legacyToCode(unit.marketing_status) || "AVA"), newLabel);
    item = added.item;
    if (added.created) await touch(checklist.id);
  }

  const loaded = (await loadWaitingChecklists(pool, "c.id", [checklist.id]))[0] || null;
  const onList = loaded?.items.find(i => i.id === item.id) || null;
  const who: Pick<WaitingPerson, "name" | "side" | "role"> | null = person
    ? { name: person.name, side: person.side, role: person.landsecRole || person.role }
    : onList && loaded ? waitingPersonFor(onList, loaded) : null;
  const ctx: Ctx = { checklist, unit, access };
  return {
    ok: true, itemId: item.id, label: item.label, party: waitingPartyFor(who), name: who?.name || null,
    assign: async () => {
      if (!person) return null;
      const done = await assignItem(ctx, item.id, person);
      await touch(checklist.id);
      return { personName: person.name, emailed: done.mail.emailed, emailError: done.mail.emailError, taskCreated: done.taskCreated, selfAssigned: done.selfAssigned, changed: done.changed };
    },
  };
}

// Add an item to a stage, under the stage's ordering lock, so two adds at
// once take different places.
async function addItem(checklist: any, unit: any, access: Access, stage: ChecklistStageKey, label: string, required: boolean): Promise<any> {
  return inTransaction(async db => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`deal_checklist_order:${checklist.id}:${stage}`]);
    return (await db.query(
      `INSERT INTO deal_checklist_items (checklist_id, unit_id, stage, label, required, sort_order, created_by_user_id, created_by_name)
       VALUES ($1::text, $2, $3::text, $4, $5, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM deal_checklist_items WHERE checklist_id = $1::text AND stage = $3::text), $6, $7)
       RETURNING *`,
      [checklist.id, unit.id, stage, label, required, access.userId, access.name])).rows[0];
  });
}

// A typed "new item" from the Waiting on editor: the open item with the same
// words at that stage if there is one, else a new one that is not required.
// The look and the insert share the stage's ordering lock, so two saves at
// once still make one item.
async function addItemOnce(checklist: any, unit: any, access: Access, stage: ChecklistStageKey, label: string): Promise<{ item: any; created: boolean }> {
  return inTransaction(async db => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`deal_checklist_order:${checklist.id}:${stage}`]);
    const open: any[] = (await db.query(
      `SELECT * FROM deal_checklist_items WHERE checklist_id = $1 AND stage = $2 AND done_at IS NULL ORDER BY sort_order, created_at, id`, [checklist.id, stage])).rows;
    const same = reusableWaitingItem(open.map(r => ({ label: String(r.label || ""), stage: String(r.stage), done: false, row: r })), label, stage);
    if (same) return { item: same.row, created: false };
    const item = (await db.query(
      `INSERT INTO deal_checklist_items (checklist_id, unit_id, stage, label, required, sort_order, created_by_user_id, created_by_name)
       VALUES ($1::text, $2, $3::text, $4, false, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM deal_checklist_items WHERE checklist_id = $1::text AND stage = $3::text), $5, $6)
       RETURNING *`,
      [checklist.id, unit.id, stage, label, access.userId, access.name])).rows[0];
    return { item, created: true };
  });
}

// Make someone responsible for an item, change who, or clear it: the task on
// their list, the in-app notice and the email. One door, used by the
// checklist's own route and by the Waiting on editor.
interface AssignOutcome { item: any | null; changed: boolean; taskCreated: boolean; selfAssigned: boolean; mail: EmailResult }
async function assignItem(ctx: Ctx, itemId: string, person: PersonRec | null): Promise<AssignOutcome> {
  const { unit, access } = ctx;
  const result = await inTransaction(async db => {
    const item = await lockItem(db, itemId);
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
    // Who a deal waiting on this item was waiting on, read before the change.
    const waitingBefore: { people: Map<string, WaitingPrevious | null> | null } = { people: null };
    await alongside(db, "assign, before", async () => { waitingBefore.people = await waitingPeopleBefore(db, item.checklist_id, [item.id]); });
    // A done item has nothing left to do: the name is recorded, no task.
    const taskId = person?.userId && person.taskList && !item.done_at ? await newTask() : null;
    await db.query(
      `UPDATE deal_checklist_items SET assignee_user_id = $2, assignee_brief_person_id = $3, assignee_name = $4::text, assignee_email = $5, assignee_side = $6,
              assigned_at = CASE WHEN $4::text IS NULL THEN NULL ELSE NOW() END, assigned_by_name = CASE WHEN $4::text IS NULL THEN NULL ELSE $7::text END,
              task_id = $8, notified_at = NULL, updated_at = NOW() WHERE id = $1`,
      [item.id, person?.userId || null, person?.briefPersonId || null, person?.name || null, person?.email || null, person?.side || null, access.name, taskId]);
    // A deal waiting on this item is now waiting on the new person, unless
    // someone typed who it is waiting on by hand.
    if (waitingBefore.people) await alongside(db, "assign", () => followWaitingAfterAssign(db, item.checklist_id, waitingBefore.people!));
    return { item, changed: true, taskId };
  });
  let mail: EmailResult = { emailed: false, emailError: null };
  if (result.item && result.changed && person && !result.item.done_at && person.userId !== access.userId) {
    if (person.userId && result.taskId) await notifyTask(person.userId, access, itemTaskTitle(result.item.label, unit), result.taskId, person.landsecRole);
    const { subject, html } = itemEmail("assigned", result.item, unit, { name: person.name, hasLogin: person.taskList, way: wayOf(person) }, access);
    mail = await sendEmail(person.email, person.name, subject, html, unit.landlord_name);
    if (mail.emailed) await pool.query(`UPDATE deal_checklist_items SET notified_at = NOW() WHERE id = $1`, [result.item.id]);
  }
  return { item: result.item, changed: result.changed, taskCreated: !!result.taskId, selfAssigned: !!person?.userId && person.userId === access.userId, mail };
}

// Remove a unit's checklists, their items and the open tasks made for them.
// For the unit delete (server/routes.ts). A deal clock waiting on one of the
// items keeps its words and loses the link.
export async function deleteUnitChecklists(unitId: string, db: Db = pool): Promise<void> {
  await db.query(`UPDATE landsec_deal_clock SET checklist_item_id = NULL WHERE checklist_item_id IN (SELECT id FROM deal_checklist_items WHERE unit_id = $1)`, [unitId])
    .catch((e: any) => console.warn("[deal-checklist] waiting-on link not cleared:", e?.message));
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
// A Landsec login held to named schemes (a joint agent) ticks only an item
// on a unit at one of its schemes: a task left over from a scheme since taken
// off the login changes the task, not the checklist.
export async function syncChecklistItemFromTask(taskId: string, done: boolean, by: { userId: string | null; name: string | null }, db: Db = pool): Promise<void> {
  if (by.userId) {
    const held = (await db.query(`SELECT landsec_role, schemes FROM landsec_access WHERE user_id = $1`, [by.userId])).rows[0];
    if (held && (RESTRICTED_LANDSEC_ROLES as string[]).includes(String(held.landsec_role || ""))) {
      const where = (await db.query(
        `SELECT p.name AS property_name FROM deal_checklist_items i
           JOIN available_units au ON au.id = i.unit_id
           LEFT JOIN crm_properties p ON p.id = au.property_id
          WHERE i.task_id = $1 LIMIT 1`, [taskId])).rows[0];
      if (!where) return;
      const { schemeForPropertyName } = await import("./landsec-schemes");
      const key = schemeForPropertyName(where.property_name)?.key || null;
      if (!key || !(held.schemes || []).includes(key)) {
        console.warn("[deal-checklist] task", taskId, "not carried to the checklist: its unit is outside the login's schemes");
        return;
      }
    }
  }
  if (!done) {
    // Unticking does not move a deal's waiting-on back.
    await db.query(`UPDATE deal_checklist_items SET done_at = NULL, done_by_user_id = NULL, done_by_name = NULL, updated_at = NOW() WHERE task_id = $1 AND done_at IS NOT NULL`, [taskId]);
    return;
  }
  // The tick and the move of a deal's waiting-on are one transaction: the
  // same as a tick on the checklist itself.
  const tick = async (d: Db, inOwnTransaction: boolean) => {
    const ticked: any[] = (await d.query(
      `UPDATE deal_checklist_items SET done_at = NOW(), done_by_user_id = $2, done_by_name = $3, updated_at = NOW() WHERE task_id = $1 AND done_at IS NULL RETURNING id`, [taskId, by.userId, by.name])).rows;
    for (const r of ticked) {
      if (inOwnTransaction) await alongside(d, "task ticked", () => advanceWaitingAfterTick(d, r.id));
      else await advanceWaitingAfterTick(d, r.id).catch((e: any) => console.warn("[deal-checklist] waiting-on not updated (task ticked):", e?.message));
    }
  };
  if (db === pool) await inTransaction(d => tick(d, true));
  else await tick(db, false);
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
        // Who each deal waiting on this checklist was waiting on, read before the change.
        const waitingBefore: { people: Map<string, WaitingPrevious | null> | null } = { people: null };
        await alongside(db, "responsible, before", async () => { waitingBefore.people = await waitingPeopleBefore(db, row.id, null); });
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
        // A deal waiting on an item with nobody of its own follows the new
        // person, unless someone typed who it is waiting on by hand.
        if (waitingBefore.people) await alongside(db, "responsible", () => followWaitingAfterAssign(db, row.id, waitingBefore.people!));
        return { changed: true, taskId };
      });

      let mail: EmailResult = { emailed: false, emailError: null };
      if (result.changed && person && person.userId !== access.userId) {
        if (person.userId && result.taskId) await notifyTask(person.userId, access, title, result.taskId, person.landsecRole);
        const who = access.name || "A colleague";
        mail = await sendEmail(person.email, person.name, `${who} has made you responsible for the letting of ${unitPlace(unit)}`, emailHtml({
          greetingName: person.name,
          lead: `${who} has made you responsible for the letting of ${unitPlace(unit)}. Any item on its deal checklist with nobody on it falls to you.`,
          rows: [["Letting", unitPlace(unit)], ["Stage", stageLabel(checklistStageFor(legacyToCode(unit.marketing_status)))], ["Asked by", who]],
          unitId: unit.id, hasLogin: person.taskList, way: wayOf(person),
        }), unit.landlord_name);
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
      await addItem(checklist, unit, access, b.stage, label, !!b.required);
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

  // Delete an item. A done item is the record: only BGP staff, and a joint
  // agent on their scheme, may delete one.
  app.delete("/api/deal-checklists/items/:itemId", requireAuth, async (req, res) => {
    try {
      const ctx = await itemCtx(req, res, String(req.params.itemId));
      if (!ctx) return;
      const { checklist, unit, access, item } = ctx;
      if (!access.canEditTerms) return res.status(403).json({ message: READ_ONLY });
      if (item.done_at && !access.agentControl) return res.status(403).json({ message: "A done item is kept as the record. Untick it first, or ask the agents to delete it." });
      await inTransaction(async db => {
        await dropOpenTask(db, item.task_id);
        // A deal waiting on this item keeps its words and loses the link.
        await alongside(db, "delete", async () => { await db.query(`UPDATE landsec_deal_clock SET checklist_item_id = NULL, updated_at = NOW() WHERE checklist_item_id = $1`, [item.id]); });
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

      const result = await assignItem(ctx, ctx.item.id, person);
      if (!result.item) return res.status(404).json({ message: "That item was not found. It may have been deleted." });
      await touch(checklist.id);
      res.json({ ...(await checklistJson(checklist, unit, access)), ...result.mail, taskCreated: result.taskCreated, selfAssigned: result.selfAssigned });
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
        const item = await lockItem(db, ctx.item.id);
        if (!item) return false;
        // The check again on the locked row: it may have been given to someone else meanwhile.
        if (!access.canEditTerms && !isMine(item, access)) return null;
        if (done && !item.done_at) {
          await db.query(`UPDATE deal_checklist_items SET done_at = NOW(), done_by_user_id = $2, done_by_name = $3, updated_at = NOW() WHERE id = $1`, [item.id, access.userId, access.name]);
          if (item.task_id) await db.query(`UPDATE user_tasks SET status = 'done', completed_at = NOW() WHERE id = $1 AND COALESCE(status, 'todo') <> 'done'`, [item.task_id]);
          // A deal waiting on this item moves on to the next required one, or clears.
          await alongside(db, "ticked", () => advanceWaitingAfterTick(db, item.id));
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

  // "Deal is waiting on this": point the deal's waiting-on at an open item,
  // for the people who may write the deal clock at the scheme. Who it is
  // waiting on is the item's responsible person (else the person responsible
  // for the deal). Nobody is emailed or given a task by this.
  app.post("/api/deal-checklists/items/:itemId/waiting", requireAuth, async (req, res) => {
    try {
      const ctx = await itemCtx(req, res, String(req.params.itemId));
      if (!ctx) return;
      const { checklist, unit, access, item } = ctx;
      if (!unit.deal_id) return res.status(409).json({ message: "This unit has no deal yet, so there is nothing to set as waiting" });
      if (!(await mayWriteClock(req, unit.deal_id))) return res.status(403).json({ message: "Who a deal is waiting on can be set only at a Landsec scheme you work on" });
      if (item.done_at) return res.status(400).json({ message: "This item is done, so the deal is not waiting on it" });
      if (lettingClosed(unit.deal_status, unit.marketing_status)) return res.status(409).json({ message: "This letting has closed, so the deal is not waiting on anything" });
      const loaded = (await loadWaitingChecklists(pool, "c.id", [checklist.id]))[0] || null;
      const onList = loaded?.items.find(i => i.id === item.id) || null;
      if (!loaded || !onList) return res.status(409).json({ message: "This checklist belongs to an earlier letting of the unit" });
      const target = waitingTargetFor(onList, loaded);
      await inTransaction(async db => {
        const existing = (await db.query(`SELECT checklist_item_id FROM landsec_deal_clock WHERE deal_id = $1 FOR UPDATE`, [unit.deal_id])).rows[0];
        // Already waiting on this item: nothing changes, the clock keeps its date.
        if (existing?.checklist_item_id === item.id) return;
        await db.query(
          `INSERT INTO landsec_deal_clock (deal_id, waiting_on_party, waiting_on_name, waiting_since, waiting_note, checklist_item_id, updated_by, updated_by_name, updated_at)
           VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, NOW())
           ON CONFLICT (deal_id) DO UPDATE SET
             waiting_on_party = EXCLUDED.waiting_on_party, waiting_on_name = EXCLUDED.waiting_on_name, waiting_since = NOW(),
             waiting_note = EXCLUDED.waiting_note, checklist_item_id = EXCLUDED.checklist_item_id,
             updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name, updated_at = NOW()`,
          [unit.deal_id, target.party, target.name, item.label, item.id, access.userId, access.name]);
      });
      res.json(await checklistJson(checklist, unit, access));
    } catch (e: any) {
      console.error("[deal-checklist waiting]", e?.message);
      res.status(500).json({ message: e?.message || "Failed to set what the deal is waiting on" });
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
      const way = checklistWayFor(!!item.assignee_user_id, await landsecRoleOf(pool, item.assignee_user_id));
      const { subject, html } = itemEmail("reminder", item, unit, { name: item.assignee_name, hasLogin: !!item.task_id, way }, access);
      const mail = await sendEmail(item.assignee_email, item.assignee_name, subject, html, unit.landlord_name);
      // Not sent: the hour is given back, so it can be tried again.
      if (!mail.emailed) await pool.query(`UPDATE deal_checklist_items SET notified_at = $2 WHERE id = $1`, [item.id, item.notified_at || null]);
      res.json({ ...(await checklistJson(checklist, unit, access)), ...mail });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to send the reminder" });
    }
  });
}
