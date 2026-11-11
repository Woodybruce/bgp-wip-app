// Landsec brand case (docs/landsec-pitch-plan.md, item 5): one portfolio
// case per rollout brand — the UK evidence (store photos, video, links),
// a covenant summary, the proposed Landsec units — sent to every asset
// manager, who each record seen / supportive / concerns / wants a store
// visit. BGP writes the case; Landsec logins read it and respond.
import type { Express, Request } from "express";
import multer from "multer";
import * as path from "path";
import { randomUUID } from "crypto";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { resolveCompanyScope, isClientRequestUser } from "./company-scope";
import { saveFile, getFile, deleteFile } from "./file-storage";
import { landsecCompanyId, isLandsecCompany, resolveLandsecPortfolio, LANDSEC_SCHEMES } from "./landsec-schemes";
import { LANDSEC_CASE_RESPONSES, type LandsecCaseEvidence, type LandsecCaseUnit } from "@shared/landsec";

const PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mov", ".pdf"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!PHOTO_EXTS.has(path.extname(file.originalname).toLowerCase())) return cb(new Error("Photos, videos (mp4/mov) and PDFs only"));
    cb(null, true);
  },
});

async function landsecScope(req: Request): Promise<{ companyId: string; isClient: boolean } | null> {
  const scope = await resolveCompanyScope(req);
  if (scope) return (await isLandsecCompany(scope)) ? { companyId: scope, isClient: await isClientRequestUser(req) } : null;
  const companyId = await landsecCompanyId();
  return companyId ? { companyId, isClient: false } : null;
}

async function currentUser(req: Request): Promise<{ id: string | null; name: string | null; role: string | null; team: string | null }> {
  const id = req.session?.userId || (req as any).tokenUserId || null;
  if (!id) return { id: null, name: null, role: null, team: null };
  const r = (await pool.query(`SELECT name, email, role, team FROM users WHERE id = $1`, [id])).rows[0];
  return { id, name: r?.name || r?.email || null, role: r?.role || null, team: r?.team || null };
}

function caseOf(r: any, responses: any[], isClient: boolean) {
  const tally: Record<string, number> = { seen: 0, supportive: 0, concerns: 0, visit: 0 };
  for (const x of responses) if (x.response in tally) tally[x.response] += 1;
  return {
    id: r.id, companyId: r.company_id, headline: r.headline, ukStory: r.uk_story, covenantSummary: r.covenant_summary,
    evidence: (Array.isArray(r.evidence) ? r.evidence : []) as LandsecCaseEvidence[],
    proposedUnits: (Array.isArray(r.proposed_units) ? r.proposed_units : []) as LandsecCaseUnit[],
    status: r.status, sentAt: r.sent_at, updatedAt: r.updated_at, updatedByName: r.updated_by_name,
    brand: { name: r.brand_name, logoUrl: r.logo_url, website: r.website || r.domain_url, companyType: r.company_type, description: r.description,
      conceptPitch: r.concept_pitch, storeCount: r.store_count, rolloutStatus: r.rollout_status, backers: r.backers, ukEntityName: r.uk_entity_name,
      companiesHouseNumber: r.companies_house_number, kycStatus: isClient ? undefined : r.kyc_status, amlRiskLevel: isClient ? undefined : r.aml_risk_level },
    responses: responses.map((x: any) => ({ id: x.id, userId: x.user_id, userName: x.user_name, userRole: x.user_role, response: x.response, note: x.note, at: x.updated_at || x.created_at })),
    tally,
  };
}

const CASE_SELECT = `SELECT bc.*, c.name AS brand_name, c.logo_url, c.website, c.domain_url, c.company_type, c.description, c.concept_pitch, c.store_count,
                            c.rollout_status, c.backers, c.uk_entity_name, c.companies_house_number, c.kyc_status, c.aml_risk_level
                       FROM landsec_brand_cases bc JOIN crm_companies c ON c.id = bc.company_id`;

