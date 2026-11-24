// BGP's written view of a party's AML file (Woody, 24 November 2026, on the
// risk assessment of Vodafone #4664: "we already have all this info
// highlighted in the parts above? shouldnt this be more an AI led commentary
// with fable 5 giving a proper view on whats been found and given to date and
// the risk profile given the rules?").
//
// Fable reads the facts the risk assessment holds (numbered F1, F2 ...) and
// BGP's AML rules in short (R1, R2 ...), and writes a short view: what has
// been found and given, what is still needed, the risk profile under the
// rules, and what to do next, with anything that does not add up. Every
// paragraph cites the facts it rests on; one that cites none is dropped, and
// a citation that is not a fact or rule given is taken out. It decides
// nothing: the sign-off is a person's.
//
// Pure: the facts are built from the risk assessment (shared/aml-risk-assessment.ts);
// the call, the cache and the routes are server/aml-commentary.ts.

import type { RiskAssessment } from "./aml-risk-assessment";
import { AML_RULES, AML_RULE_REF_LABEL, HMRC_AML_PAGES, type AmlRuleRef } from "./aml-rules";

export interface CommentaryFact { id: string; text: string }

export const COMMENTARY_SECTIONS = ["found", "outstanding", "profile", "next"] as const;
export type CommentarySection = typeof COMMENTARY_SECTIONS[number];
export const COMMENTARY_SECTION_TITLE: Record<CommentarySection, string> = {
  found: "What has been found and given",
  outstanding: "What is still needed",
  profile: "Risk profile under BGP's rules",
  next: "Next steps",
};

export const COMMENTARY_PROFILES = ["lower", "standard", "higher", "unclear"] as const;
export type CommentaryProfile = typeof COMMENTARY_PROFILES[number];
export const COMMENTARY_PROFILE_WORDS: Record<CommentaryProfile, string> = {
  lower: "Lower risk",
  standard: "Standard risk",
  higher: "Higher risk",
  unclear: "Not clear yet",
};

export interface CommentaryParagraph { section: CommentarySection; text: string; facts: string[]; rules: string[] }
export interface AmlCommentary {
  headline: string;
  profile: CommentaryProfile;
  paragraphs: CommentaryParagraph[];
  // Things in the record that do not add up, for a person to look at.
  queries: Array<{ text: string; facts: string[] }>;
}

const clean = (v: unknown, max: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The facts the view may use: every line of the risk assessment, numbered. */
export function commentaryFacts(ra: RiskAssessment): CommentaryFact[] {
  const lines: string[] = [];
  for (const r of ra.job) lines.push(`${r.label}: ${r.value}`);
  lines.push(`Level of due diligence: ${ra.levelOfRisk.words}`);
  for (const h of ra.risks) lines.push(`${h.label}: ${h.value}${h.details.length ? ` (${h.details.join("; ")})` : ""}`);
  for (const r of ra.diligence) lines.push(`${r.label}: ${r.value}`);
  for (const e of ra.structure) lines.push(`Structure: ${e.name}, ${e.location}, country risk ${e.countryRisk.toLowerCase()}, ${e.orgType.toLowerCase()}${e.evidence.length ? `. ${e.evidence.join(". ")}` : ""}`);
  if (ra.ownersNote) lines.push(`Beneficial owners: ${ra.ownersNote}`);
  for (const o of ra.owners) lines.push(`Owner: ${o.name}, nationality ${o.nationality}, residence ${o.residence}, identity: ${o.idMethod}, risk ${o.risk.toLowerCase()}, PEP ${o.pep.toLowerCase()}${o.evidence.length ? `. ${o.evidence.join(". ")}` : ""}`);
  for (const c of ra.certified) lines.push(`Certified documents: ${c}`);
  for (const r of ra.riskIdentified) lines.push(`Risk identified: ${r}`);
  for (const m of ra.mitigating) lines.push(`Mitigating factor: ${m}`);
  for (const c of ra.conclusion) lines.push(`The record's own conclusion: ${c}`);
  for (const r of ra.counterparty) lines.push(`${r.label}: ${r.value}`);
  for (const r of ra.approvals) lines.push(`${r.label}: ${r.value}`);
  return lines.map(l => clean(l, 1200)).filter(Boolean).map((text, i) => ({ id: `F${i + 1}`, text }));
}

const refWords = (ref: AmlRuleRef): string =>
  ref in HMRC_AML_PAGES ? `HMRC ${ref.toUpperCase()}` : AML_RULE_REF_LABEL[ref as Exclude<AmlRuleRef, keyof typeof HMRC_AML_PAGES>]?.label || ref;

/** BGP's AML rules in short, numbered, with where each comes from. */
export function commentaryRules(): CommentaryFact[] {
  const out: CommentaryFact[] = [];
  for (const group of AML_RULES) for (const rule of group.rules) {
    out.push({ id: `R${out.length + 1}`, text: `${group.title}: ${rule.text} (${rule.refs.map(refWords).join(", ")})` });
  }
  return out;
}

// Fable 5.2 takes no forced tool, so the answer comes back as JSON in this
// shape (structured output).
export const COMMENTARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "profile", "paragraphs", "queries"],
  properties: {
    headline: { type: "string", description: "One sentence: where this party's file stands." },
    profile: { type: "string", enum: [...COMMENTARY_PROFILES] },
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "text", "facts", "rules"],
        properties: {
          section: { type: "string", enum: [...COMMENTARY_SECTIONS] },
          text: { type: "string" },
          facts: { type: "array", items: { type: "string" } },
          rules: { type: "array", items: { type: "string" } },
        },
      },
    },
    queries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "facts"],
        properties: { text: { type: "string" }, facts: { type: "array", items: { type: "string" } } },
      },
    },
  },
} as const;

