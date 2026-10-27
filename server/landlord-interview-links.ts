import type { Querier } from "./account-resolver";
import { LANDLORD_CATALOGUE_PREDICATE, matchLandlordMeeting } from "./landlord-meeting-matching";

export interface LandlordInterviewMention {
  interviewId: string;
  team: string;
  interviewee: string | null;
  meetingDate: string | null;
  updatedAt: string | null;
  questionId: string;
  excerpt: string;
  companyId: string;
  companyName: string;
  sourceUrl: string;
}

type Company = { id: string; name: string; domain?: string | null; domain_url?: string | null; company_type?: string | null };
type Interview = { id: string; team: string; interviewee?: string | null; meeting_date?: string | null; updated_at?: Date | string | null; responses?: Record<string, unknown> | null };

// Recompute from saved answers: edits/deletions remove their old links without
// creating a second, stale copy of the interview on the company record.
export function linkLandlordInterviewMentions(interviews: Interview[], companies: Company[], match = matchLandlordMeeting): LandlordInterviewMention[] {
  const result: LandlordInterviewMention[] = [];
  const catalogue = companies.filter(c => !/^tenant/i.test(c.company_type || "")).map(c => ({ ...c,
    company_type: c.company_type || null, domain: c.domain || null, domain_url: c.domain_url || null, contacts: [] }));
  for (const iv of interviews) {
    if (!iv.responses || typeof iv.responses !== "object" || Array.isArray(iv.responses)) continue;
    const updated = iv.updated_at ? new Date(iv.updated_at) : null;
    const updatedAt = updated && Number.isFinite(updated.getTime()) ? updated.toISOString() : null;
    for (const [questionId, answer] of Object.entries(iv.responses)) {
      if (typeof answer !== "string" || !answer.trim()) continue;
      // Keep a full sentence/paragraph as evidence; a mention is not a confirmed
      // instruction, meeting date, task, or relationship owner.
      const sentences = answer.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
      const matches = new Map<string, { company: Company; sentences: string[] }>();
      for (const s of sentences) {
        const emails = s.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) || [];
        for (const { company } of match(s, emails.map(email => ({ email, name: "" })), catalogue)) {
          const linked = matches.get(company.id) || { company, sentences: [] };
          linked.sentences.push(s);
          matches.set(company.id, linked);
        }
      }
      for (const { company, sentences: linkedSentences } of matches.values()) {
        result.push({ interviewId: iv.id, team: iv.team, interviewee: iv.interviewee || null,
          meetingDate: iv.meeting_date || null, updatedAt,
          questionId, excerpt: linkedSentences.join(" ").slice(0, 1800), companyId: company.id, companyName: company.name,
          sourceUrl: `/contacts?tab=meetings&interview=${encodeURIComponent(iv.id)}` });
      }
    }
  }
  return result.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.companyName.localeCompare(b.companyName));
}

export async function getLandlordInterviewMentions(companyId?: string, deps: { pool?: Querier } = {}): Promise<LandlordInterviewMention[]> {
  const q = deps.pool || (await import("./db")).pool;
  const [companies, interviews] = await Promise.all([
    q.query(`SELECT c.id, c.name, c.company_type, c.domain, c.domain_url FROM crm_companies c
      WHERE ${LANDLORD_CATALOGUE_PREDICATE}`),
    q.query(`SELECT id, team, interviewee, meeting_date, updated_at, responses FROM crm_interviews WHERE responses IS NOT NULL ORDER BY updated_at DESC`),
  ]);
  const links = linkLandlordInterviewMentions(interviews.rows, companies.rows);
  return companyId ? links.filter(link => link.companyId === companyId) : links;
}
