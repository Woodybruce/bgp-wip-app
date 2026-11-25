// BGP's written risk assessment for a deal party, in KYC4U's shape (Woody,
// 21 November 2026, on KYC4U's AML Risk Assessment Report for LEGO: "yes lets
// do 1 to 4"). The same headings as KYC4U's report: the job, the four risk
// indicators (client, geographic, other, PEP), the due diligence checklist,
// the structure and its evidence, the beneficial owners and how each was
// verified, the risk identified, mitigating factors and conclusion, the
// counterparty's agent and solicitors (BGP's AML policy, Issue 2, asks the
// same questions of a counterparty), and who approved.
//
// Pure: built from what the AML file already gathers (server/aml-file.ts).
// The AML file prints it first; the AML box shows it on request. It writes
// nothing and decides nothing: every line says where it comes from.

import type { KycRedFlag, SetAsideFlag } from "./kyc-red-flags";
import type { PartyDueDiligence } from "./aml-policy";
import type { PartyPeople } from "./kyc-people";
import { isOffshoreCountry, isRegisterDirector, personNamesMatch, type PrecheckCompany } from "./kyc-prechecks";
import { CHARITY_ATTRIBUTION, type CharityFacts } from "./charity-register";
import { sameCompany } from "./foreign-owners";
import { SOLICITOR_SIDES, SOLICITOR_SIDE_WORDS, solicitorCheckWords, type SolicitorCheck } from "./solicitor-aml";
import { SRA_ATTRIBUTION_URL, SRA_ATTRIBUTION_WORDS } from "./sra-register";

export type RiskTone = "ok" | "attention" | "info";
export interface RiskRow { label: string; value: string; tone: RiskTone }
export interface RiskHeading { factor: "client" | "geographic" | "other" | "pep"; label: string; value: "Low" | "Higher"; details: string[] }
export interface RiskEntity { name: string; location: string; countryRisk: string; orgType: string; evidence: string[] }
export interface RiskOwner { name: string; nationality: string; residence: string; idMethod: string; risk: "Low" | "Higher"; pep: string; evidence: string[] }

export interface RiskAssessment {
  job: RiskRow[];
  levelOfRisk: { value: "Low" | "Standard" | "Higher"; words: string };
  risks: RiskHeading[];
  diligence: RiskRow[];
  structure: RiskEntity[];
  owners: RiskOwner[];
  ownersNote: string | null;
  certified: string[];
  riskIdentified: string[];
  mitigating: string[];
  conclusion: string[];
  counterparty: RiskRow[];
  approvals: RiskRow[];
}

export interface RiskAssessmentKyc4u {
  status: string | null;
  at: string | null;
  recordedBy: string | null;
  // KYC4U's own reading of their report, kept on the result (shared/kyc4u-result-pack.ts kyc4uAssessmentRecord).
  assessment: null | {
    jobId?: string | null; levelOfRisk?: string | null; conclusion?: string | null;
    certified?: Array<{ name: string; qualification: string | null; organisation: string | null }>;
    approvals?: Array<{ team: string; label: string; approver: string | null; date: string | null }>;
  };
}

