// Standalone store for scraped third-party AVAILABLE properties (PIPnet
// "available space" listings, and any future source). Deliberately kept OUT of
// the Drizzle CRM schema and the crm_properties table — these are external
// market listings, not BGP's own records, and the team doesn't want the CRM
// cluttered with them. Raw SQL + CREATE TABLE IF NOT EXISTS so it self-provisions
// on first use (deploy doesn't run drizzle push), exactly like geocode_cache /
// file_storage.
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let ensured = false;

async function ensureTable() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS external_properties (
      id            TEXT PRIMARY KEY,          -- source id, e.g. pipnet-prop-1353144
      source        TEXT NOT NULL,             -- 'PIPnet'
      folder_id     TEXT,
      address       TEXT,
      town          TEXT,
      street        TEXT,
      postcode      TEXT,
      latitude      DOUBLE PRECISION,
      longitude     DOUBLE PRECISION,
      rent          TEXT,
      service_charge TEXT,
      rateable_value TEXT,
      area_sqft     TEXT,
      tenure        TEXT,
      use_category  TEXT,
      availability  TEXT,
      agent         TEXT,
      contact_name  TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      landlord_pack TEXT,                       -- JSON { url, name, pages }
      document_date TEXT,
      raw_data      JSONB,                       -- every captured field, untouched
      imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  ensured = true;
}

export interface ExternalPropertyInput {
  id: string;
  source: string;
  folderId?: string | null;
  address?: string | null;
  town?: string | null;
  street?: string | null;
  postcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  rent?: string | null;
  serviceCharge?: string | null;
  rateableValue?: string | null;
  areaSqft?: string | null;
  tenure?: string | null;
  useCategory?: string | null;
  availability?: string | null;
  agent?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  landlordPack?: string | null;
  documentDate?: string | null;
  rawData?: any;
}

export async function upsertExternalProperty(r: ExternalPropertyInput): Promise<void> {
  await ensureTable();
  await pool.query(
    `INSERT INTO external_properties
      (id, source, folder_id, address, town, street, postcode, latitude, longitude,
       rent, service_charge, rateable_value, area_sqft, tenure, use_category, availability,
       agent, contact_name, contact_phone, contact_email, landlord_pack, document_date, raw_data, updated_at)
     VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23, NOW())
     ON CONFLICT (id) DO UPDATE SET
       source=$2, folder_id=$3, address=$4, town=$5, street=$6, postcode=$7,
       latitude=$8, longitude=$9, rent=$10, service_charge=$11, rateable_value=$12,
       area_sqft=$13, tenure=$14, use_category=$15, availability=$16, agent=$17,
       contact_name=$18, contact_phone=$19, contact_email=$20, landlord_pack=$21,
       document_date=$22, raw_data=$23, updated_at=NOW()`,
    [
      r.id, r.source, r.folderId ?? null, r.address ?? null, r.town ?? null, r.street ?? null,
      r.postcode ?? null, r.latitude ?? null, r.longitude ?? null, r.rent ?? null,
      r.serviceCharge ?? null, r.rateableValue ?? null, r.areaSqft ?? null, r.tenure ?? null,
      r.useCategory ?? null, r.availability ?? null, r.agent ?? null, r.contactName ?? null,
      r.contactPhone ?? null, r.contactEmail ?? null, r.landlordPack ?? null, r.documentDate ?? null,
      r.rawData ? JSON.stringify(r.rawData) : null,
    ]
  );
}

export async function listExternalProperties(): Promise<any[]> {
  await ensureTable();
  const res = await pool.query(`SELECT * FROM external_properties ORDER BY updated_at DESC`);
  return res.rows;
}

export async function countExternalProperties(): Promise<number> {
  await ensureTable();
  const res = await pool.query(`SELECT COUNT(*)::int AS n FROM external_properties`);
  return res.rows[0]?.n ?? 0;
}

export async function externalPropertyExists(id: string): Promise<boolean> {
  await ensureTable();
  const res = await pool.query(`SELECT 1 FROM external_properties WHERE id = $1`, [id]);
  return res.rows.length > 0;
}

// Deterministic dedup id from a normalised address + postcode, so the same
// property forwarded by two people / re-scraped collapses to one row.
export function addressDedupeId(address: string, postcode?: string | null): string {
  const norm = `${address || ""} ${postcode || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const crypto = require("crypto");
  return `addr-${crypto.createHash("sha1").update(norm).digest("hex").slice(0, 16)}`;
}

