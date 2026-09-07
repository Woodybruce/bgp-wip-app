import { interiorPoint, isValidPolygon, pointInPolygon, polygonArea } from "@shared/plan-geometry";

type Point = { x: number; y: number };
export type PlanRaster = { data: Buffer; width: number; height: number };
export type DetectedPlanUnit = { unitRef: string | null; tenant: string | null; seed: Point; polygon: Point[] | null };
export type TracedPlanUnit = { polygon: Point[]; dot: Point; pixels: number };

export function mapDetectedPlanUnits(value: unknown, frame: { x: number; y: number; width: number; height: number }): DetectedPlanUnit[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as any).units)) throw new Error("Detection returned no valid units array");
  const point = (p: any): Point | null => p && Number.isFinite(p.x) && Number.isFinite(p.y)
    && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
    ? { x: frame.x + p.x * frame.width, y: frame.y + p.y * frame.height } : null;
  const result: DetectedPlanUnit[] = [];
  for (const row of (value as any).units) {
    const polygon = Array.isArray(row?.polygon) ? row.polygon.map(point) : null;
    const validPolygon = polygon && polygon.every(Boolean) && isValidPolygon(polygon) ? polygon as Point[] : null;
    const seed = point(row?.seed) || (validPolygon ? interiorPoint(validPolygon) : null);
    if (!seed || (validPolygon && !pointInPolygon(seed, validPolygon))) continue;
    const unitRef = typeof row?.unitRef === "string" ? row.unitRef.trim().slice(0, 80) || null : null;
    const tenant = typeof row?.tenant === "string" ? row.tenant.trim().slice(0, 160) || null : null;
    if (unitRef || tenant) result.push({ unitRef, tenant, seed, polygon: validPolygon });
  }
  return result;
}

function simplifyClosed(points: Point[], tolerance: number): Point[] {
  if (points.length <= 4) return points;
  const distance = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  const reduce = (line: Point[]): Point[] => {
    if (line.length < 3) return line;
    let maximum = tolerance, index = -1;
    for (let i = 1; i < line.length - 1; i++) {
      const d = distance(line[i], line[0], line[line.length - 1]);
      if (d > maximum) { maximum = d; index = i; }
    }
    return index < 0 ? [line[0], line[line.length - 1]]
      : [...reduce(line.slice(0, index + 1)).slice(0, -1), ...reduce(line.slice(index))];
  };
  let split = 1;
  for (let i = 2; i < points.length; i++) {
    if (Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y)
      > Math.hypot(points[split].x - points[0].x, points[split].y - points[0].y)) split = i;
  }
  return [...reduce(points.slice(0, split + 1)).slice(0, -1), ...reduce([...points.slice(split), points[0]]).slice(0, -1)];
}

