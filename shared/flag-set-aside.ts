// Setting a red flag aside: the app reviews the flag and drafts the reason
// (Woody, 24 November 2026, on adverse media about BERKELEY GROUP PLC(THE):
// "can you get the app to review and put a suggestions of why can set aside
// these flags in this box?"). The reader is sent the flag, its numbered
// findings (the source's own words, the source and its date) and what BGP
// holds on the company, and drafts the reason for the officer to read and
// edit, or says why the flag should stand. It never sets anything aside: the
// officer's Set aside is the only save. Server: server/flag-set-aside.ts.
import { FLAG_REVIEW_COMMENT_MIN, isSanctionsFlag, type KycRedFlag } from "./kyc-red-flags";

export type SetAsideVerdict = "set_aside" | "look_closer" | "keep";

export interface SetAsideSuggestion {
  verdict: SetAsideVerdict | null;
  /** The draft for the box: plain words, for the officer to read and edit. Empty when there is none. */
  comment: string;
  /** The reader's read of each numbered finding. */
  findings: Array<{ n: number; relevant: boolean; why: string }>;
  /** Why there is no draft: a flag a person must check, the reader off, today's allowance used. */
  unavailable: string | null;
}

export const SET_ASIDE_VERDICT_WORDS: Record<SetAsideVerdict, string> = {
  set_aside: "The app's read: none of these bears on money laundering risk",
  look_closer: "The app's read: look closer before setting it aside",
  keep: "The app's read: this one should stand",
};

/**
 * A flag the reader never drafts a reason for, with what to do instead: it
 * needs a person's own check (a possible sanctions match, the client's own
 * answer, a declined identity check), or it is a person's own mark.
 */
export function setAsideNeedsPerson(flag: Pick<KycRedFlag, "kind" | "evidence">): string | null {
  if (isSanctionsFlag(flag)) return "A possible sanctions match is set aside only once a person has compared the list entry with the person or company (date of birth, nationality, address). Tell the Nominated Officer.";
  if (flag.kind === "client_pep") return "The client said they hold a public role. That is their own answer, not a screening match: enhanced due diligence applies.";
  if (flag.kind === "id_declined") return "Veriff declined the identity check. Ask for a new check or a certified document instead.";
  if (flag.kind === "owners_differ") return "The client says the owners Companies House lists are not right. Find out who owns it, and report the difference to Companies House.";
  if (flag.kind === "sof_mismatch") return "The source of funds document does not match what was declared. Ask the client to explain the difference.";
  if (flag.kind === "edd" || flag.kind === "high_risk") return "A person put this mark on the KYC record. Change it there if it no longer applies.";
  return null;
}

/** The flag's findings, numbered for the reader: the source's words, then where it came from. */
export function flagFindings(flag: Pick<KycRedFlag, "facts" | "detail">): string[] {
  const out: string[] = [];
  let current: string[] = [];
  for (const f of flag.facts || []) {
    const line = `${f.label}: ${f.value}${f.url ? ` (${f.url})` : ""}`;
    // "What the source says" (a web finding) or "Matched profile" (ComplyAdvantage) opens a finding;
    // the lines after it (the source and its date, an article) belong to it.
    if (/^(?:what the source says|matched profile)/i.test(f.label) && current.length) { out.push(current.join("; ")); current = []; }
    current.push(line);
  }
  if (current.length) out.push(current.join("; "));
  if (!out.length && flag.detail) out.push(flag.detail);
  return out.slice(0, 12).map(s => s.slice(0, 1500));
}

export const SET_ASIDE_SUGGEST_TOOL = {
  name: "suggest_set_aside",
  description: "Your read of the red flag's findings and the draft reason for the officer's record.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["set_aside", "look_closer", "keep"] },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            n: { type: "integer", description: "The finding's number." },
            relevant: { type: "boolean", description: "True when the finding bears on money laundering or terrorist financing risk." },
            why: { type: "string", description: "A few plain words: what it is and why it does or does not bear on the risk." },
          },
          required: ["n", "relevant", "why"],
        },
      },
      comment: { type: "string", description: "The reason for the officer's record, at most 80 words." },
    },
    required: ["verdict", "findings", "comment"],
  },
} as const;

