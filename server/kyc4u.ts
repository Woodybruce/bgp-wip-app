// KYC4U — BGP's outsourced KYC provider keeps each request's status on a
// SharePoint site in THEIR Microsoft tenant (kyc4ultd, customer CST1092).
// BGP accounts are guests there (Woody, 2026-09-28: "anyone with our email
// can access the Sharepoint"). A BGP user (Woody's own email) signs in once, as a
// guest in KYC4U's tenant, through this app; its token cache is kept on the
// server and the request grid is pulled every six hours into kyc4u_requests.
// No password is ever typed into the app or a chat.
//
// Azure prerequisites (the app registration behind AZURE_CLIENT_ID):
//   - Supported account types: accounts in any organisational directory
//   - Redirect URI (Web): https://chatbgp.app/api/kyc4u/callback
//   - Delegated Microsoft Graph permissions: Sites.Read.All, User.Read, offline_access
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { ConfidentialClientApplication } from "@azure/msal-node";
import * as XLSX from "xlsx";
import multer from "multer";
import { pool } from "./db";

const TENANT = process.env.KYC4U_TENANT || "kyc4ultd.onmicrosoft.com";
const SITE_HOST = process.env.KYC4U_SITE_HOST || "kyc4ultd.sharepoint.com";
const SITE_PATH = process.env.KYC4U_SITE_PATH || "/sites/customers/CST1092";
const SCOPES = ["https://graph.microsoft.com/Sites.Read.All", "https://graph.microsoft.com/User.Read"];
const CACHE_KEY = "kyc4u:connection";
const SYNC_EVERY_MS = 6 * 3600_000;

let client: ConfidentialClientApplication | null = null;
function msal(): ConfidentialClientApplication {
  if (client) return client;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = (process.env.AZURE_SECRET_V2 || process.env.AZURE_CLIENT_SECRET)?.trim();
  if (!clientId || !clientSecret) throw new Error("Azure credentials not configured");
  client = new ConfidentialClientApplication({ auth: { clientId, clientSecret, authority: `https://login.microsoftonline.com/${TENANT}` } });
  return client;
}

const redirectUri = (req: Request) => {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}/api/kyc4u/callback`;
};

interface Connection { cache: string; homeAccountId: string; username: string; connectedAt: string; connectedBy: string | null; lastSyncAt?: string | null; lastError?: string | null; listIds?: string[] }

async function loadConnection(): Promise<Connection | null> {
  const r = await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [CACHE_KEY]);
  return (r.rows[0]?.value as Connection) || null;
}
async function saveConnection(conn: Connection | null) {
  if (!conn) { await pool.query(`DELETE FROM system_settings WHERE key = $1`, [CACHE_KEY]); return; }
  await pool.query(`INSERT INTO system_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [CACHE_KEY, JSON.stringify(conn)]);
}

let lock: Promise<unknown> = Promise.resolve();
async function token(): Promise<{ token: string; conn: Connection } | null> {
  const run = lock.then(async () => {
    const conn = await loadConnection();
    if (!conn) return null;
    const c = msal();
    c.getTokenCache().deserialize(conn.cache);
    const account = (await c.getTokenCache().getAllAccounts()).find(a => a.homeAccountId === conn.homeAccountId);
    if (!account) return null;
    const result = await c.acquireTokenSilent({ scopes: SCOPES, account });
    const cache = c.getTokenCache().serialize();
    if (cache !== conn.cache) await saveConnection({ ...conn, cache });
    return result?.accessToken ? { token: result.accessToken, conn: { ...conn, cache } } : null;
  });
  lock = run.catch(() => undefined);
  return run;
}

