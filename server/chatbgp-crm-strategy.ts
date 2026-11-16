// ChatBGP and the CRM plan (Woody, 2026-11-16: asked whether "make them VIP"
// should put a company on a CRM strategy, "yes chat should be able to").
//
// There is no VIP field in the app. In the CRM a company is turned on by
// starting a strategy for it (Woody, 2026-11-15: "we choose who to make VIP
// and then the CRM engine starts suggesting ... and closely watches them").
// Until now ChatBGP could not do that: a plan it "saved" for a company was
// not on the CRM page's Overview, Watch list or Diary.
//
//   start_crm_strategy  puts a company on a strategy (a new one, or one
//                       already running), names its people and sets first
//                       actions for named BGP colleagues
//   get_crm_plan        what the CRM holds for a company: its strategies,
//                       actions and events
//
// And, the same day ("build it"), the rest of the plan:
//
//   add_crm_event        a CRM event for one or more companies, with the
//                        people it is for as suggested guests
//   update_crm_strategy  rename, re-word, hand over, pause, complete or
//                        reopen a strategy
//   update_crm_action    tick a CRM action, mark it in progress or reopen it
//
// All of them save and read through the CRM's own functions
// (server/crm-engagement.ts, and applyKickoff, the save behind the Start
// strategy button), so what chat does is exactly what the page would have
// done. BGP staff signed in as themselves only, and no write from an
// automated run: the plan is a person's decision. Nothing here sends a
// message, an invitation or books a meeting.
import type { EngagementAction, EngagementEvent, EngagementStrategy, EventInput, StrategyInput, StrategyStatus } from "../shared/crm-engagement";

export type CrmPlanTool = "start_crm_strategy" | "get_crm_plan" | "add_crm_event" | "update_crm_strategy" | "update_crm_action";
export const CRM_PLAN_TOOLS: CrmPlanTool[] = ["start_crm_strategy", "get_crm_plan", "add_crm_event", "update_crm_strategy", "update_crm_action"];

type Named = { id: string; name: string };
type Result = { data: Record<string, any>; action?: any };
const fail = (error: string, extra: Record<string, any> = {}): Result => ({ data: { success: false, error, message: error, ...extra } });
const clean = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** One record by the name a person used: the exact name, else the only one that contains it. Never a guess between two. */
export function pickByName<T extends Named>(list: T[], said: string): { one: T | null; several: T[] } {
  const want = clean(said, 200).toLowerCase();
  if (!want) return { one: null, several: [] };
  const exact = list.filter(item => item.name.trim().toLowerCase() === want);
  if (exact.length === 1) return { one: exact[0], several: [] };
  if (exact.length > 1) return { one: null, several: exact };
  const loose = list.filter(item => item.name.toLowerCase().includes(want) || (want.includes(" ") === false && item.name.toLowerCase().split(/\s+/).includes(want)));
  const unique = [...new Map(loose.map(item => [item.id, item])).values()];
  return unique.length === 1 ? { one: unique[0], several: [] } : { one: null, several: unique.slice(0, 6) };
}

/** Which strategy the company goes on: the running one named, the one it is already on, or a new one. */
export function chooseStrategy(strategies: EngagementStrategy[], companyId: string, saidName: string, objective: string):
  { join: EngagementStrategy } | { create: { name: string; objective: string } } | { ask: string } {
  const running = strategies.filter(strategy => strategy.status !== "completed");
  const mine = running.filter(strategy => strategy.targets.some(target => target.companyId === companyId));
  if (saidName) {
    const named = running.filter(strategy => same(strategy.name, saidName));
    if (named.length === 1) return { join: named[0] };
    if (named.length > 1) return { ask: `More than one running strategy is called "${saidName}". Rename one on the CRM page first.` };
    if (!objective) return { ask: `There is no running strategy called "${saidName}", and a new strategy needs an objective: what is BGP trying to achieve with this company?` };
    return { create: { name: saidName, objective } };
  }
  if (mine.length === 1) return { join: mine[0] };
  if (mine.length > 1) return { ask: `This company is on ${mine.length} running strategies (${mine.map(strategy => strategy.name).join("; ")}). Say which one to add to.` };
  return { ask: "A new strategy needs a name and an objective: what is BGP trying to achieve with this company?" };
}

