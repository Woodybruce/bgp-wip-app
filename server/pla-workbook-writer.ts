/**
 * PLA workbook xlsx writer — turns valuation results into actual Excel files
 * Tom and Pete can hand to clients, in the same format as BGP's existing
 * Net Effective Template.
 *
 * v1: Net Effective workbook only. Devaluation and Comparables Schedule
 * generators land in follow-ups (math is already in pla-valuation.ts —
 * just needs the xlsx layout + cell logic).
 *
 * Files land in the matter's SharePoint folder under:
 *   <matter folder>/Rent Review/Valuation/
 * (matches Tom + Pete's canonical Lease Advisory tree)
 */

import ExcelJS from "exceljs";
import { db } from "./db";
import { plaMatters, plaMatterWorkbooks, crmProperties } from "@shared/schema";
import { eq } from "drizzle-orm";
import { uploadFileToSharePoint, SHAREPOINT_ROOT_FOLDER } from "./microsoft";
import type { NetEffectiveInput, NetEffectiveOutput } from "./pla-valuation";

const SHEET_NAME = "Net Effective";
const TEMPLATE_VERSION = "BGP-NE-v1";

export async function buildAndUploadNetEffectiveXlsx(args: {
  matterId: string;
  workbookId: string;
  propertyName: string;
  matterType: string;
  input: NetEffectiveInput;
  output: NetEffectiveOutput;
  generatedByName?: string;
}): Promise<{ ok: boolean; webUrl?: string; error?: string }> {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Bruce Gillingham Pollard";
    wb.lastModifiedBy = "BGP Lease Advisory";
    wb.created = new Date();
    wb.modified = new Date();
    wb.company = "Bruce Gillingham Pollard";

    const ws = wb.addWorksheet(SHEET_NAME, {
      properties: { defaultColWidth: 18, tabColor: { argb: "FF0E5BA8" } },
    });

    // ── Header block ─────────────────────────────────────────────────────
    ws.mergeCells("A1:F1");
    ws.getCell("A1").value = "Net Effective Rent — BGP Lease Advisory";
    ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF0E5BA8" } };
    ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
    ws.getRow(1).height = 24;

    ws.getCell("A3").value = "Property";
    ws.getCell("B3").value = args.propertyName;
    ws.getCell("A4").value = "Matter type";
    ws.getCell("B4").value = humanise(args.matterType);
    ws.getCell("A5").value = "Generated";
    ws.getCell("B5").value = new Date();
    ws.getCell("B5").numFmt = "dd mmm yyyy";
    ws.getCell("A6").value = "By";
    ws.getCell("B6").value = args.generatedByName || "—";
    ws.getCell("A7").value = "Template version";
    ws.getCell("B7").value = TEMPLATE_VERSION;
    for (const r of [3, 4, 5, 6, 7]) {
      ws.getCell(`A${r}`).font = { bold: true };
    }

    // ── Inputs block ──────────────────────────────────────────────────────
    let row = 9;
    ws.getCell(`A${row}`).value = "Inputs";
    ws.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: "FF333333" } };
    row += 1;
    const inputRows: Array<[string, any, string?]> = [
      ["Area (sq ft)",            args.input.areaSqft,           "#,##0"],
      ["Headline rent £ p.a.",    args.input.headlineRentPa,     `"£"#,##0`],
      ["Term (years)",            args.input.termYears,          "0.00"],
      ["Rent-free (months)",      args.input.rentFreeMonths || 0, "0"],
      ["Capex contribution £",    args.input.capexContribution || 0, `"£"#,##0`],
    ];
    for (const [label, value, fmt] of inputRows) {
      ws.getCell(`A${row}`).value = label;
      ws.getCell(`B${row}`).value = value;
      if (fmt) ws.getCell(`B${row}`).numFmt = fmt;
      row += 1;
    }

    // Stepped rents (if any)
    if (args.input.steppedRents && args.input.steppedRents.length > 0) {
      row += 1;
      ws.getCell(`A${row}`).value = "Stepped rents";
      ws.getCell(`A${row}`).font = { bold: true };
      row += 1;
      ws.getCell(`A${row}`).value = "From year";
      ws.getCell(`B${row}`).value = "Rent £ p.a.";
      [`A${row}`, `B${row}`].forEach((c) => (ws.getCell(c).font = { bold: true, italic: true }));
      row += 1;
      for (const s of args.input.steppedRents) {
        ws.getCell(`A${row}`).value = s.fromYear;
        ws.getCell(`B${row}`).value = s.rentPa;
        ws.getCell(`B${row}`).numFmt = `"£"#,##0`;
        row += 1;
      }
    }

    // ── Outputs block ─────────────────────────────────────────────────────
    row += 2;
    ws.getCell(`A${row}`).value = "Result";
    ws.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: "FF333333" } };
    row += 1;
    const outputRows: Array<[string, any, string]> = [
      ["Headline psf",          args.output.headlinePsf,        `"£"#,##0.00`],
      ["Net effective psf",     args.output.netEffectivePsf,    `"£"#,##0.00`],
      ["Effective annual",      args.output.effectiveAnnualPa,  `"£"#,##0`],
      ["Effective total (term)", args.output.effectiveTotal,    `"£"#,##0`],
      ["Total incentive",       args.output.totalIncentive,     `"£"#,##0`],
      ["Discount to headline",  args.output.discountPct / 100,  "0.0%"],
    ];
    for (const [label, value, fmt] of outputRows) {
      ws.getCell(`A${row}`).value = label;
      ws.getCell(`B${row}`).value = value;
      ws.getCell(`B${row}`).numFmt = fmt;
      // Highlight the headline net-effective psf — the single number Tom
      // negotiates against
      if (label === "Net effective psf") {
        ws.getCell(`A${row}`).font = { bold: true };
        ws.getCell(`B${row}`).font = { bold: true, color: { argb: "FF0E5BA8" } };
        ws.getCell(`B${row}`).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE8F0FA" },
        };
      }
      row += 1;
    }

    // ── Notes block ───────────────────────────────────────────────────────
    row += 2;
    ws.getCell(`A${row}`).value = "Method";
    ws.getCell(`A${row}`).font = { bold: true };
    row += 1;
    ws.mergeCells(`A${row}:F${row + 3}`);
    const noteCell = ws.getCell(`A${row}`);
    noteCell.value =
      "Straight-line amortisation of rent-free + capex contribution over the assumed term. " +
      "Stepped rents (if any) are applied year-by-year. Net effective psf = (total rent paid net of incentives) / term / area.";
    noteCell.alignment = { wrapText: true, vertical: "top" };
    noteCell.font = { color: { argb: "FF666666" }, italic: true };
    row += 4;

    // Column widths
    ws.getColumn(1).width = 26;
    ws.getColumn(2).width = 22;

    const buf = await wb.xlsx.writeBuffer();
    const buffer = Buffer.from(buf as ArrayBuffer);

    // Upload into the matter's Rent Review / Valuation folder
    const folder = `${SHAREPOINT_ROOT_FOLDER}/Lease Advisory/${cleanFolderName(args.propertyName)}/Rent Review/Valuation`;
    const filename = `Net Effective — ${cleanFilename(args.propertyName)} — ${formatDateForFile(new Date())}.xlsx`;

    const upload = await uploadFileToSharePoint(
      buffer,
      filename,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      folder,
    );

    // Stamp the workbook row with the SharePoint URL
    await db
      .update(plaMatterWorkbooks)
      .set({ sharepointUrl: upload.webUrl })
      .where(eq(plaMatterWorkbooks.id, args.workbookId));

    return { ok: true, webUrl: upload.webUrl };
  } catch (err: any) {
    console.error(`[pla-workbook-writer] net-effective xlsx for matter ${args.matterId} failed:`, err?.message || err);
    return { ok: false, error: err?.message || "xlsx generation failed" };
  }
}

