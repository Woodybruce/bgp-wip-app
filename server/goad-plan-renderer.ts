/**
 * Renderer for the BGP Goad-style retail plan.
 *
 * Takes the MappedUnit list from goad-plan-data.ts and produces an SVG →
 * PNG plan of the streetscape: OSM building polygons as the base, each
 * mapped unit coloured by category with its tenant name rotated along
 * the polygon's long axis, and the subject property drawn as a red-line
 * outline. Output is intentionally simple and readable — BGP-branded
 * (Tiempos, Claude-orange accent), not a literal Goad clone.
 *
 * Layout:
 *   ┌──────────────────────────────────────┐
 *   │ Title block / postcode               │
 *   ├──────────────────────────────────────┤
 *   │                                      │
 *   │          MAP (SVG of buildings)      │
 *   │                                      │
 *   ├──────────────────────────────────────┤
 *   │ Legend          · Scale · N ↑       │
 *   └──────────────────────────────────────┘
 */
import sharp from "sharp";
import { CATEGORY_STYLES, PLAN_COLORS, shortUseLabel, type RetailCategory } from "./goad-taxonomy";
import type { MappedUnit } from "./goad-plan-data";

// ---------------------------------------------------------------------------
// Overpass — buildings + roads inside the bbox
// ---------------------------------------------------------------------------

interface OverpassNode { id: number; lat: number; lon: number; }
interface OverpassWay { id: number; nodes: number[]; tags?: Record<string, string>; }
interface OverpassData { nodes: Map<number, OverpassNode>; buildings: OverpassWay[]; roads: OverpassWay[]; }

