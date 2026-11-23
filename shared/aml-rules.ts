// HMRC's AML rules for BGP in short (Woody, 22 November 2026: "a summary of
// the rules and put an auto refresh in there for any hmrc updates every 3
// months. Make it simplistic and to the point"). Each rule names the HMRC page
// it comes from. Every three months the app reads those pages' update dates
// from GOV.UK (server/aml-rules.ts) and tells the officers when HMRC has
// changed one since the rules were last reviewed. The rules are never
// rewritten by the app: the Nominated Officer approves the wording.

// The day these rules were written from HMRC's pages.
export const AML_RULES_WRITTEN_ON = "2026-11-22";

export const HMRC_AML_MANUAL = "/hmrc-internal-manuals/anti-money-laundering-guidance-for-supervised-businesses";

export const HMRC_AML_PAGES = {
  amlg2200: "Estate agents",
  amlg2300: "Letting agents",
  amlg3200: "Risks for estate agents",
  amlg11100: "Reporting suspicious activity",
  amlg11300: "Customer due diligence",
  amlg11400: "Identifying and verifying customers",
  amlg11410: "Relying on another firm",
  amlg11600: "Enhanced due diligence",
  amlg11630: "Source of funds and wealth",
  amlg11650: "Politically exposed persons",
  amlg11700: "Record keeping",
} as const;
export type HmrcAmlPage = keyof typeof HMRC_AML_PAGES;

export const hmrcPageUrl = (page: HmrcAmlPage) => `https://www.gov.uk${HMRC_AML_MANUAL}/${page}`;

export type AmlRuleRef = HmrcAmlPage | "bgp_policy" | "mlr_reg5" | "ofsi";
export const AML_RULE_REF_LABEL: Record<Exclude<AmlRuleRef, HmrcAmlPage>, { label: string; url: string | null }> = {
  bgp_policy: { label: "BGP policy", url: null },
  mlr_reg5: { label: "MLR 2017 reg 5", url: "https://www.legislation.gov.uk/uksi/2017/692/regulation/5" },
  ofsi: { label: "OFSI", url: "https://www.gov.uk/government/organisations/office-of-financial-sanctions-implementation" },
};

export interface AmlRule { text: string; refs: AmlRuleRef[] }
export interface AmlRuleGroup { title: string; rules: AmlRule[] }

export const AML_RULES: AmlRuleGroup[] = [
  {
    title: "Who we check, and when",
    rules: [
      { text: "Our client: as soon as they instruct us, and before we market the property.", refs: ["amlg2200", "amlg2300"] },
      { text: "A buyer: before their offer is accepted where we can, and always before exchange.", refs: ["amlg2200"] },
      { text: "A tenant: once the landlord accepts their offer. ID is checked before anything is signed. No deposit before the checks are done.", refs: ["amlg2300"] },
      { text: "BGP's policy (Issue 5): a buyer, a tenant and the other side are checked from agreed heads of terms. Nothing exchanges or completes until every party is checked.", refs: ["bgp_policy"] },
      { text: "A letting under £10,000 a month is outside HMRC's rules. We still run sanctions checks.", refs: ["amlg2300", "bgp_policy"] },
      { text: "Anyone acting for a party, such as an agent or a director: identify them and check they can act.", refs: ["amlg2200", "amlg2300"] },
      { text: "Someone else paying our invoice: find out why and check them. No link to the transaction is high risk.", refs: ["amlg3200"] },
    ],
  },
  {
    title: "Joint agents",
    rules: [
      { text: "Each agent checks the client. To use the other agent's checks instead, you need a reliance agreement.", refs: ["amlg2200", "amlg11410"] },
      { text: "Sales: the agent who finds the buyer checks them. If that was the other agent, ask them for their checks. If they don't send them, record that you asked.", refs: ["amlg2200"] },
      { text: "Lettings: HMRC has no such exception. Every party to the lease is verified, so use the joint agent's checks on the tenant only under a reliance agreement.", refs: ["amlg2300", "amlg11410"] },
      { text: "BGP's policy (Issue 5) goes further than HMRC on sales: we check the counterparty on every joint instruction, using the joint agent's documents or our own checks.", refs: ["bgp_policy"] },
      { text: "Agents who share a fee check each other.", refs: ["amlg2200", "amlg2300"] },
      { text: "Only work with agents registered with HMRC for AML. If one isn't, stop working with them and tell HMRC.", refs: ["amlg2200", "amlg11300"] },
    ],
  },
  {
    title: "What we check",
    rules: [
      { text: "A company: its register entry, its directors, and anyone who owns more than 25% or controls it.", refs: ["mlr_reg5", "amlg11400"] },
      { text: "A person: photo ID and proof of address from the last 3 months. The online ID check counts as photo ID.", refs: ["amlg11400", "bgp_policy"] },
      { text: "The person acting for a company: their identity and their authority to act. No proof of address unless they are also an owner.", refs: ["amlg11400", "bgp_policy"] },
      { text: "A company registered abroad: an extract from its own register, from the last 3 months. A document we can't read is translated; HMRC can ask for a certified translation.", refs: ["amlg11400", "bgp_policy"] },
      { text: "Where the money comes from.", refs: ["amlg11630"] },
      { text: "Sanctions: everyone, on every transaction, at any rent. A match goes to the Nominated Officer, who reports it to OFSI.", refs: ["ofsi", "bgp_policy"] },
    ],
  },
  {
    title: "Higher risk",
    rules: [
      { text: "Public roles (PEPs), their family and close associates: enhanced checks, until at least 12 months after they leave the role.", refs: ["amlg11650"] },
      { text: "Red flags, high-risk countries, trusts and complex ownership: enhanced checks, signed off by the Nominated Officer or a Deputy.", refs: ["amlg11600", "amlg3200"] },
      { text: "Check again every 3 years, or every year if higher risk.", refs: ["bgp_policy"] },
    ],
  },
  {
    title: "If the checks can't be finished",
    rules: [
      { text: "Stop: sign nothing, take no money from them, end the instruction.", refs: ["amlg2200", "amlg2300"] },
      { text: "Tell the Nominated Officer. They decide whether to report to the NCA, and record why if they don't.", refs: ["amlg11300", "amlg11100"] },
    ],
  },
  {
    title: "Suspicion",
    rules: [
      { text: "Tell the Nominated Officer straight away. Never tell the client: tipping off is a crime.", refs: ["amlg11100"] },
      { text: "Don't assume another firm will report it.", refs: ["amlg2200"] },
    ],
  },
  {
    title: "Relying on another firm",
    rules: [
      { text: "Allowed with a UK firm under the same rules. Get their checks straight away, and their agreement to send documents on request and keep them 5 years. We stay responsible.", refs: ["amlg11410"] },
      { text: "Never on a firm's simplified checks, or on a firm in a high-risk country.", refs: ["amlg11410"] },
    ],
  },
  {
    title: "Records",
    rules: [
      { text: "Keep the checks and the transaction records for 5 years after the transaction or the instruction ends.", refs: ["amlg11700"] },
    ],
  },
];

