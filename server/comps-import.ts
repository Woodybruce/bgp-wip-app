// ─────────────────────────────────────────────────────────────────────────
// Portfolio dataset → comps importer.
//
// Ingests the Landsec "Full Portfolio Data Set" workbook (one row per unit
// letting, 43 columns: scheme/asset, unit, tenant, area, target rent + psf,
// letting start/end, breaks, review basis…) and upserts one crm_comps row
// per letting, grouped by scheme (Asset → group_name) and linked to the
// scheme's crm_properties row where one matches. Idempotent on
// source_evidence = "landsec-xlsx:{unit code}:{contract}", so re-importing
// a newer cut updates in place.
//
// Devaluation is NOT stored — /api/crm/comps computes it on read from the
// term/rent fields written here (term is emitted as "N years break M" so
// the devaluer picks up the term certain to the earliest break).
// ─────────────────────────────────────────────────────────────────────────
import * as XLSX from "xlsx";
import { pool } from "./db";

const HEADERS = [
  "Property Unit Code", "Contract Number", "Unit Name", "Floor", "Unit Type",
  "Property", "Asset", "Portfolio", "Business Unit", "Unit Lettable Area",
  "Void Status", "Revenue Category", "Tenant Account", "Trading Name",
  "L&T Act", "Future Tenant", "Letting Start Date", "Letting End Date",
  "Letting Expiry Date", "Months to Expiry", "Target Rent", "Target Rent (psf)",
  "T/O %", "Review Basis", "Next Leasing Event Date", "Next Leasing Event Type",
  "Earliest Tenant Break", "Earliest Landlord Break", "Unit Service Charge",
  "Unit Insurance", "Unit Rates Payable", "Unit Rateable Value",
  "Inclusive S/C", "Inclusive Rates", "Inclusive Insurance", "Inclusive Utility",
  "Credit Check Rating", "Deposit Held", "Total Arrears",
  "Portfolio Asset Manager", "Opportunity Name", "Opportunity Owner", "Opportunity Net Rent",
];

const s = (v: any): string => (v === null || v === undefined ? "" : String(v).trim());
const n = (v: any): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(String(v).replace(/[£,]/g, ""));
  return Number.isFinite(x) ? x : null;
};
const isoDate = (v: any): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const yearsBetween = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const y = (new Date(b).getTime() - new Date(a).getTime()) / (365.25 * 24 * 3600 * 1000);
  return y > 0 ? Math.round(y * 10) / 10 : null;
};

export interface CompsImportResult {
  sheets: string[];
  rowsSeen: number;
  lettings: number;
  inserted: number;
  updated: number;
  skippedNoLetting: number;
  schemes: Record<string, number>;
  propertyMatched: number;
  propertyUnmatched: string[];
}

