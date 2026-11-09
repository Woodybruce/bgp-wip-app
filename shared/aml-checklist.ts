// The MLR 2017 CDD checklist — ONE definition for server and client.
//
// A counterparty is either a company (Companies House entity) or an
// individual (private landlord, sole trader). Items that can't apply are
// not required rather than silently ticked: company certificate / beneficial
// owners / PSC register don't apply to a person, and source of wealth / EDD
// sign-off only apply when EDD is required (Reg 33/35).

export type AmlSubjectType = "company" | "individual";

export const AML_CHECKLIST = [
  { id: "id_verified", label: "Identity verified (passport / driving licence / Veriff)", group: "CDD", reg: "Reg 28(2)" },
  { id: "address_verified", label: "Address verified (utility / bank statement / Veriff)", group: "CDD", reg: "Reg 28(2)" },
  { id: "company_cert", label: "Company identified on Companies House", group: "CDD", reg: "Reg 28(3)", companyOnly: true },
  { id: "ubo_identified", label: "Beneficial owners (over 25%) identified", group: "CDD", reg: "Reg 28(4)", companyOnly: true },
  { id: "ubo_verified", label: "Beneficial owners verified — not from the PSC register alone", group: "CDD", reg: "Reg 28(9)", companyOnly: true },
  { id: "psc_register_checked", label: "PSC register checked against what the customer told us (discrepancies reported)", group: "CDD", reg: "Reg 30A", companyOnly: true },
  { id: "sof_evidenced", label: "Source of funds evidenced", group: "CDD", reg: "Reg 28(11)" },
  { id: "sow_evidenced", label: "Source of wealth evidenced", group: "EDD", reg: "Reg 35", eddOnly: true },
  { id: "sanctions_clear", label: "Sanctions screening — no match (UK list)", group: "Screening", reg: "SAMLA 2018" },
  { id: "pep_checked", label: "PEP screening completed (PEP database, not the sanctions list)", group: "Screening", reg: "Reg 35" },
  { id: "adverse_media", label: "Adverse media check completed", group: "Screening", reg: "Reg 28(12)" },
  { id: "edd_complete", label: "Enhanced due diligence complete", group: "EDD", reg: "Reg 33", eddOnly: true },
  { id: "risk_assessed", label: "Customer risk rating assigned", group: "Risk", reg: "Reg 28(12)" },
  { id: "mlro_review", label: "Nominated Officer has reviewed the file (higher-risk clients)", group: "Sign-off", reg: "Reg 21 / 35", mlroOnly: true, highRiskOnly: true },
] as const;

export type AmlChecklistKey = (typeof AML_CHECKLIST)[number]["id"];
export const AML_CHECKLIST_KEYS = AML_CHECKLIST.map(i => i.id) as AmlChecklistKey[];
/** Items only the MLRO may tick or untick. */
export const MLRO_ONLY_ITEMS = new Set<string>(["mlro_review", "edd_complete"]);

/**
 * Higher risk = needs the Nominated Officer as well as the fee earner (the
 * two sign-off lines on the KYC4U form BGP used until Sept 2026): a high /
 * critical risk rating, EDD triggered, or any PEP result (Reg 35(5) requires
 * senior-management approval for PEP relationships).
 */
export function isHigherRisk(file: { aml_risk_level?: string | null; aml_edd_required?: boolean | null; aml_pep_status?: string | null; aml_cdd_form?: { riskFactors?: Record<string, string | undefined> } | null } | null | undefined): boolean {
  const factors = Object.values(file?.aml_cdd_form?.riskFactors || {});
  return /^(high|critical)$/i.test(String(file?.aml_risk_level || "")) || !!file?.aml_edd_required || /^pep|rca|review_required/i.test(String(file?.aml_pep_status || ""))
    || factors.some(v => v === "high");
}

/** Which items this counterparty needs. */
export function requiredAmlItems(subject: AmlSubjectType | string | null | undefined, eddRequired: boolean | null | undefined, higherRisk: boolean = !!eddRequired) {
  const individual = subject === "individual";
  return AML_CHECKLIST.filter(i => !(individual && "companyOnly" in i && i.companyOnly) && !(!eddRequired && "eddOnly" in i && i.eddOnly)
    && !(!higherRisk && "highRiskOnly" in i && i.highRiskOnly));
}

/** Outstanding required items, given the stored checklist. */
export function outstandingAmlItems(checklist: Record<string, { ticked?: boolean } | undefined> | null | undefined,
  subject: AmlSubjectType | string | null | undefined, eddRequired: boolean | null | undefined, higherRisk: boolean = !!eddRequired) {
  return requiredAmlItems(subject, eddRequired, higherRisk).filter(i => !checklist?.[i.id]?.ticked);
}
