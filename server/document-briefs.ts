/**
 * Document Brief framework — the Document Studio convergence story.
 *
 * Each brief is a TS-defined recipe for one document type (Why Buy memo,
 * Brochure, Heads of Terms, Rent Review Representations, Market Report,
 * Pitch Doc, etc). A brief:
 *   - declares its required + optional imagery kinds
 *   - pulls structured data from the right tables (matter / property /
 *     deal / brand / portfolio / pathway run)
 *   - resolves pinned imagery from property_imagery_assets, kicking off
 *     auto-compose for any required-but-missing kind
 *   - returns a BriefOutput that Claude design renders into the final
 *     PDF / Word / Gamma output
 *
 * The legacy Word-with-placeholders templates in document-templates.ts
 * stay in place for now — briefs are the convergent path that every new
 * document type takes. As the existing templates are migrated they
 * become brief implementations and the old paths get retired.
 *
 * Used by:
 *   - Pathway Stage 9 (Why Buy brief consumes the run's stage6/7 outputs)
 *   - PLA Matter detail (RR Representations / Dilapidations Cover briefs)
 *   - Document Studio catalog UI (any brief, any property)
 *   - ChatBGP ("generate a Brochure for 12 Hanover Sq" → run brief)
 */

import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import {
  crmProperties,
  crmCompanies,
  crmContacts,
  crmComps,
  investmentComps,
  plaMatters,
  plaMatterComps,
  plaMatterEvents,
  plaMatterWorkbooks,
  propertyPathwayRuns,
  availableUnits,
} from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { discoverImagery, getManifest, type ImageryKind, type ImageryCandidate } from "./property-imagery";
import {
  composeLocationPlan,
  composeCompsChart,
  composeErvWalk,
  composeCovenantCard,
} from "./property-imagery-composers";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BriefContext {
  /** Always set — every brief is anchored to a canonical property. */
  propertyId: string;
  matterId?: string;
  dealId?: string;
  pathwayRunId?: string;
  userId?: string;
  /** Caller can override the auto-imagery resolution with explicit picks. */
  imageryOverrides?: Partial<Record<ImageryKind, string>>;  // kind → image_studio_id
}

export interface BriefSection {
  heading: string;
  body?: string;                          // prose for Claude design to layout
  bullets?: string[];                     // alternative to body — bullet list
  imageRef?: ImageryKind;                 // which imagery to drop here
  imageCaption?: string;
  data?: Record<string, any>;             // structured data for Claude design
                                          // (numbers, tables, lists)
}

export interface BriefOutput {
  briefId: string;
  briefName: string;
  title: string;                          // document title — "Why Buy: 12 Hanover Square"
  subtitle?: string;
  sections: BriefSection[];
  /** Resolved imagery: kind → image_studio_id. Claude design renders these. */
  imagery: Partial<Record<ImageryKind, {
    imageStudioId: string;
    caption: string | null;
    source: string;
  }>>;
  /** Provenance — what was generated automatically vs picked. */
  imageryProvenance: Partial<Record<ImageryKind, "pinned" | "auto-composed" | "first-candidate" | "missing">>;
  metadata: Record<string, any>;
  layoutHints?: Record<string, any>;
}

export interface DocumentBrief {
  id: string;
  name: string;
  description: string;
  category: "letting" | "investment" | "advisory" | "marketing" | "client-reporting";
  /** What kind of context does this brief need? */
  scope: "property" | "matter" | "deal" | "brand" | "portfolio";
  /** Imagery the brief WILL render — auto-composed if missing. */
  requiredImagery: ImageryKind[];
  /** Imagery the brief uses if available, but won't trigger compose. */
  optionalImagery: ImageryKind[];
  /** Build the structured output. */
  build(ctx: BriefContext): Promise<BriefOutput>;
}

// ─── Imagery resolver — shared across all briefs ─────────────────────────────

/**
 * Resolve all imagery a brief asks for. For required kinds we will auto-
 * compose anything missing; for optional we only return what's already there.
 */
