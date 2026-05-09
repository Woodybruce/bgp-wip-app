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
import { imageStudioImages } from "@shared/schema";
import { uploadFileToSharePoint, SHAREPOINT_ROOT_FOLDER } from "./microsoft";
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

  /**
   * Iterate: take a previous rendered HTML + user instruction ("make it
   * punchier", "drop section 3", "use BGP teal for accents") and Claude
   * re-emits the full document. Same pattern as why-buy-design's iterate,
   * but generalised for any brief.
   */
  app.post("/api/document-briefs/iterate", requireAuth, async (req: Request, res: Response) => {
    try {
      const baseHtml = String(req.body?.baseHtml || "");
      const prompt = String(req.body?.prompt || "").trim();
      if (!baseHtml) return res.status(400).json({ error: "baseHtml required" });
      if (!prompt) return res.status(400).json({ error: "prompt required" });

      const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY
        ? process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
        : undefined;
      const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 16000,
        messages: [{
          role: "user",
          content: `Here is the current HTML of a BGP document:\n\n${baseHtml}\n\n---\n\nUser request: ${prompt}\n\nReturn the FULL updated HTML (single self-contained document, inline CSS, print-ready A4). Apply the user's change while keeping everything else intact and on-brand. Return ONLY the HTML, starting with <!DOCTYPE html>. No commentary.`,
        }],
      });
      const raw = msg.content?.[0]?.type === "text" ? msg.content[0].text : "";
      const html = safeHtml(raw.replace(/^```html\s*/i, "").replace(/```\s*$/i, "").trim());
      return res.json({ html, iteratedAt: new Date().toISOString() });
    } catch (err: any) {
      console.error("[document-briefs] iterate error:", err);
      return res.status(500).json({ error: err?.message || "iterate failed" });
    }
  });

  /**
   * Render-and-save as PDF: full loop — brief → Claude HTML → puppeteer
   * PDF → SharePoint upload → URL. Replaces the browser-print step with
   * server-side native PDF.
   */
  app.post("/api/document-briefs/:id/save-pdf", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const ctx: BriefContext = {
        propertyId: String(req.body?.propertyId || ""),
        matterId: req.body?.matterId,
        dealId: req.body?.dealId,
        pathwayRunId: req.body?.pathwayRunId,
        userId,
      };
      if (!ctx.propertyId) return res.status(400).json({ error: "propertyId required" });

      const brief = await runBrief(req.params.id, ctx);
      const briefPrompt = await buildClaudePromptFromBrief(brief);
      const html = await renderWithClaude(briefPrompt);

      let pdf: Buffer;
      try {
        pdf = await htmlToPdfBuffer(html, { format: "A4", landscape: brief.layoutHints?.orientation === "landscape" });
      } catch (err: any) {
        return res.status(503).json({
          error: "Native PDF unavailable",
          detail: err?.message || "no chromium configured",
          fallback: "Use Save as HTML — open in a browser and Print → Save as PDF.",
        });
      }

      const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, ctx.propertyId));
      const propertyName = property?.name || "Untitled";
      const folder = pickSharePointFolderForBrief(brief.briefId, propertyName);
      const safeName = (brief.briefName).replace(/[<>:"/\\|?*]+/g, "-").slice(0, 100);
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `${safeName} — ${propertyName.replace(/[<>:"/\\|?*]+/g, "-").slice(0, 60)} — ${dateStr}.pdf`;

      const upload = await uploadFileToSharePoint(pdf, filename, "application/pdf", folder);
      return res.json({ sharepointUrl: upload.webUrl, filename, folder, briefId: brief.briefId });
    } catch (err: any) {
      console.error("[document-briefs] save-pdf error:", err);
      return res.status(500).json({ error: err?.message || "save-pdf failed" });
    }
  });

  /**
   * Render-and-save: render via Claude design, then upload the HTML
   * to SharePoint inside the matter's folder (or the property's
   * Lease Advisory folder when no matter). Returns the SharePoint URL
   * so the UI can drop a link.
   */
  app.post("/api/document-briefs/:id/save-html", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      const ctx: BriefContext = {
        propertyId: String(req.body?.propertyId || ""),
        matterId: req.body?.matterId,
        dealId: req.body?.dealId,
        pathwayRunId: req.body?.pathwayRunId,
        userId,
      };
      if (!ctx.propertyId) return res.status(400).json({ error: "propertyId required" });

      const brief = await runBrief(req.params.id, ctx);
      const briefPrompt = await buildClaudePromptFromBrief(brief);
      const html = await renderWithClaude(briefPrompt);

      // Resolve property name for folder + filename
      const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, ctx.propertyId));
      const propertyName = property?.name || "Untitled";

      // Pick the SharePoint folder per brief category
      const folder = pickSharePointFolderForBrief(brief.briefId, propertyName);
      const safeName = (brief.briefName).replace(/[<>:"/\\|?*]+/g, "-").slice(0, 100);
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `${safeName} — ${propertyName.replace(/[<>:"/\\|?*]+/g, "-").slice(0, 60)} — ${dateStr}.html`;

      const upload = await uploadFileToSharePoint(
        Buffer.from(html, "utf8"),
        filename,
        "text/html",
        folder,
      );
      return res.json({ sharepointUrl: upload.webUrl, filename, folder, briefId: brief.briefId });
    } catch (err: any) {
      console.error("[document-briefs] save-html error:", err);
      return res.status(500).json({ error: err?.message || "save failed" });
    }
  });

  /**
   * Render: run the brief AND hand the output to Claude design, which
   * produces a print-ready self-contained HTML document. Returns
   * { html, brief, briefPrompt } so the UI can iframe-display it
   * immediately, or save to SharePoint as PDF.
   */
  app.post("/api/document-briefs/:id/render", requireAuth, async (req: Request, res: Response) => {
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

      const brief = await runBrief(req.params.id, ctx);
      const briefPrompt = await buildClaudePromptFromBrief(brief);
      const html = await renderWithClaude(briefPrompt);

      return res.json({
        html,
        brief,
        briefPromptPreview: briefPrompt.slice(0, 1200),
        renderedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[document-briefs] render error:", err);
      return res.status(500).json({ error: err?.message || "render failed" });
    }
  });
}