export function commentarySystem(): string {
  return [
    "You write the view on one party's anti-money laundering file at Bruce Gillingham Pollard (BGP), a UK commercial property agency supervised by HMRC. The readers are BGP's agents and its AML officers.",
    "You are given the facts the app holds on the party, numbered F1, F2 and so on, and BGP's AML rules in short, numbered R1, R2 and so on. Use only these. Never add a name, figure, date, finding or rule that is not in them, and never guess what a check would find.",
    "Write:",
    "- headline: one sentence saying where the file stands.",
    "- profile: lower, standard, higher or unclear. This is your reading of the risk under BGP's rules; use unclear when the facts do not settle it.",
    "- paragraphs: one short paragraph for each section, in this order: found (what BGP's checks found and what the party has given so far), outstanding (what the rules still need before anyone signs the party off, and from whom), profile (the risk and why, under the rules), next (the next one to three things to do, in order). Each paragraph is 30 to 90 words and lists in facts the facts it rests on and in rules the rules it applies.",
    "- queries: anything in the facts that does not add up or looks wrong, such as two facts that contradict each other or a figure out of line with the rest, each with the facts it rests on. Leave it empty when nothing stands out.",
    "Say what the facts mean rather than repeating them. Write plain English in short sentences, with no markdown, headings or lists inside a paragraph. Say transaction, not deal.",
    "You decide nothing. Never say a party is approved, cleared or signed off unless a fact says so: the sign-off is an agent's or an officer's.",
  ].join("\n");
}

export function commentaryMessage(party: string, facts: CommentaryFact[], rules: CommentaryFact[]): string {
  return [
    `The party: ${clean(party, 200)}`,
    "",
    "Facts:",
    ...facts.map(f => `${f.id}. ${f.text}`),
    "",
    "BGP's AML rules in short:",
    ...rules.map(r => `${r.id}. ${r.text}`),
  ].join("\n");
}

const MAX_PARAGRAPH = 900;
const MAX_HEADLINE = 300;
const MAX_QUERIES = 4;

/** Fable's answer, checked: only the sections, facts and rules given; a paragraph citing no fact is dropped. */
export function checkCommentary(raw: unknown, facts: CommentaryFact[], rules: CommentaryFact[]): AmlCommentary | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const factIds = new Set(facts.map(f => f.id));
  const ruleIds = new Set(rules.map(r => r.id));
  const ids = (v: unknown, allowed: Set<string>) =>
    [...new Set((Array.isArray(v) ? v : []).map(x => clean(x, 12).toUpperCase()).filter(x => allowed.has(x)))];
  const profile = COMMENTARY_PROFILES.includes(a.profile as CommentaryProfile) ? a.profile as CommentaryProfile : "unclear";
  const seen = new Set<CommentarySection>();
  const paragraphs: CommentaryParagraph[] = [];
  for (const item of Array.isArray(a.paragraphs) ? a.paragraphs : []) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const section = COMMENTARY_SECTIONS.includes(p.section as CommentarySection) ? p.section as CommentarySection : null;
    const text = clean(p.text, MAX_PARAGRAPH);
    const cited = ids(p.facts, factIds);
    if (!section || seen.has(section) || !text || !cited.length) continue;
    seen.add(section);
    paragraphs.push({ section, text, facts: cited, rules: ids(p.rules, ruleIds) });
  }
  paragraphs.sort((x, y) => COMMENTARY_SECTIONS.indexOf(x.section) - COMMENTARY_SECTIONS.indexOf(y.section));
  const queries = (Array.isArray(a.queries) ? a.queries : [])
    .map(q => (q && typeof q === "object" ? q as Record<string, unknown> : {}))
    .map(q => ({ text: clean(q.text, 400), facts: ids(q.facts, factIds) }))
    .filter(q => q.text && q.facts.length)
    .slice(0, MAX_QUERIES);
  const headline = clean(a.headline, MAX_HEADLINE);
  if (!headline || !paragraphs.length) return null;
  return { headline, profile, paragraphs, queries };
}

/** The facts and rules a view cites, in order, for its sources list. */
export function commentarySources(c: AmlCommentary, facts: CommentaryFact[], rules: CommentaryFact[]): CommentaryFact[] {
  const cited = new Set([...c.paragraphs.flatMap(p => [...p.facts, ...p.rules]), ...c.queries.flatMap(q => q.facts)]);
  return [...facts, ...rules].filter(f => cited.has(f.id));
}
