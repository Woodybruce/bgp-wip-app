import type { LandlordCovenantReport, LandlordCovenantEvidence } from "../shared/landlord-covenant";
import type { CovenantReport } from "./covenant-engine";

export type LandlordCovenantCompanyContext = {
  name: string;
  industry?: string | null;
  backers?: string | null;
  parent_name?: string | null;
  parent_number?: string | null;
  parent_report?: CovenantReport | null;
};
type Overview = NonNullable<LandlordCovenantReport["overview"]>;
const AEW_ACCOUNTS = "https://find-and-update.company-information.service.gov.uk/company/OC367686/filing-history/MzUyMDQ4MzQxN2FkaXF6a2N4/document?format=pdf&download=0";

// Manually reviewed primary evidence. Figures are in GBP (the filed statements
// use £'000). This is a dated operating-company view, not a replacement for the
// account's saved legal identity, the shared score or the KYC/billing record.
const reviewedOperatingEvidence = {
  "OC367686": {
    companyName: "AEW UK Investment Management LLP",
    companyNumber: "OC367686",
    period: "31 December 2025",
    title: "Positive net assets, with group support for a loss-making UK business.",
    company: "AEW UK Investment Management LLP reported £10.7m net assets and £8.8m cash at December 2025, alongside a £1.4m annual loss. The balance sheet is positive, but the business remains dependent on group support while it is loss-making.",
    group: "AEW sits within Natixis Investment Managers and ultimately Groupe BPCE. The UK accounts record financial support from AEW SA and sufficient forecast working capital for the 12 months from their approval on 24 April 2026.",
    facts: [
      { label: "Net assets", value: "£10.707m" },
      { label: "Cash", value: "£8.782m" },
      { label: "Net current assets", value: "£8.949m" },
      { label: "Annual loss", value: "£1.407m" },
    ],
    evidence: [
      { text: "Audited accounts for the year ended 31 December 2025, filed 11 May 2026. Balance sheet: printed page 9; loss: page 8. The members’ report expects further losses and continued group support (page 2).", sourceLabel: "2025 audited UK accounts", sourceUrl: AEW_ACCOUNTS, reviewedAt: "2026-10-27" },
      { text: "The going-concern note records AEW SA’s financial support and forecasts covering the 12 months from accounts approval (page 12). The immediate parents each own 50%; the ultimate parent is Groupe BPCE (page 18).", sourceLabel: "Going concern and parent undertaking", sourceUrl: AEW_ACCOUNTS, reviewedAt: "2026-10-27" },
      { text: "AEW’s legal information identifies the UK operating company as OC367686 and describes the Natixis Investment Managers / Groupe BPCE ownership chain.", sourceLabel: "AEW legal information", sourceUrl: "https://www.aew.com/legal", reviewedAt: "2026-10-27" },
    ] satisfies LandlordCovenantEvidence[],
  },
};

export function reviewedOperatingCompanyNumber(savedNumber: string | null): string | null {
  return savedNumber === "OC342015" || savedNumber === "OC367686" ? "OC367686" : null;
}

function factValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(value);
  return typeof value === "string" && value.trim() && !/^(?:n\/?a|unknown|not (?:available|recorded|disclosed))\.?$/i.test(value.trim()) ? value.trim() : null;
}
// Only unambiguous GBP amounts inform a headline; narrative extraction or
// mixed currencies remain quoted facts, not inputs to a fresh credit score.
function gbpAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\()?(-)?£\s*([\d,]+(?:\.\d+)?)\s*(m|million|k|thousand)?(\))?$/i);
  if (!match || Boolean(match[1]) !== Boolean(match[5])) return null;
  return Number(match[3].replace(/,/g, "")) * (/^m/i.test(match[4] || "") ? 1_000_000 : /^(?:k|thousand)$/i.test(match[4] || "") ? 1_000 : 1) * (match[1] || match[2] ? -1 : 1);
}
function financialFacts(financial: LandlordCovenantReport["financial"]): Array<{ label: string; value: string }> {
  return ([ ["Net assets", financial?.netAssets], ["Cash", financial?.cash], ["Profit / loss before tax", financial?.profitBeforeTax] ] as const)
    .flatMap(([label, value]) => { const text = factValue(value); return text ? [{ label, value: text }] : []; });
}
function materialWarning(report?: LandlordCovenantReport): Overview["warning"] {
  if (!report) return;
  const { kind, title, summary } = report.interpretation;
  if (kind === "creditor-process" || kind === "mixed-history") return { title: `${report.companyName}: ${title.toLowerCase()}`, summary };
  if (kind === "unknown" && /liquidation|administration|receiver|insolvency|arrangement/i.test(report.status)) return { title: `${report.companyName}: proceedings need checking`, summary: `The saved status is ${report.status}, but the current case details could not be confirmed.` };
  // Retain material financial/Gazette warnings even where the insolvency API
  // returns no cases (for example a petition or negative equity).
  const red = report.assessment?.flags.filter(flag => flag.level === "red") || [];
  if (red.length) return { title: `${report.companyName}: financial concerns recorded`, summary: red.map(flag => flag.detail || flag.label).join(" ") };
}

