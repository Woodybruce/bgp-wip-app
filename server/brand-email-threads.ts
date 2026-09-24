// A brand's email history with BGP, as conversations: subject, who at BGP,
// who at the brand, other parties, when, and the latest preview — plus a
// short AI read of what the emails are about (Woody, 2026-09-24: "need to
// be able to see summary of those ... understand the context, who to etc").
// Staff-only: built from BGP's correspondence log (crm_interactions).
import Anthropic from "@anthropic-ai/sdk";
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
};

const normSubject = (subject: string | null) => (subject || "(no subject)").replace(/^\s*((re|fw|fwd|aw|sv)\s*(\[\d+\])?\s*:\s*)+/i, "").replace(/\s+/g, " ").trim() || "(no subject)";

const cleanPreview = (text: string | null) => (text || "")
  .replace(/\r/g, "")
  .split(/\n\s*(From:|-----Original|On .{5,80} wrote:)/)[0]
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 220);

const personList = (participants: unknown): string[] => {
  const list = Array.isArray(participants) ? participants : [];
  return list.map(p => String(p || "").trim().toLowerCase()).filter(p => p.includes("@"));
};

export function groupEmailConversations(rows: any[], domain: string): EmailConversation[] {
  const at = `@${domain.toLowerCase()}`;
  const byKey = new Map<string, EmailConversation & { _bgp: Set<string>; _brand: Set<string>; _others: Set<string> }>();
  const sorted = [...rows].sort((a, b) => new Date(b.interaction_date).getTime() - new Date(a.interaction_date).getTime());
  for (const row of sorted) {
    const subject = normSubject(row.subject);
    const key = subject.toLowerCase();
    const date = new Date(row.interaction_date).toISOString();
    let conv = byKey.get(key);
    if (!conv) {
      conv = { subject, messages: 0, first: date, last: date, bgp: [], brand: [], others: [], preview: cleanPreview(row.preview), _bgp: new Set(), _brand: new Set(), _others: new Set() };
      byKey.set(key, conv);
    }
    conv.messages++;
    if (date < conv.first) conv.first = date;
    if (!conv.preview) conv.preview = cleanPreview(row.preview);
    const people = personList(row.participants);
    if (row.bgp_user) people.push(String(row.bgp_user).toLowerCase());
    for (const p of people) {
      if (p.endsWith(BGP_DOMAIN)) conv._bgp.add(p);
      else if (p.endsWith(at)) conv._brand.add(p);
      else conv._others.add(p);
    }
  }
  return Array.from(byKey.values()).map(({ _bgp, _brand, _others, ...conv }) => ({
    ...conv, bgp: Array.from(_bgp), brand: Array.from(_brand), others: Array.from(_others),
  }));
}

