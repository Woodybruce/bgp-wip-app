// Account reconciliation (Delivery 2, Task 5) — check an account's CRM
// portfolio against an official destination baseline (seeded per company
// from server/reconciliation-baselines.ts).
//
// Matching uses the same strict rules as Task 3's property linking:
// exact normalised-name match, then exact postcode (baseline rows carry
// no postcode today, so the name rule is what fires). Legitimate grouped
// destinations ("Bullring & Grand Central" — one official row, two CRM
// properties) match via official_group_key: each "&"-part matches its own
// CRM property and the row is only 'matched' when every part resolves.
// Ambiguous or absent matches are never guessed — the row's
// unresolved_differences explains why. Extra CRM properties that match no
// baseline row append as 'extra_in_crm' rows: reconciliation is symmetric.
//
// The report never writes to permission tables and never feeds
// isPropertyInScope — the route is staff-only, so for client logins the
// report simply does not exist.

import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { resolveAccountView, type AccountProperty, type AccountView, type Querier } from "./account-resolver";
import { normalisePropertyName } from "./landlord-scraper";
import { HAMMERSON_BASELINE_NAME, RECONCILIATION_BASELINES, defaultBaselineForCompany } from "./reconciliation-baselines";

export { HAMMERSON_BASELINE_NAME };

async function defaultPool(): Promise<Querier> {
  const { pool } = await import("./db");
  return pool;
}

export interface BaselineRow {
  destination_name: string;
  official_group_key: string | null;
  expected_crm_property_count: number;
  category: string;               // destination | development | disposed
  country: string | null;
  source_url: string | null;
  source_date: string | null;
}

export interface ReconciliationRow {
  destination_name: string;
  source_url: string | null;
  source_date: string | null;
  country: string | null;
  category: string | null;
  relationship_role: string | null;
  ownership_stake_pct: number | null;
  crm_property_ids: string[];
  owning_entity_names: string[];
  bgp_instruction: boolean;
  media_count: number;
  status: "matched" | "partial" | "unresolved" | "extra_in_crm";
  unresolved_differences: string[];
}

// Staff-only guard, kept as a pure helper so the access rule is testable
// without the wire: any resolved client scope refuses. The report cannot
// change client access because it never exists for client logins.
export function reconciliationDeniedForScope(scopeCompanyId: string | null): boolean {
  return scopeCompanyId != null;
}

const ROLE_RANK = ["owner", "jv", "manager", "unknown"];

// Match one baseline row against the account portfolio. Grouped rows split
// on "&" and match each part by exact normalised name (or a word-boundary
// prefix, so "Bullring" matches "Bullring Birmingham"); standalone rows
// match by exact normalised name. `used` is mutated so one CRM property
// can't satisfy two baseline rows — no double counting.
function matchBaselineRow(
  b: BaselineRow,
  properties: AccountProperty[],
  used: Set<string>,
): { matched: AccountProperty[]; differences: string[] } {
  const available = properties.filter(p => !used.has(p.propertyId));
  const differences: string[] = [];

  if (b.official_group_key) {
    const parts = b.destination_name.split(/\s*&\s*/).map(normalisePropertyName).filter(Boolean);
    const matched: AccountProperty[] = [];
    for (const part of parts) {
      const candidates = available.filter(p => {
        const n = normalisePropertyName(p.name);
        return !matched.includes(p) && (n === part || n.startsWith(part + " "));
      });
      if (candidates.length === 1) {
        matched.push(candidates[0]);
      } else if (candidates.length > 1) {
        differences.push(`"${part}" matches ${candidates.length} CRM properties — ambiguous, not guessed`);
      } else {
        differences.push(`"${part}" not found in the CRM portfolio`);
      }
    }
    if (matched.length !== b.expected_crm_property_count) {
      differences.push(`expected ${b.expected_crm_property_count} CRM properties for this grouped destination, matched ${matched.length}`);
    }
    for (const p of matched) used.add(p.propertyId);
    return { matched, differences };
  }

  const nameKey = normalisePropertyName(b.destination_name);
  const nameMatches = available.filter(p => normalisePropertyName(p.name) === nameKey);
  if (nameMatches.length > 1) {
    return { matched: [], differences: [`name matches ${nameMatches.length} CRM properties — ambiguous, not guessed`] };
  }
  const matched = nameMatches;
  if (matched.length === 0) {
    differences.push("not found in the CRM portfolio (exact name match)");
  } else if (matched.length !== b.expected_crm_property_count) {
    differences.push(`expected ${b.expected_crm_property_count} CRM properties, matched ${matched.length}`);
  }
  for (const p of matched) used.add(p.propertyId);
  return { matched, differences };
}

