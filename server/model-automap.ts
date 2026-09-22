/**
 * model-automap.ts — AI-assisted input/output mapping proposal for Excel templates.
 *
 * A template becomes drivable by the engine (Run / Sensitivity / Smart Run /
 * Compare / Batch) once it has an inputMapping and outputMapping. Writing those
 * by hand meant opening the workbook and noting cell addresses — this module
 * builds a compact structural digest of the workbook, asks Claude to classify
 * inputs and outputs, and validates the proposal against the actual cells
 * (inputs must be constants, outputs should be formulas).
 *
 * A deterministic keyword heuristic covers the no-AI path and the tests.
 */

import XLSX from "xlsx-js-style";
import { getAnthropicClient, CHATBGP_MODEL } from "./utils/anthropic-client";

export interface DigestCell {
  addr: string;
  kind: "const" | "formula";
  value?: string;
  label?: string;
}

export interface DigestSheet {
  name: string;
  cells: DigestCell[];
}

export interface WorkbookDigest {
  sheets: DigestSheet[];
  names: { name: string; ref: string }[];
}

export interface ProposedCell {
  sheet: string;
  cell: string;
  label: string;
  type?: string;   // inputs: number | percent | text
  format?: string; // outputs: percent | number0 | number2 | text
  group?: string;
}

export interface AutoMapProposal {
  inputs: Record<string, ProposedCell>;
  outputs: Record<string, ProposedCell>;
  warnings: string[];
  source: "ai" | "heuristic";
}

const MAX_CELLS_PER_SHEET = 80;
const MAX_SHEETS = 12;
const MAX_LABEL_LEN = 60;
const MAX_VALUE_LEN = 40;

function isLabelish(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s.length > MAX_LABEL_LEN) return false;
  if (!isNaN(Number(s))) return false;
  if (/^[=+\-@]/.test(s)) return false;
  return /[a-zA-Z]/.test(s);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Label for a value cell: nearest label text to the left, else above. */
function findLabel(ws: XLSX.WorkSheet, r: number, c: number): string | undefined {
  for (const [dr, dc] of [[0, -1], [-1, 0], [0, -2]] as const) {
    const cell = ws[XLSX.utils.encode_cell({ r: r + dr, c: c + dc })];
    if (cell && !cell.f && isLabelish(cell.v)) return cell.v.trim();
  }
  return undefined;
}

export function buildWorkbookDigest(wb: XLSX.WorkBook): WorkbookDigest {
  const sheets: DigestSheet[] = [];
  for (const name of wb.SheetNames.slice(0, MAX_SHEETS)) {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const cells: DigestCell[] = [];
    for (let r = range.s.r; r <= range.e.r && cells.length < MAX_CELLS_PER_SHEET; r++) {
      for (let c = range.s.c; c <= range.e.c && cells.length < MAX_CELLS_PER_SHEET; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell) continue;
        if (cell.f) {
          const label = findLabel(ws, r, c);
          if (label) cells.push({ addr: XLSX.utils.encode_cell({ r, c }), kind: "formula", label: truncate(label, MAX_LABEL_LEN) });
        } else if (cell.v !== undefined && cell.v !== null && cell.v !== "") {
          if (isLabelish(cell.v)) continue; // labels themselves are context, not candidates
          const label = findLabel(ws, r, c);
          if (!label) continue; // orphan constants carry no semantics
          cells.push({
            addr: XLSX.utils.encode_cell({ r, c }),
            kind: "const",
            label: truncate(label, MAX_LABEL_LEN),
            value: truncate(String(cell.v), MAX_VALUE_LEN),
          });
        }
      }
    }
    if (cells.length) sheets.push({ name, cells });
  }
  const names = (wb.Workbook?.Names || [])
    .filter((n) => n.Name && n.Ref && !n.Name.startsWith("_"))
    .map((n) => ({ name: n.Name, ref: n.Ref }));
  return { sheets, names };
}

// ── Deterministic heuristic (no AI) ─────────────────────────────────────────

const INPUT_KEYWORDS: [RegExp, string][] = [
  [/purchase|price|consideration/i, "Pricing"],
  [/stamp|duty|s d l t/i, "Pricing"],
  [/rent|erv|income|area|sq\s?ft|void|free/i, "Income"],
  [/growth|inflation/i, "Income"],
  [/fee|cost|opex|capex|vacan|management/i, "Costs"],
  [/ltv|loan|interest|debt|term|amortis|arrangement/i, "Financing"],
  [/exit|cap rate|disposal|hold/i, "Exit"],
  [/tax/i, "Tax"],
];

