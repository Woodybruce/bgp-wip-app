// Landlord leasing-meeting minutes → the estate's leasing schedule (Woody,
// 2026-09-28). Canary Wharf Group's "Retail Leasing Minutes" workbook has one
// tab per week ("Units to let - Wc 23.03"); older weeks are hidden. Each tab
// is one sheet split by section rows — "Jubilee Place Voids", "Cabot Place
// Opportunities (Upcoming Lease Events)", "WOOD WHARF" (then building
// sub-headings) — and each unit row carries the landlord's unit code
// ("Jubilee Place / Unit 1 / Yardi 29400001").
//
// This is NOT the multi-sheet importer (that makes each sheet a property):
// the whole workbook is one estate. Sections become schemes, unit rows
// update the matching leasing schedule row (by landlord unit code, then by
// name) or add one, and the week's offers / comments land in the unit's
// updates. Always previewed first (dryRun) — nothing is written until the
// user applies it.

import { estateUnitName, findScheme, schemeKey, unitRefKey } from "@shared/property-schemes";

type Queryable = { query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export type MinutesUnit = {
  sourceRow: number;
  section: string;
  scheme: string;
  building: string | null;
  label: string;
  unitName: string;
  unitCodes: string[];
  tenant: string | null;
  vacant: boolean;
  sqft: number | null;
  leaseExpiry: string | null;
  leaseBreak: string | null;
  financials: string | null;
  offers: string | null;
  comments: string | null;
  status: string;
  statusFromText: boolean;
};

export type ParsedMinutes = {
  sheetName: string;
  weekLabel: string | null;
  weeklySheets: number;
  schemes: Array<{ name: string; code: string | null }>;
  units: MinutesUnit[];
  warnings: string[];
};

const clean = (v: unknown) => String(v ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
const cleanBlock = (v: unknown) => String(v ?? "").replace(/\r/g, "").split("\n").map(l => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");

const WEEKLY_TAB = /\bw\/?c\.?\s*(\d{1,2})[./-](\d{1,2})\b/i;

/** The latest visible weekly tab. Tabs run oldest → newest; a month going
 *  backwards (Dec → Jan) is the year turning. */
export function pickMinutesSheet(wb: { SheetNames: string[]; Workbook?: { Sheets?: Array<{ Hidden?: number }> } }): { name: string; weekLabel: string | null; weeklySheets: number } | null {
  let yearOffset = 0, lastMonth = 0, best: { name: string; weekLabel: string; ord: number } | null = null, weekly = 0;
  wb.SheetNames.forEach((name, i) => {
    const m = name.match(WEEKLY_TAB);
    if (!m) return;
    weekly++;
    const day = Number(m[1]), month = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return;
    if (lastMonth && month < lastMonth) yearOffset++;
    lastMonth = month;
    if (wb.Workbook?.Sheets?.[i]?.Hidden) return;
    const ord = yearOffset * 10000 + month * 100 + day;
    if (!best || ord >= best.ord) best = { name, weekLabel: `w/c ${m[1].padStart(2, "0")}.${m[2].padStart(2, "0")}`, ord };
  });
  const found = best as { name: string; weekLabel: string; ord: number } | null;
  return found ? { name: found.name, weekLabel: found.weekLabel, weeklySheets: weekly } : null;
}

type Columns = { property: number; tenant: number; size: number; offers: number; comments: number; money: Array<{ col: number; label: string }> };

function findHeader(rows: any[][]): { index: number; cols: Columns } | null {
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const cells = (rows[i] || []).map(clean);
    const at = (re: RegExp) => cells.findIndex(c => re.test(c));
    const property = at(/^property$/i);
    const offers = at(/^offers?\b/i);
    if (property < 0 || offers < 0) continue;
    const tenant = at(/tenant/i), size = at(/size|sq\s*ft/i), comments = at(/target|comment/i);
    const taken = new Set([property, tenant, size, offers, comments]);
    const money = cells.map((c, col) => ({ col, label: c })).filter(c => c.label && !taken.has(c.col) && c.col > property);
    return { index: i, cols: { property, tenant, size, offers, comments, money } };
  }
  return null;
}

// Section headings that carry no scheme ("RETAIL LEASING MEETING - Live").
const NOISE_HEADING = /leasing meeting|^units? to let$/i;
const SECTION_SUFFIX = /^(.*?)\s+(voids?|opportunities\b.*|upcoming lease events\b.*|lease events\b.*)$/i;

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

/** A section row's scheme, or null for a sub-heading / noise. */
export function sectionScheme(text: string, known: Array<{ name: string }>): { scheme: string | null; kind: "scheme" | "subheading" | "noise" } {
  const t = clean(text).replace(/\s*-\s*live$/i, "");
  if (!t || NOISE_HEADING.test(t)) return { scheme: null, kind: "noise" };
  const suffixed = t.match(SECTION_SUFFIX);
  const base = (suffixed ? suffixed[1] : t).replace(/\s+units?$/i, "").trim();
  const hit = findScheme(known, base);
  if (hit) return { scheme: hit.name, kind: "scheme" };
  if (suffixed) return { scheme: base, kind: "scheme" };
  if (/[A-Z]/.test(t) && t === t.toUpperCase() && /[A-Z]{3}/.test(t)) return { scheme: titleCase(t), kind: "scheme" };
  return { scheme: null, kind: "subheading" };
}

const CODE_LINE = /^yardi:?\s*(.*)$/i;
const BARE_CODE = /^[0-9][0-9A-Z]{7}$/i;

/** Split "Jubilee Place / Unit 1 / Yardi 29400001" into text + unit codes. */
export function splitUnitCell(cell: unknown): { text: string; codes: string[] } {
  const codes: string[] = [];
  const kept: string[] = [];
  for (const line of String(cell ?? "").replace(/\r/g, "").split("\n").map(l => l.trim()).filter(Boolean)) {
    const yardi = line.match(CODE_LINE);
    if (yardi) { codes.push(...(yardi[1].match(/[0-9][0-9A-Z]{7}/gi) || []).map(c => c.toUpperCase())); continue; }
    if (BARE_CODE.test(line) && /\d{5}/.test(line)) { codes.push(line.toUpperCase()); continue; }
    kept.push(line);
  }
  return { text: kept.join(" ").replace(/\s+/g, " ").trim(), codes: [...new Set(codes)] };
}

/** The scheme a unit's own text starts with ("Wharf Kitchen Unit Kiosk 1"),
 *  and the rest of the text. `aliases` maps short forms ("crossrail") too. */
export function unitPrefix(text: string, aliases: Map<string, string>, schemes: Array<{ name: string }> = []): { scheme: string | null; rest: string } {
  const words = text.split(" ");
  const restAfter = (n: number) => words.slice(n).join(" ").replace(/^-\s*(?=\d)/, "-").replace(/^[\s,:–—]+|^-\s+/, "").trim();
  for (let n = Math.min(words.length, 6); n >= 1; n--) {
    const scheme = aliases.get(schemeKey(words.slice(0, n).join(" ")));
    if (scheme) return { scheme, rest: restAfter(n) };
  }
  // "Churchill Unit 15" under Churchill Place: a distinctive first word of
  // exactly one scheme's name.
  const first = schemeKey(words[0]);
  if (first.length >= 5 && !GENERIC_FIRST_WORDS.has(first) && words.length > 1) {
    const owners = schemes.filter(s => schemeKey(s.name).split(" ")[0] === first);
    if (owners.length === 1) return { scheme: owners[0].name, rest: restAfter(1) };
  }
  return { scheme: null, rest: text };
}
const GENERIC_FIRST_WORDS = new Set(["north", "south", "east", "west", "upper", "lower", "great", "little", "saint", "building", "block", "tower", "house", "court", "plaza", "square", "street"]);

/** "Unit Kiosk 1" → "Kiosk 1", "Kisok 3B" → "Kiosk 3B". */
export function tidyUnitLabel(label: string): string {
  return label.replace(/\bkisok\b/gi, "Kiosk").replace(/^unit\s+(kiosk|shop|suite)\b/i, (_, w) => titleCase(w)).replace(/\s+/g, " ").trim();
}

function firstNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const m = String(v ?? "").match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function dateAfter(label: string, text: string): string | null {
  const m = text.match(new RegExp(`\\b${label}\\s*:?\\s*(\\d{1,2})[./](\\d{1,2})[./](\\d{2,4})`, "i"));
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const mo = Number(m[2]), d = Number(m[1]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const NOT_A_TENANT = /^(vacant|former\b|forrmer\b|pc:|q[1-4]\s+\d{4}|tbc\b|n\/a)/i;

/** Leasing status from the week's offer / comment text; null when the text
 *  says nothing about the letting. */
export function statusFromMinutes(offers: string | null, comments: string | null): string | null {
  const text = (offers || comments || "").toLowerCase();
  if (!text.trim()) return null;
  const lead = text.split("\n")[0];
  if (/\bcompleted?\b/.test(lead)) return "Occupied";
  if (/\b(exchanged|signed|sols? instructed|solicitors|hots? (agreed|in circulation)|heads (of terms )?agreed|agreed heads|in legals|in sols|under offer|board approval|engrossments?)\b/.test(text)) return "Under Offer";
  if (/\b(offers?|offered|negotiat\w*|agreed terms|revised)\b/.test(text)) return "In Negotiation";
  return null;
}

export function parseLeasingMinutesRows(rows: any[][], opts: { knownSchemes?: Array<{ name: string }> } = {}): Omit<ParsedMinutes, "sheetName" | "weekLabel" | "weeklySheets"> {
  const warnings: string[] = [];
  const header = findHeader(rows);
  if (!header) throw Object.assign(new Error("Couldn't find the minutes header row (Property … Offers)."), { status: 400 });
  const { cols } = header;
  const schemes: Array<{ name: string; code: string | null }> = [];
  const known: Array<{ name: string }> = [...(opts.knownSchemes || [])];
  const aliases = new Map<string, string>(known.map(s => [schemeKey(s.name), s.name]));
  const addScheme = (name: string, alias?: string) => {
    if (!schemes.some(s => schemeKey(s.name) === schemeKey(name))) schemes.push({ name, code: null });
    if (!known.some(s => schemeKey(s.name) === schemeKey(name))) known.push({ name });
    aliases.set(schemeKey(name), name);
    if (alias) aliases.set(schemeKey(alias), name);
  };
  let current: { scheme: string; section: string; leaseEvents: boolean } | null = null;
  let building: string | null = null;
  const units: MinutesUnit[] = [];
  const cell = (row: any[], col: number) => (col >= 0 ? row[col] : null);

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const prop = cleanBlock(cell(row, cols.property));
    if (!prop) continue;
    const others = [cols.tenant, cols.size, cols.offers, cols.comments, ...cols.money.map(m => m.col)].filter(c => c >= 0);
    const hasData = others.some(c => clean(row[c]) !== "");
    if (!hasData) {
      const sec = sectionScheme(prop, known);
      if (sec.kind === "scheme" && sec.scheme) {
        const base = (clean(prop).match(SECTION_SUFFIX)?.[1] || "").replace(/\s+units?$/i, "").trim();
        addScheme(sec.scheme, base || undefined);
        current = { scheme: sec.scheme, section: clean(prop), leaseEvents: /opportunit|lease event/i.test(prop) };
        building = null;
      } else if (sec.kind === "subheading" && current) {
        building = clean(prop);
      }
      continue;
    }
    const { text, codes } = splitUnitCell(cell(row, cols.property));
    if (!text && !codes.length) continue;
    const prefix = unitPrefix(text, aliases, known);
    const scheme = prefix.scheme || current?.scheme || null;
    if (!scheme) { warnings.push(`Row ${i + 1}: "${text}" sits above every scheme heading — skipped.`); continue; }
    const label = tidyUnitLabel(prefix.scheme && prefix.rest ? prefix.rest : text);
    // The same unit listed twice (a stale lease-events block lower down):
    // the first listing is this week's.
    const nameKey = unitRefKey(estateUnitName(label, scheme));
    const repeat = units.find(u => (codes.length && u.unitCodes.some(c => codes.includes(c))) || unitRefKey(u.unitName) === nameKey);
    if (repeat) { warnings.push(`Row ${i + 1}: ${repeat.unitName} is listed again — kept row ${repeat.sourceRow}.`); continue; }
    const tenantText = cols.tenant >= 0 ? cleanBlock(row[cols.tenant]) : "";
    const tenantFirst = tenantText.split("\n")[0] || "";
    // "Vacant", "Former: M&S", "PC: June 2026" (a new build) — no tenant.
    const vacant = !tenantFirst || NOT_A_TENANT.test(tenantFirst);
    const offers = cols.offers >= 0 ? cleanBlock(row[cols.offers]) || null : null;
    const comments = cols.comments >= 0 ? cleanBlock(row[cols.comments]) || null : null;
    const financials = cols.money
      .map(m => {
        const raw = row[m.col];
        const v = typeof raw === "number" ? `£${Math.round(raw).toLocaleString("en-GB")}` : cleanBlock(raw).replace(/\n/g, " · ");
        return v ? `${m.label.replace(/\s+/g, " ")}: ${v}` : "";
      })
      .filter(Boolean).join("\n") || null;
    // "As per above" follows the unit above (a combined letting).
    const sameAsAbove = /^as per above/i.test(offers || "") && units.length > 0 ? units[units.length - 1] : null;
    const fromText = sameAsAbove && sameAsAbove.statusFromText ? sameAsAbove.status : statusFromMinutes(offers, comments);
    const status = fromText || (vacant ? "Vacant" : current?.leaseEvents ? "Lease Event" : "Occupied");
    units.push({
      sourceRow: i + 1,
      section: current?.section || scheme,
      scheme,
      building,
      label,
      unitName: estateUnitName(label, scheme),
      unitCodes: codes,
      tenant: vacant ? null : tenantFirst.slice(0, 200),
      vacant,
      sqft: cols.size >= 0 ? firstNumber(row[cols.size]) : null,
      leaseExpiry: dateAfter("LEX", tenantText),
      leaseBreak: dateAfter("TBO", tenantText) || dateAfter("MBO", tenantText),
      financials: financials ? financials.slice(0, 2000) : null,
      offers: offers ? offers.slice(0, 4000) : null,
      comments: comments ? comments.slice(0, 4000) : null,
      status,
      statusFromText: !!fromText,
    });
    if (!schemes.some(s => schemeKey(s.name) === schemeKey(scheme))) addScheme(scheme);
  }

  // A scheme's landlord code is the shared prefix of its units' codes
  // (CWG Yardi: 294xxxxx = Jubilee Place).
  for (const s of schemes) {
    const prefixes = units.filter(u => u.scheme === s.name).flatMap(u => u.unitCodes.map(c => c.slice(0, 3)));
    const counts = new Map<string, number>();
    for (const p of prefixes) counts.set(p, (counts.get(p) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= Math.max(2, prefixes.length * 0.6)) s.code = top[0];
  }
  return { schemes, units, warnings };
}

export async function parseLeasingMinutes(buffer: Buffer, opts: { knownSchemes?: Array<{ name: string }> } = {}): Promise<ParsedMinutes> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { cellDates: false });
  const pick = pickMinutesSheet(wb as any);
  if (!pick) throw Object.assign(new Error("No weekly tab found — expected tabs named like \"Units to let - Wc 23.03\"."), { status: 400 });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[pick.name], { header: 1, defval: null, raw: true }) as any[][];
  return { sheetName: pick.name.trim(), weekLabel: pick.weekLabel, weeklySheets: pick.weeklySheets, ...parseLeasingMinutesRows(rows, opts) };
}

// ── Plan: match minutes units to the schedule ────────────────────────────

export type LeasingRow = {
  id: string; unit_name: string | null; zone: string | null; unit_code: string | null; tenant_name: string | null;
  sqft: number | null; status: string | null; updates: string | null; financial_notes: string | null;
  lease_expiry: string | Date | null; lease_break: string | Date | null;
};

export type PlannedChange = { field: string; from: string | null; to: string | null };
export type PlannedRow = {
  action: "create" | "update" | "unchanged";
  unitId: string | null;
  unitName: string;
  scheme: string;
  sourceRow: number;
  changes: PlannedChange[];
  values: Record<string, any>;
};

export function minutesUpdateText(u: MinutesUnit, weekLabel: string | null): string | null {
  const parts = [u.offers ? `Offers: ${u.offers}` : "", u.comments ? `Comments: ${u.comments}` : ""].filter(Boolean);
  if (!parts.length) return null;
  return `Minutes ${weekLabel || ""}`.trim() + "\n" + parts.join("\n");
}

const same = (a: unknown, b: unknown) => String(a ?? "").trim() === String(b ?? "").trim();
const dayOf = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : "");