function humanise(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function cleanFolderName(s: string): string {
  return s.trim().replace(/[<>:"/\\|?*]+/g, "-").slice(0, 200);
}

function cleanFilename(s: string): string {
  return s.trim().replace(/[<>:"/\\|?*]+/g, "-").slice(0, 80);
}

function formatDateForFile(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Helper for the route layer — given a matter row and a freshly-saved
 * workbook id, fire-and-forget the xlsx build. The Net Effective endpoint
 * doesn't block the response on this; the UI refetches and picks up the
 * sharepointUrl when it lands.
 */
export async function fireNetEffectiveXlsxAsync(args: {
  matterId: string;
  workbookId: string;
  input: NetEffectiveInput;
  output: NetEffectiveOutput;
  generatedByName?: string;
}): Promise<void> {
  // Look up matter + property in one go so we have a clean folder path
  const [matter] = await db.select().from(plaMatters).where(eq(plaMatters.id, args.matterId));
  if (!matter) {
    console.warn(`[pla-workbook-writer] matter ${args.matterId} not found — skipping xlsx`);
    return;
  }
  const [property] = await db
    .select({ name: crmProperties.name })
    .from(crmProperties)
    .where(eq(crmProperties.id, matter.propertyId));
  if (!property?.name) {
    console.warn(`[pla-workbook-writer] property name missing for matter ${args.matterId}`);
    return;
  }
  // Don't await — best-effort background work
  buildAndUploadNetEffectiveXlsx({
    matterId: args.matterId,
    workbookId: args.workbookId,
    propertyName: property.name,
    matterType: matter.matterType,
    input: args.input,
    output: args.output,
    generatedByName: args.generatedByName,
  }).catch((err) =>
    console.warn(`[pla-workbook-writer] async xlsx failed for matter ${args.matterId}:`, err?.message),
  );
}

// ─── Comparables Schedule ────────────────────────────────────────────────────

export interface ComparablesScheduleRow {
  date: string | null;
  district: string | null;
  buildingName: string;
  unit: string | null;
  tenant: string | null;
  areaSqft: string | null;
  leaseType: string | null;
  fitOut: string | null;
  leaseLength: string | null;
  breaks: string | null;
  rentPa: string | null;
  rentPsf: string | null;
  rentFreeMonths: string | null;
  zoneARatePsf: string | null;
  netEffectivePsf: string | null;
  source: string | null;
  weight: number;
  comments: string | null;
}

export async function buildAndUploadComparablesScheduleXlsx(args: {
  matterId: string;
  workbookId: string;
  propertyName: string;
  matterType: string;
  rows: ComparablesScheduleRow[];
  generatedByName?: string;
}): Promise<{ ok: boolean; webUrl?: string; error?: string }> {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Bruce Gillingham Pollard";
    wb.lastModifiedBy = "BGP Lease Advisory";
    wb.created = new Date();
    wb.modified = new Date();
    wb.company = "Bruce Gillingham Pollard";

    const ws = wb.addWorksheet("Comparables", {
      properties: { defaultColWidth: 14, tabColor: { argb: "FF0E5BA8" } },
      views: [{ state: "frozen", ySplit: 4 }],
    });

    // Header
    ws.mergeCells("A1:P1");
    ws.getCell("A1").value = `Schedule of Comparables — ${args.propertyName}`;
    ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF0E5BA8" } };
    ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
    ws.getRow(1).height = 24;

    ws.mergeCells("A2:P2");
    ws.getCell("A2").value = `Matter: ${humanise(args.matterType)} · Generated ${formatDateForFile(new Date())} ${args.generatedByName ? `by ${args.generatedByName}` : ""}`;
    ws.getCell("A2").font = { italic: true, color: { argb: "FF666666" }, size: 10 };

    // Column header row at row 4
    const headers = [
      "Date", "District", "Building", "Unit", "Tenant",
      "Area sq ft", "Lease type", "Fit-out", "Lease length", "Breaks",
      "Rent £ p.a.", "Rent psf", "Rent-free (mths)", "Zone A psf", "Net effective psf",
      "Source",
    ];
    headers.forEach((h, i) => {
      const cell = ws.getCell(4, i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0E5BA8" },
      };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: "FFFFFFFF" } } };
    });
    ws.getRow(4).height = 32;

    // Data rows from row 5 onwards. Sort by weight descending (most relevant first).
    const sorted = [...args.rows].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    sorted.forEach((row, i) => {
      const r = i + 5;
      ws.getCell(r, 1).value = row.date;
      ws.getCell(r, 2).value = row.district;
      ws.getCell(r, 3).value = row.buildingName;
      ws.getCell(r, 4).value = row.unit;
      ws.getCell(r, 5).value = row.tenant;
      ws.getCell(r, 6).value = numOrNull(row.areaSqft);
      ws.getCell(r, 7).value = row.leaseType;
      ws.getCell(r, 8).value = row.fitOut;
      ws.getCell(r, 9).value = row.leaseLength;
      ws.getCell(r, 10).value = row.breaks;
      ws.getCell(r, 11).value = numOrNull(row.rentPa);
      ws.getCell(r, 12).value = numOrNull(row.rentPsf);
      ws.getCell(r, 13).value = numOrNull(row.rentFreeMonths);
      ws.getCell(r, 14).value = numOrNull(row.zoneARatePsf);
      ws.getCell(r, 15).value = numOrNull(row.netEffectivePsf);
      ws.getCell(r, 16).value = row.source;
      // Highlight high-weight comps
      if (row.weight && row.weight >= 1.0) {
        for (let c = 1; c <= 16; c++) {
          const cell = ws.getCell(r, c);
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FA" } };
        }
      }
      // Number formats
      ws.getCell(r, 6).numFmt = "#,##0";
      ws.getCell(r, 11).numFmt = `"£"#,##0`;
      ws.getCell(r, 12).numFmt = `"£"#,##0.00`;
      ws.getCell(r, 13).numFmt = "0";
      ws.getCell(r, 14).numFmt = `"£"#,##0.00`;
      ws.getCell(r, 15).numFmt = `"£"#,##0.00`;
    });

    // Column widths
    const colWidths = [12, 14, 24, 10, 22, 11, 14, 10, 14, 10, 13, 11, 14, 13, 16, 18];
    colWidths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

    const buf = await wb.xlsx.writeBuffer();
    const buffer = Buffer.from(buf as ArrayBuffer);

    const folder = `${SHAREPOINT_ROOT_FOLDER}/Lease Advisory/${cleanFolderName(args.propertyName)}/Rent Review/Comparable Evidence`;
    const filename = `Comparables Schedule — ${cleanFilename(args.propertyName)} — ${formatDateForFile(new Date())}.xlsx`;

    const upload = await uploadFileToSharePoint(
      buffer,
      filename,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      folder,
    );

    await db
      .update(plaMatterWorkbooks)
      .set({ sharepointUrl: upload.webUrl })
      .where(eq(plaMatterWorkbooks.id, args.workbookId));

    return { ok: true, webUrl: upload.webUrl };
  } catch (err: any) {
    console.error(`[pla-workbook-writer] comparables xlsx for matter ${args.matterId} failed:`, err?.message || err);
    return { ok: false, error: err?.message || "xlsx generation failed" };
  }
}

function numOrNull(v: any): number | string | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[£,]/g, ""));
  return isFinite(n) ? n : v;
}

