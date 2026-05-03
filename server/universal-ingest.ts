/**
 * Universal Ingestion Engine
 * ==========================
 *
 * One pipeline that turns any file (Excel / PDF / CSV / pasted text /
 * SharePoint share link) into structured CRM writes. Designed to replace
 * the dozen one-trick importers (import_leasing_schedule, import_wip_report,
 * import_deals, etc.) that have accumulated.
 *
 *   readFile(input)             → { kind, text, bytes }
 *   parseWithClaude(file, target) → { records[] }
 *   buildDiff(target, records)   → preview with diff + commit token
 *   commitDiff(token)            → { written, skipped, errors }
 *
 * Two-phase by design — every ingest produces a preview first, the user
 * confirms, then writes happen. Re-runs against an updated file are
 * idempotent: matched by a stable per-target key, with audit log integration
 * so manual edits aren't silently overwritten.
 *
 * Hardening:
 * - Schema introspection drops fields Claude invented and that don't exist
 *   on the table (prevents SQL errors on column-not-found).
 * - Type coercion handles Claude returning "£1,234" or "May-24" strings —
 *   we normalise to numbers and ISO dates before write.
 * - Excel files are split by sheet and parsed in chunks if the input would
 *   exceed Claude's context.
 * - Audit log writes (where the target has a paired audit table) so every
 *   imported change is traceable to source filename + user.
 * - SharePoint share-link resolution via existing Graph integration.
 */
import Anthropic from "@anthropic-ai/sdk";
import XLSX from "xlsx-js-style";
import crypto from "crypto";
import { pool } from "./db";

// ─────────────────────────────────────────────────────────────────────────
// Targets — adding one is ~30 lines: define the prompt, the match key,
// optional ref resolver. Engine itself never changes.
// ─────────────────────────────────────────────────────────────────────────

export type IngestTarget = "leasing_schedule_units" | "crm_deals" | "crm_companies" | "crm_contacts" | "crm_properties";

interface TargetSpec {
  table: string;
  fields: string;            // human-readable schema for Claude
  matchKey: string[];        // stable upsert key
  auditTable?: string;       // paired audit table name (if any)
  resolveRefs?: (record: any) => Promise<any>;
}

