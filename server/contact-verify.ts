// ─────────────────────────────────────────────────────────────────────────
// CRM contact verification — "is this person really at this company?"
//
// Born from the Neville Maling case (Woody, 2026-08-04): CRM said Five Guys
// (stale Apollo data), a second enrichment row said Wagamama (RocketReach
// sweep stamped the searched brand), while the truth — Acquisitions @ Wasabi
// — was sitting in the enrichment history all along.
//
// verifyContact() gathers four independent signals and lets Claude decide:
//   1. Email-domain vs linked-company sanity check
//   2. RocketReach person search (licensed LinkedIn-derived data)
//   3. BGP's own Office 365 footprint — recent interactions with the contact
//   4. Web news (Google News RSS) mentioning the person
//
// Verdicts are NEVER auto-applied. They land in contact_verifications as a
// review queue (GET /api/crm/data-health) where staff Apply or Dismiss.
// A weekly sweep (Mon ~06:30, production only) verifies the most suspect
// contacts first: email domain disagrees with the company, or the notes
// carry a past-tense "until <date>" for the linked employer.
// ─────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response } from "express";
import { pool } from "./db";
import { requireAuth } from "./auth";

const GENERIC_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com",
  "aol.com", "live.com", "me.com", "btinternet.com", "protonmail.com",
]);

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_verifications (
      id SERIAL PRIMARY KEY,
      contact_id VARCHAR NOT NULL,
      status TEXT NOT NULL,                -- confirmed | mismatch | inconclusive
      confidence TEXT,                     -- high | medium | low
      current_company_name TEXT,           -- what the CRM said at verify time
      suggested_company_name TEXT,         -- Claude's read of the real employer
      reasoning TEXT,
      evidence JSONB,
      resolution TEXT,                     -- applied | dismissed | superseded (null = pending)
      resolved_by VARCHAR,
      resolved_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_contact_verifications_contact ON contact_verifications (contact_id, created_at DESC)`);
}

function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export class ContactVerificationError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface ContactVerificationBrandLink {
  id: string;
  name: string;
  source: "requirement" | "representation";
}

// Employment and representation are different relationships. Only an explicit
// agent contact on a current requirement or tenant-rep mandate proves the latter.
export async function loadContactVerificationBrandLinks(contactIds: string[]): Promise<Record<string, ContactVerificationBrandLink[]>> {
  if (!contactIds.length) return {};
  const result = await pool.query(`
    SELECT DISTINCT links.contact_id, b.id, b.name, links.source
      FROM (
        SELECT q.agent_contact_id AS contact_id, q.company_id AS brand_id, 'requirement'::text AS source
          FROM crm_requirements_leasing q
         WHERE q.agent_contact_id = ANY($1::varchar[])
           AND lower(trim(COALESCE(q.status, ''))) IN ('', 'active')
        UNION ALL
        SELECT r.primary_contact_id, r.brand_company_id, 'representation'::text
          FROM brand_agent_representations r
         WHERE r.primary_contact_id = ANY($1::varchar[]) AND r.agent_type = 'tenant_rep'
           AND r.end_date IS NULL AND (r.start_date IS NULL OR r.start_date <= now())
      ) links
      JOIN crm_companies b ON b.id = links.brand_id AND b.merged_into_id IS NULL
     ORDER BY b.name, b.id, links.source`, [contactIds]);
  const byContact: Record<string, ContactVerificationBrandLink[]> = {};
  for (const row of result.rows) {
    (byContact[row.contact_id] ||= []).push({ id: row.id, name: row.name, source: row.source });
  }
  return byContact;
}

export function contactVerificationSnapshotMatches(finding: any, contact: any): boolean {
  const evidence = finding.evidence || {};
  if (Object.prototype.hasOwnProperty.call(evidence, "companyIdAtVerification")
    && (evidence.companyIdAtVerification ?? null) !== (contact.company_id ?? null)) return false;
  const name = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
  // Older findings have only a name snapshot. New findings check both ID and name.
  return name(finding.current_company_name) === name(contact.company_name);
}

export async function loadPendingContactVerifications(): Promise<any[]> {
  await ensureTable();
  const result = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (contact_id) * FROM contact_verifications
       ORDER BY contact_id, created_at DESC, id DESC
    )
    SELECT v.*, c.name AS contact_name, c.email AS contact_email,
           c.company_id AS live_company_id, co.name AS live_company_name
      FROM latest v
      JOIN crm_contacts c ON c.id = v.contact_id
      LEFT JOIN crm_companies co ON co.id = c.company_id
     WHERE v.resolution IS NULL AND v.status = 'mismatch'
       AND (NOT (COALESCE(v.evidence, '{}'::jsonb) ? 'companyIdAtVerification')
         OR v.evidence->>'companyIdAtVerification' IS NOT DISTINCT FROM c.company_id)
       AND NULLIF(lower(trim(v.current_company_name)), '') IS NOT DISTINCT FROM NULLIF(lower(trim(co.name)), '')
       AND (NULLIF(trim(v.suggested_company_name), '') IS NULL
         OR lower(trim(v.suggested_company_name)) IS DISTINCT FROM lower(trim(co.name)))
     ORDER BY v.created_at DESC, v.id DESC`);
  const brandLinks = await loadContactVerificationBrandLinks(result.rows.map(row => row.contact_id));
  return result.rows.map(row => ({ ...row, brand_links: brandLinks[row.contact_id] || [] }));
}

