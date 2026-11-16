// Cropping a property plan (Woody, 2026-11-16: "ability to crop the page
// when loading up"). A plan page often carries a legend, a title block and
// white margin beside the drawing; a crop keeps only the area a person
// chooses. Outlines are stored as fractions of the image (0 to 1), so a crop
// moves every outline into the new frame. The rules:
//   - an outline wholly inside the crop is kept, re-measured against it;
//   - an outline wholly outside is removed when it is tied to no schedule row;
//   - an outline the crop would cut through, or one tied to a schedule row
//     that the crop would leave outside, stops the crop: nothing matched is
//     ever lost by cropping.
// The cropped image is a new file; the page as loaded is kept and its place
// is written into the new file's key, so the whole page can be brought back.

export type PlanCropRect = { x: number; y: number; width: number; height: number };
export type PlanCropPixels = { left: number; top: number; width: number; height: number };
export type PlanPointPair = [number, number];

/** The smallest crop, as a share of either side of the page. */
export const PLAN_CROP_MIN_SIDE = 0.05;
/** The smallest cropped image, in pixels on either side. */
export const PLAN_CROP_MIN_PIXELS = 200;
// Outlines traced right up to the page edge sit a hair over it once rounded.
const EDGE = 0.002;

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** The crop a request asked for, or the reason it cannot be used. */
export function readPlanCropRect(body: any): { rect: PlanCropRect } | { error: string } {
  const x = num(body?.x), y = num(body?.y), width = num(body?.width), height = num(body?.height);
  if (x == null || y == null || width == null || height == null) return { error: "Drag a box over the part of the page to keep." };
  if (x < -EDGE || y < -EDGE || x + width > 1 + EDGE || y + height > 1 + EDGE) return { error: "The crop must sit inside the page." };
  // Held to the page; a box already inside it keeps the figures it was given.
  const rect = { x: Math.max(0, x), y: Math.max(0, y), width, height };
  if (x < 0 || x + width > 1) rect.width = Math.min(1, x + width) - rect.x;
  if (y < 0 || y + height > 1) rect.height = Math.min(1, y + height) - rect.y;
  if (rect.width < PLAN_CROP_MIN_SIDE || rect.height < PLAN_CROP_MIN_SIDE) return { error: "That crop is too small. Drag a bigger box." };
  if (rect.width > 1 - 1e-6 && rect.height > 1 - 1e-6) return { error: "That is the whole page. Drag a smaller box to crop it." };
  return { rect };
}

/** The crop in whole pixels of an image, and the same crop as fractions of it. */
export function planCropPixels(rect: PlanCropRect, imageWidth: number, imageHeight: number): { pixels: PlanCropPixels; rect: PlanCropRect } {
  const left = Math.min(imageWidth - 1, Math.max(0, Math.round(rect.x * imageWidth)));
  const top = Math.min(imageHeight - 1, Math.max(0, Math.round(rect.y * imageHeight)));
  const width = Math.max(1, Math.min(imageWidth - left, Math.round(rect.width * imageWidth)));
  const height = Math.max(1, Math.min(imageHeight - top, Math.round(rect.height * imageHeight)));
  return {
    pixels: { left, top, width, height },
    rect: { x: left / imageWidth, y: top / imageHeight, width: width / imageWidth, height: height / imageHeight },
  };
}

export type CroppedOutline = { where: "inside"; points: PlanPointPair[] } | { where: "outside" | "cut" };

/** One outline against a crop: re-measured when inside, else where it falls. */
export function cropPlanOutline(points: PlanPointPair[], rect: PlanCropRect): CroppedOutline {
  if (!Array.isArray(points) || points.length < 3) return { where: "cut" };
  const moved = points.map(([x, y]) => [(x - rect.x) / rect.width, (y - rect.y) / rect.height] as PlanPointPair);
  if (moved.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return { where: "cut" };
  const ex = EDGE / rect.width, ey = EDGE / rect.height;
  if (moved.every(([x, y]) => x >= -ex && x <= 1 + ex && y >= -ey && y <= 1 + ey)) {
    return { where: "inside", points: moved.map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))] as PlanPointPair) };
  }
  // Wholly outside: its bounding box does not meet the crop at all.
  const xs = moved.map(p => p[0]), ys = moved.map(p => p[1]);
  if (Math.max(...xs) <= 0 || Math.min(...xs) >= 1 || Math.max(...ys) <= 0 || Math.min(...ys) >= 1) return { where: "outside" };
  return { where: "cut" };
}