// ─── ITZA xlsx ───────────────────────────────────────────────────────────────

import type { ItzaInput, ItzaOutput, DevaluationInput, DevaluationOutput } from "./pla-valuation";

export async function buildAndUploadItzaXlsx(args: {
  matterId: string;
  workbookId: string;
  propertyName: string;
  matterType: string;
  input: ItzaInput;
  output: ItzaOutput;
  generatedByName?: string;
}): Promise<{ ok: boolean; webUrl?: string; error?: string }> {
  try {
    const wb = baseWorkbook();
    const ws = wb.addWorksheet("ITZA", { properties: { defaultColWidth: 18, tabColor: { argb: "FF0E5BA8" } } });

    headerBlock(ws, "ITZA — Zoned Area Calculation", args.propertyName, args.matterType, args.generatedByName);

    let row = 9;
    ws.getCell(`A${row}`).value = "Zoned areas (sq ft)";
    ws.getCell(`A${row}`).font = { bold: true, size: 12 };
    row += 1;
    const headers = ["Zone", "Area sq ft", "Factor", "ITZA sq ft"];
    headers.forEach((h, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5BA8" } };
      c.alignment = { horizontal: "center" };
    });
    row += 1;

    const zoneNames = ["Zone A", "Zone B", "Zone C", "Zone D"];
    args.input.zones.forEach((z, i) => {
      const name = zoneNames[i] || `Zone ${i + 1}`;
      ws.getCell(row, 1).value = name;
      ws.getCell(row, 2).value = z.zoneAreaSqft;
      ws.getCell(row, 2).numFmt = "#,##0.00";
      ws.getCell(row, 3).value = `A/${1 / (z.factor || 1)}`;
      ws.getCell(row, 4).value = args.output.zonesItza[i];
      ws.getCell(row, 4).numFmt = "#,##0.00";
      row += 1;
    });

    if (args.input.basementSqft) {
      ws.getCell(row, 1).value = "Basement";
      ws.getCell(row, 2).value = args.input.basementSqft;
      ws.getCell(row, 2).numFmt = "#,##0.00";
      ws.getCell(row, 3).value = `A/${args.input.basementFactor ? 1 / args.input.basementFactor : "—"}`;
      ws.getCell(row, 4).value = args.output.basementItza;
      ws.getCell(row, 4).numFmt = "#,##0.00";
      row += 1;
    }
    if (args.input.ancillarySqft) {
      ws.getCell(row, 1).value = "Ancillary";
      ws.getCell(row, 2).value = args.input.ancillarySqft;
      ws.getCell(row, 2).numFmt = "#,##0.00";
      ws.getCell(row, 3).value = `A/${args.input.ancillaryFactor ? 1 / args.input.ancillaryFactor : "—"}`;
      ws.getCell(row, 4).value = args.output.ancillaryItza;
      ws.getCell(row, 4).numFmt = "#,##0.00";
      row += 1;
    }
    row += 1;
    if (args.input.a3SalesApportionment) {
      ws.getCell(`A${row}`).value = "A3 sales apportionment";
      ws.getCell(`B${row}`).value = args.input.a3SalesApportionment;
      ws.getCell(`B${row}`).numFmt = "0.00";
      ws.getCell(`A${row}`).font = { italic: true };
      row += 1;
    }

    // Highlight total
    const totalRow = row + 1;
    ws.getCell(totalRow, 1).value = "Total ITZA";
    ws.getCell(totalRow, 4).value = args.output.itzaSqft;
    ws.getCell(totalRow, 4).numFmt = "#,##0.00";
    [1, 2, 3, 4].forEach((c) => {
      ws.getCell(totalRow, c).font = { bold: true, color: { argb: "FF0E5BA8" } };
      ws.getCell(totalRow, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FA" } };
    });

    ws.getColumn(1).width = 24;
    ws.getColumn(2).width = 16;
    ws.getColumn(3).width = 12;
    ws.getColumn(4).width = 16;

    const folder = `${SHAREPOINT_ROOT_FOLDER}/Lease Advisory/${cleanFolderName(args.propertyName)}/Rent Review/Valuation`;
    const filename = `ITZA — ${cleanFilename(args.propertyName)} — ${formatDateForFile(new Date())}.xlsx`;
    return await uploadAndStamp(wb, folder, filename, args.workbookId);
  } catch (err: any) {
    console.error(`[pla-workbook-writer] itza xlsx failed:`, err?.message || err);
    return { ok: false, error: err?.message || "itza xlsx failed" };
  }
}

// ─── Devaluation xlsx ────────────────────────────────────────────────────────

export async function buildAndUploadDevaluationXlsx(args: {
  matterId: string;
  workbookId: string;
  propertyName: string;
  matterType: string;
  input: DevaluationInput;
  output: DevaluationOutput;
  generatedByName?: string;
}): Promise<{ ok: boolean; webUrl?: string; error?: string }> {
  try {
    const wb = baseWorkbook();
    const ws = wb.addWorksheet("Devaluation", { properties: { defaultColWidth: 18, tabColor: { argb: "FF0E5BA8" } } });

    headerBlock(ws, "Devaluation — Implied Zone A Rate", args.propertyName, args.matterType, args.generatedByName);

    let row = 9;
    ws.getCell(`A${row}`).value = "Inputs";
    ws.getCell(`A${row}`).font = { bold: true, size: 12 };
    row += 1;
    ws.getCell(`A${row}`).value = "Annual rent £ p.a.";
    ws.getCell(`B${row}`).value = args.input.annualRentPa;
    ws.getCell(`B${row}`).numFmt = `"£"#,##0`;
    row += 1;
    ws.getCell(`A${row}`).value = "ITZA sq ft";
    ws.getCell(`B${row}`).value = args.input.itza.itzaSqft;
    ws.getCell(`B${row}`).numFmt = "#,##0.00";
    row += 2;

    ws.getCell(`A${row}`).value = "Result";
    ws.getCell(`A${row}`).font = { bold: true, size: 12 };
    row += 1;
    ws.getCell(`A${row}`).value = "Implied Zone A psf (ITZA)";
    ws.getCell(`B${row}`).value = args.output.zoneARatePsfItza;
    ws.getCell(`B${row}`).numFmt = `"£"#,##0.00`;
    ws.getCell(`A${row}`).font = { bold: true };
    ws.getCell(`B${row}`).font = { bold: true, color: { argb: "FF0E5BA8" } };
    ws.getCell(`B${row}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FA" } };
    row += 2;

    ws.getCell(`A${row}`).value = "Method";
    ws.getCell(`A${row}`).font = { bold: true };
    row += 1;
    ws.mergeCells(`A${row}:F${row + 2}`);
    ws.getCell(`A${row}`).value =
      "Annual rent ÷ ITZA = implied Zone A rate. ITZA is the zoned area with " +
      "Zones A/B/C/D at A/1, A/2, A/4, A/8, plus weighted basement/ancillary " +
      "(retail: A/10 basement; restaurant: A/2 basement; A3 ground: 0.65 sales apportionment).";
    ws.getCell(`A${row}`).alignment = { wrapText: true, vertical: "top" };
    ws.getCell(`A${row}`).font = { italic: true, color: { argb: "FF666666" } };

    ws.getColumn(1).width = 28;
    ws.getColumn(2).width = 18;

    const folder = `${SHAREPOINT_ROOT_FOLDER}/Lease Advisory/${cleanFolderName(args.propertyName)}/Rent Review/Valuation`;
    const filename = `Devaluation — ${cleanFilename(args.propertyName)} — ${formatDateForFile(new Date())}.xlsx`;
    return await uploadAndStamp(wb, folder, filename, args.workbookId);
  } catch (err: any) {
    console.error(`[pla-workbook-writer] devaluation xlsx failed:`, err?.message || err);
    return { ok: false, error: err?.message || "devaluation xlsx failed" };
  }
}

// ─── Helpers shared across writers ───────────────────────────────────────────

function baseWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Bruce Gillingham Pollard";
  wb.lastModifiedBy = "BGP Lease Advisory";
  wb.created = new Date();
  wb.modified = new Date();
  wb.company = "Bruce Gillingham Pollard";
  return wb;
}

function headerBlock(ws: ExcelJS.Worksheet, title: string, propertyName: string, matterType: string, generatedByName?: string) {
  ws.mergeCells("A1:F1");
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF0E5BA8" } };
  ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 24;

  ws.getCell("A3").value = "Property";
  ws.getCell("B3").value = propertyName;
  ws.getCell("A4").value = "Matter type";
  ws.getCell("B4").value = humanise(matterType);
  ws.getCell("A5").value = "Generated";
  ws.getCell("B5").value = new Date();
  ws.getCell("B5").numFmt = "dd mmm yyyy";
  if (generatedByName) {
    ws.getCell("A6").value = "By";
    ws.getCell("B6").value = generatedByName;
  }
  for (const r of [3, 4, 5, 6]) ws.getCell(`A${r}`).font = { bold: true };
}

async function uploadAndStamp(wb: ExcelJS.Workbook, folder: string, filename: string, workbookId: string): Promise<{ ok: boolean; webUrl?: string; error?: string }> {
  const buf = await wb.xlsx.writeBuffer();
  const buffer = Buffer.from(buf as ArrayBuffer);
  const upload = await uploadFileToSharePoint(
    buffer,
    filename,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    folder,
  );
  await db.update(plaMatterWorkbooks).set({ sharepointUrl: upload.webUrl }).where(eq(plaMatterWorkbooks.id, workbookId));
  return { ok: true, webUrl: upload.webUrl };
}