// Verification runs network lookups before writing. Lock the contact at the end
// and reject an obsolete result if an employer correction happened meanwhile.
export async function saveContactVerification(contact: any, verdict: any, evidence: Record<string, any>): Promise<any> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const live = (await db.query(`
      SELECT c.id, c.company_id, co.name AS company_name
        FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id
       WHERE c.id = $1 FOR UPDATE OF c`, [contact.id])).rows[0];
    if (!live || !contactVerificationSnapshotMatches({
      current_company_name: contact.company_name,
      evidence: { companyIdAtVerification: contact.company_id ?? null },
    }, live)) {
      throw new ContactVerificationError(409, "CONTACT_CHANGED", "The contact's employer changed during verification. Verify the contact again.");
    }
    const latest = (await db.query(`
      SELECT id, resolution FROM contact_verifications WHERE contact_id = $1
       ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`, [contact.id])).rows[0];
    if (Object.prototype.hasOwnProperty.call(contact, "verification_id_at_start")
      && (latest?.id ?? null) !== (contact.verification_id_at_start ?? null)) {
      throw new ContactVerificationError(409, "VERIFICATION_CHANGED", "A newer verification exists for this contact. Refresh the review queue.");
    }
    if (latest && contact.verification_id_at_start !== undefined) {
      if (latest.resolution !== (contact.verification_resolution_at_start ?? null)) {
        throw new ContactVerificationError(409, "VERIFICATION_CHANGED", "This contact was reviewed during verification. Refresh the review queue.");
      }
    }
    const result = await db.query(`
      INSERT INTO contact_verifications (contact_id, status, confidence, current_company_name, suggested_company_name, reasoning, evidence)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [contact.id, verdict.status, verdict.confidence, contact.company_name, verdict.suggestedCompanyName, verdict.reasoning,
      JSON.stringify({ ...evidence, companyIdAtVerification: contact.company_id ?? null })]);
    await db.query("COMMIT");
    return { ...result.rows[0], contactName: contact.name };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

export async function resolveContactVerification(
  findingId: string, action: "apply" | "dismiss", userId: string | null, selectedCompanyId?: unknown,
): Promise<{ ok: true; linkedCompany?: string }> {
  if (!/^\d+$/.test(findingId)) throw new ContactVerificationError(400, "INVALID_FINDING", "Invalid contact finding.");
  if (selectedCompanyId !== undefined && (typeof selectedCompanyId !== "string" || !selectedCompanyId.trim())) {
    throw new ContactVerificationError(400, "INVALID_COMPANY", "Choose a valid CRM employer.");
  }
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const identity = (await db.query("SELECT contact_id FROM contact_verifications WHERE id = $1", [findingId])).rows[0];
    if (!identity) throw new ContactVerificationError(404, "FINDING_NOT_FOUND", "Contact finding not found.");
    // Always lock contact first, then findings; verification uses the same order.
    const contact = (await db.query(`
      SELECT c.id, c.company_id, co.name AS company_name
        FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id
       WHERE c.id = $1 FOR UPDATE OF c`, [identity.contact_id])).rows[0];
    if (!contact) throw new ContactVerificationError(404, "CONTACT_NOT_FOUND", "Contact not found.");
    const findings = (await db.query(`
      SELECT * FROM contact_verifications WHERE contact_id = $1
       ORDER BY created_at DESC, id DESC FOR UPDATE`, [identity.contact_id])).rows;
    const finding = findings.find(row => String(row.id) === findingId);
    if (!finding || findings[0]?.id !== finding.id) {
      throw new ContactVerificationError(409, "FINDING_OUTDATED", "A newer verification exists for this contact. Refresh the review queue.");
    }
    if (finding.resolution !== null || finding.status !== "mismatch") {
      throw new ContactVerificationError(409, "FINDING_RESOLVED", "This finding has already been reviewed. Refresh the review queue.");
    }
    if (!contactVerificationSnapshotMatches(finding, contact)) {
      throw new ContactVerificationError(409, "CONTACT_CHANGED", "The contact's employer has changed since this finding. Verify the contact again.");
    }
    let company: { id: string; name: string } | undefined;
    if (action === "apply") {
      if (selectedCompanyId !== undefined) {
        company = (await db.query(`
          SELECT id, name FROM crm_companies WHERE id = $1 AND merged_into_id IS NULL FOR SHARE`, [selectedCompanyId])).rows[0];
        if (!company) throw new ContactVerificationError(409, "COMPANY_UNAVAILABLE", "That employer is no longer available. Choose a current CRM company.");
      } else {
        const matches = (await db.query(`
          SELECT id, name FROM crm_companies
           WHERE merged_into_id IS NULL AND lower(trim(name)) = lower(trim($1))
           ORDER BY id LIMIT 2 FOR SHARE`, [finding.suggested_company_name])).rows;
        if (matches.length !== 1) {
          throw new ContactVerificationError(409, "EMPLOYER_SELECTION_REQUIRED", matches.length
            ? "More than one CRM company matches the suggested employer. Choose the correct employer to apply this finding."
            : "No CRM company matches the suggested employer. Choose an existing employer, or add the employer to CRM first. This finding remains open.");
        }
        company = matches[0];
      }
      if (company!.id === contact.company_id) {
        throw new ContactVerificationError(409, "EMPLOYER_UNCHANGED", "This contact is already linked to that employer. Dismiss the finding if the current employer is correct.");
      }
      // Keep the same contact ID: requirement, deal and representation links
      // continue to identify this person. Employment never rewrites those links.
      await db.query(`
        UPDATE crm_contacts SET company_id = $1, company_name = $2,
               notes = COALESCE(notes, '') || ' · Employer corrected to ' || $2 || ' (reviewed ' || to_char(now(), 'DD Mon YYYY') || ')',
               updated_at = now() WHERE id = $3`, [company!.id, company!.name, contact.id]);
    }
    await db.query(`
      UPDATE contact_verifications
         SET resolution = CASE WHEN id = $1 THEN $2 ELSE 'superseded' END,
             resolved_by = $3, resolved_at = now()
       WHERE contact_id = $4 AND resolution IS NULL`,
    [finding.id, action === "apply" ? "applied" : "dismissed", userId, contact.id]);
    await db.query("COMMIT");
    return company ? { ok: true, linkedCompany: company.name } : { ok: true };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

// Does the email's domain plausibly belong to the linked company?
function emailMatchesCompany(email: string | null, companyName: string | null): boolean | null {
  if (!email || !email.includes("@") || !companyName) return null;
  const domain = email.split("@")[1].toLowerCase();
  if (GENERIC_DOMAINS.has(domain)) return null; // personal address — no signal
  const domainCore = norm(domain.split(".")[0]);
  const company = norm(companyName);
  if (!domainCore || !company) return null;
  return company.includes(domainCore) || domainCore.includes(company);
}

export async function verifyContact(contactId: string): Promise<any> {
  await ensureTable();
  const cRes = await pool.query(
    `SELECT c.id, c.name, c.email, c.role, c.notes, c.linkedin_url, c.enrichment_source,
            c.last_enriched_at, c.company_id, co.name AS company_name,
            latest.id AS verification_id_at_start, latest.resolution AS verification_resolution_at_start
       FROM crm_contacts c LEFT JOIN crm_companies co ON co.id = c.company_id
       LEFT JOIN LATERAL (
         SELECT id, resolution FROM contact_verifications WHERE contact_id = c.id
          ORDER BY created_at DESC, id DESC LIMIT 1
       ) latest ON true
      WHERE c.id = $1`, [contactId]);
  const contact = cRes.rows[0];
  if (!contact) throw new Error("Contact not found");

  const evidence: Record<string, any> = {
    companyIdAtVerification: contact.company_id ?? null,
    brandLinks: (await loadContactVerificationBrandLinks([contactId]))[contactId] || [],
  };

  // 1. Email-domain sanity
  evidence.emailDomainMatch = emailMatchesCompany(contact.email, contact.company_name);
  evidence.email = contact.email || null;

  // 2. RocketReach person lookup (licensed LinkedIn-derived data)
  try {
    const { searchRocketReach, isRocketReachConfigured } = await import("./rocketreach-contacts");
    if (isRocketReachConfigured() && contact.name) {
      const people = await searchRocketReach({ personName: contact.name });
      // Prefer the profile whose LinkedIn URL matches the one on file.
      const ln = (contact.linkedin_url || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "");
      const match = (ln && people.find(p => (p.linkedin_url || "").toLowerCase().includes(ln.split("/in/")[1] || "\u0000"))) || people[0];
      if (match) {
        evidence.rocketreach = {
          currentEmployer: (match as any).current_employer || null,
          title: (match as any).current_title || (match as any).title || null,
          linkedin: match.linkedin_url || null,
          matchedByLinkedin: !!(ln && match.linkedin_url && match.linkedin_url.toLowerCase().includes(ln.split("/in/")[1] || "\u0000")),
        };
      }
    }
  } catch (e: any) {
    evidence.rocketreach = { error: e?.message?.slice(0, 120) };
  }

  // 3. BGP's own O365 footprint — recent logged interactions
  try {
    const ints = await pool.query(
      `SELECT interaction_date, type, subject
         FROM crm_interactions
        WHERE contact_id = $1
        ORDER BY interaction_date DESC NULLS LAST LIMIT 5`, [contactId]);
    evidence.recentInteractions = ints.rows.map((r: any) => ({
      date: r.interaction_date, type: r.type, subject: (r.subject || "").slice(0, 120),
    }));
  } catch { evidence.recentInteractions = []; }
  if (contact.email) {
    try {
      const { graphRequest } = await import("./shared-mailbox");
      const r = await graphRequest(
        `/users/chatbgp@brucegillinghampollard.com/messages?$search="participants:${encodeURIComponent(contact.email)}"&$top=3&$select=subject,receivedDateTime,from`
      ).catch(() => null);
      evidence.mailboxThreads = (r?.value || []).map((m: any) => ({
        subject: (m.subject || "").slice(0, 120), date: m.receivedDateTime,
        from: m.from?.emailAddress?.address || null,
      }));
    } catch { /* mailbox unavailable — fine */ }
  }

  // 4. Web news on the person
  try {
    const { googleNewsRssUrl } = await import("./rssapp");
    const Parser = (await import("rss-parser")).default;
    const parser = new Parser({ timeout: 8000, headers: { "User-Agent": "BGP-Dashboard/1.0" } });
    const feed = await parser.parseURL(googleNewsRssUrl(`"${contact.name}" ${contact.company_name || ""}`.trim()));
    evidence.news = (feed.items || []).slice(0, 5).map((i: any) => ({ title: i.title, date: i.pubDate || null }));
  } catch { evidence.news = []; }

  // Claude weighs the signals. Strict JSON out.
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `You are auditing a commercial-property CRM for data accuracy.

CONTACT ON FILE
Name: ${contact.name}
Linked company: ${contact.company_name || "(none)"}
Role: ${contact.role || "(none)"}
Email: ${contact.email || "(none)"}
Notes (may contain enrichment history): ${(contact.notes || "(none)").slice(0, 600)}
Enrichment source: ${contact.enrichment_source || "manual"} (last: ${contact.last_enriched_at || "never"})

INDEPENDENT SIGNALS
${JSON.stringify({ ...evidence, brandLinks: undefined }, null, 1).slice(0, 3500)}

RECORDED BRAND LINKS (up to 20 shown; these establish representation, not employment)
${JSON.stringify(evidence.brandLinks.slice(0, 20), null, 1)}

Decide whether the linked company is this person's CURRENT employer.
An agent may represent several brands while being employed by a separate agency.
The brandLinks are explicit current requirements or tenant-rep mandates; they
prove representation, not employment. Preserve that distinction: a represented
brand must not be treated as the agent's employer merely because it has a linked
requirement. If a brand is incorrectly stored as the employer, explain that the
agency employer should be corrected while the brand representation is retained.
Weigh signals by reliability: a recent email FROM the contact's corporate
address is strong; RocketReach current_employer is strong when matched by
LinkedIn URL; an "until <past date>" in the notes for the linked company is
strong evidence they LEFT; news headlines are weak unless explicit.

Reply with ONLY this JSON:
{"status": "confirmed"|"mismatch"|"inconclusive", "confidence": "high"|"medium"|"low", "suggestedCompanyName": string|null, "reasoning": "<one or two sentences>"}`;

  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });
  const text = resp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  let verdict: any;
  try {
    verdict = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    verdict = { status: "inconclusive", confidence: "low", suggestedCompanyName: null, reasoning: "Model reply was not parseable." };
  }

  return saveContactVerification(contact, verdict, evidence);
}

// Weekly sweep — most-suspect first, capped so a run costs pennies.
export async function sweepContactVerifications(limit = 25): Promise<{ checked: number; mismatches: number }> {
  await ensureTable();
  // Candidates: a real (non-generic) email whose domain disagrees with the
  // linked company name, or notes carrying "until 20xx" (a past-tense
  // employer), skipping anything verified in the last 60 days.
  const cand = await pool.query(`
    SELECT c.id, c.name, c.email, c.notes, co.name AS company_name
      FROM crm_contacts c
      JOIN crm_companies co ON co.id = c.company_id
     WHERE c.email LIKE '%@%'
       AND split_part(c.email, '@', 2) NOT IN (${[...GENERIC_DOMAINS].map((_, i) => `$${i + 1}`).join(",")})
       AND c.name NOT ILIKE '[duplicate%'
       AND NOT EXISTS (SELECT 1 FROM contact_verifications v
                        WHERE v.contact_id = c.id AND v.created_at > now() - interval '60 days')
     ORDER BY (c.notes ~* 'until 20[0-9][0-9]') DESC, c.updated_at DESC
     LIMIT 400`, [...GENERIC_DOMAINS]);

  const suspects = cand.rows.filter((r: any) => emailMatchesCompany(r.email, r.company_name) === false
    || /until 20\d\d/i.test(r.notes || ""));
  const toCheck = (suspects.length ? suspects : cand.rows).slice(0, limit);

  let mismatches = 0;
  for (const row of toCheck) {
    try {
      const v = await verifyContact(row.id);
      if (v.status === "mismatch") mismatches++;
    } catch (e: any) {
      console.warn(`[contact-verify] ${row.name} failed:`, e?.message);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`[contact-verify] sweep: ${toCheck.length} checked, ${mismatches} mismatches queued for review`);
  return { checked: toCheck.length, mismatches };
}

export function setupContactVerifyRoutes(app: Express): void {
  // All staff-only: verification burns RocketReach/Claude credits and the
  // review queue exposes cross-company contacts.
  const staffOnly = async (req: Request, res: Response): Promise<boolean> => {
    const { isClientRequestUser } = await import("./company-scope");
    if (await isClientRequestUser(req as any)) {
      res.status(403).json({ error: "Not available for client accounts" });
      return false;
    }
    return true;
  };

  app.post("/api/crm/contacts/:id/verify", requireAuth, async (req, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      res.json(await verifyContact(String(req.params.id)));
    } catch (e: any) {
      if (/api ?key|authentication|authToken/i.test(e?.message || "")) {
        return res.status(503).json({ error: "Contact verification unavailable — AI service is not configured" });
      }
      res.status(e instanceof ContactVerificationError ? e.status : 500).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    }
  });

  app.get("/api/crm/data-health", requireAuth, async (req, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const pending = await loadPendingContactVerifications();
      const stats = await pool.query(`
        SELECT status, count(*)::int AS n FROM contact_verifications
         WHERE created_at > now() - interval '30 days' GROUP BY status`);
      res.json({ pending, stats: stats.rows });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/data-health/:id/apply", requireAuth, async (req: any, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const userId = req.session?.userId || req.tokenUserId || null;
      res.json(await resolveContactVerification(String(req.params.id), "apply", userId, req.body?.companyId));
    } catch (e: any) {
      res.status(e instanceof ContactVerificationError ? e.status : 500).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    }
  });

  app.post("/api/crm/data-health/:id/dismiss", requireAuth, async (req: any, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const userId = req.session?.userId || req.tokenUserId || null;
      res.json(await resolveContactVerification(String(req.params.id), "dismiss", userId));
    } catch (e: any) {
      res.status(e instanceof ContactVerificationError ? e.status : 500).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    }
  });

  app.post("/api/crm/data-health/sweep", requireAuth, async (req, res) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const limit = Math.min(50, parseInt(String(req.query.limit || "25")) || 25);
      res.json(await sweepContactVerifications(limit));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}

// Boot: weekly sweep, Monday morning ~06:30 UK. Production only. The
// last-run guard makes the hourly tick idempotent across restarts.
export function startContactVerifySweep(): void {
  if (process.env.NODE_ENV !== "production") return;
  setInterval(async () => {
    try {
      const now = new Date();
      if (now.getDay() !== 1 || now.getHours() !== 6) return;
      await ensureTable();
      const last = await pool.query(`SELECT max(created_at) AS t FROM contact_verifications`);
      const t = last.rows[0]?.t ? new Date(last.rows[0].t) : null;
      if (t && Date.now() - t.getTime() < 5 * 24 * 60 * 60 * 1000) return; // ran in the last 5 days
      await sweepContactVerifications(25);
    } catch (e: any) {
      console.warn("[contact-verify] weekly sweep failed:", e?.message);
    }
  }, 60 * 60 * 1000);
}