async function resolveImageryForBrief(
  ctx: BriefContext,
  required: ImageryKind[],
  optional: ImageryKind[],
): Promise<{
  imagery: BriefOutput["imagery"];
  provenance: BriefOutput["imageryProvenance"];
}> {
  // Walk discovery first so any newly-uploaded brochure / studio images
  // get folded in, then read the manifest.
  await discoverImagery({
    propertyId: ctx.propertyId,
    pathwayRunId: ctx.pathwayRunId,
    matterId: ctx.matterId,
    userId: ctx.userId,
  }).catch(() => {});

  const manifest = await getManifest(ctx.propertyId);
  const imagery: BriefOutput["imagery"] = {};
  const provenance: BriefOutput["imageryProvenance"] = {};

  const allKinds = [...new Set([...required, ...optional])];
  for (const kind of allKinds) {
    // Override wins
    const override = ctx.imageryOverrides?.[kind];
    if (override) {
      imagery[kind] = { imageStudioId: override, caption: null, source: "override" };
      provenance[kind] = "pinned";
      continue;
    }
    const candidates = manifest.byKind[kind] || [];
    const pinned = candidates.find((c) => c.pinned && c.imageStudioId);
    if (pinned && pinned.imageStudioId) {
      imagery[kind] = {
        imageStudioId: pinned.imageStudioId,
        caption: pinned.caption,
        source: pinned.source,
      };
      provenance[kind] = "pinned";
      continue;
    }
    // First candidate (sorted by score in getManifest)
    const first = candidates.find((c) => c.imageStudioId);
    if (first && first.imageStudioId) {
      imagery[kind] = {
        imageStudioId: first.imageStudioId,
        caption: first.caption,
        source: first.source,
      };
      provenance[kind] = "first-candidate";
      continue;
    }
    // Required + missing → auto-compose where we can
    if (required.includes(kind)) {
      const composed = await autoComposeForBrief(kind, ctx);
      if (composed && composed.imageStudioId) {
        imagery[kind] = {
          imageStudioId: composed.imageStudioId,
          caption: null,
          source: "auto-composed",
        };
        provenance[kind] = "auto-composed";
        continue;
      }
      provenance[kind] = "missing";
    }
  }
  return { imagery, provenance };
}

async function autoComposeForBrief(kind: ImageryKind, ctx: BriefContext): Promise<{ imageStudioId?: string } | null> {
  try {
    if (kind === "location_plan") {
      const r = await composeLocationPlan({
        propertyId: ctx.propertyId,
        zoom: 16,
        mapType: "hybrid",
        generatedBy: ctx.userId,
        pathwayRunId: ctx.pathwayRunId,
        matterId: ctx.matterId,
      });
      return r.ok ? { imageStudioId: r.imageStudioId } : null;
    }
    if (kind === "comps_chart") {
      // Auto-pull from investment comps in same postcode area
      const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, ctx.propertyId));
      if (!property?.postcode) return null;
      const m = property.postcode.toUpperCase().match(/^([A-Z]{1,2}\d{1,2})/);
      if (!m) return null;
      const prefix = m[1];
      const rows = await db
        .select()
        .from(investmentComps)
        .where(sql`${investmentComps.postalCode} ILIKE ${prefix + "%"}`)
        .limit(8);
      const comps = rows
        .filter((r) => (r.pricePsf ?? 0) > 0)
        .slice(0, 8)
        .map((r) => ({
          label: r.propertyName || r.address || "Comp",
          psf: r.pricePsf!,
          note: [r.transactionDate, r.capRate ? `${(r.capRate * 100).toFixed(2)}% cap` : null].filter(Boolean).join(" · "),
        }));
      if (comps.length === 0) return null;
      const r = await composeCompsChart({
        propertyId: ctx.propertyId,
        comps,
        title: `Investment comparables — ${prefix}`,
        unit: "£/sqft (capital)",
        generatedBy: ctx.userId,
        pathwayRunId: ctx.pathwayRunId,
        matterId: ctx.matterId,
      });
      return r.ok ? { imageStudioId: r.imageStudioId } : null;
    }
    if (kind === "erv_walk" && ctx.matterId) {
      const [m] = await db.select().from(plaMatters).where(eq(plaMatters.id, ctx.matterId));
      if (!m) return null;
      const passing = Number(m.currentRent) || 0;
      const erv = Number(m.quotingRent || m.agreedRent || 0);
      if (passing <= 0 || erv <= 0) return null;
      const yearsToReview = m.currentRentReviewDate ? Math.max(0, (new Date(m.currentRentReviewDate as any).getTime() - Date.now()) / (365.25 * 24 * 60 * 60 * 1000)) : undefined;
      const yearsToExpiry = m.expiryDate ? Math.max(0, (new Date(m.expiryDate as any).getTime() - Date.now()) / (365.25 * 24 * 60 * 60 * 1000)) : undefined;
      const r = await composeErvWalk({
        propertyId: ctx.propertyId,
        passingRentPa: passing,
        ervPa: erv,
        yearsToReview,
        yearsToExpiry,
        generatedBy: ctx.userId,
        pathwayRunId: ctx.pathwayRunId,
        matterId: ctx.matterId,
      });
      return r.ok ? { imageStudioId: r.imageStudioId } : null;
    }
    if (kind === "covenant_card" && ctx.matterId) {
      const [m] = await db.select().from(plaMatters).where(eq(plaMatters.id, ctx.matterId));
      if (!m?.clientCompanyId) return null;
      const [co] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, m.clientCompanyId));
      if (!co) return null;
      const r = await composeCovenantCard({
        propertyId: ctx.propertyId,
        tenantName: co.name,
        companiesHouseNumber: co.companiesHouseNumber || null,
        latestAccountsYear: co.financialYearEnd ? new Date(co.financialYearEnd).getFullYear() : null,
        revenuePa: co.revenue ? Number(co.revenue) : null,
        netIncome: co.netIncome ? Number(co.netIncome) : null,
        netCash: co.netCash ? Number(co.netCash) : null,
        numEmployees: co.employees || null,
        parentName: co.parentCompany || null,
        riskLevel: (co.amlRiskLevel as any) || null,
        pepClean: co.amlPepStatus === "no_pep" ? true : co.amlPepStatus === "pep_match" ? false : null,
        sanctionsClean: co.amlSanctionsStatus === "no_match" ? true : co.amlSanctionsStatus === "match" ? false : null,
        generatedBy: ctx.userId,
        pathwayRunId: ctx.pathwayRunId,
        matterId: ctx.matterId,
      });
      return r.ok ? { imageStudioId: r.imageStudioId } : null;
    }
  } catch (err: any) {
    console.warn(`[document-briefs] auto-compose ${kind} failed:`, err?.message);
  }
  return null;
}

