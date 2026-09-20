/**
 * Legacy deal-status audit — READ-ONLY. Detects crm_deals.status values that
 * are not canonical codes (shared/deal-status.ts: OPP/REP/SPEC/LIVE/AVA/NEG/
 * HOT/SOL/EXC/COM/WIT/INV), e.g. historical "Completed" / "Under Offer"
 * strings that predate the normalisation migration.
 *
 * Buckets every distinct stored status into:
 *   canonical       — already a code
 *   legacy-mapped   — legacyToCode() resolves it (safe at read sites, but
 *                     should be migrated to the code)
 *   excluded legacy — comps rows ("leasing comps" etc.), kept out of active
 *                     views by design
 *   UNKNOWN         — nothing resolves it; these render as pipeline/blank
 *                     and need human review
 *
 * Run with:  npx tsx scripts/audit-deal-status.ts
 *
 * No DB writes — report only. Migration is a separate, signed-off step.
 */

import "dotenv/config";
import { pool } from "../server/db";
import {
  DEAL_STATUS_CODES,
  DEAL_STATUS_LABELS,
  legacyToCode,
  isExcludedLegacyStatus,
} from "../shared/deal-status";

async function main() {
  const { rows } = await pool.query<{ status: string | null; n: string }>(`
    SELECT status, COUNT(*)::text AS n
      FROM crm_deals
     GROUP BY status
     ORDER BY COUNT(*) DESC, status`);

  const buckets = { canonical: 0, legacyMapped: 0, excludedLegacy: 0, unknown: 0, nullStatus: 0 };
  const legacyRows: { status: string; n: number; mapsTo: string }[] = [];
  const unknownRows: { status: string; n: number }[] = [];

  for (const r of rows) {
    const n = Number(r.n);
    if (r.status === null) {
      buckets.nullStatus += n;
      continue;
    }
    const trimmed = r.status.trim();
    if ((DEAL_STATUS_CODES as readonly string[]).includes(trimmed)) {
      buckets.canonical += n;
      continue;
    }
    if (isExcludedLegacyStatus(trimmed)) {
      buckets.excludedLegacy += n;
      continue;
    }
    const code = legacyToCode(trimmed);
    if (code) {
      buckets.legacyMapped += n;
      legacyRows.push({ status: r.status, n, mapsTo: `${code} (${DEAL_STATUS_LABELS[code]})` });
    } else {
      buckets.unknown += n;
      unknownRows.push({ status: r.status, n });
    }
  }

  console.log("=== crm_deals.status audit (read-only) ===\n");
  console.log(`canonical codes:        ${buckets.canonical}`);
  console.log(`legacy but mapped:      ${buckets.legacyMapped}`);
  console.log(`excluded legacy (comps):${buckets.excludedLegacy}`);
  console.log(`UNKNOWN (unresolvable): ${buckets.unknown}`);
  console.log(`NULL status:            ${buckets.nullStatus}`);

  if (legacyRows.length) {
    console.log("\n── legacy-mapped values (migrate to the code) ──");
    for (const r of legacyRows) console.log(`  ${String(r.n).padStart(6)}  "${r.status}" → ${r.mapsTo}`);
  }
  if (unknownRows.length) {
    console.log("\n── UNKNOWN values (legacyToCode returns null — needs review) ──");
    for (const r of unknownRows) console.log(`  ${String(r.n).padStart(6)}  "${r.status}"`);
  }

  // The specific legacy value Delivery 1.5 is checking for.
  const completed = rows.filter((r) => (r.status || "").trim().toLowerCase() === "completed");
  const completedN = completed.reduce((a, r) => a + Number(r.n), 0);
  console.log(`\nlegacy 'completed' rows: ${completedN}${completedN ? " (map to COM)" : ""}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