export async function importPortfolioComps(buffer: Buffer): Promise<CompsImportResult> {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const result: CompsImportResult = {
    sheets: wb.SheetNames, rowsSeen: 0, lettings: 0, inserted: 0, updated: 0,
    skippedNoLetting: 0, schemes: {}, propertyMatched: 0, propertyUnmatched: [],
  };

  // Property name → id map for scheme linking (normalised, comma tail off).
  const propsQ = await pool.query(`SELECT id, name FROM crm_properties WHERE name IS NOT NULL`);
  const propByNorm = new Map<string, string>();
  const norm = (x: string) => x.toLowerCase().replace(/\(.*?\)/g, "").replace(/,.*$/, "").replace(/\s+/g, " ").trim();
  for (const p of propsQ.rows) propByNorm.set(norm(p.name), p.id);
  const resolveProperty = (asset: string, property: string): string | null => {
    for (const cand of [asset, property]) {
      const k = norm(cand.replace(/^SOLD\s+/i, ""));
      if (!k) continue;
      if (propByNorm.has(k)) return propByNorm.get(k)!;
      for (const [pn, id] of propByNorm) {
        if (pn.length >= 6 && (k.includes(pn) || pn.includes(k))) return id;
      }
    }
    return null;
  };
  const unmatched = new Set<string>();

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (!raw.length) continue;
    // Some sheets carry the header row, some (WWX) start straight at data.
    const hasHeader = s(raw[0]?.[0]) === HEADERS[0];
    const dataRows = hasHeader ? raw.slice(1) : raw;

    for (const row of dataRows) {
      if (!row || row.every(c => c === null || c === "")) continue;
      result.rowsSeen++;
      const rec: Record<string, any> = {};
      HEADERS.forEach((h, i) => { rec[h] = row[i]; });

      const unitCode = s(rec["Property Unit Code"]);
      const contract = s(rec["Contract Number"]);
      const tenant = s(rec["Trading Name"]) || s(rec["Tenant Account"]);
      const start = isoDate(rec["Letting Start Date"]);
      const rentPa = n(rec["Target Rent"]);
      // A comp needs an actual letting: a tenant, a start date and a rent.
      if (!unitCode || !tenant || !start || !rentPa || rentPa <= 0) {
        result.skippedNoLetting++;
        continue;
      }
      result.lettings++;

      const asset = s(rec["Asset"]) || s(rec["Property"]);
      const scheme = asset.replace(/^SOLD\s+/i, "").trim();
      result.schemes[scheme] = (result.schemes[scheme] || 0) + 1;
      const propertyId = resolveProperty(s(rec["Asset"]), s(rec["Property"]));
      if (propertyId) result.propertyMatched++;
      else unmatched.add(scheme);

      const end = isoDate(rec["Letting End Date"]) || isoDate(rec["Letting Expiry Date"]);
      const tenantBreak = isoDate(rec["Earliest Tenant Break"]);
      const termYears = yearsBetween(start, end);
      const breakYears = yearsBetween(start, tenantBreak);
      const termText = termYears
        ? `${termYears} years${breakYears && breakYears < termYears ? ` break ${breakYears}` : ""}`
        : "";

      const area = n(rec["Unit Lettable Area"]);
      const psf = n(rec["Target Rent (psf)"]);
      const commentsParts = [
        s(rec["Review Basis"]) && `Review: ${s(rec["Review Basis"])}`,
        n(rec["T/O %"]) !== null && `Turnover top-up: ${n(rec["T/O %"])}%`,
        n(rec["Unit Service Charge"]) !== null && `SC £${Math.round(n(rec["Unit Service Charge"])!).toLocaleString("en-GB")} pa`,
        n(rec["Unit Rates Payable"]) !== null && `Rates £${Math.round(n(rec["Unit Rates Payable"])!).toLocaleString("en-GB")} pa`,
        s(rec["Credit Check Rating"]) && `Covenant: ${s(rec["Credit Check Rating"])}`,
      ].filter(Boolean).join(" · ");

      const sourceKey = `landsec-xlsx:${unitCode}:${contract || "nc"}`;
      const vals = {
        name: `${tenant} — ${s(rec["Unit Name"]) || unitCode}, ${scheme}`,
        group_name: scheme,
        property_id: propertyId,
        deal_type: "Leasing",
        comp_type: "Letting",
        tenant,
        landlord: "Landsec",
        transaction: s(rec["Void Status"]) === "Occupied" ? "Letting (occupied)" : "Letting",
        transaction_type: "Letting",
        term: termText,
        demise: s(rec["Unit Name"]),
        area_sqft: area !== null ? String(area) : "",
        headline_rent: `£${Math.round(rentPa).toLocaleString("en-GB")} pa`,
        overall_rate: psf !== null ? `£${psf} psf` : "",
        use_class: s(rec["Unit Type"]),
        lt_act_status: s(rec["L&T Act"]) === "True" ? "Protected" : "",
        completion_date: start,
        comments: commentsParts,
        source_evidence: sourceKey,
      };

      const upsert = await pool.query(
        `INSERT INTO crm_comps (name, group_name, property_id, deal_type, comp_type, tenant, landlord,
                                transaction, transaction_type, term, demise, area_sqft, headline_rent,
                                overall_rate, use_class, lt_act_status, completion_date, comments, source_evidence)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
         WHERE NOT EXISTS (SELECT 1 FROM crm_comps WHERE source_evidence = $19)
         RETURNING id`,
        [vals.name, vals.group_name, vals.property_id, vals.deal_type, vals.comp_type, vals.tenant,
         vals.landlord, vals.transaction, vals.transaction_type, vals.term, vals.demise, vals.area_sqft,
         vals.headline_rent, vals.overall_rate, vals.use_class, vals.lt_act_status, vals.completion_date,
         vals.comments, vals.source_evidence]
      );
      if (upsert.rows.length) {
        result.inserted++;
      } else {
        await pool.query(
          `UPDATE crm_comps SET name=$1, group_name=$2, property_id=$3, tenant=$4, term=$5, demise=$6,
                  area_sqft=$7, headline_rent=$8, overall_rate=$9, use_class=$10, lt_act_status=$11,
                  completion_date=$12, comments=$13, updated_at=now()
            WHERE source_evidence=$14`,
          [vals.name, vals.group_name, vals.property_id, vals.tenant, vals.term, vals.demise,
           vals.area_sqft, vals.headline_rent, vals.overall_rate, vals.use_class, vals.lt_act_status,
           vals.completion_date, vals.comments, vals.source_evidence]
        );
        result.updated++;
      }
    }
  }

  result.propertyUnmatched = [...unmatched].sort();
  return result;
}
