// ─────────────────────────────────────────────────────────────────────────
// EPC (non-domestic) register client — free government API.
//
// Every commercial EPC in England & Wales, searchable by postcode. The
// money use-case is MEES: a property rated F or G cannot lawfully be let
// (or continue to be let) without registered works/exemptions, so an F/G
// on a tracked lease event is both a risk flag for the landlord and an
// instruction opportunity for BGP's lease advisory team.
//
// Auth: register (free) at epc.opendatacommunities.org, then set
//   EPC_API_EMAIL  — the account email
//   EPC_API_KEY    — the API key from the account page
// Certificates cache locally (they change rarely; certs last 10 years).
// ─────────────────────────────────────────────────────────────────────────
import { pool } from "./db";

export interface EpcCertificate {
  postcode: string;
  address: string;
  band: string;        // A+ .. G
  score: number | null;
  lodgedAt: string | null;
  expiresAt: string | null;
}

export function isEpcConfigured(): boolean {
  return !!(process.env.EPC_API_EMAIL && process.env.EPC_API_KEY);
}

// MEES position from the band. F/G = sub-standard (unlawful to let without
// a registered exemption). D/E = lettable today but on the wrong side of
// the government's proposed 2030 trajectory (EPC B/C) — worth a watch flag.
export function meesRisk(band: string | null | undefined): "sub_standard" | "future_risk" | "ok" | null {
  const b = (band || "").trim().toUpperCase();
  if (!b) return null;
  if (b === "F" || b === "G") return "sub_standard";
  if (b === "D" || b === "E") return "future_risk";
  return "ok";
}

let tableEnsured = false;
async function ensureTables(): Promise<void> {
  if (tableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS epc_certificates (
      id           SERIAL PRIMARY KEY,
      postcode     TEXT NOT NULL,
      address      TEXT NOT NULL,
      band         TEXT NOT NULL,
      score        INTEGER,
      lodged_at    DATE,
      expires_at   DATE,
      lmk_key      TEXT UNIQUE,
      fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_epc_certificates_postcode ON epc_certificates (postcode);
    CREATE TABLE IF NOT EXISTS epc_fetch_log (
      postcode     TEXT PRIMARY KEY,
      fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      cert_count   INTEGER NOT NULL DEFAULT 0
    );
  `);
  tableEnsured = true;
}

const normPc = (pc: string) => pc.toUpperCase().replace(/\s+/g, "");
const displayPc = (pc: string) => {
  const p = normPc(pc);
  return p.length > 3 ? `${p.slice(0, -3)} ${p.slice(-3)}` : p;
};

/** Fetch + cache every non-domestic cert at a postcode. Refreshes monthly. */
export async function epcForPostcode(rawPostcode: string): Promise<EpcCertificate[]> {
  await ensureTables();
  const pc = displayPc(rawPostcode);
  if (!pc) return [];

  const { rows: log } = await pool.query(
    `SELECT 1 FROM epc_fetch_log WHERE postcode = $1 AND fetched_at > now() - interval '30 days'`,
    [pc],
  );
  if (!log[0] && isEpcConfigured()) {
    try {
      const auth = Buffer.from(`${process.env.EPC_API_EMAIL}:${process.env.EPC_API_KEY}`).toString("base64");
      const resp = await fetch(
        `https://epc.opendatacommunities.org/api/v1/non-domestic/search?postcode=${encodeURIComponent(pc)}&size=200`,
        { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" }, signal: AbortSignal.timeout(15000) },
      );
      // 200 with rows, or 204 empty — both are a successful fetch.
      const data = resp.status === 200 ? await resp.json().catch(() => null) : null;
      const certs: any[] = data?.rows || [];
      for (const c of certs) {
        const lodged = c["lodgement-date"] || null;
        const expires = lodged ? new Date(new Date(lodged).setFullYear(new Date(lodged).getFullYear() + 10)).toISOString().slice(0, 10) : null;
        await pool.query(
          `INSERT INTO epc_certificates (postcode, address, band, score, lodged_at, expires_at, lmk_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (lmk_key) DO UPDATE SET band = $3, score = $4, lodged_at = $5, expires_at = $6, fetched_at = now()`,
          [
            pc,
            [c["address1"], c["address2"], c["address3"]].filter(Boolean).join(", ") || c["address"] || "",
            String(c["asset-rating-band"] || "").toUpperCase(),
            Number.isFinite(Number(c["asset-rating"])) ? Number(c["asset-rating"]) : null,
            lodged,
            expires,
            c["lmk-key"] || `${pc}-${c["building-reference-number"] || Math.random()}`,
          ],
        ).catch(() => {});
      }
      await pool.query(
        `INSERT INTO epc_fetch_log (postcode, fetched_at, cert_count) VALUES ($1, now(), $2)
         ON CONFLICT (postcode) DO UPDATE SET fetched_at = now(), cert_count = $2`,
        [pc, certs.length],
      );
      if (resp.status !== 200 && resp.status !== 204) {
        console.warn(`[epc] register returned ${resp.status} for ${pc}`);
      }
    } catch (err: any) {
      console.warn(`[epc] fetch failed for ${pc}:`, err?.message);
    }
  }

  const { rows } = await pool.query(
    `SELECT postcode, address, band, score,
            to_char(lodged_at, 'YYYY-MM-DD') AS lodged, to_char(expires_at, 'YYYY-MM-DD') AS expires
       FROM epc_certificates WHERE postcode = $1
      ORDER BY lodged_at DESC NULLS LAST`,
    [pc],
  );
  return rows.map((r: any) => ({
    postcode: r.postcode, address: r.address, band: r.band, score: r.score,
    lodgedAt: r.lodged, expiresAt: r.expires,
  }));
}

/** Best cert for a specific address at the postcode — matched on the street
 *  number when one exists; latest lodgement wins. */
export async function epcForAddress(rawPostcode: string, address: string): Promise<EpcCertificate | null> {
  const certs = await epcForPostcode(rawPostcode);
  if (certs.length === 0) return null;
  const num = (address.match(/\b(\d+[a-z]?(?:-\d+[a-z]?)?)\b/i) || [])[1];
  if (num) {
    const hit = certs.find(c => new RegExp(`(^|[^0-9])${num.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9]|$)`, "i").test(c.address));
    if (hit) return hit;
  }
  return certs.length === 1 ? certs[0] : null; // ambiguous multi-cert postcode → don't guess
}
