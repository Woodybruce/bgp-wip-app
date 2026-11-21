// Deleting AML records after five years (Woody, 19 November 2026). The rules
// are shared/aml-retention.ts. Nothing here runs by itself, at boot or on a
// timer: the Nominated Officer or the Deputy (admins while no Nominated
// Officer is set) previews what is due and ticks what goes.
//
//   POST /api/aml-retention/preview   what is due now; the ids are kept for the hour
//   POST /api/aml-retention/apply     { ids, confirm: "DELETE" } the ticked ids of your own preview
//   GET  /api/aml-retention/log       what was deleted, when and by whom (no personal data)
//
// Each item is checked again and deleted in its own transaction, then logged.

import { Router, type Request, type Response } from "express";
import type { PoolClient } from "pg";
import { pool } from "./db";
import {
  RETENTION_CONFIRM_WORD, RETENTION_PREVIEW_MINUTES, dealRetention, parseRetentionItemId, partyRetention, retentionCutoff, retentionItemId,
  type PartyRetentionFacts, type RetentionItem,
} from "@shared/aml-retention";
import { CLOSED_STATUSES, legacyToCode } from "@shared/deal-status";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export const AML_RETENTION_LOG_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS aml_deletion_log (
     id SERIAL PRIMARY KEY, deleted_at TIMESTAMP NOT NULL DEFAULT now(),
     deleted_by VARCHAR, deleted_by_name TEXT, category TEXT NOT NULL, item_id TEXT NOT NULL,
     counts JSONB, why TEXT)`,
];

const PREVIEW_KEY = "aml_retention:preview";

// Every table that holds a party's AML records: the party's column, and the
// date that says how old the record is.
const PARTY_TABLES: Array<{ table: string; party: string; at: string }> = [
  { table: "kyc_documents", party: "company_id", at: "uploaded_at" },
  { table: "kyc_investigations", party: "crm_company_id", at: "conducted_at" },
  { table: "kyc_upload_tokens", party: "company_id", at: "COALESCE(completed_at, created_at)" },
  { table: "veriff_sessions", party: "company_id", at: "COALESCE(received_at, created_at)" },
  { table: "kyc4u_requests", party: "COALESCE(company_id, company_id_manual)", at: "COALESCE(modified_at_source, created_at_source, synced_at)" },
  { table: "kyc4u_drafts", party: "company_id", at: "created_at" },
  { table: "kyc_flag_reviews", party: "company_id", at: "COALESCE(restored_at, set_aside_at)" },
  { table: "kyc_party_exemptions", party: "company_id", at: "COALESCE(undone_at, set_at)" },
  { table: "kyc_public_figure_checks", party: "company_id", at: "COALESCE(withdrawn_at, verified_at)" },
  { table: "kyc_abroad_records", party: "company_id", at: "COALESCE(removed_at, added_at)" },
  { table: "kyc4u_archive_files", party: "company_id", at: "COALESCE(modified_at, copied_at, listed_at)" },
  { table: "kyc_audit_log", party: "company_id", at: "created_at" },
  { table: "aml_recheck_reminders", party: "company_id", at: "COALESCE(completed_at, created_at)" },
];

// The AML columns cleared on records that stay (a company, its companies
// that sign, a deal). Set to their defaults, so a cleared record reads as a
// new one.
const COMPANY_AML_COLUMNS = ["kyc_status", "kyc_checked_at", "kyc_approved_by", "kyc_expires_at", "aml_checklist", "aml_risk_level", "aml_pep_status",
  "aml_source_of_wealth", "aml_source_of_wealth_notes", "aml_edd_required", "aml_edd_reason", "aml_notes", "aml_fee_earner_approved_by",
  "aml_fee_earner_approved_at", "aml_cdd_form", "kyc4u_request_key"];
const ENTITY_AML_COLUMNS = ["kyc_status", "kyc_expires_at", "kyc_approved_at", "kyc_approved_by", "aml_risk_level", "sanctions_screen", "last_checked_at"];
const DEAL_AML_COLUMNS = ["aml_check_completed", "kyc_approved", "kyc_approved_at", "kyc_approved_by", "aml_risk_level", "aml_source_of_funds",
  "aml_source_of_funds_notes", "aml_source_of_wealth", "aml_source_of_wealth_notes", "aml_pep_status", "aml_pep_notes", "aml_edd_required",
  "aml_edd_reason", "aml_edd_completed_at", "aml_edd_completed_by", "aml_edd_notes", "aml_id_verified", "aml_id_verified_at", "aml_id_verified_by",
  "aml_id_doc_type", "aml_address_verified", "aml_address_doc_type", "aml_sar_filed", "aml_sar_reference", "aml_sar_filed_at", "aml_compliance_notes",
  "aml_checklist", "aml_sof_analysis", "aml_ai_triage", "aml_market_data", "aml_mlro_report_url"];
// A deal holds AML fields when any of these is set.
const DEAL_HAS_AML = `(aml_check_completed IS NOT NULL OR kyc_approved_at IS NOT NULL OR aml_risk_level IS NOT NULL OR aml_pep_status IS NOT NULL
  OR aml_source_of_funds IS NOT NULL OR aml_sof_analysis IS NOT NULL OR aml_checklist IS NOT NULL OR aml_ai_triage IS NOT NULL
  OR aml_id_verified_at IS NOT NULL OR aml_edd_completed_at IS NOT NULL OR aml_compliance_notes IS NOT NULL OR aml_mlro_report_url IS NOT NULL)`;

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const isoDay = (v: unknown): string | null => (v ? new Date(v as any).toISOString().slice(0, 10) : null);
const isClosed = (status: unknown) => {
  const code = legacyToCode(String(status || ""));
  return !!code && (CLOSED_STATUSES as string[]).includes(code);
};

async function existingTables(db: Db, names: string[]): Promise<Set<string>> {
  const { rows } = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`, [names]);
  return new Set(rows.map((r: any) => String(r.table_name)));
}
async function existingColumns(db: Db, table: string, names: string[]): Promise<string[]> {
  const { rows } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = ANY($2::text[])`, [table, names]);
  return rows.map((r: any) => String(r.column_name)).filter(c => /^[a-z0-9_]+$/.test(c));
}

/** The stored file a document's address names (only the app's own store). */
export function storageKeyFromUrl(url: unknown): string | null {
  const m = /\/api\/chat-media\/([^?#]+)/.exec(String(url || ""));
  if (!m) return null;
  try { return `chat-media/${decodeURIComponent(m[1])}`; } catch { return null; }
}

// ── What is due ─────────────────────────────────────────────────────────────

/** The facts about each party with AML records (one company, or every one when no list is given). */
export async function partyFacts(db: Db, only?: string[]): Promise<Map<string, PartyRetentionFacts & { counts: Record<string, number> }>> {
  const tables = await existingTables(db, [...PARTY_TABLES.map(t => t.table), "crm_entity_kyc", "crm_trading_entities", "aml_internal_reports"]);
  const facts = new Map<string, PartyRetentionFacts & { counts: Record<string, number> }>();
  const touch = (id: string) => {
    let f = facts.get(id);
    if (!f) { f = { liveDeals: 0, lastDealEndedAt: null, latestRecordAt: null, openRegisterEntries: 0, counts: {} }; facts.set(id, f); }
    return f;
  };
  const filter = (col: string, n: number) => (only ? ` AND ${col} = ANY($${n}::varchar[])` : "");
  const params = only ? [only] : [];
  const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
  for (const t of PARTY_TABLES) {
    if (!tables.has(t.table)) continue;
    const { rows } = await db.query(
      `SELECT ${t.party} AS party, max(${t.at}) AS latest, count(*)::int AS n FROM ${t.table} WHERE ${t.party} IS NOT NULL${filter(t.party, 1)} GROUP BY 1`, params);
    for (const r of rows) {
      const f = touch(String(r.party));
      f.latestRecordAt = later(f.latestRecordAt, isoDay(r.latest));
      f.counts[t.table] = (f.counts[t.table] || 0) + Number(r.n || 0);
    }
  }
  if (tables.has("crm_entity_kyc") && tables.has("crm_trading_entities")) {
    const { rows } = await db.query(
      `SELECT e.parent_company_id AS party, max(COALESCE(k.updated_at, k.created_at)) AS latest, count(*)::int AS n
         FROM crm_entity_kyc k JOIN crm_trading_entities e ON e.id::text = k.entity_id
        WHERE k.entity_kind = 'trading_entity'${filter("e.parent_company_id", 1)} GROUP BY 1`, params);
    for (const r of rows) {
      const f = touch(String(r.party));
      f.latestRecordAt = later(f.latestRecordAt, isoDay(r.latest));
      f.counts.crm_entity_kyc = Number(r.n || 0);
    }
  }
  // A company whose own record carries AML fields, with the dates it gives.
  const { rows: companies } = await db.query(
    `SELECT id, GREATEST(kyc_checked_at, aml_fee_earner_approved_at) AS latest FROM crm_companies
      WHERE (kyc_status IS NOT NULL OR kyc_checked_at IS NOT NULL OR aml_checklist IS NOT NULL OR aml_cdd_form IS NOT NULL)${filter("id", 1)}`, params)
    .catch(() => ({ rows: [] as any[] }));
  for (const r of companies) {
    const f = touch(String(r.id));
    f.latestRecordAt = later(f.latestRecordAt, isoDay(r.latest));
    f.counts.company_fields = 1;
  }
  const ids = [...facts.keys()];
  if (!ids.length) return facts;
  const { rows: deals } = await db.query(
    `SELECT status, completed_at, invoiced_at, updated_at, created_at, landlord_id, tenant_id, vendor_id, purchaser_id FROM crm_deals
      WHERE landlord_id = ANY($1::varchar[]) OR tenant_id = ANY($1::varchar[]) OR vendor_id = ANY($1::varchar[]) OR purchaser_id = ANY($1::varchar[])`, [ids]);
  for (const d of deals) {
    const ended = isoDay(d.completed_at || d.invoiced_at || d.updated_at || d.created_at);
    for (const p of new Set([d.landlord_id, d.tenant_id, d.vendor_id, d.purchaser_id].filter(Boolean).map(String))) {
      const f = facts.get(p);
      if (!f) continue;
      if (isClosed(d.status)) f.lastDealEndedAt = later(f.lastDealEndedAt, ended);
      else f.liveDeals++;
    }
  }
  if (tables.has("aml_internal_reports")) {
    const { rows } = await db.query(`SELECT company_id, count(*)::int AS n FROM aml_internal_reports WHERE status = 'open' AND company_id = ANY($1::varchar[]) GROUP BY 1`, [ids]);
    for (const r of rows) { const f = facts.get(String(r.company_id)); if (f) f.openRegisterEntries = Number(r.n || 0); }
  }
  return facts;
}

export async function previewRetention(db: Db, now = new Date()): Promise<{ cutoff: string; items: RetentionItem[]; keptParties: number }> {
  const cutoff = retentionCutoff(now);
  const items: RetentionItem[] = [];
  const facts = await partyFacts(db);
  const due = [...facts.entries()].map(([id, f]) => ({ id, f, verdict: partyRetention(f, cutoff) })).filter(x => x.verdict.due);
  const names = due.length ? (await db.query(`SELECT id, name FROM crm_companies WHERE id = ANY($1::varchar[])`, [due.map(d => d.id)])).rows : [];
  for (const d of due) {
    items.push({
      id: retentionItemId("party", d.id), category: "party",
      label: text(names.find((n: any) => String(n.id) === d.id)?.name) || "A company no longer in the CRM",
      why: d.verdict.why, counts: d.f.counts,
    });
  }
  const tables = await existingTables(db, ["aml_retention_archive", "aml_training_records", "aml_internal_reports"]);
  const { rows: deals } = await db.query(
    `SELECT id, name, status, completed_at, invoiced_at, updated_at FROM crm_deals
      WHERE ${DEAL_HAS_AML} AND COALESCE(completed_at, invoiced_at, updated_at) < $1::date`, [cutoff]).catch(() => ({ rows: [] as any[] }));
  for (const d of deals) {
    const verdict = dealRetention({ closed: isClosed(d.status), endedAt: isoDay(d.completed_at || d.invoiced_at || d.updated_at) }, cutoff);
    if (verdict.due) items.push({ id: retentionItemId("deal", d.id), category: "deal", label: text(d.name) || "A deal", why: verdict.why });
  }
  if (tables.has("aml_retention_archive")) {
    const { rows } = await db.query(`SELECT id, entity_type, archived_at, retain_until, data->>'name' AS name FROM aml_retention_archive WHERE retain_until < now() ORDER BY archived_at`);
    for (const r of rows) items.push({
      id: retentionItemId("archive", r.id), category: "archive",
      label: `${r.entity_type === "crm_deals" ? "A deleted deal" : "A deleted company"}${r.name ? `: ${text(r.name)}` : ""}`,
      why: `Kept until ${isoDay(r.retain_until)}`,
    });
  }
  if (tables.has("aml_training_records")) {
    const { rows } = await db.query(`SELECT id, user_name, title, training_type, training_date FROM aml_training_records WHERE training_date < $1::date ORDER BY training_date`, [cutoff]);
    for (const r of rows) items.push({ id: retentionItemId("training", r.id), category: "training", label: `${text(r.user_name)}: ${text(r.title) || text(r.training_type)}`, why: `Trained ${isoDay(r.training_date)}` });
  }
  if (tables.has("aml_internal_reports")) {
    const { rows } = await db.query(
      `SELECT id, kind, COALESCE(decided_at, updated_at, created_at) AS at FROM aml_internal_reports
        WHERE status <> 'open' AND COALESCE(decided_at, updated_at, created_at) < $1::date ORDER BY at`, [cutoff]);
    for (const r of rows) items.push({ id: retentionItemId("register", r.id), category: "register", label: `Register entry #${r.id} (${text(r.kind)})`, why: `Closed ${isoDay(r.at)}` });
  }
  return { cutoff, items, keptParties: facts.size - due.length };
}