// ─── Brief implementations ───────────────────────────────────────────────────

const whyBuyBrief: DocumentBrief = {
  id: "why-buy-memo",
  name: "Why Buy — Investment Memo",
  description: "PE-style 4-page memo: asset overview, business plan thesis, financial walk, comps, covenant + area, risks, exit. Anchored to a Pathway run when available.",
  category: "investment",
  scope: "property",
  requiredImagery: ["hero", "location_plan", "comps_chart"],
  optionalImagery: ["secondary_external", "internal", "floor_plan", "erv_walk", "covenant_card"],

  async build(ctx) {
    const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, ctx.propertyId));
    if (!property) throw new Error("property not found");

    // Stage 6 business plan + Stage 7 model summary if a Pathway run is supplied
    let stage6: any = null;
    let stage7: any = null;
    if (ctx.pathwayRunId) {
      const [run] = await db.select().from(propertyPathwayRuns).where(eq(propertyPathwayRuns.id, ctx.pathwayRunId));
      const sr = (run?.stageResults as any) || {};
      stage6 = sr.stage6 || null;
      stage7 = sr.stage7 || null;
    }

    const { imagery, provenance } = await resolveImageryForBrief(
      ctx,
      whyBuyBrief.requiredImagery,
      whyBuyBrief.optionalImagery,
    );

    const sections: BriefSection[] = [
      {
        heading: "Asset overview",
        imageRef: "hero",
        data: {
          name: property.name,
          address: typeof property.address === "string" ? property.address : (property.address as any)?.formatted,
          postcode: property.postcode,
          assetClass: property.assetClass,
          tenure: property.tenure,
          sqft: property.sqft,
          titleNumber: property.titleNumber,
          uprn: property.uprn,
          freeholder: property.freeholderId,
          longLeaseholder: property.longLeaseholderId,
        },
      },
      {
        heading: "Investment thesis",
        body: stage6?.thesis || stage6?.summary || "Business plan to be drafted (run Pathway Stage 6).",
        data: { businessPlan: stage6 || null },
      },
      {
        heading: "Financial walk",
        imageRef: "erv_walk",
        body: stage7
          ? "Returns model agreed at Pathway Stage 7. Net effective rents, reversion uplift and exit yield drive the IRR scenarios above."
          : "Run Pathway Stage 7 to lock the Excel model. ERV walk above shows the rent trajectory once it's in.",
        data: { modelSummary: stage7 || null },
      },
      {
        heading: "Location & adjacencies",
        imageRef: "location_plan",
        imageCaption: "Subject property in red. Tube/rail stations and recent investment transactions overlaid for context.",
      },
      {
        heading: "Comparable evidence",
        imageRef: "comps_chart",
        imageCaption: "Recent investment transactions in the same postcode area, last 36 months. Subject highlighted.",
      },
      {
        heading: "Tenant covenant",
        imageRef: "covenant_card",
        body: "Headline tenant financials and AML status. Covenant strength → capitalisation rate.",
      },
      {
        heading: "Risks & exit",
        body: "Key downside scenarios, market sensitivities and exit-route options. Drafted automatically from the Stage 6 risks register.",
        data: { risks: stage6?.risks || [] },
      },
    ];

    return {
      briefId: whyBuyBrief.id,
      briefName: whyBuyBrief.name,
      title: `Why Buy — ${property.name}`,
      subtitle: property.postcode ? `${property.postcode} · ${property.assetClass || "Investment"}` : undefined,
      sections,
      imagery,
      imageryProvenance: provenance,
      metadata: { property, stage6, stage7, generatedAt: new Date().toISOString() },
      layoutHints: {
        pageCount: 4,
        coverImage: "hero",
        toneOfVoice: "PE-style — terse, numerate, evidence-led",
      },
    };
  },
};