export interface RiskAssessmentInput {
  deal: { name: string; ref: string | null; type: string | null; property: string | null; agents: string[]; regimeWhy: string };
  // The officers do enhanced checks in-house (22 November 2026): the words name them, not KYC4U.
  inHouse?: boolean;
  party: {
    roleLabel: string;
    name: string;
    brandName: string;
    client: boolean;            // BGP acts for this party
    individual: boolean;
    trust?: boolean;
    person: { name: string } | null;
    company: PrecheckCompany | null;
    // The Charity Commission's register and the party's own GLEIF record (21 November 2026).
    charity?: CharityFacts | null;
    gleif?: string | null;
    precheckRan: boolean;
    webRan: boolean;
    flags: KycRedFlag[];        // live: set aside ones are in `aside`
    aside: SetAsideFlag[];
    level: PartyDueDiligence | null;
    people: PartyPeople | null;
    requests: Array<{
      docs?: Array<{ key: string; title: string; done: boolean }>;
      notAsked?: Array<{ key: string; reason: string }>;
      needsIdCheck?: boolean; idState?: string | null; person?: unknown; status?: string;
    }>;
    state: { status: string | null; approvedBy: string | null; approvedAt: string | Date | null; expiresAt: string | Date | null } | null;
    notRequired: { reasonWords: string } | null;
    documents: Array<{ type: string; name: string }>;
    // Our signed terms of engagement on the party's record, in words (25 November 2026).
    authorityTerms?: string | null;
    kyc4u: RiskAssessmentKyc4u | null;
    // What BGP recorded against a company abroad that owns it (21 November 2026).
    abroadRecords?: Array<{ ownerName: string; kind: string; note: string | null; personName: string | null; detail: string | null; by: string; at: string }>;
  };
  dealFlags: KycRedFlag[];
  agents: Array<{ roleWords: string; name: string; words: string }>;
  solicitors: SolicitorCheck[];
  // A letting under £10,000 a month: sanctions checks only, nothing asked of anyone.
  sanctionsOnly?: boolean;
  now?: Date;
}

const day = (v: unknown): string => {
  if (!v) return "";
  const d = new Date(v as any);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
};
const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const flagText = (f: KycRedFlag) => `${f.factor ? "Higher-risk factor" : "Red flag"}: ${f.label}`;

/** Which of the four risk headings a flag sits under. */
export function riskHeadingOf(f: Pick<KycRedFlag, "kind" | "label" | "key">): RiskHeading["factor"] {
  const words = `${f.label} ${f.key}`;
  if (f.kind === "client_pep" || f.kind === "web_pep" || f.kind === "screening") return "pep";
  if (f.kind === "provider_screen" && /\bpep\b|public role|politic/i.test(words)) return "pep";
  if (f.kind === "offshore_owner" || f.kind === "policy_country" || f.kind === "policy_cbi" || f.kind === "overseas_entity_missing") return "geographic";
  if (f.kind === "super_prime" || f.kind === "sof_mismatch" || f.kind === "third_party_payer" || f.kind === "policy_sector" || f.kind === "policy_pooled") return "other";
  return "client";
}

