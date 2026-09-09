import { boundaryDistance, interiorPoint, isValidPolygon, pointInPolygon, polygonArea } from "@shared/plan-geometry";

type Point = { x: number; y: number };
export type PlanRaster = { data: Buffer; width: number; height: number };
export type DetectedPlanUnit = { unitRef: string | null; tenant: string | null; seed: Point; polygon: Point[] | null; regionId?: number; reviewRequired?: boolean };
export type PlanUnitRegion = TracedPlanUnit & { id: number };
export type TracedPlanUnit = { polygon: Point[]; dot: Point; pixels: number };

export function mapDetectedPlanUnits(value: unknown, frame: { x: number; y: number; width: number; height: number }, regions: PlanUnitRegion[] = []): DetectedPlanUnit[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as any).units)) throw new Error("Detection returned no valid units array");
  const point = (p: any): Point | null => p && Number.isFinite(p.x) && Number.isFinite(p.y)
    && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
    ? { x: frame.x + p.x * frame.width, y: frame.y + p.y * frame.height } : null;
  const result: DetectedPlanUnit[] = [];
  for (const row of (value as any).units) {
    const region = Number.isInteger(row?.regionId) ? regions.find(item => item.id === row.regionId) : null;
    const polygon = Array.isArray(row?.polygon) ? row.polygon.map(point) : null;
    const validPolygon = polygon && polygon.every(Boolean) && isValidPolygon(polygon) ? polygon as Point[] : null;
    const seed = region?.dot || point(row?.seed) || (validPolygon ? interiorPoint(validPolygon) : null);
    if (!seed || (!region && validPolygon && !pointInPolygon(seed, validPolygon))) continue;
    const sourceLabel = (value: unknown, limit: number) => {
      if (typeof value !== "string") return null;
      const label = value.trim().slice(0, limit);
      return /^@\s*\d+$/.test(label) ? null : label || null;
    };
    const unitRef = sourceLabel(row?.unitRef, 80);
    const tenant = sourceLabel(row?.tenant, 160);
    if (unitRef || tenant || region) result.push({ unitRef, tenant, seed, polygon: region?.polygon || validPolygon, ...(region ? { regionId: region.id } : {}), ...(row?.reviewRequired === true ? { reviewRequired: true } : {}) });
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
export function tracePlanUnit(raster: PlanRaster, desired: Point, expected?: Point[] | null, colourTolerance: 24 | 32 = 24): TracedPlanUnit | null {
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
  const marginX = expectedBox ? Math.max(.02, (expectedBox.x1 - expectedBox.x0) * .5) : 0;
  const marginY = expectedBox ? Math.max(.02, (expectedBox.y1 - expectedBox.y0) * .5) : 0;
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
  const tolerance = Math.max(...colour) < 150 && Math.max(...colour) - Math.min(...colour) < 30 ? 12 : colourTolerance;
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
  // Lettering can split a coloured floor into disconnected pieces. Recover
  // those pieces only inside an independently closed dark wall: white ink is
  // traversable, but even a one-pixel shared wall remains a barrier.
  const colourRange = Math.max(...colour) - Math.min(...colour);
  const brightness = colour.reduce((sum, value) => sum + value, 0) / 3;
  const isInk = (pos: number) => {
    const x = pos % rw + left, y = Math.floor(pos / rw) + top, i = (y * W + x) * 3;
    const values = [data[i], data[i + 1], data[i + 2]];
    const mean = (values[0] + values[1] + values[2]) / 3;
    return mean < brightness - 40
      || (Math.max(...values) - Math.min(...values) < colourRange * .5 && mean < brightness + 10);
  };
  const isLightInkOrFloor = (pos: number) => {
    const x = pos % rw + left, y = Math.floor(pos / rw) + top, i = (y * W + x) * 3;
    const mean = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const mix = Math.max(0, Math.min(1, (mean - brightness) / (255 - brightness)));
    return colour.every((value, channel) => Math.abs(data[i + channel] - (value + (255 - value) * mix)) <= colourTolerance);
  };
  if (colourRange > 30) {
    const enclosed = new Uint8Array(mask.length), walk = new Int32Array(mask.length);
    const originalCount = count, maximumRepair = Math.min(maximum, Math.max(count * 4, 400));
    let length = 1, next = 0, bounded = true, matching = 0;
    enclosed[first] = 1; walk[0] = first;
    while (next < length && bounded) {
      const pos = walk[next++], x = pos % rw, y = Math.floor(pos / rw);
      if (x === 0 || y === 0 || x === rw - 1 || y === rh - 1) { bounded = false; break; }
      if (matches(x + left, y + top)) matching++;
      for (const neighbour of [pos - 1, pos + 1, pos - rw, pos + rw]) {
        if (enclosed[neighbour] || isInk(neighbour) || !isLightInkOrFloor(neighbour)) continue;
        enclosed[neighbour] = 1; walk[length++] = neighbour;
        if (length > maximumRepair) { bounded = false; break; }
      }
    }
    // A closed mall, mixed-colour room or broad background is not evidence
    // of a unit. Demand dominant original floor colour and preservation of
    // every original floor pixel before using the wall-constrained region.
    const withinWallFringe = (pos: number) => enclosed[pos]
      || [-rw - 1, -rw, -rw + 1, -1, 1, rw - 1, rw, rw + 1].some(offset => enclosed[pos + offset]);
    if (bounded && matching >= length * .55 && length > count
      && (length < W * H * .0005 || length <= originalCount * 1.5)
      && queue.subarray(0, count).every(withinWallFringe)) {
      // JPEG antialiasing can put a floor-edge pixel just inside the dark
      // threshold. Keep that original one-pixel fringe rather than shrink it.
      for (let n = 0; n < count; n++) if (!enclosed[queue[n]]) { enclosed[queue[n]] = 1; walk[length++] = queue[n]; }
      mask.fill(0); count = length;
      for (let n = 0; n < length; n++) { const pos = walk[n]; mask[pos] = 2; queue[n] = pos; }
    }
  }
  // Close only narrow breaks in this single small coloured component. A JPEG
  // gap can connect a printed logo to the mall, turning the logo into a false
  // concave edge. Retain a repair only when it encloses a substantial hole.
  let repairedLabelGap = false;
  let smallColoured = Math.max(...colour) - Math.min(...colour) > 30 && count < W * H * .005;
  if (smallColoured) {
    let minX = rw, minY = rh, maxX = 0, maxY = 0;
    for (let n = 0; n < count; n++) {
      const x = queue[n] % rw, y = Math.floor(queue[n] / rw);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    smallColoured = bw * bh < W * H * .005;
    if (smallColoured) {
      const sw = bw + 4, sh = bh + 4, source = new Uint8Array(sw * sh);
      for (let n = 0; n < count; n++) source[(Math.floor(queue[n] / rw) - minY + 2) * sw + queue[n] % rw - minX + 2] = 1;
      const exterior = (fill: Uint8Array) => {
        const outside = new Uint8Array(fill.length), walk = new Int32Array(fill.length);
        let length = 1; walk[0] = 0; outside[0] = 1;
        for (let n = 0; n < length; n++) {
          const pos = walk[n], x = pos % sw, y = Math.floor(pos / sw);
          for (const next of [x ? pos - 1 : -1, x + 1 < sw ? pos + 1 : -1, y ? pos - sw : -1, y + 1 < sh ? pos + sw : -1]) {
            if (next < 0 || outside[next] || fill[next]) continue;
            outside[next] = 1; walk[length++] = next;
          }
        }
        return outside;
      };
      const before = exterior(source);
      for (const radius of [1, 2]) {
        const dilated = new Uint8Array(source.length), closed = source.slice();
        for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
          if (!source[y * sw + x]) continue;
          for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
            if (x + dx >= 0 && x + dx < sw && y + dy >= 0 && y + dy < sh) dilated[(y + dy) * sw + x + dx] = 1;
          }
        }
        let added = 0;
        for (let y = 2; y < sh - 2; y++) for (let x = 2; x < sw - 2; x++) {
          if (source[y * sw + x]) continue;
          let contained = true;
          for (let dy = -radius; dy <= radius && contained; dy++) for (let dx = -radius; dx <= radius; dx++) {
            if (!dilated[(y + dy) * sw + x + dx]) { contained = false; break; }
          }
          if (contained) {
            closed[y * sw + x] = 1; added++;
          }
        }
        if (!added) continue;
        const after = exterior(closed);
        let enclosed = 0;
        for (let n = 0; n < source.length; n++) if (before[n] && !after[n] && !closed[n]) enclosed++;
        const closesLabel = enclosed >= Math.max(16, added * 4, bw * bh * .03);
        // Approve each separate thin cut only when every pixel is dark ink.
        // Unrelated JPEG fringe elsewhere must not prevent repairing a
        // leader, and a pale mall recess must not be filled along with it.
        if (!closesLabel) {
          const visited = new Uint8Array(source.length), gaps = new Int32Array(source.length);
          for (let start = 0; start < source.length; start++) {
            if (visited[start] || source[start] || !closed[start]) continue;
            let length = 1, inkOnly = true; gaps[0] = start; visited[start] = 1;
            for (let n = 0; n < length; n++) {
              const pos = gaps[n], x = pos % sw, y = Math.floor(pos / sw);
              if (!isInk((minY + y - 2) * rw + minX + x - 2)) inkOnly = false;
              for (const next of [pos - 1, pos + 1, pos - sw, pos + sw]) {
                if (next < 0 || next >= source.length || visited[next] || source[next] || !closed[next]) continue;
                visited[next] = 1; gaps[length++] = next;
              }
            }
            if (!inkOnly) for (let n = 0; n < length; n++) { closed[gaps[n]] = 0; added--; }
          }
        }
        if (!added || added > count * .05) continue;
        for (let y = 2; y < sh - 2; y++) for (let x = 2; x < sw - 2; x++) {
          const n = y * sw + x;
          if (!closed[n] || source[n]) continue;
          const pos = (minY + y - 2) * rw + minX + x - 2;
          mask[pos] = 2; queue[count++] = pos;
        }
        repairedLabelGap = closesLabel;
        break;
      }
    }
  }

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
  // Reject sparse mall/page backgrounds. A bounded small coloured unit may
  // contain a large printed logo; allow more empty area only when a narrow
  // gap was closed around that logo, without adding any neighbouring fill.
  const boundary = outer as Point[] | null;
  if (!boundary || largest > count * (repairedLabelGap ? 2.5 : smallColoured ? 1.8 : 1.35)) return null;
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


// Inventory actual enclosed fills before asking the model to identify shops.
// These are geometric candidates, never automatically accepted as tenancies:
// the vision pass must distinguish demises from rooms, roads and title panels.
export function findPlanUnitRegions(raster: PlanRaster, limit = 400): PlanUnitRegion[] {
  const { data, width: W, height: H } = raster;
  if (W < 3 || H < 3 || data.length !== W * H * 3) return [];
  const seen = new Uint8Array(W * H), queue = new Int32Array(W * H);
  const minimum = Math.max(24, Math.round(W * H * .000015));
  const components: { seed: Point; box: Point[]; pixels: number; smallTexturedFill: boolean }[] = [];
  const eligible = (i: number) => {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const low = Math.min(r, g, b), high = Math.max(r, g, b);
    return low > 205 || (high - low > 30 && high > 80 && low > 40)
      || (high < 150 && low > 65 && high - low < 20);
  };
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || !eligible(start)) continue;
    const colour = [data[start * 3], data[start * 3 + 1], data[start * 3 + 2]];
    const tolerance = Math.max(...colour) < 150 && Math.max(...colour) - Math.min(...colour) < 30 ? 12 : 24;
    let count = 1, cursor = 0, x0 = start % W, x1 = x0, y0 = Math.floor(start / W), y1 = y0, sumX = 0, sumY = 0;
    seen[start] = 1; queue[0] = start;
    while (cursor < count) {
      const pos = queue[cursor++], x = pos % W, y = Math.floor(pos / W);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); sumX += x; sumY += y;
      const neighbours = [x ? pos - 1 : -1, x + 1 < W ? pos + 1 : -1, y ? pos - W : -1, y + 1 < H ? pos + W : -1];
      for (const next of neighbours) {
        if (next < 0 || seen[next] || !eligible(next)) continue;
        const i = next * 3;
        if (Math.max(Math.abs(data[i] - colour[0]), Math.abs(data[i + 1] - colour[1]), Math.abs(data[i + 2] - colour[2])) > tolerance) continue;
        seen[next] = 1; queue[count++] = next;
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const tinyColoured = Math.max(...colour) - Math.min(...colour) > 30
      && count >= Math.max(24, Math.round(W * H * .00001)) && Math.min(bw, bh) >= Math.max(4, Math.min(W, H) * .003)
      && bw * bh <= W * H * .0005 && Math.max(bw / bh, bh / bw) <= 5 && count / (bw * bh) >= .4;
    if ((!tinyColoured && (count < minimum || Math.min(bw, bh) < Math.max(4, Math.min(W, H) * .004))) || count > W * H * .42 || x0 === 0 || y0 === 0 || x1 === W - 1 || y1 === H - 1
      || Math.max(bw / bh, bh / bw) > 25 || count / (bw * bh) < .2) continue;
    const cx = sumX / count, cy = sumY / count;
    let best = start, score = Infinity, smallTexturedFill = false;
    // Tiny coloured kiosks can have lettering across most of their floor.
    // Retry only these failed seeds with a 3×3 patch and slightly more JPEG
    // tolerance; keep the normal seed and contour for every existing region.
    for (const retry of [false, true]) {
      if (retry && (Number.isFinite(score) || Math.max(...colour) - Math.min(...colour) <= 30
        || bw * bh > W * H * .0005 || Math.max(bw / bh, bh / bw) > 3 || count / (bw * bh) < .4)) break;
      if (retry) smallTexturedFill = true;
      for (let n = 0; n < count; n++) {
        const pos = queue[n], x = pos % W, y = Math.floor(pos / W);
        // Pick real floor pixels near the centre, clear of text and wall edges.
        if (x <= x0 || x >= x1 || y <= y0 || y >= y1) continue;
        const clearance = retry ? 1 : Math.max(1, Math.min(5, Math.floor(Math.min(bw, bh) / 6)));
        if (x < x0 + clearance || x > x1 - clearance || y < y0 + clearance || y > y1 - clearance) continue;
        const clear = [-clearance, 0, clearance].every(dy => [-clearance, 0, clearance].every(dx => {
          const next = pos + dy * W + dx;
          const i = next * 3;
          return Math.max(Math.abs(data[i] - colour[0]), Math.abs(data[i + 1] - colour[1]), Math.abs(data[i + 2] - colour[2])) <= tolerance;
        }));
        if (!clear) continue;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < score) { score = d; best = pos; }
      }
    }
    if (!Number.isFinite(score)) continue;
    components.push({ seed: { x: (best % W + .5) / W, y: (Math.floor(best / W) + .5) / H }, pixels: count, smallTexturedFill,
      box: [{ x: x0 / W, y: y0 / H }, { x: (x1 + 1) / W, y: y0 / H }, { x: (x1 + 1) / W, y: (y1 + 1) / H }, { x: x0 / W, y: (y1 + 1) / H }] });
  }
  const regions: PlanUnitRegion[] = [];
  for (const component of components.sort((a, b) => b.pixels - a.pixels).slice(0, Math.max(1, limit) * 2)) {
    const traced = tracePlanUnit(raster, component.seed, component.box, component.smallTexturedFill ? 32 : 24);
    if (!traced || regions.some(row => pointInPolygon(traced.dot, row.polygon) && pointInPolygon(row.dot, traced.polygon))) continue;
    regions.push({ ...traced, id: 0 });
    if (regions.length >= limit) break;
  }
  return regions.filter(region => !regions.some(other => other !== region
    && polygonArea(other.polygon) > polygonArea(region.polygon) * 1.25
    && pointInPolygon(region.dot, other.polygon)
    && region.polygon.every(point => boundaryDistance(point, other.polygon) >= -1 / Math.min(W, H))))
    .sort((a, b) => a.dot.y - b.dot.y || a.dot.x - b.dot.x).map((region, index) => ({ ...region, id: index + 1 }));
}