async function graph(path: string, accessToken: string): Promise<any> {
  const res = await fetch(path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const pick = (fields: Record<string, any>, patterns: RegExp[]) => {
  for (const re of patterns) {
    const key = Object.keys(fields).find(k => re.test(k) && fields[k] != null && String(fields[k]).trim());
    if (key) return String(typeof fields[key] === "object" ? (fields[key].LookupValue ?? fields[key].Email ?? JSON.stringify(fields[key])) : fields[key]).trim();
  }
  return null;
};

type Kyc4uItem = { id: string; fields: Record<string, any>; created?: string | null; modified?: string | null; url?: string | null };

// KYC4U names requests by the legal entity ("SPORTSWIFT LTD _Card Factory_",
// "ENMEI CANARY WHARF LIMITED Company number 17152601") while the CRM holds
// the brand — so try the Companies House number, then each name the entity
// goes by, against every name a company is known by (brand, UK entity,
// trading entities, Companies House name). Only a single fit counts.
// Words too common to stand for a business on their own ("Restaurant
// Counter Limited" is not "Restaurant Property").
const GENERIC_WORD = /^(restaurants?|property|properties|investments?|holdings?|management|international|london|british|national|retail|hospitality|kitchens?|coffee|bakery|fashion|beauty|clothing|jewellery|studios?|services|solutions|developments?|enterprises?|partners(hip)?|ventures?|trading|brands?|collective|company|foods?|drinks|leisure|fitness|wellness|health|healthcare|medical|dental|pharmacy|opticians?|boutique|gallery|creative|digital|global|european|premier|golden|royal|original)$/i;

export function entityNameCandidates(entity: string): { chNumber: string | null; names: string[] } {
  const raw = String(entity || "").replace(/\s+/g, " ").trim();
  const chNumber = raw.match(/company (?:number|no\.?)\s*:?\s*([A-Z]{0,2}\d{6,8})/i)?.[1]?.toUpperCase() || null;
  const base = raw.replace(/company (?:number|no\.?)\s*:?\s*[A-Z]{0,2}\d{6,8}/i, "").trim();
  const names = new Set<string>();
  const add = (v: string) => { const t = v.replace(/_/g, " ").replace(/\s+/g, " ").trim(); if (t) names.add(t); };
  add(base);
  add(base.replace(/_[^_]*_/g, " "));                              // "SPORTSWIFT LTD _Card Factory_" → "SPORTSWIFT LTD"
  for (const m of base.matchAll(/_([^_]+)_/g)) add(m[1]);            // → "Card Factory"
  const ta = base.match(/\bt\/a\s+(.+)$/i); if (ta) add(ta[1]);
  // Drop trailing words ("Waterstones Booksellers Limited" → "Waterstones"),
  // down to two words, or one long (8+ letter) word.
  const words = base.replace(/_[^_]*_/g, " ").replace(/\b(ltd|limited|plc|llp)\b\.?/gi, " ").split(/\s+/).filter(Boolean);
  for (let n = words.length - 1; n >= 1; n--) {
    if (n === 1 && (words[0].length < 8 || GENERIC_WORD.test(words[0]))) break;
    add(words.slice(0, n).join(" "));
  }
  return { chNumber: chNumber ? chNumber.padStart(8, "0") : null, names: [...names] };
}

async function companyMatcher() {
  const { buyerNameKey } = await import("./investment-buyers");
  const companies = (await pool.query(
    `SELECT id, name, uk_entity_name, trading_entities, companies_house_number, companies_house_data->>'company_name' AS ch_name
       FROM crm_companies WHERE merged_into_id IS NULL AND name IS NOT NULL`)).rows;
  const byKey = new Map<string, Set<string>>();
  const byCh = new Map<string, Set<string>>();
  const put = (m: Map<string, Set<string>>, k: string, id: string) => { if (k.length >= 3) m.set(k, (m.get(k) || new Set()).add(id)); };
  // Legal entities already tied to a brand / landlord elsewhere in the app:
  // the entity names on deals and the tenant names on tenancy schedules.
  const linked = (await pool.query(
    `SELECT tenant_entity_name AS n, tenant_id AS id FROM crm_deals WHERE tenant_entity_name IS NOT NULL AND tenant_id IS NOT NULL
     UNION SELECT landlord_entity_name, landlord_id FROM crm_deals WHERE landlord_entity_name IS NOT NULL AND landlord_id IS NOT NULL
     UNION SELECT vendor_entity_name, vendor_id FROM crm_deals WHERE vendor_entity_name IS NOT NULL AND vendor_id IS NOT NULL
     UNION SELECT purchaser_entity_name, purchaser_id FROM crm_deals WHERE purchaser_entity_name IS NOT NULL AND purchaser_id IS NOT NULL
     UNION SELECT tenant_name, tenant_company_id FROM tenancy_schedule_units WHERE tenant_name IS NOT NULL AND tenant_company_id IS NOT NULL`,
  ).catch(() => ({ rows: [] as any[] }))).rows;
  const live = new Set(companies.map((c: any) => c.id));
  for (const l of linked) if (live.has(l.id) && l.n) put(byKey, buyerNameKey(l.n), l.id);
  for (const c of companies) {
    for (const n of [c.name, c.uk_entity_name, c.ch_name, ...(Array.isArray(c.trading_entities) ? c.trading_entities.map((t: any) => t?.name) : [])]) {
      if (n) put(byKey, buyerNameKey(n), c.id);
    }
    for (const n of [c.companies_house_number, ...(Array.isArray(c.trading_entities) ? c.trading_entities.map((t: any) => t?.companies_house_number) : [])]) {
      if (n) put(byCh, String(n).trim().toUpperCase().padStart(8, "0"), c.id);
    }
  }
  return (entity: string | null) => {
    if (!entity) return null;
    const { chNumber, names } = entityNameCandidates(entity);
    if (chNumber) { const ids = byCh.get(chNumber); if (ids?.size === 1) return [...ids][0]; }
    for (const n of names) { const ids = byKey.get(buyerNameKey(n)); if (ids?.size === 1) return [...ids][0]; }
    return null;
  };
}

async function upsertItem(match: (e: string | null) => string | null, list: { id: string; name: string }, item: Kyc4uItem): Promise<boolean> {
  const fields = item.fields || {};
  const title = pick(fields, [/^title$/i, /client|entity|company|customer|subject/i]);
  const status = pick(fields, [/^status$/i, /status|stage|progress|outcome/i]);
  const entity = pick(fields, [/entity|client|company|customer|subject/i, /^title$/i]);
  const companyId = match(entity);
  await pool.query(
    `INSERT INTO kyc4u_requests (list_id, item_id, list_name, title, status, entity_name, company_id, fields, created_at_source, modified_at_source, web_url, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, NOW())
     ON CONFLICT (list_id, item_id) DO UPDATE SET list_name = EXCLUDED.list_name, title = EXCLUDED.title, status = EXCLUDED.status,
       entity_name = EXCLUDED.entity_name, company_id = COALESCE(kyc4u_requests.company_id_manual, EXCLUDED.company_id),
       fields = EXCLUDED.fields, created_at_source = EXCLUDED.created_at_source, modified_at_source = EXCLUDED.modified_at_source,
       web_url = EXCLUDED.web_url, synced_at = NOW()`,
    [String(list.id).slice(0, 200), String(item.id).slice(0, 200), list.name, title, status, entity, companyId, JSON.stringify(fields),
      validDate(item.created), validDate(item.modified), item.url || null]);
  return !!companyId;
}
const validDate = (v: any) => { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d.toISOString() : null; };

// Lists sent in from the user's own browser (the Send to ChatBGP bookmark on
// KYC4U's site) or an uploaded export — no app sign-in to their tenant, so
// their "admin approval" rule never comes into it (Woody, 2026-09-28).
export async function ingestKyc4uLists(lists: Array<{ id: string; name: string; items: Kyc4uItem[] }>, source: string, userId: string | null) {
  const match = await companyMatcher();
  let items = 0, matched = 0;
  for (const list of lists.slice(0, 50)) {
    for (const item of (list.items || []).slice(0, 20000)) {
      if (!item || item.id == null) continue;
      if (await upsertItem(match, list, item)) matched++;
      items++;
    }
  }
  await pool.query(`INSERT INTO system_settings (key, value) VALUES ('kyc4u:last_import', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ at: new Date().toISOString(), source, userId, lists: lists.length, items, matched })]);
  console.log(`[kyc4u] imported ${items} requests from ${lists.length} lists via ${source} (${matched} matched)`);
  await mirrorKyc4uStatuses().catch((e: any) => console.warn("[kyc4u] status mirror failed:", e?.message));
  return { lists: lists.length, items, matched };
}

// KYC4U keeps each request as a folder in its Documents library —
// "REQ113355  Iris Ave Ltd" with numbered sections inside ("1.0 HOTs",
// "2.0 KYC Entity", "5.0 UBOs"). Files come through one row each, so fold
// them into one request per REQ folder: the entity name, which sections have
// documents, and how many.
const REQ_FOLDER = /^(REQ\d+)[\s_-]*(.*)$/i;
export function requestsFromLibrary(list: { id: string; name: string; items: Kyc4uItem[] }, origin = ""): { id: string; name: string; items: Kyc4uItem[] } | null {
  const groups = new Map<string, { ref: string; entity: string; path: string; files: number; sections: Map<string, number>; created: string | null; modified: string | null }>();
  for (const item of list.items || []) {
    const ref = String(item.fields?.FileRef || "");
    if (!ref) continue;
    const parts = ref.split("/");
    const at = parts.findIndex(p => REQ_FOLDER.test(p));
    if (at < 0) continue;
    const [, reqRef, rest] = parts[at].match(REQ_FOLDER)!;
    const key = reqRef.toUpperCase();
    const g = groups.get(key) || { ref: key, entity: rest.replace(/\s+/g, " ").trim(), path: parts.slice(0, at + 1).join("/"), files: 0, sections: new Map<string, number>(), created: null, modified: null };
    const isFile = Number(item.fields?.FSObjType ?? 0) === 0 && at < parts.length - 1;
    if (isFile) {
      g.files++;
      // Some requests nest a folder named just the REQ number — look past it.
      const inner = parts.slice(at + 1, -1).find(p => !REQ_FOLDER.test(p)) || "";
      const section = inner.replace(/^\d+(\.\d+)*\s*/, "").trim();
      if (section) g.sections.set(section, (g.sections.get(section) || 0) + 1);
    }
    if (item.created && (!g.created || item.created < g.created)) g.created = item.created;
    if (item.modified && (!g.modified || item.modified > g.modified)) g.modified = item.modified;
    groups.set(key, g);
  }
  if (!groups.size) return null;
  return {
    id: `${list.id}:requests`, name: `${list.name} · requests`,
    items: [...groups.values()].map(g => {
      const sections = [...g.sections.entries()].map(([name, n]) => `${name} ${n}`);
      return {
        id: g.ref,
        fields: { Reference: g.ref, Entity: g.entity || null, Title: `${g.ref} ${g.entity}`.trim(), Status: `${g.files} file${g.files === 1 ? "" : "s"}${sections.length ? ` · ${[...g.sections.keys()].join(", ")}` : ""}`, Sections: sections.join(" · ") || null, Files: g.files },
        created: g.created, modified: g.modified, url: origin && g.path ? origin + encodeURI(g.path) : null,
      };
    }),
  };
}

async function rememberEntity(listId: string, itemId: string, companyId: string) {
  const row = (await pool.query(`SELECT entity_name FROM kyc4u_requests WHERE list_id = $1 AND item_id = $2`, [listId, itemId])).rows[0];
  if (!row?.entity_name) return;
  const { chNumber, names } = entityNameCandidates(row.entity_name);
  const name = names[0];
  if (!name) return;
  const { buyerNameKey } = await import("./investment-buyers");
  const c = (await pool.query(`SELECT name, uk_entity_name, trading_entities FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
  if (!c) return;
  const entities = Array.isArray(c.trading_entities) ? c.trading_entities : [];
  const key = buyerNameKey(name);
  if ([c.name, c.uk_entity_name, ...entities.map((t: any) => t?.name)].some(n => n && buyerNameKey(n) === key)) return;
  await pool.query(`UPDATE crm_companies SET trading_entities = $2::jsonb WHERE id = $1`,
    [companyId, JSON.stringify([...entities, { name, ...(chNumber ? { companies_house_number: chNumber } : {}), notes: `From KYC4U ${itemId}` }])]);
}

// Pull every generic list on the site (the ViewRequestStatus grid reads one
// of them; system lists are skipped), upsert the items, and match each to a
// CRM company by its client / entity name when exactly one fits.
// ── KYC4U is BGP's MLRO (Woody, 2026-10-05) ────────────────────────────
// "KYC4U are the MLRO, we pay for that service … once they approve, that's
// the MLRO sign-off." Their request grid is the source of truth: after
// every sync/import each matched company takes the status of its latest
// KYC4U request, like a deal following its Xero invoice.
//   approved / passed / cleared / signed off → approved by "KYC4U (MLRO)",
//     dated by KYC4U, re-check on the AML settings cycle, deals re-derived
//   failed / rejected / declined / do not proceed → rejected
//   anything else → in_review — but a still-valid approval is kept while a
//     re-check is in progress, so a renewal never blocks live deals
// Idempotent: a company only changes when its latest request or that
// request's status changes (kyc4u_request_key).
export const KYC4U_APPROVER = "KYC4U (MLRO)";
export function kyc4uVerdict(status: string | null): "approved" | "rejected" | "in_review" {
  const s = String(status || "").toLowerCase();
  if (/(fail|reject|declin|do not proceed|not approved|unable to verify)/.test(s)) return "rejected";
  // "Complete and ready for review" is KYC4U handing the check back for the
  // fee earner to approve (their Service Desk email) — not a sign-off.
  if (/(not approv|unapprov|awaiting approv|pending approv)/.test(s)) return "in_review";
  if (/(approv|passed|cleared|signed off)/.test(s)) return "approved";
  return "in_review";
}
export async function mirrorKyc4uStatuses(): Promise<{ approved: number; rejected: number; inReview: number; linkedDrafts: number }> {
  const out = { approved: 0, rejected: 0, inReview: 0, linkedDrafts: 0 };
  // A row read off KYC4U's status page takes the company its REQ folder is
  // already matched (or hand-linked) to.
  await pool.query(
    `UPDATE kyc4u_requests p SET company_id = f.company_id
       FROM kyc4u_requests f
      WHERE p.list_id LIKE 'page:%' AND p.company_id_manual IS NULL AND p.item_id LIKE 'REQ%'
        AND f.list_id LIKE '%:requests' AND f.item_id = p.item_id AND f.company_id IS NOT NULL
        AND p.company_id IS DISTINCT FROM f.company_id`).catch((e: any) => console.warn("[kyc4u] linking status rows failed:", e?.message));
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (q.company_id) q.company_id, q.list_id, q.item_id, q.status, q.entity_name, q.fields,
            COALESCE(q.modified_at_source, q.created_at_source, q.synced_at) AS at,
            c.name, c.kyc_status, c.kyc_expires_at, c.kyc4u_request_key
       FROM kyc4u_requests q JOIN crm_companies c ON c.id = q.company_id
      WHERE q.company_id IS NOT NULL
        -- Rows folded from document-library folders carry a file count, not a
        -- KYC4U decision — only their request-status list can sign off.
        AND q.list_id NOT LIKE '%:requests'
      ORDER BY q.company_id, COALESCE(q.modified_at_source, q.created_at_source, q.synced_at) DESC NULLS LAST`);
  let intervalDays = 182;
  try {
    const st = await pool.query("SELECT recheck_interval_days FROM aml_settings ORDER BY id LIMIT 1");
    const n = parseInt(st.rows[0]?.recheck_interval_days, 10);
    if (Number.isFinite(n) && n > 0) intervalDays = n;
  } catch {}
  const { recomputeDealKycApproved } = await import("./deal-gates");
  const audit = (companyId: string, action: string, notes: string) =>
    pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, $2, $3, $4)`, [companyId, action, KYC4U_APPROVER, notes]).catch(() => {});
  for (const r of rows) {
    const verdict = kyc4uVerdict(r.status);
    const key = `${r.list_id}:${r.item_id}:${verdict}:${String(r.status || "").toLowerCase()}`;
    if (r.kyc4u_request_key === key) continue;
    const at = r.at ? new Date(r.at) : new Date();
    const stillValid = r.kyc_status === "approved" && r.kyc_expires_at && new Date(r.kyc_expires_at) > new Date();
    try {
      if (verdict === "approved") {
        const expires = new Date(at); expires.setDate(expires.getDate() + intervalDays);
        await pool.query(
          `UPDATE crm_companies SET kyc_status = 'approved', kyc_checked_at = $2, kyc_approved_by = $3, kyc_expires_at = $4,
                  kyc4u_request_key = $5, updated_at = NOW() WHERE id = $1`, [r.company_id, at, KYC4U_APPROVER, expires, key]);
        await pool.query(`UPDATE aml_recheck_reminders SET completed_at = NOW(), completed_by = $2 WHERE company_id = $1 AND completed_at IS NULL`, [r.company_id, KYC4U_APPROVER]).catch(() => {});
        await pool.query(`INSERT INTO aml_recheck_reminders (company_id, entity_name, recheck_type, due_date, notes) VALUES ($1, $2, 'periodic_cdd', $3, $4)`,
          [r.company_id, r.name, expires, `KYC4U approval — ${intervalDays}-day re-check`]).catch(() => {});
        await audit(r.company_id, "kyc_approved", `Approved by KYC4U (BGP's outsourced MLRO): "${r.status}" on ${r.entity_name || "their request"}${r.list_id === "manual" ? ` · recorded in the app by ${r.fields?.["Recorded by"] || "an admin"}${r.fields?.Note ? ` — ${r.fields.Note}` : ""}` : ""} · re-check due ${expires.toISOString().slice(0, 10)}`);
        out.approved++;
      } else if (verdict === "rejected") {
        await pool.query(`UPDATE crm_companies SET kyc_status = 'rejected', kyc_checked_at = $2, kyc_approved_by = $3, kyc4u_request_key = $4, updated_at = NOW() WHERE id = $1`,
          [r.company_id, at, KYC4U_APPROVER, key]);
        await audit(r.company_id, "kyc_rejected", `KYC4U (BGP's outsourced MLRO): "${r.status}" on ${r.entity_name || "their request"}`);
        out.rejected++;
      } else {
        if (stillValid) {
          await pool.query(`UPDATE crm_companies SET kyc4u_request_key = $2 WHERE id = $1`, [r.company_id, key]);
        } else {
          await pool.query(`UPDATE crm_companies SET kyc_status = 'in_review', kyc4u_request_key = $2, updated_at = NOW() WHERE id = $1`, [r.company_id, key]);
          await audit(r.company_id, "kyc_in_review", `With KYC4U: "${r.status || "no status yet"}" on ${r.entity_name || "their request"}`);
        }
        out.inReview++;
      }
      await recomputeDealKycApproved(r.company_id, verdict === "approved" ? KYC4U_APPROVER : null).catch((e: any) => console.warn("[kyc4u] deal recompute failed:", e?.message));
    } catch (e: any) { console.warn(`[kyc4u] mirroring status for ${r.company_id} failed:`, e?.message); }
  }
  // Requests raised from a deal: once KYC4U's grid shows a request for that
  // party created after the form was filled, link the two (Xero-style).
  try {
    const filled = (await pool.query(
      `SELECT id, company_id, filled_at FROM kyc4u_drafts WHERE status = 'filled' AND request_item_id IS NULL AND filled_at IS NOT NULL ORDER BY filled_at`)).rows;
    for (const d of filled) {
      const q = (await pool.query(
        `SELECT q.list_id, q.item_id FROM kyc4u_requests q
          WHERE q.company_id = $1 AND COALESCE(q.created_at_source, q.modified_at_source) >= $2::timestamp - interval '1 day'
            AND NOT EXISTS (SELECT 1 FROM kyc4u_drafts o WHERE o.request_list_id = q.list_id AND o.request_item_id = q.item_id)
          ORDER BY COALESCE(q.created_at_source, q.modified_at_source) ASC LIMIT 1`, [d.company_id, d.filled_at])).rows[0];
      if (!q) continue;
      await pool.query(`UPDATE kyc4u_drafts SET request_list_id = $2, request_item_id = $3, status = 'submitted' WHERE id = $1`, [d.id, q.list_id, q.item_id]);
      out.linkedDrafts++;
    }
  } catch (e: any) { console.warn("[kyc4u] linking deal requests failed:", e?.message); }
  if (out.approved || out.rejected || out.inReview || out.linkedDrafts)
    console.log(`[kyc4u] mirrored KYC4U statuses: ${out.approved} approved, ${out.rejected} rejected, ${out.inReview} with KYC4U, ${out.linkedDrafts} deal requests linked`);
  return out;
}

export async function syncKyc4u(): Promise<{ lists: number; items: number; matched: number }> {
  const auth = await token();
  if (!auth) throw new Error("KYC4U is not connected");
  try {
    const site = await graph(`/sites/${SITE_HOST}:${SITE_PATH}`, auth.token);
    const lists = (await graph(`/sites/${site.id}/lists?$select=id,displayName,list,system&$top=200`, auth.token)).value || [];
    const wanted = lists.filter((l: any) => !l.system && !l.list?.hidden && ["genericList", "issueTracking", "tasks", "events"].includes(l.list?.template || "genericList"));
    const match = await companyMatcher();
    let items = 0, matched = 0;
    for (const list of wanted) {
      let next: string | null = `/sites/${site.id}/lists/${list.id}/items?$expand=fields&$top=200`;
      while (next) {
        const page: any = await graph(next, auth.token);
        for (const item of page.value || []) {
          if (await upsertItem(match, { id: list.id, name: list.displayName }, { id: item.id, fields: item.fields || {}, created: item.createdDateTime, modified: item.lastModifiedDateTime, url: item.webUrl })) matched++;
          items++;
        }
        next = page["@odata.nextLink"] || null;
      }
    }
    await saveConnection({ ...auth.conn, lastSyncAt: new Date().toISOString(), lastError: null, listIds: wanted.map((l: any) => l.id) });
    console.log(`[kyc4u] synced ${items} requests from ${wanted.length} lists (${matched} matched to CRM)`);
    await mirrorKyc4uStatuses().catch((e: any) => console.warn("[kyc4u] status mirror failed:", e?.message));
    return { lists: wanted.length, items, matched };
  } catch (e: any) {
    await saveConnection({ ...auth.conn, lastError: String(e?.message || e).slice(0, 500) });
    throw e;
  }
}

// An uploaded export (CSV / Excel of the grid) → one list per sheet. Rows
// keep a stable id: the sheet's ID / Reference column when it has one.
export function rowsFromWorkbook(buffer: Buffer, fileName: string): Array<{ id: string; name: string; items: Kyc4uItem[] }> {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  return wb.SheetNames.map((sheetName: string) => {
    const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null, raw: false });
    const idKey = rows.length ? Object.keys(rows[0]).find(k => /^(id|ref|reference|request ?(id|no|number|ref)|case ?(id|no|ref))$/i.test(k.trim())) : undefined;
    return {
      id: `file:${fileName}:${sheetName}`.slice(0, 200), name: `${fileName} · ${sheetName}`,
      items: rows.filter(r => Object.values(r).some(v => v != null && String(v).trim())).map(r => ({
        id: idKey && r[idKey] ? String(r[idKey]) : crypto.createHash("sha1").update(JSON.stringify(r)).digest("hex").slice(0, 24),
        fields: r,
        created: pick(r, [/created|date submitted|submitted|raised|opened/i]),
        modified: pick(r, [/modified|updated|last change/i]),
      })),
    };
  }).filter((l: any) => l.items.length);
}

