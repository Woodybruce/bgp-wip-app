// ─────────────────────────────────────────────────────────────────────────
// Expense auto-classify — receipt + calendar + Claude → suggestions.
//
// What the user wants on mobile: snap a receipt photo and have the app
// figure out the business purpose, who was at dinner, which deal it's
// for. They confirm. Done.
//
// Pipeline:
//   1. Look up the expense's most recent receipt parse (we already OCR
//      receipts on upload via expense-receipt-parser → merchant / total /
//      date / category / confidence).
//   2. Find the user's email from cardholder.user_id → users.email.
//   3. Fetch their Outlook calendar entries for the transaction date
//      (±1 day window) via Microsoft Graph using the system app token.
//   4. Match calendar attendees against CRM contacts by email.
//   5. Send the full bundle (receipt parse + calendar entries + matched
//      contacts) to Claude Sonnet with strict JSON output. The model:
//        — picks the most likely category from the firm's nominal list
//        — writes a one-line business purpose
//        — picks attendees from the matched-contact list (entertainment
//          categories only)
//        — picks a related deal / property if the calendar subject names
//          one
//        — surfaces a single follow-up question when something's
//          genuinely ambiguous (no calendar entry that matches, multiple
//          plausible meetings, etc.)
//   6. Returns the suggestion. The client renders it as a pre-filled
//      form the user confirms.
//
// Deliberately non-persistent — every call is fresh. Cheap (~1c per call
// on Sonnet vision) and avoids stale cached suggestions if the user
// edits their calendar after uploading.
// ─────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { db } from "./db";
import { expenses, expenseReceipts, stripeCardholders, users } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { graphRequest } from "./shared-mailbox";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface CalendarAttendee {
  email: string;
  name: string | null;        // Graph "emailAddress.name" — usually the display name
}
interface CalendarEvent {
  subject: string;
  start: string;
  end: string;
  bodyPreview: string;
  organizerEmail: string | null;
  attendees: CalendarAttendee[];
}

interface AutoClassifyResult {
  merchant: string | null;
  category: string | null;
  businessPurpose: string | null;
  attendeeContactIds: string[];
  // Attendees from the matched calendar event that AREN'T in crm_contacts.
  // Email + display name so the client can offer "Add to CRM" buttons
  // that enrich via Apollo/RocketReach. HMRC also needs the names for
  // entertainment compliance even if we can't enrich.
  proposedAttendees: { email: string; name: string }[];
  relatedDealId: string | null;
  relatedPropertyId: string | null;
  followUpQuestion: string | null;
  confidence: "high" | "medium" | "low";
  // Echo the source data back to the client so the UI can render the
  // reasoning ("matched to your 7pm dinner with Mark Warne at Quo Vadis")
  reasoning: string | null;
  matchedCalendarEvent: {
    subject: string;
    start: string;
    attendees: { email: string; name: string | null }[];
  } | null;
  matchedContactCount: number;
}

const CATEGORIES = [
  "Client Entertainment", "Agent Entertainment (External)", "Staff Entertainment",
  "Directors Meetings", "Subsistence", "Meals & Drinks",
  "Travel - Train", "Travel - Tube", "Travel - Taxi", "Travel - Flights",
  "Travel - Hotels", "Travel - Car Hire", "Travel - Parking & Tolls", "Travel - TFL Bike",
  "Marketing & Advertising", "Office Supplies / Stationery", "Office Expenses (general)",
  "Printing - Pitch Documents", "Software (subscriptions)", "IT Charges",
  "Mobile Phone", "Phone & Internet", "Premises Expenses", "RICS Fees",
  "Training", "Subscriptions - Magazines/Memberships",
];

async function fetchCalendarForDay(userEmail: string, date: Date): Promise<CalendarEvent[]> {
  // ±1 day window catches receipts uploaded the morning after a late
  // dinner that timezone-shifted into the wrong day.
  const start = new Date(date); start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0);
  const end = new Date(date); end.setDate(end.getDate() + 1); end.setHours(23, 59, 59, 999);
  const url = `/users/${encodeURIComponent(userEmail)}/calendarView?startDateTime=${start.toISOString()}&endDateTime=${end.toISOString()}&$select=id,subject,start,end,attendees,organizer,bodyPreview&$top=50&$orderby=start/dateTime`;
  try {
    const data = await graphRequest(url);
    return (data?.value || []).map((e: any) => ({
      subject: e.subject || "",
      start: e.start?.dateTime || "",
      end: e.end?.dateTime || "",
      bodyPreview: (e.bodyPreview || "").slice(0, 300),
      organizerEmail: e.organizer?.emailAddress?.address || null,
      attendees: (e.attendees || [])
        .map((a: any) => ({
          email: (a.emailAddress?.address || "").toLowerCase(),
          name: a.emailAddress?.name || null,
        }))
        .filter((a: CalendarAttendee) => a.email),
    }));
  } catch (err: any) {
    console.warn(`[expense-auto-classify] calendar fetch failed for ${userEmail}: ${err?.message}`);
    return [];
  }
}