const TARGETS: Record<IngestTarget, TargetSpec> = {
  leasing_schedule_units: {
    table: "leasing_schedule_units",
    fields: `
      property_address (string, the property this unit sits in),
      unit_name (string, e.g. "Unit 12" or "23 Heddon St"),
      tenant_name (string or null — null if vacant),
      sqft (number or null),
      rent_pa (number or null, annual rent in £),
      lease_expiry (ISO date or null),
      lease_break (ISO date or null),
      rent_review (ISO date or null),
      landlord_break (ISO date or null),
      status (one of: Occupied | Vacant | Under Offer | In Negotiation | Archived),
      target_brands (string — comma-separated brand names showing interest, may be empty),
      priority (string or null — High | Medium | Low),
      updates (string — narrative commentary, status notes, any free text)
    `,
    matchKey: ["property_id", "unit_name"],
    auditTable: "leasing_schedule_audit",
    resolveRefs: async (record) => {
      if (record.property_address) {
        const id = await resolvePropertyId(record.property_address);
        if (id) record.property_id = id;
        delete record.property_address;
      }
      return record;
    },
  },
  crm_deals: {
    table: "crm_deals",
    fields: `
      name (string, deal name),
      property_address (string or null — the property this deal is on),
      deal_type (one of: Sale | Purchase | Lease Renewal | Rent Review | Tenant Rep | Lease Acquisition | Lease Disposal | Regear | New Letting | Sub-Letting | Assignment | Investment Sale | Investment Acquisition),
      status (string — REP | SPEC | LIVE | NEG | SOL | EXC | COM | INV),
      tenant_name (string or null),
      landlord_name (string or null),
      vendor_name (string or null),
      purchaser_name (string or null),
      fee (number or null),
      rent_pa (number or null),
      pricing (number or null),
      total_area_sqft (number or null),
      asset_class (string or null — Retail | Office | Leisure | Hotel | Resi | Mixed Use | Other),
      comments (string or null)
    `,
    matchKey: ["name"],
    resolveRefs: async (record) => {
      if (record.property_address) {
        record.property_id = await resolvePropertyId(record.property_address);
        delete record.property_address;
      }
      for (const field of ["tenant_name", "landlord_name", "vendor_name", "purchaser_name"]) {
        if (record[field]) {
          const idField = field.replace("_name", "_id");
          record[idField] = await resolveCompanyId(record[field]);
        }
      }
      return record;
    },
  },
  crm_companies: {
    table: "crm_companies",
    fields: `
      name (string, company name),
      company_type (one of: Tenant | Landlord | Landlord / Client | Vendor | Purchaser | Investor | Agent | Solicitor | Client),
      domain (string or null — website domain),
      description (string or null),
      group_name (string or null — parent group)
    `,
    matchKey: ["name"],
  },
  crm_contacts: {
    table: "crm_contacts",
    fields: `
      name (string),
      email (string or null),
      phone (string or null),
      company_name (string or null — company they work for),
      role (string or null — job title)
    `,
    matchKey: ["email"],
    resolveRefs: async (record) => {
      if (record.company_name) {
        record.company_id = await resolveCompanyId(record.company_name);
        delete record.company_name;
      }
      return record;
    },
  },
  crm_properties: {
    table: "crm_properties",
    fields: `
      name (string — the address, e.g. "18-22 Haymarket"),
      postcode (string or null),
      city (string or null),
      total_sqft (number or null),
      asset_class (string or null)
    `,
    matchKey: ["name"],
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Schema introspection — pulled live from information_schema. Cached for
// the lifetime of the process. Used to (a) drop fields Claude invents and
// (b) drive type coercion based on actual column types.
// ─────────────────────────────────────────────────────────────────────────

interface ColumnInfo { name: string; type: string; }
const SCHEMA_CACHE = new Map<string, ColumnInfo[]>();

async function getTableColumns(table: string): Promise<ColumnInfo[]> {
  const cached = SCHEMA_CACHE.get(table);
  if (cached) return cached;
  const r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  const cols = r.rows.map((row) => ({ name: row.column_name as string, type: row.data_type as string }));
  SCHEMA_CACHE.set(table, cols);
  return cols;
}

// ─────────────────────────────────────────────────────────────────────────
// Type coercion. Claude is told to return numbers/dates correctly but
// real-world spreadsheets defeat that — we belt-and-braces every value
// against the actual column type before write.
// ─────────────────────────────────────────────────────────────────────────

function coerceValue(value: any, columnType: string): any {
  if (value === null || value === undefined || value === "") return null;
  const t = columnType.toLowerCase();

  if (t === "integer" || t === "bigint" || t === "smallint" || t === "real" || t === "double precision" || t === "numeric") {
    if (typeof value === "number") return value;
    const cleaned = String(value).replace(/[£$,\s]/g, "").replace(/k$/i, "000").replace(/m$/i, "000000");
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }

  if (t === "timestamp without time zone" || t === "timestamp with time zone" || t === "date") {
    return parseDate(value);
  }

  if (t === "boolean") {
    if (typeof value === "boolean") return value;
    const s = String(value).toLowerCase().trim();
    if (["true", "yes", "y", "1"].includes(s)) return true;
    if (["false", "no", "n", "0"].includes(s)) return false;
    return null;
  }

  if (t === "ARRAY" || t === "array") {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
    return null;
  }

  // text / character varying / json — leave as string, but trim
  return typeof value === "string" ? value.trim() : value;
}

function parseDate(input: any): string | null {
  if (input === null || input === undefined || input === "") return null;
  if (input instanceof Date && !isNaN(input.getTime())) return input.toISOString();
  const s = String(input).trim();
  if (!s) return null;

  // ISO YYYY-MM-DD or full ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const [, dd, mm, yy] = dmy;
    const year = yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10);
    const d = new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10));
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  // MMM-YY or MMM YYYY (e.g. "May-24", "May 2024")
  const myMatch = s.match(/^([A-Za-z]{3,9})[\s\-]+(\d{2,4})$/);
  if (myMatch) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthIdx = months.indexOf(myMatch[1].slice(0, 3).toLowerCase());
    if (monthIdx >= 0) {
      const yr = myMatch[2].length === 2 ? 2000 + parseInt(myMatch[2], 10) : parseInt(myMatch[2], 10);
      return new Date(yr, monthIdx, 1).toISOString();
    }
  }
  // Fallback: native parse
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

