// ─────────────────────────────────────────────────────────────────────────
// ComplyAdvantage Mesh API integration
//
// Authenticates via OAuth2 (username + password + realm → bearer token),
// then screens names against PEP, sanctions, and adverse media watchlists.
//
// Env vars:
//   COMPLY_ADVANTAGE_USERNAME  — API user email
//   COMPLY_ADVANTAGE_PASSWORD  — password
//   COMPLY_ADVANTAGE_REALM     — case-sensitive realm from onboarding
// ─────────────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.mesh.complyadvantage.com";

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function getCredentials() {
  const username = process.env.COMPLY_ADVANTAGE_USERNAME?.trim();
  const password = process.env.COMPLY_ADVANTAGE_PASSWORD?.trim();
  const realm = process.env.COMPLY_ADVANTAGE_REALM?.trim();
  return { username, password, realm };
}

export function isComplyAdvantageConfigured(): boolean {
  const { username, password, realm } = getCredentials();
  return !!(username && password && realm);
}

/**
 * Obtain a bearer token (cached for 23h to stay inside the 24h window).
 */
export async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const { username, password, realm } = getCredentials();
  if (!username || !password || !realm) {
    throw new Error("ComplyAdvantage credentials not configured");
  }

  const res = await fetch(`${BASE_URL}/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, realm }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ComplyAdvantage auth failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  const accessToken = data.access_token || data.token;
  if (!accessToken) {
    throw new Error("ComplyAdvantage auth response missing access_token");
  }

  cachedToken = accessToken;
  // Refresh 1 hour before expiry (tokens last 24h = 86400s)
  const expiresIn = data.expires_in || 86400;
  tokenExpiresAt = Date.now() + (expiresIn - 3600) * 1000;
  return accessToken;
}

/**
 * Ping: obtain a token to verify credentials are valid.
 */
export async function pingComplyAdvantage(): Promise<{ ok: boolean; status?: number; message: string }> {
  if (!isComplyAdvantageConfigured()) {
    return { ok: false, message: "ComplyAdvantage credentials not set (need USERNAME, PASSWORD, REALM)" };
  }
  try {
    const token = await getToken();
    return { ok: true, message: `Token obtained (${token.slice(0, 8)}…)` };
  } catch (err: any) {
    return { ok: false, message: `ComplyAdvantage auth failed: ${err?.message || "unknown"}` };
  }
}

export interface ScreeningMatch {
  name: string;
  matchType: string; // "sanctions" | "pep" | "adverse_media" | "warning"
  listName?: string;
  score?: number;
  details?: Record<string, unknown>;
}

export interface ScreeningResult {
  name: string;
  role?: string;
  status: "clear" | "potential_match" | "strong_match";
  matches: ScreeningMatch[];
  riskLevel?: string;
}

/**
 * Screen a list of names against ComplyAdvantage PEP/sanctions/adverse media.
 */
export async function screenNames(
  names: Array<{ name: string; role?: string }>,
): Promise<ScreeningResult[]> {
  if (!isComplyAdvantageConfigured()) return [];
  const token = await getToken();
  const results: ScreeningResult[] = [];

  for (const { name, role } of names) {
    try {
      const res = await fetch(`${BASE_URL}/v2/searches`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          search_term: name,
          fuzziness: 0.6,
          filters: {
            types: ["sanction", "pep", "adverse-media", "warning"],
          },
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[ComplyAdvantage] Screen failed for "${name}": ${res.status} ${body.slice(0, 200)}`);
        results.push({ name, role, status: "clear", matches: [] });
        continue;
      }

      const data = await res.json() as any;
      const hits = data.content?.data?.hits || data.data?.hits || data.hits || [];
      const matches: ScreeningMatch[] = [];

      for (const hit of hits) {
        const types = hit.types || [];
        for (const type of types) {
          matches.push({
            name: hit.doc?.name || hit.name || name,
            matchType: type,
            listName: hit.doc?.source_notes?.listing || hit.source || undefined,
            score: hit.score || hit.match_score || undefined,
            details: {
              entityType: hit.doc?.entity_type,
              fields: hit.doc?.fields,
              sources: hit.doc?.sources,
              aka: hit.doc?.aka,
            },
          });
        }
        if (types.length === 0) {
          matches.push({
            name: hit.doc?.name || hit.name || name,
            matchType: "unknown",
            score: hit.score || hit.match_score || undefined,
          });
        }
      }

      let status: "clear" | "potential_match" | "strong_match" = "clear";
      if (matches.length > 0) {
        const maxScore = Math.max(...matches.map(m => m.score || 0));
        status = maxScore >= 0.9 ? "strong_match" : "potential_match";
      }

      results.push({ name, role, status, matches, riskLevel: data.content?.data?.risk_level });
    } catch (err: any) {
      console.error(`[ComplyAdvantage] Error screening "${name}":`, err?.message);
      results.push({ name, role, status: "clear", matches: [] });
    }
  }

  return results;
}
