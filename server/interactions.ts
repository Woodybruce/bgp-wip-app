import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { getAppToken } from "./shared-mailbox";
import { db } from "./db";
import { crmInteractions, crmContacts, crmCompanies, crmRequirementsLeasing, crmRequirementsInvestment, crmDeals } from "@shared/schema";
import { eq, desc, and, gte, lte, sql, inArray } from "drizzle-orm";

import { pool } from "./db";
import { users as usersTable } from "@shared/schema";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function getBgpEmails(): Promise<string[]> {
  try {
    const result = await db
      .select({ email: usersTable.email })
      .from(usersTable);
    return result
      .filter(u => u.email && u.email.endsWith("@brucegillinghampollard.com"))
      .map(u => u.email!.toLowerCase());
  } catch (err: any) {
    console.error("[interactions] getBGPUserEmails error:", err?.message);
    return [];
  }
}

async function trackEmailActivity(userEmail: string, emailCount: number, calendarCount: number) {
  try {
    const userResult = await pool.query("SELECT id FROM users WHERE LOWER(email) = LOWER($1)", [userEmail]);
    if (userResult.rows.length === 0) return;
    const userId = userResult.rows[0].id;
    await pool.query(
      `INSERT INTO user_activity (user_id, last_active_at) VALUES ($1, NOW())
       ON CONFLICT (user_id) DO UPDATE SET last_active_at = GREATEST(user_activity.last_active_at, NOW())`,
      [userId]
    );
  } catch (err: any) { console.error("[interactions] trackEmailActivity error:", err?.message); }
}

interface ContactMatch {
  id: string;
  name: string;
  email: string | null;
  companyId: string | null;
  companyName: string | null;
}