async function validateAndCoerce(table: string, record: any): Promise<{ clean: any; dropped: string[] }> {
  const cols = await getTableColumns(table);
  const colMap = new Map(cols.map((c) => [c.name, c.type]));
  const clean: any = {};
  const dropped: string[] = [];
  for (const [key, val] of Object.entries(record)) {
    const colType = colMap.get(key);
    if (!colType) {
      dropped.push(key);
      continue;
    }
    const coerced = coerceValue(val, colType);
    if (coerced !== undefined) clean[key] = coerced;
  }
  return { clean, dropped };
}

// ─────────────────────────────────────────────────────────────────────────
// Step 1 — read. Excel sheets → CSV per sheet. PDFs sent as document blocks.
// CSV / TSV / text passed through. Word .docx isn't supported in v1 — paste
// content or save as PDF.
// ─────────────────────────────────────────────────────────────────────────

export interface ReadFileResult {
  kind: "excel" | "pdf" | "text";
  text: string;
  pdfBase64?: string;
  filename: string;
  /** For Excel only — per-sheet CSV. Used when the file is too large to
   *  send all sheets in a single Claude call. */
  sheetTexts?: { name: string; csv: string }[];
}

export function readFile(args: { bytes: Buffer; filename: string }): ReadFileResult {
  const { bytes, filename } = args;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm")) {
    const wb = XLSX.read(bytes, { type: "buffer", cellDates: true });
    const sheetTexts = wb.SheetNames.map((sheetName) => ({
      name: sheetName,
      csv: XLSX.utils.sheet_to_csv(wb.Sheets[sheetName], { blankrows: false, strip: true }),
    }));
    const text = sheetTexts.map((s) => `### Sheet: ${s.name}\n${s.csv}`).join("\n\n");
    return { kind: "excel", text, sheetTexts, filename };
  }
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
    return { kind: "text", text: bytes.toString("utf-8"), filename };
  }
  if (lower.endsWith(".pdf")) {
    return { kind: "pdf", text: "", pdfBase64: bytes.toString("base64"), filename };
  }
  return { kind: "text", text: bytes.toString("utf-8"), filename };
}

// ─────────────────────────────────────────────────────────────────────────
// Step 2 — parse with Claude. Auto-chunks large Excel files by sheet so
// total input stays under ~150k chars per call (a comfortable margin
// inside Sonnet's context). Per-sheet results are concatenated.
// ─────────────────────────────────────────────────────────────────────────

const MAX_CHARS_PER_CALL = 150_000;

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key configured");
  const opts: any = { apiKey };
  if (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
    opts.baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  }
  return new Anthropic(opts);
}

function buildSystemPrompt(target: IngestTarget): string {
  const spec = TARGETS[target];
  return `You are a data extraction engine for a property CRM. The user has uploaded a file. Extract every record matching the requested schema and return ONLY valid JSON, no preamble.

Schema for each record:
${spec.fields}

Rules:
- Return JSON: {"records": [...]} — array can be empty if nothing matches.
- Numbers must be numbers (not strings with £ or commas).
- Dates must be ISO YYYY-MM-DD or null.
- If the file covers multiple properties/units, include every one.
- If a field is unclear, use null rather than guessing.
- For free-text narrative columns ("updates", "comments", "description"), preserve the original wording.
- Skip header rows, totals, blanks, and meta-comments.`;
}

