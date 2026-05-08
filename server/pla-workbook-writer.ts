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