/** Match each minutes unit to a leasing row — landlord unit code first, then
 *  the name (with or without the scheme), within the scheme where the row
 *  carries one. Each row is matched at most once. */
export function planMinutesImport(parsed: Pick<ParsedMinutes, "units" | "weekLabel">, existing: LeasingRow[]): { rows: PlannedRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const used = new Set<string>();
  const out: PlannedRow[] = [];
  const free = () => existing.filter(r => !used.has(r.id));
  const noParens = (s: string | null | undefined) => String(s || "").replace(/\([^)]*\)/g, " ");
  // A bare label ("Unit 1 Building J3") only matches a row with no scheme
  // when no other unit in the minutes has that label ("Unit 3" is in three).
  const labelCount = new Map<string, number>();
  for (const u of parsed.units) { const k = unitRefKey(noParens(u.label)); labelCount.set(k, (labelCount.get(k) || 0) + 1); }
  for (const u of parsed.units) {
    const codes = new Set(u.unitCodes);
    let hit = free().find(r => r.unit_code && codes.has(String(r.unit_code).toUpperCase()));
    if (!hit) {
      const keys = new Set([unitRefKey(u.unitName), unitRefKey(noParens(u.unitName))]);
      const byName = free().filter(r => keys.has(unitRefKey(r.unit_name)) || keys.has(unitRefKey(noParens(r.unit_name))));
      const labelKey = unitRefKey(noParens(u.label));
      const byLabel = byName.length ? byName : free().filter(r => unitRefKey(noParens(r.unit_name)) === labelKey
        && (r.zone ? schemeKey(r.zone) === schemeKey(u.scheme) : labelCount.get(labelKey) === 1));
      if (byLabel.length > 1) warnings.push(`Row ${u.sourceRow}: ${u.unitName} matches ${byLabel.length} schedule rows — updated the first.`);
      hit = byLabel[0];
    }
    const values: Record<string, any> = {
      zone: u.scheme,
      unit_code: u.unitCodes[0] || null,
      tenant_name: u.tenant,
      sqft: u.sqft,
      status: u.status,
      updates: minutesUpdateText(u, parsed.weekLabel),
      financial_notes: u.financials,
      lease_expiry: u.leaseExpiry,
      lease_break: u.leaseBreak,
    };
    if (!hit) {
      out.push({ action: "create", unitId: null, unitName: u.unitName, scheme: u.scheme, sourceRow: u.sourceRow, changes: [], values: { ...values, unit_name: u.unitName } });
      continue;
    }
    used.add(hit.id);
    const changes: PlannedChange[] = [];
    const set = (field: string, to: any, from: any) => { if (to != null && to !== "" && !same(from, to)) changes.push({ field, from: from == null ? null : String(from), to: String(to) }); };
    set("zone", values.zone, hit.zone);
    if (!hit.unit_code) set("unit_code", values.unit_code, hit.unit_code);
    // Facts only fill gaps; the week's commentary always replaces last week's.
    if (!hit.tenant_name || same(hit.tenant_name, hit.unit_name)) set("tenant_name", values.tenant_name, hit.tenant_name);
    if (!hit.sqft) set("sqft", values.sqft, hit.sqft);
    if (!hit.lease_expiry) set("lease_expiry", values.lease_expiry, dayOf(hit.lease_expiry) || null);
    if (!hit.lease_break) set("lease_break", values.lease_break, dayOf(hit.lease_break) || null);
    set("updates", values.updates, hit.updates);
    set("financial_notes", values.financial_notes, hit.financial_notes);
    // Status only moves on what the week's text says, never from a guess.
    if (u.statusFromText) set("status", values.status, hit.status);
    out.push({ action: changes.length ? "update" : "unchanged", unitId: hit.id, unitName: hit.unit_name || u.unitName, scheme: u.scheme, sourceRow: u.sourceRow, changes, values });
  }
  return { rows: out, warnings };
}