async function graphGet(token: string, url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function getAllContacts(): Promise<ContactMatch[]> {
  const contacts = await db
    .select({
      id: crmContacts.id,
      name: crmContacts.name,
      email: crmContacts.email,
      companyId: crmContacts.companyId,
      companyName: crmContacts.companyName,
    })
    .from(crmContacts);
  return contacts;
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

function matchEmailToContact(
  emailAddress: string,
  contacts: ContactMatch[]
): { contact: ContactMatch; method: string } | null {
  const normalized = normalizeEmail(emailAddress);
  if (normalized.endsWith("@brucegillinghampollard.com")) return null;

  for (const c of contacts) {
    if (c.email && normalizeEmail(c.email) === normalized) {
      return { contact: c, method: "email" };
    }
  }
  return null;
}

function matchKeywordsToContacts(
  text: string,
  contacts: ContactMatch[],
  companies: { id: string; name: string }[]
): { contact: ContactMatch; method: string }[] {
  const matches: { contact: ContactMatch; method: string }[] = [];
  const lower = text.toLowerCase();
  const seenContactIds = new Set<string>();

  for (const company of companies) {
    if (company.name.length >= 3 && lower.includes(company.name.toLowerCase())) {
      const companyContacts = contacts.filter((c) => c.companyId === company.id);
      for (const c of companyContacts) {
        if (!seenContactIds.has(c.id)) {
          seenContactIds.add(c.id);
          matches.push({ contact: c, method: "keyword_company" });
        }
      }
    }
  }

  for (const c of contacts) {
    if (seenContactIds.has(c.id)) continue;
    const nameParts = c.name.split(" ").filter((p) => p.length >= 3);
    if (nameParts.length >= 2) {
      const fullName = c.name.toLowerCase();
      if (lower.includes(fullName)) {
        seenContactIds.add(c.id);
        matches.push({ contact: c, method: "keyword_name" });
      }
    }
  }

  return matches;
}

async function graphGetPaged(token: string, url: string, maxPages: number = 5): Promise<any[]> {
  const allItems: any[] = [];
  let nextUrl: string | null = url;
  let page = 0;

  while (nextUrl && page < maxPages) {
    const data = await graphGet(token, nextUrl);
    if (data.value) allItems.push(...data.value);
    nextUrl = data["@odata.nextLink"] || null;
    page++;
  }

  return allItems;
}

async function syncEmailsForUser(
  token: string,
  userEmail: string,
  contacts: ContactMatch[],
  companies: { id: string; name: string }[],
  daysBack: number,
  existingMsIds: Set<string>
): Promise<number> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  let count = 0;

  try {
    const url = `${GRAPH_BASE}/users/${userEmail}/messages?$filter=receivedDateTime ge ${since}&$select=id,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime&$top=100&$orderby=receivedDateTime desc`;
    const messages = await graphGetPaged(token, url, 5);

    for (const msg of messages) {
      const msId = `email_${msg.id}`;
      if (existingMsIds.has(msId)) continue;

      const allAddresses: string[] = [];
      if (msg.from?.emailAddress?.address) allAddresses.push(msg.from.emailAddress.address);
      if (msg.toRecipients) {
        for (const r of msg.toRecipients) {
          if (r.emailAddress?.address) allAddresses.push(r.emailAddress.address);
        }
      }
      if (msg.ccRecipients) {
        for (const r of msg.ccRecipients) {
          if (r.emailAddress?.address) allAddresses.push(r.emailAddress.address);
        }
      }

      const emailMatches: { contact: ContactMatch; method: string }[] = [];
      for (const addr of allAddresses) {
        const m = matchEmailToContact(addr, contacts);
        if (m) emailMatches.push(m);
      }

      const searchText = `${msg.subject || ""} ${msg.bodyPreview || ""}`;
      const keywordMatches = matchKeywordsToContacts(searchText, contacts, companies);

      const allMatches = [...emailMatches];
      const seenIds = new Set(emailMatches.map((m) => m.contact.id));
      for (const km of keywordMatches) {
        if (!seenIds.has(km.contact.id)) {
          allMatches.push(km);
          seenIds.add(km.contact.id);
        }
      }

      const fromAddr = msg.from?.emailAddress?.address?.toLowerCase() || "";
      const isBgpSender = fromAddr.endsWith("@brucegillinghampollard.com");

      for (const match of allMatches) {
        try {
          await db.insert(crmInteractions).values({
            contactId: match.contact.id,
            companyId: match.contact.companyId,
            type: "email",
            direction: isBgpSender ? "outbound" : "inbound",
            subject: msg.subject || "(No subject)",
            preview: (msg.bodyPreview || "").substring(0, 200),
            participants: allAddresses.map((a: string) => a.toLowerCase()),
            microsoftId: msId,
            matchMethod: match.method,
            interactionDate: new Date(msg.receivedDateTime),
            bgpUser: userEmail,
          });
          existingMsIds.add(msId);
          count++;
        } catch (e: any) {
          if (!e.message?.includes("duplicate")) {
            console.error("Insert interaction error:", e.message);
          }
        }
      }
    }
  } catch (e: any) {
    console.log(`Sync emails for ${userEmail}: ${e.message}`);
  }

  return count;
}

function parseGraphDateTime(start: { dateTime: string; timeZone: string }): Date {
  if (start.timeZone === "UTC") {
    return new Date(start.dateTime + "Z");
  }
  return new Date(start.dateTime);
}

async function syncCalendarForUser(
  token: string,
  userEmail: string,
  contacts: ContactMatch[],
  companies: { id: string; name: string }[],
  daysBack: number,
  daysForward: number,
  existingMsIds: Set<string>
): Promise<number> {
  const start = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + daysForward * 24 * 60 * 60 * 1000).toISOString();
  let count = 0;

  try {
    const url = `${GRAPH_BASE}/users/${userEmail}/calendarView?startDateTime=${start}&endDateTime=${end}&$select=id,subject,start,end,attendees,organizer,bodyPreview&$top=100&$orderby=start/dateTime&Prefer=outlook.timezone="UTC"`;
    const events = await graphGetPaged(token, url, 3);

    for (const event of events) {
      const msId = `cal_${event.id}`;
      if (existingMsIds.has(msId)) continue;

      const allAddresses: string[] = [];
      if (event.organizer?.emailAddress?.address) {
        allAddresses.push(event.organizer.emailAddress.address);
      }
      if (event.attendees) {
        for (const a of event.attendees) {
          if (a.emailAddress?.address) allAddresses.push(a.emailAddress.address);
        }
      }

      const emailMatches: { contact: ContactMatch; method: string }[] = [];
      for (const addr of allAddresses) {
        const m = matchEmailToContact(addr, contacts);
        if (m) emailMatches.push(m);
      }

      const searchText = `${event.subject || ""} ${event.bodyPreview || ""}`;
      const keywordMatches = matchKeywordsToContacts(searchText, contacts, companies);

      const allMatches = [...emailMatches];
      const seenIds = new Set(emailMatches.map((m) => m.contact.id));
      for (const km of keywordMatches) {
        if (!seenIds.has(km.contact.id)) {
          allMatches.push(km);
          seenIds.add(km.contact.id);
        }
      }

      const eventDate = event.start ? parseGraphDateTime(event.start) : new Date();

      for (const match of allMatches) {
        try {
          await db.insert(crmInteractions).values({
            contactId: match.contact.id,
            companyId: match.contact.companyId,
            type: "meeting",
            direction: eventDate > new Date() ? "upcoming" : "past",
            subject: event.subject || "(No subject)",
            preview: (event.bodyPreview || "").substring(0, 200),
            participants: allAddresses.map((a: string) => a.toLowerCase()),
            microsoftId: msId,
            matchMethod: match.method,
            interactionDate: eventDate,
            bgpUser: userEmail,
          });
          existingMsIds.add(msId);
          count++;
        } catch (e: any) {
          if (!e.message?.includes("duplicate")) {
            console.error("Insert calendar interaction error:", e.message);
          }
        }
      }
    }
  } catch (e: any) {
    console.log(`Sync calendar for ${userEmail}: ${e.message}`);
  }

  return count;
}

async function runInteractionSync(daysBack = 30, daysForward = 60) {
  const token = await getAppToken();
  const contacts = await getAllContacts();
  const companiesRaw = await db
    .select({ id: crmCompanies.id, name: crmCompanies.name })
    .from(crmCompanies);

  const existing = await db
    .select({ microsoftId: crmInteractions.microsoftId })
    .from(crmInteractions)
    .where(sql`${crmInteractions.microsoftId} IS NOT NULL`);
  const existingMsIds = new Set(existing.map((e) => e.microsoftId!));

  const bgpEmails = await getBgpEmails();

  let totalEmails = 0;
  let totalCalendar = 0;
  const errors: string[] = [];
  const perUserStats: { email: string; emails: number; calendar: number }[] = [];

  for (const userEmail of bgpEmails) {
    try {
      const emailCount = await syncEmailsForUser(
        token, userEmail, contacts, companiesRaw, daysBack, existingMsIds
      );
      totalEmails += emailCount;

      const calCount = await syncCalendarForUser(
        token, userEmail, contacts, companiesRaw, daysBack, daysForward, existingMsIds
      );
      totalCalendar += calCount;

      perUserStats.push({ email: userEmail, emails: emailCount, calendar: calCount });
      if (emailCount > 0 || calCount > 0) {
        trackEmailActivity(userEmail, emailCount, calCount);
      }
    } catch (e: any) {
      errors.push(`${userEmail}: ${e.message}`);
    }
  }

  return {
    success: true,
    synced: { emails: totalEmails, calendar: totalCalendar },
    usersScanned: bgpEmails.length,
    perUserStats,
    errors: errors.length > 0 ? errors : undefined,
  };
}

