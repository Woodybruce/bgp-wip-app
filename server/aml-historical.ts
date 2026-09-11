// ─── Historical KYC SharePoint lookup ──────────────────────────────────────
// Before we hammer Companies House / ComplyAdvantage / Perplexity for a
// counterparty, check the BGP KYC SharePoint folder for any prior pack on the
// same entity. If we passed them in the last 12 months we can short-circuit
// most of the sweep — just re-run the time-sensitive checks (sanctions,
// adverse media — they go stale daily) and reuse the rest.
//
// Uses the app-only Graph token from shared-mailbox.ts so this works from
// background contexts (cron, backfill, auto-fire on counterparty link) where
// there's no req.session.
// ──────────────────────────────────────────────────────────────────────────

import { graphRequest } from "./shared-mailbox";

const SP_HOST = "brucegillinghampollardlimited.sharepoint.com";
const SP_SITE = "BGP";
// Folder path inside the BGP shared drive where historical KYC packs live.
// Defaults to "KYC" — override with env var BGP_KYC_HISTORICAL_FOLDER if
// the team filed historical packs elsewhere (e.g. "Compliance/KYC Archive").
const HISTORICAL_FOLDER = process.env.BGP_KYC_HISTORICAL_FOLDER || "KYC";

// Cached drive id — Graph site/drive lookup is slow, doesn't change.
let cachedDriveId: { id: string; expiresAt: number } | null = null;

async function getDriveId(): Promise<string | null> {
  if (cachedDriveId && cachedDriveId.expiresAt > Date.now()) {
    return cachedDriveId.id;
  }
  try {
    const site: any = await graphRequest(`/sites/${SP_HOST}:/sites/${SP_SITE}`);
    if (!site?.id) return null;
    const drive: any = await graphRequest(`/sites/${site.id}/drive`);
    if (!drive?.id) return null;
    cachedDriveId = { id: drive.id, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
    return drive.id;
  } catch (e: any) {
    console.warn("[aml-historical] drive lookup failed:", e?.message);
    return null;
  }
}

export interface HistoricalKycMatch {
  fileId: string;
  name: string;
  path: string;
  webUrl: string;
  lastModified: string;
  ageDays: number;
  size: number;
}

// Search for files matching the company name inside the historical KYC folder.
// Graph's /drives/{id}/root/search(q='...') hits the entire drive — we then
// filter by parent path so we only consider items inside HISTORICAL_FOLDER.
export async function findHistoricalKycMatches(companyName: string): Promise<HistoricalKycMatch[]> {
  if (!companyName || companyName.trim().length < 3) return [];

  const driveId = await getDriveId();
  if (!driveId) return [];

  // Strip common suffixes that confuse search ("Limited", "Ltd", "PLC" etc.)
  const cleaned = companyName
    .replace(/\b(limited|ltd|plc|llp|llc|inc|incorporated|holdings|group)\b/gi, "")
    .replace(/[.,&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const query = cleaned.length >= 3 ? cleaned : companyName;

  try {
    const data: any = await graphRequest(
      `/drives/${driveId}/root/search(q='${encodeURIComponent(query)}')?$select=id,name,webUrl,lastModifiedDateTime,size,parentReference&$top=25`
    );
    const items = Array.isArray(data?.value) ? data.value : [];
    const folderLower = HISTORICAL_FOLDER.toLowerCase();
    const now = Date.now();

    return items
      .filter((it: any) => {
        const path = (it?.parentReference?.path || "").toLowerCase();
        // Match if the parent path contains the historical folder anywhere
        return path.includes(`/${folderLower}`) || path.endsWith(`/${folderLower}`);
      })
      .map((it: any) => {
        const lm = it.lastModifiedDateTime || new Date().toISOString();
        const ageDays = Math.floor((now - new Date(lm).getTime()) / (24 * 60 * 60 * 1000));
        return {
          fileId: String(it.id),
          name: String(it.name || ""),
          path: String(it?.parentReference?.path || ""),
          webUrl: String(it.webUrl || ""),
          lastModified: lm,
          ageDays,
          size: Number(it.size || 0),
        };
      })
      // Sort newest first — most recent pack is the most useful.
      .sort((a: HistoricalKycMatch, b: HistoricalKycMatch) => a.ageDays - b.ageDays);
  } catch (e: any) {
    console.warn("[aml-historical] search failed:", e?.message);
    return [];
  }
}

// Convenience: any pack within the last 12 months counts as a "fresh" prior
// pass — older packs we still surface but the orchestrator won't short-circuit.
export function hasFreshHistoricalPack(matches: HistoricalKycMatch[]): boolean {
  return matches.some(m => m.ageDays <= 365);
}