async function brandFor(companyId: string) {
  const c = (await pool.query(`SELECT id, name, domain, domain_url, ai_generated_fields FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
  if (!c) return null;
  const domain = String(c.domain || c.domain_url || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").toLowerCase();
  return { ...c, domain };
}

async function staffOnly(req: Request, res: Response) {
  const { resolveCompanyScope } = await import("./company-scope");
  if (await resolveCompanyScope(req as any)) { res.status(403).json({ error: "Email history is available in the staff view." }); return false; }
  return true;
}

async function loadConversations(companyId: string) {
  const c = await brandFor(companyId);
  if (!c) return null;
  if (!c.domain) return { company: c, conversations: [] as EmailConversation[] };
  const rows = (await pool.query(BRAND_EMAIL_ROWS_SQL, [`%@${c.domain}`, companyId])).rows;
  const conversations = groupEmailConversations(rows, c.domain);
  // Name the other firms copied in from the CRM by their email domain
  // (cwg.com → Canary Wharf Group), falling back to the domain itself.
  const domains = Array.from(new Set(conversations.flatMap(conv => conv.others.map(o => o.split("@")[1]))));
  const firmByDomain = new Map<string, string>();
  if (domains.length) {
    const hits = await pool.query(
      `SELECT DISTINCT ON (d) d, name FROM (
         SELECT LOWER(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(domain, domain_url, ''), '^https?://(www\.)?', '', 'i'), '/.*$', '')) AS d, name
           FROM crm_companies WHERE merged_into_id IS NULL) x
        WHERE d = ANY($1) ORDER BY d, length(name)`, [domains]).catch(() => ({ rows: [] as any[] }));
    for (const row of hits.rows) firmByDomain.set(row.d, row.name);
  }
  for (const conv of conversations) conv.firms = Array.from(new Set(conv.others.map(o => firmByDomain.get(o.split("@")[1]) || o.split("@")[1])));
  return { company: c, conversations };
}

const nameFromEmail = (email: string) => email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());

export function emailSummaryPrompt(brand: string, conversations: EmailConversation[]) {
  const lines = conversations.slice(0, 25).map(conv =>
    `- "${conv.subject}" · ${conv.messages} msg · ${conv.first.slice(0, 10)} → ${conv.last.slice(0, 10)} · BGP: ${conv.bgp.map(nameFromEmail).join(", ") || "—"} · ${brand}: ${conv.brand.map(nameFromEmail).join(", ") || "—"} · other people: ${conv.others.map(o => `${nameFromEmail(o)} (${o.split("@")[1]})`).join(", ") || "—"} · other firms: ${(conv.firms || []).join(", ") || "—"} · latest line (sender not recorded): ${conv.preview.slice(0, 160)}`);
  return `You are summarising BGP's (Bruce Gillingham Pollard, a London property agency) email history with ${brand} for a colleague who needs the context fast.

Email conversations, newest first:
${lines.join("\n")}

Write 3-5 short bullets, each starting "- **Label:** " (e.g. **What it's about:**, **Who:**, **Where it stands:**, **Also involved:**). Say what the emails are about (deals, sites, topics), who at BGP talks to whom at ${brand}, which other firms are copied (use the "other firms" names), and where the latest thread left off. Only BGP-listed people are BGP; everyone under "other people" belongs to the firm of their email domain. The sender of the latest line is not recorded — don't attribute it to anyone. Use only the dates given. Name people as they appear. No headings, no preamble. Under 110 words.`;
}

export function registerBrandEmailThreadRoutes(router: Router) {
  router.get("/api/brand/:companyId/email-threads", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const out = await loadConversations(String(req.params.companyId));
      if (!out) return res.status(404).json({ error: "Company not found" });
      const cached = out.company.ai_generated_fields?.email_summary || null;
      const last = out.conversations[0]?.last || null;
      res.json({ domain: out.company.domain, conversations: out.conversations.slice(0, 200), total: out.conversations.length, summary: cached && cached.last === last ? cached : null });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post("/api/brand/:companyId/email-threads/summary", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const companyId = String(req.params.companyId);
      const out = await loadConversations(companyId);
      if (!out) return res.status(404).json({ error: "Company not found" });
      if (!out.conversations.length) return res.json({ summary: null });
      const prompt = emailSummaryPrompt(out.company.name, out.conversations);
      let text = "";
      let lastErr: any = null;
      for (const model of MODELS) {
        try {
          const msg = await anthropic.messages.create({ model, max_tokens: 400, messages: [{ role: "user", content: prompt }] }, { timeout: 30_000, maxRetries: 0 });
          text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
          if (text) break;
        } catch (e: any) { lastErr = e; }
      }
      if (!text) return res.status(502).json({ error: `Summary unavailable: ${lastErr?.message || "no response"}` });
      const summary = { text, at: new Date().toISOString(), last: out.conversations[0].last };
      await pool.query(`UPDATE crm_companies SET ai_generated_fields = COALESCE(ai_generated_fields, '{}'::jsonb) || jsonb_build_object('email_summary', $2::jsonb) WHERE id = $1`, [companyId, JSON.stringify(summary)]);
      res.json({ summary });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