// ── Deleting one item ───────────────────────────────────────────────────────

async function clearColumns(client: PoolClient, table: string, columns: string[], where: string, params: unknown[]): Promise<number> {
  const cols = await existingColumns(client, table, columns);
  if (!cols.length) return 0;
  const r = await client.query(`UPDATE ${table} SET ${cols.map(c => `${c} = DEFAULT`).join(", ")} WHERE ${where}`, params);
  return r.rowCount || 0;
}

async function deleteParty(client: PoolClient, companyId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const tables = await existingTables(client, [...PARTY_TABLES.map(t => t.table), "kyc_upload_files", "file_storage", "crm_entity_kyc", "crm_trading_entities"]);
  const del = async (label: string, sql: string, params: unknown[] = [companyId]) => {
    const r = await client.query(sql, params);
    if (r.rowCount) counts[label] = r.rowCount;
  };
  if (tables.has("kyc_documents")) {
    const keys = (await client.query(`SELECT file_url FROM kyc_documents WHERE company_id = $1`, [companyId])).rows.map((r: any) => storageKeyFromUrl(r.file_url)).filter((k): k is string => !!k);
    if (keys.length && tables.has("file_storage")) await del("files", `DELETE FROM file_storage WHERE storage_key = ANY($1::varchar[])`, [keys]);
    await del("kyc_documents", `DELETE FROM kyc_documents WHERE company_id = $1`);
  }
  if (tables.has("kyc_upload_tokens")) {
    if (tables.has("kyc_upload_files")) await del("kyc_upload_files", `DELETE FROM kyc_upload_files WHERE token IN (SELECT token FROM kyc_upload_tokens WHERE company_id = $1)`);
    await del("kyc_upload_tokens", `DELETE FROM kyc_upload_tokens WHERE company_id = $1`);
  }
  if (tables.has("kyc_investigations")) await del("kyc_investigations", `DELETE FROM kyc_investigations WHERE crm_company_id = $1`);
  if (tables.has("veriff_sessions")) await del("veriff_sessions", `DELETE FROM veriff_sessions WHERE company_id = $1`);
  if (tables.has("kyc4u_requests")) await del("kyc4u_requests", `DELETE FROM kyc4u_requests WHERE company_id = $1 OR company_id_manual = $1`);
  if (tables.has("kyc4u_drafts")) await del("kyc4u_drafts", `DELETE FROM kyc4u_drafts WHERE company_id = $1`);
  if (tables.has("kyc_flag_reviews")) await del("kyc_flag_reviews", `DELETE FROM kyc_flag_reviews WHERE company_id = $1`);
  if (tables.has("kyc_party_exemptions")) await del("kyc_party_exemptions", `DELETE FROM kyc_party_exemptions WHERE company_id = $1`);
  if (tables.has("kyc_public_figure_checks")) await del("kyc_public_figure_checks", `DELETE FROM kyc_public_figure_checks WHERE company_id = $1`);
  if (tables.has("kyc_abroad_records")) await del("kyc_abroad_records", `DELETE FROM kyc_abroad_records WHERE company_id = $1`);
  if (tables.has("kyc4u_archive_files")) {
    // Files copied from KYC4U's site for this party, with their stored copies.
    const keys = (await client.query(`SELECT storage_key FROM kyc4u_archive_files WHERE company_id = $1 AND storage_key IS NOT NULL`, [companyId])).rows.map((r: any) => String(r.storage_key));
    if (keys.length && tables.has("file_storage")) await del("files", `DELETE FROM file_storage WHERE storage_key = ANY($1::varchar[])`, [keys]);
    await del("kyc4u_archive_files", `DELETE FROM kyc4u_archive_files WHERE company_id = $1`);
  }
  if (tables.has("kyc_audit_log")) {
    await del("kyc_audit_log", tables.has("crm_trading_entities")
      ? `DELETE FROM kyc_audit_log WHERE company_id = $1 OR (entity_kind = 'trading_entity' AND entity_id::text IN (SELECT id::text FROM crm_trading_entities WHERE parent_company_id = $1))`
      : `DELETE FROM kyc_audit_log WHERE company_id = $1`);
  }
  if (tables.has("crm_entity_kyc") && tables.has("crm_trading_entities")) {
    await del("crm_entity_kyc", `DELETE FROM crm_entity_kyc WHERE entity_kind = 'trading_entity' AND entity_id IN (SELECT id::text FROM crm_trading_entities WHERE parent_company_id = $1)`);
  }
  if (tables.has("aml_recheck_reminders")) await del("aml_recheck_reminders", `DELETE FROM aml_recheck_reminders WHERE company_id = $1`);
  const company = await clearColumns(client, "crm_companies", COMPANY_AML_COLUMNS, "id = $1", [companyId]);
  if (company) counts.company_fields = company;
  if (tables.has("crm_trading_entities")) {
    const entities = await clearColumns(client, "crm_trading_entities", ENTITY_AML_COLUMNS, "parent_company_id = $1", [companyId]);
    if (entities) counts.company_that_signs_fields = entities;
  }
  return counts;
}