export function buildRiskAssessment(input: RiskAssessmentInput): RiskAssessment {
  const { party: p, deal } = input;
  const c = p.company;
  const live = [...p.flags, ...input.dealFlags];
  const level = p.level?.level || null;

  // ── The job.
  const levelOfRisk: RiskAssessment["levelOfRisk"] = level === "enhanced"
    ? { value: "Higher", words: "Higher: enhanced due diligence (BGP's AML policy)" }
    : level === "simplified" ? { value: "Low", words: "Low: simplified due diligence" }
    : { value: "Standard", words: level ? "Standard due diligence" : "Not worked out yet" };
  const job: RiskRow[] = [
    { label: "Transaction", value: `${deal.name}${deal.ref ? ` (Ref ${deal.ref})` : ""}`, tone: "info" },
    { label: "Property", value: deal.property || "Not recorded", tone: "info" },
    { label: "Party", value: `${p.roleLabel}: ${p.name}${p.brandName && p.brandName !== p.name ? ` (${p.brandName})` : ""}`, tone: "info" },
    { label: "Job type", value: p.client ? "Client: BGP acts for this party" : "Counterparty: the other side of the deal", tone: "info" },
    { label: "Work type", value: deal.type || "Not recorded", tone: "info" },
    { label: "BGP's agents", value: deal.agents.join(", ") || "Not recorded", tone: "info" },
    { label: "Checks needed", value: deal.regimeWhy, tone: "info" },
    { label: "Level of risk", value: levelOfRisk.words, tone: levelOfRisk.value === "Higher" ? "attention" : "info" },
  ];

  // ── The four risk indicators.
  const heading = (factor: RiskHeading["factor"], label: string, extra: string[] = [], none?: string): RiskHeading => {
    const mine = live.filter(f => riskHeadingOf(f) === factor);
    const details = [...mine.map(flagText), ...extra];
    return { factor, label, value: mine.length ? "Higher" : "Low", details: details.length ? details : none ? [none] : [] };
  };
  const abroad = c?.ownersAbroad || [];
  const people = p.people?.people || [];
  const screened = p.precheckRan && (p.webRan || people.length > 0);
  const risks: RiskHeading[] = [
    heading("client", "Client risk indicators", [], p.precheckRan ? "No client risk found by BGP's checks" : "BGP's checks have not run yet"),
    heading("geographic", "Geographic risk indicators",
      abroad.map(a => `Owned through ${a.name}, registered in ${a.country}${isOffshoreCountry(a.country) ? " (a secrecy or higher-risk place)" : ""}: the officers identify the owners behind it`),
      c ? "UK company, owners and directors as the register gives them" : undefined),
    heading("other", "Other risk indicators", [...(p.level?.toWeigh || []).map(t => `To weigh: ${t}`)], "None found"),
    heading("pep", "PEP involved", [], screened ? "No PEP involved: none found by the sanctions, PEP and web screening" : "Not screened yet"),
  ];

  // ── The due diligence checklist.
  const docsDone = (key: string) => p.requests.some(r => (r.docs || []).some(d => d.key === key && d.done));
  const notAsked = (key: string) => p.requests.flatMap(r => r.notAsked || []).find(n => n.key === key) || null;
  const hasDoc = (type: string) => p.documents.some(d => d.type === type);
  const structureChart: RiskRow = p.individual ? { label: "Structure chart", value: "Not applicable: a private individual", tone: "info" }
    : c?.listing && c.listedViaParent ? { label: "Structure chart", value: `Not required: owned through one company at each level by a listed company (${[c.name, ...(c.chain || [])].join(" > ")}); the officers confirm the chain`, tone: "ok" }
    : c?.listing ? { label: "Structure chart", value: "Not required: listed on a regulated market (MLR 2017 reg 28(5))", tone: "ok" }
    : docsDone("ownership") || hasDoc("structure_chart") ? { label: "Structure chart", value: "Received", tone: "ok" }
    : abroad.length ? { label: "Structure chart", value: `Needed: owned through ${abroad.map(a => `${a.name} (${a.country})`).join(" and ")}; the officers identify the owners`, tone: "attention" }
    : c?.chain?.length ? { label: "Structure chart", value: `Read from Companies House: ${[c.name, ...c.chain].join(" > ")}`, tone: "ok" }
    : c ? { label: "Structure chart", value: c.owners.length ? "Not required: a simple structure, the owners on the Companies House register" : `Not required, but the register names no owners: ${c.ownerNote || "ask who owns or controls it"}`, tone: c.owners.length ? "ok" : "attention" }
    : { label: "Structure chart", value: "Not known yet: the register has not been read", tone: "info" };
  const contact = p.person?.name || null;
  const authority: RiskRow = p.individual ? { label: "Authority to instruct", value: "Not applicable: the party deals with BGP itself", tone: "info" }
    : contact && c && isRegisterDirector(contact, c.directors) ? { label: "Authority to instruct", value: `${contact} is a director at Companies House`, tone: "ok" }
    : p.authorityTerms ? { label: "Authority to instruct", value: `Our signed terms of engagement are on file (${p.authorityTerms})`, tone: "ok" }
    : docsDone("authority") ? { label: "Authority to instruct", value: `Confirmed by the client${contact ? ` for ${contact}` : ""}`, tone: "ok" }
    : { label: "Authority to instruct", value: contact ? `Not confirmed yet for ${contact}` : "No one named to deal with BGP yet", tone: "attention" };
  const adverseLive = live.filter(f => f.kind === "web_adverse" || (f.kind === "provider_screen" && /adverse|media/i.test(`${f.label} ${f.key}`)));
  const adverseAside = p.aside.filter(a => a.flag.kind === "web_adverse");
  const adverse: RiskRow = adverseLive.length ? { label: "Adverse media (web search)", value: `Found: ${adverseLive.map(f => f.label).join("; ")}`, tone: "attention" }
    : adverseAside.length ? { label: "Adverse media (web search)", value: `Found and set aside with a comment: ${adverseAside.map(a => a.flag.label).join("; ")}`, tone: "info" }
    : p.webRan ? { label: "Adverse media (web search)", value: "No adverse media found (copies of any sources are on the KYC record)", tone: "ok" }
    : { label: "Adverse media (web search)", value: "Not searched yet", tone: "info" };
  const accounts: RiskRow = p.individual ? { label: "Financial statements", value: "Not applicable: a private individual", tone: "info" }
    : c?.accounts ? { label: "Financial statements", value: `${c.accounts}${c.documents?.some(d => d.onFile && /accounts/i.test(d.title)) ? ", downloaded from Companies House to the KYC record" : ""}`, tone: "ok" }
    : c ? { label: "Financial statements", value: "None filed at Companies House", tone: "attention" }
    : { label: "Financial statements", value: "Not read yet", tone: "info" };
  const joint = input.agents.filter(a => /joint/i.test(a.roleWords));
  const jointAgency: RiskRow = { label: "Joint agency", value: joint.length ? `Yes: ${joint.map(a => `${a.name} (${a.words})`).join("; ")}` : "No", tone: "info" };
  const onlineId = people.some(x => x.id.state === "passed") || p.requests.some(r => r.needsIdCheck && r.idState === "approved");
  const certified: RiskRow = { label: "Documents certified", value: onlineId ? "Identity checked online (Veriff, on the UK DVS register): no certified copies needed" : "No certified copies recorded", tone: "info" };
  const sof = notAsked("source_of_funds");
  const sourceOfFunds: RiskRow = docsDone("source_of_funds") ? { label: "Source of funds", value: "Received from the client", tone: "ok" }
    : sof ? { label: "Source of funds", value: `Not asked: ${sof.reason}`, tone: "info" }
    : p.requests.some(r => (r.docs || []).some(d => d.key === "source_of_funds")) ? { label: "Source of funds", value: "Asked of the client, not received yet", tone: "attention" }
    : { label: "Source of funds", value: "Not asked yet", tone: "info" };
  const trading = c?.trading || null;
  const tradingRow: RiskRow = p.individual ? { label: "Trading company", value: "Not applicable", tone: "info" }
    : trading?.words ? { label: "Trading company", value: trading.words, tone: "attention" }
    : trading?.trading ? { label: "Trading company", value: "Yes: it files trading accounts", tone: "ok" }
    : { label: "Trading company", value: "Not shown yet", tone: "info" };
  const nonTrading: RiskRow = { label: "Non-trading risk", value: trading?.words ? "To weigh: is this the company doing the deal, and is it funded for it?" : "Low", tone: trading?.words ? "attention" : "info" };
  // Another firm's checks BGP relies on (MLR 2017 reg 39; 21 November 2026).
  const relied = p.people?.reliance || null;
  const reliance: RiskRow[] = relied ? [{
    label: "Reliance on another firm (MLR 2017 reg 39)",
    value: `${relied.words}. Recorded by ${relied.by}, ${day(relied.at)}. ${relied.note} BGP stays responsible for the checks and can ask the firm for copies of its documents at once.`,
    tone: "info",
  }] : [];
  const diligence = [structureChart, authority, adverse, accounts, jointAgency, certified, sourceOfFunds, tradingRow, nonTrading, ...reliance];

  // ── The structure and its evidence.
  const structure: RiskEntity[] = [];
  if (c) {
    structure.push({
      name: `${c.name} (${c.number})`, location: /^OE/i.test(c.number) ? "Overseas entity" : "UK", countryRisk: "Standard", orgType: c.type || "Company",
      evidence: [
        c.incorporatedOn ? `Incorporated ${c.incorporatedOn}` : "",
        c.business?.length ? `Business: ${c.business.join("; ")}` : "",
        c.listing ? `${c.listing}${c.listingNote ? `. ${c.listingNote}` : ""}` : "",
        c.owners?.length ? `Owners on the register: ${c.owners.map(o => `${o.name} (${o.control})`).join("; ")}` : c.ownerNote ? `Owners: ${c.ownerNote}` : "",
        c.accounts ? `Latest accounts: ${c.accounts}` : "",
        ...(c.trace || []).filter(l => l.startsWith("The accounts")),
        c.gleif || "",
        ...(c.warnings || []).map(w => `Warning: ${w}`),
        `Companies House register: ${c.registerUrl}`,
      ].filter(Boolean),
    });
    for (const link of c.chain || []) structure.push({ name: link, location: "UK", countryRisk: "Standard", orgType: "Company up the ownership chain", evidence: ["Read from Companies House's register of people with significant control"] });
    // What the app traced and BGP recorded for each (21 November 2026).
    const recs = p.abroadRecords || [];
    for (const a of abroad) {
      const mine = recs.filter(r => sameCompany(r.ownerName, a.name));
      structure.push({
        name: a.name, location: a.country, countryRisk: isOffshoreCountry(a.country) ? "Higher (secrecy or higher-risk place)" : "Standard", orgType: "Company registered abroad",
        evidence: [
          a.via === "accounts" ? `Named in ${c.name}'s accounts as its parent (the register names no owner)` : `Owns ${a.foundAt || c.name}`,
          ...(c.trace || []).filter(l => l.startsWith("GLEIF:") && l.includes(a.name)),
          ...mine.filter(r => r.kind === "person" && r.personName).map(r => `Recorded behind it: ${r.personName}${r.detail ? ` (${r.detail})` : ""}, by ${r.by}, ${day(r.at)}`),
          ...mine.filter(r => r.kind === "register_page" || r.kind === "document").map(r => `${r.kind === "register_page" ? "Its register page, copied to PDF" : "A register extract"}, filed by ${r.by}, ${day(r.at)}`),
          ...mine.filter(r => r.kind === "note" && r.note).map(r => `Note by ${r.by}, ${day(r.at)}: ${r.note}`),
          "Registered abroad: Companies House cannot show who owns it. The officers identify the owners from its home register",
        ],
      });
    }
  }

  // The charity the party is, or acts for as its trustee (21 November 2026).
  const ch = p.charity && p.charity.state === "found" ? p.charity : null;
  if (ch) {
    structure.push({
      name: `${ch.name} (charity ${ch.number})`, location: "UK (England and Wales)", countryRisk: "Standard", orgType: ch.kind ? ch.kind[0].toUpperCase() + ch.kind.slice(1) : "Registered charity",
      evidence: [
        ch.actsAsTrustee || "",
        `${ch.status || "Registered"}${ch.registeredOn ? `, registered ${ch.registeredOn}` : ""}`,
        ch.accounts ? `Latest accounts: ${ch.accounts}` : "",
        ch.trustees.length ? `Trustees on the register: ${ch.trustees.map(t => `${t.name}${t.chair ? " (chair)" : ""}`).join(", ")}` : "The register lists no trustees",
        ...ch.warnings.map(w => `Warning: ${w}`),
        ch.registerUrl ? `Register of charities: ${ch.registerUrl}` : "",
        CHARITY_ATTRIBUTION,
      ].filter(Boolean),
    });
  } else if (!c && p.gleif) {
    structure.push({ name: p.name, location: "Not on Companies House", countryRisk: "Standard", orgType: p.trust ? "Trust or foundation" : "Company", evidence: [p.gleif] });
  }

  // ── The beneficial owners and how each was verified.
  const flagged = (name: string) => live.some(f => f.label.toLowerCase().includes(name.toLowerCase()));
  const pepFor = (name: string) => live.some(f => riskHeadingOf(f) === "pep" && f.label.toLowerCase().includes(name.toLowerCase()));
  const ownerRows = people.filter(x => p.individual || x.roles.includes("owner"));
  const owners: RiskOwner[] = ownerRows.map(x => {
    const reg = c?.ownerDetails?.find(o => personNamesMatch(o.name, x.name)) || null;
    const idMethod = x.publicFigure ? x.publicFigure.method === "certified" ? `Certified documents: accepted by ${x.publicFigure.by}, ${day(x.publicFigure.at)}` : `Public figure: verified from public sources by ${x.publicFigure.by}, ${day(x.publicFigure.at)}`
      : x.reliedOn ? `Checked by ${relied?.firm || "another firm"}, relied on under MLR 2017 reg 39`
      : x.id.state === "passed" ? "Online identity check (Veriff)"
      : x.id.state === "waiting" ? "Online identity check done, waiting for Veriff's result"
      : x.id.state === "document" ? "Photo ID sent, for the Nominated Officer to check"
      : "Not verified yet";
    return {
      name: x.name,
      nationality: reg?.nationality || "Not given",
      residence: reg?.residence || "Not given",
      idMethod,
      risk: flagged(x.name) ? "Higher" : "Low",
      pep: pepFor(x.name) ? "Possible: see the red flags" : screened ? "No" : "Not screened yet",
      evidence: [
        x.ownerDetail ? cap(x.ownerDetail) : "",
        x.born ? `Born ${x.born}` : "",
        x.publicFigure ? `${x.publicFigure.method === "certified" ? "Certified documents" : "Public sources"}: ${x.publicFigure.note}` : "",
        x.address.done ? `Proof of address: ${x.address.proof?.summary || (x.address.fromLicence ? `the driving licence their identity check read (${x.address.fromLicence})` : "received")}`
          : x.publicFigure || x.reliedOn || x.address.notNeeded ? "" : "Proof of address not received yet",
        `Sanctions: ${x.sanctions === "clear" ? "no match" : x.sanctions === "discounted" ? "a namesake, set aside on the date of birth" : x.sanctions === "possible" ? "possible match: see the red flags" : "not screened yet"}`,
        reg && reg.name !== x.name ? `On the register as ${reg.name}` : "",
      ].filter(Boolean),
    };
  });
  const ownersNote = p.individual ? "A private individual: the people named on the transaction."
    : c?.listing && c.listedViaParent ? "Owned through a listed company: no individual owners to identify, the owner is the listed company. Standard due diligence (BGP's policy); the officers confirm the chain."
    : c?.listing ? "Listed on a regulated market: no beneficial owners to identify (MLR 2017 reg 28(5))."
    : abroad.length && !ownerRows.length ? "The owners are behind a company registered abroad: the officers identify them."
    : !ownerRows.length ? (c ? "The register names no person who owns or controls the company." : "Not known yet: the register has not been read.")
    : null;

  // ── Certified documents (KYC4U's, when their report lists them).
  const certifiedList = (p.kyc4u?.assessment?.certified || []).map(x => [x.name, x.qualification, x.organisation].filter(Boolean).join(", "));

  // ── Risk identified, mitigating factors, conclusion.
  const outstanding = p.people?.outstanding || [];
  const riskIdentified = [...live.map(flagText), ...(trading?.words ? [`To weigh: ${trading.words}`] : []), ...abroad.map(a => `Owned through a company registered abroad: ${a.name} (${a.country})`)];
  const mitigating = [
    ...p.aside.map(a => `${a.flag.label}: set aside by ${a.review.by || "an officer"}${a.review.at ? ` on ${day(a.review.at)}` : ""}: "${a.review.comment}"`),
    ...(c?.listing ? [c.listedViaParent ? `${c.listing}: no individual owners to identify` : "Listed on a regulated market: simplified due diligence may apply (MLR 2017 reg 37)"] : []),
    ...people.filter(x => x.publicFigure).map(x => `${x.name} ${x.publicFigure!.method === "certified" ? "verified from certified documents" : "verified from public sources"} by ${x.publicFigure!.by}`),
    ...(relied ? [`${relied.words}: the firm's checks are relied on under MLR 2017 reg 39`] : []),
    ...(p.kyc4u?.assessment?.levelOfRisk ? [`KYC4U rated the party ${p.kyc4u.assessment.levelOfRisk.toLowerCase()} risk${p.kyc4u.assessment.jobId ? ` (${p.kyc4u.assessment.jobId})` : ""}`] : []),
  ];
  const status = String(p.state?.status || "").toLowerCase();
  const approvedNow = status === "approved" && !(p.state?.expiresAt && new Date(p.state.expiresAt as any).getTime() < (input.now || new Date()).getTime());
  const conclusion: string[] = [];
  if (p.notRequired) conclusion.push(`No checks are needed on this party: ${p.notRequired.reasonWords}.`);
  else if (status === "rejected") conclusion.push("Rejected: BGP does not go ahead with this party unless the Nominated Officer says otherwise.");
  else if (approvedNow) conclusion.push(`Approved${p.state?.approvedBy ? ` by ${p.state.approvedBy}` : ""}${p.state?.approvedAt ? ` on ${day(p.state.approvedAt)}` : ""}${p.state?.expiresAt ? `, valid until ${day(p.state.expiresAt)}` : ""}.`);
  else if (live.length || p.trust) conclusion.push(`Higher risk: ${live.length ? `${live.length} red flag${live.length === 1 ? "" : "s"} or higher-risk factor${live.length === 1 ? "" : "s"}` : "a trust"}. Enhanced due diligence: ${(input.inHouse !== false) ? "the Nominated Officer or a Deputy reviews the checks and signs it off." : "KYC4U's checks, and the Nominated Officer or a Deputy approves the result."}`);
  else if (abroad.length) conclusion.push((input.inHouse !== false) ? "Owned through a company registered abroad: the officers identify the people behind it, then the Nominated Officer or a Deputy signs it off." : "Owned through a company registered abroad: it goes to KYC4U to identify the owners; the Nominated Officer or a Deputy adds KYC4U's result.");
  else if (outstanding.length) conclusion.push(`Not concluded: still to come: ${outstanding.join("; ")}.`);
  else if (!p.precheckRan) conclusion.push("Not concluded: BGP's checks before asking have not run.");
  // Nothing asked of anyone yet (24 November 2026, Vodafone #4664 read "the
  // checks asked for are in" when no one had been asked anything).
  else if (!input.sanctionsOnly && !p.individual && !contact && !p.requests.length) conclusion.push("Not concluded: no one is named yet who acts for the company with BGP. Name them, then send them the client checks (their identity and their authority to act).");
  else if (!input.sanctionsOnly && !p.requests.length) conclusion.push("No higher-risk factors identified so far. The client checks have not been sent yet.");
  else conclusion.push(input.sanctionsOnly
    ? "Lower risk: a letting under £10,000 a month, sanctions checks only, and no possible sanctions match; ready for sign-off."
    : "Lower risk: no higher-risk factors identified and the checks asked for are in; ready for sign-off.");
  if (p.kyc4u?.assessment?.conclusion) conclusion.push(`KYC4U's conclusion${p.kyc4u.assessment.jobId ? ` (${p.kyc4u.assessment.jobId})` : ""}: ${p.kyc4u.assessment.conclusion}`);

  // ── The counterparty's agent and solicitors.
  const others = input.agents;
  const counterparty: RiskRow[] = [
    { label: "Agents on the transaction", value: others.length ? others.map(a => `${a.roleWords}: ${a.name}`).join("; ") : "None recorded on the deal", tone: "info" },
    { label: "Agents' HMRC registration", value: others.length ? others.map(a => `${a.name}: ${a.words}`).join("; ") : "Not applicable", tone: others.some(a => /not on|not registered|expired/i.test(a.words)) ? "attention" : "info" },
    // Our client's solicitors and the other side's, each checked at the SRA (Woody, 23 November 2026).
    ...SOLICITOR_SIDES.flatMap(side => {
      const mine = input.solicitors.filter(sc => (sc.side || "other") === side);
      return mine.length
        ? mine.map(sc => { const w = solicitorCheckWords(sc); return { label: SOLICITOR_SIDE_WORDS[side], value: `${w.words} (checked ${day(sc.ranAt)})`, tone: w.tone }; })
        : [{ label: SOLICITOR_SIDE_WORDS[side], value: "Not checked yet: check them under Solicitors in the AML box", tone: "attention" as const }];
    }),
    // The SRA's terms: where its data is used, say so with a link to its attribution statement.
    ...(input.solicitors.some(sc => sc.register.source === "sra_data")
      ? [{ label: "Source of the SRA data", value: `${SRA_ATTRIBUTION_WORDS} (${SRA_ATTRIBUTION_URL})`, tone: "info" as const }]
      : []),
    { label: "Lender", value: "Not recorded in the app: if a bank lends on the deal, BGP's AML policy asks for checks on the lender", tone: "info" },
  ];

  // ── Approvals.
  const k = p.kyc4u;
  const kyc4uApproval = k?.assessment?.approvals?.find(a => a.team === "kyc4u") || null;
  const approvals: RiskRow[] = [
    ...((input.inHouse !== false) && !k ? [] : [{ label: "KYC4U internal approval", value: kyc4uApproval?.date ? `${kyc4uApproval.approver || "KYC4U"}, ${day(kyc4uApproval.date)}` : k?.status ? `${k.status}${k.at ? `, ${day(k.at)}` : ""}` : "Not raised with KYC4U", tone: "info" as const }]),
    {
      label: "Approved on the file",
      value: !approvedNow ? (status === "rejected" ? "Rejected" : "Not approved yet")
        : /kyc4u/i.test(p.state?.approvedBy || "") && k?.recordedBy ? `KYC4U's result, recorded in the app by ${k.recordedBy}${p.state?.approvedAt ? ` (dated ${day(p.state.approvedAt)})` : ""}`
        : `${p.state?.approvedBy || "Approved"}${p.state?.approvedAt ? `, ${day(p.state.approvedAt)}` : ""}`,
      tone: approvedNow ? "ok" : "info",
    },
    // An in-house sign-off by an officer is the approval (22 November 2026); until then it is needed.
    {
      label: "Nominated Officer approval (higher risk)",
      value: level !== "enhanced" ? "Not needed: not a higher-risk party"
        : k?.recordedBy ? `KYC4U's result recorded by ${k.recordedBy}${k.at ? `, ${day(k.at)}` : ""}`
        : approvedNow ? `Signed off by ${p.state?.approvedBy || "an officer"}${p.state?.approvedAt ? `, ${day(p.state.approvedAt)}` : ""}`
        : "Needed: the party needs enhanced due diligence",
      tone: level === "enhanced" && !k?.recordedBy && !approvedNow ? "attention" : "info",
    },
  ];

  return { job, levelOfRisk, risks, diligence, structure, owners, ownersNote, certified: certifiedList, riskIdentified, mitigating, conclusion, counterparty, approvals };
}
