// Setting a red flag aside: the app reviews the flag and drafts the reason for
// the officer (Woody, 24 November 2026: "can you get the app to review and put
// a suggestions of why can set aside these flags in this box?"). Rules and the
// reader's words: shared/flag-set-aside.ts.
//
//   POST /api/deals/:id/red-flags/suggest                              { role?, key }
//   POST /api/client-kyc/:companyId/subjects/:entity/red-flags/suggest { key }
//
// Both are the officers', as the set-aside is. The flag is read again here,
// never taken from the request. Anthropic, called directly, one call a
// draft, capped a day (FLAG_SET_ASIDE_DAILY_CAP, default 100, 0 = off).
// Nothing is saved: the officer's Set aside is the only save.
import { pool } from "./db";
import {
  SET_ASIDE_SUGGEST_TOOL, checkSetAsideSuggestion, flagFindings, setAsideNeedsPerson, setAsideSuggestMessage, setAsideSuggestSystem,
  type SetAsideSuggestion,
} from "@shared/flag-set-aside";
import type { KycRedFlag } from "@shared/kyc-red-flags";

const USAGE_KEY = "aml_flag_set_aside_usage";
const FEATURE = "aml-set-aside-suggest";

export function setAsideSuggestDailyCap(): number {
  const raw = process.env.FLAG_SET_ASIDE_DAILY_CAP;
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 100;
}

const none = (why: string): SetAsideSuggestion => ({ verdict: null, comment: "", findings: [], unavailable: why });

export class SuggestRefusal extends Error {
  constructor(message: string, public status = 409) { super(message); this.name = "SuggestRefusal"; }
}

export interface SuggestDeps {
  hasKey?: () => boolean;
  claim?: () => Promise<boolean>;
  ask?: (system: string, message: string) => Promise<{ input: unknown; model: string; usage?: unknown }>;
  flags?: typeof import("./kyc-red-flags").loadDealRedFlags;
  about?: (brandId: string, entityId: string | null) => Promise<string[]>;
}

async function askAnthropic(system: string, message: string) {
  const { getAnthropicClient, CHATBGP_MODEL } = await import("./utils/anthropic-client");
  const response = await getAnthropicClient(true).messages.create({
    model: CHATBGP_MODEL,
    max_tokens: 1200,
    system,
    tools: [SET_ASIDE_SUGGEST_TOOL as any],
    tool_choice: { type: "tool", name: SET_ASIDE_SUGGEST_TOOL.name },
    messages: [{ role: "user", content: message }],
  }, { timeout: 60_000, maxRetries: 1 });
  const block = response.content.find((b: any) => b.type === "tool_use") as any;
  return { input: (response.stop_reason as string) === "max_tokens" ? null : block?.input ?? null, model: response.model || CHATBGP_MODEL, usage: response.usage };
}

/** What BGP holds on the company, for the reader: its register facts as BGP's checks read them. */
async function aboutTheSubject(brandId: string, entityId: string | null): Promise<string[]> {
  const { latestPrecheck } = await import("./kyc-prechecks");
  const { precheckCompany } = await import("@shared/kyc-prechecks");
  const stored = await latestPrecheck(brandId, entityId).catch(() => null);
  const c = precheckCompany(stored?.result as any || null);
  if (!c) return [];
  return [
    `Company: ${c.name} (${c.number}), ${c.status}${c.type ? `, ${c.type}` : ""}${c.incorporatedOn ? `, incorporated ${c.incorporatedOn}` : ""}`,
    c.business.length ? `Business: ${c.business.join("; ")}` : "",
    c.listing ? `Listed: ${c.listing}` : "",
    c.owners.length ? `Owners: ${c.owners.map(o => o.name).join("; ")}` : "",
    c.directors.length ? `Directors: ${c.directors.slice(0, 8).join("; ")}` : "",
    c.warnings.length ? `Register warnings: ${c.warnings.join("; ")}` : "",
  ].filter(Boolean);
}

/** The draft reason for setting one live flag aside. Throws SuggestRefusal when the flag is not there. */
export async function suggestSetAside(input: { dealId: string | null; brandId: string | null; entityId: string | null; key: string }, deps: SuggestDeps = {}): Promise<SetAsideSuggestion & { label: string }> {
  if (!input.dealId && !input.brandId) throw new SuggestRefusal("Which company?", 400);
  const load = deps.flags || (await import("./kyc-red-flags")).loadDealRedFlags;
  const flags = await load(input.dealId, input.brandId ? [input.brandId] : [], input.brandId && input.entityId ? { [input.brandId]: input.entityId } : {});
  const live: KycRedFlag[] = input.brandId ? flags.parties[input.brandId] || [] : flags.deal;
  const flag = live.find(f => f.key === input.key);
  if (!flag) throw new SuggestRefusal("That red flag is not there any more (it may have been set aside already). Reload the box.");
  const label = flag.label;
  const person = setAsideNeedsPerson(flag);
  if (person) return { ...none(person), label };
  const findings = flagFindings(flag);
  if (!findings.length) return { ...none("The flag holds nothing for the app to read. Write the reason yourself."), label };
  const hasKey = deps.hasKey || (() => !!(process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY));
  if (!hasKey()) return { ...none("The app's reader is not switched on. Write the reason yourself."), label };
  try {
    const claim = deps.claim || (async () => (await import("./requirement-feeds")).claimDailyRead(USAGE_KEY, setAsideSuggestDailyCap()));
    if (!(await claim())) return { ...none("Today's allowance of drafts is used up. Write the reason yourself."), label };
    const about = input.brandId ? await (deps.about || aboutTheSubject)(input.brandId, input.entityId).catch(() => [] as string[]) : [];
    const reply = await (deps.ask || askAnthropic)(setAsideSuggestSystem(), setAsideSuggestMessage(flag, findings, about));
    if (!deps.ask) import("./api-usage").then(m => m.logAiUsage({ provider: "anthropic", model: reply.model, feature: FEATURE, usage: reply.usage as any })).catch(() => {});
    return { ...checkSetAsideSuggestion(reply.input, findings.length), label };
  } catch (e: any) {
    console.warn(`[flag-set-aside] no draft: ${e?.message}`);
    return { ...none("The app could not draft a reason just now. Try again, or write it yourself."), label };
  }
}

/** The party a transaction's flag is about (null role: the transaction record). */
export async function dealFlagSubject(dealId: string, role: string | null): Promise<{ brandId: string | null; entityId: string | null }> {
  if (!role) {
    const deal = (await pool.query(`SELECT id FROM crm_deals WHERE id = $1`, [dealId])).rows[0];
    if (!deal) throw new SuggestRefusal("Transaction not found.", 404);
    return { brandId: null, entityId: null };
  }
  const { isDealPartyRole, DEAL_PARTY_LABEL } = await import("@shared/deal-parties");
  if (!isDealPartyRole(role)) throw new SuggestRefusal("Unknown party.", 400);
  const { loadAmlParty } = await import("./deal-party-aml");
  const party = await loadAmlParty(pool, dealId, role);
  if (!party) throw new SuggestRefusal(`This transaction has no ${DEAL_PARTY_LABEL[role].toLowerCase()}.`, 404);
  return { brandId: party.brandId, entityId: party.entityId };
}