/** Every HMRC page the rules name, in the order they first appear. */
export function rulesHmrcPages(groups: AmlRuleGroup[] = AML_RULES): HmrcAmlPage[] {
  const out: HmrcAmlPage[] = [];
  for (const g of groups) for (const r of g.rules) for (const ref of r.refs) {
    if (ref in HMRC_AML_PAGES && !out.includes(ref as HmrcAmlPage)) out.push(ref as HmrcAmlPage);
  }
  return out;
}

// What a check of HMRC's pages found (server/aml-rules.ts).
export interface HmrcPageState { page: HmrcAmlPage; title: string; updatedAt: string | null }
export interface HmrcChangeNote { page: HmrcAmlPage | null; title: string; note: string; at: string }
export interface HmrcRulesCheck {
  checkedAt: string;
  pages: HmrcPageState[];
  notes: HmrcChangeNote[];
  // Pages that could not be read this time.
  failed: HmrcAmlPage[];
  error: string | null;
}
export interface AmlRulesReview { at: string; byName: string | null; note: string | null }

export interface HmrcChange { page: HmrcAmlPage | null; label: string; at: string; note: string | null }

/**
 * What HMRC changed after the rules were last reviewed (or written): each cited
 * page updated since, with the manual's change note for it where there is one.
 * A change note for a page the rules do not cite is listed too only when it is
 * about the whole manual.
 */
export function hmrcChangesSince(check: HmrcRulesCheck | null, review: AmlRulesReview | null, writtenOn = AML_RULES_WRITTEN_ON): HmrcChange[] {
  if (!check) return [];
  const since = review?.at && review.at.slice(0, 10) > writtenOn ? review.at : `${writtenOn}T23:59:59Z`;
  const after = (iso: string | null) => !!iso && new Date(iso).getTime() > new Date(since).getTime();
  const out: HmrcChange[] = [];
  for (const p of check.pages) {
    if (!after(p.updatedAt)) continue;
    const notes = check.notes.filter(n => n.page === p.page && after(n.at));
    out.push({ page: p.page, label: `${p.page.toUpperCase()} ${HMRC_AML_PAGES[p.page]}`, at: p.updatedAt!, note: notes.map(n => n.note).join(" ") || null });
  }
  for (const n of check.notes) {
    if (n.page || !after(n.at)) continue;
    out.push({ page: null, label: "The whole manual", at: n.at, note: n.note });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// The check runs on the 2nd of January, April, July and October.
export const HMRC_CHECK_MONTHS = [1, 4, 7, 10];
export const HMRC_CHECK_DAY = 2;

/** The next quarterly check after a London date (yyyy-mm-dd). */
export function nextHmrcCheck(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  for (let i = 0; i < 16; i++) {
    const month = ((m - 1 + i) % 12) + 1;
    const year = y + Math.floor((m - 1 + i) / 12);
    if (!HMRC_CHECK_MONTHS.includes(month)) continue;
    if (i === 0 && d >= HMRC_CHECK_DAY) continue;
    return `${year}-${String(month).padStart(2, "0")}-${String(HMRC_CHECK_DAY).padStart(2, "0")}`;
  }
  return today;
}

/** A signature of the changes, so the officers are emailed once for the same changes. */
export const hmrcChangesKey = (changes: HmrcChange[]): string => changes.map(c => `${c.page || "manual"}@${c.at}`).sort().join("|");