/** A date a person gave (yyyy-mm-dd) as the engine's due time; a blank or bad one is two weeks from now. */
export function dueAtFrom(said: unknown, now = new Date()): string {
  const text = clean(said, 20);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T09:00:00.000Z`) : null;
  if (parsed && Number.isFinite(parsed.getTime())) return parsed.toISOString();
  const later = new Date(now.getTime() + 14 * 86400_000);
  later.setUTCHours(9, 0, 0, 0);
  return later.toISOString();
}

const LONDON = "Europe/London";
function validDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text;
}
function londonClock(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => parts.find(part => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
/** A London day and time as the engine's timestamp. Null for a bad date or time, or a time the clocks skip. */
export function londonIso(day: unknown, time: unknown): string | null {
  const date = clean(day, 20), clock = clean(time, 10);
  if (!validDay(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null;
  const nominal = new Date(`${date}T${clock}:00Z`).getTime();
  for (const offset of [60, 0]) {
    const candidate = new Date(nominal - offset * 60_000);
    if (londonClock(candidate) === `${date}T${clock}`) return candidate.toISOString();
  }
  return null;
}
const londonDay = (iso: string | null) => iso ? londonClock(new Date(iso)).slice(0, 10) : null;

/** The status a person asked for, in the engine's words. */
export function strategyStatusFrom(said: unknown): StrategyStatus | null {
  const text = clean(said, 40).toLowerCase();
  if (/^(completed?|closed?|done|finished|ended)$/.test(text)) return "completed";
  if (/^(paused?|on hold|hold|parked)$/.test(text)) return "paused";
  if (/^(active|running|live|reopen(ed)?|resumed?|open)$/.test(text)) return "active";
  return null;
}
export function actionStatusFrom(said: unknown): "todo" | "in_progress" | "done" | null {
  const text = clean(said, 40).toLowerCase().replace(/[\s-]+/g, "_");
  if (/^(done|completed?|ticked|finished|closed)$/.test(text)) return "done";
  if (/^(in_progress|started|underway|doing)$/.test(text)) return "in_progress";
  if (/^(todo|to_do|open|reopen(ed)?|not_done|not_started)$/.test(text)) return "todo";
  return null;
}

/** The strategy a person means: the one named (running or not), else the one the company is on. */
export function findStrategy(strategies: EngagementStrategy[], companyId: string | null, saidName: string): { strategy: EngagementStrategy } | { ask: string } {
  const scope = companyId ? strategies.filter(strategy => strategy.targets.some(target => target.companyId === companyId)) : strategies;
  if (saidName) {
    // A name is looked for among the company's strategies first, then all of them.
    for (const list of companyId ? [scope, strategies] : [strategies]) {
      const picked = pickByName(list, saidName);
      if (picked.one) return { strategy: picked.one };
      if (picked.several.length) return { ask: `More than one strategy matches "${saidName}": ${picked.several.map(strategy => `${strategy.name} (${strategy.status})`).join("; ")}. Say which.` };
    }
    return { ask: `There is no CRM strategy called "${saidName}".` };
  }
  if (!companyId) return { ask: "Say which strategy, by its name or by a company on it." };
  const open = scope.filter(strategy => strategy.status !== "completed");
  if (open.length === 1) return { strategy: open[0] };
  if (!open.length && scope.length === 1) return { strategy: scope[0] };
  if (!scope.length) return { ask: "This company is not on a CRM strategy." };
  return { ask: `This company is on ${(open.length ? open : scope).length} strategies (${(open.length ? open : scope).map(strategy => strategy.name).join("; ")}). Say which one.` };
}

export type StrategyChange = { name?: string; objective?: string; status?: StrategyStatus; owner?: Named; startsOn?: string | null; endsOn?: string | null };
/** A strategy as it will be saved, with every company and person on it kept, and what changed in plain words. */
export function planStrategyChange(strategy: EngagementStrategy, change: StrategyChange): { input: StrategyInput; changed: string[] } {
  const changed: string[] = [];
  const next = { name: strategy.name, objective: strategy.objective, ownerId: strategy.ownerId, status: strategy.status, startsOn: strategy.startsOn, endsOn: strategy.endsOn };
  if (change.name && change.name !== strategy.name) { next.name = change.name; changed.push(`renamed to "${change.name}"`); }
  if (change.objective && change.objective !== strategy.objective) { next.objective = change.objective; changed.push("objective changed"); }
  if (change.owner && change.owner.id !== strategy.ownerId) { next.ownerId = change.owner.id; changed.push(`owner now ${change.owner.name}`); }
  if (change.status && change.status !== strategy.status) {
    next.status = change.status;
    changed.push(change.status === "completed" ? "marked completed" : change.status === "paused" ? "paused" : strategy.status === "completed" ? "reopened" : "running again");
  }
  if (change.startsOn !== undefined && change.startsOn !== strategy.startsOn) { next.startsOn = change.startsOn; changed.push(change.startsOn ? `start date ${change.startsOn}` : "start date cleared"); }
  if (change.endsOn !== undefined && change.endsOn !== strategy.endsOn) { next.endsOn = change.endsOn; changed.push(change.endsOn ? `end date ${change.endsOn}` : "end date cleared"); }
  return { changed, input: { ...next, team: strategy.team,
    targets: strategy.targets.map(target => ({ companyId: target.companyId, reason: target.reason, contactIds: [...target.contactIds] })), expectedUpdatedAt: strategy.updatedAt } };
}

/** The action a person means: by its id, else by the words of its title. Never a guess between two. */
export function pickAction(actions: EngagementAction[], said: { id?: string; title?: string }, want: "todo" | "in_progress" | "done"): { one: EngagementAction } | { ask: string } {
  const id = clean(said.id, 100), title = clean(said.title, 250);
  if (id) {
    const byId = actions.find(action => action.id === id);
    return byId ? { one: byId } : { ask: "That action is not on the CRM plan any more." };
  }
  if (!title) return { ask: "Say which action, by its title." };
  const picked = pickByName(actions.map(action => ({ ...action, name: action.title })), title);
  if (picked.one) return { one: picked.one };
  // Two with the same words: the one not yet at the status asked for is the one meant.
  const moving = picked.several.filter(action => action.status !== want);
  if (moving.length === 1) return { one: moving[0] };
  if (picked.several.length) return { ask: `More than one CRM action matches "${title}": ${picked.several.map(action => `${action.title} (${action.companyName}, ${action.ownerName || "no owner"})`).join("; ")}. Say which.` };
  return { ask: `No CRM action matches "${title}".` };
}

const strategyUrl = (id: string) => `/contacts?tab=overview&strategy=${encodeURIComponent(id)}`;

async function staffActor(req: any) {
  const { pool } = await import("./db");
  const { isEngagementStaff } = await import("./crm-engagement");
  const { resolveCompanyScope } = await import("./company-scope");
  const userId = req?.session?.userId || req?.tokenUserId;
  const actor = userId ? (await pool.query("SELECT id,name,email,role,is_active,client_view_mode FROM users WHERE id=$1", [userId])).rows[0] : null;
  const scope = await resolveCompanyScope(req);
  return isEngagementStaff(actor, scope) ? actor : null;
}

// A company the CRM plans for: a landlord, a brand, an agent firm or a lender.
async function findCompany(args: any): Promise<{ company: (Named & { noun: string }) | null; several: Named[]; said: string }> {
  const { pool } = await import("./db");
  const { PLAN_COMPANY_PREDICATE, companyNounSql } = await import("./crm-engagement");
  const id = clean(args?.companyId, 80), name = clean(args?.companyName, 200);
  const base = `SELECT c.id, c.name, ${companyNounSql("c")} AS noun FROM crm_companies c WHERE ${PLAN_COMPANY_PREDICATE}`;
  if (id) {
    const row = (await pool.query(`${base} AND c.id = $1`, [id])).rows[0];
    return { company: row || null, several: [], said: id };
  }
  if (!name) return { company: null, several: [], said: "" };
  const exact = (await pool.query(`${base} AND lower(btrim(c.name)) = lower($1) ORDER BY c.name LIMIT 6`, [name])).rows;
  if (exact.length === 1) return { company: exact[0], several: [], said: name };
  const loose = exact.length ? exact : (await pool.query(`${base} AND c.name ILIKE $1 ORDER BY c.name LIMIT 6`, [`%${name.replace(/[%_\\]/g, "\\$&")}%`])).rows;
  return loose.length === 1 ? { company: loose[0], several: [], said: name } : { company: null, several: loose, said: name };
}

const actionLine = (action: EngagementAction) => ({ id: action.id, youCanTick: action.canEdit === true, title: action.title, owner: action.ownerName, due: action.dueAt, status: action.status, strategyId: action.strategyId });

async function readPlan(args: any, actor: any): Promise<Result> {
  const { pool } = await import("./db");
  const { getCrmEngagementData } = await import("./crm-engagement");
  const found = await findCompany(args);
  if (!found.company) {
    return fail(found.several.length ? `More than one CRM company matches "${found.said}": ${found.several.map(c => c.name).join(", ")}. Say which.` : `No landlord, brand, agent or lender in the CRM matches "${found.said}".`,
      { candidates: found.several });
  }
  const company = found.company;
  const plan = await getCrmEngagementData(company.id, { pool, viewerId: actor.id });
  const strategies = plan.strategies.filter(strategy => strategy.targets.some(target => target.companyId === company.id));
  const open = plan.actions.filter(action => action.status !== "done");
  return { data: {
    success: true, company: { id: company.id, name: company.name, kind: company.noun },
    onStrategy: strategies.some(strategy => strategy.status === "active"),
    strategies: strategies.map(strategy => ({ id: strategy.id, name: strategy.name, objective: strategy.objective, status: strategy.status, owner: strategy.ownerName,
      reason: strategy.targets.find(target => target.companyId === company.id)?.reason || null, url: strategyUrl(strategy.id) })),
    openActions: open.map(actionLine), doneActions: plan.actions.length - open.length,
    events: plan.events.filter(event => event.status !== "cancelled").map(event => ({ id: event.id, title: event.title, startsAt: event.startsAt, dateConfirmed: event.dateConfirmed, status: event.status })),
    message: strategies.length
      ? `${company.name} is on ${strategies.length === 1 ? `the CRM strategy "${strategies[0].name}"` : `${strategies.length} CRM strategies`} with ${open.length} open action${open.length === 1 ? "" : "s"}.`
      : `${company.name} is in the CRM but is not on a strategy yet: nothing is planned for it.`,
  } };
}

async function startStrategy(args: any, actor: any, req: any): Promise<Result> {
  const { pool } = await import("./db");
  const { getCrmEngagementData, getCrmEngagementOptions, createEngagementAction } = await import("./crm-engagement");
  const { applyKickoff } = await import("./crm-kickoff");
  const found = await findCompany(args);
  if (!found.company) {
    return fail(found.several.length ? `More than one CRM company matches "${found.said}": ${found.several.map(c => c.name).join(", ")}. Nothing was saved. Say which.`
      : found.said ? `No landlord, brand, agent or lender in the CRM matches "${found.said}". Nothing was saved. Add the company to the CRM first.` : "Say which company. Nothing was saved.",
      { candidates: found.several });
  }
  const company = found.company;
  const [plan, options] = await Promise.all([getCrmEngagementData(undefined, { pool, viewerId: actor.id }, "all"), getCrmEngagementOptions(pool as any, company.id, "all")]);
  const warnings: string[] = [];

  // The owner: the BGP colleague named, else the person asking.
  let owner: Named = { id: actor.id, name: actor.name || "you" };
  if (clean(args?.ownerName, 120)) {
    const picked = pickByName(options.staff, args.ownerName);
    if (!picked.one) return fail(picked.several.length ? `Which ${clean(args.ownerName, 120)}: ${picked.several.map(p => p.name).join(", ")}? Nothing was saved.` : `"${clean(args.ownerName, 120)}" is not an active BGP colleague. Nothing was saved.`);
    owner = picked.one;
  }

  const choice = chooseStrategy(plan.strategies, company.id, clean(args?.strategyName, 160), clean(args?.objective, 1500));
  if ("ask" in choice) return fail(`${choice.ask} Nothing was saved.`, { needsAnswer: true });

  // The company's people on the strategy: only contacts filed under it.
  const people = options.contacts.filter(contact => contact.companyId === company.id);
  const contactIds: string[] = [], namedPeople: string[] = [];
  for (const said of Array.isArray(args?.contactNames) ? args.contactNames.slice(0, 20) : []) {
    const picked = pickByName(people, String(said));
    if (picked.one) { if (!contactIds.includes(picked.one.id)) { contactIds.push(picked.one.id); namedPeople.push(picked.one.name); } }
    else warnings.push(picked.several.length ? `"${clean(said, 80)}" matches more than one contact at ${company.name}: not added` : `"${clean(said, 80)}" is not a contact filed under ${company.name}: not added`);
  }

  // First actions, each with its own owner. Checked before anything is saved.
  const actions: Array<{ title: string; notes: string | null; dueAt: string; owner: Named }> = [];
  for (const row of Array.isArray(args?.actions) ? args.actions.slice(0, 8) : []) {
    const title = clean(row?.title, 250);
    if (title.length < 3) continue;
    let actionOwner = owner;
    if (clean(row?.ownerName, 120)) {
      const picked = pickByName(options.staff, row.ownerName);
      if (!picked.one) return fail(picked.several.length ? `Which ${clean(row.ownerName, 120)} for "${title}": ${picked.several.map(p => p.name).join(", ")}? Nothing was saved.` : `"${clean(row.ownerName, 120)}" (for "${title}") is not an active BGP colleague. Nothing was saved.`);
      actionOwner = picked.one;
    }
    actions.push({ title, notes: clean(row?.notes, 4000) || null, dueAt: dueAtFrom(row?.dueDate), owner: actionOwner });
  }

  const joining = "join" in choice ? choice.join : null;
  const already = !!joining?.targets.some(target => target.companyId === company.id);
  const reason = clean(args?.reason, 600) || (joining ? "Added from ChatBGP" : "Started from ChatBGP");
  const applied = await applyKickoff(pool as any, {
    companyId: company.id, strategyId: joining?.id || null,
    strategy: joining ? null : { name: (choice as any).create.name, objective: (choice as any).create.objective, team: null, startsOn: null, endsOn: null },
    ownerId: owner.id, reason, contactIds, eventIds: [], actions: [],
  }, actor);
  warnings.push(...applied.warnings);

  const set: Array<{ title: string; owner: string; due: string }> = [];
  for (const action of actions) {
    try {
      await createEngagementAction(pool as any, { title: action.title, notes: action.notes, dueAt: action.dueAt, status: "todo", ownerId: action.owner.id, companyId: company.id,
        eventId: null, strategyId: applied.strategyId, sourceInterviewId: null, sourceQuestionId: null } as any, actor);
      set.push({ title: action.title, owner: action.owner.name, due: action.dueAt.slice(0, 10) });
    } catch (error: any) { warnings.push(`"${action.title}": ${error?.message || "could not be added"}`); }
  }

  const strategyName = joining?.name || (choice as any).create.name;
  const strategyOwner = joining ? joining.ownerName || "nobody set" : owner.name;
  try {
    const { logAudit } = await import("./sql-tools");
    await logAudit({ tableName: "crm_strategy_targets", op: joining ? "UPDATE" : "INSERT", data: args, where: { strategyId: applied.strategyId, companyId: company.id },
      affectedRows: 1 + set.length, userId: actor.id, threadId: req?.body?.threadId, success: true });
  } catch {}
  const message = `${company.name} is ${already ? "already on" : "now on"} the CRM strategy "${strategyName}" (owner ${strategyOwner})${joining && !already ? ", which was already running" : ""}. `
    + (namedPeople.length ? `People named on it: ${namedPeople.join(", ")}. ` : "")
    + (set.length ? `${set.length} action${set.length === 1 ? "" : "s"} set, each on its owner's My Tasks: ${set.map(a => `${a.owner}: ${a.title} (due ${a.due})`).join("; ")}. ` : "No actions were set. ")
    + "It shows on CRM, Overview, in the Watch list and the Diary, and the company is now checked more often. No message was sent and no meeting was booked."
    + (warnings.length ? ` Not done: ${warnings.join("; ")}.` : "");
  return { data: { success: true, action: joining ? (already ? "added_to" : "joined") : "started", entity: "crm strategy", strategyId: applied.strategyId, strategyName,
      company: { id: company.id, name: company.name, kind: company.noun }, owner: strategyOwner, people: namedPeople, actions: set, warnings, url: strategyUrl(applied.strategyId), message },
    action: { type: "navigate", url: strategyUrl(applied.strategyId) } };
}