const brochureBrief: DocumentBrief = {
  id: "brochure",
  name: "Brochure (letting / sale)",
  description: "Marketing brochure — hero, internals, floor plan, location plan, key facts, available units. The classic BGP letting / sale piece.",
  category: "letting",
  scope: "property",
  requiredImagery: ["hero", "location_plan"],
  optionalImagery: ["internal", "secondary_external", "floor_plan"],

  async build(ctx) {
    const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, ctx.propertyId));
    if (!property) throw new Error("property not found");

    const units = await db
      .select()
      .from(availableUnits)
      .where(eq(availableUnits.propertyId, ctx.propertyId))
      .limit(20);

    const { imagery, provenance } = await resolveImageryForBrief(
      ctx,
      brochureBrief.requiredImagery,
      brochureBrief.optionalImagery,
    );

    const sections: BriefSection[] = [
      {
        heading: "Cover",
        imageRef: "hero",
        data: {
          name: property.name,
          address: typeof property.address === "string" ? property.address : (property.address as any)?.formatted,
          postcode: property.postcode,
          assetClass: property.assetClass,
          tenure: property.tenure,
        },
      },
      {
        heading: "The opportunity",
        body: property.notes || "Prime opportunity to be detailed.",
      },
      {
        heading: "Specification",
        bullets: [
          property.sqft ? `${Number(property.sqft).toLocaleString()} sqft NIA` : null,
          property.assetClass ? `Use class: ${property.assetClass}` : null,
          property.tenure ? `Tenure: ${property.tenure}` : null,
          property.titleNumber ? `Title: ${property.titleNumber}` : null,
        ].filter(Boolean) as string[],
      },
      {
        heading: "Floor plans",
        imageRef: "floor_plan",
        imageCaption: "Latest floor plan from brochure / planning portal.",
      },
      {
        heading: "Location",
        imageRef: "location_plan",
        imageCaption: "Subject in red, transport nodes overlaid.",
      },
      ...(units.length > 0 ? [{
        heading: "Available units",
        data: { units },
      }] : []),
      {
        heading: "Contact",
        data: { team: property.bgpContactCrm, agent: property.agent },
      },
    ];

    return {
      briefId: brochureBrief.id,
      briefName: brochureBrief.name,
      title: property.name,
      subtitle: property.postcode || undefined,
      sections,
      imagery,
      imageryProvenance: provenance,
      metadata: { property, units, generatedAt: new Date().toISOString() },
      layoutHints: {
        pageCount: units.length > 4 ? 6 : 4,
        coverImage: "hero",
        toneOfVoice: "Confident, marketing-led",
      },
    };
  },
};

