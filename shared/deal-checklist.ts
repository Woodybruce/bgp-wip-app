// The deal checklist on a letting (Woody, 2026-11-12: "Deal check list /
// tasks / has to have team person allocated client or agent and ability to
// tag / add responsible person. Who is responsible for the deal. That then
// adds to their tasks list and sends an email if tagged / added.")
//
// A letting has one checklist. Its items are grouped by stage; each item has
// a responsible person from BGP, the client or a joint agent. Making someone
// responsible puts the item on their task list and emails them. The deal as
// a whole also has one responsible person, and an item with nobody on it
// falls to them.

export const CHECKLIST_STAGES = [
  { key: "enquiry", label: "Enquiry", codes: ["OPP", "AVA"] },
  { key: "negotiating", label: "Negotiating", codes: ["NEG", "HOT"] },
  { key: "under_offer", label: "Under offer", codes: ["SOL"] },
  { key: "exchanged", label: "Exchanged", codes: ["EXC", "COM", "INV"] },
] as const;
export type ChecklistStageKey = (typeof CHECKLIST_STAGES)[number]["key"];

// The checklist stage a unit's deal status (as a code) sits in.
export function checklistStageFor(statusCode: string | null | undefined): ChecklistStageKey {
  const code = String(statusCode || "AVA").toUpperCase();
  return (CHECKLIST_STAGES.find(s => (s.codes as readonly string[]).includes(code))?.key) || "enquiry";
}

export const CHECKLIST_SIDES = [
  { key: "bgp", label: "BGP" },
  { key: "client", label: "Client" },
  { key: "joint_agent", label: "Joint agent" },
] as const;
export type ChecklistSide = (typeof CHECKLIST_SIDES)[number]["key"];

export interface ChecklistTemplateItem { stage: ChecklistStageKey; label: string; required: boolean }
export interface ChecklistTemplate { key: string; name: string; items: ChecklistTemplateItem[] }

const item = (stage: ChecklistStageKey, label: string, required = false): ChecklistTemplateItem => ({ stage, label, required });

// The standard letting checklist. It follows the shape of the list Woody
// pasted on 12 November 2026 (a client's own stage checklist), rewritten in
// BGP's words so it is not a copy of that client's system, and with the
// steps this app adds (the Targeting Brief). "{CLIENT}" is replaced with the
// landlord's name when a checklist is started ("Landsec approval in place").
// One list for every client: a client-specific step belongs in the wording,
// not in a second list.
export const STANDARD_CHECKLIST: ChecklistTemplate = {
  key: "standard",
  name: "Standard letting checklist",
  items: [
    item("enquiry", "Unit set up on the tracker with its size, quoting terms and plans, and ready for viewings", true),
    item("enquiry", "Targeting Brief agreed by everyone on it"),
    item("negotiating", "Brand and concept put to {CLIENT} for clearance"),
    item("negotiating", "Draft Heads of Terms and technical pack sent to the occupier"),
    item("negotiating", "Covenant and credit risk review of the tenant", true),
    item("negotiating", "AML check on the occupier opened"),
    item("negotiating", "Tenant checked against {CLIENT}'s financial thresholds, and green lease terms confirmed", true),
    item("negotiating", "Turnover analysis completed, for a turnover deal"),
    item("under_offer", "Approval from {CLIENT} in place", true),
    item("under_offer", "Joint venture or board approval in place, where needed", true),
    item("under_offer", "Solicitors instructed on the agreed Heads of Terms", true),
    item("under_offer", "{CLIENT}'s occupier onboarding team told of the letting"),
    item("under_offer", "First draft documents issued by the solicitor", true),
    item("under_offer", "Deal checked against the terms originally approved", true),
    item("under_offer", "Legal documents agreed", true),
    item("under_offer", "AML check on the occupier completed", true),
    item("under_offer", "Completion statement agreed, where one is needed"),
    item("exchanged", "Unit taken off the market: the tracker, the website and {CLIENT}'s own system", true),
  ],
};

export const CHECKLIST_TEMPLATES: ChecklistTemplate[] = [STANDARD_CHECKLIST];

// A short name for the client in an item's wording: the company name without
// its legal ending ("Landsec", "Hammerson"); "the client" when it is unknown.
export function checklistClientName(landlordName: string | null | undefined): string {
  const name = String(landlordName || "").replace(/\s+(plc|p\.l\.c\.|limited|ltd\.?|llp|group|holdings|uk)\b\.?/gi, "").replace(/\s+/g, " ").trim();
  return name && name.length <= 40 ? name : "the client";
}

// The list a new checklist starts from, worded for this landlord.
export function checklistTemplateFor(landlordName: string | null | undefined): ChecklistTemplate {
  const client = checklistClientName(landlordName);
  const label = (text: string) => {
    const out = text.replace(/\{CLIENT\}/g, client);
    return out.charAt(0).toUpperCase() + out.slice(1);
  };
  return { ...STANDARD_CHECKLIST, items: STANDARD_CHECKLIST.items.map(i => ({ ...i, label: label(i.label) })) };
}