function missingCompany(found: { several: Named[]; said: string }): Result {
  return fail(found.several.length ? `More than one CRM company matches "${found.said}": ${found.several.map(c => c.name).join(", ")}. Nothing was saved. Say which.`
    : found.said ? `No landlord, brand, agent or lender in the CRM matches "${found.said}". Nothing was saved.` : "Say which company. Nothing was saved.", { candidates: found.several });
}
const EVENT_TYPES = ["bgp", "industry", "speaking", "pitch", "press"];
const whenWords = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const audit = async (tableName: string, op: "INSERT" | "UPDATE", args: any, where: Record<string, any>, actor: any, req: any) => {
  try {
    const { logAudit } = await import("./sql-tools");
    await logAudit({ tableName, op, data: args, where, affectedRows: 1, userId: actor.id, threadId: req?.body?.threadId, success: true });
  } catch {}
};

// A CRM event for one or more companies. It is a plan on the CRM page: no
// invitation goes out and nothing is put in a diary.
async function addEvent(args: any, actor: any, req: any): Promise<Result> {
  const { pool } = await import("./db");
  const { getCrmEngagementData, getCrmEngagementOptions, saveEngagementEvent, eventInputSchema } = await import("./crm-engagement");
  const title = clean(args?.title, 200);
  if (title.length < 3) return fail("Give the event a title. Nothing was saved.", { needsAnswer: true });

  const said = [...(Array.isArray(args?.companyNames) ? args.companyNames : []), args?.companyName].map(name => clean(name, 200)).filter(Boolean).slice(0, 6);
  const companies: Array<Named & { noun: string }> = [];
  for (const lookup of clean(args?.companyId, 80) && said.length <= 1 ? [{ companyId: args.companyId }] : said.map(companyName => ({ companyName }))) {
    const found = await findCompany(lookup);
    if (!found.company) return missingCompany(found);
    if (!companies.some(company => company.id === found.company!.id)) companies.push(found.company);
  }

  // When, in London time. A date with no time goes in at 09:00 and says so.
  const day = clean(args?.date, 20), time = clean(args?.time, 10), endTime = clean(args?.endTime, 10);
  if (day && !validDay(day)) return fail(`"${day}" is not a date. Nothing was saved.`, { needsAnswer: true });
  if (!day && (time || endTime)) return fail("A time needs a date. Nothing was saved.", { needsAnswer: true });
  const startsAt = day ? londonIso(day, time || "09:00") : null;
  if (day && !startsAt) return fail(`"${time}" is not a time in London on that day. Nothing was saved.`, { needsAnswer: true });
  const endsAt = startsAt && endTime ? londonIso(day, endTime) : null;
  if (endTime && (!endsAt || endsAt <= startsAt!)) return fail("The end time must be a time after the start. Nothing was saved.", { needsAnswer: true });
  const dateConfirmed = !!startsAt && args?.dateConfirmed !== false;

  const [plan, ...optionSets] = await Promise.all([getCrmEngagementData(undefined, { pool, viewerId: actor.id }, "all"),
    ...(companies.length ? companies : [null]).map(company => getCrmEngagementOptions(pool as any, company?.id || null, "all"))]);
  const staff = optionSets[0].staff;
  const warnings: string[] = [];

  let owner: Named = { id: actor.id, name: actor.name || "you" };
  if (clean(args?.ownerName, 120)) {
    const picked = pickByName(staff, args.ownerName);
    if (!picked.one) return fail(picked.several.length ? `Which ${clean(args.ownerName, 120)}: ${picked.several.map(p => p.name).join(", ")}? Nothing was saved.` : `"${clean(args.ownerName, 120)}" is not an active BGP colleague. Nothing was saved.`);
    owner = picked.one;
  }

  // The same event typed twice is a question, never a second record.
  const twin = plan.events.find(event => event.status !== "cancelled" && same(event.title, title) && londonDay(event.startsAt) === (day || null));
  if (twin) return fail(`"${twin.title}" is already a CRM event${day ? " on that day" : " with no date yet"}. Nothing was saved: open it on CRM, Overview, to change it.`, { eventId: twin.id });

  // The strategy it supports: the one named, else the one running strategy each company is on.
  const running = plan.strategies.filter(strategy => strategy.status !== "completed");
  const linked: EngagementStrategy[] = [];
  if (clean(args?.strategyName, 160)) {
    const picked = pickByName(running, args.strategyName);
    if (!picked.one) return fail(picked.several.length ? `More than one running strategy matches "${clean(args.strategyName, 160)}": ${picked.several.map(s => s.name).join("; ")}. Nothing was saved. Say which.` : `There is no running CRM strategy called "${clean(args.strategyName, 160)}". Nothing was saved.`);
    linked.push(picked.one);
  } else for (const company of companies) {
    const on = running.filter(strategy => strategy.targets.some(target => target.companyId === company.id));
    if (on.length === 1 && !linked.some(strategy => strategy.id === on[0].id)) linked.push(on[0]);
    else if (on.length > 1) warnings.push(`not linked to a strategy for ${company.name}, which is on ${on.length} (${on.map(strategy => strategy.name).join("; ")}): say which and link it on the page`);
  }

  // Guests: only contacts filed under a company on the event, as suggestions.
  const people = [...new Map(optionSets.flatMap(set => set.contacts).filter(contact => companies.some(company => company.id === contact.companyId)).map(contact => [contact.id, contact])).values()];
  const guests: Array<{ contactId: string; status: "suggested" }> = [], guestNames: string[] = [];
  for (const name of Array.isArray(args?.guestNames) ? args.guestNames.slice(0, 40) : []) {
    const picked = pickByName(people, String(name));
    if (picked.one) { if (!guests.some(guest => guest.contactId === picked.one!.id)) { guests.push({ contactId: picked.one.id, status: "suggested" }); guestNames.push(picked.one.name); } }
    else warnings.push(picked.several.length ? `"${clean(name, 80)}" matches more than one contact: not added as a guest` : `"${clean(name, 80)}" is not a contact filed under ${companies.length ? companies.map(c => c.name).join(" or ") : "a company on the event"}: not added as a guest`);
  }

  let sourceUrl: string | null = null;
  if (clean(args?.url, 2000)) {
    try { const url = new URL(clean(args.url, 2000)); if (/^https?:$/.test(url.protocol)) sourceUrl = url.toString(); } catch {}
    if (!sourceUrl) warnings.push("the link was not a web address: left off");
  }
  const reason = clean(args?.reason, 600) || "Added from ChatBGP";
  const input: EventInput = {
    title, kind: EVENT_TYPES.includes(clean(args?.eventType, 20)) ? clean(args.eventType, 20) : "bgp", startsAt, endsAt,
    location: clean(args?.location, 500) || null, description: clean(args?.description, 4000) || null, ownerId: owner.id,
    status: startsAt ? "planned" : "draft", sourceUrl, dateConfirmed, outcome: null, strategyIds: linked.map(strategy => strategy.id),
    companies: companies.map(company => ({ companyId: company.id, reason })), guests,
  };
  const saved = await saveEngagementEvent(pool as any, eventInputSchema.parse(input) as EventInput, undefined, "all");
  await audit("marketing_events", "INSERT", args, { eventId: saved.id }, actor, req);

  const url = `/contacts?tab=overview&event=${encodeURIComponent(saved.id)}`;
  const message = `"${title}" is now a CRM event${companies.length ? ` for ${companies.map(c => c.name).join(", ")}` : ""}`
    + (startsAt ? `, on ${whenWords(startsAt)}${endsAt ? ` to ${londonClock(new Date(endsAt)).slice(11)}` : ""} London time` : ", with no date yet")
    + `${input.location ? `, at ${input.location}` : ""}. Owner ${owner.name}. `
    + (startsAt && !time ? "No time was given, so it is in at 09:00. " : "")
    + (startsAt && !dateConfirmed ? "Its date is to confirm, so it sits under Dates to confirm and not on the calendar. " : !startsAt ? "It sits under Dates to confirm until it has a date. " : "")
    + (linked.length ? `Linked to the strateg${linked.length === 1 ? "y" : "ies"} ${linked.map(s => `"${s.name}"`).join(", ")}. ` : "")
    + (guestNames.length ? `Suggested guests: ${guestNames.join(", ")}. ` : "")
    + "No invitation was sent and nothing was put in anyone's diary."
    + (warnings.length ? ` Not done: ${warnings.join("; ")}.` : "");
  return { data: { success: true, action: "added", entity: "crm event", eventId: saved.id, title, startsAt, dateConfirmed, companies: companies.map(c => ({ id: c.id, name: c.name, kind: c.noun })),
      owner: owner.name, strategies: linked.map(s => s.name), guests: guestNames, warnings, url, message },
    action: { type: "navigate", url } };
}