interface EmailContactSuggestion {
  email: string;
  name: string;
  domain: string;
  frequency: number;
  bgpUsers: string[];
  lastSeen: string;
  sampleSubjects: string[];
}

async function discoverContactsFromEmail(daysBack = 90): Promise<{
  suggestions: EmailContactSuggestion[];
  scannedUsers: number;
  totalEmails: number;
  errors: string[];
}> {
  const token = await getAppToken();
  const existingContacts = await getAllContacts();
  const existingEmails = new Set(
    existingContacts
      .filter((c) => c.email)
      .map((c) => c.email!.toLowerCase().trim())
  );

  const contactMap = new Map<string, {
    name: string;
    domain: string;
    count: number;
    bgpUsers: Set<string>;
    lastSeen: Date;
    subjects: string[];
  }>();

  let totalEmails = 0;
  const errors: string[] = [];
  const bgpEmails = await getBgpEmails();

  for (const userEmail of bgpEmails) {
    try {
      const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
      const url = `${GRAPH_BASE}/users/${userEmail}/messages?$filter=receivedDateTime ge ${since}&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime&$top=200&$orderby=receivedDateTime desc`;
      const messages = await graphGetPaged(token, url, 3);
      totalEmails += messages.length;

      for (const msg of messages) {
        const addresses: { email: string; name: string }[] = [];

        if (msg.from?.emailAddress?.address) {
          addresses.push({
            email: msg.from.emailAddress.address.toLowerCase().trim(),
            name: msg.from.emailAddress.name || "",
          });
        }
        for (const r of (msg.toRecipients || [])) {
          if (r.emailAddress?.address) {
            addresses.push({
              email: r.emailAddress.address.toLowerCase().trim(),
              name: r.emailAddress.name || "",
            });
          }
        }
        for (const r of (msg.ccRecipients || [])) {
          if (r.emailAddress?.address) {
            addresses.push({
              email: r.emailAddress.address.toLowerCase().trim(),
              name: r.emailAddress.name || "",
            });
          }
        }

        for (const addr of addresses) {
          if (addr.email.endsWith("@brucegillinghampollard.com")) continue;
          if (existingEmails.has(addr.email)) continue;
          if (addr.email.includes("noreply") || addr.email.includes("no-reply") || addr.email.includes("notifications@") || addr.email.includes("mailer-daemon")) continue;

          const domain = addr.email.split("@")[1] || "";
          const genericDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "live.com", "msn.com", "me.com", "googlemail.com"];

          const existing = contactMap.get(addr.email);
          if (existing) {
            existing.count++;
            existing.bgpUsers.add(userEmail.split("@")[0]);
            if (new Date(msg.receivedDateTime) > existing.lastSeen) {
              existing.lastSeen = new Date(msg.receivedDateTime);
              if (addr.name && addr.name.length > existing.name.length) {
                existing.name = addr.name;
              }
            }
            if (msg.subject && existing.subjects.length < 3) {
              existing.subjects.push(msg.subject);
            }
          } else {
            contactMap.set(addr.email, {
              name: addr.name || addr.email.split("@")[0],
              domain: genericDomains.includes(domain) ? "" : domain,
              count: 1,
              bgpUsers: new Set([userEmail.split("@")[0]]),
              lastSeen: new Date(msg.receivedDateTime),
              subjects: msg.subject ? [msg.subject] : [],
            });
          }
        }
      }
    } catch (e: any) {
      errors.push(`${userEmail}: ${e.message}`);
    }
  }

  const suggestions: EmailContactSuggestion[] = Array.from(contactMap.entries())
    .map(([email, data]) => ({
      email,
      name: data.name,
      domain: data.domain,
      frequency: data.count,
      bgpUsers: Array.from(data.bgpUsers),
      lastSeen: data.lastSeen.toISOString(),
      sampleSubjects: data.subjects,
    }))
    .filter((s) => s.frequency >= 2)
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 200);

  return {
    suggestions,
    scannedUsers: bgpEmails.length,
    totalEmails,
    errors,
  };
}

