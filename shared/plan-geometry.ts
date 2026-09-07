export type PlanPoint = { x: number; y: number };

export function pointInPolygon(point: PlanPoint, polygon: PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonArea(polygon: PlanPoint[]): number {
  return Math.abs(polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0)) / 2;
}

const cross = (a: PlanPoint, b: PlanPoint, c: PlanPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function isValidPolygon(value: unknown): value is PlanPoint[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 256
    || value.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return false;
  if (polygonArea(value) < 1e-8) return false;
  for (let i = 0; i < value.length; i++) {
    const a = value[i], b = value[(i + 1) % value.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) return false;
    for (let j = i + 2; j < value.length; j++) {
      if (i === 0 && j === value.length - 1) continue;
      const c = value[j], d = value[(j + 1) % value.length];
      if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0
        && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
        && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))) return false;
    }
  }
  return true;
}

export function boundaryDistance(point: PlanPoint, polygon: PlanPoint[]): number {
  let distance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    distance = Math.min(distance, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return pointInPolygon(point, polygon) ? distance : -distance;
}

// Search cells by their upper bound on clearance, including concave units.
// Unlike a vertex average or box centre, the returned point is in the demise.
export function interiorPoint(polygon: PlanPoint[]): PlanPoint {
  const minX = Math.min(...polygon.map(p => p.x)), maxX = Math.max(...polygon.map(p => p.x));
  const minY = Math.min(...polygon.map(p => p.y)), maxY = Math.max(...polygon.map(p => p.y));
  const make = (x: number, y: number, h: number) => {
    const d = boundaryDistance({ x, y }, polygon);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };
  const size = Math.min(maxX - minX, maxY - minY);
  if (!(size > 0)) return polygon[0] || { x: 0.5, y: 0.5 };
  const queue: ReturnType<typeof make>[] = [];
  for (let x = minX; x < maxX; x += size) for (let y = minY; y < maxY; y += size) queue.push(make(x + size / 2, y + size / 2, size / 2));
  let best = make((minX + maxX) / 2, (minY + maxY) / 2, 0);
  const precision = Math.max(size / 256, 1e-7);
  for (let count = 0; queue.length && count < 10000; count++) {
    queue.sort((a, b) => a.max - b.max);
    const cell: ReturnType<typeof make> = queue.pop()!;
    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= precision) continue;
    const h = cell.h / 2;
    for (const dx of [-h, h]) for (const dy of [-h, h]) queue.push(make(cell.x + dx, cell.y + dy, h));
  }
  return { x: best.x, y: best.y };
}

// Radius is measured in image-width units so a circle stays circular on
// portrait and landscape plans. Keep a saved anchor when it is valid;
// shrinking a disc must never silently move it into a neighbouring shop.
export function containedMarker(polygon: PlanPoint[], desired: PlanPoint | null | undefined, radius: number, aspect = 1): PlanPoint & { radius: number } {
  const scaled = polygon.map(p => ({ x: p.x, y: p.y * aspect }));
  let p = desired && Number.isFinite(desired.x) && Number.isFinite(desired.y) ? { x: desired.x, y: desired.y * aspect } : null;
  if (!p || boundaryDistance(p, scaled) <= 1e-7) p = interiorPoint(scaled);
  return { x: p.x, y: p.y / aspect, radius: Math.max(0, Math.min(radius, boundaryDistance(p, scaled) * 0.94)) };
}

export function moveMarkerInside(polygon: PlanPoint[], desired: PlanPoint, radius: number, aspect = 1): PlanPoint {
  const scaled = polygon.map(p => ({ x: p.x, y: p.y * aspect }));
  const target = { x: desired.x, y: desired.y * aspect };
  const pole = interiorPoint(scaled);
  const margin = Math.min(radius, boundaryDistance(pole, scaled) * 0.8);
  if (boundaryDistance(target, scaled) >= margin) return desired;
  let best = pole, bestDistance = Math.hypot(pole.x - target.x, pole.y - target.y);
  // Project onto each edge and try both inward normals; concave corners
  // can reject a projection, in which case the interior candidate remains.
  for (let i = 0; i < scaled.length; i++) {
    const a = scaled[i], b = scaled[(i + 1) % scaled.length];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (!len) continue;
    const t = Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / (len * len)));
    for (const direction of [-1, 1]) {
      const p = { x: a.x + dx * t - dy / len * margin * 1.01 * direction, y: a.y + dy * t + dx / len * margin * 1.01 * direction };
      const distance = Math.hypot(p.x - target.x, p.y - target.y);
      if (distance < bestDistance && boundaryDistance(p, scaled) >= margin * 0.99) { best = p; bestDistance = distance; }
    }
  }
  return { x: best.x, y: best.y / aspect };
}