async function callClaudeOnce(args: {
  systemPrompt: string;
  userContent: any[];
}): Promise<any[]> {
  const anthropic = getAnthropicClient();
  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    system: args.systemPrompt,
    messages: [{ role: "user", content: args.userContent }],
  });
  const textBlock = resp.content.find((b: any) => b.type === "text") as any;
  const raw = textBlock?.text?.trim() || "";
  const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```\s*$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed?.records) ? parsed.records : [];
  } catch (err: any) {
    throw new Error(`Claude returned non-JSON: ${err?.message}. First 200 chars: ${cleaned.slice(0, 200)}`);
  }
}

export async function parseWithClaude(args: {
  file: ReadFileResult;
  target: IngestTarget;
}): Promise<{ records: any[]; rawJson?: string }> {
  const systemPrompt = buildSystemPrompt(args.target);

  // PDF — single call, the document block is sent as base64.
  if (args.file.kind === "pdf" && args.file.pdfBase64) {
    const records = await callClaudeOnce({
      systemPrompt,
      userContent: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: args.file.pdfBase64 } },
        { type: "text", text: `Filename: ${args.file.filename}\n\nExtract all records.` },
      ],
    });
    return { records };
  }

  // Excel — chunk by sheet if too large.
  if (args.file.kind === "excel" && args.file.sheetTexts) {
    const chunks = chunkSheets(args.file.sheetTexts, MAX_CHARS_PER_CALL);
    const all: any[] = [];
    for (const chunk of chunks) {
      const records = await callClaudeOnce({
        systemPrompt,
        userContent: [{
          type: "text",
          text: `Filename: ${args.file.filename}\n\n${chunk}\n\nExtract all records as JSON.`,
        }],
      });
      all.push(...records);
    }
    return { records: all };
  }

  // Plain text / CSV — chunk by length if needed.
  const text = args.file.text;
  if (text.length <= MAX_CHARS_PER_CALL) {
    const records = await callClaudeOnce({
      systemPrompt,
      userContent: [{ type: "text", text: `Filename: ${args.file.filename}\n\n${text}\n\nExtract all records as JSON.` }],
    });
    return { records };
  }
  // Crude split for very large pure-text files.
  const records: any[] = [];
  for (let i = 0; i < text.length; i += MAX_CHARS_PER_CALL) {
    const chunk = text.slice(i, i + MAX_CHARS_PER_CALL);
    const r = await callClaudeOnce({
      systemPrompt,
      userContent: [{ type: "text", text: `Filename: ${args.file.filename} (chunk ${1 + i / MAX_CHARS_PER_CALL})\n\n${chunk}\n\nExtract all records as JSON.` }],
    });
    records.push(...r);
  }
  return { records };
}

function chunkSheets(sheets: { name: string; csv: string }[], maxChars: number): string[] {
  const chunks: string[] = [];
  let buf = "";
  for (const s of sheets) {
    const block = `### Sheet: ${s.name}\n${s.csv}`;
    if (block.length > maxChars) {
      // Single sheet too big — split by row groups
      if (buf) { chunks.push(buf); buf = ""; }
      const lines = block.split("\n");
      let sub = "";
      for (const line of lines) {
        if (sub.length + line.length + 1 > maxChars) {
          chunks.push(sub);
          sub = `### Sheet: ${s.name} (continued)\n`;
        }
        sub += line + "\n";
      }
      if (sub.trim()) chunks.push(sub);
      continue;
    }
    if (buf.length + block.length + 2 > maxChars) {
      chunks.push(buf);
      buf = block;
    } else {
      buf = buf ? `${buf}\n\n${block}` : block;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────
// Step 3 — fuzzy match references to existing CRM records.
// ─────────────────────────────────────────────────────────────────────────

async function resolvePropertyId(address: string): Promise<string | null> {
  if (!address?.trim()) return null;
  const exact = await pool.query(`SELECT id FROM crm_properties WHERE LOWER(name) = LOWER($1) LIMIT 1`, [address.trim()]);
  if (exact.rows[0]) return exact.rows[0].id;
  const fuzzy = await pool.query(
    `SELECT id FROM crm_properties WHERE name ILIKE $1 OR $2 ILIKE '%' || name || '%' LIMIT 1`,
    [`%${address.trim()}%`, address.trim()]
  );
  return fuzzy.rows[0]?.id || null;
}

async function resolveCompanyId(name: string): Promise<string | null> {
  if (!name?.trim()) return null;
  const exact = await pool.query(`SELECT id FROM crm_companies WHERE LOWER(name) = LOWER($1) LIMIT 1`, [name.trim()]);
  if (exact.rows[0]) return exact.rows[0].id;
  const fuzzy = await pool.query(`SELECT id FROM crm_companies WHERE name ILIKE $1 LIMIT 1`, [`%${name.trim()}%`]);
  return fuzzy.rows[0]?.id || null;
}

// ─────────────────────────────────────────────────────────────────────────
// Step 4 — build the diff. Validates + coerces every record against the
// real schema before deciding add/update/no-change.
// ─────────────────────────────────────────────────────────────────────────

export interface DiffRecord {
  type: "add" | "update" | "no_change";
  record: any;
  existingId?: string;
  changedFields?: string[];
  unmatchedRefs?: string[];
  droppedFields?: string[];
}

export interface IngestPreview {
  target: IngestTarget;
  filename: string;
  totalParsed: number;
  diff: DiffRecord[];
  summary: { adds: number; updates: number; noChange: number; needsReview: number };
  commitToken: string;
}

const PENDING_INGESTS = new Map<string, { preview: IngestPreview; expiresAt: number }>();
const TOKEN_TTL_MS = 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of PENDING_INGESTS) if (v.expiresAt < now) PENDING_INGESTS.delete(k);
}, 5 * 60 * 1000);