async function computeEngagementScores(): Promise<{
  scores: Array<{
    contactId: string;
    contactName: string;
    companyName: string | null;
    totalInteractions: number;
    emailsIn: number;
    emailsOut: number;
    meetings: number;
    lastContact: string;
    engagementScore: number;
    trend: "rising" | "stable" | "cooling";
    bgpAgents: string[];
  }>;
}> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const recentInteractions = await db
    .select({
      contactId: crmInteractions.contactId,
      type: crmInteractions.type,
      direction: crmInteractions.direction,
      bgpUser: crmInteractions.bgpUser,
      interactionDate: crmInteractions.interactionDate,
    })
    .from(crmInteractions)
    .where(gte(crmInteractions.interactionDate, sixtyDaysAgo));

  const contactMap = new Map<string, {
    recent: number;
    older: number;
    emailsIn: number;
    emailsOut: number;
    meetings: number;
    lastContact: Date;
    agents: Set<string>;
  }>();

  for (const i of recentInteractions) {
    const existing = contactMap.get(i.contactId) || {
      recent: 0, older: 0, emailsIn: 0, emailsOut: 0, meetings: 0,
      lastContact: new Date(0), agents: new Set<string>(),
    };

    const iDate = new Date(i.interactionDate as any);
    if (iDate >= thirtyDaysAgo) {
      existing.recent++;
    } else {
      existing.older++;
    }

    if (i.type === "email" && i.direction === "inbound") existing.emailsIn++;
    if (i.type === "email" && i.direction === "outbound") existing.emailsOut++;
    if (i.type === "meeting") existing.meetings++;
    if (iDate > existing.lastContact) existing.lastContact = iDate;
    if (i.bgpUser) existing.agents.add(i.bgpUser.split("@")[0]);

    contactMap.set(i.contactId, existing);
  }

  const contactIds = Array.from(contactMap.keys());
  if (contactIds.length === 0) return { scores: [] };

  const contactDetails = await db
    .select({ id: crmContacts.id, name: crmContacts.name, companyName: crmContacts.companyName, email: crmContacts.email })
    .from(crmContacts)
    .where(inArray(crmContacts.id, contactIds));
  const detailMap = new Map(contactDetails.map(c => [c.id, c]));

  const scores = Array.from(contactMap.entries())
    .filter(([id]) => {
      const d = detailMap.get(id);
      return d && !d.email?.endsWith("@brucegillinghampollard.com");
    })
    .map(([id, data]) => {
      const total = data.recent + data.older;
      const score = Math.round(
        (data.recent * 3) + (data.older * 1) + (data.meetings * 5) +
        (data.emailsIn * 2) + (data.emailsOut * 1)
      );
      const trend: "rising" | "stable" | "cooling" =
        data.recent > data.older * 1.5 ? "rising" :
        data.recent < data.older * 0.5 ? "cooling" : "stable";

      const detail = detailMap.get(id);
      return {
        contactId: id,
        contactName: detail?.name || "Unknown",
        companyName: detail?.companyName || null,
        totalInteractions: total,
        emailsIn: data.emailsIn,
        emailsOut: data.emailsOut,
        meetings: data.meetings,
        lastContact: data.lastContact.toISOString(),
        engagementScore: score,
        trend,
        bgpAgents: Array.from(data.agents),
      };
    })
    .sort((a, b) => b.engagementScore - a.engagementScore)
    .slice(0, 100);

  return { scores };
}

async function computeAgentLeaderboard(): Promise<{
  leaderboard: Array<{
    agent: string;
    emailsSent: number;
    emailsReceived: number;
    meetingsHeld: number;
    meetingsUpcoming: number;
    uniqueContacts: number;
    totalActivity: number;
  }>;
}> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();

  const interactions = await db
    .select({
      bgpUser: crmInteractions.bgpUser,
      type: crmInteractions.type,
      direction: crmInteractions.direction,
      contactId: crmInteractions.contactId,
      interactionDate: crmInteractions.interactionDate,
    })
    .from(crmInteractions)
    .where(
      and(
        gte(crmInteractions.interactionDate, thirtyDaysAgo),
        sql`${crmInteractions.bgpUser} IS NOT NULL`
      )
    );

  const agentMap = new Map<string, {
    emailsSent: number;
    emailsReceived: number;
    meetingsHeld: number;
    meetingsUpcoming: number;
    contacts: Set<string>;
  }>();

  for (const i of interactions) {
    const agent = (i.bgpUser || "").split("@")[0];
    if (!agent) continue;
    const existing = agentMap.get(agent) || {
      emailsSent: 0, emailsReceived: 0, meetingsHeld: 0, meetingsUpcoming: 0, contacts: new Set<string>(),
    };

    if (i.type === "email" && i.direction === "outbound") existing.emailsSent++;
    if (i.type === "email" && i.direction === "inbound") existing.emailsReceived++;
    if (i.type === "meeting") {
      const meetDate = new Date(i.interactionDate as any);
      if (meetDate <= now) existing.meetingsHeld++;
      else existing.meetingsUpcoming++;
    }
    existing.contacts.add(i.contactId);
    agentMap.set(agent, existing);
  }

  const leaderboard = Array.from(agentMap.entries())
    .map(([agent, data]) => ({
      agent,
      emailsSent: data.emailsSent,
      emailsReceived: data.emailsReceived,
      meetingsHeld: data.meetingsHeld,
      meetingsUpcoming: data.meetingsUpcoming,
      uniqueContacts: data.contacts.size,
      totalActivity: data.emailsSent + data.emailsReceived + data.meetingsHeld + data.meetingsUpcoming,
    }))
    .sort((a, b) => b.totalActivity - a.totalActivity);

  return { leaderboard };
}

