// ── Holiday calendar import (Woody, 2026-10-28: "update everyone's
// holidays so we can start using the app properly for it") ──────────────
// The firm's holiday calendar spreadsheet: one sheet per holiday year
// (1 May – 30 April), a row per person with Holiday (entitlement), Days
// left, Days used, then a column per day holding 1 (full day), 0.5 (half
// day), BH (bank holiday) or a note ("wedding", "unpaid", "study"). Admin
// uploads it in the app, previews, then Apply writes each run of leave as
// an APPROVED holiday request — never where that person already has a
// request on those dates — and sets the current year's entitlement. Notes
// are listed, not imported. The file isn't kept.
import * as XLSX from "xlsx";
import { pool } from "./db";
import { rosterNameFor, samePerson } from "@shared/teams";
import { holidayYearBounds } from "@shared/holiday-year";

export type LeaveDay = { date: string; days: number };
export type SheetPerson = { name: string; entitlement: number | null; leave: LeaveDay[]; bankHolidays: string[]; notes: Array<{ date: string; text: string }> };
export type HolidaySheet = { label: string; startYear: number; first: string; last: string; people: SheetPerson[] };

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const ymd = (d: Date) => d.toISOString().slice(0, 10);
// Rows on the sheet that aren't people.
const NOT_A_PERSON = /office closed|medical|appt|pat leave|public holiday|^event$/i;

function leaveValue(raw: unknown): number | null {
  if (typeof raw === "number") return raw === 1 || raw === 0.5 ? raw : null;
  const s = clean(raw).toLowerCase();
  if (s === "1") return 1;
  if (s === "0.5" || s === "0..5" || s === ".5") return 0.5;
  return null;
}

export function parseHolidayCalendar(buffer: Buffer): HolidaySheet[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const out: HolidaySheet[] = [];
  for (const name of wb.SheetNames) {
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    const hi = rows.findIndex(r => clean(r[0]).toLowerCase() === "headcount" && clean(r[1]).toLowerCase() === "name");
    if (hi < 1) continue;
    // The holiday year: the title cell ("BGP HOLIDAY CALENDAR 2026/2027"),
    // else the sheet name ("Holiday 26-27").
    let startYear: number | null = null;
    for (const r of rows.slice(0, hi)) {
      for (const c of r) { const m = clean(c).match(/(20\d\d)\s*\/\s*(?:20)?\d\d/); if (m) { startYear = Number(m[1]); break; } }
      if (startYear) break;
    }
    if (!startYear) { const m = name.match(/(\d\d)\s*-\s*\d\d/); if (m) startYear = 2000 + Number(m[1]); }
    if (!startYear) continue;
    // Day columns: the header row counts 1..31 per month from May; a drop
    // back to a lower number starts the next month. The row above carries
    // the weekday letter, which must agree or the column is skipped.
    const header = rows[hi];
    const dow = rows[hi - 1] || [];
    const dates = new Map<number, string>();
    let month = 5, year = startYear, prev = 0;
    for (let ci = 5; ci < header.length; ci++) {
      if (clean(header[ci]) === "") continue;
      const n = Number(header[ci]);
      if (!Number.isInteger(n) || n < 1 || n > 31) continue;
      if (n < prev) { month++; if (month === 13) { month = 1; year++; } }
      prev = n;
      const d = new Date(Date.UTC(year, month - 1, n));
      if (d.getUTCMonth() !== month - 1) continue;
      const letter = clean(dow[ci]).slice(0, 1).toUpperCase();
      if (letter && letter !== "MTWTFSS"[(d.getUTCDay() + 6) % 7]) continue;
      dates.set(ci, ymd(d));
    }
    if (!dates.size) continue;
    const people: SheetPerson[] = [];
    for (const r of rows.slice(hi + 1)) {
      const pname = clean(r[1]);
      if (!pname) continue;
      const ent = Number(r[2]);
      const person: SheetPerson = { name: pname, entitlement: clean(r[2]) !== "" && Number.isFinite(ent) ? ent : null, leave: [], bankHolidays: [], notes: [] };
      for (const [ci, date] of dates) {
        const raw = r[ci];
        if (raw == null || clean(raw) === "") continue;
        const v = leaveValue(raw);
        if (v != null) person.leave.push({ date, days: v });
        else if (/^bh$/i.test(clean(raw))) person.bankHolidays.push(date);
        else person.notes.push({ date, text: clean(raw) });
      }
      people.push(person);
    }
    const all = [...dates.values()].sort();
    out.push({ label: `${startYear}/${String(startYear + 1).slice(2)}`, startYear, first: all[0], last: all[all.length - 1], people });
  }
  return out.sort((a, b) => a.startYear - b.startYear);
}