// ─── Claude design adapter ───────────────────────────────────────────────────

const BGP_BRAND = `
BGP brand cues:
- Primary teal: #15616D
- Cream: #FBF5DF
- Charcoal: #001524
- Accent gold: #FF7D00
- Typography: serif headlines (display), sans-serif body. Tight tracking on headlines.
- Tone: confident, evidence-led, never hyperbolic. UK property language ('instructions', 'completions', 'lease events').
- Layout: generous whitespace, clear sections, big numbers, supporting evidence underneath.
`;

const BASE_PROMPT_HEADER = `You are designing a print-ready document for Bruce Gillingham Pollard (BGP), a UK commercial property advisor.

Output a SINGLE self-contained HTML document — no external assets, no scripts, all CSS inline in a <style> tag. Print-ready (A4 portrait or landscape per layoutHints, one section per page using @page and page-break-after on each section). Looks like a polished pitch / advisory document, not a webpage.

${BGP_BRAND}

Each section:
- Bold section number top-left, title in serif
- Big hero number / chart / image where the section.imageRef is set — embed via the data:image/jpeg;base64,... URI provided
- Supporting body / bullets / structured data underneath
- BGP footer band on every page with the document title + page number

Every imagery reference uses an embedded base64 data URI provided in the brief. Use those — do not invent placeholder images.

Return ONLY the HTML, starting with <!DOCTYPE html>. No commentary.
`;

/**
 * Translate a BriefOutput into a prompt Claude can turn into HTML.
 * Inlines thumbnail base64 for each pinned image so the rendered HTML
 * is self-contained.
 */
async function buildClaudePromptFromBrief(brief: BriefOutput): Promise<string> {
  // Resolve image studio thumbnails for each pinned imagery kind
  const studioIds = Object.values(brief.imagery).map((v) => v?.imageStudioId).filter(Boolean) as string[];
  const studioRows = studioIds.length > 0
    ? await db.select().from(imageStudioImages).where(sql`${imageStudioImages.id} = ANY(${studioIds})`)
    : [];
  const studioById = new Map(studioRows.map((r) => [r.id, r]));

  // Inline data-URI for each kind
  const imagerySection = Object.entries(brief.imagery).map(([kind, v]) => {
    if (!v) return null;
    const row = studioById.get(v.imageStudioId);
    const thumb = row?.thumbnailData;
    const dataUri = thumb
      ? (thumb.startsWith("data:") ? thumb : `data:image/jpeg;base64,${thumb}`)
      : null;
    return `### ${kind}\n- caption: ${v.caption || "(none)"}\n- source: ${v.source}\n- provenance: ${brief.imageryProvenance[kind as ImageryKind] || "unknown"}\n- imageDataUri: ${dataUri || "(missing — render a typographic placeholder)"}\n`;
  }).filter(Boolean).join("\n");

  const sectionsBlock = brief.sections.map((s, i) => {
    const lines = [`### Section ${i + 1}: ${s.heading}`];
    if (s.body) lines.push(`Body: ${s.body}`);
    if (s.bullets && s.bullets.length > 0) {
      lines.push(`Bullets:`);
      s.bullets.forEach((b) => lines.push(`  - ${b}`));
    }
    if (s.imageRef) lines.push(`Image: use the "${s.imageRef}" image embedded above${s.imageCaption ? ` — caption: "${s.imageCaption}"` : ""}`);
    if (s.data && Object.keys(s.data).length > 0) {
      // Only include keys with non-null values, trim long arrays
      const trimmed: any = {};
      for (const [k, v] of Object.entries(s.data)) {
        if (v == null) continue;
        if (Array.isArray(v) && v.length > 8) {
          trimmed[k] = v.slice(0, 8);
          trimmed[`${k}_count`] = v.length;
        } else {
          trimmed[k] = v;
        }
      }
      lines.push(`Data: ${JSON.stringify(trimmed, null, 2)}`);
    }
    return lines.join("\n");
  }).join("\n\n");

  return `${BASE_PROMPT_HEADER}

# Brief: ${brief.briefName}
Title: ${brief.title}
${brief.subtitle ? `Subtitle: ${brief.subtitle}` : ""}

# Layout hints
${JSON.stringify(brief.layoutHints || {}, null, 2)}

# Imagery available (use the data URIs verbatim — do not fabricate other images)
${imagerySection || "(no imagery resolved — use typography only)"}

# Sections (render in order, one per page)
${sectionsBlock}

# Output
Return a single self-contained HTML document, starting with <!DOCTYPE html>, A4 print-ready, with embedded CSS in a <style> tag. Each section is a full page with page-break-after: always. BGP brand cues throughout.`;
}

