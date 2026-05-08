/**
 * PLA Valuation engine — codifies the maths Tom + Pete already do in their
 * Net Effective, Devaluation and Comparables Schedule workbooks.
 *
 * v1 scope:
 *   - calcNetEffective: straight-line amortisation of rent-free / capex over
 *     the assumed lease term (matches BGP "Net Effective Template.xlsx").
 *   - calcItza: zoned area calculation (Zone A/B/C/D at A/1, A/2, A/4, A/8;
 *     basement and ancillary configurable per use class).
 *   - calcDevaluation: given an agreed/headline rent on a let unit, back out
 *     the implied Zone A rate using the same zoning factors.
 *
 * Each calc returns an `inputs_snapshot` + `output_summary` shaped for
 * pla_matter_workbooks so the result is auditable and re-renderable.
 *
 * Future PRs:
 *   - xlsx writer that produces a workbook matching Rob/Brixton's Net
 *     Effective Template format and uploads it to the matter's SharePoint
 *     folder (Rent Review/Valuation/).
 *   - Comparables Schedule multi-row generator.
 *   - A3 / restaurant 0.65 ancillary apportionment (BGP A3 Areas
 *     Devaluation pattern).
 */

import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import { plaMatters, plaMatterWorkbooks, plaMatterComps, crmComps, crmProperties, users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { fireNetEffectiveXlsxAsync, buildAndUploadComparablesScheduleXlsx, buildAndUploadItzaXlsx, buildAndUploadDevaluationXlsx, type ComparablesScheduleRow } from "./pla-workbook-writer";

// ─── Net Effective ───────────────────────────────────────────────────────────

export interface NetEffectiveInput {
  /** Area we're rating (sq ft). For an ITZA-style result use the ITZA area. */
  areaSqft: number;
  /** Headline annual rent £ p.a. */
  headlineRentPa: number;
  /** Lease term in years (BGP template typically assumes 10 or 15). */
  termYears: number;
  /** Months of rent-free at the start of the term. */
  rentFreeMonths?: number;
  /** One-off capex contribution from landlord, £. Treated as additional incentive. */
  capexContribution?: number;
  /** Stepped rent uplifts (e.g. a fixed £5/sqft increase at year 5). */
  steppedRents?: Array<{ fromYear: number; rentPa: number }>;
}

export interface NetEffectiveOutput {
  /** Total rent the tenant actually pays over the term (£). */
  effectiveTotal: number;
  /** Effective annualised rent (£ p.a.). */
  effectiveAnnualPa: number;
  /** Net effective rent psf (£ / sqft). */
  netEffectivePsf: number;
  /** Headline psf for comparison. */
  headlinePsf: number;
  /** Total incentive value (rent free + capex), £. */
  totalIncentive: number;
  /** Headline-to-effective discount (%). */
  discountPct: number;
}

export function calcNetEffective(input: NetEffectiveInput): NetEffectiveOutput {
  const area = num(input.areaSqft);
  const headline = num(input.headlineRentPa);
  const term = Math.max(num(input.termYears), 0.0001);
  const rentFreeMonths = num(input.rentFreeMonths);
  const capex = num(input.capexContribution);

  // Total rent paid over the term — start with the assumption that the
  // headline rent runs for the full term, then knock off the rent-free
  // period. Stepped rents replace the headline for their respective years.
  let totalPaid = 0;
  for (let yearIndex = 0; yearIndex < Math.ceil(term); yearIndex++) {
    const fraction = Math.min(1, term - yearIndex);
    const ratePa = rateForYear(yearIndex, headline, input.steppedRents || []);
    totalPaid += ratePa * fraction;
  }
  // Subtract rent-free (assumed at the start, at the year-1 rate).
  const startRate = rateForYear(0, headline, input.steppedRents || []);
  const rentFreeValue = (startRate / 12) * rentFreeMonths;
  totalPaid -= rentFreeValue;
  // Subtract capex contribution.
  totalPaid -= capex;

  const effectiveAnnual = totalPaid / term;
  const psf = area > 0 ? effectiveAnnual / area : 0;
  const headlinePsf = area > 0 ? headline / area : 0;
  const totalIncentive = rentFreeValue + capex;
  const discountPct = headline > 0 ? ((headline - effectiveAnnual) / headline) * 100 : 0;

  return {
    effectiveTotal: round2(totalPaid),
    effectiveAnnualPa: round2(effectiveAnnual),
    netEffectivePsf: round2(psf),
    headlinePsf: round2(headlinePsf),
    totalIncentive: round2(totalIncentive),
    discountPct: round2(discountPct),
  };
}

function rateForYear(yearIndex: number, base: number, steps: Array<{ fromYear: number; rentPa: number }>): number {
  // Pick the latest stepped rent whose fromYear ≤ yearIndex; fall back to base.
  let active = base;
  for (const s of steps) {
    if (s.fromYear <= yearIndex && s.rentPa > 0) active = s.rentPa;
  }
  return active;
}

// ─── ITZA ────────────────────────────────────────────────────────────────────

export interface ItzaZone {
  /** Zone A area sq ft (the front 6.1m / 20 ft strip). */
  zoneAreaSqft: number;
  /** Halving factor — 1 (A), 0.5 (B), 0.25 (C), 0.125 (D). */
  factor: number;
}

export interface ItzaInput {
  zones: ItzaZone[];
  /** Basement area + factor (e.g. 0.1 for retail A/10, 0.5 for restaurant A/2). */
  basementSqft?: number;
  basementFactor?: number;
  /** Ancillary area + factor (e.g. 0.1 for back-of-house). */
  ancillarySqft?: number;
  ancillaryFactor?: number;
  /** Restaurant A3 sales-area apportionment (typically 0.65 for ground sales). */
  a3SalesApportionment?: number;
}

export interface ItzaOutput {
  itzaSqft: number;
  zonesSqft: number[];
  zonesItza: number[];
  basementItza: number;
  ancillaryItza: number;
}

export function calcItza(input: ItzaInput): ItzaOutput {
  const zonesSqft = input.zones.map((z) => num(z.zoneAreaSqft));
  const zonesItza = input.zones.map((z) => num(z.zoneAreaSqft) * num(z.factor));
  const basementItza = num(input.basementSqft) * (num(input.basementFactor) || 0);
  const ancillaryItza = num(input.ancillarySqft) * (num(input.ancillaryFactor) || 0);

  let itza = zonesItza.reduce((a, b) => a + b, 0) + basementItza + ancillaryItza;
  // A3/restaurant: apportion sales-area further (BGP A3 Areas Devaluation
  // uses 0.65 for the ground sales floor).
  if (input.a3SalesApportionment && input.a3SalesApportionment > 0 && input.a3SalesApportionment < 1) {
    itza = itza * input.a3SalesApportionment;
  }

  return {
    itzaSqft: round2(itza),
    zonesSqft: zonesSqft.map(round2),
    zonesItza: zonesItza.map(round2),
    basementItza: round2(basementItza),
    ancillaryItza: round2(ancillaryItza),
  };
}

// ─── Devaluation (back out Zone A rate from a let comp) ──────────────────────

export interface DevaluationInput {
  /** Annual rent on the comp (£ p.a.) — typically the headline rate. */
  annualRentPa: number;
  /** ITZA result for the unit's geometry. */
  itza: ItzaOutput;
}

export interface DevaluationOutput {
  zoneARatePsfItza: number;
}

export function calcDevaluation(input: DevaluationInput): DevaluationOutput {
  const itza = num(input.itza.itzaSqft);
  const rent = num(input.annualRentPa);
  const psf = itza > 0 ? rent / itza : 0;
  return { zoneARatePsfItza: round2(psf) };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function num(v: any): number {
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── HTTP routes ─────────────────────────────────────────────────────────────

export function registerPlaValuationRoutes(app: Express): void {
  /**
   * Run Net Effective on a matter and persist the snapshot to
   * pla_matter_workbooks. The xlsx artefact lands in a follow-up — for now
   * we store the inputs + outputs as JSON so the matter detail page can
   * render the result and Tom can re-run with different assumptions.
   */
  app.post("/api/pla/matters/:id/valuation/net-effective", requireAuth, async (req: Request, res: Response) => {
    try {
      const matterId = req.params.id;
      const [matter] = await db.select().from(plaMatters).where(eq(plaMatters.id, matterId));
      if (!matter) return res.status(404).json({ error: "matter not found" });
      const input: NetEffectiveInput = {
        areaSqft: num(req.body?.areaSqft),
        headlineRentPa: num(req.body?.headlineRentPa),
        termYears: num(req.body?.termYears) || 10,
        rentFreeMonths: num(req.body?.rentFreeMonths),
        capexContribution: num(req.body?.capexContribution),
        steppedRents: Array.isArray(req.body?.steppedRents) ? req.body.steppedRents : undefined,
      };
      if (!input.areaSqft || !input.headlineRentPa) {
        return res.status(400).json({ error: "areaSqft and headlineRentPa are required" });
      }
      const output = calcNetEffective(input);
      const userId = (req as any).user?.id;
      const [workbook] = await db
        .insert(plaMatterWorkbooks)
        .values({
          matterId,
          kind: "net_effective",
          generatedBy: userId,
          inputsSnapshot: input as any,
          outputSummary: output as any,
        })
        .returning();

      // Fire-and-forget: build the xlsx workbook and upload to the matter's
      // Rent Review/Valuation/ folder. UI refetches and picks up the
      // sharepointUrl on the workbook row when it lands. Failures are logged.
      let generatedByName: string | undefined;
      if (userId) {
        const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
        generatedByName = u?.name;
      }
      fireNetEffectiveXlsxAsync({
        matterId,
        workbookId: workbook.id,
        input,
        output,
        generatedByName,
      }).catch(() => {}); // never throw from the background path

      return res.json({ input, output, workbook });
    } catch (err: any) {
      console.error("[pla-valuation] net-effective error:", err);
      return res.status(500).json({ error: err?.message || "calc failed" });
    }
  });

  /** Pure ITZA — useful for the deal pages too (not just PLA matters). */
  app.post("/api/pla/valuation/itza", requireAuth, async (req: Request, res: Response) => {
    try {
      return res.json(calcItza(itzaInputFromBody(req.body)));
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "itza calc failed" });
    }
  });

  /** Per-matter ITZA — computes and persists a workbook snapshot. */
  app.post("/api/pla/matters/:id/valuation/itza", requireAuth, async (req: Request, res: Response) => {
    try {
      const matterId = req.params.id;
      const [matter] = await db.select().from(plaMatters).where(eq(plaMatters.id, matterId));
      if (!matter) return res.status(404).json({ error: "matter not found" });
      const input = itzaInputFromBody(req.body);
      const output = calcItza(input);
      const userId = (req as any).user?.id;
      const [workbook] = await db
        .insert(plaMatterWorkbooks)
        .values({
          matterId,
          kind: "itza",
          generatedBy: userId,
          inputsSnapshot: input as any,
          outputSummary: output as any,
        })
        .returning();
      // Fire-and-forget xlsx
      fireXlsxForItza({ matterId, workbookId: workbook.id, input, output, userId }).catch(() => {});
      return res.json({ input, output, workbook });
    } catch (err: any) {
      console.error("[pla-valuation] itza matter error:", err);
      return res.status(500).json({ error: err?.message || "itza calc failed" });
    }
  });

  /** Devaluation: given a comp rent + zoning, back out implied Zone A psf. */
  app.post("/api/pla/valuation/devaluation", requireAuth, async (req: Request, res: Response) => {
    try {
      const itza = calcItza(itzaInputFromBody(req.body));
      const output = calcDevaluation({ annualRentPa: num(req.body?.annualRentPa), itza });
      return res.json({ input: { annualRentPa: num(req.body?.annualRentPa), itza }, output });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "devaluation calc failed" });
    }
  });

  /** Per-matter Devaluation — computes and persists a workbook snapshot. */
  app.post("/api/pla/matters/:id/valuation/devaluation", requireAuth, async (req: Request, res: Response) => {
    try {
      const matterId = req.params.id;
      const [matter] = await db.select().from(plaMatters).where(eq(plaMatters.id, matterId));
      if (!matter) return res.status(404).json({ error: "matter not found" });
      const itza = calcItza(itzaInputFromBody(req.body));
      const annualRentPa = num(req.body?.annualRentPa);
      const output = calcDevaluation({ annualRentPa, itza });
      const userId = (req as any).user?.id;
      const [workbook] = await db
        .insert(plaMatterWorkbooks)
        .values({
          matterId,
          kind: "devaluation",
          generatedBy: userId,
          inputsSnapshot: { annualRentPa, itza } as any,
          outputSummary: output as any,
        })
        .returning();
      // Fire-and-forget xlsx
      fireXlsxForDevaluation({ matterId, workbookId: workbook.id, input: { annualRentPa, itza }, output, userId }).catch(() => {});
      return res.json({ input: { annualRentPa, itza }, output, workbook });
    } catch (err: any) {
      console.error("[pla-valuation] devaluation matter error:", err);
      return res.status(500).json({ error: err?.message || "devaluation calc failed" });
    }
  });
}

