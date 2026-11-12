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

// The standard list, in plain wording that fits any client.
export const STANDARD_CHECKLIST: ChecklistTemplate = {
  key: "standard",
  name: "Standard letting checklist",
  items: [
    item("enquiry", "Correct unit on the tracker and ready for viewing", true),
    item("negotiating", "Concept and brand approval requested from the client"),
    item("negotiating", "First Heads of Terms and technical pack issued to the occupier"),
    item("negotiating", "Tenant covenant and risk review", true),
    item("negotiating", "AML check on the occupier started"),
    item("negotiating", "Tenant due diligence against the client's financial thresholds, and green lease conditions confirmed", true),
    item("negotiating", "Turnover analysis for a turnover deal"),
    item("under_offer", "Client approval completed", true),
    item("under_offer", "Joint venture or board approval satisfied", true),
    item("under_offer", "Solicitors instructed with the agreed Heads of Terms", true),
    item("under_offer", "Notice sent to the client's occupier onboarding team"),
    item("under_offer", "Solicitor to issue first draft documents", true),
    item("under_offer", "Deal confirmed as reflecting the original approval", true),
    item("under_offer", "Documents agreed", true),
    item("under_offer", "AML check on the occupier completed", true),
    item("under_offer", "Completion statement agreed, if required"),
    item("exchanged", "Unit marked as not available on the tracker and the website", true),
  ],
};

// Hammerson's own list, as Woody pasted it on 12 November 2026.
export const HAMMERSON_CHECKLIST: ChecklistTemplate = {
  key: "hammerson",
  name: "Hammerson checklist",
  items: [
    item("enquiry", "Correct unit assigned in VTS and ready for viewing", true),
    item("negotiating", "Assign task to GMC for Concept Clearance"),
    item("negotiating", "First HOTs and technical pack issued to occupier"),
    item("negotiating", "Perform tenant covenant and risk review (Credit Control)", true),
    item("negotiating", "Initiate AML occupier check"),
    item("negotiating", "Perform tenant due diligence with internal financial thresholds/BP and ensure lease will contain green lease conditions", true),
    item("negotiating", "Perform tenant due diligence with Retail Analysis for turnover deals"),
    item("under_offer", "Hammerson approval completed", true),
    item("under_offer", "JV approval satisfied", true),
    item("under_offer", "Instruct lawyers with agreed HOTs", true),
    item("under_offer", "Send NTC to Occupier Onboarding and Engagement (OOE)"),
    item("under_offer", "Lawyer to issue first draft documents", true),
    item("under_offer", "Confirm deal reflects original approval", true),
    item("under_offer", "Documents agreed", true),
    item("under_offer", "Complete occupier AML check", true),
    item("under_offer", "Completion statements agreed if required"),
    item("exchanged", "Mark space as \"Not Available\" in VTS", true),
  ],
};

export const CHECKLIST_TEMPLATES: ChecklistTemplate[] = [STANDARD_CHECKLIST, HAMMERSON_CHECKLIST];

// Which standard list a new checklist starts from, by the landlord's name.
export function checklistTemplateFor(landlordName: string | null | undefined): ChecklistTemplate {
  return /hammerson/i.test(String(landlordName || "")) ? HAMMERSON_CHECKLIST : STANDARD_CHECKLIST;
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
  viewer: { isStaff: boolean; canEdit: boolean; canAssign: boolean };
}

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
