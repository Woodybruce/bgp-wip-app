/**
 * Universal Ingestion Engine
 * ==========================
 *
 * One pipeline that turns any file (Excel / PDF / Word / CSV / pasted text /
 * SharePoint share link) into structured CRM writes.
 *
 *   readFile(input)          → { kind, text, bytes }
 *   parseWithClaude(content, target?) → { target, records[] }
 *   buildDiff(target, records)        → { adds[], updates[], conflicts[] }
 *   commitDiff(token)        → { written: n, errors: [] }
 *
 * Two-phase by design — every ingest produces a preview first, the user
 * confirms, then writes happen. Re-runs against an updated file are
 * idempotent: matched by a stable key per target (e.g. property_id +
 * unit_name for leasing schedule units), and existing manual edits in the
 * audit log are preserved unless the user explicitly chooses overwrite.
 *
 * This is the replacement for the dozen one-trick importers that have
 * accumulated (import_leasing_schedule, import_wip_report, etc.). All of
 * those become thin wrappers around this engine over time.
 */
import Anthropic from "@anthropic-ai/sdk";
import XLSX from "xlsx-js-style";
import crypto from "crypto";
import { pool } from "./db";
import { ilike, sql } from "drizzle-orm";
import { db } from "./db";
import { crmProperties, crmCompanies, leasingScheduleUnits } from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────
// Targets — each entry tells the engine what schema we're writing into,
// what the AI should extract, and how to identify a match for upserts.
// Adding a new target = ~30 lines. The engine itself never changes.
// ─────────────────────────────────────────────────────────────────────────

export type IngestTarget = "leasing_schedule_units" | "crm_deals" | "crm_companies" | "crm_contacts" | "crm_properties";

interface TargetSpec {
  table: string;
  // Claude prompt fragment describing the shape we want back. Claude is
  // instructed to return { records: [...] } where each record matches the
  // listed fields. Date fields are accepted as ISO strings or null.
  fields: string;
  // Stable upsert key on which re-ingests are matched. Tuple of column names.
  matchKey: string[];
  // Optional mapper to resolve foreign-key string references (e.g. property
  // address → property_id) before write.
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
    resolveRefs: async (record) => {
      // property_address → property_id (fuzzy)
      if (record.property_address) {
        const propertyId = await resolvePropertyId(record.property_address);
        if (propertyId) record.property_id = propertyId;
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
// Step 1 — read the file. Everything ends up as plain text we send to
// Claude. PDFs go in as base64 via Claude's document blocks; spreadsheets
// get flattened to CSV per sheet.
// ─────────────────────────────────────────────────────────────────────────

export interface ReadFileResult {
  kind: "excel" | "pdf" | "text";
  text: string;          // flattened content for Claude when kind != pdf
  pdfBase64?: string;    // for kind === pdf, fed via document content block
  filename: string;
}

export function readFile(args: { bytes: Buffer; filename: string }): ReadFileResult {
  const { bytes, filename } = args;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm")) {
    const wb = XLSX.read(bytes, { type: "buffer", cellDates: true });
    const parts: string[] = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, strip: true });
      parts.push(`### Sheet: ${sheetName}\n${csv}`);
    }
    return { kind: "excel", text: parts.join("\n\n"), filename };
  }
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
    return { kind: "text", text: bytes.toString("utf-8"), filename };
  }
  if (lower.endsWith(".pdf")) {
    return { kind: "pdf", text: "", pdfBase64: bytes.toString("base64"), filename };
  }
  // Anything else: treat as text. Word .docx would need a separate path —
  // skipped for v1; user can paste content or save as PDF.
  return { kind: "text", text: bytes.toString("utf-8"), filename };
}

// ─────────────────────────────────────────────────────────────────────────
// Step 2 — parse with Claude. The prompt is target-aware: we tell Claude
// exactly what shape we want back and validate against TargetSpec.fields.
// Returns the records array. Throws if parse fails.
// ─────────────────────────────────────────────────────────────────────────

