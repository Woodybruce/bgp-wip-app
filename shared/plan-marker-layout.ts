import { boundaryDistance, isValidPolygon, type PlanPoint } from './plan-geometry';

export type PlanMarkerMode = 'compact' | 'circles' | 'dots';
export type PlanMarkerInput = {
  id: string;
  label: string;
  price: string | null;
  hasEvidence: boolean;
  polygon: PlanPoint[];
  anchor: PlanPoint;
};
export type PlanMarkerLayout = PlanPoint & {
  kind: 'compact' | 'circle' | 'dot' | 'number';
  width: number;
  height: number;
  showPrice: boolean;
  displayLabel: string;
};
export type PlanMarkerLayoutOptions = {
  mode: PlanMarkerMode;
  /** Full source-image width after zoom, in screen pixels. */
  screenWidth: number;
  /** Source-image height divided by source-image width. */
  aspect: number;
  selectedId?: string | null;
  showPrices: boolean;
  numberOnly?: boolean;
};

export function parsePlanMarkerMode(value: unknown): PlanMarkerMode {
  return value === 'circles' || value === 'dots' ? value : 'compact';
}

const EPSILON = 1e-7;
const MAX_WIDTH = 120;
const COMPACT_PADDING = 24;
const DOT_SIZE = 8;

// Conservative screen-pixel bounds for 12px Arial, including semibold labels.
// Keeping measurement pure makes saved-plan rendering independent of font load.
function labelWidth(text: string): number {
  return Array.from(text).reduce((width, char) => width + (
    /[MW@%]/.test(char) ? 12 : /[mw]/.test(char) ? 11 : /[ilI.,:;'!|\s]/.test(char) ? 4
      : /[0-9]/.test(char) ? 7.5 : /[A-Z]/.test(char) ? 10
        : /[a-z()\-/]/.test(char) ? 8 : char === '…' ? 12 : 16
  ), 0);
}

function truncateLabel(label: string, available: number): string {
  const text = String(label || '?').replace(/\s+/g, ' ').trim() || '?';
  if (labelWidth(text) <= available) return text;
  let result = '';
  for (const char of Array.from(text)) {
    if (labelWidth(result + char + '…') > available) break;
    result += char;
  }
  return result + '…';
}

// Prices are rendered at 11px in the app's monospace font. Long prices remain
// available in the details panel instead of spilling across another demise.
function priceWidth(price: string): number {
  return Array.from(price).reduce((width, char) => width + (/^[\x20-\x7e£€]$/.test(char) ? 7 : 12), 0);
}

function preferredShape(input: PlanMarkerInput, options: PlanMarkerLayoutOptions): Omit<PlanMarkerLayout, 'x' | 'y'> {
  if (options.numberOnly) {
    const displayLabel = truncateLabel(input.label, MAX_WIDTH - 12);
    return { kind: 'number', width: Math.max(24, Math.ceil(labelWidth(displayLabel) + 12)), height: 24, showPrice: false, displayLabel };
  }
  if (options.mode === 'dots' && input.id !== options.selectedId) {
    return { kind: 'dot', width: DOT_SIZE, height: DOT_SIZE, showPrice: false, displayLabel: '' };
  }
  let showPrice = Boolean(options.showPrices && input.price?.trim());
  if (options.mode === 'circles') {
    // The price row is centred 9px below the anchor; its lower edge is 16px
    // down. Bound text by that chord, not by the circle's full diameter.
    const textAllowance = (withPrice: boolean) => 2 * Math.sqrt(40 ** 2 - (withPrice ? 16 : 8) ** 2) - 12;
    if (showPrice && priceWidth(input.price!) > textAllowance(true)) showPrice = false;
    const displayLabel = truncateLabel(input.label, textAllowance(showPrice));
    const contentWidth = Math.max(labelWidth(displayLabel), showPrice ? priceWidth(input.price!) : 0);
    const diameter = Math.min(80, Math.max(48, Math.ceil(2 * Math.hypot((contentWidth + 12) / 2, showPrice ? 16 : 8))));
    return { kind: 'circle', width: diameter, height: diameter, showPrice, displayLabel };
  }
  if (showPrice && priceWidth(input.price!) > MAX_WIDTH - COMPACT_PADDING) showPrice = false;
  const displayLabel = truncateLabel(input.label, MAX_WIDTH - COMPACT_PADDING);
  const contentWidth = Math.max(labelWidth(displayLabel), showPrice ? priceWidth(input.price!) : 0);
  return { kind: 'compact', width: Math.max(36, Math.ceil(contentWidth + COMPACT_PADDING)), height: showPrice ? 42 : 26, showPrice, displayLabel };
}

const cross = (a: PlanPoint, b: PlanPoint) => a.x * b.y - a.y * b.x;
const subtract = (a: PlanPoint, b: PlanPoint): PlanPoint => ({ x: a.x - b.x, y: a.y - b.y });

function segmentInside(a: PlanPoint, b: PlanPoint, polygon: PlanPoint[]): boolean {
  const direction = subtract(b, a), lengthSquared = direction.x ** 2 + direction.y ** 2;
  const cuts = [0, 1];
  for (let i = 0; i < polygon.length; i++) {
    const c = polygon[i], d = polygon[(i + 1) % polygon.length];
    const edge = subtract(d, c), offset = subtract(c, a), denominator = cross(direction, edge);
    if (Math.abs(denominator) > EPSILON) {
      const t = cross(offset, edge) / denominator, u = cross(offset, direction) / denominator;
      if (t > 0 && t < 1 && u >= -EPSILON && u <= 1 + EPSILON) cuts.push(t);
    } else if (Math.abs(cross(offset, direction)) <= EPSILON) {
      for (const p of [c, d]) {
        const t = ((p.x - a.x) * direction.x + (p.y - a.y) * direction.y) / lengthSquared;
        if (t > 0 && t < 1) cuts.push(t);
      }
    }
  }
  cuts.sort((left, right) => left - right);
  // Corners can all be inside a U-shaped unit while a whole label edge spans
  // the neighbouring shop. Check every interval between boundary crossings.
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] - cuts[i - 1] <= EPSILON) continue;
    const t = (cuts[i] + cuts[i - 1]) / 2;
    if (boundaryDistance({ x: a.x + direction.x * t, y: a.y + direction.y * t }, polygon) < -EPSILON) return false;
  }
  return true;
}