export type PlanCropOutline = { id: string; points: PlanPointPair[]; linked: boolean };
export type PlanCropOutcome = {
  keep: Array<{ id: string; points: PlanPointPair[] }>;
  remove: string[];          // wholly outside and tied to nothing
  cut: string[];             // the crop goes through them
  linkedOutside: string[];   // tied to a schedule row, left outside
};

/** What a crop would do to a plan's outlines. It may go ahead only when `cut` and `linkedOutside` are empty. */
export function planCropOutcome(outlines: PlanCropOutline[], rect: PlanCropRect): PlanCropOutcome {
  const outcome: PlanCropOutcome = { keep: [], remove: [], cut: [], linkedOutside: [] };
  for (const outline of outlines) {
    const result = cropPlanOutline(outline.points, rect);
    if (result.where === "inside") outcome.keep.push({ id: outline.id, points: result.points });
    else if (result.where === "cut") outcome.cut.push(outline.id);
    else if (outline.linked) outcome.linkedOutside.push(outline.id);
    else outcome.remove.push(outline.id);
  }
  return outcome;
}

/** Why a crop is refused, in plain words; null when it may go ahead. */
export function planCropRefusal(outcome: PlanCropOutcome): string | null {
  const parts: string[] = [];
  if (outcome.cut.length) parts.push(`cut through ${outcome.cut.length} unit outline${outcome.cut.length === 1 ? "" : "s"}`);
  if (outcome.linkedOutside.length) parts.push(`leave ${outcome.linkedOutside.length} matched unit${outcome.linkedOutside.length === 1 ? "" : "s"} outside it`);
  if (!parts.length) return null;
  return `This crop would ${parts.join(" and ")}. Drag a bigger box, or remove those outlines first.`;
}

/** An outline measured against a cropped image, put back on the whole page. */
export function uncropPlanOutline(points: PlanPointPair[], rect: PlanCropRect): PlanPointPair[] {
  return points.map(([x, y]) => [
    Math.min(1, Math.max(0, rect.x + x * rect.width)),
    Math.min(1, Math.max(0, rect.y + y * rect.height)),
  ] as PlanPointPair);
}

// The cropped file's key carries the page it was cut from and where:
//   <page key>.crop-<left>-<top>-<width>-<height>-of-<pageWidth>x<pageHeight>-<stamp>.png
const CROP_KEY = /^(.+)\.crop-(\d+)-(\d+)-(\d+)-(\d+)-of-(\d+)x(\d+)-([a-z0-9]+)\.png$/;

export function planCropStorageKey(pageKey: string, pixels: PlanCropPixels, pageWidth: number, pageHeight: number, stamp: string): string {
  return `${pageKey}.crop-${pixels.left}-${pixels.top}-${pixels.width}-${pixels.height}-of-${pageWidth}x${pageHeight}-${stamp.toLowerCase().replace(/[^a-z0-9]/g, "")}.png`;
}

export type PlanCropOrigin = { pageKey: string; pixels: PlanCropPixels; pageWidth: number; pageHeight: number; rect: PlanCropRect };

/** Where a cropped plan image was cut from; null for a page that is not a crop. */
export function planCropOrigin(storageKey: string | null | undefined): PlanCropOrigin | null {
  const match = typeof storageKey === "string" ? CROP_KEY.exec(storageKey) : null;
  if (!match) return null;
  const [left, top, width, height, pageWidth, pageHeight] = match.slice(2, 8).map(Number);
  if (!pageWidth || !pageHeight || !width || !height || left + width > pageWidth || top + height > pageHeight) return null;
  return {
    pageKey: match[1], pixels: { left, top, width, height }, pageWidth, pageHeight,
    rect: { x: left / pageWidth, y: top / pageHeight, width: width / pageWidth, height: height / pageHeight },
  };
}