// Rename, re-word, hand over, pause, complete or reopen a strategy. Every
// company and person on it is kept as it is.
async function updateStrategy(args: any, actor: any, req: any): Promise<Result> {
  const { pool } = await import("./db");
  const { getCrmEngagementData, getCrmEngagementOptions, saveEngagementStrategy, strategyInputSchema } = await import("./crm-engagement");
  let company: (Named & { noun: string }) | null = null;
  if (clean(args?.companyName, 200) || clean(args?.companyId, 80)) {
    const found = await findCompany(args);
    if (!found.company) return missingCompany(found);
    company = found.company;
  }
  const plan = await getCrmEngagementData(undefined, { pool, viewerId: actor.id }, "all");
  const picked = findStrategy(plan.strategies, company?.id || null, clean(args?.strategyName, 160));
  if ("ask" in picked) return fail(`${picked.ask} Nothing was changed.`, { needsAnswer: true });
  const strategy = picked.strategy;

  const change: StrategyChange = {};
  if (clean(args?.newName, 200)) change.name = clean(args.newName, 200);
  if (clean(args?.objective, 4000)) change.objective = clean(args.objective, 4000);
  if (clean(args?.status, 40)) {
    const status = strategyStatusFrom(args.status);
    if (!status) return fail(`"${clean(args.status, 40)}" is not a strategy status: say active, paused or completed. Nothing was changed.`, { needsAnswer: true });
    change.status = status;
  }
  for (const [key, said] of [["startsOn", args?.startDate], ["endsOn", args?.endDate]] as const) {
    if (said === undefined || said === null) continue;
    const text = clean(said, 20);
    if (text && !validDay(text)) return fail(`"${text}" is not a date. Nothing was changed.`, { needsAnswer: true });
    change[key] = text || null;
  }
  if (clean(args?.ownerName, 120)) {
    const owner = pickByName((await getCrmEngagementOptions(pool as any, null, "landlord")).staff, args.ownerName);
    if (!owner.one) return fail(owner.several.length ? `Which ${clean(args.ownerName, 120)}: ${owner.several.map(p => p.name).join(", ")}? Nothing was changed.` : `"${clean(args.ownerName, 120)}" is not an active BGP colleague. Nothing was changed.`);
    change.owner = owner.one;
  }
  const planned = planStrategyChange(strategy, change);
  if (!planned.changed.length) return fail(`Nothing to change: "${strategy.name}" already reads that way (${strategy.status}, owner ${strategy.ownerName || "not set"}).`, { strategyId: strategy.id });

  await saveEngagementStrategy(pool as any, strategyInputSchema.parse(planned.input) as StrategyInput, strategy.id, "all");
  await audit("marketing_campaigns", "UPDATE", args, { strategyId: strategy.id }, actor, req);
  const open = plan.actions.filter(action => action.strategyId === strategy.id && action.status !== "done").length;
  const name = planned.input.name;
  const message = `The CRM strategy "${strategy.name}" is updated: ${planned.changed.join(", ")}. `
    + (planned.input.status !== "active" && change.status ? `It is off the Watch list and its ${strategy.targets.length === 1 ? "company is" : "companies are"} no longer checked more often. `
      + (open ? `Its ${open} open action${open === 1 ? " stays" : "s stay"} on ${open === 1 ? "its owner's list" : "their owners' lists"}: tick or reassign ${open === 1 ? "it" : "them"} if no longer wanted. ` : "") : "")
    + "The companies and people on it are unchanged. No message was sent.";
  return { data: { success: true, action: "updated", entity: "crm strategy", strategyId: strategy.id, strategyName: name, status: planned.input.status, changed: planned.changed, openActions: open, url: strategyUrl(strategy.id), message },
    action: { type: "navigate", url: strategyUrl(strategy.id) } };
}

