// ─────────────────────────────────────────────────────────────────────────
// Brand dedupe — scans crm_companies for probable duplicates, asks Claude
// Haiku to judge the ambiguous pairs, and provides merge / undo endpoints.
//
// Flow:
//   POST /api/brand/dedupe/scan            — generate candidate clusters
//   GET  /api/brand/dedupe/candidates      — list pending candidates
//   POST /api/brand/dedupe/merge           — merge secondary into primary
//   POST /api/brand/dedupe/candidates/:id/dismiss — mark "not a dupe"
//   POST /api/brand/dedupe/undo/:mergeId   — reverse a merge (best-effort)
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "./auth";
import { pool } from "./db";

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const HELPER_MODEL = "claude-haiku-4-5-20251001";

// Every table+column that points at crm_companies.id. Merge rewrites
// each of these to the primary id.
const COMPANY_REFS: Array<{ table: string; column: string }> = [
  { table: "crm_companies",            column: "parent_company_id" },
  { table: "crm_companies",            column: "brand_group_id" },
  { table: "crm_contacts",             column: "company_id" },
  { table: "crm_deals",                column: "landlord_id" },
  { table: "crm_deals",                column: "tenant_id" },
  { table: "crm_deals",                column: "vendor_id" },
  { table: "crm_deals",                column: "purchaser_id" },
  { table: "crm_deals",                column: "vendor_agent_id" },
  { table: "crm_deals",                column: "acquisition_agent_id" },
  { table: "crm_deals",                column: "purchaser_agent_id" },
  { table: "crm_deals",                column: "leasing_agent_id" },
  { table: "crm_properties",           column: "landlord_id" },
  { table: "crm_requirements_leasing", column: "company_id" },
  { table: "crm_comps",                column: "company_id" },
  { table: "kyc_documents",            column: "company_id" },
  { table: "kyc_investigations",       column: "crm_company_id" },
  { table: "veriff_sessions",          column: "company_id" },
  { table: "aml_recheck_reminders",    column: "company_id" },
  { table: "brand_agent_representations", column: "brand_company_id" },
  { table: "brand_agent_representations", column: "agent_company_id" },
  { table: "brand_signals",            column: "brand_company_id" },
];

// Legal-form suffixes stripped for name normalisation
const NORMALISE_SUFFIXES = [
  "ltd", "limited", "plc", "llp", "lp", "inc", "incorporated",
  "corp", "corporation", "group", "holdings", "holding", "uk",
  "uk ltd", "gmbh", "sa", "sl", "bv", "ag", "ag & co", "pte",
  "company", "co", "the",
];

function normaliseName(raw: string): string {
  let n = (raw || "")
    .toLowerCase()
    .replace(/['’`.,()&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Strip trailing legal suffixes (iteratively — e.g. "Zara UK Ltd")
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of NORMALISE_SUFFIXES) {
      if (n.endsWith(` ${suf}`)) {
        n = n.slice(0, -suf.length).trim();
        changed = true;
      }
    }
  }
  return n;
}