const headsOfTermsBrief: DocumentBrief = {
  id: "heads-of-terms",
  name: "Heads of Terms",
  description: "Concise HoT — parties, demise, term, rent, breaks, key clauses. Drives the legal pack.",
  category: "letting",
  scope: "deal",
  requiredImagery: ["hero", "location_plan"],
  optionalImagery: ["floor_plan"],

  async build(ctx) {
    const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, ctx.propertyId));
    if (!property) throw new Error("property not found");

    const { imagery, provenance } = await resolveImageryForBrief(
      ctx,
      headsOfTermsBrief.requiredImagery,
      headsOfTermsBrief.optionalImagery,
    );

    return {
      briefId: headsOfTermsBrief.id,
      briefName: headsOfTermsBrief.name,
      title: `Heads of Terms — ${property.name}`,
      subtitle: property.postcode || undefined,
      sections: [
        { heading: "Property", imageRef: "hero", data: { property } },
        { heading: "Parties", data: { dealId: ctx.dealId, requireFromDeal: true } },
        { heading: "Demise", imageRef: "floor_plan" },
        { heading: "Term & breaks" },
        { heading: "Rent & rent reviews" },
        { heading: "Repair, alienation, alterations" },
        { heading: "Conditions" },
        { heading: "Location", imageRef: "location_plan" },
      ],
      imagery,
      imageryProvenance: provenance,
      metadata: { property, generatedAt: new Date().toISOString() },
      layoutHints: { pageCount: 2, toneOfVoice: "Legal, terse" },
    };
  },
};

const rentReviewRepsBrief: DocumentBrief = {
  id: "rent-review-representations",
  name: "Rent Review Representations",
  description: "Tom + Pete's RR pack — subject, comparables analysis, ITZA/zoning, valuation, recommendation. Auto-pulls comps + valuation snapshots from a PLA matter.",
  category: "advisory",
  scope: "matter",
  requiredImagery: ["hero", "location_plan", "comps_chart"],
  optionalImagery: ["floor_plan", "covenant_card", "erv_walk"],

  async build(ctx) {
    if (!ctx.matterId) throw new Error("rent-review-representations requires matterId");
    const [matter] = await db.select().from(plaMatters).where(eq(plaMatters.id, ctx.matterId));
    if (!matter) throw new Error("matter not found");
    const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, matter.propertyId));
    if (!property) throw new Error("property not found");

    // Pull linked comps with full crm_comps detail
    const linked = await db.select().from(plaMatterComps).where(eq(plaMatterComps.matterId, ctx.matterId));
    const compIds = linked.map((l) => l.compId);
    const compRows = compIds.length > 0
      ? await db.select().from(crmComps).where(sql`${crmComps.id} = ANY(${compIds})`)
      : [];

    // Pull saved workbook snapshots (Net Effective, ITZA, Devaluation)
    const workbooks = await db
      .select()
      .from(plaMatterWorkbooks)
      .where(eq(plaMatterWorkbooks.matterId, ctx.matterId))
      .orderBy(desc(plaMatterWorkbooks.generatedAt));

    const { imagery, provenance } = await resolveImageryForBrief(
      { ...ctx, propertyId: matter.propertyId },
      rentReviewRepsBrief.requiredImagery,
      rentReviewRepsBrief.optionalImagery,
    );

    return {
      briefId: rentReviewRepsBrief.id,
      briefName: rentReviewRepsBrief.name,
      title: `Rent Review Representations — ${property.name}`,
      subtitle: matter.matterType === "rent_review" ? "Rent Review" : matter.matterType.replace(/_/g, " "),
      sections: [
        { heading: "Subject property", imageRef: "hero", data: { property, matter } },
        { heading: "Demise", imageRef: "floor_plan" },
        {
          heading: "Lease terms",
          data: {
            currentRent: matter.currentRent,
            currentReviewDate: matter.currentRentReviewDate,
            breakDate: matter.breakDate,
            expiryDate: matter.expiryDate,
            actingFor: matter.actingFor,
          },
        },
        { heading: "Tenant covenant", imageRef: "covenant_card" },
        { heading: "Comparable evidence", imageRef: "comps_chart", data: { comps: compRows.map((c) => ({
          name: c.name,
          tenant: c.tenant,
          area: c.areaSqft,
          rent: c.headlineRent,
          rentPsf: c.rentPsfNia || c.rentPsfOverall || c.zoneARatePsf,
          completionDate: c.completionDate,
          netEffective: c.netEffectiveRent,
        })) } },
        {
          heading: "Valuation analysis",
          data: {
            workbooks: workbooks.map((w) => ({
              kind: w.kind,
              outputSummary: w.outputSummary,
              sharepointUrl: w.sharepointUrl,
              generatedAt: w.generatedAt,
            })),
          },
        },
        { heading: "ERV walk", imageRef: "erv_walk" },
        { heading: "Location & adjacencies", imageRef: "location_plan" },
        {
          heading: "Recommendation",
          body: matter.quotingRent
            ? `Our position: £${Number(matter.quotingRent).toLocaleString()} p.a.`
            : "Negotiation position to be set on the matter.",
          data: {
            quotingRent: matter.quotingRent,
            counterQuotingRent: matter.counterQuotingRent,
            agreedRent: matter.agreedRent,
          },
        },
      ],
      imagery,
      imageryProvenance: provenance,
      metadata: { matter, property, comps: compRows, workbooks, generatedAt: new Date().toISOString() },
      layoutHints: { pageCount: 8, toneOfVoice: "Authoritative advisory, evidence-led" },
    };
  },
};

