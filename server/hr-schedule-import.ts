// ── HR schedule import (Woody, 2026-10-12: "update the app from it") ────────
// The HR schedule spreadsheet (First Name, Last Name, Job title, Date of
// Birth, Address, Email, Start Date, Annual Salary) fills each person's HR
// record. Admin-only, uploaded in the app (never stored in the repo or on
// disk), previewed first, and it only fills EMPTY fields — except salary,
// which is updated to the sheet's figure (see below). People are matched by work email, then by full
// name, then by a first name only one person has. Names in the sheet are
// never copied over the app's (logins and fee allocations use them).

import * as XLSX from "xlsx";
import { pool } from "./db";

export type HrRow = { firstName: string; lastName: string; title: string | null; dob: string | null; address: string | null; email: string | null; startDate: string | null; salaryPence: number | null };

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const excelDate = (v: unknown): string | null => {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 1000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = clean(v);
  const uk = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (uk) { let y = +uk[3]; if (y < 100) y += y >= 30 ? 1900 : 2000; return `${y}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`; }
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

export function parseHrSchedule(buffer: Buffer): HrRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const out: HrRow[] = [];
  for (const name of wb.SheetNames) {
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    const h = rows.findIndex(r => r.some(c => /first\s*name/i.test(String(c))) && r.some(c => /e-?mail/i.test(String(c))));
    if (h < 0) continue;
    const head = rows[h].map(c => clean(c).toLowerCase());
    const col = (re: RegExp) => head.findIndex(c => re.test(c));
    const c = { first: col(/first\s*name/), last: col(/last\s*name|surname/), title: col(/job\s*title|^title|position|role/), dob: col(/date\s*of\s*birth|^dob/), address: col(/address/), email: col(/e-?mail/), start: col(/start\s*date|joined/), salary: col(/salary/) };
    for (const r of rows.slice(h + 1)) {
      const firstName = clean(r[c.first]);
      if (!firstName) continue;
      const salary = c.salary >= 0 ? Number(String(r[c.salary]).replace(/[£,\s]/g, "")) : NaN;
      out.push({
        firstName, lastName: c.last >= 0 ? clean(r[c.last]) : "",
        title: c.title >= 0 ? clean(r[c.title]) || null : null,
        dob: c.dob >= 0 ? excelDate(r[c.dob]) : null,
        address: c.address >= 0 ? clean(r[c.address]) || null : null,
        email: c.email >= 0 ? clean(r[c.email]).toLowerCase() || null : null,
        startDate: c.start >= 0 ? excelDate(r[c.start]) : null,
        salaryPence: Number.isFinite(salary) && salary > 0 ? Math.round(salary * 100) : null,
      });
    }
  }
  return out;
}

const FIELD_LABELS: Record<string, string> = { title: "Job title", dob: "Date of birth", address: "Home address", start_date: "Start date" };
export type HrFill = { userId: string; appName: string; sheetName: string; matchedBy: string; fields: Record<string, string | number> };

// Salaries are the exception (Layla, 2026-10-13: "salaries aren't correct"):
// the sheet is the up-to-date record, so a salary that differs from it is
// updated — with a salary_history row, so the old figure stays on record.
// Stored salaries are a mix of pounds and pence; compare in pence.
const toPence = (raw: unknown): number | null => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1_000_000 ? Math.round(n * 100) : Math.round(n);
};
export type SalaryChange = { userId: string; appName: string; fromPence: number | null; toPence: number };

