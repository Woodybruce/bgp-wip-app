export type EvidenceScheduleRow = {
  id: string;
  property_id?: string | null;
  unit_number?: string | null;
  [key: string]: unknown;
};

export type EvidenceScheduleUnit = {
  unit_ref?: string | null;
  tenant_name?: string | null;
  tenancy_unit_id?: unknown;
  property_id?: string | null;
};

export type EvidenceScheduleConflict = { field: string; label: string; values: unknown[] };
export type EvidenceScheduleClassification<T extends EvidenceScheduleRow = EvidenceScheduleRow> = {
  status: "none" | "single" | "equivalent" | "conflicting";
  row: T | null;
  candidateIds: string[];
  equivalentDuplicateIds: string[];
  conflicts: EvidenceScheduleConflict[];
};
export type EvidenceScheduleMatch<T extends EvidenceScheduleRow = EvidenceScheduleRow> = {
  row: T | null;
  method: "explicit" | "ref" | "alias" | "tenant" | null;
  status: "matched" | "ambiguous" | "unmatched" | "stale-link";
  candidateIds: string[];
  equivalentDuplicateIds: string[];
  conflicts: EvidenceScheduleConflict[];
  reason: string;
};

const numberFields = ["term_years", "nia_sqft", "gia_sqft", "itza_sqft", "units_applied",
  "area_basement_gia", "area_ground_gia", "area_first_gia", "area_other_gia", "area_basement_nia",
  "area_ground_nia", "area_first_nia", "area_first_sales_nia", "area_other_nia", "area_ground_itza",
  "passing_rent_pa", "marketing_rent_pa", "turnover_rent_payable", "erv_pa", "rent_free_value",
  "capex_value", "deposit_held", "arrears_balance", "rateable_value", "rates_payable", "service_charge",
  "service_charge_cap", "insurance", "rental_shortfalls", "topped_up_noi", "noi_pa",
  "unexpired_term_break", "unexpired_term", "rent_psf", "turnover_percent", "blended_erv",
  "area_basement", "area_ground", "area_first", "area_second", "area_other", "landlord_shortfall",
  "net_income", "total_occ_costs", "occ_costs_psf", "wault_rent_percent",
  "rent_review_1_amount", "rent_review_2_amount", "rent_review_3_amount", "rent_review_4_amount"] as const;
const dateFields = ["lease_start", "lease_expiry", "break_date", "landlord_break_date", "next_review_date",
  "rent_review_1_date", "rent_review_2_date", "rent_review_3_date", "rent_review_4_date"] as const;
const textFields = ["tenant_name", "trading_name", "tenant_company_id", "grouping", "floor_level", "permitted_use", "status",
  "break_details", "break_notice", "break_type", "outside_lt_act", "measurement_type", "shortfall_liability",
  "am_initiative", "tenant_mix", "erv_profile", "comments", "leasing_comments", "target_tenants",
  "underwriting_comments", "epc_rating", "credit_rating", "deal_id", "letting_tracker_unit_id",
  "property_unit_id", "occupancy_status", "marketing_reason"] as const;
const booleanFields = ["in_leasing_schedule", "marketing_active"] as const;
const arrayFields = ["target_company_ids"] as const;

// Fetch these alongside the row identity before calling the duplicate classifier.
// Import timestamps and a missing source-system premises ID do not choose a winner.
export const EVIDENCE_SCHEDULE_COMPARISON_FIELDS = [...textFields, ...numberFields, ...dateFields, ...booleanFields, ...arrayFields] as const;

const absent = (value: unknown) => value === undefined || value === null || typeof value === "string" && !value.trim();
const cleanText = (value: unknown) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");