export function setAsideSuggestSystem(): string {
  return [
    "You help the AML officers of Bruce Gillingham Pollard (BGP), a UK commercial property agent supervised by HMRC, decide whether a red flag from BGP's screening can be set aside. You draft; the officer decides and edits.",
    "",
    "Weigh each numbered finding against money laundering and terrorist financing risk (Money Laundering Regulations 2017). A finding bears on that risk when it is about this company or person and concerns money laundering, terrorist financing, sanctions, fraud, bribery or corruption, tax evasion, other financial crime, criminal charges or convictions, or a regulator's action for financial crime or misconduct.",
    "A finding does not bear on it when it is about someone else of a similar name, or when it concerns a commercial or contract dispute, competition or consumer law resolved with no finding of financial crime, environmental, planning or health and safety matters, or allegations that were withdrawn, dismissed or found unfounded.",
    "",
    "Use only the facts given here. Do not add dates, outcomes, people or facts that are not in them. Where a finding is cut short or unclear, say so.",
    "",
    "verdict: set_aside when no finding bears on the risk; look_closer when one might and the facts given do not settle it; keep when one does.",
    "comment: the reason for the officer's record, in plain English, at most 80 words. For set_aside, say briefly what each finding is and why it does not bear on money laundering risk. For look_closer, say what to check. For keep, say why it stands. Write as the officer would, in full sentences, with no headings, bullet points or phrases such as \"it is worth noting\".",
  ].join("\n");
}

/** The reader's message: the flag, its findings and what BGP holds on the company. */
export function setAsideSuggestMessage(flag: Pick<KycRedFlag, "label" | "detail" | "source" | "at">, findings: string[], about: string[]): string {
  const clean = (s: string) => s.replace(/[<>]/g, " ");
  return [
    `<flag>${clean(flag.label)}${flag.detail ? `\n${clean(flag.detail)}` : ""}\nFound by: ${clean(flag.source)}${flag.at ? `, ${flag.at.slice(0, 10)}` : ""}</flag>`,
    `<findings>\n${findings.map((f, i) => `${i + 1}. ${clean(f)}`).join("\n")}\n</findings>`,
    about.length ? `<about_the_subject>\n${about.map(clean).join("\n")}\n</about_the_subject>` : "",
  ].filter(Boolean).join("\n\n");
}

const plainWords = (v: unknown, max: number): string => String(v ?? "")
  .replace(/^\s*(?:[-•*]|\d+[.)])\s+/gm, "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

/** At most `limit` words, ending on a full sentence where one ends inside the limit. */
function cutWords(text: string, limit: number): string {
  const words = text.split(" ");
  if (words.length <= limit) return text;
  const cut = words.slice(0, limit).join(" ");
  const end = Math.max(cut.lastIndexOf(". "), cut.endsWith(".") ? cut.length - 1 : -1);
  return end > cut.length / 2 ? cut.slice(0, end + 1) : `${cut}…`;
}

/** The reader's answer, checked: a verdict it may give, the findings it numbered, a draft in plain words. */
export function checkSetAsideSuggestion(input: unknown, findingCount: number): SetAsideSuggestion {
  const a: Record<string, unknown> = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const verdict = a.verdict === "set_aside" || a.verdict === "look_closer" || a.verdict === "keep" ? a.verdict : null;
  if (!verdict) return { verdict: null, comment: "", findings: [], unavailable: "The app gave no answer. Try again." };
  const findings = (Array.isArray(a.findings) ? a.findings : [])
    .map(f => (f && typeof f === "object" ? f as Record<string, unknown> : {}))
    .filter(f => Number.isInteger(f.n) && (f.n as number) >= 1 && (f.n as number) <= findingCount && typeof f.relevant === "boolean")
    .map(f => ({ n: f.n as number, relevant: f.relevant as boolean, why: plainWords(f.why, 240) }))
    .filter((f, i, all) => all.findIndex(g => g.n === f.n) === i);
  // A finding the reader itself says bears on the risk is never a reason to set the flag aside.
  const said = findings.some(f => f.relevant) && verdict === "set_aside" ? "look_closer" : verdict;
  const comment = cutWords(plainWords(a.comment, 900), 100);
  if (comment.length < FLAG_REVIEW_COMMENT_MIN) return { verdict: said, comment: "", findings, unavailable: "The app's draft was too short to use. Write the reason yourself." };
  return { verdict: said, comment, findings, unavailable: null };
}