// Tick a CRM action, mark it in progress or reopen it: the status only, and
// only for its owner or the person who set it, as on the page.
async function updateAction(args: any, actor: any, req: any): Promise<Result> {
  const { pool } = await import("./db");
  const { getCrmEngagementData, setEngagementActionStatus } = await import("./crm-engagement");
  const want = actionStatusFrom(args?.status ?? "done");
  if (!want) return fail(`"${clean(args?.status, 40)}" is not an action status: say done, in progress or to do. Nothing was changed.`, { needsAnswer: true });
  let company: (Named & { noun: string }) | null = null;
  if (clean(args?.companyName, 200) || clean(args?.companyId, 80)) {
    const found = await findCompany(args);
    if (!found.company) return missingCompany(found);
    company = found.company;
  }
  const plan = company ? await getCrmEngagementData(company.id, { pool, viewerId: actor.id }) : await getCrmEngagementData(undefined, { pool, viewerId: actor.id }, "all");
  const picked = pickAction(plan.actions, { id: args?.actionId, title: args?.title }, want);
  if ("ask" in picked) return fail(`${picked.ask} Nothing was changed.`, { needsAnswer: true });
  const action = picked.one;
  const words = { todo: "to do", in_progress: "in progress", done: "done" };
  if (action.status === want) return { data: { success: true, action: "unchanged", entity: "crm action", actionId: action.id, status: want, message: `"${action.title}" (${action.companyName}) is already ${words[want]}. Nothing was changed.` } };
  if (action.canEdit !== true) return fail(`"${action.title}" (${action.companyName}) is ${action.ownerName || "a colleague"}'s action: only its owner or the person who set it can change it. Nothing was changed.`, { actionId: action.id, owner: action.ownerName });
  await setEngagementActionStatus(pool as any, action.id, want, actor);
  await audit("crm_engagement_actions", "UPDATE", args, { actionId: action.id, status: want }, actor, req);
  const message = `"${action.title}" (${action.companyName}${action.ownerName ? `, ${action.ownerName}` : ""}) is now ${words[want]}${want === "done" ? " and ticked on My Tasks" : want === "todo" && action.status === "done" ? ": it is back on My Tasks" : ""}.`;
  return { data: { success: true, action: want === "done" ? "ticked" : "updated", entity: "crm action", actionId: action.id, title: action.title, company: action.companyName, status: want, message } };
}