export function normalizeEvidenceTenantName(value: unknown): string {
  return cleanText(value).normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase().replace(/&/g, " AND ")
    .replace(/\b(?:LIMITED|LTD|PLC|LLP|INC)\.?\s*$/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

type Reference = { exact: string; alias: string | null; explicit: boolean };

function reference(raw: unknown): Reference {
  let value = cleanText(raw).toUpperCase().replace(/[‐‑‒–—−]/g, "-").replace(/\s*([/&,-])\s*/g, "$1");
  if (!value) return { exact: "", alias: null, explicit: false };
  let kind = "UNIT";
  const prefix = /^(UNITS?|SHOPS?|STORES?|KIOSKS?)\s+/.exec(value);
  if (prefix) {
    kind = prefix[1].startsWith("STORE") ? "STORE" : prefix[1].startsWith("KIOSK") ? "KIOSK" : "UNIT";
    value = value.slice(prefix[0].length);
  }
  // A Store A anchor is not Unit A. K17 and Kiosk K17 are the same explicit code;
  // do not extend this to fuzzy names or numbers embedded in descriptive labels.
  if (/^K\d+[A-Z]?(?:$|[/,&-])/.test(value) && kind === "UNIT") kind = "KIOSK";
  if (kind === "KIOSK" && /^\d+[A-Z]?$/.test(value)) value = `K${value}`;
  value = value.replace(/\bAND\b/g, "&").replace(/\s*([/&,-])\s*/g, "$1");
  const explicit = !!prefix || /\d/.test(value) || /^[A-Z]$/.test(value);
  if (!explicit) return { exact: `NAME:${value}`, alias: null, explicit: false };
  const compact = value.replace(/([A-Z]+)0+(\d)/g, "$1$2");
  const exact = `${kind}:${compact}`;
  if (!/^[A-Z0-9/&,-]+(?:\s+[A-Z0-9/&,-]+)*$/.test(compact)) return { exact, alias: null, explicit };
  const parts = compact.split(/[/,&]|\s+/).filter(Boolean);
  const expanded: string[] = [];
  let inherited = "";
  const atom = (text: string): { prefix: string; number: number; suffix: string; code: string } | null => {
    const match = /^([A-Z]{0,4})(\d{1,5})([A-Z]?)$/.exec(text);
    if (!match) return null;
    const letters = match[1] || inherited;
    return { prefix: letters, number: Number(match[2]), suffix: match[3], code: `${letters}${Number(match[2])}${match[3]}` };
  };
  for (const part of parts) {
    if (/^[A-Z]$/.test(part) && (prefix || parts.length === 1)) { expanded.push(part); continue; }
    const range = part.split("-");
    if (range.length > 2) return { exact, alias: null, explicit };
    const first = atom(range[0]);
    if (!first) return { exact, alias: null, explicit };
    inherited = first.prefix;
    if (range.length === 1) { expanded.push(first.code); continue; }
    const last = atom(range[1]);
    if (!last || first.prefix !== last.prefix || first.suffix || last.suffix
      || last.number < first.number || last.number - first.number > 50) return { exact, alias: null, explicit };
    for (let n = first.number; n <= last.number; n++) expanded.push(`${first.prefix}${n}`);
  }
  if (!expanded.length || new Set(expanded).size !== expanded.length) return { exact, alias: null, explicit };
  return { exact, alias: `${kind}:${expanded.sort().join("/")}`, explicit };
}

export function normalizeEvidenceUnitRef(raw: unknown): string {
  return reference(raw).exact;
}

export function evidenceScheduleRefsEquivalent(a: unknown, b: unknown): boolean {
  const left = reference(a), right = reference(b);
  return !!left.exact && (left.exact === right.exact || !!left.alias && left.alias === right.alias);
}

function comparable(field: string, value: unknown): string {
  if (absent(value)) return "missing";
  if ((booleanFields as readonly string[]).includes(field)) {
    return typeof value === "boolean" ? `boolean:${value}` : `invalid-boolean:${cleanText(value)}`;
  }
  if ((arrayFields as readonly string[]).includes(field)) {
    return Array.isArray(value) && value.every(item => typeof item === "string")
      ? `array:${JSON.stringify([...value].sort())}` : `invalid-array:${cleanText(value)}`;
  }
  if ((numberFields as readonly string[]).includes(field)) {
    const text = cleanText(value);
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text))) return `number:${Number(text)}`;
    return `invalid-number:${text}`;
  }
  if ((dateFields as readonly string[]).includes(field)) {
    const time = value instanceof Date ? value.getTime() : Date.parse(cleanText(value));
    return Number.isFinite(time) ? `date:${time}` : `invalid-date:${cleanText(value)}`;
  }
  if (field === "tenant_name" || field === "trading_name") return `tenant:${normalizeEvidenceTenantName(value)}`;
  return `text:${cleanText(value).toUpperCase()}`;
}