async function fetchOsm(bbox: { south: number; north: number; west: number; east: number }): Promise<OverpassData> {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const query = `[out:json][timeout:25];
(
  way["building"](${b});
  way["highway"](${b});
);
out body;
>;
out skel qt;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const data: any = await res.json();
  const nodes = new Map<number, OverpassNode>();
  const buildings: OverpassWay[] = [];
  const roads: OverpassWay[] = [];
  for (const el of data.elements || []) {
    if (el.type === "node") nodes.set(el.id, { id: el.id, lat: el.lat, lon: el.lon });
    else if (el.type === "way") {
      if (el.tags?.building) buildings.push({ id: el.id, nodes: el.nodes, tags: el.tags });
      else if (el.tags?.highway) roads.push({ id: el.id, nodes: el.nodes, tags: el.tags });
    }
  }
  return { nodes, buildings, roads };
}

// ---------------------------------------------------------------------------
// Projection — lat/lng to SVG pixel. Equirectangular is good enough at
// streetscape scale (<1km).
// ---------------------------------------------------------------------------

interface Projector {
  project(lat: number, lng: number): { x: number; y: number };
  mapWidth: number;
  mapHeight: number;
}

function makeProjector(
  bbox: { south: number; north: number; west: number; east: number },
  mapWidth: number,
  mapHeight: number,
  mapX = 0,
  mapY = 0,
): Projector {
  const midLat = (bbox.south + bbox.north) / 2;
  const kLng = Math.cos((midLat * Math.PI) / 180);
  const dx = (bbox.east - bbox.west) * kLng;
  const dy = bbox.north - bbox.south;
  // Scale so the bbox fits the map pane, preserving aspect.
  const sx = mapWidth / dx;
  const sy = mapHeight / dy;
  const s = Math.min(sx, sy);
  const paneW = dx * s;
  const paneH = dy * s;
  // Project directly into screen coordinates — avoids the clip-path + <g>
  // transform combo that librsvg rasterises unreliably.
  const offX = mapX + (mapWidth - paneW) / 2;
  const offY = mapY + (mapHeight - paneH) / 2;
  return {
    mapWidth,
    mapHeight,
    project(lat: number, lng: number) {
      const x = offX + (lng - bbox.west) * kLng * s;
      const y = offY + (bbox.north - lat) * s;
      return { x, y };
    },
  };
}

// ---------------------------------------------------------------------------
// Polygon helpers — centroid, point-in-polygon, min-area rect
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number };

function centroid(pts: Pt[]): Pt {
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  return { x: sx / pts.length, y: sy / pts.length };
}

function pointInPoly(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polyDiameter(pts: Pt[]): number {
  let max = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > max) max = d;
    }
  }
  return max;
}

/**
 * Minimum-area bounding rectangle via rotating-calipers-lite: try every
 * edge of the convex hull as a candidate orientation and pick the one
 * with the smallest area. Returns the long-axis angle (radians, -π..π)
 * and width/height of that rotated rect so we know how much room the
 * tenant name has.
 */
function minAreaRect(pts: Pt[]): { angle: number; longSide: number; shortSide: number; cx: number; cy: number } {
  if (pts.length < 3) {
    const c = centroid(pts);
    return { angle: 0, longSide: 1, shortSide: 1, cx: c.x, cy: c.y };
  }
  const hull = convexHull(pts);
  let best = { area: Infinity, angle: 0, longSide: 0, shortSide: 0 };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const theta = Math.atan2(b.y - a.y, b.x - a.x);
    const cos = Math.cos(-theta), sin = Math.sin(-theta);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of hull) {
      const rx = p.x * cos - p.y * sin;
      const ry = p.x * sin + p.y * cos;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
    const w = maxX - minX, h = maxY - minY;
    const area = w * h;
    if (area < best.area) {
      const longSide = Math.max(w, h);
      const shortSide = Math.min(w, h);
      // If short side runs along the edge, long-axis angle is perpendicular.
      const longAngle = w >= h ? theta : theta + Math.PI / 2;
      best = { area, angle: longAngle, longSide, shortSide };
    }
  }
  const c = centroid(pts);
  // Keep text reading left-to-right (flip 180° if pointing "upside down").
  let a = best.angle;
  if (a > Math.PI / 2) a -= Math.PI;
  if (a < -Math.PI / 2) a += Math.PI;
  return { angle: a, longSide: best.longSide, shortSide: best.shortSide, cx: c.x, cy: c.y };
}

function convexHull(pts: Pt[]): Pt[] {
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const n = s.length;
  if (n < 3) return s;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// Fonts: librsvg (sharp's SVG backend) doesn't reliably parse WOFF2 variable
// fonts from base64 @font-face — we were getting tofu for every glyph. Rely
// on a clean system serif stack instead. Keeps the BGP "printed plan" feel
// without breaking rendering. We can revisit with @resvg/resvg-js if we need
// exact Tiempos later.
const BASE_FONT = `Georgia, "Times New Roman", "Liberation Serif", serif`;

// ---------------------------------------------------------------------------
// Unit-to-building matching + rendering
// ---------------------------------------------------------------------------

interface PolyBuilding {
  pts: Pt[];
  centroid: Pt;
}

function wayToPoints(way: OverpassWay, data: OverpassData, project: Projector["project"]): Pt[] {
  const pts: Pt[] = [];
  for (const id of way.nodes) {
    const n = data.nodes.get(id);
    if (!n) continue;
    pts.push(project(n.lat, n.lon));
  }
  return pts;
}

function findBuildingForUnit(unit: MappedUnit, buildings: PolyBuilding[], project: Projector["project"]): PolyBuilding | null {
  const up = project(unit.lat, unit.lng);
  // First try: polygon containing the point.
  for (const b of buildings) {
    if (pointInPoly(up, b.pts)) return b;
  }
  // Fallback: nearest centroid within 35 px.
  let best: { b: PolyBuilding | null; d: number } = { b: null, d: 35 };
  for (const b of buildings) {
    const dx = b.centroid.x - up.x, dy = b.centroid.y - up.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < best.d) best = { b, d };
  }
  return best.b;
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + "…";
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export interface RenderGoadPlanArgs {
  subject: MappedUnit;
  units: MappedUnit[];
  bbox: { south: number; north: number; west: number; east: number };
  addressLine: string;
  postcodeLine?: string;
  stats?: { voaRows: number; geocoded: number; placesMatched: number };
}

export interface RenderGoadPlanResult {
  pngBuffer: Buffer;
  width: number;
  height: number;
  svg: string;
  buildingsCount: number;
  matchedUnits: number;
}

export async function renderGoadPlan(args: RenderGoadPlanArgs): Promise<RenderGoadPlanResult> {
  const outWidth = 1600;
  const outHeight = 1200;
  const titleH = 90;
  const legendH = 110;
  const padding = 24;
  const mapWidth = outWidth - padding * 2;
  const mapHeight = outHeight - titleH - legendH - padding * 2;

  const mapX = padding;
  const mapY = titleH + padding;
  const projector = makeProjector(args.bbox, mapWidth, mapHeight, mapX, mapY);
  const project = projector.project;

  // 1. Overpass.
  let osm: OverpassData = { nodes: new Map(), buildings: [], roads: [] };
  try {
    osm = await fetchOsm(args.bbox);
  } catch (err: any) {
    console.warn("[goad-plan] Overpass failed:", err?.message);
  }

  // 2. Project every building + road.
  const buildings: PolyBuilding[] = [];
  for (const w of osm.buildings) {
    const pts = wayToPoints(w, osm, project);
    if (pts.length < 3) continue;
    buildings.push({ pts, centroid: centroid(pts) });
  }
  const roads = osm.roads.map((w) => wayToPoints(w, osm, project)).filter((pts) => pts.length >= 2);

  // 3. Match every unit + the subject to a building.
  const unitToBuilding = new Map<MappedUnit, PolyBuilding>();
  for (const u of args.units) {
    const b = findBuildingForUnit(u, buildings, project);
    if (b) unitToBuilding.set(u, b);
  }
  const subjectBuilding = findBuildingForUnit(args.subject, buildings, project);

  // 4. Build the SVG.
  const svg = buildSvg({
    outWidth,
    outHeight,
    mapWidth,
    mapHeight,
    titleH,
    legendH,
    padding,
    projector,
    args,
    buildings,
    roads,
    unitToBuilding,
    subjectBuilding,
  });

  // 5. Rasterise.
  const pngBuffer = await sharp(Buffer.from(svg), { density: 150 })
    .resize(outWidth, outHeight, { fit: "contain", background: PLAN_COLORS.pageBg })
    .png({ quality: 95 })
    .toBuffer();

  return {
    pngBuffer,
    width: outWidth,
    height: outHeight,
    svg,
    buildingsCount: buildings.length,
    matchedUnits: unitToBuilding.size,
  };
}

interface BuildSvgArgs {
  outWidth: number;
  outHeight: number;
  mapWidth: number;
  mapHeight: number;
  titleH: number;
  legendH: number;
  padding: number;
  projector: Projector;
  args: RenderGoadPlanArgs;
  buildings: PolyBuilding[];
  roads: Pt[][];
  unitToBuilding: Map<MappedUnit, PolyBuilding>;
  subjectBuilding: PolyBuilding | null;
}

function buildSvg(a: BuildSvgArgs): string {
  const { outWidth, outHeight, mapWidth, mapHeight, titleH, padding, args } = a;
  const mapX = padding;
  const mapY = titleH + padding;

  // Scale bar — 50m.
  const midLatForScale = (args.bbox.south + args.bbox.north) / 2;
  const scaleDy = a.projector.project(midLatForScale, 0).y - a.projector.project(midLatForScale + (50 / 111_320), 0).y;
  const pxPer50m = Math.abs(scaleDy);

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${outWidth}" height="${outHeight}" viewBox="0 0 ${outWidth} ${outHeight}">`);
  parts.push(`<style>
    text { font-family: ${BASE_FONT}; }
    .title { fill: ${PLAN_COLORS.ink}; }
    .body { fill: ${PLAN_COLORS.ink}; }
    .muted { fill: ${PLAN_COLORS.inkMuted}; }
    .tenant { font-weight: 500; text-anchor: middle; dominant-baseline: central; }
    .use { font-style: italic; text-anchor: middle; dominant-baseline: central; }
  </style>`);

  // Page bg
  parts.push(`<rect x="0" y="0" width="${outWidth}" height="${outHeight}" fill="${PLAN_COLORS.pageBg}"/>`);

  // Title block
  parts.push(`<text class="title" x="${padding}" y="38" font-size="26" font-weight="400">BGP Retail Context Plan</text>`);
  parts.push(`<text class="body" x="${padding}" y="66" font-size="18">${esc(args.addressLine)}</text>`);
  if (args.postcodeLine) parts.push(`<text class="muted" x="${padding}" y="84" font-size="13">${esc(args.postcodeLine)}</text>`);
  parts.push(`<line x1="${padding}" y1="${titleH - 2}" x2="${outWidth - padding}" y2="${titleH - 2}" stroke="${PLAN_COLORS.inkMuted}" stroke-width="0.5" opacity="0.4"/>`);

  // Map pane — everything projected directly into screen coords, no transform
  // or clip-path (librsvg rasterises those unreliably).
  parts.push(`<rect x="${mapX}" y="${mapY}" width="${mapWidth}" height="${mapHeight}" fill="${PLAN_COLORS.pageBg}"/>`);

  // Roads — drawn under buildings
  for (const r of a.roads) {
    const d = r.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    parts.push(`<path d="${d}" fill="none" stroke="${PLAN_COLORS.roadStroke}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>`);
    parts.push(`<path d="${d}" fill="none" stroke="${PLAN_COLORS.roadFill}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  // Buildings — all neutral first
  const matchedBuildings = new Set<PolyBuilding>(a.unitToBuilding.values());
  if (a.subjectBuilding) matchedBuildings.add(a.subjectBuilding);
  for (const b of a.buildings) {
    if (matchedBuildings.has(b)) continue;
    const d = polyPath(b.pts);
    parts.push(`<path d="${d}" fill="${PLAN_COLORS.buildingBase}" stroke="${PLAN_COLORS.buildingStroke}" stroke-width="0.6"/>`);
  }

  // Coloured units
  for (const [unit, b] of a.unitToBuilding.entries()) {
    if (b === a.subjectBuilding) continue;
    const style = CATEGORY_STYLES[unit.category];
    const d = polyPath(b.pts);
    parts.push(`<path d="${d}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="0.8"/>`);
  }

  // Subject red-line last so it sits on top
  if (a.subjectBuilding) {
    const d = polyPath(a.subjectBuilding.pts);
    parts.push(`<path d="${d}" fill="${PLAN_COLORS.subjectFill}" stroke="${PLAN_COLORS.subjectLine}" stroke-width="2.6" stroke-linejoin="round"/>`);
  }

  // Tenant labels — rotated along long axis, use-class under tenant
  for (const [unit, b] of a.unitToBuilding.entries()) {
    if (!unit.tenantName && !unit.voaDescription) continue;
    const rect = minAreaRect(b.pts);
    // Skip if polygon is too small to hold any text
    if (rect.longSide < 22) continue;

    // How much text fits? Rough: ~5.5 px per char at 10px font
    const maxChars = Math.max(3, Math.floor(rect.longSide / 5.8));
    const tenantRaw = unit.tenantName || unit.voaDescription || "";
    const tenant = truncate(tenantRaw, maxChars);
    const style = CATEGORY_STYLES[unit.category];
    const useLabel = shortUseLabel(unit.category);

    const fontSize = rect.shortSide >= 28 ? 11 : rect.shortSide >= 18 ? 9 : 8;
    const degrees = (rect.angle * 180) / Math.PI;
    const cx = rect.cx, cy = rect.cy;

    parts.push(`<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${degrees.toFixed(1)})">`);
    if (rect.shortSide >= 20) {
      parts.push(`<text class="tenant" y="-${(fontSize * 0.55).toFixed(1)}" font-size="${fontSize}" fill="${style.textColor}">${esc(tenant)}</text>`);
      parts.push(`<text class="use" y="${(fontSize * 0.7).toFixed(1)}" font-size="${(fontSize * 0.78).toFixed(1)}" fill="${style.textColor}" opacity="0.82">${esc(useLabel)}</text>`);
    } else {
      parts.push(`<text class="tenant" font-size="${fontSize}" fill="${style.textColor}">${esc(tenant)}</text>`);
    }
    parts.push(`</g>`);
  }

  // Subject label
  if (a.subjectBuilding) {
    const rect = minAreaRect(a.subjectBuilding.pts);
    const degrees = (rect.angle * 180) / Math.PI;
    parts.push(`<g transform="translate(${rect.cx.toFixed(1)} ${rect.cy.toFixed(1)}) rotate(${degrees.toFixed(1)})">`);
    parts.push(`<text class="tenant" font-size="12" fill="${PLAN_COLORS.subjectLine}">SUBJECT</text>`);
    parts.push(`</g>`);
  }

  // Map border
  parts.push(`<rect x="${mapX}" y="${mapY}" width="${mapWidth}" height="${mapHeight}" fill="none" stroke="${PLAN_COLORS.inkMuted}" stroke-width="0.6" opacity="0.4"/>`);

  // Legend
  const legendY = outHeight - a.legendH;
  parts.push(`<line x1="${padding}" y1="${legendY}" x2="${outWidth - padding}" y2="${legendY}" stroke="${PLAN_COLORS.inkMuted}" stroke-width="0.5" opacity="0.4"/>`);

  const legendItems: { cat: RetailCategory | "subject"; label: string }[] = [
    { cat: "subject", label: "Subject (red-line)" },
    { cat: "fashion", label: CATEGORY_STYLES.fashion.label },
    { cat: "convenience", label: CATEGORY_STYLES.convenience.label },
    { cat: "fnb", label: CATEGORY_STYLES.fnb.label },
    { cat: "services", label: CATEGORY_STYLES.services.label },
    { cat: "beauty", label: CATEGORY_STYLES.beauty.label },
    { cat: "vacant", label: CATEGORY_STYLES.vacant.label },
  ];
  const swatchY = legendY + 30;
  let lx = padding;
  const legendFontSize = 12;
  for (const item of legendItems) {
    const fill = item.cat === "subject" ? "rgba(214, 40, 40, 0.12)" : CATEGORY_STYLES[item.cat].fill;
    const stroke = item.cat === "subject" ? PLAN_COLORS.subjectLine : CATEGORY_STYLES[item.cat].stroke;
    const sw = item.cat === "subject" ? 2 : 0.8;
    parts.push(`<rect x="${lx}" y="${swatchY}" width="20" height="14" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
    parts.push(`<text class="body" x="${lx + 26}" y="${swatchY + 11}" font-size="${legendFontSize}">${esc(item.label)}</text>`);
    lx += 26 + measureLabel(item.label, legendFontSize) + 18;
  }

  // Scale bar (50m)
  const scaleX = padding;
  const scaleY = legendY + 68;
  parts.push(`<line x1="${scaleX}" y1="${scaleY}" x2="${scaleX + pxPer50m}" y2="${scaleY}" stroke="${PLAN_COLORS.ink}" stroke-width="1.6"/>`);
  parts.push(`<line x1="${scaleX}" y1="${scaleY - 4}" x2="${scaleX}" y2="${scaleY + 4}" stroke="${PLAN_COLORS.ink}" stroke-width="1.6"/>`);
  parts.push(`<line x1="${scaleX + pxPer50m}" y1="${scaleY - 4}" x2="${scaleX + pxPer50m}" y2="${scaleY + 4}" stroke="${PLAN_COLORS.ink}" stroke-width="1.6"/>`);
  parts.push(`<text class="muted" x="${scaleX}" y="${scaleY + 18}" font-size="11">50 m</text>`);

  // North arrow
  const nx = outWidth - padding - 28;
  const ny = legendY + 52;
  parts.push(`<g transform="translate(${nx} ${ny})">`);
  parts.push(`<polygon points="0,-14 5,6 0,2 -5,6" fill="${PLAN_COLORS.ink}"/>`);
  parts.push(`<text class="muted" x="0" y="20" font-size="10" text-anchor="middle">N</text>`);
  parts.push(`</g>`);

  // Accent stripe (Claude orange) along bottom-right of title
  parts.push(`<rect x="${outWidth - padding - 60}" y="16" width="60" height="3" fill="${PLAN_COLORS.accent}"/>`);

  parts.push(`</svg>`);
  return parts.join("\n");
}

function polyPath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  const first = pts[0];
  let d = `M${first.x.toFixed(1)},${first.y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += ` L${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)}`;
  d += " Z";
  return d;
}

function measureLabel(s: string, fontSize: number): number {
  // Rough — resvg will get us close enough for swatch spacing.
  return s.length * fontSize * 0.58;
}