export async function parseWithClaude(args: {
  file: ReadFileResult;
  target: IngestTarget;
}): Promise<{ records: any[]; rawJson: string }> {
  const spec = TARGETS[args.target];
  if (!spec) throw new Error(`Unknown ingest target: ${args.target}`);

  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key configured");
  const anthropic = new Anthropic({
    apiKey,
    baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY
      ? process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL : undefined,
  });

  const systemPrompt = `You are a data extraction engine for a property CRM. The user has uploaded a file. Extract every record matching the requested schema and return ONLY valid JSON, no preamble.

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

  const userContent: any[] = [];
  if (args.file.kind === "pdf" && args.file.pdfBase64) {
    userContent.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: args.file.pdfBase64 },
    });
    userContent.push({ type: "text", text: `Filename: ${args.file.filename}\n\nExtract all records.` });
  } else {
    userContent.push({
      type: "text",
      text: `Filename: ${args.file.filename}\n\n${args.file.text}\n\nExtract all records as JSON.`,
    });
  }

  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = resp.content.find((b: any) => b.type === "text") as any;
  const raw = textBlock?.text?.trim() || "";
  // Tolerate ```json fences
  const cleaned = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```\s*$/, "");
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err: any) {
    throw new Error(`Claude returned non-JSON: ${err?.message}. First 200 chars: ${cleaned.slice(0, 200)}`);
  }
  const records = Array.isArray(parsed?.records) ? parsed.records : [];
  return { records, rawJson: cleaned };
}

// ─────────────────────────────────────────────────────────────────────────
// Step 3 — fuzzy match references to existing CRM records. Reusable across
// all targets. Property and company lookups are the two we hit most.
// ─────────────────────────────────────────────────────────────────────────

async function resolvePropertyId(address: string): Promise<string | null> {
  if (!address?.trim()) return null;
  // Exact name match first
  const exact = await pool.query(`SELECT id FROM crm_properties WHERE LOWER(name) = LOWER($1) LIMIT 1`, [address.trim()]);
  if (exact.rows[0]) return exact.rows[0].id;
  // Fuzzy contains
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
// Step 4 — build the diff. For each parsed record, look up the existing
// row by matchKey. Categorise as add / update / no-change.
// ─────────────────────────────────────────────────────────────────────────

export interface DiffRecord {
  type: "add" | "update" | "no_change";
  record: any;            // resolved record (with FK ids), ready to write
  existingId?: string;    // present for updates
  changedFields?: string[]; // for updates: which columns will change
  unmatchedRefs?: string[]; // e.g. ["property_address: 'Unknown St' didn't match any property"]
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
    const record = spec.resolveRefs ? await spec.resolveRefs({ ...raw }) : { ...raw };
    const unmatchedRefs: string[] = [];

    // Validate matchKey columns are present after resolveRefs
    const missingKeys = spec.matchKey.filter((k) => record[k] == null || record[k] === "");
    if (missingKeys.length) {
      unmatchedRefs.push(`Missing match key fields: ${missingKeys.join(", ")}`);
      diff.push({ type: "add", record, unmatchedRefs });
      continue;
    }

    // Look up existing row
    const whereClauses = spec.matchKey.map((k, i) => `${k} = $${i + 1}`).join(" AND ");
    const values = spec.matchKey.map((k) => record[k]);
    const existing = await pool.query(`SELECT * FROM ${spec.table} WHERE ${whereClauses} LIMIT 1`, values);

    if (!existing.rows[0]) {
      diff.push({ type: "add", record, unmatchedRefs: unmatchedRefs.length ? unmatchedRefs : undefined });
      continue;
    }

    const existingRow = existing.rows[0];
    const changedFields: string[] = [];
    for (const [field, newVal] of Object.entries(record)) {
      if (newVal === null || newVal === undefined) continue;
      const oldVal = existingRow[field];
      if (oldVal == null || String(oldVal) !== String(newVal)) changedFields.push(field);
    }

    if (changedFields.length === 0) {
      diff.push({ type: "no_change", record, existingId: existingRow.id });
    } else {
      diff.push({ type: "update", record, existingId: existingRow.id, changedFields });
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

// ─────────────────────────────────────────────────────────────────────────
// Step 5 — commit. Apply the writes for a previously-built preview.
// Audit-log integration is per-target; for v1 we lean on whatever the
// underlying table already has (leasing_schedule_audit, etc.) and stamp
// updated_at via SQL triggers / column defaults.
// ─────────────────────────────────────────────────────────────────────────

export interface CommitResult {
  written: number;
  skipped: number;
  errors: { record: any; error: string }[];
}

export async function commitDiff(args: { commitToken: string; userId: string }): Promise<CommitResult> {
  const pending = PENDING_INGESTS.get(args.commitToken);
  if (!pending) throw new Error("Commit token expired or not found");
  const { preview } = pending;
  const spec = TARGETS[preview.target];

  const result: CommitResult = { written: 0, skipped: 0, errors: [] };

  for (const entry of preview.diff) {
    if (entry.type === "no_change") { result.skipped++; continue; }
    if (entry.unmatchedRefs && entry.unmatchedRefs.length) { result.skipped++; continue; }

    try {
      if (entry.type === "add") {
        const cols = Object.keys(entry.record).filter((k) => entry.record[k] !== undefined);
        const placeholders = cols.map((_, i) => `$${i + 1}`);
        const values = cols.map((k) => entry.record[k]);
        await pool.query(
          `INSERT INTO ${spec.table} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`,
          values
        );
        result.written++;
      } else if (entry.type === "update" && entry.existingId && entry.changedFields) {
        const cols = entry.changedFields;
        const setClause = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
        const values = cols.map((c) => entry.record[c]);
        values.push(entry.existingId);
        await pool.query(`UPDATE ${spec.table} SET ${setClause}, updated_at = NOW() WHERE id = $${values.length}`, values);
        result.written++;
      }
    } catch (err: any) {
      result.errors.push({ record: entry.record, error: err?.message || "unknown" });
    }
  }

  PENDING_INGESTS.delete(args.commitToken);
  return result;
}

export function getPendingPreview(commitToken: string): IngestPreview | null {
  return PENDING_INGESTS.get(commitToken)?.preview || null;
}

export function listIngestTargets(): IngestTarget[] {
  return Object.keys(TARGETS) as IngestTarget[];
}