// ── Apply ────────────────────────────────────────────────────────────────

export type MinutesImportResult = {
  dryRun: boolean;
  fileName: string | null;
  sheetName: string;
  weekLabel: string | null;
  weeklySheets: number;
  schemes: Array<{ name: string; code: string | null; exists: boolean }>;
  counts: { create: number; update: number; unchanged: number; statusChanges: number };
  rows: Array<Omit<PlannedRow, "values">>;
  // Schedule rows the minutes didn't mention — often the same unit under an
  // older name ("CR40" for "Crossrail Unit 40"); check before applying.
  notInMinutes: Array<{ id: string; unitName: string | null; zone: string | null }>;
  warnings: string[];
  message: string;
};

export async function importLeasingMinutes(pool: Queryable & { connect?: () => Promise<any> }, propertyId: string, buffer: Buffer, opts: { dryRun: boolean; user?: { id: string; username: string } | null; fileName?: string | null }): Promise<MinutesImportResult> {
  const { listSchemes, ensureScheme } = await import("./property-schemes");
  const property = (await pool.query(`SELECT id, name FROM crm_properties WHERE id = $1`, [propertyId])).rows[0];
  if (!property) throw Object.assign(new Error("Property not found"), { status: 404 });
  const existingSchemes = await listSchemes(pool, propertyId);
  const parsed = await parseLeasingMinutes(buffer, { knownSchemes: existingSchemes });
  const existing = (await pool.query(
    `SELECT id, unit_name, zone, unit_code, tenant_name, sqft, status, updates, financial_notes, lease_expiry, lease_break
       FROM leasing_schedule_units WHERE property_id = $1 AND coalesce(status, '') <> 'Archived' ORDER BY sort_order, id`,
    [propertyId],
  )).rows as LeasingRow[];
  const plan = planMinutesImport(parsed, existing);
  const schemes = parsed.schemes.map(s => ({ ...s, exists: !!findScheme(existingSchemes, s.name) }));
  const counts = {
    create: plan.rows.filter(r => r.action === "create").length,
    update: plan.rows.filter(r => r.action === "update").length,
    unchanged: plan.rows.filter(r => r.action === "unchanged").length,
    statusChanges: plan.rows.filter(r => r.changes.some(c => c.field === "status")).length,
  };
  const newSchemes = schemes.filter(s => !s.exists).length;
  const result: MinutesImportResult = {
    dryRun: opts.dryRun,
    fileName: opts.fileName || null,
    sheetName: parsed.sheetName,
    weekLabel: parsed.weekLabel,
    weeklySheets: parsed.weeklySheets,
    schemes,
    counts,
    rows: plan.rows.map(({ values, ...r }) => r),
    notInMinutes: existing.filter(e => !plan.rows.some(r => r.unitId === e.id)).map(e => ({ id: e.id, unitName: e.unit_name, zone: e.zone })),
    warnings: [...parsed.warnings, ...plan.warnings],
    message: `${parsed.sheetName}: ${counts.create} new units · ${counts.update} updated · ${counts.unchanged} unchanged${newSchemes ? ` · ${newSchemes} new scheme${newSchemes === 1 ? "" : "s"}` : ""}`,
  };
  if (opts.dryRun) return result;

  const client = pool.connect ? await pool.connect() : pool;
  const statusMoves: Array<{ id: string; status: string }> = [];
  const createdIds: string[] = [];
  const audit = (unitId: string, action: string, field: string | null, from: string | null, to: string | null) => client.query(
    `INSERT INTO leasing_schedule_audit (unit_id, property_id, user_id, user_name, action, field_name, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [unitId, propertyId, opts.user?.id || "system", opts.user?.username || `Minutes import${opts.fileName ? `: ${opts.fileName}` : ""}`, action, field, from, to],
  );
  try {
    await client.query("BEGIN");
    for (const s of parsed.schemes) {
      const { scheme, created } = await ensureScheme(client, propertyId, findScheme(existingSchemes, s.name)?.name || s.name, { code: s.code });
      if (!created && !scheme.code && s.code) await client.query(`UPDATE property_schemes SET code = $2, updated_at = now() WHERE id = $1`, [scheme.id, s.code]);
    }
    let sort = Number((await client.query(`SELECT coalesce(max(sort_order), 0) AS n FROM leasing_schedule_units WHERE property_id = $1`, [propertyId])).rows[0]?.n || 0);
    for (const row of plan.rows) {
      if (row.action === "create") {
        const v = row.values;
        const ins = (await client.query(
          `INSERT INTO leasing_schedule_units (property_id, unit_name, zone, unit_code, tenant_name, sqft, status, updates, financial_notes, lease_expiry, lease_break, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
          [propertyId, v.unit_name, v.zone, v.unit_code, v.tenant_name, v.sqft, v.status, v.updates, v.financial_notes, v.lease_expiry, v.lease_break, ++sort],
        )).rows[0];
        createdIds.push(ins.id);
        await audit(ins.id, "minutes_create", "unit_name", null, v.unit_name);
        continue;
      }
      if (row.action !== "update" || !row.unitId) continue;
      const sets = row.changes.map((c, i) => `${c.field} = $${i + 2}`).join(", ");
      await client.query(`UPDATE leasing_schedule_units SET ${sets}, updated_at = now() WHERE id = $1`, [row.unitId, ...row.changes.map(c => c.to)]);
      for (const c of row.changes) await audit(row.unitId, "minutes_update", c.field, c.from, c.to);
      const status = row.changes.find(c => c.field === "status");
      if (status?.to) statusMoves.push({ id: row.unitId, status: status.to });
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    if (client !== pool) client.release?.();
  }

  // After the commit, the same knit + mirror the schedule's own edits do:
  // new rows join the tenancy spine by name, status moves reach the boards.
  const { normUnitSql } = await import("./tenant-brand-resolver");
  for (const id of createdIds) {
    await pool.query(
      `UPDATE leasing_schedule_units u SET tenancy_unit_id = (
          SELECT ts.id FROM tenancy_schedule_units ts
           WHERE ts.property_id = u.property_id AND ${normUnitSql("ts.unit_number")} = ${normUnitSql("u.unit_name")} LIMIT 1)
        WHERE u.id = $1 AND u.tenancy_unit_id IS NULL`,
      [id],
    ).catch((e: any) => console.warn("[leasing-minutes] knit failed:", e?.message));
  }
  if (statusMoves.length) {
    const { mirrorFromLeasingSchedule } = await import("./lease-status-mirror");
    for (const m of statusMoves) {
      await mirrorFromLeasingSchedule(m.id, m.status, { pool: pool as any, reason: "leasing_minutes.import" })
        .catch((e: any) => result.warnings.push(`${m.id}: status saved, board sync failed (${e?.message || "error"})`));
    }
  }
  return result;
}
