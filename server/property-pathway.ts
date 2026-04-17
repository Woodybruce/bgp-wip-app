import type { Express, Request, Response } from "express";
import { eq, desc, and, or, ilike } from "drizzle-orm";
import { requireAuth } from "./auth";
import { db } from "./db";
import {
  propertyPathwayRuns,
  crmProperties,
  crmCompanies,
  type PropertyPathwayRun,
} from "@shared/schema";
import { performPropertyLookup } from "./property-lookup";
import { executeCreateSharePointFolder } from "./utils/sharepoint-operations";

/**
 * Property Pathway Orchestrator
 *
 * Deterministic 7-stage state machine that drives a property investigation
 * end-to-end. Each stage is a discrete function that reads current run state,
 * calls the relevant APIs, writes results back, and advances the stage.
 *
 * Stages:
 *   1. Initial Search — emails, SharePoint, CRM, basic land reg, set up folder tree
 *   2. Brand Intelligence — if tenant is known, enrich the brand
 *   3. Detailed Search Summary — summarise, gate for user confirmation
 *   4. Property Intelligence — full titles, planning (floor plans), proprietor KYC
 *   5. Investigation Board — aggregate view ready
 *   6. Studio Time — Image Studio (street view, retail context plan) + Model Studio seed
 *   7. Why Buy — generate 4-page PE IM document
 */

const STANDARD_FOLDER_TREE = [
  "Brochure & Marketing",
  "Legal & Title",
  "Financial Model",
  "Due Diligence",
  "Correspondence",
  "Images & Photography",
  "Comparables",
  "Surveys & Reports",
  "Why Buy Deck",
  "KYC & AML",
];

type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

interface StageResults {
  stage1?: {
    emailHits?: Array<{ subject: string; from: string; date: string; msgId: string; preview: string; hasAttachments: boolean }>;
    sharepointHits?: Array<{ name: string; path: string; webUrl: string; modifiedAt: string }>;
    crmHits?: { properties: any[]; deals: any[]; companies: any[] };
    initialOwnership?: { titleNumber: string; proprietorName?: string; proprietorCategory?: string; pricePaid?: number; dateOfPurchase?: string } | null;
    tenant?: { name: string; companyNumber?: string };
    folderTree?: { root: string; webUrl: string; children: string[] };
    summary?: string;
  };
  stage2?: {
    companyId?: string;
    enrichedFields?: Record<string, any>;
    skipped?: boolean;
    reason?: string;
  };
  stage3?: {
    summary: string;
    recommendProceed: boolean;
  };
  stage4?: {
    titleRegisters?: Array<{ titleNumber: string; documentUrl?: string }>;
    planningApplications?: Array<{ reference: string; description: string; status: string; date: string }>;
    floorPlanUrls?: string[];
    proprietorKyc?: any;
  };
  stage5?: {
    ready: boolean;
    boardUrl?: string;
  };
  stage6?: {
    modelRunId?: string;
    streetViewImageId?: string;
    retailContextImageId?: string;
    additionalImageIds?: string[];
  };
  stage7?: {
    documentUrl?: string;
    sharepointUrl?: string;
    pdfPath?: string;
  };
}

interface StageStatusMap {
  stage1?: StageStatus;
  stage2?: StageStatus;
  stage3?: StageStatus;
  stage4?: StageStatus;
  stage5?: StageStatus;
  stage6?: StageStatus;
  stage7?: StageStatus;
}

async function getRun(runId: string): Promise<PropertyPathwayRun | null> {
  const [run] = await db.select().from(propertyPathwayRuns).where(eq(propertyPathwayRuns.id, runId)).limit(1);
  return run || null;
}

async function updateRun(runId: string, updates: Partial<PropertyPathwayRun>): Promise<PropertyPathwayRun> {
  const [updated] = await db
    .update(propertyPathwayRuns)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(propertyPathwayRuns.id, runId))
    .returning();
  return updated;
}