async function matchAttendeesToCrmContacts(
  attendeeEmails: string[],
): Promise<Array<{ id: string; name: string; email: string }>> {
  if (attendeeEmails.length === 0) return [];
  const lower = attendeeEmails.map((e) => e.toLowerCase());
  const { rows } = await pool.query<{ id: string; name: string; email: string }>(
    `SELECT id, name, email FROM crm_contacts WHERE lower(email) = ANY($1::text[]) LIMIT 50`,
    [lower],
  );
  return rows;
}

export async function autoClassifyExpense(expenseId: string): Promise<AutoClassifyResult> {
  const [exp] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (!exp) throw new Error("Expense not found");

  // Resolve the cardholder → user → email so we know which calendar to query.
  let userEmail: string | null = null;
  if (exp.cardholderId) {
    const [ch] = await db.select().from(stripeCardholders).where(eq(stripeCardholders.id, exp.cardholderId)).limit(1);
    if (ch?.userId) {
      const [u] = await db.select().from(users).where(eq(users.id, ch.userId)).limit(1);
      userEmail = u?.email || null;
    }
  }

  // Find the most recent receipt for this expense. We'll re-OCR if we
  // need fresh data, but for the demo flow the upload endpoint already
  // populated exp.merchant + exp.category from the parse — just trust those.
  const [receipt] = await db.select().from(expenseReceipts).where(eq(expenseReceipts.expenseId, expenseId)).orderBy(desc(expenseReceipts.createdAt)).limit(1);

  // Calendar for the transaction date.
  const txDate = exp.transactionDate ? new Date(exp.transactionDate) : new Date();
  const calendar = userEmail ? await fetchCalendarForDay(userEmail, txDate) : [];

  // Pre-match attendees from the day's events against CRM contacts —
  // gives the model a short list of likely names rather than guessing.
  const allAttendeeEmails = Array.from(new Set(calendar.flatMap((c) => c.attendees.map((a) => a.email))));
  const matchedContacts = await matchAttendeesToCrmContacts(allAttendeeEmails);

  // Build a compact prompt — Claude doesn't need every calendar entry,
  // just the ones within a few hours of the receipt time if we have one.
  const promptCalendar = calendar.slice(0, 15).map((c) => ({
    subject: c.subject,
    start: c.start,
    end: c.end,
    bodyPreview: c.bodyPreview,
    attendees: c.attendees,            // {email,name}[] — gives Claude the display name
  }));

  const systemPrompt =
    `You are classifying a BGP company-card expense.\n\n` +
    `Pick the most likely category from this list ONLY:\n${CATEGORIES.join(", ")}\n\n` +
    `If the expense looks like a meal/drinks AND the calendar shows a meeting at roughly the same time, ` +
    `pick the entertainment category that matches (Client / Staff / Agent / Directors). Otherwise pick the ` +
    `most specific category that fits.\n\n` +
    `For the businessPurpose, write ONE clear sentence describing what this was for. Reference the calendar ` +
    `subject if relevant. Don't invent attendees not on the calendar.\n\n` +
    `For attendees, list ONLY contact ids from the matchedContacts array — never guess. If no match, leave empty.\n\n` +
    `If you genuinely can't tell what this is for (no calendar entry that matches the time, ambiguous merchant), ` +
    `set a one-line followUpQuestion. Otherwise leave it null.\n\n` +
    `Output ONLY valid JSON with this exact shape (no prose, no markdown):\n` +
    `{"category": string, "businessPurpose": string, "attendeeContactIds": string[], "followUpQuestion": string|null, "confidence": "high"|"medium"|"low", "reasoning": string, "matchedEventIndex": number|null}`;

  const userPrompt = JSON.stringify({
    receipt: {
      merchant: exp.merchant,
      amountPence: exp.amountPence,
      transactionDate: exp.transactionDate,
      currentCategory: exp.category,
    },
    calendar: promptCalendar,
    matchedContacts: matchedContacts.map((c) => ({ id: c.id, name: c.name, email: c.email })),
  });

  let result: AutoClassifyResult = {
    merchant: exp.merchant || null,
    category: exp.category || null,
    businessPurpose: exp.businessPurpose || null,
    attendeeContactIds: [],
    proposedAttendees: [],
    relatedDealId: exp.relatedDealId || null,
    relatedPropertyId: exp.relatedPropertyId || null,
    followUpQuestion: null,
    confidence: "low",
    reasoning: null,
    matchedCalendarEvent: null,
    matchedContactCount: matchedContacts.length,
  };

  try {
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = resp.content?.[0]?.type === "text" ? resp.content[0].text : "";
    const js = text.indexOf("{");
    const je = text.lastIndexOf("}");
    if (js < 0 || je <= js) throw new Error("Claude response wasn't JSON");
    const parsed = JSON.parse(text.slice(js, je + 1));

    result.category = parsed.category || result.category;
    result.businessPurpose = parsed.businessPurpose || result.businessPurpose;
    result.attendeeContactIds = Array.isArray(parsed.attendeeContactIds)
      ? parsed.attendeeContactIds.filter((id: any) => typeof id === "string" && matchedContacts.some((c) => c.id === id))
      : [];
    result.followUpQuestion = parsed.followUpQuestion || null;
    result.confidence = parsed.confidence === "high" || parsed.confidence === "medium" ? parsed.confidence : "low";
    result.reasoning = parsed.reasoning || null;
    if (typeof parsed.matchedEventIndex === "number" && promptCalendar[parsed.matchedEventIndex]) {
      const ev = promptCalendar[parsed.matchedEventIndex];
      result.matchedCalendarEvent = {
        subject: ev.subject,
        start: ev.start,
        attendees: ev.attendees,
      };
      // Surface every attendee on the matched event who isn't already a
      // CRM contact. Drop the user's own address (no point listing
      // yourself) and dedupe by email. Client offers "Add to CRM" per row.
      const userEmailLower = (userEmail || "").toLowerCase();
      const matchedCrmEmails = new Set(matchedContacts.map((c) => c.email.toLowerCase()));
      const proposed = new Map<string, { email: string; name: string }>();
      for (const a of ev.attendees) {
        if (!a.email || a.email === userEmailLower) continue;
        if (matchedCrmEmails.has(a.email)) continue;
        if (proposed.has(a.email)) continue;
        const fallback = a.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const display = (a.name && a.name.trim()) || fallback;
        proposed.set(a.email, { email: a.email, name: display });
      }
      result.proposedAttendees = Array.from(proposed.values());
    }
  } catch (err: any) {
    console.warn(`[expense-auto-classify] Claude call failed for ${expenseId}: ${err?.message}`);
    result.followUpQuestion = "AI classification failed — please categorise manually.";
  }

  return result;
}