function fits(shape: PlanMarkerLayout, anchor: PlanPoint, polygon: PlanPoint[]): boolean {
  if (shape.kind === 'dot' || shape.kind === 'circle') {
    return boundaryDistance(anchor, polygon) >= shape.width / 2 + 1 - EPSILON;
  }
  const halfWidth = shape.width / 2 + 1, halfHeight = shape.height / 2 + 1;
  const corners = [
    { x: anchor.x - halfWidth, y: anchor.y - halfHeight },
    { x: anchor.x + halfWidth, y: anchor.y - halfHeight },
    { x: anchor.x + halfWidth, y: anchor.y + halfHeight },
    { x: anchor.x - halfWidth, y: anchor.y + halfHeight },
  ];
  return corners.every(point => boundaryDistance(point, polygon) >= -EPSILON)
    && corners.every((point, i) => segmentInside(point, corners[(i + 1) % corners.length], polygon));
}

type OccupiedMarker = { x: number; y: number; width: number; height: number };
function overlaps(shape: OccupiedMarker, occupied: OccupiedMarker[]): boolean {
  return occupied.some(other => Math.abs(shape.x - other.x) < (shape.width + other.width) / 2 + 3
    && Math.abs(shape.y - other.y) < (shape.height + other.height) / 2 + 3);
}

/** Does not move anchors, modify units, or shrink text. Zero-size markers stay
 * available through the unit list when even a dot cannot safely fit. */
export function layoutPlanMarkers(inputs: readonly PlanMarkerInput[], options: PlanMarkerLayoutOptions): Map<string, PlanMarkerLayout> {
  const result = new Map<string, PlanMarkerLayout>();
  const occupied: OccupiedMarker[] = [];
  const dimensionsValid = Number.isFinite(options.screenWidth) && options.screenWidth > 0
    && Number.isFinite(options.aspect) && options.aspect > 0
    && Number.isFinite(options.screenWidth * options.aspect);
  const mode = parsePlanMarkerMode(options.mode);
  const ordered = inputs.map((input, index) => ({ input, index })).sort((a, b) =>
    Number(b.input.id === options.selectedId) - Number(a.input.id === options.selectedId)
    || Number(b.input.hasEvidence) - Number(a.input.hasEvidence) || a.index - b.index);
  for (const { input } of ordered) {
    const hidden: PlanMarkerLayout = { ...input.anchor, kind: 'dot', width: 0, height: 0, showPrice: false, displayLabel: '' };
    result.set(input.id, hidden);
    if (!dimensionsValid || !Number.isFinite(input.anchor.x) || !Number.isFinite(input.anchor.y) || !isValidPolygon(input.polygon)) continue;
    const anchor = { x: input.anchor.x * options.screenWidth, y: input.anchor.y * options.screenWidth * options.aspect };
    const polygon = input.polygon.map(point => ({ x: point.x * options.screenWidth, y: point.y * options.screenWidth * options.aspect }));
    if (boundaryDistance(anchor, polygon) < 0) continue;
    let shape: PlanMarkerLayout = { ...input.anchor, ...preferredShape(input, { ...options, mode }) };
    const collides = (candidate: PlanMarkerLayout) => (mode !== 'circles' || options.numberOnly) && overlaps({ ...candidate, ...anchor }, occupied);
    if (!fits(shape, anchor, polygon) || collides(shape)) {
      shape = { ...hidden, width: DOT_SIZE, height: DOT_SIZE };
      if (!fits(shape, anchor, polygon) || collides(shape)) continue;
    }
    result.set(input.id, shape);
    occupied.push({ ...shape, ...anchor });
  }
  return result;
}