// Rescue a seed placed on lettering only when the supplied visible outline
// supports exactly one enclosed region. Never snap an uncertain seed sideways
// into a neighbouring shop merely because it is nearby.
export function traceDetectedPlanUnit(raster: PlanRaster, candidate: DetectedPlanUnit, regions: PlanUnitRegion[]): TracedPlanUnit | null {
  const region = candidate.regionId ? regions.find(item => item.id === candidate.regionId) : null;
  if (region) return region;
  const traced = tracePlanUnit(raster, candidate.seed, candidate.polygon);
  if (traced) return traced;
  const expected = candidate.polygon;
  if (!expected || !isValidPolygon(expected)) return null;
  const area = polygonArea(expected);
  const matches = regions.filter(item => {
    const ratio = polygonArea(item.polygon) / area;
    return ratio >= .45 && ratio <= 1.8 && pointInPolygon(item.dot, expected)
      && item.polygon.filter(point => pointInPolygon(point, expected)).length >= item.polygon.length * .5;
  });
  return matches.length === 1 ? matches[0] : null;
}


export function planPolygonsOverlap(a: Point[], b: Point[]): boolean {
  if (!isValidPolygon(a) || !isValidPolygon(b)) return false;
  const epsilon = 1e-10;
  const box = (polygon: Point[]) => ({ x0: Math.min(...polygon.map(p => p.x)), x1: Math.max(...polygon.map(p => p.x)),
    y0: Math.min(...polygon.map(p => p.y)), y1: Math.max(...polygon.map(p => p.y)) });
  const aa = box(a), bb = box(b);
  if (Math.min(aa.x1, bb.x1) - Math.max(aa.x0, bb.x0) <= epsilon
    || Math.min(aa.y1, bb.y1) - Math.max(aa.y0, bb.y0) <= epsilon) return false;
  if (a.some(point => boundaryDistance(point, b) > epsilon) || b.some(point => boundaryDistance(point, a) > epsilon)) return true;
  const side = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const p = a[i], q = a[(i + 1) % a.length], r = b[j], t = b[(j + 1) % b.length];
    const s1 = side(p, q, r), s2 = side(p, q, t), s3 = side(r, t, p), s4 = side(r, t, q);
    // Proper crossings overlap interiors; touching or shared wall edges do not.
    if (((s1 > epsilon && s2 < -epsilon) || (s1 < -epsilon && s2 > epsilon))
      && ((s3 > epsilon && s4 < -epsilon) || (s3 < -epsilon && s4 > epsilon))) return true;
  }
  // Identical outlines or a polygon contained along shared wall edges can
  // have no strictly interior vertex and no proper edge crossing.
  return boundaryDistance(interiorPoint(a)!, b) > epsilon || boundaryDistance(interiorPoint(b)!, a) > epsilon;
}