// ─── xlsx fire-and-forget helpers (shared property + name lookup) ──────────

async function fireXlsxForItza(args: { matterId: string; workbookId: string; input: ItzaInput; output: ItzaOutput; userId?: string }): Promise<void> {
  const { propertyName, matterType, generatedByName } = await lookupContext(args.matterId, args.userId);
  if (!propertyName) return;
  buildAndUploadItzaXlsx({
    matterId: args.matterId,
    workbookId: args.workbookId,
    propertyName,
    matterType,
    input: args.input,
    output: args.output,
    generatedByName,
  }).catch((err) => console.warn(`[pla-valuation] itza xlsx async failed:`, err?.message));
}

async function fireXlsxForDevaluation(args: { matterId: string; workbookId: string; input: DevaluationInput; output: DevaluationOutput; userId?: string }): Promise<void> {
  const { propertyName, matterType, generatedByName } = await lookupContext(args.matterId, args.userId);
  if (!propertyName) return;
  buildAndUploadDevaluationXlsx({
    matterId: args.matterId,
    workbookId: args.workbookId,
    propertyName,
    matterType,
    input: args.input,
    output: args.output,
    generatedByName,
  }).catch((err) => console.warn(`[pla-valuation] devaluation xlsx async failed:`, err?.message));
}