const OUTPUT_KEYWORDS: [RegExp, string][] = [
  [/irr|internal rate/i, "Returns"],
  [/moic|multiple/i, "Returns"],
  [/profit|return on/i, "Returns"],
  [/yield|niy/i, "Yields"],
  [/exit value|gross exit|net exit|terminal/i, "Exit"],
  [/equity|loan amount|total acquisition/i, "Financing"],
  [/npv|cash on cash/i, "Returns"],
];

const PERCENT_HINT = /%|percent|rate|growth|cap\b|ltv|fee|duty|tax|vacan|inflation|yield|irr|margin/i;

function camelize(label: string): string {
  const words = label.replace(/\([^)]*\)/g, "").replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.map((w, i) => {
    const isAcronym = w.length > 1 && w === w.toUpperCase();
    if (isAcronym) return i === 0 ? w.toLowerCase() : w; // IRR, NIY, LTV stay recognisable
    return i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase();
  }).join("");
}

function classifyGroup(label: string, table: [RegExp, string][]): string | null {
  for (const [re, group] of table) if (re.test(label)) return group;
  return null;
}

function uniqueKey(base: string, taken: Set<string>): string {
  let key = base || "field";
  let i = 2;
  while (taken.has(key)) key = `${base}${i++}`;
  taken.add(key);
  return key;
}

export function heuristicAutoMap(digest: WorkbookDigest): AutoMapProposal {
  const inputs: Record<string, ProposedCell> = {};
  const outputs: Record<string, ProposedCell> = {};
  const warnings: string[] = [];
  const takenIn = new Set<string>();
  const takenOut = new Set<string>();

  for (const sheet of digest.sheets) {
    for (const cell of sheet.cells) {
      if (!cell.label) continue;
      if (cell.kind === "const") {
        const group = classifyGroup(cell.label, INPUT_KEYWORDS);
        if (!group) continue;
        const num = cell.value !== undefined ? Number(cell.value) : NaN;
        const isNumeric = cell.value !== undefined && !isNaN(num) && cell.value.trim() !== "";
        const isPercent = isNumeric && Math.abs(num) < 1 && num !== 0 && PERCENT_HINT.test(cell.label);
        // Excel date serials masquerade as numbers; skip them as scenario inputs
        if (isNumeric && num > 20000 && num < 80000 && /date/i.test(cell.label)) continue;
        inputs[uniqueKey(camelize(cell.label), takenIn)] = {
          sheet: sheet.name,
          cell: cell.addr,
          label: cell.label,
          type: isPercent ? "percent" : isNumeric ? "number" : "text",
          group,
        };
      } else {
        const group = classifyGroup(cell.label, OUTPUT_KEYWORDS);
        if (!group) continue;
        outputs[uniqueKey(camelize(cell.label), takenOut)] = {
          sheet: sheet.name,
          cell: cell.addr,
          label: cell.label,
          format: PERCENT_HINT.test(cell.label) ? "percent" : /moic|multiple|cover|times|x$/i.test(cell.label) ? "number2" : "number0",
          group,
        };
      }
    }
  }
  if (!Object.keys(inputs).length) warnings.push("Heuristic found no labelled constant cells to use as inputs.");
  if (!Object.keys(outputs).length) warnings.push("Heuristic found no labelled formula cells to use as outputs.");
  return { inputs, outputs, warnings, source: "heuristic" };
}

// ── Validation against the digest ───────────────────────────────────────────