// state → who pressed Connect; the Microsoft redirect comes back without
// the app's bearer token, so the state is the proof.
const pendingStates = new Map<string, { userId: string | null; at: number }>();

// KYC4U's Raise New Service Request fields, prefilled from the deal — shared
// by the deal's Request KYC4U check box and ChatBGP's prepare tool.
export async function kyc4uPrefill(dealId: string, companyId: string, role: string, userId: string | null) {
  const company = (await pool.query(`SELECT id, name, uk_entity_name FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
  if (!company) throw Object.assign(new Error("Company not found"), { status: 404 });
  const deal = dealId ? (await pool.query(
    `SELECT d.id, d.name, d.deal_ref, d.deal_type, d.target_date, d.internal_agent, d.internal_agent_ids, d.client_contact_id,
            d.joint_agent_id, d.landlord_id, d.tenant_id, d.vendor_id, d.purchaser_id, p.name AS property_name, p.address AS property_address
       FROM crm_deals d LEFT JOIN crm_properties p ON p.id = d.property_id WHERE d.id = $1`, [dealId])).rows[0] : null;
  const addr = (() => {
    const a = deal?.property_address;
    if (!a) return deal?.property_name || "";
    if (typeof a === "string") return a;
    const parts = [a.street, a.street2, a.city || a.town, a.county, a.postcode].filter((x: any) => typeof x === "string" && x.trim());
    return [deal?.property_name, ...parts].filter(Boolean).join(", ");
  })();
  const dt = String(deal?.deal_type || "");
  const clientRole = dt === "Sale" ? "vendor" : dt === "Purchase" ? "purchaser"
    : /Lease Acquisition|Lease Disposal/.test(dt) ? "tenant" : "landlord";
  const isClient = !role || role === clientRole;
  const contact = deal?.client_contact_id ? (await pool.query(`SELECT name, role, email FROM crm_contacts WHERE id = $1`, [deal.client_contact_id])).rows[0] : null;
  const agentIds: string[] = Array.isArray(deal?.internal_agent_ids) ? deal.internal_agent_ids : [];
  const agents = agentIds.length ? (await pool.query(`SELECT email FROM users WHERE id = ANY($1::varchar[]) AND email IS NOT NULL`, [agentIds])).rows : [];
  const me = (await pool.query(`SELECT email FROM users WHERE id = $1`, [userId])).rows[0];
  const feeEarners = [...new Set([...agents.map((a: any) => a.email), me?.email].filter(Boolean))];
  const jointAgent = deal?.joint_agent_id ? (await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [deal.joint_agent_id])).rows[0]?.name : "";
  const docs = (await pool.query(
    `SELECT id, doc_type, file_name, file_size FROM kyc_documents WHERE company_id = $1 AND deleted_at IS NULL ORDER BY uploaded_at DESC LIMIT 20`, [companyId])).rows;
  return {
    fields: {
      partyType: isClient ? "Client" : "Counterparty",
      partyName: company.uk_entity_name || company.name,
      propertyAddress: addr,
      requestType: "",
      metFaceToFace: "",
      howLongKnown: "",
      instructorName: isClient ? (contact?.name || "") : "",
      instructorDesignation: isClient ? (contact?.role || "") : "",
      jointAgent: jointAgent || "",
      feeEarnerEmails: feeEarners.join("; "),
      clientEmails: isClient && contact?.email ? contact.email : "",
      expectedCompletion: deal?.target_date ? new Date(deal.target_date).toISOString().slice(0, 10) : "",
      note: [deal ? `BGP deal ${deal.deal_ref ? "#" + deal.deal_ref + " " : ""}${deal.name || ""}`.trim() : "", dt ? `Deal type: ${dt}` : "", role ? `Role: ${role}${isClient ? " (BGP's client)" : " (counterparty)"}` : ""].filter(Boolean).join("\n"),
    },
    docs,
  };
}

export const KYC4U_DRAFT_KEYS = ["partyType", "partyName", "propertyAddress", "requestType", "metFaceToFace", "howLongKnown", "instructorName",
  "instructorDesignation", "jointAgent", "feeEarnerEmails", "clientEmails", "expectedCompletion", "note"];
export async function createKyc4uDraft(d: { dealId?: string | null; companyId: string; role?: string | null; fields: Record<string, any>; docIds?: string[]; userId: string | null }) {
  const fields: Record<string, string> = {};
  for (const k of KYC4U_DRAFT_KEYS) if (typeof d.fields?.[k] === "string") fields[k] = d.fields[k].slice(0, 4000);
  if (!fields.partyName?.trim()) throw Object.assign(new Error("Party name is required"), { status: 400 });
  const docIds = Array.isArray(d.docIds) ? d.docIds.filter((x: any) => typeof x === "string").slice(0, 10) : [];
  return (await pool.query(
    `INSERT INTO kyc4u_drafts (deal_id, company_id, role, fields, doc_ids, created_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING *`,
    [d.dealId || null, d.companyId, d.role || null, JSON.stringify(fields), docIds, d.userId])).rows[0];
}

export function registerKyc4uRoutes(app: Express, requireAuth: any, requireAdmin: any) {
  app.get("/api/kyc4u/status", requireAuth, async (_req: Request, res: Response) => {
    try {
      const conn = await loadConnection();
      const counts = (await pool.query(`SELECT COUNT(*)::int AS n, COUNT(company_id)::int AS matched FROM kyc4u_requests`)).rows[0];
      const lastImport = (await pool.query(`SELECT value FROM system_settings WHERE key = 'kyc4u:last_import'`)).rows[0]?.value || null;
      const lastDiag = (await pool.query(`SELECT value FROM system_settings WHERE key = 'kyc4u:last_diag'`)).rows[0]?.value || null;
      res.json({
        connected: !!conn, username: conn?.username || null, connectedAt: conn?.connectedAt || null,
        lastSyncAt: conn?.lastSyncAt || null, lastError: conn?.lastError || null,
        site: `https://${SITE_HOST}${SITE_PATH}`, requests: counts.n, matched: counts.matched, lastImport, lastDiag,
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/kyc4u/connect", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const state = crypto.randomBytes(24).toString("hex");
      pendingStates.set(state, { userId: req.session.userId || (req as any).tokenUserId || null, at: Date.now() });
      // Signs in as the person pressing Connect — their BGP email, which
      // already has guest access to KYC4U's site (Woody, 2026-09-28).
      const me = (await pool.query(`SELECT email FROM users WHERE id = $1`, [req.session.userId || (req as any).tokenUserId])).rows[0];
      const authUrl = await msal().getAuthCodeUrl({ scopes: SCOPES, redirectUri: redirectUri(req), state, ...(me?.email ? { loginHint: me.email } : { prompt: "select_account" }) });
      res.json({ authUrl, redirectUri: redirectUri(req) });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/kyc4u/callback", async (req: Request, res: Response) => {
    const back = (msg: string) => res.redirect(`/kyc-clouseau?tab=kyc4u&kyc4u=${encodeURIComponent(msg)}`);
    try {
      // KYC4U's admin approving the app for their tenant (the admin-consent
      // link) comes back here with no code — say so, then Connect works.
      if (req.query.admin_consent !== undefined && !req.query.code) {
        return back(String(req.query.admin_consent).toLowerCase() === "true"
          ? "KYC4U's admin has approved ChatBGP — press Connect KYC4U now"
          : String(req.query.error_description || "KYC4U's admin didn't approve the app"));
      }
      if (req.query.error) return back(String(req.query.error_description || req.query.error));
      const pending = pendingStates.get(String(req.query.state || ""));
      pendingStates.delete(String(req.query.state || ""));
      if (!pending || Date.now() - pending.at > 15 * 60_000) return back("The sign-in expired — try Connect again");
      const c = msal();
      const result = await c.acquireTokenByCode({ code: String(req.query.code || ""), scopes: SCOPES, redirectUri: redirectUri(req) });
      if (!result?.account) return back("No account came back from Microsoft");
      await saveConnection({
        cache: c.getTokenCache().serialize(), homeAccountId: result.account.homeAccountId,
        username: result.account.username, connectedAt: new Date().toISOString(), connectedBy: pending.userId,
      });
      syncKyc4u().catch((e: any) => console.warn("[kyc4u] first sync failed:", e?.message));
      back("connected");
    } catch (e: any) {
      console.error("[kyc4u] callback failed:", e?.message);
      back(String(e?.message || "Sign-in failed").slice(0, 300));
    }
  });

  app.post("/api/kyc4u/sync", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try { res.json(await syncKyc4u()); } catch (e: any) { res.status(502).json({ message: e.message }); }
  });

  // From the Send to ChatBGP bookmark (the user's own browser on KYC4U's site).
  app.post("/api/kyc4u/import", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const lists = Array.isArray(req.body?.lists) ? req.body.lists : [];
      // Keep what the bookmark saw so staff (and ChatBGP) can see where the
      // requests actually live on KYC4U's site.
      const diag = req.body?.diag && typeof req.body.diag === "object" ? req.body.diag : null;
      if (diag) {
          await pool.query(
            `INSERT INTO system_settings (key, value) VALUES ('kyc4u:last_diag', $1::jsonb)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
            [JSON.stringify({
              at: new Date().toISOString(), site: req.body?.site || null,
              webs: (Array.isArray(diag.webs) ? diag.webs : []).slice(0, 20).map((w: any) => ({ url: w?.url, error: w?.error || null, lists: (Array.isArray(w?.lists) ? w.lists : []).slice(0, 100) })),
              links: (Array.isArray(diag.links) ? diag.links : []).slice(0, 80),
            })],
          ).catch((e: any) => console.warn("[kyc4u] saving diag failed:", e?.message));
      }
      if (!lists.length) {
        const seen = (Array.isArray(diag?.webs) ? diag.webs : [])
          .flatMap((w: any) => (Array.isArray(w?.lists) ? w.lists : []).map((l: any) => `${l.title} (${l.count})`))
          .slice(0, 8);
        const blocked = (Array.isArray(diag?.webs) ? diag.webs : []).filter((w: any) => w?.error).length;
        return res.status(400).json({ message: seen.length
          ? `Nothing with requests in it on KYC4U's site for your login — saw ${seen.join(", ")}. Saved for ChatBGP to look at.`
          : blocked
            ? "KYC4U's site wouldn't list its contents for your login. Saved for ChatBGP to look at."
            : "No lists came through from KYC4U" });
      }
      const origin = (() => { try { return new URL(String(req.body?.site || "")).origin; } catch { return ""; } })();
      const clean = lists.map((l: any) => ({
        id: String(l.id || l.name || "list"), name: String(l.name || l.id || "KYC4U list").slice(0, 200),
        items: (Array.isArray(l.items) ? l.items : []).map((i: any) => ({ id: String(i.id ?? ""), fields: i.fields && typeof i.fields === "object" ? i.fields : {}, created: i.created || null, modified: i.modified || null, url: i.url || null })),
      })).flatMap((l: any) => {
        // A document library is KYC4U's request folders — one row per request,
        // replacing any file-by-file rows an earlier import left behind.
        if (!l.items.some((i: any) => i.fields?.FileRef)) return l.items.length && !l.items.some((i: any) => "FileSystemObjectType" in (i.fields || {})) ? [l] : [];
        const folded = requestsFromLibrary(l, origin);
        return folded ? [{ ...folded, replaces: l.id }] : [];
      });
      for (const l of clean) if ((l as any).replaces) await pool.query(`DELETE FROM kyc4u_requests WHERE list_id = $1 AND company_id_manual IS NULL`, [(l as any).replaces]);
      if (!clean.length) return res.status(400).json({ message: "KYC4U's files came through without their folder names — drag the new Send to ChatBGP bookmark from the KYC4U panel and try again." });
      res.json(await ingestKyc4uLists(clean, "bookmark", req.session.userId || (req as any).tokenUserId || null));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // An exported CSV / Excel of the grid.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
  app.post("/api/kyc4u/import-file", requireAuth, requireAdmin, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
      if (!file) return res.status(400).json({ message: "Choose the exported file" });
      const lists = rowsFromWorkbook(file.buffer, file.originalname.replace(/\.[^.]+$/, ""));
      if (!lists.length) return res.status(400).json({ message: "That file has no rows" });
      res.json(await ingestKyc4uLists(lists, "file", req.session.userId || (req as any).tokenUserId || null));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/kyc4u/disconnect", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try { await saveConnection(null); res.json({ ok: true }); } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/kyc4u/requests", requireAuth, async (_req: Request, res: Response) => {
    try {
      const r = await pool.query(
        `SELECT q.list_id AS "listId", q.item_id AS "itemId", q.list_name AS "listName", q.title, q.status, q.entity_name AS "entityName",
                q.company_id AS "companyId", c.name AS "companyName", q.modified_at_source AS "modifiedAt", q.web_url AS "webUrl", q.fields
           FROM kyc4u_requests q LEFT JOIN crm_companies c ON c.id = q.company_id
          ORDER BY q.modified_at_source DESC NULLS LAST LIMIT 500`);
      res.json(r.rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ── New service requests (Woody, 2026-10-05) ───────────────────────────
  // KYC4U raise requests through a custom "Raise New Service Request" page
  // on BGP's site. The app prepares the request from the deal; the Send to
  // ChatBGP bookmark, clicked on that page, fills the form in the user's
  // own browser and leaves Submit to them — so KYC4U's page does whatever it
  // normally does on submit (their notifications) and no tenant admin
  // approval is needed. Their status then comes back on the grid sync.
  const userIdOf = (req: Request) => (req as any).session?.userId || (req as any).tokenUserId || null;
  const staffOnly = async (req: Request, res: Response) => {
    const { resolveCompanyScope } = await import("./company-scope");
    if (await resolveCompanyScope(req as any)) { res.status(403).json({ message: "Staff only" }); return false; }
    return true;
  };

  app.get("/api/kyc4u/drafts/prefill", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!await staffOnly(req, res)) return;
      res.json(await kyc4uPrefill(String(req.query.dealId || ""), String(req.query.companyId || ""), String(req.query.role || ""), userIdOf(req)));
    } catch (e: any) { res.status(e.status || 500).json({ message: e.message }); }
  });

  app.post("/api/kyc4u/drafts", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!await staffOnly(req, res)) return;
      const b = req.body || {};
      if (!b.companyId) return res.status(400).json({ message: "Choose the party" });
      res.json(await createKyc4uDraft({ dealId: b.dealId, companyId: b.companyId, role: b.role, fields: b.fields || {}, docIds: b.docIds, userId: userIdOf(req) }));
    } catch (e: any) { res.status(e.status || 500).json({ message: e.message }); }
  });

  app.get("/api/kyc4u/drafts", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!await staffOnly(req, res)) return;
      const r = await pool.query(
        `SELECT d.*, u.name AS created_by_name, q.status AS request_status, q.web_url AS request_url, q.modified_at_source AS request_modified_at
           FROM kyc4u_drafts d LEFT JOIN users u ON u.id = d.created_by
           LEFT JOIN kyc4u_requests q ON q.list_id = d.request_list_id AND q.item_id = d.request_item_id
          WHERE ($1::varchar IS NULL OR d.deal_id = $1) AND ($2::varchar IS NULL OR d.company_id = $2)
          ORDER BY d.created_at DESC LIMIT 50`, [req.query.dealId || null, req.query.companyId || null]);
      res.json(r.rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // The bookmark's helper window asks for the next request to fill: the
  // caller's own oldest queued one first, then anyone's.
  app.get("/api/kyc4u/drafts/next", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!await staffOnly(req, res)) return;
      const r = await pool.query(
        `SELECT d.*, c.name AS company_name FROM kyc4u_drafts d LEFT JOIN crm_companies c ON c.id = d.company_id
          WHERE d.status = 'queued' ORDER BY (d.created_by = $1) DESC, d.created_at ASC LIMIT 1`, [userIdOf(req)]);
      const draft = r.rows[0] || null;
      const docs = draft?.doc_ids?.length ? (await pool.query(
        `SELECT id, file_name, mime_type, file_url, file_size FROM kyc_documents WHERE id = ANY($1::varchar[]) AND deleted_at IS NULL`, [draft.doc_ids])).rows : [];
      const waiting = (await pool.query(`SELECT COUNT(*)::int AS n FROM kyc4u_drafts WHERE status = 'queued'`)).rows[0].n;
      res.json({ draft, docs, waiting });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/kyc4u/drafts/:id/filled", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!await staffOnly(req, res)) return;
      await pool.query(`UPDATE kyc4u_drafts SET status = 'filled', filled_at = now(), fill_report = $2::jsonb WHERE id = $1`,
        [String(req.params.id), JSON.stringify(req.body?.report || null)]);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Back to the queue (the form wasn't submitted) or cancel outright.
  app.patch("/api/kyc4u/drafts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!await staffOnly(req, res)) return;
      const status = ["queued", "cancelled", "submitted"].includes(req.body?.status) ? req.body.status : null;
      if (!status) return res.status(400).json({ message: "Unknown status" });
      await pool.query(`UPDATE kyc4u_drafts SET status = $2 WHERE id = $1`, [String(req.params.id), status]);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // One company's KYC4U requests, for the Compliance & KYC board and the
  // deal KYC panel (Woody, 2026-10-05: KYC4U does the checks; the app shows
  // their result where people look, rather than only on the KYC hub).
  // Staff only — these are BGP's own compliance records.
  app.get("/api/kyc4u/company/:companyId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { resolveCompanyScope } = await import("./company-scope");
      if (await resolveCompanyScope(req as any)) return res.json({ requests: [], lastSyncAt: null });
      const r = await pool.query(
        `SELECT q.list_id AS "listId", q.item_id AS "itemId", q.list_name AS "listName", q.title, q.status,
                q.entity_name AS "entityName", q.modified_at_source AS "modifiedAt", q.created_at_source AS "createdAt", q.web_url AS "webUrl"
           FROM kyc4u_requests q WHERE q.company_id = $1
          ORDER BY q.modified_at_source DESC NULLS LAST LIMIT 20`, [String(req.params.companyId)]);
      const conn = await loadConnection().catch(() => null);
      res.json({ requests: r.rows, lastSyncAt: conn?.lastSyncAt || null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // KYC4U signed off but it isn't on anything the bookmark can read (e.g. an
  // email from them): an admin records it, and the mirror applies it like
  // any KYC4U approval — "Approved by KYC4U (MLRO)", audited with who
  // recorded it. A later KYC4U status for the company replaces it.
  app.post("/api/kyc4u/company/:companyId/signoff", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = String(req.params.companyId);
      const c = (await pool.query(`SELECT name FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
      if (!c) return res.status(404).json({ message: "Company not found" });
      const on = validDate(req.body?.date) || new Date().toISOString();
      const note = String(req.body?.note || "").trim().slice(0, 500);
      const u = (await pool.query(`SELECT name FROM users WHERE id = $1`, [req.session.userId || (req as any).tokenUserId || null]).catch(() => ({ rows: [] as any[] }))).rows[0];
      const by = u?.name || "an admin";
      await pool.query(
        `INSERT INTO kyc4u_requests (list_id, item_id, list_name, title, status, entity_name, company_id, company_id_manual, fields, created_at_source, modified_at_source, synced_at)
         VALUES ('manual', $1, 'Recorded in the app', $2, 'Approved', $2, $3, $3, $4::jsonb, $5, $5, NOW())`,
        [`${companyId}:${Date.now()}`, c.name, companyId, JSON.stringify({ "Recorded by": by, Note: note || null }), on]);
      const r = await mirrorKyc4uStatuses();
      res.json({ ok: true, ...r });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Re-run the matcher over the saved requests (after the matching improves
  // or new brands / entities land). Hand-set links are kept.
  app.post("/api/kyc4u/rematch", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const match = await companyMatcher();
      const rows = (await pool.query(`SELECT list_id, item_id, entity_name, company_id FROM kyc4u_requests WHERE company_id_manual IS NULL`)).rows;
      let matched = 0, changed = 0;
      for (const r of rows) {
        const id = match(r.entity_name);
        if (id) matched++;
        if ((id || null) !== (r.company_id || null)) {
          await pool.query(`UPDATE kyc4u_requests SET company_id = $3 WHERE list_id = $1 AND item_id = $2`, [r.list_id, r.item_id, id]);
          changed++;
        }
      }
      await mirrorKyc4uStatuses().catch(() => {});
      res.json({ requests: rows.length, matched, changed });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Staff can fix a match by hand; later syncs keep it.
  app.patch("/api/kyc4u/requests/:listId/:itemId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = typeof req.body?.companyId === "string" && req.body.companyId ? req.body.companyId : null;
      await pool.query(`UPDATE kyc4u_requests SET company_id = $3, company_id_manual = $3 WHERE list_id = $1 AND item_id = $2`, [req.params.listId, req.params.itemId, companyId]);
      // KYC4U requests are legal entities of a brand or landlord: file the
      // entity under the company it was linked to (never a new company), so
      // the next import matches it by itself.
      if (companyId) await rememberEntity(String(req.params.listId), String(req.params.itemId), companyId)
        .catch((e: any) => console.warn("[kyc4u] saving the entity on the company failed:", e?.message));
      await mirrorKyc4uStatuses().catch(() => {});
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  setInterval(() => {
    loadConnection().then(conn => { if (conn) return syncKyc4u(); }).catch((e: any) => console.warn("[kyc4u] scheduled sync failed:", e?.message));
  }, SYNC_EVERY_MS).unref?.();
}