async function lookupContext(matterId: string, userId?: string): Promise<{ propertyName: string | null; matterType: string; generatedByName?: string }> {
  const [matter] = await db.select().from(plaMatters).where(eq(plaMatters.id, matterId));
  if (!matter) return { propertyName: null, matterType: "general" };
  const [property] = await db.select({ name: crmProperties.name }).from(crmProperties).where(eq(crmProperties.id, matter.propertyId));
  let generatedByName: string | undefined;
  if (userId) {
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    generatedByName = u?.name;
  }
  return { propertyName: property?.name ?? null, matterType: matter.matterType, generatedByName };
}

function itzaInputFromBody(body: any): ItzaInput {
  return {
    zones: Array.isArray(body?.zones) ? body.zones : [],
    basementSqft: num(body?.basementSqft),
    basementFactor: num(body?.basementFactor),
    ancillarySqft: num(body?.ancillarySqft),
    ancillaryFactor: num(body?.ancillaryFactor),
    a3SalesApportionment: num(body?.a3SalesApportionment) || undefined,
  };
}

/**
 * Comparables Schedule generator — pulls every linked comp from a matter,
 * normalises them into the BGP schedule shape, persists a workbook snapshot
 * and fires an xlsx build to land in Rent Review/Comparable Evidence/.
 *
 * Registered separately so it can be reused outside the main route block.
 */
