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
// Both save and read through the CRM's own functions (server/crm-engagement.ts,
// and applyKickoff, the save behind the Start strategy button), so what chat
// starts is exactly what the page would have started. BGP staff signed in as
// themselves only, and never from an automated run: a strategy is a person's
// decision. Nothing here sends a message or books a meeting.
import type { EngagementAction, EngagementStrategy } from "../shared/crm-engagement";

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

const actionLine = (action: EngagementAction) => ({ title: action.title, owner: action.ownerName, due: action.dueAt, status: action.status, strategyId: action.strategyId });

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
    events: plan.events.filter(event => event.status !== "cancelled").map(event => ({ title: event.title, startsAt: event.startsAt, dateConfirmed: event.dateConfirmed, status: event.status })),
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

/** Both tools, as both ChatBGP executors call them. */
export async function runCrmStrategyTool(tool: "start_crm_strategy" | "get_crm_plan", args: any, req: any): Promise<Result> {
  // An automated run (the Friday report, a sweep) has no person asking, and
  // a strategy is a person's decision.
  if (tool === "start_crm_strategy" && (await import("./chatbgp-internal")).isInternalStaffRequest(req)) {
    return fail("A CRM strategy is started only when a BGP person asks in their own chat, never from an automated run. Nothing was saved.");
  }
  let actor: any;
  try { actor = await staffActor(req); }
  catch { return fail("Your account could not be checked. Nothing was saved."); }
  if (!actor) return fail("The CRM plan is BGP's own: it is read and changed by BGP staff signed in as themselves, not from a client account or while viewing the app as a client. Nothing was saved.");
  try {
    return tool === "get_crm_plan" ? await readPlan(args, actor) : await startStrategy(args, actor, req);
  } catch (error: any) {
    console.error("[chatbgp-crm-strategy]", error?.message || error);
    return fail(error?.status && error?.message ? `${error.message}. Nothing more was saved.` : "The CRM plan could not be reached. Check CRM, Overview, to see what was saved.");
  }
}
