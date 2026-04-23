// Data-room Push 3: reconciliation across files + portfolio roll-up.
//
// Once every file has gone through specialist analysis (Push 2), we can
// cross-check the numbers and produce a portfolio-level summary:
//
//   - Rent roll total should equal year-1 income in the financial model
//   - Sum of individual lease passing rents should equal the rent roll total
//   - Named landlord on each lease should match registered proprietor on
//     the matching Land Registry title (enrichment.landRegistry)
//   - Every tenant on the rent roll should have a matching lease in the
//     bundle (else "missing lease")
//   - For 300-pub deals, the portfolio view splits by tenure (let /
//     managed / tied / free-of-tie), aggregates EBITDAR vs passing rent,
//     and surfaces the concentration / vacancy / rates anomalies in one
//     summary panel.

import { pool } from "./db";

export interface PortfolioStats {
  propertyCount: number;
  leaseCount: number;
  rentRollRowCount: number;
  totalPassingRentLeases: number;
  totalPassingRentRentRoll: number;
  totalRateableValue: number;
  totalEbitdar: number;
  weightedWaultYears: number | null;
  topTenant: { name: string; sharePercent: number } | null;
  tenantStatusCounts: { active: number; dissolved: number; liquidation: number; unknown: number };
  fsaRatingCounts: Record<string, number>;
  tenureCounts: { let: number; managed: number; tied: number; freeOfTie: number; unknown: number };
  rentToRvRatio: number | null;
}

export interface ReconciliationFlag {
  severity: "red" | "amber" | "green";
  category: string;
  title: string;
  detail: string;
}

export interface ReconciliationReport {
  portfolio: PortfolioStats;
  flags: ReconciliationFlag[];
  properties: Array<{
    fileId: string;
    fileName: string;
    primaryType: string;
    address?: string | null;
    tenant?: string | null;
    landlord?: string | null;
    tenure?: string | null;
    passingRent?: number | null;
    rateableValue?: number | null;
    waultYears?: number | null;
    titleNumber?: string | null;
    registeredProprietor?: string | null;
    landlordMismatch?: boolean;
    tenantCompanyStatus?: string | null;
    fsaRating?: string | null;
    ebitdar?: number | null;
  }>;
}

// Aggregate a number across an array, treating null/undefined/NaN as 0.
function sumNums(xs: Array<number | null | undefined>): number {
  let total = 0;
  for (const v of xs) if (Number.isFinite(v as number)) total += v as number;
  return total;
}

