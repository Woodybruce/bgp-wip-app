// A brand's email history with BGP, as conversations: subject, who at BGP,
// who at the brand, other parties, when, and the latest preview — plus a
// short AI read of what the emails are about (Woody, 2026-09-24: "need to
// be able to see summary of those ... understand the context, who to etc").
// Staff-only: built from BGP's correspondence log (crm_interactions).
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { getAnthropicClient } from "./utils/anthropic-client";
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { LANDLORD_CATALOGUE_PREDICATE, landlordDomains } from "./landlord-meeting-matching";
import { isPrivateEmailRecord, PRIVATE_MAIL_POLICY_VERSION } from "./private-mail";
import { cleanLandlordEmailPreview, selectLandlordEmailHighlights, selectLandlordEmailExcerpts, landlordEmailSummaryPrompt, LANDLORD_EMAIL_SUMMARY_VERSION } from "./landlord-email-highlights";
import { landlordPersonRequest, resolveLandlordActivityPerson, LandlordPersonScopeError, type LandlordPersonScope } from "./landlord-activity-person";

const anthropic = getAnthropicClient(true);
const MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"];
const BGP_DOMAIN = "@brucegillinghampollard.com";

export const BRAND_EMAIL_ROWS_SQL = `
  SELECT DISTINCT ON (COALESCE(i.microsoft_id, i.subject || '|' || i.interaction_date::text))
         i.subject, i.direction, i.bgp_user, i.preview, i.participants, i.interaction_date
    FROM crm_interactions i
   WHERE i.interaction_date <= NOW()
     AND (i.type IS NULL OR i.type ILIKE '%email%')
     AND (i.company_id = $2 OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(i.participants) = 'array' THEN i.participants ELSE '[]'::jsonb END) p
            WHERE p ILIKE $1))
   ORDER BY COALESCE(i.microsoft_id, i.subject || '|' || i.interaction_date::text), i.interaction_date DESC
   LIMIT 1500`;

// Person scope is applied to individual messages before conversation grouping
// or the row limit, so another colleague's reply cannot leak into the preview.
// Collect indexed candidates first. Expanding participants on the entire
// correspondence log makes each landlord lookup scan hundreds of thousands
// of messages. The text match is only a broad prefilter: exact email/domain
// and person checks below still decide which messages belong in this view.
// Keep the final lookup lateral too: a large account otherwise makes the
// planner scan the whole mail table and expand participant JSON before joining
// candidate IDs. OFFSET 0 retains primary-key lookups for candidate rows only.
export const LANDLORD_EMAIL_ROWS_SQL = `WITH search_patterns AS MATERIALIZED (
      SELECT DISTINCT '%' || replace(replace(replace(needle, chr(92), chr(92)||chr(92)),
        '%', chr(92)||'%'), '_', chr(92)||'_') || '%' AS pattern
      FROM (
        SELECT d AS needle FROM unnest($2::text[]) d WHERE d <> ''
        UNION SELECT email FROM unnest($3::text[]) email WHERE email <> ''
          AND NOT EXISTS (SELECT 1 FROM unnest($2::text[]) d
            WHERE split_part(email, '@', 2)=d OR right(split_part(email, '@', 2), length(d)+1)='.' || d)
      ) needles
    ), candidate_ids AS MATERIALIZED (
      SELECT id FROM crm_interactions WHERE company_id=$1
      UNION SELECT id FROM crm_interactions WHERE contact_id=ANY($6::text[])
      UNION SELECT hit.id FROM search_patterns pattern CROSS JOIN LATERAL (
        SELECT id FROM crm_interactions WHERE participants::text ILIKE pattern.pattern OFFSET 0
      ) hit
    )
    SELECT * FROM (
      SELECT DISTINCT ON (COALESCE(i.microsoft_id, i.subject || '|' || i.interaction_date::text))
        i.subject, i.direction, i.bgp_user, i.preview, i.participants, i.interaction_date
      FROM candidate_ids candidate CROSS JOIN LATERAL (
        SELECT * FROM crm_interactions WHERE id=candidate.id OFFSET 0
      ) i
      WHERE i.interaction_date <= now() AND (i.type IS NULL OR i.type ILIKE '%email%')
        AND NOT bgp_private_mail_record(i.bgp_user, i.participants)
        AND ($4::text IS NULL OR lower(trim(i.bgp_user))=$4 OR i.contact_id=$5 OR EXISTS (SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(i.participants)='array' THEN i.participants ELSE '[]'::jsonb END) participant
          WHERE lower(trim(CASE WHEN jsonb_typeof(participant)='string' THEN participant #>> '{}'
            ELSE COALESCE(participant->>'email',participant->>'address',participant->'emailAddress'->>'address') END))=$4))
        AND (i.company_id=$1 OR i.contact_id=ANY($6::text[]) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(i.participants)='array' THEN i.participants ELSE '[]'::jsonb END) participant
          CROSS JOIN LATERAL (SELECT lower(trim(CASE WHEN jsonb_typeof(participant)='string' THEN participant #>> '{}'
            ELSE COALESCE(participant->>'email',participant->>'address',participant->'emailAddress'->>'address') END)) AS email) p
          WHERE p.email=ANY($3::text[]) OR EXISTS (SELECT 1 FROM unnest($2::text[]) d
            WHERE split_part(p.email, '@', 2)=d OR right(split_part(p.email, '@', 2), length(d)+1)='.' || d)))
      ORDER BY COALESCE(i.microsoft_id, i.subject || '|' || i.interaction_date::text), i.interaction_date DESC
    ) messages ORDER BY interaction_date DESC LIMIT 1500`;

