import sharp from "sharp";
import { isValidPolygon, pointInPolygon, type PlanPoint } from "@shared/plan-geometry";
import type { PropertyPlanCandidate, PropertyPlanPolygon } from "@shared/property-plan-scan";
import { findPlanUnitRegions, traceDetectedPlanUnit, planPolygonsOverlap, type DetectedPlanUnit } from "./plan-unit-detection";
import { detectTile } from "./plan-scan-vision";
import { normalizeEvidenceTenantName, normalizeEvidenceUnitRef } from "./evidence-plan-schedule";

export function planPoints(polygon: PropertyPlanPolygon | null | undefined): PlanPoint[] {
  if (!Array.isArray(polygon?.points)) return [];
  return polygon.points.map(p => ({ x: p?.[0], y: p?.[1] }));
}

// The display original is never resized or overwritten. Only this working
// raster is reduced, using the same tracing resolution as evidence plans.
export async function propertyPlanRaster(image: Buffer) {
  const { data, info } = await sharp(image, { limitInputPixels: 100_000_000 })
    .rotate().flatten({ background: "#ffffff" }).resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true })
    .removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

type ScheduleOption = { tenancy_unit_id: string | null; unit_id: string | null; unit_name: string; tenant_name: string | null };

export function suggestPropertyPlanLink(label: string | null, tenant: string | null, options: ScheduleOption[]) {
  const canonical = options.filter(option => option.tenancy_unit_id);
  const ref = label ? normalizeEvidenceUnitRef(label) : "";
  // An explicit printed ref must not be overridden with a same-name tenant
  // from a different shop. Duplicated refs/names always require a choice.
  const matches = ref ? canonical.filter(option => normalizeEvidenceUnitRef(option.unit_name) === ref)
    : tenant ? canonical.filter(option => normalizeEvidenceTenantName(option.tenant_name) === normalizeEvidenceTenantName(tenant)) : [];
  if (matches.length !== 1) return null;
  const match = matches[0];
  if (ref && tenant && match.tenant_name && normalizeEvidenceTenantName(tenant) !== normalizeEvidenceTenantName(match.tenant_name)) return null;
  return match;
}

export async function scanPropertyPlanImage(image: Buffer, options: ScheduleOption[], existing: { polygon: PropertyPlanPolygon }[],
  checkpoint: (message: string, completed: number, total: number) => Promise<void>, readTile: typeof detectTile = detectTile,
): Promise<{ candidates: PropertyPlanCandidate[]; message: string }> {
  await checkpoint("Tracing enclosed boundaries", 0, 1);
  const originalMeta = await sharp(image, { limitInputPixels: 100_000_000 }).metadata();
  if (originalMeta.hasAlpha || originalMeta.orientation && originalMeta.orientation !== 1) image = await sharp(image).rotate().flatten({ background: "#ffffff" }).png().toBuffer();
  const meta = await sharp(image).metadata();
  if (!meta.width || !meta.height) throw new Error("The plan image could not be read");
  const raster = await propertyPlanRaster(image);
  const regions = findPlanUnitRegions(raster);
  const known = options.map(row => row.unit_name).filter(Boolean).slice(0, 500);
  const found: DetectedPlanUnit[] = [];
  let failures = 0;
  const batchSize = Math.max(12, Math.ceil(regions.length / 20));
  const frames = regions.length ? Array.from({ length: Math.ceil(regions.length / batchSize) }, (_, index) => ({
    x: 0, y: 0, w: 1, h: 1, overview: false, regions: regions.slice(index * batchSize, (index + 1) * batchSize), focused: true,
  })) : [{ x: 0, y: 0, w: 1, h: 1, overview: true, regions: [], focused: false },
    ...[0, .3, .6].flatMap(y => [0, .3, .6].map(x => ({ x, y, w: .4, h: .4, overview: false, regions: [], focused: false })))];
  for (let i = 0; i < frames.length; i++) {
    await checkpoint(`Reading unit identities · section ${i + 1} of ${frames.length}`, i, frames.length);
    const frame = frames[i];
    let success = false;
    for (let attempt = 0; attempt < 2 && !success; attempt++) {
      try {
        found.push(...await readTile(sharp, image, meta.width, meta.height, frame.x, frame.y, frame.w, frame.h, known, frame.overview, frame.regions, frame.focused));
        success = true;
      } catch { if (attempt === 1) failures++; }
      // Renew/check the job lease before retrying or processing an AI result.
      await checkpoint(`Reading unit identities · section ${i + 1} of ${frames.length}`, success ? i + 1 : i, frames.length);
    }
  }
  if (!found.length && failures === frames.length) throw new Error("The scan service could not read this plan. Try again, or use Trace unit. Saved outlines are unchanged.");
  const traced: { candidate: DetectedPlanUnit; polygon: PlanPoint[]; dot: PlanPoint }[] = [];
  let untraced = 0, covered = 0;
  for (const candidate of found) {
    const region = traceDetectedPlanUnit(raster, candidate, regions);
    if (!region || !isValidPolygon(region.polygon)) { untraced++; continue; }
    if (existing.some(unit => planPolygonsOverlap(planPoints(unit.polygon), region.polygon))) { covered++; continue; }
    const duplicate = traced.find(unit => pointInPolygon(unit.dot, region.polygon) && pointInPolygon(region.dot, unit.polygon));
    if (duplicate) {
      if (duplicate.candidate.unitRef && candidate.unitRef && normalizeEvidenceUnitRef(duplicate.candidate.unitRef) !== normalizeEvidenceUnitRef(candidate.unitRef)) {
        duplicate.candidate.reviewRequired = true;
        // Conflicting identities cannot be used as an automatic suggestion.
        duplicate.candidate.unitRef = null; duplicate.candidate.tenant = null;
      }
      continue;
    }
    traced.push({ candidate: { ...candidate }, polygon: region.polygon, dot: region.dot });
  }
  const candidates = traced.map(({ candidate, polygon }, index): PropertyPlanCandidate => {
    const link = suggestPropertyPlanLink(candidate.unitRef, candidate.tenant, options);
    const label = candidate.unitRef || candidate.tenant || `Unlabelled ${index + 1}`;
    const conflict = traced.some((other, otherIndex) => otherIndex !== index && planPolygonsOverlap(polygon, other.polygon));
    return { id: `candidate-${index + 1}`, label, tenant: candidate.tenant, polygon: { points: polygon.map(p => [p.x, p.y]) },
      tenancy_unit_id: link?.tenancy_unit_id ?? null, unit_id: link?.unit_id ?? null,
      requiresReview: !!candidate.reviewRequired || !link || conflict,
      warning: conflict ? "Overlaps another proposal. Keep only the correct boundary."
        : candidate.reviewRequired ? "The identity or boundary needs checking."
        : !link ? "Choose a tenancy row, or save as an unlinked outline." : null };
  });
  const message = `${candidates.length} proposed outlines. Review them before saving.`
    + (failures ? ` ${failures} sections could not be read; this scan is incomplete.` : "")
    + (untraced ? ` ${untraced} detections had no reliable boundary and were left out.` : "")
    + (covered ? " Areas with existing outlines were kept unchanged." : "")
    + (!candidates.length ? " Try Trace unit inside a clear unit, or draw its boundary." : "");
  return { candidates, message };
}