async function renderWithClaude(prompt: string): Promise<string> {
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY
    ? process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
    : undefined;
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
  });
  const raw = msg.content?.[0]?.type === "text" ? msg.content[0].text : "";
  return safeHtml(raw.replace(/^```html\s*/i, "").replace(/```\s*$/i, "").trim());
}

function safeHtml(s: string): string {
  // Strip anything before <!DOCTYPE html if Claude added prose, ensure we
  // start with the doctype.
  const idx = s.indexOf("<!DOCTYPE");
  return idx >= 0 ? s.slice(idx) : s;
}

/**
 * HTML → PDF using puppeteer-core. Tries (in order):
 *   1. PUPPETEER_EXECUTABLE_PATH env var (system chromium, e.g. on Railway
 *      where you can install chromium via apt or via a buildpack)
 *   2. @sparticuz/chromium-min — downloads a chromium tarball from
 *      SPARTICUZ_CHROMIUM_URL (or the default GitHub release URL)
 * Throws a clear error if neither is configured.
 */
async function htmlToPdfBuffer(html: string, options?: { format?: "A4" | "Letter"; landscape?: boolean }): Promise<Buffer> {
  let puppeteer: any;
  let executablePath: string | undefined;

  try {
    puppeteer = (await import("puppeteer-core")).default || (await import("puppeteer-core"));
  } catch (err: any) {
    throw new Error("puppeteer-core not installed — run npm install puppeteer-core @sparticuz/chromium-min");
  }

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  } else {
    try {
      const chromium: any = (await import("@sparticuz/chromium-min")).default;
      const url = process.env.SPARTICUZ_CHROMIUM_URL
        || "https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.x64.tar";
      executablePath = await chromium.executablePath(url);
    } catch (err: any) {
      throw new Error(
        "Native PDF needs a chromium binary. Set PUPPETEER_EXECUTABLE_PATH to a system chromium, " +
        "or set SPARTICUZ_CHROMIUM_URL to a chromium tarball (default: github.com/Sparticuz/chromium release). " +
        `Underlying error: ${err?.message || "unknown"}`,
      );
    }
  }

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    const pdf = await page.pdf({
      format: options?.format || "A4",
      landscape: options?.landscape || false,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Pick the canonical SharePoint folder for a brief output, matching
 * Tom + Pete's existing folder taxonomy for Lease Advisory and the
 * Investment "Why Buy Deck" pattern.
 */
function pickSharePointFolderForBrief(briefId: string, propertyName: string): string {
  const cleanName = propertyName.replace(/[<>:"/\\|?*]+/g, "-").slice(0, 200);
  switch (briefId) {
    case "rent-review-representations":
      return `${SHAREPOINT_ROOT_FOLDER}/Lease Advisory/${cleanName}/Rent Review/Representations`;
    case "why-buy-memo":
      return `${SHAREPOINT_ROOT_FOLDER}/Investment/${cleanName}/Why Buy Deck`;
    case "brochure":
      return `${SHAREPOINT_ROOT_FOLDER}/Marketing/${cleanName}/Brochure`;
    case "heads-of-terms":
      return `${SHAREPOINT_ROOT_FOLDER}/Lease Advisory/${cleanName}/Lease Renewal/Heads of Terms`;
    case "market-report":
      return `${SHAREPOINT_ROOT_FOLDER}/Reporting/${cleanName}/Market Reports`;
    default:
      return `${SHAREPOINT_ROOT_FOLDER}/Documents/${cleanName}`;
  }
}
