type ComplianceCompany = {
  uk_entity_name?: string | null;
  companies_house_number?: string | null;
  companies_house_data?: { profile?: { companyName?: string; company_name?: string; companyNumber?: string; company_number?: string } } | null;
  kyc_status?: string | null;
  kyc_expires_at?: string | Date | null;
  aml_pep_status?: string | null;
};

function legalName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\b(limited|ltd)\b/g, "limited").replace(/\s+/g, " ");
}

/** Reports recorded review state; collected documents never establish approval. */
export function brandComplianceStatus(company: ComplianceCompany, missing: string[], now = new Date()) {
  const profile = company.companies_house_data?.profile;
  const registeredName = profile?.companyName || profile?.company_name || "";
  const registeredNumber = profile?.companyNumber || profile?.company_number || "";
  const entity = company.uk_entity_name?.trim() || "";
  const number = company.companies_house_number?.replace(/\s/g, "").toUpperCase() || "";
  const identityIssues: string[] = [];
  if (entity && registeredName && legalName(entity) !== legalName(registeredName)) {
    identityIssues.push(`Recorded trading entity: ${entity}. Companies House record: ${registeredName}. Confirm which legal entity applies.`);
  }
  if (number && registeredNumber && number !== registeredNumber.replace(/\s/g, "").toUpperCase()) {
    identityIssues.push("The saved company number differs from the Companies House profile. Review the linked record.");
  }
  const state = company.kyc_status?.trim().toLowerCase();
  const expiry = company.kyc_expires_at ? new Date(company.kyc_expires_at).getTime() : null;
  const expired = expiry !== null && Number.isFinite(expiry) && expiry <= now.getTime();
  const screening = company.aml_pep_status?.trim().toLowerCase();
  const screeningReview = screening === "review_required" || screening === "potential_match" || screening === "strong_match";
  let label: string;
  if (state === "rejected") label = "KYC rejected — review the recorded decision";
  else if (identityIssues.length) label = "Legal entity needs review";
  else if (expired) label = "KYC review expired";
  else if (screeningReview) label = "Screening results need review";
  else if (state === "approved") label = expiry === null || !Number.isFinite(expiry)
    ? "KYC approval recorded — review date not set" : "KYC approval recorded";
  else if (missing.length) label = "Checks still to collect";
  else label = "Checks collected — approval not recorded";
  return { label, identityIssues, missing, recordedApproval: state === "approved" && !expired && !identityIssues.length && !screeningReview };
}
