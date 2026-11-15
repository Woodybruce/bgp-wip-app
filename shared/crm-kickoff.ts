// Turning a company on in the CRM (Woody, 2026-11-15): every landlord, agent
// and lender is on the CRM lists, and the brands BGP is working, but "we
// won't have a strategy for any of them till we turn them on". Turning one
// on starts a strategy for it, or adds it to one already running, and "the
// CRM engine starts suggesting locations, events, people to meet".
//
// The kick-off is a DRAFT: what the app holds about the company, and a
// suggested name, objective, people, events, places and first actions. A
// person edits it and ticks what they want; only then is anything saved, by
// the engine's own save functions. This file is the contract and the checks
// on the reader's answer: every person, event, place and strategy it names
// must be one the server offered it.
import type { EngagementNoun } from "./crm-engagement";

export interface KickoffPerson { contactId: string; name: string; role: string | null; why: string | null; suggested: boolean }
export interface KickoffEvent { eventId: string; title: string; startsAt: string | null; location: string | null; why: string | null; suggested: boolean }
export interface KickoffPlace { placeId: string; name: string; detail: string | null; why: string | null }
export interface KickoffAction { title: string; dueInDays: number; why: string | null }
export interface CrmKickoff {
  company: { id: string; name: string; noun: EngagementNoun };
  /** Plain lines of what the app holds, shown as "What we know". */
  facts: string[];
  /** Strategies already running that this company could join, the suggested one first. */
  strategies: Array<{ id: string; name: string; objective: string; companies: string[]; suggested: boolean; why: string | null; already: boolean }>;
  draft: { name: string; objective: string; reason: string };
  people: KickoffPerson[];
  events: KickoffEvent[];
  places: KickoffPlace[];
  actions: KickoffAction[];
  usedAi: boolean;
  /** Why there is no draft from the reader, when there is none. */
  note: string | null;
}

export interface KickoffOffer {
  contacts: Array<{ id: string; name: string; role: string | null }>;
  events: Array<{ id: string; title: string; startsAt: string | null; location: string | null }>;
  places: Array<{ id: string; name: string; detail: string | null }>;
  strategies: Array<{ id: string; name: string; objective: string; companies: string[]; already: boolean }>;
}

const squash = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const why = (v: unknown) => squash(v, 240) || null;

/** The reader's answer, kept to what the server offered. Text is the reader's own wording: a person edits it. */
export function checkKickoffAnswer(answer: any, offer: KickoffOffer, fallback: CrmKickoff["draft"]): Pick<CrmKickoff, "draft" | "people" | "events" | "places" | "actions" | "strategies"> {
  const a = answer && typeof answer === "object" ? answer : {};
  const picked = <T extends { id: string }>(list: any, offered: T[], key: string) => {
    const out: Array<{ item: T; why: string | null }> = [];
    for (const row of Array.isArray(list) ? list.slice(0, 12) : []) {
      const item = offered.find(o => o.id === String(row?.[key] ?? ""));
      if (item && !out.some(o => o.item.id === item.id)) out.push({ item, why: why(row?.why) });
    }
    return out;
  };
  const people = picked(a.people, offer.contacts, "contactId");
  const events = picked(a.events, offer.events, "eventId");
  const places = picked(a.places, offer.places, "placeId").slice(0, 6);
  const join = offer.strategies.find(s => s.id === String(a.join?.strategyId ?? "") && !s.already) || null;
  const actions: KickoffAction[] = [];
  for (const row of Array.isArray(a.actions) ? a.actions.slice(0, 6) : []) {
    const title = squash(row?.title, 200);
    const days = Number(row?.dueInDays);
    if (title.length >= 4 && !actions.some(x => x.title.toLowerCase() === title.toLowerCase()))
      actions.push({ title, dueInDays: Number.isFinite(days) ? Math.min(180, Math.max(1, Math.round(days))) : 14, why: why(row?.why) });
  }
  return {
    draft: { name: squash(a.name, 160) || fallback.name, objective: squash(a.objective, 1500) || fallback.objective, reason: squash(a.reason, 600) || fallback.reason },
    people: offer.contacts.map(c => { const p = people.find(x => x.item.id === c.id); return { contactId: c.id, name: c.name, role: c.role, why: p?.why || null, suggested: !!p }; })
      .sort((x, y) => Number(y.suggested) - Number(x.suggested)),
    events: offer.events.map(e => { const p = events.find(x => x.item.id === e.id); return { eventId: e.id, title: e.title, startsAt: e.startsAt, location: e.location, why: p?.why || null, suggested: !!p }; })
      .sort((x, y) => Number(y.suggested) - Number(x.suggested)),
    places: places.map(p => ({ placeId: p.item.id, name: p.item.name, detail: p.item.detail, why: p.why })),
    actions,
    strategies: offer.strategies.map(s => ({ ...s, suggested: s.id === join?.id, why: s.id === join?.id ? why(a.join?.why) : null }))
      .sort((x, y) => Number(y.suggested) - Number(x.suggested)),
  };
}

/** What a person sends back to start it. */
export interface KickoffApply {
  companyId: string;
  /** Join this strategy; when absent a new one is made from `strategy`. */
  strategyId?: string | null;
  strategy?: { name: string; objective: string; team: string | null; startsOn: string | null; endsOn: string | null } | null;
  ownerId: string;
  reason: string;
  contactIds: string[];
  eventIds: string[];
  actions: Array<{ title: string; dueAt: string; notes: string | null }>;
}