export type LandlordEmailExcerpt = { date: string; text: string };
export type EmailConversation = {
  subject: string;
  messages: number;
  first: string;
  last: string;
  bgp: string[];
  brand: string[];
  others: string[];
  firms?: string[];
  preview: string;
  previewAt?: string;
  excerpts?: LandlordEmailExcerpt[];
};

const normSubject = (subject: string | null) => (subject || "(no subject)").replace(/^\s*((re|fw|fwd|aw|sv)\s*(\[\d+\])?\s*:\s*)+/i, "").replace(/\s+/g, " ").trim() || "(no subject)";

const cleanPreview = (text: string | null) => (text || "")
  .replace(/\r/g, "")
  .split(/\n\s*(From:|-----Original|On .{5,80} wrote:)/)[0]
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 220);

const personList = (participants: unknown, structured = false): string[] => {
  const list = Array.isArray(participants) ? participants : [];
  return list.map(p => String(structured && p && typeof p === "object" ? p.email || p.address || p.emailAddress?.address || "" : p || "").trim().toLowerCase()).filter(p => p.includes("@"));
};

export function groupEmailConversations(rows: any[], domain: string, landlordEmails?: Set<string>, domains = [domain.toLowerCase()]): EmailConversation[] {
  const at = `@${domain.toLowerCase()}`;
  const byKey = new Map<string, EmailConversation & { _bgp: Set<string>; _brand: Set<string>; _others: Set<string>; _excerpts: LandlordEmailExcerpt[] }>();
  const sorted = rows.filter(row=>!isPrivateEmailRecord(row)).sort((a, b) => new Date(b.interaction_date).getTime() - new Date(a.interaction_date).getTime());
  for (const row of sorted) {
    const subject = normSubject(row.subject);
    const key = subject.toLowerCase();
    const date = new Date(row.interaction_date).toISOString();
    const preview = landlordEmails ? cleanLandlordEmailPreview(row.preview) : cleanPreview(row.preview);
    let conv = byKey.get(key);
    if (!conv) {
      conv = { subject, messages: 0, first: date, last: date, bgp: [], brand: [], others: [], preview, ...(landlordEmails && preview ? {previewAt:date} : {}), _bgp: new Set(), _brand: new Set(), _others: new Set(), _excerpts: [] };
      byKey.set(key, conv);
    }
    conv.messages++;
    if (date < conv.first) conv.first = date;
    if (!conv.preview && preview) { conv.preview = preview; if(landlordEmails)conv.previewAt=date; }
    if (landlordEmails) conv._excerpts.push({date,text:cleanLandlordEmailPreview(row.preview,500)});
    const people = personList(row.participants, !!landlordEmails);
    if (row.bgp_user) people.push(String(row.bgp_user).toLowerCase());
    for (const p of people) {
      if (p.endsWith(BGP_DOMAIN)) conv._bgp.add(p);
      else if (landlordEmails ? landlordEmails.has(p) || domains.some(d => p.split("@")[1] === d || p.split("@")[1]?.endsWith(`.${d}`)) : p.endsWith(at)) conv._brand.add(p);
      else conv._others.add(p);
    }
  }
  return Array.from(byKey.values()).map(({ _bgp, _brand, _others, _excerpts, ...conv }) => {
    const excerpts = landlordEmails ? selectLandlordEmailExcerpts(_excerpts) : undefined;
    return {...conv, bgp:Array.from(_bgp),brand:Array.from(_brand),others:Array.from(_others),
      ...(excerpts ? {excerpts,...(excerpts[0] ? {preview:cleanLandlordEmailPreview(excerpts[0].text),previewAt:excerpts[0].date} : {})} : {})};
  });
}