export interface ChecklistPerson {
  key: string;                         // "user:<id>" or "brief:<unit_brief_people.id>"
  userId: string | null;
  briefPersonId: string | null;
  name: string;
  email: string | null;
  side: ChecklistSide;
  role: string | null;                 // what they are on the brief, or their job title
  hasLogin: boolean;                   // a login gets a task as well as an email
}

export interface ChecklistItem {
  id: string;
  stage: ChecklistStageKey;
  label: string;
  required: boolean;
  sortOrder: number;
  assignee: { userId: string | null; briefPersonId: string | null; name: string; email: string | null; side: ChecklistSide | null } | null;
  assignedAt: string | null;
  assignedByName: string | null;
  dueDate: string | null;              // yyyy-mm-dd
  note: string | null;
  doneAt: string | null;
  doneByName: string | null;
  notifiedAt: string | null;           // when the assignee was last emailed
  hasTask: boolean;                    // it is on the assignee's task list
  mine: boolean;                       // the person looking is its assignee
}

export interface DealChecklist {
  id: string;
  unit: { id: string; unitName: string; propertyId: string | null; propertyName: string | null; statusCode: string; dealId: string | null; dealRef: string | null };
  templateKey: string | null;
  templateName: string | null;
  stage: ChecklistStageKey;            // where the deal is now
  responsible: { userId: string | null; briefPersonId: string | null; name: string; email: string | null; side: ChecklistSide | null } | null;
  items: ChecklistItem[];              // by stage order, then sort order
  people: ChecklistPerson[];           // who can be made responsible
  summary: ChecklistSummary;
  // The item the deal is waiting on (shared/deal-waiting.ts): the one set on
  // the deal clock, else the one read from this checklist (derived). Null
  // when the deal is waiting on nothing here.
  waiting?: { itemId: string; derived: boolean; days: number | null; party: string | null; name: string | null } | null;
  // canDeleteDone: may delete an item that is already ticked (BGP, and a
  // joint agent on their scheme). isStaff is a BGP login only.
  // canSetWaiting: may say which item the deal is waiting on (the people who
  // may write the deal clock at this scheme).
  viewer: { isStaff: boolean; canEdit: boolean; canAssign: boolean; canDeleteDone?: boolean; canSetWaiting?: boolean };
}

// Where the emailed link to a unit's checklist goes, by who is being emailed.
// A login with the Letting Tracker goes to it; a joint agent to their own
// tracker; an asset manager (and someone with no login) to the Landsec unit
// page, which opens the same checklist.
export type ChecklistWay = "tracker" | "joint_agent_tracker" | "landsec_unit";
export function checklistWayFor(hasLogin: boolean, landsecRole: string | null | undefined): ChecklistWay {
  if (!hasLogin) return "landsec_unit";
  if (landsecRole === "joint_agent") return "joint_agent_tracker";
  return landsecRole === "asset_manager" ? "landsec_unit" : "tracker";
}
export function checklistLinkPath(way: ChecklistWay, trackerUnitId: string): string {
  const id = encodeURIComponent(trackerUnitId);
  if (way === "joint_agent_tracker") return `/landsec/tracker?unit=${id}&checklist=1`;
  return way === "tracker" ? `/deals/letting?unit=${id}&checklist=1` : `/landsec/unit/${id}?checklist=1`;
}
// Does this login have a task list? Every login does (Woody, 2026-11-13:
// "we need each person to have this update their own task list"): a Landsec
// asset manager has one too now. A login with a Landsec role (leasing
// manager, asset manager, joint agent) has it at /landsec/tasks.
export const checklistHasTaskList = (_landsecRole: string | null | undefined): boolean => true;
export const checklistTasksPath = (landsecRole: string | null | undefined): string => (landsecRole ? "/landsec/tasks" : "/tasks");

export interface ChecklistSummary {
  total: number;
  done: number;
  requiredOpen: number;                // required items not done, in the current stage and every earlier one
  unassigned: number;                  // open items with nobody on them (and no one responsible for the deal)
  overdue: number;                     // open items past their due date
}

// The headline numbers for a checklist at a stage, for the tracker row.
export function checklistSummary(
  items: { stage: string; required: boolean; doneAt: unknown; dueDate?: string | null; assignee?: unknown }[],
  stage: ChecklistStageKey, today: string, hasResponsible: boolean,
): ChecklistSummary {
  const order = CHECKLIST_STAGES.map(s => s.key as string);
  const upTo = order.indexOf(stage);
  const open = items.filter(i => !i.doneAt);
  return {
    total: items.length,
    done: items.length - open.length,
    requiredOpen: open.filter(i => i.required && order.indexOf(i.stage) <= upTo).length,
    unassigned: hasResponsible ? 0 : open.filter(i => !i.assignee).length,
    overdue: open.filter(i => i.dueDate && String(i.dueDate).slice(0, 10) < today).length,
  };
}
