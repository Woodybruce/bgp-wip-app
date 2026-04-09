import { Router } from "express";
import { requireAuth } from "./auth";

const router = Router();

const SANCTIONS_CSV_URL = "https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface SanctionEntry {
  uniqueId: string;
  name: string;
  nameType: string;
  regime: string;
  designationType: string;
  sanctionsImposed: string;
  nationality: string;
  dob: string;
  entityType: string;
  dateDesignated: string;
}

let sanctionsCache: SanctionEntry[] = [];
let cacheLoadedAt = 0;
let loadPromise: Promise<void> | null = null;

export function isSanctionsListLoaded(): boolean {
  return sanctionsCache.length > 0;
}

const LEGAL_SUFFIXES = /\b(ltd|limited|llc|llp|plc|inc|incorporated|corp|corporation|gmbh|sa|ag|bv|nv|pty|co)\b/g;

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(LEGAL_SUFFIXES, "").replace(/\s+/g, " ").trim();
}

function tokenMatch(query: string, target: string): number {
  const qTokens = normalise(query).split(" ").filter(Boolean);
  const tTokens = normalise(target).split(" ").filter(Boolean);
  if (qTokens.length === 0 || tTokens.length === 0) return 0;

  let matched = 0;
  for (const qt of qTokens) {
    for (const tt of tTokens) {
      if (tt === qt) { matched++; break; }
      if (tt.length > 3 && qt.length > 3 && (tt.includes(qt) || qt.includes(tt))) { matched += 0.7; break; }
      if (levenshtein(qt, tt) <= 1 && qt.length > 2) { matched += 0.8; break; }
    }
  }
  return matched / Math.max(qTokens.length, tTokens.length);
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseFullCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field.trim());
        field = "";
      } else if (ch === "\n" || (ch === "\r" && text[i + 1] === "\n")) {
        row.push(field.trim());
        if (row.some(f => f)) rows.push(row);
        row = [];
        field = "";
        if (ch === "\r") i++;
      } else {
        field += ch;
      }
    }
  }
  if (field || row.length > 0) {
    row.push(field.trim());
    if (row.some(f => f)) rows.push(row);
  }
  return rows;
}