async function deleteDealFields(client: PoolClient, dealId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const n = await clearColumns(client, "crm_deals", DEAL_AML_COLUMNS, "id = $1", [dealId]);
  if (n) counts.deal_fields = n;
  const tables = await existingTables(client, ["deal_events", "deal_audit_log", "kyc_solicitor_checks"]);
  if (tables.has("kyc_solicitor_checks")) {
    const r = await client.query(`DELETE FROM kyc_solicitor_checks WHERE deal_id = $1`, [dealId]);
    if (r.rowCount) counts.solicitor_checks = r.rowCount;
  }
  if (tables.has("deal_events")) {
    const r = await client.query(`DELETE FROM deal_events WHERE deal_id = $1 AND (event_type ILIKE 'aml%' OR event_type ILIKE 'kyc%')`, [dealId]);
    if (r.rowCount) counts.deal_events = r.rowCount;
  }
  if (tables.has("deal_audit_log")) {
    const r = await client.query(`DELETE FROM deal_audit_log WHERE deal_id = $1 AND (field ILIKE 'aml%' OR field ILIKE 'kyc%')`, [dealId]);
    if (r.rowCount) counts.deal_history_lines = r.rowCount;
  }
  return counts;
}

/** Checks one item again and deletes it, in one transaction. A refusal says why. */
export async function applyRetentionItem(rawId: string, by: { id: string | null; name: string }, now = new Date()): Promise<{ id: string; deleted: boolean; counts?: Record<string, number>; why: string }> {
  const item = parseRetentionItemId(rawId);
  if (!item) return { id: rawId, deleted: false, why: "Not an item this tool deletes" };
  const cutoff = retentionCutoff(now);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let counts: Record<string, number> = {};
    let why = "";
    if (item.category === "party") {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`aml-retention:${item.id}`]);
      const f = (await partyFacts(client, [item.id])).get(item.id);
      const verdict = f ? partyRetention(f, cutoff) : { due: false, why: "No AML records any more" };
      if (!verdict.due) { await client.query("ROLLBACK"); return { id: rawId, deleted: false, why: verdict.why }; }
      counts = await deleteParty(client, item.id);
      why = verdict.why;
    } else if (item.category === "deal") {
      const d = (await client.query(`SELECT id, status, completed_at, invoiced_at, updated_at FROM crm_deals WHERE id = $1 FOR UPDATE`, [item.id])).rows[0];
      const verdict = d ? dealRetention({ closed: isClosed(d.status), endedAt: isoDay(d.completed_at || d.invoiced_at || d.updated_at) }, cutoff) : { due: false, why: "The deal has gone" };
      if (!verdict.due) { await client.query("ROLLBACK"); return { id: rawId, deleted: false, why: verdict.why }; }
      counts = await deleteDealFields(client, item.id);
      why = verdict.why;
    } else {
      const sql = item.category === "archive" ? `DELETE FROM aml_retention_archive WHERE id = $1::int AND retain_until < now()`
        : item.category === "training" ? `DELETE FROM aml_training_records WHERE id = $1::int AND training_date < $2::date`
        : `DELETE FROM aml_internal_reports WHERE id = $1::int AND status <> 'open' AND COALESCE(decided_at, updated_at, created_at) < $2::date`;
      if (!/^\d+$/.test(item.id)) { await client.query("ROLLBACK"); return { id: rawId, deleted: false, why: "Not an item this tool deletes" }; }
      const r = await client.query(sql, item.category === "archive" ? [item.id] : [item.id, cutoff]);
      if (!r.rowCount) { await client.query("ROLLBACK"); return { id: rawId, deleted: false, why: "No longer due, or already gone" }; }
      counts = { [item.category]: r.rowCount };
      why = "More than five years old";
    }
    await client.query(
      `INSERT INTO aml_deletion_log (deleted_by, deleted_by_name, category, item_id, counts, why) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [by.id, by.name, item.category, item.id, JSON.stringify(counts), why]);
    await client.query("COMMIT");
    return { id: rawId, deleted: true, counts, why };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

async function officer(req: Request, res: Response): Promise<{ id: string | null; name: string } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) { res.status(401).json({ message: "Not signed in." }); return null; }
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) { res.status(403).json({ message: "BGP staff only, signed in as themselves." }); return null; }
  const { amlActor, officerRefusal } = await import("./aml-authority");
  const actor = await amlActor(req);
  if (!actor.isMlro) { res.status(403).json({ message: officerRefusal(actor, "delete AML records"), code: "MLRO_ONLY" }); return null; }
  return { id: actor.id, name: actor.name || actor.email || "the Nominated Officer" };
}

const router = Router();

router.post("/api/aml-retention/preview", async (req: Request, res: Response) => {
  try {
    const me = await officer(req, res);
    if (!me) return;
    const preview = await previewRetention(pool);
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [PREVIEW_KEY, JSON.stringify({ by: me.id, at: new Date().toISOString(), ids: preview.items.map(i => i.id) })]);
    res.json(preview);
  } catch (err: any) {
    console.error("[aml-retention] preview failed:", err?.message);
    res.status(500).json({ message: "What is due could not be worked out." });
  }
});

router.post("/api/aml-retention/apply", async (req: Request, res: Response) => {
  try {
    const me = await officer(req, res);
    if (!me) return;
    if (String(req.body?.confirm || "") !== RETENTION_CONFIRM_WORD) return res.status(400).json({ message: `Type ${RETENTION_CONFIRM_WORD} to confirm.` });
    const ids: string[] = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))] as string[] : [];
    if (!ids.length) return res.status(400).json({ message: "Tick what to delete." });
    const saved = (await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [PREVIEW_KEY])).rows[0]?.value;
    if (!saved || saved.by !== me.id) return res.status(409).json({ message: "Preview first: only your own preview can be applied." });
    if (Date.now() - Date.parse(saved.at) > RETENTION_PREVIEW_MINUTES * 60_000) return res.status(409).json({ message: "That preview is more than an hour old: preview again." });
    const allowed = new Set<string>(saved.ids || []);
    const outside = ids.filter(id => !allowed.has(id));
    if (outside.length) return res.status(400).json({ message: "Some of those were not in your preview: preview again." });
    const results = [];
    for (const id of ids) results.push(await applyRetentionItem(id, me));
    console.log(`[aml-retention] ${me.name} deleted ${results.filter(r => r.deleted).length} of ${ids.length} items`);
    res.json({ results, deleted: results.filter(r => r.deleted).length, skipped: results.filter(r => !r.deleted).length });
  } catch (err: any) {
    console.error("[aml-retention] apply failed:", err?.message);
    res.status(500).json({ message: "The deletion stopped part way: preview again to see what is left." });
  }
});

router.get("/api/aml-retention/log", async (req: Request, res: Response) => {
  try {
    const me = await officer(req, res);
    if (!me) return;
    const { rows } = await pool.query(`SELECT id, deleted_at, deleted_by_name, category, item_id, counts, why FROM aml_deletion_log ORDER BY deleted_at DESC LIMIT 100`);
    res.json({ entries: rows.map((r: any) => ({ id: Number(r.id), at: r.deleted_at ? new Date(r.deleted_at).toISOString() : null, by: r.deleted_by_name || null, category: r.category, itemId: r.item_id, counts: r.counts || {}, why: r.why || null })) });
  } catch (err: any) {
    console.error("[aml-retention] log failed:", err?.message);
    res.status(500).json({ message: "The deletion log could not be read." });
  }
});

export default router;