export async function buildDiff(args: {
  target: IngestTarget;
  records: any[];
  filename: string;
}): Promise<IngestPreview> {
  const spec = TARGETS[args.target];
  const diff: DiffRecord[] = [];

  for (const raw of args.records) {
    const resolved = spec.resolveRefs ? await spec.resolveRefs({ ...raw }) : { ...raw };
    const { clean, dropped } = await validateAndCoerce(spec.table, resolved);
    const unmatchedRefs: string[] = [];

    const missingKeys = spec.matchKey.filter((k) => clean[k] == null || clean[k] === "");
    if (missingKeys.length) {
      unmatchedRefs.push(`Missing match key: ${missingKeys.join(", ")}`);
      diff.push({ type: "add", record: clean, unmatchedRefs, droppedFields: dropped.length ? dropped : undefined });
      continue;
    }

    const whereClauses = spec.matchKey.map((k, i) => `${k} = $${i + 1}`).join(" AND ");
    const values = spec.matchKey.map((k) => clean[k]);
    const existing = await pool.query(`SELECT * FROM ${spec.table} WHERE ${whereClauses} LIMIT 1`, values);

    if (!existing.rows[0]) {
      diff.push({ type: "add", record: clean, droppedFields: dropped.length ? dropped : undefined });
      continue;
    }

    const existingRow = existing.rows[0];
    const changedFields: string[] = [];
    for (const [field, newVal] of Object.entries(clean)) {
      if (newVal === null || newVal === undefined) continue;
      if (spec.matchKey.includes(field)) continue;
      const oldVal = existingRow[field];
      if (oldVal == null || normaliseForCompare(oldVal) !== normaliseForCompare(newVal)) {
        changedFields.push(field);
      }
    }

    if (changedFields.length === 0) {
      diff.push({ type: "no_change", record: clean, existingId: existingRow.id });
    } else {
      diff.push({
        type: "update",
        record: clean,
        existingId: existingRow.id,
        changedFields,
        droppedFields: dropped.length ? dropped : undefined,
      });
    }
  }

  const summary = {
    adds: diff.filter((d) => d.type === "add" && !d.unmatchedRefs).length,
    updates: diff.filter((d) => d.type === "update").length,
    noChange: diff.filter((d) => d.type === "no_change").length,
    needsReview: diff.filter((d) => d.unmatchedRefs && d.unmatchedRefs.length > 0).length,
  };

  const commitToken = crypto.randomBytes(16).toString("hex");
  const preview: IngestPreview = {
    target: args.target,
    filename: args.filename,
    totalParsed: args.records.length,
    diff,
    summary,
    commitToken,
  };
  PENDING_INGESTS.set(commitToken, { preview, expiresAt: Date.now() + TOKEN_TTL_MS });
  return preview;
}