/** Every CRM plan tool, as both ChatBGP executors call them. */
export async function runCrmStrategyTool(tool: CrmPlanTool, args: any, req: any): Promise<Result> {
  // An automated run (the Friday report, a sweep) has no person asking, and
  // the plan is a person's decision: it may read it and nothing else.
  if (tool !== "get_crm_plan" && (await import("./chatbgp-internal")).isInternalStaffRequest(req)) {
    return fail("The CRM plan is changed only when a BGP person asks in their own chat, never from an automated run. Nothing was saved.");
  }
  let actor: any;
  try { actor = await staffActor(req); }
  catch { return fail("Your account could not be checked. Nothing was saved."); }
  if (!actor) return fail("The CRM plan is BGP's own: it is read and changed by BGP staff signed in as themselves, not from a client account or while viewing the app as a client. Nothing was saved.");
  try {
    if (tool === "get_crm_plan") return await readPlan(args, actor);
    if (tool === "add_crm_event") return await addEvent(args, actor, req);
    if (tool === "update_crm_strategy") return await updateStrategy(args, actor, req);
    if (tool === "update_crm_action") return await updateAction(args, actor, req);
    return await startStrategy(args, actor, req);
  } catch (error: any) {
    console.error("[chatbgp-crm-strategy]", error?.message || error);
    if (Array.isArray(error?.issues) && error.issues[0]?.message) return fail(`${String(error.issues[0].message).replace(/\.$/, "")}. Nothing was saved.`);
    return fail(error?.status && error?.message ? `${String(error.message).replace(/\.$/, "")}. Nothing more was saved.` : "The CRM plan could not be reached. Check CRM, Overview, to see what was saved.");
  }
}