async function doLoadSanctionsList(): Promise<void> {
  try {
    console.log("[sanctions] Downloading UK Sanctions List...");
    const res = await fetch(SANCTIONS_CSV_URL);
    if (!res.ok) throw new Error(`Failed to download sanctions list: ${res.status}`);
    const text = await res.text();
    const rows = parseFullCSV(text);

    let headerIdx = -1;
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      if (rows[i].some(h => h === "Unique ID") && rows[i].some(h => h === "Name 1")) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) throw new Error("Could not find header row in sanctions CSV");

    const headers = rows[headerIdx];
    const colIdx = (name: string) => headers.findIndex(h => h === name);

    const iUniqueId = colIdx("Unique ID");
    const iName6 = colIdx("Name 6");
    const iName1 = colIdx("Name 1");
    const iName2 = colIdx("Name 2");
    const iNameType = colIdx("Name type");
    const iRegime = colIdx("Regime Name");
    const iDesType = colIdx("Designation Type");
    const iSanctions = colIdx("Sanctions Imposed");
    const iNationality = colIdx("Nationality(/ies)");
    const iDob = colIdx("D.O.B");
    const iEntityType = colIdx("Type of entity");
    const iDateDesignated = colIdx("Date Designated");

    const seen = new Set<string>();
    const entries: SanctionEntry[] = [];

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const fields = rows[i];
      const name6 = fields[iName6] || "";
      const name1 = fields[iName1] || "";
      const name2 = fields[iName2] || "";
      const fullName = [name6, name1, name2].filter(Boolean).join(" ").trim();
      if (!fullName) continue;

      const uid = fields[iUniqueId] || "";
      const dedup = `${uid}:${normalise(fullName)}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);

      entries.push({
        uniqueId: uid,
        name: fullName,
        nameType: fields[iNameType] || "",
        regime: fields[iRegime] || "",
        designationType: fields[iDesType] || "",
        sanctionsImposed: fields[iSanctions] || "",
        nationality: fields[iNationality] || "",
        dob: fields[iDob] || "",
        entityType: fields[iEntityType] || "",
        dateDesignated: fields[iDateDesignated] || "",
      });
    }

    sanctionsCache = entries;
    cacheLoadedAt = Date.now();
    console.log(`[sanctions] Loaded ${entries.length} unique sanctions entries`);
  } catch (err) {
    console.error("[sanctions] Failed to load sanctions list:", (err as Error).message);
  }
}

export async function loadSanctionsList(): Promise<void> {
  if (sanctionsCache.length > 0 && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return;
  if (loadPromise) return loadPromise;
  loadPromise = doLoadSanctionsList().finally(() => { loadPromise = null; });
  return loadPromise;
}

export function screenName(name: string, threshold = 0.6): Array<{ entry: SanctionEntry; score: number }> {
  const results: Array<{ entry: SanctionEntry; score: number }> = [];
  if (!name.trim()) return results;

  for (const entry of sanctionsCache) {
    const score = tokenMatch(name, entry.name);
    if (score >= threshold) {
      results.push({ entry, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 5);
}

interface ScreeningResult {
  name: string;
  role: string;
  matches: Array<{
    sanctionedName: string;
    matchScore: number;
    regime: string;
    sanctionsImposed: string;
    nationality: string;
    entityType: string;
    dateDesignated: string;
  }>;
  status: "clear" | "potential_match" | "strong_match";
}

router.post("/api/sanctions/screen", requireAuth, async (req, res) => {
  try {
    const { names } = req.body as { names: Array<{ name: string; role: string }> };
    if (!names || !Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ error: "Provide an array of {name, role} objects" });
    }

    await loadSanctionsList();

    if (sanctionsCache.length === 0) {
      return res.status(503).json({ error: "Sanctions list not available — try again shortly" });
    }

    const results: ScreeningResult[] = [];
    for (const { name, role } of names.slice(0, 50)) {
      const matches = screenName(name);
      const status: ScreeningResult["status"] = matches.some(m => m.score >= 0.9)
        ? "strong_match"
        : matches.length > 0
          ? "potential_match"
          : "clear";

      results.push({
        name,
        role,
        matches: matches.map(m => ({
          sanctionedName: m.entry.name,
          matchScore: Math.round(m.score * 100),
          regime: m.entry.regime,
          sanctionsImposed: m.entry.sanctionsImposed,
          nationality: m.entry.nationality,
          entityType: m.entry.entityType,
          dateDesignated: m.entry.dateDesignated,
        })),
        status,
      });
    }

    const overallStatus = results.some(r => r.status === "strong_match")
      ? "alert"
      : results.some(r => r.status === "potential_match")
        ? "review"
        : "clear";

    res.json({
      screenedAt: new Date().toISOString(),
      listDate: sanctionsCache.length > 0 ? "UK Sanctions List (FCDO)" : null,
      totalEntries: sanctionsCache.length,
      results,
      overallStatus,
    });
  } catch (err: any) {
    console.error("[sanctions] Screening error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/sanctions/status", requireAuth, async (_req, res) => {
  res.json({
    loaded: sanctionsCache.length > 0,
    entries: sanctionsCache.length,
    loadedAt: cacheLoadedAt > 0 ? new Date(cacheLoadedAt).toISOString() : null,
    source: "UK Sanctions List (FCDO)",
  });
});

export function assessRisk(profile: any, officers: any[], pscs: any[], screeningResults?: ScreeningResult[]): {
  score: number;
  level: "low" | "medium" | "high" | "critical";
  factors: Array<{ factor: string; impact: "positive" | "negative" | "neutral"; weight: number }>;
} {
  const factors: Array<{ factor: string; impact: "positive" | "negative" | "neutral"; weight: number }> = [];
  let riskScore = 0;

  if (profile?.companyStatus === "active") {
    factors.push({ factor: "Company is active", impact: "positive", weight: -10 });
    riskScore -= 10;
  } else {
    factors.push({ factor: `Company status: ${profile?.companyStatus || "unknown"}`, impact: "negative", weight: 30 });
    riskScore += 30;
  }

  if (profile?.hasInsolvencyHistory) {
    factors.push({ factor: "Has insolvency history", impact: "negative", weight: 25 });
    riskScore += 25;
  } else {
    factors.push({ factor: "No insolvency history", impact: "positive", weight: -5 });
    riskScore -= 5;
  }

  if (profile?.accountsOverdue) {
    factors.push({ factor: "Accounts overdue", impact: "negative", weight: 20 });
    riskScore += 20;
  }

  if (profile?.confirmationStatementOverdue) {
    factors.push({ factor: "Confirmation statement overdue", impact: "negative", weight: 15 });
    riskScore += 15;
  }

  if (profile?.hasCharges) {
    factors.push({ factor: "Has charges on file", impact: "neutral", weight: 5 });
    riskScore += 5;
  }

  if (profile?.dateOfCreation) {
    const age = (Date.now() - new Date(profile.dateOfCreation).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (age < 1) {
      factors.push({ factor: "Company less than 1 year old", impact: "negative", weight: 15 });
      riskScore += 15;
    } else if (age < 3) {
      factors.push({ factor: "Company less than 3 years old", impact: "neutral", weight: 5 });
      riskScore += 5;
    } else {
      factors.push({ factor: `Company ${Math.floor(age)} years old`, impact: "positive", weight: -5 });
      riskScore -= 5;
    }
  }

  if (pscs.length === 0) {
    factors.push({ factor: "No PSCs identified — opaque ownership", impact: "negative", weight: 20 });
    riskScore += 20;
  } else {
    factors.push({ factor: `${pscs.length} PSC(s) identified`, impact: "positive", weight: -5 });
    riskScore -= 5;
  }

  if (officers.length === 0) {
    factors.push({ factor: "No active officers found", impact: "negative", weight: 15 });
    riskScore += 15;
  }

  const HIGH_RISK_JURISDICTIONS = ["russia", "belarus", "iran", "north korea", "dprk", "syria", "myanmar", "yemen", "libya", "afghanistan", "somalia", "south sudan", "democratic republic of the congo"];
  const allNationalities = [...officers, ...pscs].map(p => (p.nationality || "").toLowerCase()).filter(Boolean);
  const allCountries = [...pscs].map(p => (p.countryOfResidence || "").toLowerCase()).filter(Boolean);
  const allJurisdictions = [...allNationalities, ...allCountries];

  for (const j of allJurisdictions) {
    if (HIGH_RISK_JURISDICTIONS.some(hrj => j.includes(hrj))) {
      factors.push({ factor: `High-risk jurisdiction: ${j}`, impact: "negative", weight: 25 });
      riskScore += 25;
      break;
    }
  }

  if (screeningResults) {
    const strongMatches = screeningResults.filter(r => r.status === "strong_match").length;
    const potentialMatches = screeningResults.filter(r => r.status === "potential_match").length;

    if (strongMatches > 0) {
      factors.push({ factor: `${strongMatches} strong sanctions match(es)`, impact: "negative", weight: 50 });
      riskScore += 50;
    } else if (potentialMatches > 0) {
      factors.push({ factor: `${potentialMatches} potential sanctions match(es) — review required`, impact: "negative", weight: 20 });
      riskScore += 20;
    } else {
      factors.push({ factor: "No sanctions matches", impact: "positive", weight: -10 });
      riskScore -= 10;
    }
  }

  const clampedScore = Math.max(0, Math.min(100, riskScore));
  const level = clampedScore >= 70 ? "critical" : clampedScore >= 40 ? "high" : clampedScore >= 20 ? "medium" : "low";

  return { score: clampedScore, level, factors };
}

export default router;