export async function planHrSchedule(rows: HrRow[]): Promise<{ fills: HrFill[]; salaryChanges: SalaryChange[]; unmatched: string[]; labels: Record<string, string> }> {
  const { rows: staff } = await pool.query(
    `SELECT u.id, u.name, lower(u.email) AS email, u.dob AS u_dob, u.address AS u_address, u.start_date AS u_start,
            sp.title, sp.dob AS sp_dob, sp.start_date AS sp_start, sp.salary_current
       FROM users u LEFT JOIN staff_profiles sp ON sp.user_id = u.id
      WHERE lower(u.email) LIKE '%@brucegillinghampollard.com'`);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const fills: HrFill[] = [];
  const salaryChanges: SalaryChange[] = [];
  const unmatched: string[] = [];
  for (const r of rows) {
    const full = norm(`${r.firstName} ${r.lastName}`);
    let s = r.email ? staff.find((x: any) => x.email === r.email) : undefined;
    let matchedBy = "work email";
    if (!s) { s = staff.find((x: any) => norm(x.name || "") === full); matchedBy = "name"; }
    if (!s) {
      const first = norm(r.firstName).split(" ")[0];
      const hits = staff.filter((x: any) => norm(x.name || "").split(" ")[0] === first);
      if (hits.length === 1) { s = hits[0]; matchedBy = "first name"; }
    }
    if (!s) { unmatched.push(`${r.firstName} ${r.lastName}`.trim()); continue; }
    const fields: Record<string, string | number> = {};
    if (r.title && !clean(s.title)) fields.title = r.title;
    if (r.dob && !clean(s.u_dob) && !clean(s.sp_dob)) fields.dob = r.dob;
    if (r.address && !clean(s.u_address)) fields.address = r.address;
    if (r.startDate && !clean(s.u_start) && !clean(s.sp_start)) fields.start_date = r.startDate;
    if (r.salaryPence && toPence(s.salary_current) !== r.salaryPence) salaryChanges.push({ userId: s.id, appName: s.name, fromPence: toPence(s.salary_current), toPence: r.salaryPence });
    if (Object.keys(fields).length) fills.push({ userId: s.id, appName: s.name, sheetName: `${r.firstName} ${r.lastName}`.trim(), matchedBy, fields });
  }
  return { fills, salaryChanges, unmatched, labels: FIELD_LABELS };
}

export async function applyHrSchedule(rows: HrRow[], recordedBy: string | null): Promise<{ people: number; fields: number; salaries: number }> {
  const { fills, salaryChanges } = await planHrSchedule(rows);
  const today = new Date().toISOString().slice(0, 10);
  for (const c of salaryChanges) {
    await pool.query(`INSERT INTO staff_profiles (user_id, status) VALUES ($1, 'active') ON CONFLICT (user_id) DO NOTHING`, [c.userId]);
    await pool.query(
      `INSERT INTO salary_history (user_id, salary_pence, effective_date, reason, notes, recorded_by) VALUES ($1, $2, $3, 'HR schedule', $4, $5)`,
      [c.userId, c.toPence, today, c.fromPence != null ? `was £${(c.fromPence / 100).toLocaleString("en-GB")}` : null, recordedBy],
    );
    await pool.query(`UPDATE staff_profiles SET salary_current = $2, updated_at = now() WHERE user_id = $1`, [c.userId, c.toPence]);
  }
  let n = 0;
  for (const f of fills) {
    await pool.query(`INSERT INTO staff_profiles (user_id, status) VALUES ($1, 'active') ON CONFLICT (user_id) DO NOTHING`, [f.userId]);
    const v = f.fields;
    // Every write re-checks the field is still empty.
    if (v.title) n += (await pool.query(`UPDATE staff_profiles SET title = $2 WHERE user_id = $1 AND COALESCE(title, '') = ''`, [f.userId, v.title])).rowCount || 0;
    if (v.dob) {
      n += (await pool.query(`UPDATE users SET dob = $2 WHERE id = $1 AND COALESCE(dob, '') = ''`, [f.userId, v.dob])).rowCount || 0;
      await pool.query(`UPDATE staff_profiles SET dob = $2 WHERE user_id = $1 AND COALESCE(dob, '') = ''`, [f.userId, v.dob]).catch(() => {});
    }
    if (v.address) n += (await pool.query(`UPDATE users SET address = $2 WHERE id = $1 AND COALESCE(address, '') = ''`, [f.userId, v.address])).rowCount || 0;
    if (v.start_date) {
      n += (await pool.query(`UPDATE staff_profiles SET start_date = $2 WHERE user_id = $1 AND COALESCE(start_date, '') = ''`, [f.userId, v.start_date])).rowCount || 0;
      await pool.query(`UPDATE users SET start_date = $2 WHERE id = $1 AND COALESCE(start_date, '') = ''`, [f.userId, v.start_date]).catch(() => {});
    }
  }
  return { people: fills.length, fields: n, salaries: salaryChanges.length };
}
