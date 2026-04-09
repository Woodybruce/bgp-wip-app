import { Router, Request, Response } from "express";
import { requireAuth } from "./auth";
import multer from "multer";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

let dbPool: any = null;
async function getPool() {
  if (!dbPool) {
    const { pool } = await import("./db");
    dbPool = pool;
  }
  return dbPool;
}

async function getUserInfo(pool: any, req: Request) {
  const userId = (req.session as any)?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const result = await pool.query("SELECT id, username, is_admin FROM users WHERE id = $1", [userId]);
  return result.rows[0] || null;
}

router.get("/api/tenancy-schedule/property/:propertyId", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { propertyId } = req.params;
    const result = await pool.query(
      "SELECT * FROM tenancy_schedule_units WHERE property_id = $1 ORDER BY premises, sort_order, id",
      [propertyId]
    );
    res.json(result.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/tenancy-schedule/unit", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const d = req.body;
    const result = await pool.query(
      `INSERT INTO tenancy_schedule_units (
        property_id, premises, unit_number, tenant_name, trading_name, permitted_use,
        area_basement, area_ground, area_first, area_second, area_other,
        nia_sqft, gia_sqft, passing_rent_pa, rent_psf, turnover_percent,
        landlord_shortfall, net_income, epc_rating, blended_erv, erv_pa,
        lease_start, term_years, lease_expiry,
        rent_review_1_date, rent_review_1_amount, rent_review_2_date, rent_review_2_amount,
        rent_review_3_date, rent_review_3_amount, rent_review_4_date, rent_review_4_amount,
        outside_lt_act, break_type, break_date, wault_rent_percent, unexpired_term,
        service_charge, insurance, total_occ_costs, occ_costs_psf, status,
        deal_id, letting_tracker_unit_id, sort_order
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
        $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45
      ) RETURNING *`,
      [
        d.property_id, d.premises || '', d.unit_number || '', d.tenant_name || '', d.trading_name || '', d.permitted_use || '',
        d.area_basement || 0, d.area_ground || 0, d.area_first || 0, d.area_second || 0, d.area_other || 0,
        d.nia_sqft || 0, d.gia_sqft || 0, d.passing_rent_pa || 0, d.rent_psf || 0, d.turnover_percent || 0,
        d.landlord_shortfall || 0, d.net_income || 0, d.epc_rating || '', d.blended_erv || 0, d.erv_pa || 0,
        d.lease_start || null, d.term_years || 0, d.lease_expiry || null,
        d.rent_review_1_date || '', d.rent_review_1_amount || '', d.rent_review_2_date || '', d.rent_review_2_amount || '',
        d.rent_review_3_date || '', d.rent_review_3_amount || '', d.rent_review_4_date || '', d.rent_review_4_amount || '',
        d.outside_lt_act || '', d.break_type || '', d.break_date || '', d.wault_rent_percent || 0, d.unexpired_term || 0,
        d.service_charge || 0, d.insurance || 0, d.total_occ_costs || 0, d.occ_costs_psf || 0,
        d.status || (d.tenant_name && d.tenant_name !== 'Vacant' ? 'Occupied' : 'Vacant'),
        d.deal_id || null, d.letting_tracker_unit_id || null, d.sort_order || 0
      ]
    );
    res.json(result.rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/api/tenancy-schedule/unit/:id", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { id } = req.params;
    const d = req.body;
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const allowedFields = [
      'premises', 'unit_number', 'tenant_name', 'trading_name', 'permitted_use',
      'area_basement', 'area_ground', 'area_first', 'area_second', 'area_other',
      'nia_sqft', 'gia_sqft', 'passing_rent_pa', 'rent_psf', 'turnover_percent',
      'landlord_shortfall', 'net_income', 'epc_rating', 'blended_erv', 'erv_pa',
      'lease_start', 'term_years', 'lease_expiry',
      'rent_review_1_date', 'rent_review_1_amount', 'rent_review_2_date', 'rent_review_2_amount',
      'rent_review_3_date', 'rent_review_3_amount', 'rent_review_4_date', 'rent_review_4_amount',
      'outside_lt_act', 'break_type', 'break_date', 'wault_rent_percent', 'unexpired_term',
      'service_charge', 'insurance', 'total_occ_costs', 'occ_costs_psf', 'status',
      'deal_id', 'letting_tracker_unit_id', 'sort_order'
    ];

    for (const f of allowedFields) {
      if (f in d) {
        fields.push(`${f} = $${idx}`);
        values.push(d[f] === '' ? null : d[f]);
        idx++;
      }
    }

    if (fields.length === 0) return res.json({ ok: true });

    fields.push(`updated_at = NOW()`);
    values.push(id);
    const result = await pool.query(
      `UPDATE tenancy_schedule_units SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    res.json(result.rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/api/tenancy-schedule/unit/:id", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    await pool.query("DELETE FROM tenancy_schedule_units WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

function excelDateToISO(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (!lower || lower === 'n/a' || lower === 'none' || lower === '-' || lower === 'taw' || lower === 'holding over') return null;
    const parsed = new Date(val);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
    return null;
  }
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  }
  return null;
}

function numVal(v: any): number {
  if (v == null || v === '' || v === 'n/a' || v === 'N/A') return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function strVal(v: any): string {
  if (v == null) return '';
  return String(v).trim();
}

router.post("/api/tenancy-schedule/import-excel", requireAuth, upload.single('file'), async (req: any, res) => {
  try {
    const pool = await getPool();
    const propertyId = req.body.propertyId;
    if (!propertyId) return res.status(400).json({ error: "propertyId required" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const XLSX = await import("xlsx");
    const wb = XLSX.read(req.file.buffer);
    const sheetName = wb.SheetNames.find((s: string) => s === 'TS') || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[];

    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      if (row && row.some((c: any) => typeof c === 'string' && (c.includes('Tenant') || c.includes('Unit Number')))) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx === -1) return res.status(400).json({ error: "Could not find header row in spreadsheet" });

    const clearExisting = req.body.clearExisting === 'true';
    if (clearExisting) {
      await pool.query("DELETE FROM tenancy_schedule_units WHERE property_id = $1", [propertyId]);
    }

    let currentPremises = '';
    let imported = 0;
    let sortOrder = 0;

    for (let i = headerRowIdx + 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 3) continue;

      if (row[1] && !row[2] && !row[3]) {
        currentPremises = strVal(row[1]);
        continue;
      }

      const unitNumber = strVal(row[2]);
      if (!unitNumber) continue;

      const tenantName = strVal(row[3]);
      const tradingName = strVal(row[4]);
      const isVacant = tenantName.toLowerCase() === 'vacant';

      sortOrder++;
      await pool.query(
        `INSERT INTO tenancy_schedule_units (
          property_id, premises, unit_number, tenant_name, trading_name, permitted_use,
          area_basement, area_ground, area_first, area_second, area_other,
          nia_sqft, gia_sqft, passing_rent_pa, rent_psf, turnover_percent,
          landlord_shortfall, net_income, epc_rating, blended_erv, erv_pa,
          lease_start, term_years, lease_expiry,
          rent_review_1_date, rent_review_1_amount, rent_review_2_date, rent_review_2_amount,
          rent_review_3_date, rent_review_3_amount, rent_review_4_date, rent_review_4_amount,
          outside_lt_act, break_type, break_date, wault_rent_percent, unexpired_term,
          service_charge, insurance, total_occ_costs, occ_costs_psf, status, sort_order
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
          $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43
        )`,
        [
          propertyId, currentPremises, unitNumber, tenantName, tradingName, strVal(row[5]),
          numVal(row[6]), numVal(row[7]), numVal(row[8]), numVal(row[9]), numVal(row[10]),
          numVal(row[11]), numVal(row[12]), numVal(row[13]), numVal(row[14]), numVal(row[15]),
          numVal(row[16]), numVal(row[17]), strVal(row[18]), numVal(row[19]), numVal(row[20]),
          excelDateToISO(row[21]), numVal(row[22]), excelDateToISO(row[23]),
          strVal(row[24]), strVal(row[25]), strVal(row[26]), strVal(row[27]),
          strVal(row[28]), strVal(row[29]), strVal(row[30]), strVal(row[31]),
          strVal(row[32]), strVal(row[33]), excelDateToISO(row[34]) || strVal(row[34]),
          numVal(row[35]), numVal(row[36]),
          numVal(row[37]), numVal(row[38]), numVal(row[39]), numVal(row[40]),
          isVacant ? 'Vacant' : 'Occupied', sortOrder
        ]
      );
      imported++;
    }

    res.json({ imported, message: `${imported} units imported successfully` });
  } catch (e: any) {
    console.error("Tenancy schedule import error:", e);
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/tenancy-schedule/property/:propertyId/export-excel", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { propertyId } = req.params;

    const propResult = await pool.query("SELECT name FROM crm_properties WHERE id = $1", [propertyId]);
    const propertyName = propResult.rows[0]?.name || "Property";

    const result = await pool.query(
      "SELECT * FROM tenancy_schedule_units WHERE property_id = $1 ORDER BY premises, sort_order, id",
      [propertyId]
    );

    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.creator = "Bruce Gillingham Pollard";
    wb.created = new Date();

    const DARK_BLUE = "FF082861";
    const WARM_GREY = "FFE8E6DF";
    const LIGHT_BLUE_BG = "FFDCEAF7";
    const WHITE_FONT: any = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    const HEADER_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_BLUE } };
    const ALT_ROW_FILL: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
    const THIN_BORDER: any = {
      top: { style: "thin", color: { argb: "FFDDDFE0" } },
      left: { style: "thin", color: { argb: "FFDDDFE0" } },
      bottom: { style: "thin", color: { argb: "FFDDDFE0" } },
      right: { style: "thin", color: { argb: "FFDDDFE0" } },
    };
    const CURRENCY_FMT = '£#,##0';
    const CURRENCY_PSF_FMT = '£#,##0.00';
    const PCT_FMT = '0.0%';
    const NUM_FMT = '#,##0';

    const safeSheetName = propertyName.replace(/[\\/*?\[\]:]/g, "").slice(0, 31) || "Sheet1";
    const ws = wb.addWorksheet(safeSheetName);

    const titleRow = ws.addRow([`${propertyName} — Tenancy Schedule`]);
    ws.mergeCells(titleRow.number, 1, titleRow.number, 41);
    const titleCell = ws.getCell(titleRow.number, 1);
    titleCell.font = { name: "Calibri", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell.fill = HEADER_FILL;
    titleCell.alignment = { vertical: "middle" };
    ws.getRow(titleRow.number).height = 36;

    const dateRow = ws.addRow([`Exported: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`]);
    ws.mergeCells(dateRow.number, 1, dateRow.number, 41);
    const dateCell = ws.getCell(dateRow.number, 1);
    dateCell.font = { name: "Calibri", size: 9, italic: true, color: { argb: "FF596264" } };
    dateCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E6DF" } };
    ws.getRow(dateRow.number).height = 20;

    const headers = [
      '#', 'Premises', 'Unit Number', 'Tenant Name', 'Trading Name', 'Permitted Use',
      'Basement', 'Ground', 'First', 'Second', 'Other', 'NIA (sq ft)', 'GIA (sq ft)',
      'Passing Rent PA', 'Rent £psf', 'Turnover %', 'Landlord Shortfall', 'Net Income',
      'EPC Rating', 'Blended ERV', 'ERV PA',
      'Lease Start', 'Term (yrs)', 'Lease Expiry',
      'RR1 Date', 'RR1 Amount', 'RR2 Date', 'RR2 Amount',
      'RR3 Date', 'RR3 Amount', 'RR4 Date', 'RR4 Amount',
      'Outside L&T', 'Break Type', 'Break Date',
      'WAULT Rent %', 'Unexpired Term',
      'Service Charge', 'Insurance', 'Total Occ Costs', 'Occ Costs £psf'
    ];

    const headerRow = ws.addRow(headers);
    headerRow.eachCell((cell: any) => {
      cell.font = WHITE_FONT;
      cell.fill = HEADER_FILL;
      cell.alignment = { vertical: "middle", wrapText: true, horizontal: "center" };
      cell.border = THIN_BORDER;
    });
    headerRow.height = 32;

    ws.columns = [
      { width: 5 },
      { width: 20 },
      { width: 14 },
      { width: 24 },
      { width: 20 },
      { width: 18 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 13 },
      { width: 13 },
      { width: 16 },
      { width: 12 },
      { width: 12 },
      { width: 16 },
      { width: 14 },
      { width: 10 },
      { width: 13 },
      { width: 14 },
      { width: 13 },
      { width: 10 },
      { width: 13 },
      { width: 13 },
      { width: 13 },
      { width: 13 },
      { width: 13 },
      { width: 13 },
      { width: 13 },
      { width: 13 },
      { width: 13 },
      { width: 12 },
      { width: 12 },
      { width: 13 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 12 },
      { width: 15 },
      { width: 14 },
    ];

    const currencyCols = [14, 17, 18, 20, 21, 26, 28, 30, 32, 38, 39, 40];
    const currencyPsfCols = [15, 41];
    const pctCols = [16, 36];
    const numCols = [7, 8, 9, 10, 11, 12, 13, 23, 37];

    function formatDate(d: any): string {
      if (!d) return "";
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return String(d || "");
      return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    }

    let idx = 0;
    let totals = {
      nia: 0, gia: 0, passingRent: 0, netIncome: 0, ervPa: 0,
      serviceCh: 0, insurance: 0, totalOcc: 0,
    };

    for (const u of result.rows) {
      idx++;
      const row = ws.addRow([
        idx, u.premises, u.unit_number, u.tenant_name, u.trading_name, u.permitted_use,
        Number(u.area_basement) || 0, Number(u.area_ground) || 0, Number(u.area_first) || 0,
        Number(u.area_second) || 0, Number(u.area_other) || 0,
        Number(u.nia_sqft) || 0, Number(u.gia_sqft) || 0,
        Number(u.passing_rent_pa) || 0, Number(u.rent_psf) || 0, Number(u.turnover_percent) || 0,
        Number(u.landlord_shortfall) || 0, Number(u.net_income) || 0,
        u.epc_rating, Number(u.blended_erv) || 0, Number(u.erv_pa) || 0,
        formatDate(u.lease_start), Number(u.term_years) || 0, formatDate(u.lease_expiry),
        formatDate(u.rent_review_1_date), u.rent_review_1_amount, formatDate(u.rent_review_2_date), u.rent_review_2_amount,
        formatDate(u.rent_review_3_date), u.rent_review_3_amount, formatDate(u.rent_review_4_date), u.rent_review_4_amount,
        u.outside_lt_act, u.break_type, formatDate(u.break_date),
        Number(u.wault_rent_percent) || 0, Number(u.unexpired_term) || 0,
        Number(u.service_charge) || 0, Number(u.insurance) || 0,
        Number(u.total_occ_costs) || 0, Number(u.occ_costs_psf) || 0
      ]);

      totals.nia += Number(u.nia_sqft) || 0;
      totals.gia += Number(u.gia_sqft) || 0;
      totals.passingRent += Number(u.passing_rent_pa) || 0;
      totals.netIncome += Number(u.net_income) || 0;
      totals.ervPa += Number(u.erv_pa) || 0;
      totals.serviceCh += Number(u.service_charge) || 0;
      totals.insurance += Number(u.insurance) || 0;
      totals.totalOcc += Number(u.total_occ_costs) || 0;

      const isAlt = idx % 2 === 0;
      row.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
        cell.font = { name: "Calibri", size: 10 };
        cell.alignment = { vertical: "middle" };
        cell.border = THIN_BORDER;
        if (isAlt) cell.fill = ALT_ROW_FILL;

        if (currencyCols.includes(colNumber)) cell.numFmt = CURRENCY_FMT;
        else if (currencyPsfCols.includes(colNumber)) cell.numFmt = CURRENCY_PSF_FMT;
        else if (pctCols.includes(colNumber)) cell.numFmt = '0.0"%"';
        else if (numCols.includes(colNumber)) cell.numFmt = NUM_FMT;
      });
      row.height = 20;
    }

    if (result.rows.length > 0) {
      const totalRow = ws.addRow([
        '', '', '', 'TOTALS', '', '',
        '', '', '', '', '',
        totals.nia, totals.gia,
        totals.passingRent, '', '', '', totals.netIncome,
        '', '', totals.ervPa,
        '', '', '',
        '', '', '', '',
        '', '', '', '',
        '', '', '',
        '', '',
        totals.serviceCh, totals.insurance, totals.totalOcc, ''
      ]);
      totalRow.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
        cell.font = { name: "Calibri", size: 10, bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E6DF" } };
        cell.border = {
          top: { style: "medium", color: { argb: DARK_BLUE } },
          left: { style: "thin", color: { argb: "FFDDDFE0" } },
          bottom: { style: "medium", color: { argb: DARK_BLUE } },
          right: { style: "thin", color: { argb: "FFDDDFE0" } },
        };
        cell.alignment = { vertical: "middle" };
        if (currencyCols.includes(colNumber)) cell.numFmt = CURRENCY_FMT;
        else if (numCols.includes(colNumber)) cell.numFmt = NUM_FMT;
      });
      totalRow.height = 24;
    }

    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + result.rows.length, column: 41 } };

    ws.views = [{ state: "frozen", ySplit: 3, xSplit: 4 }];

    const buffer = await wb.xlsx.writeBuffer();
    const safeName = propertyName.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_Tenancy_Schedule.xlsx"`);
    res.send(Buffer.from(buffer as ArrayBuffer));
  } catch (e: any) {
    console.error("[tenancy-export] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/tenancy-schedule/property/:propertyId/links", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { propertyId } = req.params;

    const deals = await pool.query(
      "SELECT id, name, status, tenant_id, rent_pa FROM crm_deals WHERE property_id = $1",
      [propertyId]
    );

    const lettingUnits = await pool.query(
      "SELECT id, unit_name, marketing_status, \"dealId\" FROM available_units WHERE property_id = $1",
      [propertyId]
    );

    res.json({
      deals: deals.rows,
      lettingUnits: lettingUnits.rows
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/tenancy-schedule/bulk-delete", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const { propertyId } = req.body;
    if (!propertyId) return res.status(400).json({ error: "propertyId required" });
    await pool.query("DELETE FROM tenancy_schedule_units WHERE property_id = $1", [propertyId]);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