/** Company/group context is separate from the exact legal-entity check. */
export function buildLandlordCovenantOverview(company: LandlordCovenantCompanyContext, legal: LandlordCovenantReport, operating?: LandlordCovenantReport): Overview {
  const operatingNumber = reviewedOperatingCompanyNumber(legal.companyNumber);
  const reviewed = operatingNumber ? reviewedOperatingEvidence[operatingNumber as keyof typeof reviewedOperatingEvidence] : undefined;
  if (reviewed) {
    const result: Overview = {
      title: reviewed.title, company: reviewed.company, group: reviewed.group,
      financial: { companyName: reviewed.companyName, companyNumber: reviewed.companyNumber, period: reviewed.period, facts: reviewed.facts },
      evidence: [...reviewed.evidence],
      limitations: ["The financial support described in the accounts is not evidence of a guarantee covering BGP’s particular contract.", "Financial figures are for the UK operating company, not consolidated group assets or assets under management."],
      warning: materialWarning(operating) || materialWarning(legal),
    };
    if (legal.companyNumber !== operatingNumber) {
      result.entityNote = legal.interpretation.kind === "members-voluntary-liquidation"
        ? "The saved AEW Europe LLP is the former operating company, now in a solvent winding-up following the business transfer."
        : "The saved account entity is AEW Europe LLP; the financial summary above concerns the separate UK operating company.";
    }
    if (operating?.interpretation.kind === "members-voluntary-liquidation") result.warning = { title: "The UK operating company is now in a solvent winding-up", summary: operating.interpretation.summary };
    if (result.warning) result.title = "Company and group financial context.";
    if (!operating || operating.interpretation.kind === "unknown") result.limitations.push("The current UK operating company’s insolvency check is unavailable; the accounts above remain a dated financial view.");
    if (operating?.sourceUrl) result.evidence.push({ text: operating.interpretation.summary, sourceLabel: `Operating company register · ${operating.companyNumber}`, sourceUrl: operating.sourceUrl, reviewedAt: operating.checkedAt.slice(0, 10) });
    return result;
  }

  const facts = financialFacts(legal.financial);
  const period = legal.financial?.period || "latest accounts on file";
  const subject = legal.companyName || company.name;
  const netAssets = gbpAmount(legal.financial?.netAssets);
  const profit = gbpAmount(legal.financial?.profitBeforeTax);
  const headline = netAssets !== null && netAssets < 0 ? "Net liabilities require a closer covenant review."
    : profit !== null && profit < 0 ? "The latest accounts report a loss."
    : netAssets !== null && netAssets > 0 ? "Positive net assets in the latest accounts."
    : facts.length ? "Company financial position and group context." : "Company and group covenant.";
  const result: Overview = {
    title: headline,
    company: facts.length
      ? `${subject} reports ${facts.map(fact => `${fact.value} ${fact.label.toLowerCase()}`).join(", ")} (${period}).`
      : `Financial accounts have not yet been recorded for ${subject}.`,
    evidence: [], limitations: [], warning: materialWarning(legal),
  };
  if (legal.companyNumber && facts.length) {
    result.financial = { companyName: subject, companyNumber: legal.companyNumber, period, facts };
    result.evidence.push({ text: "Financial figures held in the existing company covenant report; review the filed accounts for their full context.", sourceLabel: `${subject} · filings`, sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${legal.companyNumber}/filing-history`, reviewedAt: legal.assessment?.computedAt?.slice(0, 10) || legal.checkedAt.slice(0, 10) });
  }
  const group = company.parent_name || company.backers;
  if (group) {
    result.group = `The CRM records ${group} as ${company.parent_name ? "the parent company" : "the backer"}.`;
    const parentReport = company.parent_report;
    // Do not conflate the subsidiary's assets or score with the parent's.
    if (parentReport && company.parent_number && parentReport.companyNumber === company.parent_number) {
      const parentFacts = financialFacts(parentReport.signals?.accounts);
      if (parentFacts.length) result.group += ` Its separate accounts (${parentReport.signals?.accounts?.period || "period not recorded"}) report ${parentFacts.map(fact => `${fact.value} ${fact.label.toLowerCase()}`).join(", ")}.`;
      result.evidence.push({ text: `Separate parent-company report for ${parentReport.companyName}; these figures are not added to the landlord’s balance sheet.`, sourceLabel: "Parent company filings", sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${company.parent_number}/filing-history`, reviewedAt: parentReport.computedAt.slice(0, 10) });
    }
    result.group += " No support commitment or guarantee is recorded.";
  }
  if (legal.interpretation.kind === "members-voluntary-liquidation") result.entityNote = `${subject} is in a members’ voluntary liquidation, a solvent winding-up procedure. The figures above belong to that entity.`;
  else if (legal.interpretation.kind === "unlinked") result.entityNote = "Confirm the contracting legal entity to complete the financial check.";
  else if (legal.interpretation.kind === "unknown" && !result.warning) result.entityNote = "The current legal-entity check is incomplete.";
  if (legal.interpretation.kind === "members-voluntary-liquidation") result.title = "Financial position of the company being wound up.";
  if (result.warning) result.title = "Company and group financial context.";
  return result;
}