export function registerExpenseAutoClassifyRoutes(app: Express) {
  // Single endpoint: classify on demand. Mobile calls this right after
  // the receipt upload completes (the upload endpoint already parses
  // merchant/total/category; this layers calendar + attendee suggestions
  // on top).
  app.post("/api/expenses/:id/auto-classify", requireAuth, async (req: Request, res: Response) => {
    try {
      const expenseId = String(req.params.id);
      const result = await autoClassifyExpense(expenseId);
      res.json(result);
    } catch (err: any) {
      console.error(`[expense-auto-classify] ${req.params.id}: ${err?.message}`);
      res.status(500).json({ error: err?.message || "Auto-classify failed" });
    }
  });

  // Add a person to crm_contacts from an email + (optional) display name.
  // Enriches via Apollo → RocketReach → fallback and links/creates the
  // company by domain. Returns the new contact row so the caller can
  // immediately attach them to an expense.
  app.post("/api/contacts/from-email", requireAuth, async (req: Request, res: Response) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      if (!email || !/^.+@.+\..+/.test(email)) return res.status(400).json({ error: "Valid email required" });
      const fallbackName = req.body?.name ? String(req.body.name) : undefined;

      // Duplicate guard — never create a second row for the same email.
      const existing = await pool.query<{ id: string; name: string }>(
        "SELECT id, name FROM crm_contacts WHERE lower(email) = $1 LIMIT 1",
        [email],
      );
      if (existing.rows[0]) {
        return res.json({ contact: existing.rows[0], created: false, source: "existing" });
      }

      const { enrichPersonFromEmail } = await import("./enrich-person-from-email");
      const enriched = await enrichPersonFromEmail(email, fallbackName);

      // Look up the company by domain — match on website containing the
      // domain. If nothing found and we have a company name, create a
      // stub company so the contact has a parent.
      let companyId: string | null = null;
      if (enriched.companyDomain) {
        const co = await pool.query<{ id: string; name: string }>(
          "SELECT id, name FROM crm_companies WHERE website ILIKE $1 OR website ILIKE $2 LIMIT 1",
          [`%${enriched.companyDomain}%`, `%${enriched.companyDomain.replace(/^www\./, "")}%`],
        );
        if (co.rows[0]) companyId = co.rows[0].id;
      }
      if (!companyId && enriched.companyName) {
        const insertCo = await pool.query<{ id: string }>(
          `INSERT INTO crm_companies (name, website, company_type)
           VALUES ($1, $2, 'Contact')
           RETURNING id`,
          [enriched.companyName, enriched.companyDomain || null],
        );
        companyId = insertCo.rows[0]?.id || null;
      }

      const insert = await pool.query<{ id: string }>(
        `INSERT INTO crm_contacts
           (name, role, email, phone, phone_mobile, linkedin_url, company_id, company_name, enrichment_source, last_enriched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         RETURNING id`,
        [
          enriched.name,
          enriched.role,
          enriched.email,
          enriched.phone,
          enriched.mobile,
          enriched.linkedin,
          companyId,
          enriched.companyName,
          enriched.source === "fallback" ? "expense-attendee-fallback" : `expense-attendee-${enriched.source}`,
        ],
      );
      res.json({
        contact: { id: insert.rows[0].id, name: enriched.name, email: enriched.email, role: enriched.role, companyName: enriched.companyName },
        created: true,
        source: enriched.source,
      });
    } catch (err: any) {
      console.error(`[contacts/from-email] ${req.body?.email}: ${err?.message}`);
      res.status(500).json({ error: err?.message || "Failed to add contact" });
    }
  });
}