export function validateProposal(
  digest: WorkbookDigest,
  inputs: Record<string, ProposedCell>,
  outputs: Record<string, ProposedCell>,
): AutoMapProposal {
  const cellIndex = new Map<string, DigestCell>();
  for (const s of digest.sheets) for (const c of s.cells) cellIndex.set(`${s.name}!${c.addr}`, c);
  const warnings: string[] = [];

  const clean = (
    map: Record<string, ProposedCell>,
    role: "input" | "output",
  ): Record<string, ProposedCell> => {
    const out: Record<string, ProposedCell> = {};
    for (const [key, m] of Object.entries(map || {})) {
      if (!m || typeof m !== "object" || !m.sheet || !m.cell) {
        warnings.push(`Dropped ${role} "${key}": missing sheet/cell.`);
        continue;
      }
      const found = cellIndex.get(`${m.sheet}!${m.cell}`);
      if (!found) {
        warnings.push(`Dropped ${role} "${key}" (${m.sheet}!${m.cell}): cell not found or has no nearby label.`);
        continue;
      }
      if (role === "input" && found.kind !== "const") {
        warnings.push(`Dropped input "${key}" (${m.sheet}!${m.cell}): it contains a formula — inputs must be constants.`);
        continue;
      }
      if (role === "output" && found.kind !== "formula") {
        warnings.push(`Output "${key}" (${m.sheet}!${m.cell}) is a constant, not a formula — values will not respond to inputs.`);
      }
      out[key] = {
        sheet: m.sheet,
        cell: m.cell,
        label: String(m.label || found.label || key),
        ...(role === "input" ? { type: m.type === "percent" || m.type === "text" ? m.type : "number" } : {}),
        ...(role === "output" ? { format: ["percent", "number0", "number2", "text"].includes(m.format || "") ? m.format : "number0" } : {}),
        ...(m.group ? { group: String(m.group) } : {}),
      };
    }
    return out;
  };

  return { inputs: clean(inputs, "input"), outputs: clean(outputs, "output"), warnings, source: "heuristic" };
}

// ── AI proposal ─────────────────────────────────────────────────────────────

const AUTOMAP_SYSTEM = `You are mapping an Excel financial model so a calculation engine can drive it.
Given a structural digest of the workbook (labelled constant and formula cells), choose:
- INPUTS: labelled CONSTANT cells a user would change per scenario (price, rent, rates, terms, growth, costs). Never a formula cell. Skip dates and sensitivity-table headers.
- OUTPUTS: labelled FORMULA cells a user would read as results (IRR, MOIC, profit, yields, exit value, equity, loan). Prefer headline/summary cells over per-quarter columns.

Rules:
- key: short camelCase semantic id (purchasePrice, exitCapRate, unleveredIRR).
- input type: "percent" when the value is a decimal fraction used as a percentage (0.055 = 5.5%), else "number" or "text".
- output format: "percent" for rates/yields/IRR, "number2" for multiples, "number0" for money, "text" otherwise.
- group inputs/outputs from: Pricing, Income, Costs, Financing, Exit, Returns, Yields, Tax, Other.
- Reply with STRICT JSON only: {"inputs": {key: {sheet, cell, label, type, group}}, "outputs": {key: {sheet, cell, label, format, group}}}. No markdown, no commentary.`;

function digestToPrompt(digest: WorkbookDigest): string {
  const parts: string[] = [];
  for (const s of digest.sheets) {
    parts.push(`SHEET "${s.name}":`);
    for (const c of s.cells) {
      parts.push(`  ${c.addr} | ${c.kind} | ${c.value ?? ""} | label: ${c.label}`);
    }
  }
  if (digest.names.length) {
    parts.push("DEFINED NAMES: " + digest.names.map((n) => `${n.name}=${n.ref}`).join(", "));
  }
  return parts.join("\n");
}

function extractJson(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in response");
  return JSON.parse(text.slice(start, end + 1));
}

export async function autoMapWorkbook(wb: XLSX.WorkBook, opts: { useAI?: boolean } = {}): Promise<AutoMapProposal> {
  const digest = buildWorkbookDigest(wb);
  const aiOk = opts.useAI !== false && Boolean(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
  if (!aiOk) return heuristicAutoMap(digest);

  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: CHATBGP_MODEL,
      max_tokens: 4096,
      system: AUTOMAP_SYSTEM,
      messages: [{ role: "user", content: digestToPrompt(digest) }],
    });
    const text = response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const parsed = extractJson(text);
    const validated = validateProposal(digest, parsed.inputs || {}, parsed.outputs || {});
    validated.source = "ai";
    if (!Object.keys(validated.inputs).length && !Object.keys(validated.outputs).length) {
      return heuristicAutoMap(digest); // AI returned nothing usable
    }
    return validated;
  } catch (err: any) {
    const fallback = heuristicAutoMap(digest);
    fallback.warnings.unshift(`AI mapping unavailable (${err?.message || err}); used keyword heuristic instead.`);
    return fallback;
  }
}