function fieldLabel(field: string): string {
  return ({ tenant_name: "Legal tenant", trading_name: "Trading name", unit_number: "Unit reference",
    property_id: "Property", floor_level: "Floor", permitted_use: "Use", passing_rent_pa: "Passing rent",
    erv_pa: "ERV", nia_sqft: "NIA", gia_sqft: "GIA", lease_expiry: "Lease expiry",
    lease_start: "Lease start", break_date: "Break date", next_review_date: "Next review",
    premises: "Premises identity" } as Record<string, string>)[field] || field.replace(/_/g, " ");
}

export function classifyEvidenceScheduleCandidates<T extends EvidenceScheduleRow>(rows: readonly T[]): EvidenceScheduleClassification<T> {
  const ordered = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const candidateIds = ordered.map(row => row.id);
  if (!ordered.length) return { status: "none", row: null, candidateIds, equivalentDuplicateIds: [], conflicts: [] };
  if (ordered.length === 1) return { status: "single", row: ordered[0], candidateIds, equivalentDuplicateIds: [], conflicts: [] };
  const conflicts: EvidenceScheduleConflict[] = [];
  const check = (field: string, keys: string[], values: unknown[]) => {
    if (new Set(keys).size > 1 || keys.some(key => key.startsWith("invalid-"))) conflicts.push({ field, label: fieldLabel(field), values });
  };
  check("property_id", ordered.map(row => comparable("property_id", row.property_id)), ordered.map(row => row.property_id ?? null));
  check("unit_number", ordered.map(row => { const key = reference(row.unit_number); return key.alias || key.exact; }), ordered.map(row => row.unit_number ?? null));
  for (const field of EVIDENCE_SCHEDULE_COMPARISON_FIELDS) check(field, ordered.map(row => comparable(field, row[field])), ordered.map(row => row[field] ?? null));
  // An omitted import locator is not an economic fact. Two different supplied
  // locators do identify a possible distinct tenancy, even when the labels match.
  const premises = ordered.map(row => row.premises).filter(value => !absent(value));
  check("premises", premises.map(value => comparable("premises", value)), premises);
  return conflicts.length
    ? { status: "conflicting", row: null, candidateIds, equivalentDuplicateIds: [], conflicts }
    : { status: "equivalent", row: ordered[0], candidateIds, equivalentDuplicateIds: candidateIds, conflicts: [] };
}

function ancillary(row: EvidenceScheduleRow): boolean {
  return /\b(storage|remote store|store\s*cage|container|car\s*park|atm|substation|advert|barrow|locker|sprinkler|plant|collection facility)\b/i
    .test(`${row.permitted_use || ""} ${row.unit_number || ""} ${row.premises || ""}`);
}