// Pure reconciliation: baseline rows × account view → report rows.
export function reconcileBaseline(
  baselines: BaselineRow[],
  view: Pick<AccountView, "properties" | "instructions" | "entities">,
  mediaCounts: Map<string, number>,
): ReconciliationRow[] {
  const instructionPropertyIds = new Set(
    view.instructions.map(i => i.propertyId).filter(Boolean) as string[]
  );
  const entityNames = new Map(view.entities.map(e => [e.companyId, e.name]));
  const used = new Set<string>();

  const rows: ReconciliationRow[] = baselines.map(b => {
    const { matched, differences } = matchBaselineRow(b, view.properties, used);
    const status: ReconciliationRow["status"] =
      matched.length === b.expected_crm_property_count ? "matched"
      : matched.length > 0 ? "partial"
      : "unresolved";
    const roles = matched.map(p => p.relationshipRole);
    return {
      destination_name: b.destination_name,
      source_url: b.source_url,
      source_date: b.source_date,
      country: b.country,
      category: b.category,
      relationship_role: roles.length ? ROLE_RANK.find(r => roles.includes(r as any))! : null,
      ownership_stake_pct: matched.find(p => p.ownershipStakePct != null)?.ownershipStakePct ?? null,
      crm_property_ids: matched.map(p => p.propertyId),
      owning_entity_names: [...new Set(matched.map(p => p.owningEntityId && entityNames.get(p.owningEntityId)).filter(Boolean))] as string[],
      bgp_instruction: matched.some(p => instructionPropertyIds.has(p.propertyId)),
      media_count: matched.reduce((n, p) => n + (mediaCounts.get(p.propertyId) ?? 0), 0),
      status,
      unresolved_differences: status === "matched" ? [] : differences,
    };
  });

  // Symmetric: portfolio properties no baseline row claimed.
  for (const p of view.properties) {
    if (used.has(p.propertyId)) continue;
    rows.push({
      destination_name: p.name,
      source_url: null,
      source_date: null,
      country: p.country,
      category: null,
      relationship_role: p.relationshipRole,
      ownership_stake_pct: p.ownershipStakePct,
      crm_property_ids: [p.propertyId],
      owning_entity_names: p.owningEntityId && entityNames.get(p.owningEntityId) ? [entityNames.get(p.owningEntityId)!] : [],
      bgp_instruction: instructionPropertyIds.has(p.propertyId),
      media_count: mediaCounts.get(p.propertyId) ?? 0,
      status: "extra_in_crm",
      unresolved_differences: ["in the CRM portfolio but not on the official baseline"],
    });
  }

  return rows;
}

// The acceptance gate: every official DESTINATION accounted for.
// Development and disposed rows report in their own categories and don't
// count against the gate.
export function destinationGatePassed(rows: ReconciliationRow[]): boolean {
  return rows
    .filter(r => r.category === "destination")
    .every(r => r.status === "matched");
}