async function autoCreateContacts(minFrequency = 3, daysBack = 90): Promise<{
  created: Array<{ name: string; email: string; company: string }>;
  skipped: number;
}> {
  const discovery = await discoverContactsFromEmail(daysBack);
  const created: Array<{ name: string; email: string; company: string }> = [];
  let skipped = 0;

  for (const suggestion of discovery.suggestions) {
    if (suggestion.frequency < minFrequency) continue;

    if (!suggestion.domain) {
      skipped++;
      continue;
    }

    const nameParts = suggestion.name.split(" ").filter(p => p.length > 0);
    if (nameParts.length < 2 || suggestion.name.includes("@")) {
      skipped++;
      continue;
    }

    let companyId: string | null = null;
    let companyName = "";

    if (suggestion.domain) {
      const existingCompanies = await db
        .select({ id: crmCompanies.id, name: crmCompanies.name })
        .from(crmCompanies)
        .where(sql`LOWER(${crmCompanies.domain}) LIKE ${"%" + suggestion.domain.toLowerCase()} OR LOWER(${crmCompanies.domainUrl}) LIKE ${"%" + suggestion.domain.toLowerCase()}`);

      if (existingCompanies.length > 0) {
        companyId = existingCompanies[0].id;
        companyName = existingCompanies[0].name;
      } else {
        companyName = suggestion.domain.split(".")[0];
        companyName = companyName.charAt(0).toUpperCase() + companyName.slice(1);
      }
    }

    try {
      await db.insert(crmContacts).values({
        name: suggestion.name,
        email: suggestion.email,
        companyId,
        companyName,
        notes: `[Auto-created from email] Emailed ${suggestion.frequency} times by ${suggestion.bgpUsers.join(", ")}. Sample subjects: ${suggestion.sampleSubjects.slice(0, 2).join("; ")}`,
      });
      created.push({ name: suggestion.name, email: suggestion.email, company: companyName });
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) {
        console.error("Auto-create contact error:", e.message);
      }
      skipped++;
    }
  }

  return { created, skipped };
}

async function computeSyncHealth(): Promise<{
  totalInteractions: number;
  emailInteractions: number;
  calendarInteractions: number;
  contactsCovered: number;
  totalContacts: number;
  coveragePercent: number;
  lastSyncTime: string | null;
  interactionsByDay: Array<{ date: string; count: number }>;
  topDomains: Array<{ domain: string; count: number }>;
}> {
  const totalResult = await pool.query("SELECT COUNT(*) as count FROM crm_interactions");
  const emailResult = await pool.query("SELECT COUNT(*) as count FROM crm_interactions WHERE type = 'email'");
  const calResult = await pool.query("SELECT COUNT(*) as count FROM crm_interactions WHERE type = 'meeting'");

  const coveredResult = await pool.query("SELECT COUNT(DISTINCT contact_id) as count FROM crm_interactions");
  const totalContactsResult = await pool.query("SELECT COUNT(*) as count FROM crm_contacts");

  const lastSync = await pool.query(
    "SELECT MAX(created_at) as last_sync FROM crm_interactions WHERE microsoft_id IS NOT NULL"
  );

  const byDay = await pool.query(`
    SELECT DATE(interaction_date) as date, COUNT(*) as count
    FROM crm_interactions
    WHERE interaction_date >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(interaction_date)
    ORDER BY date DESC
    LIMIT 30
  `);

  let domains: any = { rows: [] };
  try {
    domains = await pool.query(`
      SELECT domain, COUNT(*) as count FROM (
        SELECT SUBSTRING(p FROM '@(.+)$') as domain
        FROM crm_interactions, LATERAL unnest(participants) AS p
        WHERE participants IS NOT NULL
      ) sub
      WHERE domain IS NOT NULL AND domain != 'brucegillinghampollard.com'
      GROUP BY domain
      ORDER BY count DESC
      LIMIT 20
    `);
  } catch {}

  const total = parseInt(totalResult.rows[0]?.count || "0");
  const covered = parseInt(coveredResult.rows[0]?.count || "0");
  const totalContacts = parseInt(totalContactsResult.rows[0]?.count || "0");

  return {
    totalInteractions: total,
    emailInteractions: parseInt(emailResult.rows[0]?.count || "0"),
    calendarInteractions: parseInt(calResult.rows[0]?.count || "0"),
    contactsCovered: covered,
    totalContacts,
    coveragePercent: totalContacts > 0 ? Math.round((covered / totalContacts) * 100) : 0,
    lastSyncTime: lastSync.rows[0]?.last_sync?.toISOString() || null,
    interactionsByDay: byDay.rows.map((r: any) => ({ date: r.date?.toISOString?.().split("T")[0] || r.date, count: parseInt(r.count) })),
    topDomains: (domains.rows || []).filter((r: any) => r.domain).map((r: any) => ({ domain: r.domain, count: parseInt(r.count) })),
  };
}

let autoSyncInterval: NodeJS.Timeout | null = null;

function startAutoSync() {
  if (autoSyncInterval) return;
  const ONE_HOUR = 60 * 60 * 1000;
  console.log("[interactions] Auto-sync enabled — running every 1 hour");
  autoSyncInterval = setInterval(async () => {
    try {
      const result = await runInteractionSync(120, 90);
      console.log(`[interactions] Auto-sync complete: ${result.synced.emails} emails, ${result.synced.calendar} calendar events`);
      if (result.errors?.length) {
        console.log(`[interactions] Auto-sync errors: ${result.errors.length}`);
      }
      const totalSynced = (result.synced.emails || 0) + (result.synced.calendar || 0);
      if (totalSynced > 0) {
        const { logActivity } = await import("./activity-logger");
        await logActivity("interaction-sync", "interactions_synced", `${result.synced.emails} emails and ${result.synced.calendar} calendar events synced across ${result.usersScanned} users`, totalSynced);
      }
    } catch (e: any) {
      console.error("[interactions] Auto-sync failed:", e.message);
    }
  }, ONE_HOUR);
}