async function brandFor(companyId: string) {
  const c = (await pool.query(`SELECT c.id, c.name, c.domain, c.domain_url, c.ai_generated_fields, (${LANDLORD_CATALOGUE_PREDICATE}) AS is_landlord FROM crm_companies c WHERE c.id = $1`, [companyId])).rows[0];
  if (!c) return null;
  const domain = String(c.domain || c.domain_url || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").toLowerCase();
  return { ...c, domain };
}

async function staffOnly(req: Request, res: Response) {
  const { resolveCompanyScope } = await import("./company-scope");
  if (await resolveCompanyScope(req as any)) { res.status(403).json({ error: "Email history is available in the staff view." }); return false; }
  return true;
}

async function loadConversations(companyId: string, person: LandlordPersonScope | null = null, knownCompany?: Awaited<ReturnType<typeof brandFor>>) {
  const c = knownCompany ?? await brandFor(companyId);
  if (!c) return null;
  if (person && !c.is_landlord) throw new LandlordPersonScopeError("Person histories are available on landlords only");
  if (!c.domain && !c.is_landlord) return { company: c, conversations: [] as EmailConversation[] };
  const domains = c.is_landlord ? landlordDomains({ ...c, contacts: [] }) : [c.domain];
  const contactRows = c.is_landlord ? (await pool.query(`SELECT id,lower(trim(email)) AS email FROM crm_contacts WHERE company_id=$1 AND email IS NOT NULL`, [companyId])).rows : [];
  const contacts = contactRows.map(row => row.email);
  const rows = c.is_landlord ? (await pool.query(LANDLORD_EMAIL_ROWS_SQL, [companyId, domains, contacts, person?.email || null, person?.contactId || null, contactRows.map(row => row.id)])).rows
    : (await pool.query(BRAND_EMAIL_ROWS_SQL, [`%@${c.domain}`, companyId])).rows;
  const conversations = groupEmailConversations(rows, c.domain, c.is_landlord ? new Set<string>(contacts) : undefined, domains);
  // Name the other firms copied in from the CRM by their email domain
  // (cwg.com → Canary Wharf Group), falling back to the domain itself.
  const otherDomains = Array.from(new Set(conversations.flatMap(conv => conv.others.map(o => o.split("@")[1]))));
  const firmByDomain = new Map<string, string>();
  if (otherDomains.length) {
    const hits = await pool.query(
      `SELECT DISTINCT ON (d) d, name FROM (
         SELECT LOWER(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(domain, domain_url, ''), '^https?://(www\.)?', '', 'i'), '/.*$', '')) AS d, name
           FROM crm_companies WHERE merged_into_id IS NULL) x
        WHERE d = ANY($1) ORDER BY d, length(name)`, [otherDomains]).catch(() => ({ rows: [] as any[] }));
    for (const row of hits.rows) firmByDomain.set(row.d, row.name);
  }
  for (const conv of conversations) conv.firms = Array.from(new Set(conv.others.map(o => firmByDomain.get(o.split("@")[1]) || o.split("@")[1])));
  return { company: c, conversations };
}

// The card and history dialog can request the same large account together.
// Cache only Landlord GET reads briefly; summary generation still reads fresh
// evidence before and after its provider call. Failed requests stay retryable.
export function createLandlordEmailLoadCache<T>(ttlMs = 20_000, maxEntries = 40, now = Date.now) {
  const cached = new Map<string,{companyId:string;value:T;expires:number}>();
  const inFlight = new Map<string,{companyId:string;promise:Promise<T>}>();
  return {
    async read(key:string, companyId:string, load:()=>Promise<T>):Promise<T> {
      const saved = cached.get(key);
      if (saved && saved.expires > now()) return saved.value;
      if (saved) cached.delete(key);
      const pending = inFlight.get(key);
      if (pending) return pending.promise;
      const entry = {companyId,promise:null as unknown as Promise<T>};
      entry.promise = Promise.resolve().then(load).then(value=>{
        if (inFlight.get(key) === entry) {
          while (cached.size >= Math.max(1,maxEntries)) cached.delete(cached.keys().next().value!);
          cached.set(key,{companyId,value,expires:now()+ttlMs});
        }
        return value;
      }).finally(()=>{if(inFlight.get(key) === entry)inFlight.delete(key);});
      inFlight.set(key,entry);
      return entry.promise;
    },
    invalidate(companyId:string) {
      for (const [key,entry] of cached) if (entry.companyId === companyId) cached.delete(key);
      // An older in-flight load must not repopulate the cache after a write.
      for (const [key,entry] of inFlight) if (entry.companyId === companyId) inFlight.delete(key);
    },
  };
}

export function landlordEmailLoadCacheKey(companyId:string, person:LandlordPersonScope|null) {
  return JSON.stringify([companyId,person?.key || null,person?.email || null,person?.contactId || null,
    PRIVATE_MAIL_POLICY_VERSION,LANDLORD_EMAIL_SUMMARY_VERSION]);
}

const landlordEmailLoads = createLandlordEmailLoadCache<Awaited<ReturnType<typeof loadConversations>>>();
async function loadConversationsForGet(companyId:string, person:LandlordPersonScope|null) {
  const company = await brandFor(companyId);
  if (!company) return null;
  if (!company.is_landlord) return loadConversations(companyId,person,company);
  return landlordEmailLoads.read(landlordEmailLoadCacheKey(companyId,person),companyId,()=>loadConversations(companyId,person,company));
}

const nameFromEmail = (email: string) => email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
export const emailEvidenceFingerprint = (conversations: EmailConversation[], landlord = false) => createHash("sha256")
  .update(JSON.stringify({policy:PRIVATE_MAIL_POLICY_VERSION,summaryVersion:landlord ? LANDLORD_EMAIL_SUMMARY_VERSION : null,conversations})).digest("hex");

export function currentEmailSummary(cached:any, conversations:EmailConversation[], landlord = false) {
  return cached?.privacyPolicy === PRIVATE_MAIL_POLICY_VERSION && cached.last === (conversations[0]?.last || null)
    && cached.evidenceKey === emailEvidenceFingerprint(conversations,landlord) ? cached : null;
}

export function emailSummaryPrompt(brand: string, conversations: EmailConversation[]) {
  const lines = conversations.slice(0, 25).map(conv =>
    `- "${conv.subject}" · ${conv.messages} msg · ${conv.first.slice(0, 10)} → ${conv.last.slice(0, 10)} · BGP: ${conv.bgp.map(nameFromEmail).join(", ") || "—"} · ${brand}: ${conv.brand.map(nameFromEmail).join(", ") || "—"} · other people: ${conv.others.map(o => `${nameFromEmail(o)} (${o.split("@")[1]})`).join(", ") || "—"} · other firms: ${(conv.firms || []).join(", ") || "—"} · latest line (sender not recorded): ${conv.preview.slice(0, 160)}`);
  return `You are summarising BGP's (Bruce Gillingham Pollard, a London property agency) email history with ${brand} for a colleague who needs the context fast.

Email conversations, newest first:
${lines.join("\n")}

Write 3-5 short bullets, each starting "- **Label:** " (e.g. **What it's about:**, **Who:**, **Where it stands:**, **Also involved:**). Say what the emails are about (deals, sites, topics), who at BGP talks to whom at ${brand}, which other firms are copied (use the "other firms" names), and where the latest thread left off. Only BGP-listed people are BGP; everyone under "other people" belongs to the firm of their email domain. The sender of the latest line is not recorded — don't attribute it to anyone. Use only the dates given. Name people as they appear. No headings, no preamble. Under 110 words.`;
}

const personEmailSummaries = new Map<string, { summary: any; expires: number }>();
const personSummaryKey = (companyId: string, person: LandlordPersonScope) => `${companyId}:${person.key}:${person.email}`;
async function emailPersonScope(req: Request): Promise<LandlordPersonScope | null> {
  const request = landlordPersonRequest(req.query);
  if (!request) return null;
  if (!await (await import("./landlord-meetings")).canReadLandlordMeetings(req)) throw new LandlordPersonScopeError("Person histories are available to BGP staff only",403);
  return resolveLandlordActivityPerson(String(req.params.companyId), request);
}

function scopedEmailSummary(company: any, person: LandlordPersonScope | null) {
  if (!person) return company.ai_generated_fields?.email_summary || null;
  const saved = personEmailSummaries.get(personSummaryKey(company.id,person));
  return saved && saved.expires > Date.now() ? saved.summary : null;
}

export function registerBrandEmailThreadRoutes(router: Router) {
  router.get("/api/brand/:companyId/email-threads", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const person = await emailPersonScope(req);
      const out = await loadConversationsForGet(String(req.params.companyId),person);
      if (!out) return res.status(404).json({ error: "Company not found" });
      const cached = scopedEmailSummary(out.company,person);
      const evidenceKey = emailEvidenceFingerprint(out.conversations,out.company.is_landlord);
      res.json({ domain: out.company.domain, conversations: out.conversations.slice(0, 200), total: out.conversations.length, evidenceKey,
        ...(out.company.is_landlord ? {highlights:selectLandlordEmailHighlights(out.conversations)} : {}),
        summary: currentEmailSummary(cached,out.conversations,out.company.is_landlord) });
    } catch (err: any) { res.status(err?.status || 500).json({ error: err.message }); }
  });

  router.post("/api/brand/:companyId/email-threads/summary", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const companyId = String(req.params.companyId);
      const person = await emailPersonScope(req);
      const out = await loadConversations(companyId,person);
      if (!out) return res.status(404).json({ error: "Company not found" });
      if (!out.conversations.length) return res.json({ summary: null });
      const evidenceKey = emailEvidenceFingerprint(out.conversations,out.company.is_landlord);
      const prompt = (out.company.is_landlord ? landlordEmailSummaryPrompt(out.company.name,out.conversations) : emailSummaryPrompt(out.company.name, out.conversations))
        + (person ? `\nThis view includes only correspondence involving ${person.name} (${person.email}). Describe that person's linked correspondence, not the entire landlord relationship; do not infer that the person wrote the latest line.` : "");
      let text = "";
      let lastErr: any = null;
      for (const model of MODELS) {
        try {
          const msg = await anthropic.messages.create({ model, max_tokens: out.company.is_landlord ? 750 : 400, messages: [{ role: "user", content: prompt }] }, { timeout: 30_000, maxRetries: 0 });
          text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
          if (text) break;
        } catch (e: any) { lastErr = e; }
      }
      if (!text) return res.status(502).json({ error: `Summary unavailable: ${lastErr?.message || "no response"}` });
      const latest = await loadConversations(companyId,person);
      if (!latest || emailEvidenceFingerprint(latest.conversations,latest.company.is_landlord) !== evidenceKey) {
        if (out.company.is_landlord) landlordEmailLoads.invalidate(companyId);
        return res.json({ summary: null, evidenceKey: latest ? emailEvidenceFingerprint(latest.conversations,latest.company.is_landlord) : null });
      }
      const summary = { text, at: new Date().toISOString(), last: out.conversations[0].last, evidenceKey, privacyPolicy:PRIVATE_MAIL_POLICY_VERSION };
      if (person) {
        if (personEmailSummaries.size >= 200) personEmailSummaries.delete(personEmailSummaries.keys().next().value!);
        personEmailSummaries.set(personSummaryKey(companyId,person), {summary,expires:Date.now()+20*60_000});
      } else await pool.query(`UPDATE crm_companies SET ai_generated_fields = COALESCE(ai_generated_fields, '{}'::jsonb) || jsonb_build_object('email_summary', $2::jsonb) WHERE id = $1`, [companyId, JSON.stringify(summary)]);
      if (out.company.is_landlord) landlordEmailLoads.invalidate(companyId);
      res.json({ summary });
    } catch (err: any) { res.status(err?.status || 500).json({ error: err.message }); }
  });
}