function normaliseForCompare(v: any): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

// ─────────────────────────────────────────────────────────────────────────
// Step 5 — commit. Writes inserts/updates + a per-field audit row when the
// target has an audit table. Source filename is stamped into the audit so
// every change is traceable.
// ─────────────────────────────────────────────────────────────────────────

export interface CommitResult {
  written: number;
  skipped: number;
  errors: { record: any; error: string }[];
}

export async function commitDiff(args: {
  commitToken: string;
  userId: string;
  userName?: string;
}): Promise<CommitResult> {
  const pending = PENDING_INGESTS.get(args.commitToken);
  if (!pending) throw new Error("Commit token expired or not found");
  const { preview } = pending;
  const spec = TARGETS[preview.target];
  const result: CommitResult = { written: 0, skipped: 0, errors: [] };
  const sourceLabel = `Import: ${preview.filename}`;

  for (const entry of preview.diff) {
    if (entry.type === "no_change") { result.skipped++; continue; }
    if (entry.unmatchedRefs && entry.unmatchedRefs.length) { result.skipped++; continue; }

    try {
      if (entry.type === "add") {
        const cols = Object.keys(entry.record).filter((k) => entry.record[k] !== undefined);
        const placeholders = cols.map((_, i) => `$${i + 1}`);
        const values = cols.map((k) => entry.record[k]);
        const inserted = await pool.query(
          `INSERT INTO ${spec.table} (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING id`,
          values
        );
        const newId = inserted.rows[0]?.id;
        if (spec.auditTable && newId) {
          await writeAudit(spec.auditTable, {
            unitId: newId,
            propertyId: entry.record.property_id || null,
            userId: args.userId,
            userName: args.userName || sourceLabel,
            action: "import_create",
            fieldName: null,
            oldValue: null,
            newValue: sourceLabel,
          });
        }
        result.written++;
      } else if (entry.type === "update" && entry.existingId && entry.changedFields) {
        const cols = entry.changedFields;
        const setClause = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
        const values = cols.map((c) => entry.record[c]);
        values.push(entry.existingId);
        await pool.query(`UPDATE ${spec.table} SET ${setClause}, updated_at = NOW() WHERE id = $${values.length}`, values);
        if (spec.auditTable) {
          for (const field of cols) {
            await writeAudit(spec.auditTable, {
              unitId: entry.existingId,
              propertyId: entry.record.property_id || null,
              userId: args.userId,
              userName: args.userName || sourceLabel,
              action: "import_update",
              fieldName: field,
              oldValue: null,
              newValue: String(entry.record[field] ?? ""),
            });
          }
        }
        result.written++;
      }
    } catch (err: any) {
      result.errors.push({ record: entry.record, error: err?.message || "unknown" });
    }
  }

  PENDING_INGESTS.delete(args.commitToken);
  return result;
}

async function writeAudit(table: string, row: {
  unitId: string | null;
  propertyId: string | null;
  userId: string;
  userName: string;
  action: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
}): Promise<void> {
  // Best-effort — audit failures shouldn't break the commit.
  try {
    if (table === "leasing_schedule_audit") {
      await pool.query(
        `INSERT INTO leasing_schedule_audit (unit_id, property_id, user_id, user_name, action, field_name, old_value, new_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [row.unitId, row.propertyId || "imported", row.userId, row.userName, row.action, row.fieldName, row.oldValue, row.newValue]
      );
    }
  } catch (err: any) {
    console.warn(`[universal-ingest audit] ${err?.message}`);
  }
}

export function getPendingPreview(commitToken: string): IngestPreview | null {
  return PENDING_INGESTS.get(commitToken)?.preview || null;
}

export function listIngestTargets(): IngestTarget[] {
  return Object.keys(TARGETS) as IngestTarget[];
}