async function requireAdminCheck(req: Request): Promise<boolean> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return false;
  try {
    const result = await pool.query("SELECT is_admin FROM users WHERE id = $1", [userId]);
    return result.rows[0]?.is_admin === true;
  } catch {
    return false;
  }
}

export function registerInteractionRoutes(app: Express) {
  startAutoSync();

  app.post("/api/interactions/sync", requireAuth, async (req: Request, res: Response) => {
    try {
      const daysBack = Number(req.query.daysBack) || 30;
      const daysForward = Number(req.query.daysForward) || 60;
      const result = await runInteractionSync(daysBack, daysForward);
      res.json(result);
    } catch (e: any) {
      console.error("Interaction sync error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/interactions/contact/:contactId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { contactId } = req.params;
      const limit = Number(req.query.limit) || 50;
      const type = req.query.type as string | undefined;

      const conditions = [eq(crmInteractions.contactId, contactId)];
      if (type) conditions.push(eq(crmInteractions.type, type));

      const interactions = await db
        .select()
        .from(crmInteractions)
        .where(and(...conditions))
        .orderBy(desc(crmInteractions.interactionDate))
        .limit(limit);

      const totalCount = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(crmInteractions)
        .where(and(...conditions));

      const now = new Date();
      const nextMeeting = await db
        .select()
        .from(crmInteractions)
        .where(
          and(
            eq(crmInteractions.contactId, contactId),
            eq(crmInteractions.type, "meeting"),
            gte(crmInteractions.interactionDate, now)
          )
        )
        .orderBy(crmInteractions.interactionDate)
        .limit(1);

      const lastInteraction = await db
        .select()
        .from(crmInteractions)
        .where(
          and(
            eq(crmInteractions.contactId, contactId),
            lte(crmInteractions.interactionDate, now)
          )
        )
        .orderBy(desc(crmInteractions.interactionDate))
        .limit(1);

      res.json({
        interactions,
        nextMeeting: nextMeeting[0] || null,
        lastInteraction: lastInteraction[0] || null,
        total: totalCount[0]?.count || 0,
      });
    } catch (e: any) {
      console.error("Get interactions error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/interactions/company/:companyId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.params;
      const limit = Number(req.query.limit) || 50;

      const interactions = await db
        .select()
        .from(crmInteractions)
        .where(eq(crmInteractions.companyId, companyId))
        .orderBy(desc(crmInteractions.interactionDate))
        .limit(limit);

      res.json({ interactions, total: interactions.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/interactions/summary", requireAuth, async (req: Request, res: Response) => {
    try {
      const now = new Date();

      const nextMeetings = await db
        .select({
          contactId: crmInteractions.contactId,
          interactionDate: sql<string>`MIN(${crmInteractions.interactionDate})`,
          subject: sql<string>`(array_agg(${crmInteractions.subject} ORDER BY ${crmInteractions.interactionDate}))[1]`,
        })
        .from(crmInteractions)
        .where(
          and(
            eq(crmInteractions.type, "meeting"),
            gte(crmInteractions.interactionDate, now)
          )
        )
        .groupBy(crmInteractions.contactId);

      const lastInteractions = await db
        .select({
          contactId: crmInteractions.contactId,
          interactionDate: sql<string>`MAX(${crmInteractions.interactionDate})`,
          type: sql<string>`(array_agg(${crmInteractions.type} ORDER BY ${crmInteractions.interactionDate} DESC))[1]`,
        })
        .from(crmInteractions)
        .where(lte(crmInteractions.interactionDate, now))
        .groupBy(crmInteractions.contactId);

      const nextMeetingMap: Record<string, { date: string; subject: string }> = {};
      for (const m of nextMeetings) {
        nextMeetingMap[m.contactId] = { date: m.interactionDate, subject: m.subject };
      }

      const lastInteractionMap: Record<string, { date: string; type: string }> = {};
      for (const l of lastInteractions) {
        lastInteractionMap[l.contactId] = { date: l.interactionDate, type: l.type };
      }

      res.json({ nextMeetings: nextMeetingMap, lastInteractions: lastInteractionMap });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/interactions/archive", requireAuth, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;
      const type = req.query.type as string | undefined;
      const direction = req.query.direction as string | undefined;
      const search = req.query.search as string | undefined;

      let whereClause = sql`1=1`;
      if (type) whereClause = sql`${whereClause} AND ${crmInteractions.type} = ${type}`;
      if (direction) whereClause = sql`${whereClause} AND ${crmInteractions.direction} = ${direction}`;
      if (search) whereClause = sql`${whereClause} AND (${crmInteractions.subject} ILIKE ${'%' + search + '%'} OR ${crmInteractions.preview} ILIKE ${'%' + search + '%'})`;

      const interactions = await db
        .select({
          id: crmInteractions.id,
          contactId: crmInteractions.contactId,
          companyId: crmInteractions.companyId,
          type: crmInteractions.type,
          direction: crmInteractions.direction,
          subject: crmInteractions.subject,
          preview: crmInteractions.preview,
          participants: crmInteractions.participants,
          matchMethod: crmInteractions.matchMethod,
          interactionDate: crmInteractions.interactionDate,
          bgpUser: crmInteractions.bgpUser,
          contactName: sql<string>`(SELECT name FROM crm_contacts WHERE id = ${crmInteractions.contactId} LIMIT 1)`,
          companyName: sql<string>`(SELECT name FROM crm_companies WHERE id = ${crmInteractions.companyId} LIMIT 1)`,
        })
        .from(crmInteractions)
        .where(whereClause)
        .orderBy(desc(crmInteractions.interactionDate))
        .limit(limit)
        .offset(offset);

      const totalResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(crmInteractions)
        .where(whereClause);

      res.json({
        interactions,
        total: totalResult[0]?.count || 0,
        limit,
        offset,
      });
    } catch (e: any) {
      console.error("Archive error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/interactions/stats", requireAuth, async (req: Request, res: Response) => {
    try {
      const totalResult = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(crmInteractions);

      const byType = await db
        .select({
          type: crmInteractions.type,
          count: sql<number>`COUNT(*)`,
        })
        .from(crmInteractions)
        .groupBy(crmInteractions.type);

      const byMethod = await db
        .select({
          method: crmInteractions.matchMethod,
          count: sql<number>`COUNT(*)`,
        })
        .from(crmInteractions)
        .groupBy(crmInteractions.matchMethod);

      const contactsWithInteractions = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${crmInteractions.contactId})` })
        .from(crmInteractions);

      res.json({
        total: totalResult[0]?.count || 0,
        byType: Object.fromEntries(byType.map((r) => [r.type, r.count])),
        byMethod: Object.fromEntries(byMethod.map((r) => [r.method, r.count])),
        contactsWithInteractions: contactsWithInteractions[0]?.count || 0,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/contacts/discover-from-email", requireAuth, async (req: Request, res: Response) => {
    try {
      const daysBack = Number(req.query.daysBack) || 90;
      const result = await discoverContactsFromEmail(daysBack);
      res.json(result);
    } catch (e: any) {
      console.error("Contact discovery error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/dashboard/intelligence", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).session?.userId || (req as any).tokenUserId;
      const viewMode = (req.query.viewMode as string) || "team";
      let userEmail = "";
      let userTeam = "";
      if (userId) {
        const userRecord = await db.execute(sql`SELECT email, team FROM users WHERE id = ${userId}`);
        userEmail = (userRecord as any).rows?.[0]?.email || "";
        userTeam = (userRecord as any).rows?.[0]?.team || "";
      }
      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const activeContacts = await db
        .select({
          contactId: crmInteractions.contactId,
          count: sql<number>`COUNT(*)::int`,
          lastDate: sql<string>`MAX(${crmInteractions.interactionDate})`,
          lastType: sql<string>`(array_agg(${crmInteractions.type} ORDER BY ${crmInteractions.interactionDate} DESC))[1]`,
        })
        .from(crmInteractions)
        .innerJoin(crmContacts, eq(crmInteractions.contactId, crmContacts.id))
        .where(and(
          gte(crmInteractions.interactionDate, thirtyDaysAgo),
          sql`(${crmContacts.email} IS NULL OR ${crmContacts.email} NOT LIKE '%@brucegillinghampollard.com')`,
          sql`${crmContacts.name} NOT IN (SELECT name FROM users)`,
          sql`NOT EXISTS (SELECT 1 FROM users u WHERE ${crmContacts.name} ILIKE u.name || '%' OR u.name ILIKE ${crmContacts.name} || '%')`
        ))
        .groupBy(crmInteractions.contactId)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(20);

      const contactIds = activeContacts.map(c => c.contactId);
      let contactNames: Record<string, string> = {};
      let contactAllocations: Record<string, string[]> = {};
      if (contactIds.length > 0) {
        const contacts = await db
          .select({ id: crmContacts.id, name: crmContacts.name, companyId: crmContacts.companyId, bgpAllocation: crmContacts.bgpAllocation })
          .from(crmContacts)
          .where(inArray(crmContacts.id, contactIds));
        for (const c of contacts) {
          contactNames[c.id] = c.name;
          try {
            const parsed = c.bgpAllocation ? JSON.parse(c.bgpAllocation) : [];
            contactAllocations[c.id] = Array.isArray(parsed) ? parsed : c.bgpAllocation ? [c.bgpAllocation] : [];
          } catch {
            contactAllocations[c.id] = c.bgpAllocation ? [c.bgpAllocation] : [];
          }
        }
      }

      const recentRequirementsLeasing = await db
        .select({ id: crmRequirementsLeasing.id, name: crmRequirementsLeasing.name, createdAt: crmRequirementsLeasing.createdAt })
        .from(crmRequirementsLeasing)
        .where(gte(crmRequirementsLeasing.createdAt, sevenDaysAgo))
        .orderBy(desc(crmRequirementsLeasing.createdAt))
        .limit(5);

      const recentRequirementsInvestment = await db
        .select({ id: crmRequirementsInvestment.id, name: crmRequirementsInvestment.name, createdAt: crmRequirementsInvestment.createdAt })
        .from(crmRequirementsInvestment)
        .orderBy(desc(crmRequirementsInvestment.createdAt))
        .limit(10);

      const myContactIds = await db
        .select({ contactId: crmInteractions.contactId })
        .from(crmInteractions)
        .where(eq(crmInteractions.bgpUser, userEmail))
        .groupBy(crmInteractions.contactId);
      const myContactIdSet = new Set(myContactIds.map(c => c.contactId));

      let activityAlerts: { bgpUser: string; contactId: string; contactName: string; type: string; subject: string | null; date: string }[] = [];

      if (viewMode === "team") {
        const teamEmails: string[] = [];
        if (userTeam) {
          const teamUsers = await db.execute(sql`SELECT email FROM users WHERE (team = ${userTeam} OR ${userTeam} = ANY(additional_teams)) AND email IS NOT NULL`);
          for (const row of (teamUsers as any).rows || []) {
            if (row.email) teamEmails.push(row.email);
          }
        }
        const teamInteractions = await db
          .select({
            bgpUser: crmInteractions.bgpUser,
            contactId: crmInteractions.contactId,
            type: crmInteractions.type,
            subject: crmInteractions.subject,
            interactionDate: crmInteractions.interactionDate,
          })
          .from(crmInteractions)
          .innerJoin(crmContacts, eq(crmInteractions.contactId, crmContacts.id))
          .where(
            and(
              gte(crmInteractions.interactionDate, sevenDaysAgo),
              sql`${crmInteractions.bgpUser} IS NOT NULL`,
              teamEmails.length > 0 ? inArray(crmInteractions.bgpUser, teamEmails) : sql`1=1`,
              sql`(${crmContacts.email} IS NULL OR ${crmContacts.email} NOT LIKE '%@brucegillinghampollard.com')`
            )
          )
          .orderBy(desc(crmInteractions.interactionDate))
          .limit(10);

        const alertContactIds = [...new Set(teamInteractions.map(i => i.contactId))];
        let alertContactNames: Record<string, string> = {};
        if (alertContactIds.length > 0) {
          const alertContacts = await db
            .select({ id: crmContacts.id, name: crmContacts.name })
            .from(crmContacts)
            .where(inArray(crmContacts.id, alertContactIds));
          for (const c of alertContacts) {
            alertContactNames[c.id] = c.name;
          }
        }

        activityAlerts = teamInteractions.map(i => ({
          bgpUser: i.bgpUser || "Unknown",
          contactId: i.contactId,
          contactName: alertContactNames[i.contactId] || "Unknown",
          type: i.type || "interaction",
          subject: i.subject || null,
          date: (i.interactionDate as any)?.toISOString?.() || String(i.interactionDate),
        }));
      } else if (myContactIdSet.size > 0) {
        const otherInteractions = await db
          .select({
            bgpUser: crmInteractions.bgpUser,
            contactId: crmInteractions.contactId,
            type: crmInteractions.type,
            subject: crmInteractions.subject,
            interactionDate: crmInteractions.interactionDate,
          })
          .from(crmInteractions)
          .where(
            and(
              gte(crmInteractions.interactionDate, sevenDaysAgo),
              sql`${crmInteractions.bgpUser} IS NOT NULL AND ${crmInteractions.bgpUser} != ${userEmail}`,
              inArray(crmInteractions.contactId, Array.from(myContactIdSet))
            )
          )
          .orderBy(desc(crmInteractions.interactionDate))
          .limit(10);

        const alertContactIds = [...new Set(otherInteractions.map(i => i.contactId))];
        let alertContactNames: Record<string, string> = {};
        if (alertContactIds.length > 0) {
          const alertContacts = await db
            .select({ id: crmContacts.id, name: crmContacts.name })
            .from(crmContacts)
            .where(inArray(crmContacts.id, alertContactIds));
          for (const c of alertContacts) {
            alertContactNames[c.id] = c.name;
          }
        }

        activityAlerts = otherInteractions.map(i => ({
          bgpUser: i.bgpUser || "Unknown",
          contactId: i.contactId,
          contactName: alertContactNames[i.contactId] || "Unknown",
          type: i.type,
          subject: i.subject,
          date: (i.interactionDate as any)?.toISOString?.() || String(i.interactionDate),
        }));
      }

      res.json({
        activeContacts: activeContacts.map(c => ({
          contactId: c.contactId,
          name: contactNames[c.contactId] || "Unknown",
          count: c.count,
          lastDate: c.lastDate,
          lastType: c.lastType,
          bgpAllocation: contactAllocations[c.contactId] || [],
        })),
        recentRequirements: [
          ...recentRequirementsLeasing.map(r => ({ ...r, type: "leasing" })),
          ...recentRequirementsInvestment.map(r => ({ ...r, type: "investment" })),
        ].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()).slice(0, 8),
        activityAlerts,
      });
    } catch (e: any) {
      console.error("Dashboard intelligence error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/interactions/engagement", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!await requireAdminCheck(req)) return res.status(403).json({ error: "Admin access required" });
      const result = await computeEngagementScores();
      res.json(result);
    } catch (e: any) {
      console.error("Engagement scores error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/interactions/leaderboard", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!await requireAdminCheck(req)) return res.status(403).json({ error: "Admin access required" });
      const result = await computeAgentLeaderboard();
      res.json(result);
    } catch (e: any) {
      console.error("Agent leaderboard error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/contacts/auto-create", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!await requireAdminCheck(req)) return res.status(403).json({ error: "Admin access required" });
      const minFrequency = Number(req.query.minFrequency) || 3;
      const daysBack = Number(req.query.daysBack) || 90;
      const result = await autoCreateContacts(minFrequency, daysBack);
      res.json(result);
    } catch (e: any) {
      console.error("Auto-create contacts error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/interactions/sync-health", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!await requireAdminCheck(req)) return res.status(403).json({ error: "Admin access required" });
      const result = await computeSyncHealth();
      res.json(result);
    } catch (e: any) {
      console.error("Sync health error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/interactions/clear", requireAuth, async (req: Request, res: Response) => {
    try {
      await db.delete(crmInteractions);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
