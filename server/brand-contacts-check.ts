// An AI sense check of a brand's Key contacts board (Woody, 2026-09-25:
// "can we get the internal AI to sense check each contact board?"). It reads
// the saved contacts beside BGP's email history with the brand's domain and
// says who actually leads on property, what looks wrong (a mailbox saved as
// a person, a duplicate, a title that doesn't fit) and who BGP emails but
// hasn't saved. Staff-only; cached until the contacts or emails change.
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import type { Router, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { safeParseJSON } from "./utils/anthropic-client";
import { contactTier } from "../shared/contact-tiers";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODELS = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"];

// Everyone at the brand's domain BGP has emailed with, CRM or not.
const DOMAIN_SENDERS_SQL = `
  SELECT LOWER(p) AS email, COUNT(*)::int AS threads, MAX(interaction_date) AS last_touch
    FROM crm_interactions
    CROSS JOIN LATERAL jsonb_array_elements_text(participants) AS p
   WHERE participants IS NOT NULL AND jsonb_typeof(participants) = 'array'
     AND interaction_date <= NOW() AND p ILIKE $1
   GROUP BY LOWER(p)
   ORDER BY threads DESC, last_touch DESC
   LIMIT 40`;

export type ContactsCheck = {
  summary: string[];
  lead: string | null;
  flags: Array<{ contactId: string; issue: string; note: string }>;
  missing: Array<{ email: string; note: string }>;
};

export function contactsCheckPrompt(brand: string, domain: string, contacts: any[], senders: any[]) {
  const byEmail = new Map(senders.map((s: any) => [String(s.email), s]));
  const rows = contacts.map((c: any) => {
    const mail = c.email ? byEmail.get(String(c.email).toLowerCase()) : null;
    const tier = contactTier(c.role);
    return `- id=${c.id} · ${c.name} · ${c.role || "no title"} · ${c.email || "no email"} · board: ${tier ? (tier === "property" ? "key (property)" : "key (C-suite)") : "hidden"} · BGP emails: ${mail ? `${mail.threads} threads, last ${String(mail.last_touch).slice(0, 10)}` : "none"}`;
  });
  const saved = new Set(contacts.map((c: any) => String(c.email || "").toLowerCase()).filter(Boolean));
  const unsaved = senders.filter((s: any) => !saved.has(String(s.email))).slice(0, 15)
    .map((s: any) => `- ${s.email} · ${s.threads} threads, last ${String(s.last_touch).slice(0, 10)}`);
  return `You are checking the contact list BGP (a London retail/leisure property agency) keeps for ${brand} (${domain}). The board shows only property people and C-suite / founders ("key"); everyone else is hidden.

Saved contacts:
${rows.join("\n") || "(none)"}

People at @${domain} BGP emails with who are NOT saved:
${unsaved.join("\n") || "(none)"}

Return JSON only:
{"summary":["2-4 short plain sentences: who leads on property for BGP (name them), whether the key list looks right, anything to fix"],
 "lead":"id of the saved contact who is BGP's main property contact, or null",
 "flags":[{"contactId":"id","issue":"not_a_person|duplicate|title_mismatch|should_be_key|should_be_hidden|stale","note":"one short reason"}],
 "missing":[{"email":"an unsaved address worth adding","note":"why (e.g. 55 threads, looks like the acquisitions lead)"}]}
Rules: a role mailbox or joke name (info@, "Chicken Wing") is not_a_person. Two rows for one person are duplicate. Only flag what the data shows — no guesses about people's jobs beyond their title and email activity. Flag at most 6 contacts and list at most 3 missing.`;
}

async function loadInputs(companyId: string) {
  const co = (await pool.query(`SELECT id, name, domain, domain_url FROM crm_companies WHERE id = $1`, [companyId])).rows[0];
  if (!co) return null;
  const domain = String(co.domain || co.domain_url || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").toLowerCase();
  const contacts = (await pool.query(`SELECT id, name, role, email FROM crm_contacts WHERE company_id = $1 ORDER BY name LIMIT 80`, [companyId])).rows;
  const senders = domain ? (await pool.query(DOMAIN_SENDERS_SQL, [`%@${domain}`]).catch(() => ({ rows: [] as any[] }))).rows : [];
  const fingerprint = createHash("sha1").update(JSON.stringify([contacts.map((c: any) => [c.id, c.name, c.role, c.email]), senders.map((s: any) => [s.email, s.threads])])).digest("hex");
  return { co, domain, contacts, senders, fingerprint };
}

async function staffOnly(req: Request, res: Response) {
  const { resolveCompanyScope } = await import("./company-scope");
  if (await resolveCompanyScope(req as any)) { res.status(403).json({ error: "Available in the staff view." }); return false; }
  return true;
}

const cacheKey = (companyId: string) => `contacts-check:${companyId}`;

export function registerBrandContactsCheckRoutes(router: Router) {
  router.get("/api/brand/:companyId/contacts-check", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const companyId = String(req.params.companyId);
      const inputs = await loadInputs(companyId);
      if (!inputs) return res.status(404).json({ error: "Company not found" });
      const saved = (await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [cacheKey(companyId)])).rows[0]?.value || null;
      res.json({ check: saved?.fingerprint === inputs.fingerprint ? saved.check : null, stale: !!saved && saved.fingerprint !== inputs.fingerprint, at: saved?.at || null, contacts: inputs.contacts.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  router.post("/api/brand/:companyId/contacts-check", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await staffOnly(req, res))) return;
      const companyId = String(req.params.companyId);
      const inputs = await loadInputs(companyId);
      if (!inputs) return res.status(404).json({ error: "Company not found" });
      if (!inputs.contacts.length && !inputs.senders.length) return res.json({ check: null });
      const prompt = contactsCheckPrompt(inputs.co.name, inputs.domain || "no website", inputs.contacts, inputs.senders);
      let parsed: any = null;
      let lastErr: any = null;
      for (const model of MODELS) {
        try {
          const msg = await anthropic.messages.create({ model, max_tokens: 900, messages: [{ role: "user", content: prompt }, { role: "assistant", content: "{" }] }, { timeout: 35_000, maxRetries: 0 });
          const text = "{" + msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
          parsed = safeParseJSON(text);
          if (parsed) break;
        } catch (e: any) { lastErr = e; }
      }
      if (!parsed) return res.status(502).json({ error: `Check unavailable: ${lastErr?.message || "no answer"}` });
      const ids = new Set(inputs.contacts.map((c: any) => String(c.id)));
      const check: ContactsCheck = {
        summary: (Array.isArray(parsed.summary) ? parsed.summary : []).map(String).slice(0, 4),
        lead: parsed.lead && ids.has(String(parsed.lead)) ? String(parsed.lead) : null,
        flags: (Array.isArray(parsed.flags) ? parsed.flags : []).filter((f: any) => ids.has(String(f?.contactId))).slice(0, 6)
          .map((f: any) => ({ contactId: String(f.contactId), issue: String(f.issue || ""), note: String(f.note || "").slice(0, 160) })),
        missing: (Array.isArray(parsed.missing) ? parsed.missing : []).filter((m: any) => inputs.senders.some((s: any) => s.email === String(m?.email || "").toLowerCase())).slice(0, 3)
          .map((m: any) => ({ email: String(m.email).toLowerCase(), note: String(m.note || "").slice(0, 160) })),
      };
      const value = { check, fingerprint: inputs.fingerprint, at: new Date().toISOString() };
      await pool.query(`INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [cacheKey(companyId), JSON.stringify(value)]);
      res.json({ check, at: value.at });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