function parseNumber(x: any): number | null {
  if (x == null) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x !== "string") return null;
  const n = parseFloat(x.replace(/[£$€,]/g, "").replace(/\s+/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalise(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/\s*(limited|ltd|llp|plc|\(uk\)|uk|group|holdings)\s*/g, " ").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

export async function buildReconciliationReport(analysisId: string): Promise<ReconciliationReport> {
  const r = await pool.query(
    `SELECT id, file_name, display_name, primary_type, classification, enrichment FROM data_room_files WHERE analysis_id = $1 ORDER BY created_at ASC`,
    [analysisId]
  );
  const files = r.rows;

  // Split files by what kind of analysis they produced.
  const leases = files.filter(f => ["Lease", "Licence", "Tied Lease"].includes(f.primary_type));
  const rentRolls = files.filter(f => f.primary_type === "Rent Roll");
  const models = files.filter(f => f.primary_type === "Financial Model");
  const tradeAccounts = files.filter(f => ["Trade Accounts", "Management Accounts", "BDM Report"].includes(f.primary_type));
  const titleRegisters = files.filter(f => f.primary_type === "Title Register");

  // Helpers.
  const specOf = (f: any) => f.enrichment?.specialist || null;
  const enrOf = (f: any) => f.enrichment?.enrichment || {};

  // ─── Portfolio aggregates ────────────────────────────────────────
  const leasePassingRents = leases.map(l => parseNumber(specOf(l)?.passingRent));
  const totalPassingRentLeases = sumNums(leasePassingRents);

  let rentRollRowCount = 0;
  let totalPassingRentRentRoll = 0;
  let weightedWaultAccum = 0;
  let weightedWaultRentBase = 0;
  const tenantsFromRentRoll: Array<{ name: string; passingRent: number; tenure: string | null }> = [];
  for (const rr of rentRolls) {
    const spec = specOf(rr);
    if (!spec) continue;
    if (Array.isArray(spec.rows)) {
      rentRollRowCount += spec.rows.length;
      for (const row of spec.rows) {
        const pr = parseNumber(row.passingRent) || 0;
        totalPassingRentRentRoll += pr;
        if (row.tenant) tenantsFromRentRoll.push({ name: row.tenant, passingRent: pr, tenure: row.tenure || null });
      }
    }
    const w = parseNumber(spec.waultYears);
    const total = parseNumber(spec.totalPassingRent);
    if (w != null && total != null) {
      weightedWaultAccum += w * total;
      weightedWaultRentBase += total;
    }
  }

  // Top tenant concentration across the whole portfolio.
  const byTenant = new Map<string, number>();
  for (const t of tenantsFromRentRoll) {
    byTenant.set(t.name, (byTenant.get(t.name) || 0) + t.passingRent);
  }
  const totalAcrossTenants = Array.from(byTenant.values()).reduce((a, b) => a + b, 0);
  let topTenant: { name: string; sharePercent: number } | null = null;
  if (totalAcrossTenants > 0) {
    const sorted = Array.from(byTenant.entries()).sort((a, b) => b[1] - a[1]);
    const [name, amt] = sorted[0];
    topTenant = { name, sharePercent: Math.round((amt / totalAcrossTenants) * 1000) / 10 };
  }

  // Tenure split — pubs-first, but works for any commercial mix.
  const tenureCounts = { let: 0, managed: 0, tied: 0, freeOfTie: 0, unknown: 0 };
  for (const t of tenantsFromRentRoll) {
    if (t.tenure === "managed") tenureCounts.managed++;
    else if (t.tenure === "tied") tenureCounts.tied++;
    else if (t.tenure === "free-of-tie") tenureCounts.freeOfTie++;
    else if (t.tenure === "let") tenureCounts.let++;
    else tenureCounts.unknown++;
  }

  // Rates, EBITDAR, FSA, CH status.
  let totalRateableValue = 0;
  let totalEbitdar = 0;
  const fsaRatingCounts: Record<string, number> = {};
  const tenantStatusCounts = { active: 0, dissolved: 0, liquidation: 0, unknown: 0 };

  const properties: ReconciliationReport["properties"] = [];
  for (const f of files) {
    const spec = specOf(f);
    const enr = enrOf(f);
    const rv = parseNumber(enr?.voa?.rateable_value) || 0;
    totalRateableValue += rv;
    if (spec?.ebitdar != null) totalEbitdar += parseNumber(spec.ebitdar) || 0;

    const fsa = enr?.fsaHygiene?.rating;
    if (fsa) fsaRatingCounts[fsa] = (fsaRatingCounts[fsa] || 0) + 1;

    const status = enr?.tenant?.status;
    if (status === "active") tenantStatusCounts.active++;
    else if (status === "dissolved") tenantStatusCounts.dissolved++;
    else if (status === "liquidation") tenantStatusCounts.liquidation++;
    else if (status) tenantStatusCounts.unknown++;

    // Build per-property row (one per lease / premises licence / trade accounts
    // since those are the things that represent a single property).
    const isPerProperty = ["Lease", "Licence", "Tied Lease", "Premises Licence", "Trade Accounts", "Management Accounts", "BDM Report", "Title Register"].includes(f.primary_type);
    if (isPerProperty) {
      const namedLL = normalise(spec?.landlord || spec?.licenceHolder || f.classification?.landlordName);
      const regProp = normalise(enr?.landRegistry?.proprietor_name_1);
      const landlordMismatch = !!(namedLL && regProp && !namedLL.includes(regProp) && !regProp.includes(namedLL));
      properties.push({
        fileId: f.id,
        fileName: f.display_name,
        primaryType: f.primary_type,
        address: spec?.demise || spec?.property || spec?.premisesAddress || f.classification?.propertyAddress || null,
        tenant: spec?.tenant || f.classification?.tenantName || null,
        landlord: spec?.landlord || spec?.licenceHolder || f.classification?.landlordName || null,
        tenure: spec?.tenure || null,
        passingRent: parseNumber(spec?.passingRent),
        rateableValue: rv || null,
        waultYears: parseNumber(spec?.waultYears),
        titleNumber: enr?.landRegistry?.title_number || spec?.titleNumber || null,
        registeredProprietor: enr?.landRegistry?.proprietor_name_1 || (spec?.proprietors?.[0]?.name ?? null),
        landlordMismatch,
        tenantCompanyStatus: enr?.tenant?.status || null,
        fsaRating: fsa || null,
        ebitdar: parseNumber(spec?.ebitdar),
      });
    }
  }

  const weightedWaultYears = weightedWaultRentBase > 0 ? Math.round((weightedWaultAccum / weightedWaultRentBase) * 10) / 10 : null;
  const rentToRvRatio = totalRateableValue > 0 ? Math.round((totalPassingRentLeases / totalRateableValue) * 100) / 100 : null;

  const portfolio: PortfolioStats = {
    propertyCount: properties.length,
    leaseCount: leases.length,
    rentRollRowCount,
    totalPassingRentLeases,
    totalPassingRentRentRoll,
    totalRateableValue,
    totalEbitdar,
    weightedWaultYears,
    topTenant,
    tenantStatusCounts,
    fsaRatingCounts,
    tenureCounts,
    rentToRvRatio,
  };

  // ─── Reconciliation flags ────────────────────────────────────────
  const flags: ReconciliationFlag[] = [];

  // Model year-1 income vs rent roll total.
  for (const m of models) {
    const modelYearOne = parseNumber(specOf(m)?.yearOneIncome);
    if (modelYearOne != null && totalPassingRentRentRoll > 0) {
      const delta = Math.abs(modelYearOne - totalPassingRentRentRoll);
      const pct = (delta / totalPassingRentRentRoll) * 100;
      if (pct > 10) {
        flags.push({
          severity: "red",
          category: "Reconciliation",
          title: `Model year-1 income ≠ rent roll (${pct.toFixed(1)}% gap)`,
          detail: `${m.display_name}: year-1 income £${modelYearOne.toLocaleString()} vs rent roll total £${totalPassingRentRentRoll.toLocaleString()}`,
        });
      } else if (pct > 2) {
        flags.push({
          severity: "amber",
          category: "Reconciliation",
          title: `Model year-1 income has ${pct.toFixed(1)}% variance from rent roll`,
          detail: `${m.display_name}: £${modelYearOne.toLocaleString()} vs £${totalPassingRentRentRoll.toLocaleString()}`,
        });
      } else {
        flags.push({
          severity: "green",
          category: "Reconciliation",
          title: "Model ties to rent roll",
          detail: `Year-1 income £${modelYearOne.toLocaleString()} matches rent roll £${totalPassingRentRentRoll.toLocaleString()}`,
        });
      }
    }
  }

  // Lease sum vs rent roll.
  if (totalPassingRentLeases > 0 && totalPassingRentRentRoll > 0) {
    const delta = Math.abs(totalPassingRentLeases - totalPassingRentRentRoll);
    const pct = (delta / totalPassingRentRentRoll) * 100;
    if (pct > 15) {
      flags.push({
        severity: "amber",
        category: "Reconciliation",
        title: "Sum of lease passing rents doesn't tie to rent roll",
        detail: `Leases total £${totalPassingRentLeases.toLocaleString()} vs rent roll £${totalPassingRentRentRoll.toLocaleString()} (${pct.toFixed(1)}% gap) — may indicate missing leases in the bundle`,
      });
    }
  }

  // Missing leases — tenants on rent roll that don't appear in any lease.
  if (tenantsFromRentRoll.length > 0 && leases.length > 0) {
    const leaseTenants = new Set(leases.map(l => normalise(specOf(l)?.tenant)).filter(Boolean));
    const missing = tenantsFromRentRoll.filter(t => {
      const n = normalise(t.name);
      return n && !Array.from(leaseTenants).some(lt => lt.includes(n) || n.includes(lt));
    });
    if (missing.length > 0) {
      const sample = missing.slice(0, 5).map(m => m.name).join(", ");
      flags.push({
        severity: "amber",
        category: "Missing Documents",
        title: `${missing.length} tenant(s) on rent roll with no matching lease in bundle`,
        detail: `Request leases for: ${sample}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}`,
      });
    }
  }

  // Landlord mismatches.
  const mismatches = properties.filter(p => p.landlordMismatch);
  if (mismatches.length > 0) {
    flags.push({
      severity: "red",
      category: "Title Mismatch",
      title: `${mismatches.length} property/ies where named landlord ≠ Land Registry proprietor`,
      detail: mismatches.slice(0, 3).map(m => `${m.fileName}: lease names "${m.landlord}" but title held by "${m.registeredProprietor}"`).join("; "),
    });
  }

  // Dissolved/liquidation tenants.
  if (tenantStatusCounts.dissolved + tenantStatusCounts.liquidation > 0) {
    flags.push({
      severity: "red",
      category: "Counterparty Risk",
      title: `${tenantStatusCounts.dissolved + tenantStatusCounts.liquidation} tenant company/ies dissolved or in liquidation`,
      detail: "These units are either vacant already or at imminent risk of re-entry — filter the per-property table for red CH status",
    });
  }

  // Top-tenant concentration.
  if (topTenant && topTenant.sharePercent > 35) {
    flags.push({
      severity: topTenant.sharePercent > 50 ? "red" : "amber",
      category: "Concentration",
      title: `${topTenant.name} represents ${topTenant.sharePercent}% of total passing rent`,
      detail: "Single-tenant concentration risk — lender will want covenant strength evidence and potentially a rent-deposit or guarantee",
    });
  }

  // Rent-to-rates anomalies.
  if (rentToRvRatio != null) {
    if (rentToRvRatio > 4.5) {
      flags.push({
        severity: "amber",
        category: "Rates",
        title: `Rent is ${rentToRvRatio.toFixed(1)}× rateable value across the portfolio`,
        detail: "Consider rates appeal opportunities — any units where rent/RV is materially above 3.5× may be over-rated",
      });
    } else if (rentToRvRatio < 2) {
      flags.push({
        severity: "amber",
        category: "Rates",
        title: `Rent is only ${rentToRvRatio.toFixed(1)}× rateable value — potentially under-rented`,
        detail: "Reversionary upside at review / renewal",
      });
    }
  }

  // FSA distribution for pubs.
  const low = (fsaRatingCounts["0"] || 0) + (fsaRatingCounts["1"] || 0) + (fsaRatingCounts["2"] || 0);
  if (low > 0) {
    flags.push({
      severity: "amber",
      category: "Operational",
      title: `${low} pub(s) with food hygiene rating below 3`,
      detail: "Regulatory risk / closure risk — filter per-property table by FHR badge",
    });
  }

  return { portfolio, flags, properties };
}