async function setStageStatus(runId: string, stage: keyof StageStatusMap, status: StageStatus, resultsPatch?: Partial<StageResults>): Promise<PropertyPathwayRun> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Pathway run ${runId} not found`);
  const stageStatus = { ...(run.stageStatus as StageStatusMap), [stage]: status };
  const stageResults = { ...(run.stageResults as StageResults), ...(resultsPatch || {}) };
  const stageNumber = parseInt(stage.replace("stage", ""), 10);
  const newCurrentStage = status === "completed" && stageNumber >= run.currentStage ? Math.min(7, stageNumber + 1) : run.currentStage;
  return updateRun(runId, { stageStatus, stageResults, currentStage: newCurrentStage });
}

// ============================================================================
// STAGE 1 — Initial Search
// ============================================================================

async function runStage1(runId: string, req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await setStageStatus(runId, "stage1", "running");

  const address = run.address;
  const postcode = run.postcode || "";
  const searchTerms = address.split(/[, ]+/).filter((t) => t.length > 2);

  // 1a. Search CRM for existing records
  let crmHits = { properties: [] as any[], deals: [] as any[], companies: [] as any[] };
  try {
    const propertyMatches = await db
      .select()
      .from(crmProperties)
      .where(
        or(
          ilike(crmProperties.name, `%${address}%`),
          postcode ? ilike(crmProperties.name, `%${postcode}%`) : ilike(crmProperties.name, `%__nomatch__%`)
        )
      )
      .limit(10);
    crmHits.properties = propertyMatches;
  } catch (err: any) {
    console.error("[pathway stage1] CRM search error:", err?.message);
  }

  // 1b. Ownership — prefer CRM data if we already have it, fall back to PropertyData freeholds lookup
  let initialOwnership: NonNullable<StageResults["stage1"]>["initialOwnership"] = null;
  const crmMatch = crmHits.properties[0];
  if (crmMatch?.proprietorName || crmMatch?.titleNumber) {
    initialOwnership = {
      titleNumber: crmMatch.titleNumber || "unknown",
      proprietorName: crmMatch.proprietorName || undefined,
      proprietorCategory: crmMatch.proprietorType || undefined,
    };
  }
  // Enrich with PropertyData lookup regardless, in case CRM is incomplete
  try {
    const lookup = await performPropertyLookup({ address, postcode, layers: ["core"] });
    const freeholds = lookup.propertyDataCoUk?.freeholds?.data || [];
    if (freeholds.length > 0) {
      const best = freeholds[0];
      initialOwnership = {
        titleNumber: best.title_number || best.title || initialOwnership?.titleNumber || "unknown",
        proprietorName: best.proprietor_name_1 || initialOwnership?.proprietorName,
        proprietorCategory: best.proprietor_category || initialOwnership?.proprietorCategory,
        pricePaid: best.price_paid ? Number(best.price_paid) : initialOwnership?.pricePaid,
        dateOfPurchase: best.date_proprietor_added || initialOwnership?.dateOfPurchase,
      };
    }
  } catch (err: any) {
    console.error("[pathway stage1] Land reg lookup error:", err?.message);
  }

  // 1c. Email search via Microsoft Graph (app-only, uses shared mailbox helper)
  const emailHits: NonNullable<StageResults["stage1"]>["emailHits"] = [];
  try {
    const { graphRequest } = await import("./shared-mailbox");
    const searchQuery = postcode || address.split(",")[0].trim();
    const searchRes = await graphRequest(
      `/users/chatbgp@brucegillinghampollard.com/messages?$search="${encodeURIComponent(searchQuery)}"&$top=25&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments`
    ).catch(() => null);
    const messages = searchRes?.value || [];
    for (const msg of messages.slice(0, 25)) {
      emailHits.push({
        subject: msg.subject || "(no subject)",
        from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || "unknown",
        date: msg.receivedDateTime,
        msgId: msg.id,
        preview: (msg.bodyPreview || "").slice(0, 200),
        hasAttachments: !!msg.hasAttachments,
      });
    }
  } catch (err: any) {
    console.error("[pathway stage1] Email search error:", err?.message);
  }

  // 1d. Create SharePoint folder tree
  let folderTree: NonNullable<StageResults["stage1"]>["folderTree"] | undefined;
  try {
    const propertyFolderName = address.replace(/[\/\\:*?"<>|]/g, "-").slice(0, 120);
    const root = await executeCreateSharePointFolder(
      { folderName: propertyFolderName, parentPath: "Investment" },
      req
    );
    for (const child of STANDARD_FOLDER_TREE) {
      try {
        await executeCreateSharePointFolder(
          { folderName: child, parentPath: `Investment/${propertyFolderName}` },
          req
        );
      } catch {
        // sub-folder create may fail if already exists — carry on
      }
    }
    folderTree = {
      root: root.folder.path,
      webUrl: root.folder.webUrl,
      children: STANDARD_FOLDER_TREE,
    };
  } catch (err: any) {
    console.error("[pathway stage1] Folder tree create error:", err?.message);
  }

  const summary = [
    `Initial search complete for ${address}.`,
    crmHits.properties.length ? `Found ${crmHits.properties.length} matching CRM property record(s).` : `No existing CRM records.`,
    initialOwnership?.proprietorName ? `Current owner: ${initialOwnership.proprietorName} (title ${initialOwnership.titleNumber}).` : `Ownership not resolved yet.`,
    emailHits.length ? `${emailHits.length} email(s) found in shared mailbox referencing this property.` : `No emails found.`,
    folderTree ? `SharePoint folder tree created at ${folderTree.root}.` : `Folder tree creation deferred.`,
  ].join(" ");

  await setStageStatus(runId, "stage1", "completed", {
    stage1: {
      emailHits,
      crmHits,
      initialOwnership,
      folderTree,
      summary,
    },
  });
  await updateRun(runId, {
    sharepointFolderPath: folderTree?.root,
    sharepointFolderUrl: folderTree?.webUrl,
  });
}

// ============================================================================
// STAGE 2 — Brand Intelligence
// ============================================================================

async function runStage2(runId: string, _req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  const results = run.stageResults as StageResults;
  const tenantName = results.stage1?.tenant?.name;

  if (!tenantName) {
    await setStageStatus(runId, "stage2", "skipped", {
      stage2: { skipped: true, reason: "No tenant identified in Stage 1" },
    });
    return;
  }

  await setStageStatus(runId, "stage2", "running");

  try {
    // Find or create company
    let [company] = await db.select().from(crmCompanies).where(ilike(crmCompanies.name, tenantName)).limit(1);

    if (!company) {
      const [created] = await db
        .insert(crmCompanies)
        .values({ name: tenantName })
        .returning();
      company = created;
    }

    // Call brand enrichment (lazy — module may be wired during Stage 3 of this build)
    let enrichedFields: Record<string, any> = {};
    try {
      const { enrichBrandById } = await import("./brand-enrichment");
      enrichedFields = await enrichBrandById(company.id);
    } catch (err: any) {
      console.warn("[pathway stage2] brand-enrichment not available yet:", err?.message);
    }

    await setStageStatus(runId, "stage2", "completed", {
      stage2: { companyId: company.id, enrichedFields },
    });
  } catch (err: any) {
    console.error("[pathway stage2] failed:", err?.message);
    await setStageStatus(runId, "stage2", "failed", {
      stage2: { reason: err?.message || "Unknown error" },
    });
  }
}

// ============================================================================
// STAGE 3 — Detailed Search Summary (gate)
// ============================================================================

async function runStage3(runId: string, _req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  const results = run.stageResults as StageResults;

  const lines: string[] = [];
  lines.push(`**Initial Findings for ${run.address}**`);
  if (results.stage1?.initialOwnership) {
    const o = results.stage1.initialOwnership;
    lines.push(`- Owner: ${o.proprietorName || "unknown"} (title ${o.titleNumber}${o.pricePaid ? `, paid £${o.pricePaid.toLocaleString()} ${o.dateOfPurchase || ""}` : ""})`);
  }
  if (results.stage1?.tenant) lines.push(`- Tenant: ${results.stage1.tenant.name}`);
  if (results.stage1?.crmHits?.properties?.length) lines.push(`- CRM matches: ${results.stage1.crmHits.properties.length} property record(s)`);
  if (results.stage1?.emailHits?.length) lines.push(`- Emails in mailbox: ${results.stage1.emailHits.length}`);
  if (results.stage2?.enrichedFields && Object.keys(results.stage2.enrichedFields).length) {
    lines.push(`- Brand enrichment: ${Object.keys(results.stage2.enrichedFields).join(", ")}`);
  }
  lines.push("");
  lines.push("Ready to run full Property Intelligence (title registers, planning applications, floor plans, proprietor KYC)?");

  await setStageStatus(runId, "stage3", "completed", {
    stage3: { summary: lines.join("\n"), recommendProceed: true },
  });
}

// ============================================================================
// STAGE 4 — Property Intelligence
// ============================================================================

async function runStage4(runId: string, _req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await setStageStatus(runId, "stage4", "running");

  const address = run.address;
  const postcode = run.postcode || "";

  try {
    const lookup = await performPropertyLookup({ address, postcode, layers: ["core", "extended"], propertyDataLayers: ["core", "extended"] });

    const planningApplications = (lookup.planningData as any)?.applications?.slice(0, 25)?.map((a: any) => ({
      reference: a.reference || a.ref || "",
      description: a.description || a.proposal || "",
      status: a.status || a.decision || "",
      date: a.date || a.decision_date || "",
    })) || [];

    // Floor plan hints: planning apps often expose document URLs
    const floorPlanUrls: string[] = [];
    for (const app of (lookup.planningData as any)?.applications?.slice(0, 10) || []) {
      if (app.url) floorPlanUrls.push(app.url);
    }

    await setStageStatus(runId, "stage4", "completed", {
      stage4: {
        titleRegisters: [],
        planningApplications,
        floorPlanUrls,
        proprietorKyc: null,
      },
    });
  } catch (err: any) {
    console.error("[pathway stage4] failed:", err?.message);
    await setStageStatus(runId, "stage4", "failed");
  }
}

// ============================================================================
// STAGE 5 — Investigation Board ready
// ============================================================================

async function runStage5(runId: string, _req: Request): Promise<void> {
  await setStageStatus(runId, "stage5", "completed", {
    stage5: { ready: true, boardUrl: `/property-intelligence?tab=board&runId=${runId}` },
  });
}

// ============================================================================
// STAGE 6 — Studio Time (images + model)
// ============================================================================

async function runStage6(runId: string, req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await setStageStatus(runId, "stage6", "running");

  const patch: NonNullable<StageResults["stage6"]> = {};

  // 6a. Street View capture
  try {
    const svMod = await import("./image-studio").catch(() => null as any);
    if (svMod?.captureStreetViewForAddress) {
      const image = await svMod.captureStreetViewForAddress({ address: run.address, propertyId: run.propertyId });
      patch.streetViewImageId = image.id;
    }
  } catch (err: any) {
    console.warn("[pathway stage6] street view capture skipped:", err?.message);
  }

  // 6b. Retail Context Plan (custom GOAD-style overlay)
  try {
    const rcpMod = await import("./retail-context-plan").catch(() => null as any);
    if (rcpMod?.renderRetailContextPlan) {
      const image = await rcpMod.renderRetailContextPlan({ address: run.address, postcode: run.postcode || "", propertyId: run.propertyId });
      patch.retailContextImageId = image.id;
    }
  } catch (err: any) {
    console.warn("[pathway stage6] retail context plan skipped:", err?.message);
  }

  // 6c. Seed financial model — defer to /api/models API (stubbed here)
  // Will be filled in by the Excel save-back step

  await setStageStatus(runId, "stage6", "completed", { stage6: patch });
}

// ============================================================================
// STAGE 7 — Why Buy
// ============================================================================

async function runStage7(runId: string, req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await setStageStatus(runId, "stage7", "running");

  try {
    const wbMod = await import("./why-buy-renderer").catch(() => null as any);
    if (!wbMod?.renderWhyBuy) {
      await setStageStatus(runId, "stage7", "failed", {
        stage7: { documentUrl: undefined },
      });
      return;
    }
    const result = await wbMod.renderWhyBuy({ runId, req });
    await setStageStatus(runId, "stage7", "completed", {
      stage7: {
        documentUrl: result.documentUrl,
        sharepointUrl: result.sharepointUrl,
        pdfPath: result.pdfPath,
      },
    });
    await updateRun(runId, { whyBuyDocumentUrl: result.sharepointUrl || result.documentUrl, completedAt: new Date() });
  } catch (err: any) {
    console.error("[pathway stage7] failed:", err?.message);
    await setStageStatus(runId, "stage7", "failed");
  }
}

// ============================================================================
// Stage dispatcher
// ============================================================================

const STAGE_FUNCTIONS: Record<number, (runId: string, req: Request) => Promise<void>> = {
  1: runStage1,
  2: runStage2,
  3: runStage3,
  4: runStage4,
  5: runStage5,
  6: runStage6,
  7: runStage7,
};

export async function runStage(runId: string, stageNumber: number, req: Request): Promise<PropertyPathwayRun> {
  const fn = STAGE_FUNCTIONS[stageNumber];
  if (!fn) throw new Error(`No stage ${stageNumber}`);
  await fn(runId, req);
  const updated = await getRun(runId);
  if (!updated) throw new Error("Run vanished");
  return updated;
}

// ============================================================================
// Routes
// ============================================================================

export function registerPropertyPathwayRoutes(app: Express) {
  // Start a new pathway run
  app.post("/api/property-pathway/start", requireAuth, async (req: Request, res: Response) => {
    try {
      const { address, postcode, propertyId } = req.body as { address?: string; postcode?: string; propertyId?: string };
      if (!address || typeof address !== "string") {
        return res.status(400).json({ error: "address required" });
      }
      const userId = req.session.userId || req.tokenUserId || null;
      const [run] = await db
        .insert(propertyPathwayRuns)
        .values({
          address,
          postcode: postcode || null,
          propertyId: propertyId || null,
          currentStage: 1,
          stageStatus: {},
          stageResults: {},
          startedBy: userId,
        })
        .returning();
      res.json({ success: true, run });
    } catch (err: any) {
      console.error("[pathway start] error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to start pathway" });
    }
  });

  // Advance to / run a specific stage
  app.post("/api/property-pathway/:runId/advance", requireAuth, async (req: Request, res: Response) => {
    try {
      const runId = String(req.params.runId);
      const { stage } = req.body as { stage?: number };
      const run = await getRun(runId);
      if (!run) return res.status(404).json({ error: "Run not found" });
      const targetStage = stage ?? run.currentStage;
      const updated = await runStage(runId, targetStage, req);
      res.json({ success: true, run: updated });
    } catch (err: any) {
      console.error("[pathway advance] error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to advance pathway" });
    }
  });

  // Fetch current state of a run
  app.get("/api/property-pathway/:runId", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await getRun(String(req.params.runId));
      if (!run) return res.status(404).json({ error: "Run not found" });
      res.json(run);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // List recent pathway runs
  app.get("/api/property-pathway", requireAuth, async (_req: Request, res: Response) => {
    try {
      const runs = await db
        .select()
        .from(propertyPathwayRuns)
        .orderBy(desc(propertyPathwayRuns.updatedAt))
        .limit(50);
      res.json(runs);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Patch run (for manually setting tenant, propertyId, etc.)
  app.patch("/api/property-pathway/:runId", requireAuth, async (req: Request, res: Response) => {
    try {
      const runId = String(req.params.runId);
      const allowed = ["propertyId", "stageResults", "modelRunId"] as const;
      const patch: any = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) patch[key] = req.body[key];
      }
      const updated = await updateRun(runId, patch);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });
}