export function setupLandsecBrandCaseRoutes(app: Express) {
  app.get("/api/landsec/brand-cases", requireAuth, async (req, res) => {
    try {
      const scope = await landsecScope(req);
      if (!scope) return res.status(403).json({ error: "Not available for this account" });
      const cases = await pool.query(`${CASE_SELECT} ORDER BY bc.updated_at DESC NULLS LAST`);
      const ids = cases.rows.map((r: any) => r.id);
      const responses = ids.length ? (await pool.query(`SELECT * FROM landsec_brand_case_responses WHERE case_id = ANY($1) ORDER BY updated_at DESC`, [ids])).rows : [];
      const me = await currentUser(req);
      res.json({
        cases: cases.rows.map((r: any) => {
          const c = caseOf(r, responses.filter((x: any) => x.case_id === r.id), scope.isClient);
          return { ...c, responses: undefined, myResponse: c.responses.find(x => x.userId === me.id)?.response || null, responseCount: c.responses.length };
        }),
      });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed to load brand cases" }); }
  });

  app.get("/api/landsec/brand-case/:companyId", requireAuth, async (req, res) => {
    try {
      const scope = await landsecScope(req);
      if (!scope) return res.status(403).json({ error: "Not available for this account" });
      const companyId = String(req.params.companyId);
      const r = (await pool.query(`${CASE_SELECT} WHERE bc.company_id = $1`, [companyId])).rows[0];
      if (!r) {
        const brand = (await pool.query(`SELECT id, name, logo_url FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
        if (!brand) return res.status(404).json({ error: "Brand not found" });
        return res.json({ case: null, brand: { id: brand.id, name: brand.name, logoUrl: brand.logo_url }, canEdit: !scope.isClient, schemes: LANDSEC_SCHEMES.map(s => ({ key: s.key, name: s.name })) });
      }
      const responses = (await pool.query(`SELECT * FROM landsec_brand_case_responses WHERE case_id = $1 ORDER BY updated_at DESC`, [r.id])).rows;
      const me = await currentUser(req);
      const c = caseOf(r, responses, scope.isClient);
      // Resolve the proposed units' scheme names and current status.
      const portfolio = await resolveLandsecPortfolio(scope.companyId);
      const unitIds = c.proposedUnits.map(u => u.tenancyUnitId).filter(Boolean) as string[];
      const units = unitIds.length ? (await pool.query(`SELECT id, premises, unit_number, status, tenant_name FROM tenancy_schedule_units WHERE id = ANY($1)`, [unitIds])).rows : [];
      const proposedUnits = c.proposedUnits.map(u => {
        const sch = portfolio.schemes.find(s => s.key === u.schemeKey);
        const t = units.find((x: any) => x.id === u.tenancyUnitId);
        return { ...u, schemeName: sch?.name || u.schemeKey, unitLabel: u.unitLabel || t?.premises || t?.unit_number || "", unitStatus: t?.status || null, unitTenant: t?.tenant_name || null };
      });
      res.json({
        case: { ...c, proposedUnits },
        brand: { id: companyId, name: r.brand_name, logoUrl: r.logo_url },
        myResponse: c.responses.find(x => x.userId === me.id) || null,
        canEdit: !scope.isClient,
        schemes: LANDSEC_SCHEMES.map(s => ({ key: s.key, name: s.name })),
      });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed to load the brand case" }); }
  });

  // Create or update the case's content (BGP only).
  app.put("/api/landsec/brand-case/:companyId", requireAuth, async (req, res) => {
    try {
      const scope = await landsecScope(req);
      if (!scope || scope.isClient) return res.status(403).json({ error: "BGP staff write the brand case" });
      const companyId = String(req.params.companyId);
      const brand = (await pool.query(`SELECT id FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
      if (!brand) return res.status(404).json({ error: "Brand not found" });
      const b = req.body || {};
      const me = await currentUser(req);
      const txt = (v: any) => (v === undefined ? undefined : v === null || v === "" ? null : String(v));
      const units: LandsecCaseUnit[] | undefined = Array.isArray(b.proposedUnits)
        ? b.proposedUnits.map((u: any) => ({ id: String(u.id || randomUUID()), schemeKey: String(u.schemeKey || ""), tenancyUnitId: u.tenancyUnitId ? String(u.tenancyUnitId) : null, unitLabel: String(u.unitLabel || ""), note: txt(u.note) ?? null, status: txt(u.status) ?? null })).filter((u: LandsecCaseUnit) => u.schemeKey)
        : undefined;
      const links: LandsecCaseEvidence[] | undefined = Array.isArray(b.links)
        ? b.links.map((l: any) => ({ id: String(l.id || randomUUID()), kind: (l.kind === "video" ? "video" : "link") as "video" | "link", url: String(l.url || ""), caption: txt(l.caption) ?? null })).filter((l: LandsecCaseEvidence) => /^https?:\/\//i.test(l.url))
        : undefined;
      const existing = (await pool.query(`SELECT evidence, status FROM landsec_brand_cases WHERE company_id = $1`, [companyId])).rows[0];
      let evidence: LandsecCaseEvidence[] = Array.isArray(existing?.evidence) ? existing.evidence : [];
      if (links) evidence = [...evidence.filter(e => e.kind === "photo" || e.kind === "file"), ...links];
      const status = b.status === "sent" ? "sent" : b.status === "draft" ? "draft" : undefined;
      await pool.query(
        `INSERT INTO landsec_brand_cases (company_id, headline, uk_story, covenant_summary, evidence, proposed_units, status, sent_at, created_by, created_by_name, updated_by, updated_by_name, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, COALESCE($7, 'draft'), CASE WHEN $7 = 'sent' THEN NOW() ELSE NULL END, $8, $9, $8, $9, NOW())
         ON CONFLICT (company_id) DO UPDATE SET
           headline = CASE WHEN $10::boolean THEN EXCLUDED.headline ELSE landsec_brand_cases.headline END,
           uk_story = CASE WHEN $11::boolean THEN EXCLUDED.uk_story ELSE landsec_brand_cases.uk_story END,
           covenant_summary = CASE WHEN $12::boolean THEN EXCLUDED.covenant_summary ELSE landsec_brand_cases.covenant_summary END,
           evidence = CASE WHEN $13::boolean THEN EXCLUDED.evidence ELSE landsec_brand_cases.evidence END,
           proposed_units = CASE WHEN $14::boolean THEN EXCLUDED.proposed_units ELSE landsec_brand_cases.proposed_units END,
           status = COALESCE($7, landsec_brand_cases.status),
           sent_at = CASE WHEN $7 = 'sent' AND landsec_brand_cases.sent_at IS NULL THEN NOW() WHEN $7 = 'draft' THEN NULL ELSE landsec_brand_cases.sent_at END,
           updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name, updated_at = NOW()`,
        [companyId, txt(b.headline) ?? null, txt(b.ukStory) ?? null, txt(b.covenantSummary) ?? null, JSON.stringify(evidence), JSON.stringify(units || []),
         status ?? null, me.id, me.name,
         "headline" in b, "ukStory" in b, "covenantSummary" in b, !!links, !!units]
      );
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed to save the brand case" }); }
  });

  // Photo / video / PDF evidence (BGP only).
  app.post("/api/landsec/brand-case/:companyId/evidence", requireAuth, upload.single("file"), async (req: any, res) => {
    try {
      const scope = await landsecScope(req);
      if (!scope || scope.isClient) return res.status(403).json({ error: "BGP staff write the brand case" });
      if (!req.file) return res.status(400).json({ error: "No file" });
      const companyId = String(req.params.companyId);
      const row = (await pool.query(`SELECT id, evidence FROM landsec_brand_cases WHERE company_id = $1`, [companyId])).rows[0];
      if (!row) return res.status(400).json({ error: "Write the case before adding evidence" });
      const ext = path.extname(req.file.originalname).toLowerCase();
      const key = `landsec-brand-case/${randomUUID()}${ext}`;
      await saveFile(key, req.file.buffer, req.file.mimetype, req.file.originalname);
      const kind: LandsecCaseEvidence["kind"] = /^image\//.test(req.file.mimetype) ? "photo" : /^video\//.test(req.file.mimetype) ? "video" : "file";
      const item: LandsecCaseEvidence = { id: randomUUID(), kind, url: `/uploads/${key}`, caption: req.body?.caption ? String(req.body.caption) : req.file.originalname, fileKey: key, mimeType: req.file.mimetype };
      const evidence = [...(Array.isArray(row.evidence) ? row.evidence : []), item];
      await pool.query(`UPDATE landsec_brand_cases SET evidence = $2::jsonb, updated_at = NOW() WHERE id = $1`, [row.id, JSON.stringify(evidence)]);
      res.json({ ok: true, item });
    } catch (e: any) { res.status(400).json({ error: e?.message || "Upload failed" }); }
  });

  app.delete("/api/landsec/brand-case/:companyId/evidence/:itemId", requireAuth, async (req, res) => {
    try {
      const scope = await landsecScope(req);
      if (!scope || scope.isClient) return res.status(403).json({ error: "BGP staff write the brand case" });
      const row = (await pool.query(`SELECT id, evidence FROM landsec_brand_cases WHERE company_id = $1`, [String(req.params.companyId)])).rows[0];
      if (!row) return res.status(404).json({ error: "No case" });
      const evidence: LandsecCaseEvidence[] = Array.isArray(row.evidence) ? row.evidence : [];
      const gone = evidence.find(e => e.id === String(req.params.itemId));
      if (gone?.fileKey) await deleteFile(gone.fileKey).catch(() => undefined);
      await pool.query(`UPDATE landsec_brand_cases SET evidence = $2::jsonb, updated_at = NOW() WHERE id = $1`, [row.id, JSON.stringify(evidence.filter(e => e.id !== String(req.params.itemId)))]);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed" }); }
  });

  app.get("/uploads/landsec-brand-case/:filename", requireAuth, async (req, res) => {
    try {
      const scope = await landsecScope(req);
      if (!scope) return res.status(403).end();
      const file = await getFile(`landsec-brand-case/${path.basename(String(req.params.filename))}`);
      if (!file) return res.status(404).end();
      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.originalName || "file")}"`);
      res.send(file.data);
    } catch { res.status(500).end(); }
  });

  // An asset manager's (or anyone's) response — one per person per case.
  app.post("/api/landsec/brand-case/:companyId/respond", requireAuth, async (req, res) => {
    try {
      const scope = await landsecScope(req);
      if (!scope) return res.status(403).json({ error: "Not available for this account" });
      const row = (await pool.query(`SELECT id FROM landsec_brand_cases WHERE company_id = $1`, [String(req.params.companyId)])).rows[0];
      if (!row) return res.status(404).json({ error: "No case to respond to" });
      const response = String(req.body?.response || "");
      if (!LANDSEC_CASE_RESPONSES.some(r => r.key === response)) return res.status(400).json({ error: "response must be seen, supportive, concerns or visit" });
      const me = await currentUser(req);
      if (!me.id) return res.status(401).json({ error: "Not signed in" });
      const role = req.body?.role ? String(req.body.role) : (scope.isClient ? "Landsec" : `BGP · ${me.team || ""}`.trim());
      await pool.query(
        `INSERT INTO landsec_brand_case_responses (case_id, user_id, user_name, user_role, response, note, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (case_id, user_id) DO UPDATE SET response = EXCLUDED.response, note = COALESCE(EXCLUDED.note, landsec_brand_case_responses.note),
           user_name = EXCLUDED.user_name, user_role = COALESCE(EXCLUDED.user_role, landsec_brand_case_responses.user_role), updated_at = NOW()`,
        [row.id, me.id, me.name, role, response, req.body?.note ? String(req.body.note) : null]
      );
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e?.message || "Failed to record the response" }); }
  });
}