// ─── Scan ────────────────────────────────────────────────────────────────
router.post("/api/brand/dedupe/scan", requireAuth, async (req: Request, res: Response) => {
  try {
    const useAI = req.body?.useAI !== false; // default true
    const { rows } = await pool.query(
      `SELECT id, name, companies_house_number, domain
         FROM crm_companies
        WHERE merged_into_id IS NULL
          AND name IS NOT NULL AND name <> ''`
    );

    // Cluster by companies_house_number first (exact) — these are definite.
    const chClusters = new Map<string, Array<any>>();
    const nameClusters = new Map<string, Array<any>>();
    const domainClusters = new Map<string, Array<any>>();

    for (const r of rows) {
      if (r.companies_house_number && r.companies_house_number.trim()) {
        const k = r.companies_house_number.trim().toUpperCase();
        if (!chClusters.has(k)) chClusters.set(k, []);
        chClusters.get(k)!.push(r);
      }
      const nk = normaliseName(r.name);
      if (nk && nk.length >= 3) {
        if (!nameClusters.has(nk)) nameClusters.set(nk, []);
        nameClusters.get(nk)!.push(r);
      }
      if (r.domain && r.domain.trim()) {
        const dk = r.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase().trim();
        if (dk) {
          if (!domainClusters.has(dk)) domainClusters.set(dk, []);
          domainClusters.get(dk)!.push(r);
        }
      }
    }

    type Candidate = {
      clusterKey: string;
      companies: Array<any>;
      reason: string;
      needsAI: boolean;
    };
    const candidates: Candidate[] = [];

    for (const [k, list] of chClusters) {
      if (list.length > 1) candidates.push({ clusterKey: `ch:${k}`, companies: list, reason: `Same Companies House number (${k})`, needsAI: false });
    }
    for (const [k, list] of domainClusters) {
      if (list.length > 1) {
        // Only add if not already captured by CH match
        const idSet = new Set(list.map(c => c.id));
        const alreadyCovered = candidates.some(c => c.companies.every(x => idSet.has(x.id)));
        if (!alreadyCovered) candidates.push({ clusterKey: `domain:${k}`, companies: list, reason: `Same domain (${k})`, needsAI: false });
      }
    }
    for (const [k, list] of nameClusters) {
      if (list.length > 1) {
        const idSet = new Set(list.map(c => c.id));
        const alreadyCovered = candidates.some(c => c.companies.every(x => idSet.has(x.id)));
        if (!alreadyCovered) candidates.push({ clusterKey: `name:${k}`, companies: list, reason: `Similar normalised name ("${k}")`, needsAI: true });
      }
    }

    // AI judge the fuzzy name-only clusters (cap to protect budget)
    const MAX_AI = 40;
    let aiCalls = 0;
    for (const c of candidates) {
      if (!c.needsAI || !useAI) continue;
      if (aiCalls >= MAX_AI) break;
      aiCalls++;
      try {
        const prompt = `You are deduping a UK property CRM. Decide if these ${c.companies.length} companies are the SAME legal/trading entity.

Companies:
${c.companies.map((x, i) => `${i + 1}. "${x.name}"${x.companies_house_number ? ` (CH ${x.companies_house_number})` : ""}${x.domain ? ` [${x.domain}]` : ""}`).join("\n")}

Output JSON only: {"verdict": "duplicate" | "same_group_different_entities" | "unrelated", "confidence": 0.0-1.0, "note": "..."}`;
        const msg = await anthropic.messages.create({
          model: HELPER_MODEL,
          max_tokens: 200,
          messages: [{ role: "user", content: prompt }],
        });
        const txt = msg.content.map((b: any) => b.type === "text" ? b.text : "").join("");
        const match = txt.match(/\{[\s\S]*\}/);
        if (match) {
          const j = JSON.parse(match[0]);
          (c as any).aiVerdict = j.verdict;
          (c as any).aiConfidence = Number(j.confidence) || null;
          (c as any).aiNote = j.note || null;
        }
      } catch (e) {
        // AI failed — leave pending, user decides
      }
    }

    // Wipe previous pending candidates and insert new ones
    await pool.query("DELETE FROM dedupe_candidates WHERE status = 'pending'");
    let inserted = 0;
    for (const c of candidates) {
      const verdict = (c as any).aiVerdict;
      // Drop the clearly-unrelated ones so the review queue stays actionable
      if (verdict === "unrelated" && (c as any).aiConfidence >= 0.7) continue;
      await pool.query(
        `INSERT INTO dedupe_candidates (cluster_key, company_ids, reason, ai_verdict, ai_confidence, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [c.clusterKey, c.companies.map(x => x.id), c.reason, verdict || null, (c as any).aiConfidence || null]
      );
      inserted++;
    }

    res.json({
      scanned: rows.length,
      clustersFound: candidates.length,
      candidatesInserted: inserted,
      aiCalls,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── List pending candidates ────────────────────────────────────────────
router.get("/api/brand/dedupe/candidates", requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows: cands } = await pool.query(
      `SELECT id, cluster_key, company_ids, reason, ai_verdict, ai_confidence, status, created_at
         FROM dedupe_candidates
        WHERE status = 'pending'
        ORDER BY
          CASE WHEN ai_verdict = 'duplicate' THEN 0
               WHEN ai_verdict IS NULL       THEN 1
               ELSE 2 END,
          ai_confidence DESC NULLS LAST,
          created_at DESC`
    );

    // Hydrate company details for each cluster
    const allIds = Array.from(new Set(cands.flatMap(c => c.company_ids || [])));
    if (allIds.length === 0) return res.json({ candidates: [] });

    const { rows: companies } = await pool.query(
      `SELECT c.id, c.name, c.companies_house_number, c.domain, c.company_type,
              c.description, c.created_at,
              (SELECT COUNT(*)::int FROM crm_contacts  WHERE company_id = c.id) AS contact_count,
              (SELECT COUNT(*)::int FROM crm_deals     WHERE landlord_id = c.id OR tenant_id = c.id OR vendor_id = c.id OR purchaser_id = c.id) AS deal_count,
              (SELECT COUNT(*)::int FROM kyc_documents WHERE company_id = c.id AND deleted_at IS NULL) AS kyc_doc_count
         FROM crm_companies c
        WHERE c.id = ANY($1::text[])`,
      [allIds]
    );
    const byId = new Map(companies.map(c => [c.id, c]));

    const enriched = cands.map(c => ({
      id: c.id,
      clusterKey: c.cluster_key,
      reason: c.reason,
      aiVerdict: c.ai_verdict,
      aiConfidence: c.ai_confidence,
      createdAt: c.created_at,
      companies: (c.company_ids || []).map((id: string) => byId.get(id)).filter(Boolean),
    })).filter(c => c.companies.length >= 2);

    res.json({ candidates: enriched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Merge two companies (secondary → primary) ──────────────────────────
router.post("/api/brand/dedupe/merge", requireAuth, async (req: Request, res: Response) => {
  const { primaryId, secondaryId, candidateId, notes } = req.body || {};
  if (!primaryId || !secondaryId || primaryId === secondaryId) {
    return res.status(400).json({ error: "primaryId and secondaryId required and must differ" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Snapshot secondary for undo
    const secSnap = await client.query("SELECT * FROM crm_companies WHERE id = $1 FOR UPDATE", [secondaryId]);
    if (!secSnap.rows[0]) throw new Error("Secondary company not found");
    const primCheck = await client.query("SELECT id FROM crm_companies WHERE id = $1 AND merged_into_id IS NULL FOR UPDATE", [primaryId]);
    if (!primCheck.rows[0]) throw new Error("Primary company not found or already merged");

    // Copy fields from secondary to primary where primary is null — prefer
    // to keep primary's data but fill any gaps.
    const FILLABLE = [
      "companies_house_number", "domain", "domain_url", "description",
      "head_office_address", "phone", "linkedin_url", "industry",
      "employee_count", "annual_revenue", "founded_year",
      "concept_pitch", "store_count", "rollout_status", "backers",
      "instagram_handle",
    ];
    const fillSet: string[] = [];
    const fillVals: any[] = [];
    for (const col of FILLABLE) {
      fillSet.push(`${col} = COALESCE(p.${col}, s.${col})`);
    }
    await client.query(
      `UPDATE crm_companies p
          SET ${fillSet.join(", ")},
              updated_at = now()
         FROM crm_companies s
        WHERE p.id = $1 AND s.id = $2`,
      [primaryId, secondaryId]
    );

    // Rewrite every FK reference
    const referenceUpdates: Record<string, number> = {};
    for (const ref of COMPANY_REFS) {
      // Self-ref on crm_companies is the merge target itself — skip those rows
      const sql = ref.table === "crm_companies"
        ? `UPDATE ${ref.table} SET ${ref.column} = $1 WHERE ${ref.column} = $2 AND id <> $2`
        : `UPDATE ${ref.table} SET ${ref.column} = $1 WHERE ${ref.column} = $2`;
      const r = await client.query(sql, [primaryId, secondaryId]);
      if (r.rowCount) referenceUpdates[`${ref.table}.${ref.column}`] = r.rowCount;
    }

    // Soft-delete the secondary — it stays in the table so old URLs and
    // imports don't orphan, but it's hidden from queries that filter out
    // merged_into_id.
    await client.query(
      `UPDATE crm_companies SET merged_into_id = $1, merged_at = now(), merged_by = $2 WHERE id = $3`,
      [primaryId, (req as any).user?.email || (req as any).user?.name || "unknown", secondaryId]
    );

    // Record the merge for undo
    const mergeRes = await client.query(
      `INSERT INTO dedupe_merges (primary_id, secondary_id, merged_by, secondary_snapshot, reference_updates, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [primaryId, secondaryId, (req as any).user?.email || (req as any).user?.name || "unknown", secSnap.rows[0], referenceUpdates, notes || null]
    );

    if (candidateId) {
      await client.query(
        `UPDATE dedupe_candidates SET status = 'merged', reviewed_by = $1, reviewed_at = now() WHERE id = $2`,
        [(req as any).user?.email || "unknown", candidateId]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true, mergeId: mergeRes.rows[0].id, referenceUpdates });
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── Dismiss a candidate ("not a dupe") ─────────────────────────────────
router.post("/api/brand/dedupe/candidates/:id/dismiss", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user?.email || "unknown";
    await pool.query(
      `UPDATE dedupe_candidates SET status = 'dismissed', reviewed_by = $1, reviewed_at = now() WHERE id = $2`,
      [user, req.params.id]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Undo a merge (best effort — reverses FK rewrites + un-soft-deletes) ─
router.post("/api/brand/dedupe/undo/:mergeId", requireAuth, async (req: Request, res: Response) => {
  const { mergeId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM dedupe_merges WHERE id = $1 FOR UPDATE", [mergeId]);
    if (!rows[0]) throw new Error("Merge record not found");
    const m = rows[0];

    // Reverse FK rewrites — but we can't distinguish which rows we changed
    // from rows that already pointed at primary. Best effort: if the secondary
    // snapshot had that FK pointing somewhere, we won't know. So we flip
    // everything from primary back to secondary; this can over-flip.
    // Warn the user in the UI that undo may affect unrelated rows.
    const referenceUpdates: Record<string, number> = {};
    for (const ref of COMPANY_REFS) {
      const sql = ref.table === "crm_companies"
        ? `UPDATE ${ref.table} SET ${ref.column} = $1 WHERE ${ref.column} = $2 AND id <> $2`
        : `UPDATE ${ref.table} SET ${ref.column} = $1 WHERE ${ref.column} = $2`;
      const r = await client.query(sql, [m.secondary_id, m.primary_id]);
      if (r.rowCount) referenceUpdates[`${ref.table}.${ref.column}`] = r.rowCount;
    }

    // Un-soft-delete the secondary
    await client.query(
      `UPDATE crm_companies SET merged_into_id = NULL, merged_at = NULL, merged_by = NULL WHERE id = $1`,
      [m.secondary_id]
    );

    await client.query("DELETE FROM dedupe_merges WHERE id = $1", [mergeId]);
    await client.query("COMMIT");
    res.json({ ok: true, referenceUpdates });
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── Recent merges (for undo UI) ────────────────────────────────────────
router.get("/api/brand/dedupe/merges", requireAuth, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.primary_id, m.secondary_id, m.merged_by, m.merged_at, m.notes,
              p.name AS primary_name, s.name AS secondary_name
         FROM dedupe_merges m
         LEFT JOIN crm_companies p ON p.id = m.primary_id
         LEFT JOIN crm_companies s ON s.id = m.secondary_id
        ORDER BY m.merged_at DESC
        LIMIT 100`
    );
    res.json({ merges: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