export type PlannedRequest = { start: string; end: string; days: number; year: string };

// Consecutive leave days become one request; a weekend or a bank holiday
// between two leave days doesn't break the run.
function runsOf(p: SheetPerson, year: string): PlannedRequest[] {
  const bh = new Set(p.bankHolidays);
  const leave = [...p.leave].sort((a, b) => a.date.localeCompare(b.date));
  const runs: PlannedRequest[] = [];
  for (const d of leave) {
    const cur = runs[runs.length - 1];
    if (cur && bridgeable(cur.end, d.date, bh)) { cur.end = d.date; cur.days = Math.round((cur.days + d.days) * 2) / 2; }
    else runs.push({ start: d.date, end: d.date, days: d.days, year });
  }
  return runs;
}
function bridgeable(from: string, to: string, bh: Set<string>): boolean {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
  for (let t = a + 86400000; t < b; t += 86400000) {
    const d = new Date(t);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !bh.has(ymd(d))) return false;
  }
  return true;
}

export type HolidayPlanPerson = {
  userId: string; appName: string; sheetName: string; matchedBy: string;
  requests: PlannedRequest[]; alreadyThere: number; alreadyThereDays: number;
  entitlement?: { from: number | null; to: number; year: string };
};
export type HolidayPlan = {
  sheets: Array<{ label: string; first: string; last: string; current: boolean; people: number }>;
  currentYear: string;
  people: HolidayPlanPerson[];
  unmatched: string[];
  ignored: string[];
  notes: Array<{ name: string; date: string; text: string }>;
  totals: { people: number; requests: number; days: number; entitlements: number };
};