export function resolveEvidenceScheduleMatch<T extends EvidenceScheduleRow>(
  unit: EvidenceScheduleUnit, rows: readonly T[], options: { propertyId?: string | null } = {},
): EvidenceScheduleMatch<T> {
  const empty = (status: EvidenceScheduleMatch<T>["status"], reason: string): EvidenceScheduleMatch<T> => ({
    row: null, method: null, status, candidateIds: [], equivalentDuplicateIds: [], conflicts: [], reason,
  });
  const hasLink = !absent(unit.tenancy_unit_id);
  const properties = [...new Set(rows.map(row => row.property_id).filter((id): id is string => typeof id === "string" && !!id))];
  const hasScope = Object.prototype.hasOwnProperty.call(options, "propertyId");
  const propertyId = hasScope ? options.propertyId : unit.property_id || (properties.length === 1 ? properties[0] : null);
  if (hasScope && !propertyId || !hasScope && !propertyId && properties.length > 1
    || propertyId && unit.property_id && propertyId !== unit.property_id) {
    return empty(hasLink ? "stale-link" : "unmatched", "The tenancy schedule must belong to this plan's property.");
  }
  const scoped = propertyId ? rows.filter(row => row.property_id === propertyId) : rows.filter(row => !row.property_id);
  if (hasLink) {
    const linked = typeof unit.tenancy_unit_id === "string" ? scoped.filter(row => row.id === unit.tenancy_unit_id) : [];
    if (!propertyId || linked.length !== 1) return empty("stale-link", "The selected tenancy row is no longer available for this property. Choose a tenancy row again.");
    return { row: linked[0], method: "explicit", status: "matched", candidateIds: [linked[0].id], equivalentDuplicateIds: [], conflicts: [], reason: "Linked to the tenancy row you selected." };
  }
  const ref = reference(unit.unit_ref);
  const byRef = ref.exact ? scoped.filter(row => evidenceScheduleRefsEquivalent(unit.unit_ref, row.unit_number)) : [];
  const resolve = (candidates: T[], method: NonNullable<EvidenceScheduleMatch<T>["method"]>): EvidenceScheduleMatch<T> => {
    const result = classifyEvidenceScheduleCandidates(candidates);
    if (!result.row) return { ...result, row: null, method: null, status: "ambiguous",
      reason: result.conflicts.length ? `These tenancy rows disagree on ${result.conflicts.map(c => c.label.toLowerCase()).join(", ")}. Choose the correct row.`
        : "More than one tenancy row could match. Choose the correct row." };
    const savedTenant = normalizeEvidenceTenantName(unit.tenant_name);
    const tenantNames = [result.row.tenant_name, result.row.trading_name].filter(name => !absent(name)).map(normalizeEvidenceTenantName);
    if (savedTenant && !tenantNames.includes(savedTenant)) return { ...result, row: null, method: null, status: "ambiguous",
      equivalentDuplicateIds: [], conflicts: [{ field: "saved_tenant", label: "Saved tenant", values: [unit.tenant_name, result.row.tenant_name ?? null, result.row.trading_name ?? null] }],
      reason: "The tenancy tenant differs from the saved unit. Confirm the correct tenancy row before replacing its information." };
    return { ...result, row: result.row, method, status: "matched",
      reason: result.status === "equivalent" ? "Matching imported rows have the same tenancy facts. No rows were merged." : method === "tenant" ? "Matched one retail tenancy by its full tenant name." : "Matched the tenancy unit reference." };
  };
  if (byRef.length) return resolve(byRef, byRef.every(row => reference(row.unit_number).exact === ref.exact) ? "ref" : "alias");
  if (ref.explicit) return empty("unmatched", "No tenancy has this unit reference. Choose a row to confirm a different reference.");
  const names = new Set([normalizeEvidenceTenantName(unit.tenant_name), normalizeEvidenceTenantName(unit.unit_ref)].filter(name => name.length >= 3));
  const byTenant = scoped.filter(row => !ancillary(row) && [row.tenant_name, row.trading_name]
    .some(name => !absent(name) && names.has(normalizeEvidenceTenantName(name))));
  if (!byTenant.length) return empty("unmatched", "No unambiguous retail tenancy matches this unit. Choose a tenancy row.");
  return resolve(byTenant, "tenant");
}