// Seed an account's official baseline on first use. Rows key off
// company_id, which no migration can know — and each seed is only
// meaningful for its own account, so companies matching no registered
// baseline get nothing. Returns the baseline row count after the call.
export async function ensureBaselineSeeded(
  q: Querier,
  companyId: string,
  baselineName: string,
  companyName: string,
): Promise<number> {
  const { rows } = await q.query(
    `SELECT COUNT(*)::int AS n FROM account_reconciliation_baselines WHERE company_id = $1 AND baseline_name = $2`,
    [companyId, baselineName]
  );
  const existing = rows[0]?.n ?? 0;
  if (existing > 0) return existing;
  const def = RECONCILIATION_BASELINES.find(b => b.name === baselineName);
  if (!def || !def.companyPattern.test(companyName)) return 0;
  for (const seed of def.seeds) {
    await q.query(
      `INSERT INTO account_reconciliation_baselines
         (company_id, baseline_name, destination_name, official_group_key, expected_crm_property_count, category, country, source_url, source_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [companyId, baselineName, seed.destination_name, seed.official_group_key, seed.expected_crm_property_count, seed.category, seed.country, seed.source_url, seed.source_date]
    );
  }
  return def.seeds.length;
}

export interface ReconciliationReport {
  companyId: string;
  baselineName: string;
  generatedAt: string;
  gate: { destinationsAccountedFor: boolean };
  rows: ReconciliationRow[];
}

export async function generateReconciliationReport(
  companyId: string,
  baselineName: string,
  opts: { generatedBy?: string | null } = {},
  deps: { pool?: Querier } = {},
): Promise<ReconciliationReport | null> {
  const q = deps.pool ?? await defaultPool();

  const { rows: baselines } = await q.query(
    `SELECT destination_name, official_group_key, expected_crm_property_count, category, country, source_url, source_date
       FROM account_reconciliation_baselines
      WHERE company_id = $1 AND baseline_name = $2
      ORDER BY category, destination_name`,
    [companyId, baselineName]
  );
  if (baselines.length === 0) return null;

  // Staff scope — the route refuses client logins before this is called.
  const view = await resolveAccountView(companyId, {}, { pool: q });

  const propertyIds = view.properties.map(p => p.propertyId);
  const mediaCounts = new Map<string, number>();
  if (propertyIds.length > 0) {
    const { rows: mediaRows } = await q.query(
      `SELECT property_id, COUNT(*)::int AS n FROM image_studio_images
        WHERE property_id = ANY($1::text[]) GROUP BY property_id`,
      [propertyIds]
    ).catch(() => ({ rows: [] as any[] }));
    for (const r of mediaRows) mediaCounts.set(r.property_id, r.n);
  }

  const rows = reconcileBaseline(baselines as BaselineRow[], view, mediaCounts);

  const { rows: runRows } = await q.query(
    `INSERT INTO account_reconciliation_runs (company_id, baseline_name, generated_by, rows)
     VALUES ($1, $2, $3, $4)
     RETURNING generated_at`,
    [companyId, baselineName, opts.generatedBy ?? null, JSON.stringify(rows)]
  );

  return {
    companyId,
    baselineName,
    generatedAt: runRows[0]?.generated_at ?? new Date().toISOString(),
    gate: { destinationsAccountedFor: destinationGatePassed(rows) },
    rows,
  };
}

// ─── Route ───────────────────────────────────────────────────────────────
// GET /api/accounts/:id/reconciliation[?baseline=<name>]
// Default baseline is chosen by company name (see RECONCILIATION_BASELINES);
// ?baseline= is an explicit override. Staff only: any resolved client
// scope → 403.

const router = Router();

router.get("/api/accounts/:id/reconciliation", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope } = await import("./company-scope");
    const scopeCompanyId = await resolveCompanyScope(req);
    if (reconciliationDeniedForScope(scopeCompanyId)) {
      return res.status(403).json({ error: "Reconciliation reports are staff-only" });
    }
    const q = await defaultPool();
    const companyId = String(req.params.id);

    const { rows: companyRows } = await q.query(
      `SELECT name FROM crm_companies WHERE id = $1`,
      [companyId]
    );
    if (!companyRows[0]) return res.status(404).json({ error: "Company not found" });

    const baselineName = req.query.baseline
      ? String(req.query.baseline)
      : (defaultBaselineForCompany(companyRows[0].name)?.name ?? HAMMERSON_BASELINE_NAME);

    const seeded = await ensureBaselineSeeded(q, companyId, baselineName, companyRows[0].name);
    if (seeded === 0) {
      return res.status(404).json({ error: "No reconciliation baseline for this company" });
    }

    const generatedBy = (req.session as any)?.userId || (req as any).tokenUserId || null;
    const report = await generateReconciliationReport(companyId, baselineName, { generatedBy }, { pool: q });
    if (!report) return res.status(404).json({ error: "No reconciliation baseline for this company" });
    res.json(report);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