// Follow the one connected fill region containing an interior seed. Adjacent
// same-colour shops stay separate when a boundary is present. White/pale fills
// work too: colour saturation is never used as a proxy for a lettable unit.
// A region reaching the image edge or covering most of the page is rejected;
// the caller can ask the user to click a clearer interior or draw the outline.
export function tracePlanUnit(raster: PlanRaster, desired: Point, expected?: Point[] | null): TracedPlanUnit | null {
  const { data, width: W, height: H } = raster;
  if (!Number.isInteger(W) || !Number.isInteger(H) || W < 3 || H < 3 || data.length !== W * H * 3
    || !Number.isFinite(desired?.x) || !Number.isFinite(desired?.y) || desired.x < 0 || desired.x > 1 || desired.y < 0 || desired.y > 1) return null;
  const sx = Math.min(W - 1, Math.floor(desired.x * W)), sy = Math.min(H - 1, Math.floor(desired.y * H));
  const expectedBox = expected && isValidPolygon(expected) ? {
    x0: Math.min(...expected.map(p => p.x)), y0: Math.min(...expected.map(p => p.y)),
    x1: Math.max(...expected.map(p => p.x)), y1: Math.max(...expected.map(p => p.y)),
  } : null;
  // Bound memory/work for high-resolution PDFs, but leave ample margin for
  // imperfect AI vertices. Touching this window rejects an incomplete trace.
  const marginX = expectedBox ? Math.max(.015, (expectedBox.x1 - expectedBox.x0) * .5) : 0;
  const marginY = expectedBox ? Math.max(.015, (expectedBox.y1 - expectedBox.y0) * .5) : 0;
  const left = expectedBox ? Math.max(0, Math.floor((expectedBox.x0 - marginX) * W)) : 0;
  const top = expectedBox ? Math.max(0, Math.floor((expectedBox.y0 - marginY) * H)) : 0;
  const right = expectedBox ? Math.min(W, Math.ceil((expectedBox.x1 + marginX) * W)) : W;
  const bottom = expectedBox ? Math.min(H, Math.ceil((expectedBox.y1 + marginY) * H)) : H;
  if (sx < left || sx >= right || sy < top || sy >= bottom) return null;
  const rw = right - left, rh = bottom - top;
  const radius = expectedBox ? Math.max(1, Math.min(5, Math.floor(Math.min((expectedBox.x1 - expectedBox.x0) * W, (expectedBox.y1 - expectedBox.y0) * H) / 6))) : 4;
  const buckets = new Map<string, { r: number; g: number; b: number; x: number; y: number }[]>();
  for (let y = Math.max(top, sy - radius); y <= Math.min(bottom - 1, sy + radius); y++) {
    for (let x = Math.max(left, sx - radius); x <= Math.min(right - 1, sx + radius); x++) {
      if (expected && !pointInPolygon({ x: (x + .5) / W, y: (y + .5) / H }, expected)) continue;
      const i = (y * W + x) * 3, r = data[i], g = data[i + 1], b = data[i + 2];
      if (Math.max(r, g, b) < 50) continue;
      const key = `${Math.round(r / 24)}:${Math.round(g / 24)}:${Math.round(b / 24)}`;
      const group = buckets.get(key) || [];
      group.push({ r, g, b, x, y }); buckets.set(key, group);
    }
  }
  const dominant = [...buckets.values()].sort((a, b) => b.length - a.length)[0];
  if (!dominant?.length) return null;
  const median = (channel: "r" | "g" | "b") => dominant.map(p => p[channel]).sort((a, b) => a - b)[Math.floor(dominant.length / 2)];
  const colour = [median("r"), median("g"), median("b")];
  const seed = dominant.sort((a, b) => Math.hypot(a.x - sx, a.y - sy) - Math.hypot(b.x - sx, b.y - sy))[0];
  // Neutral dark fills sit close to grey wall/leader lines in scanned plans.
  // The broader tolerance needed for coloured JPEG fills can join such a
  // unit to long neighbouring walls (live Brent Cross D3). Keep those lines
  // outside the fill region instead of trimming a guessed rectangular box.
  const tolerance = Math.max(...colour) < 150 && Math.max(...colour) - Math.min(...colour) < 30 ? 12 : 24;
  const matches = (x: number, y: number) => {
    const i = (y * W + x) * 3;
    return Math.max(Math.abs(data[i] - colour[0]), Math.abs(data[i + 1] - colour[1]), Math.abs(data[i + 2] - colour[2])) <= tolerance;
  };
  const mask = new Uint8Array(rw * rh);
  const queue = new Int32Array(rw * rh);
  let count = 1, cursor = 0, touchesEdge = false;
  const first = (seed.y - top) * rw + seed.x - left;
  mask[first] = 2; queue[0] = first;
  const maximum = Math.floor(W * H * .45);
  while (cursor < count) {
    const pos = queue[cursor++], x = pos % rw, y = Math.floor(pos / rw);
    if (x === 0 || y === 0 || x === rw - 1 || y === rh - 1) touchesEdge = true;
    const neighbours = [x > 0 ? pos - 1 : -1, x + 1 < rw ? pos + 1 : -1, y > 0 ? pos - rw : -1, y + 1 < rh ? pos + rw : -1];
    for (const next of neighbours) {
      if (next < 0 || mask[next]) continue;
      mask[next] = 1;
      const nx = next % rw + left, ny = Math.floor(next / rw) + top;
      if (!matches(nx, ny)) continue;
      mask[next] = 2; queue[count++] = next;
      if (count > maximum) return null;
    }
  }
  if (touchesEdge || count < Math.max(16, Math.round(W * H * .000002))) return null;
  // Edges of the pixel union form closed rings. The largest positive ring
  // is the outer demise; label/text holes are intentionally excluded.
  const edges = new Map<number, number[]>();
  const vertexWidth = rw + 1;
  const edge = (from: number, to: number) => { const list = edges.get(from) || []; list.push(to); edges.set(from, list); };
  for (let n = 0; n < count; n++) {
    const pos = queue[n], x = pos % rw, y = Math.floor(pos / rw), v = y * vertexWidth + x;
    if (y === 0 || mask[pos - rw] !== 2) edge(v, v + 1);
    if (x === rw - 1 || mask[pos + 1] !== 2) edge(v + 1, v + vertexWidth + 1);
    if (y === rh - 1 || mask[pos + rw] !== 2) edge(v + vertexWidth + 1, v + vertexWidth);
    if (x === 0 || mask[pos - 1] !== 2) edge(v + vertexWidth, v);
  }
  let outer: Point[] | null = null, largest = 0;
  const considerRing = (ring: Point[]) => {
    if (ring.length < 4) return;
    const area = Math.abs(ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p.x * q.y - q.x * p.y; }, 0) / 2);
    if (area > largest) { largest = area; outer = ring; }
  };
  while (edges.size) {
    const start = edges.keys().next().value as number;
    const ring: Point[] = [];
    let current = start;
    do {
      ring.push({ x: current % vertexWidth + left, y: Math.floor(current / vertexWidth) + top });
      const destinations = edges.get(current);
      if (!destinations?.length) { ring.length = 0; break; }
      const next = destinations.pop()!;
      if (!destinations.length) edges.delete(current);
      current = next;
      if (ring.length > 100000) return null;
    } while (current !== start);
    if (ring.length < 4) continue;
    // JPEG text can meet the outside at a single diagonal pixel. Split
    // touching loops at repeated vertices so a text hole cannot introduce
    // a self-intersection into the exterior wall polygon.
    const path: Point[] = [], positions = new Map<number, number>();
    for (const point of [...ring, ring[0]]) {
      const key = point.y * (W + 1) + point.x, previous = positions.get(key);
      if (previous !== undefined) {
        considerRing(path.slice(previous));
        for (let n = previous + 1; n < path.length; n++) positions.delete(path[n].y * (W + 1) + path[n].x);
        path.length = previous + 1;
      } else { positions.set(key, path.length); path.push(point); }
    }
  }
  // A mall/page background can surround many different unit fills. Do not
  // mistake its outer page-sized ring for one demise. Text holes are small.
  const boundary = outer as Point[] | null;
  if (!boundary || largest > count * 1.35) return null;
  // Collapse collinear grid edges before simplification to retain corners.
  const corners = boundary.filter((p, i) => {
    const a = boundary[(i + boundary.length - 1) % boundary.length], b = boundary[(i + 1) % boundary.length];
    return (p.x - a.x) * (b.y - p.y) !== (p.y - a.y) * (b.x - p.x);
  });
  let polygon = simplifyClosed(corners, 1.25).map(p => ({ x: p.x / W, y: p.y / H }));
  if (!isValidPolygon(polygon) || Math.abs(polygonArea(polygon) * W * H - largest) / largest > .08) {
    polygon = corners.map(p => ({ x: p.x / W, y: p.y / H }));
  }
  if (!isValidPolygon(polygon) || polygon.length > 400) return null;
  const candidateArea = expected && isValidPolygon(expected) ? polygonArea(expected) : null;
  const area = polygonArea(polygon);
  if (candidateArea && (area < candidateArea * .2 || area > candidateArea * 2.5)) return null;
  const dot = interiorPoint(polygon);
  if (!dot || !pointInPolygon(dot, polygon)) return null;
  return { polygon, dot, pixels: count };
}
