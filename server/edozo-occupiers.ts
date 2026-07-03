/**
 * Edozo occupier source.
 *
 * Pulls the occupier plan for a viewport from Edozo's occupier WFS
 * (api.edozo.com/map/occupier/wfs) under our own subscription, and normalises
 * each feature into a goad_units row. Used only with Edozo's agreement — this
 * is our licensed feed, not a scrape of someone else's map.
 *
 * The WFS returns MultiPolygon geometry in EPSG:27700 with, per unit:
 *   properties.toid                         OS MasterMap TOID
 *   properties.occupiers[].edozo_organisation_name   occupier name
 *   properties.metadata.classification      occupied | vacant
 *   properties.text.rotation                label placement hint (deg)
 *
 * Auth: Edozo is behind Auth0. Provide EDOZO_ACCESS_TOKEN directly, or set
 * EDOZO_CLIENT_ID + EDOZO_USERNAME + EDOZO_PASSWORD and we fetch a token via
 * the Auth0 password grant (cached, refreshed on 401).
 */
import { bngToWgs84, wgs84ToBng, normaliseCategory, type NormalisedUnit } from "./goad-units";

const EDOZO_API = "https://api.edozo.com";
const AUTH0_TOKEN_URL = "https://login.edozo.com/oauth/token";
const EDOZO_AUDIENCE = "https://api.edozo.com";

export function isEdozoConfigured(): boolean {
  return Boolean(
    process.env.EDOZO_ACCESS_TOKEN ||
      (process.env.EDOZO_CLIENT_ID && process.env.EDOZO_CLIENT_SECRET) ||
      (process.env.EDOZO_CLIENT_ID && process.env.EDOZO_USERNAME && process.env.EDOZO_PASSWORD),
  );
}

let cachedToken: { token: string; expires: number } | null = null;

// Acquire a bearer token. Three modes, in order of preference:
//   1. EDOZO_ACCESS_TOKEN            — a token pasted in (quick test; expires)
//   2. client_credentials (M2M)      — EDOZO_CLIENT_ID + EDOZO_CLIENT_SECRET
//                                       (the durable path; needs an Edozo M2M app)
//   3. password grant                — EDOZO_CLIENT_ID + EDOZO_USERNAME/PASSWORD
//                                       (only if Edozo enables it on the client)
async function getToken(force = false): Promise<string | null> {
  if (process.env.EDOZO_ACCESS_TOKEN) return process.env.EDOZO_ACCESS_TOKEN.trim();
  if (!force && cachedToken && Date.now() < cachedToken.expires) return cachedToken.token;

  const clientId = process.env.EDOZO_CLIENT_ID;
  const clientSecret = process.env.EDOZO_CLIENT_SECRET;
  const username = process.env.EDOZO_USERNAME;
  const password = process.env.EDOZO_PASSWORD;
  if (!clientId) return null;

  let body: Record<string, any> | null = null;
  if (clientSecret && !password) {
    body = { grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, audience: EDOZO_AUDIENCE };
  } else if (username && password) {
    body = {
      grant_type: "password", username, password, client_id: clientId,
      client_secret: clientSecret || undefined, audience: EDOZO_AUDIENCE,
      scope: "openid profile email get:occupierWfsData list:occupierMap read:occupierMap",
    };
  }
  if (!body) return null;

  try {
    const resp = await fetch(AUTH0_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      console.warn(`[edozo] token grant failed ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      return null;
    }
    const j: any = await resp.json();
    if (!j.access_token) return null;
    cachedToken = { token: j.access_token, expires: Date.now() + ((j.expires_in || 3600) - 60) * 1000 };
    return cachedToken.token;
  } catch (err: any) {
    console.warn("[edozo] token error:", err?.message);
    return null;
  }
}

// Build the BNG WKT rectangle Edozo expects from a WGS84 viewport. We transform
// all four corners rather than two, so grid convergence doesn't clip the box.
function bboxToWktBng(bbox: { south: number; west: number; north: number; east: number }): string {
  const corners: [number, number][] = [
    [bbox.south, bbox.west],
    [bbox.north, bbox.west],
    [bbox.north, bbox.east],
    [bbox.south, bbox.east],
  ].map(([lat, lng]) => wgs84ToBng(lat, lng));
  let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity;
  for (const [e, n] of corners) {
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
    if (n < minN) minN = n;
    if (n > maxN) maxN = n;
  }
  return `POLYGON((${minE} ${minN},${maxE} ${minN},${maxE} ${maxN},${minE} ${maxN},${minE} ${minN}))`;
}

function reprojectGeometry(geom: any): any {
  const conv = (c: any): any => {
    if (typeof c[0] === "number") {
      const [lat, lng] = bngToWgs84(c[0], c[1]);
      return [lng, lat]; // GeoJSON is [lng, lat]
    }
    return c.map(conv);
  };
  if (!geom?.coordinates) return geom;
  return { type: geom.type, coordinates: geom.coordinates.map(conv) };
}

export interface EdozoFetchResult {
  units: NormalisedUnit[];
  total: number;
}

/**
 * Fetch + normalise the occupier plan for a WGS84 bbox. Returns [] if Edozo is
 * not configured or the call fails (caller falls back to whatever's cached).
 */
export async function fetchEdozoOccupiers(bbox: { south: number; west: number; north: number; east: number }): Promise<EdozoFetchResult> {
  let token = await getToken();
  if (!token) return { units: [], total: 0 };
  const wkt = bboxToWktBng(bbox);
  const url = `${EDOZO_API}/map/occupier/wfs?wkt=${encodeURIComponent(wkt)}`;

  let resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (resp && resp.status === 401) {
    token = await getToken(true);
    if (token) resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20000) }).catch(() => null);
  }
  if (!resp || !resp.ok) {
    if (resp) console.warn(`[edozo] occupier wfs ${resp.status}`);
    return { units: [], total: 0 };
  }
  const fc: any = await resp.json();
  const feats: any[] = fc?.features || [];
  const units: NormalisedUnit[] = [];
  for (const f of feats) {
    const p = f.properties || {};
    const toid: string | null = p.toid || null;
    const occ = Array.isArray(p.occupiers) ? p.occupiers : [];
    const primary = occ.find((o: any) => o.orderId === 0) || occ[0];
    const nameRaw = (primary?.edozo_organisation_name || "").replace(/\n/g, " ").trim();
    const classification = (p.metadata?.classification === "vacant" || nameRaw.toUpperCase() === "VACANT") ? "vacant" : "occupied";
    const geometry = reprojectGeometry(f.geometry);
    const floorLevel = "GF";
    const externalKey = `edozo:${floorLevel}:${toid || f.id || nameRaw}`;
    units.push({
      externalKey,
      source: "edozo",
      toid,
      centreCode: null,
      floorLevel,
      occupierName: nameRaw || null,
      classification,
      category: null,
      categoryGroup: normaliseCategory({ occupierName: nameRaw, classification }),
      geometry,
      labelRotation: typeof p.text?.rotation === "number" ? p.text.rotation : null,
      labelSize: typeof p.text?.size === "number" ? p.text.size : null,
      rawProps: { occupiers: occ, metadata: p.metadata, fill: p.fill, stroke: p.stroke },
    });
  }
  return { units, total: Number(fc?.totalFeatures) || feats.length };
}