export function registerComparablesScheduleRoute(app: Express): void {
  app.post("/api/pla/matters/:id/valuation/comparables-schedule", requireAuth, async (req: Request, res: Response) => {
    try {
      const matterId = req.params.id;
      const [matter] = await db.select().from(plaMatters).where(eq(plaMatters.id, matterId));
      if (!matter) return res.status(404).json({ error: "matter not found" });

      // Pull linked comp ids + their full crm_comps rows
      const linked = await db.select().from(plaMatterComps).where(eq(plaMatterComps.matterId, matterId));
      if (linked.length === 0) {
        return res.status(400).json({ error: "no comps linked — link comps first" });
      }
      const compIds = linked.map((l) => l.compId);
      const compRows = await db
        .select()
        .from(crmComps)
        .where(sql`${crmComps.id} = ANY(${compIds})`);
      const weightById = new Map(linked.map((l) => [l.compId, l.weight ?? 1.0]));

      // Normalise to schedule rows
      const rows: ComparablesScheduleRow[] = compRows.map((c) => {
        const addr = typeof c.address === "string"
          ? c.address
          : (c.address as any)?.formatted || (c.address as any)?.line1 || c.name;
        return {
          date: c.completionDate ?? null,
          district: (c.address as any)?.district ?? c.areaLocation ?? null,
          buildingName: c.name || addr || "—",
          unit: (c.address as any)?.unit ?? null,
          tenant: c.tenant ?? null,
          areaSqft: c.areaSqft ?? c.niaSqft ?? c.giaSqft ?? null,
          leaseType: c.transactionType ?? c.transaction ?? null,
          fitOut: c.fitoutContribution ? `£${c.fitoutContribution}` : null,
          leaseLength: c.term ?? null,
          breaks: c.breakClause ?? null,
          rentPa: c.headlineRent ?? c.passingRentPa ?? null,
          rentPsf: c.rentPsfNia ?? c.rentPsfOverall ?? c.overallRatePsf ?? null,
          rentFreeMonths: c.rentFreeMonths ?? c.rentFree ?? null,
          zoneARatePsf: c.zoneARatePsf ?? c.zoneARate ?? null,
          netEffectivePsf: c.effectiveRatePsf ?? c.netEffectiveRent ?? null,
          source: c.sourceEvidence ?? c.evidenceSource ?? null,
          weight: weightById.get(c.id) ?? 1.0,
          comments: c.comments ?? null,
        };
      });

      const userId = (req as any).user?.id;
      const [workbook] = await db
        .insert(plaMatterWorkbooks)
        .values({
          matterId,
          kind: "comparables_schedule",
          generatedBy: userId,
          inputsSnapshot: { compIds, weightById: Array.from(weightById.entries()) } as any,
          outputSummary: { rowCount: rows.length } as any,
        })
        .returning();

      // Fire-and-forget xlsx build
      let generatedByName: string | undefined;
      if (userId) {
        const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
        generatedByName = u?.name;
      }
      const [property] = await db
        .select({ name: crmProperties.name })
        .from(crmProperties)
        .where(eq(crmProperties.id, matter.propertyId));
      buildAndUploadComparablesScheduleXlsx({
        matterId,
        workbookId: workbook.id,
        propertyName: property?.name || "Unknown",
        matterType: matter.matterType,
        rows,
        generatedByName,
      }).catch((err) =>
        console.warn(`[pla-valuation] comparables xlsx async failed for matter ${matterId}:`, err?.message),
      );

      return res.json({ rowCount: rows.length, rows, workbook });
    } catch (err: any) {
      console.error("[pla-valuation] comparables-schedule error:", err);
      return res.status(500).json({ error: err?.message || "comparables schedule failed" });
    }
  });
}