export async function planHolidayImport(sheets: HolidaySheet[]): Promise<HolidayPlan> {
  const { rows: staff } = await pool.query(
    `SELECT u.id, u.name, sp.holiday_entitlement
       FROM users u LEFT JOIN staff_profiles sp ON sp.user_id = u.id
      WHERE u.is_active = true AND lower(u.email) LIKE '%@brucegillinghampollard.com' AND COALESCE(u.role, '') <> 'Client'`);
  const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const findUser = (sheetName: string): { user: any; matchedBy: string } | null => {
    const exact = staff.find((u: any) => samePerson(u.name, sheetName));
    if (exact) return { user: exact, matchedBy: "name" };
    const roster = rosterNameFor(sheetName);
    if (roster) {
      const viaRoster = staff.find((u: any) => samePerson(u.name, roster) || rosterNameFor(u.name) === roster);
      if (viaRoster) return { user: viaRoster, matchedBy: `team roster (${roster})` };
    }
    const first = norm(sheetName).split(" ")[0];
    const hits = staff.filter((u: any) => norm(u.name).split(" ")[0] === first);
    if (hits.length === 1) return { user: hits[0], matchedBy: "first name" };
    return null;
  };
  const { rows: existing } = await pool.query(`SELECT user_id, start_date, end_date FROM holiday_requests WHERE status IN ('approved', 'pending')`);
  const existingByUser = new Map<string, Array<{ s: string; e: string }>>();
  for (const r of existing) {
    const list = existingByUser.get(r.user_id) || [];
    list.push({ s: String(r.start_date).slice(0, 10), e: String(r.end_date).slice(0, 10) });
    existingByUser.set(r.user_id, list);
  }
  const overlaps = (userId: string, a: PlannedRequest) => (existingByUser.get(userId) || []).some(x => a.start <= x.e && a.end >= x.s);

  const bounds = holidayYearBounds(new Date());
  const byUser = new Map<string, HolidayPlanPerson>();
  const unmatched = new Set<string>(), ignored = new Set<string>();
  const notes: HolidayPlan["notes"] = [];
  for (const sheet of sheets) {
    const current = sheet.first <= bounds.start && sheet.last >= bounds.start;
    for (const p of sheet.people) {
      if (NOT_A_PERSON.test(p.name)) { ignored.add(p.name); continue; }
      const hit = findUser(p.name);
      if (!hit) { if (p.leave.length || p.entitlement != null) unmatched.add(p.name); continue; }
      const entry: HolidayPlanPerson = byUser.get(hit.user.id) || { userId: hit.user.id, appName: hit.user.name, sheetName: p.name, matchedBy: hit.matchedBy, requests: [], alreadyThere: 0, alreadyThereDays: 0 };
      for (const run of runsOf(p, sheet.label)) {
        if (overlaps(hit.user.id, run)) { entry.alreadyThere++; entry.alreadyThereDays += run.days; }
        else entry.requests.push(run);
      }
      for (const n of p.notes) notes.push({ name: hit.user.name, date: n.date, text: n.text });
      if (current && p.entitlement != null) {
        const from = hit.user.holiday_entitlement == null ? null : Number(hit.user.holiday_entitlement);
        if (from !== p.entitlement) entry.entitlement = { from, to: p.entitlement, year: sheet.label };
      }
      byUser.set(hit.user.id, entry);
    }
  }
  const people = [...byUser.values()].filter(p => p.requests.length || p.entitlement).sort((a, b) => a.appName.localeCompare(b.appName));
  return {
    sheets: sheets.map(s => ({ label: s.label, first: s.first, last: s.last, current: s.first <= bounds.start && s.last >= bounds.start, people: s.people.filter(p => !NOT_A_PERSON.test(p.name)).length })),
    currentYear: bounds.label,
    people,
    unmatched: [...unmatched].sort(),
    ignored: [...ignored].sort(),
    notes: notes.sort((a, b) => a.date.localeCompare(b.date)),
    totals: {
      people: people.length,
      requests: people.reduce((n, p) => n + p.requests.length, 0),
      days: people.reduce((n, p) => n + p.requests.reduce((m, r) => m + r.days, 0), 0),
      entitlements: people.filter(p => p.entitlement).length,
    },
  };
}

export async function applyHolidayImport(sheets: HolidaySheet[], recordedBy: string | null): Promise<{ people: number; requests: number; days: number; entitlements: number }> {
  const plan = await planHolidayImport(sheets);
  let requests = 0, days = 0, entitlements = 0;
  for (const p of plan.people) {
    for (const r of p.requests) {
      await pool.query(
        `INSERT INTO holiday_requests (user_id, start_date, end_date, days_count, status, notes, approved_by, approved_at)
         VALUES ($1, $2, $3, $4, 'approved', $5, $6, now())`,
        [p.userId, r.start, r.end, r.days, `Imported from the holiday calendar ${r.year}`, recordedBy],
      );
      requests++; days += r.days;
    }
    if (p.entitlement) {
      await pool.query(`INSERT INTO staff_profiles (user_id, status) VALUES ($1, 'active') ON CONFLICT (user_id) DO NOTHING`, [p.userId]);
      await pool.query(`UPDATE staff_profiles SET holiday_entitlement = $2, updated_at = now() WHERE user_id = $1`, [p.userId, p.entitlement.to]);
      entitlements++;
    }
  }
  console.log(`[hr] holiday calendar import: ${requests} requests (${days} days) for ${plan.people.length} people, ${entitlements} entitlements set`);
  return { people: plan.people.length, requests, days, entitlements };
}