const marketReportBrief: DocumentBrief = {
  id: "market-report",
  name: "Market Report",
  description: "Area or asset-class market report — recent transactions, rent trends, planning pipeline, anchor brands. Drives client-reporting and BD pitches.",
  category: "client-reporting",
  scope: "property",
  requiredImagery: ["location_plan", "comps_chart"],
  optionalImagery: ["hero"],

  async build(ctx) {
    const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, ctx.propertyId));
    if (!property) throw new Error("property not found");

    const { imagery, provenance } = await resolveImageryForBrief(
      ctx,
      marketReportBrief.requiredImagery,
      marketReportBrief.optionalImagery,
    );

    return {
      briefId: marketReportBrief.id,
      briefName: marketReportBrief.name,
      title: `Market Report — ${property.postcode || property.name}`,
      sections: [
        { heading: "Area overview", imageRef: "location_plan" },
        { heading: "Recent transactions", imageRef: "comps_chart" },
        { heading: "Rent trends" },
        { heading: "Planning pipeline" },
        { heading: "Anchor brands & adjacencies" },
        { heading: "Outlook" },
      ],
      imagery,
      imageryProvenance: provenance,
      metadata: { property, generatedAt: new Date().toISOString() },
      layoutHints: { pageCount: 6, toneOfVoice: "Analytical, client-reporting" },
    };
  },
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const BRIEF_REGISTRY: Record<string, DocumentBrief> = {
  "why-buy-memo": whyBuyBrief,
  "brochure": brochureBrief,
  "heads-of-terms": headsOfTermsBrief,
  "rent-review-representations": rentReviewRepsBrief,
  "market-report": marketReportBrief,
};

export function listBriefs(): Array<Omit<DocumentBrief, "build">> {
  return Object.values(BRIEF_REGISTRY).map(({ build, ...rest }) => rest);
}

export async function runBrief(briefId: string, ctx: BriefContext): Promise<BriefOutput> {
  const brief = BRIEF_REGISTRY[briefId];
  if (!brief) throw new Error(`Unknown briefId: ${briefId}`);
  return brief.build(ctx);
}

// ─── HTTP routes ─────────────────────────────────────────────────────────────

export function registerDocumentBriefRoutes(app: Express): void {
  /** List the catalog — what document types are available. */
  app.get("/api/document-briefs", requireAuth, (_req: Request, res: Response) => {
    return res.json(listBriefs());
  });

  /** Look up a brief's metadata + required/optional imagery (for the Document Studio UI). */
  app.get("/api/document-briefs/:id", requireAuth, (req: Request, res: Response) => {
    const brief = BRIEF_REGISTRY[req.params.id];
    if (!brief) return res.status(404).json({ error: "brief not found" });
    const { build, ...meta } = brief;
    return res.json(meta);
  });

  /**
   * Run a brief against a property/matter/deal/pathway-run context. Returns
   * the full BriefOutput — Claude design takes this and renders into a PDF.
   */
  app.post("/api/document-briefs/:id/run", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const ctx: BriefContext = {
        propertyId: String(req.body?.propertyId || ""),
        matterId: req.body?.matterId,
        dealId: req.body?.dealId,
        pathwayRunId: req.body?.pathwayRunId,
        userId,
        imageryOverrides: req.body?.imageryOverrides,
      };
      if (!ctx.propertyId) return res.status(400).json({ error: "propertyId required" });
      const output = await runBrief(req.params.id, ctx);
      return res.json(output);
    } catch (err: any) {
      console.error("[document-briefs] run error:", err);
      return res.status(500).json({ error: err?.message || "brief run failed" });
    }
  });
}
