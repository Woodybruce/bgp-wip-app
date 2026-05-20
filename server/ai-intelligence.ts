import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";
import {
  crmDeals,
  crmContacts,
  crmCompanies,
  crmProperties,
  crmInteractions,
  crmRequirementsLeasing,
  crmRequirementsInvestment,
  investmentTracker,
  investmentComps,
} from "@shared/schema";
import { requireAuth } from "./auth";
import { legacyToCode } from "@shared/deal-status";
import { callClaude, CHATBGP_HELPER_MODEL } from "./utils/anthropic-client";

async function safeAICall(prompt: { system: string; user: string; maxTokens?: number }): Promise<string> {
  try {
    const res = await callClaude({
      model: CHATBGP_HELPER_MODEL,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      max_completion_tokens: prompt.maxTokens || 300,
    });
    return res.choices[0]?.message?.content || "";
  } catch (e: any) {
    console.error("[ai-intelligence] AI call failed:", e?.message);
    return "";
  }
}

async function safeAIJsonCall(prompt: { system: string; user: string; maxTokens?: number }): Promise<any> {
  try {
    const res = await callClaude({
      model: CHATBGP_HELPER_MODEL,
      messages: [
        { role: "system", content: prompt.system + "\n\nReturn ONLY valid JSON." },
        { role: "user", content: prompt.user },
      ],
      max_completion_tokens: prompt.maxTokens || 300,
    });
    let raw = res.choices[0]?.message?.content?.trim() || "{}";
    if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    return JSON.parse(raw);
  } catch (e: any) {
    console.error("[ai-intelligence] OpenAI JSON call failed:", e?.message);
    return {};
  }
}

export function registerAIIntelligenceRoutes(app: Express) {

  // ─── 1. SMART DEAL ALERTS ────────────────────────────────────────────
  app.get("/api/ai/deal-alerts", requireAuth, async (req: Request, res: Response) => {
    try {
      const deals = await db.select().from(crmDeals);
      const now = new Date();
      const alerts: Array<{ type: string; severity: "high" | "medium" | "low"; dealId: string; dealName: string; message: string }> = [];

      for (const deal of deals) {
        if (!deal.status || ["COM", "WIT", "INV"].includes(legacyToCode(deal.status) || "")) continue;

        const updatedAt = deal.updatedAt ? new Date(deal.updatedAt) : null;
        const daysSinceUpdate = updatedAt ? Math.floor((now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)) : null;
        if (daysSinceUpdate && daysSinceUpdate > 30) {
          alerts.push({
            type: "stale_deal",
            severity: daysSinceUpdate > 60 ? "high" : "medium",
            dealId: deal.id,
            dealName: deal.name,
            message: `No activity for ${daysSinceUpdate} days (status: ${deal.status})`,
          });
        }

        if (deal.targetDate) {
          const targetDate = new Date(deal.targetDate);
          const targetStr = targetDate.toLocaleDateString("en-GB");
          const daysUntil = Math.floor((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (daysUntil >= 0 && daysUntil <= 14) {
            alerts.push({
              type: "approaching_completion",
              severity: daysUntil <= 3 ? "high" : "medium",
              dealId: deal.id,
              dealName: deal.name,
              message: `Target date in ${daysUntil} day${daysUntil !== 1 ? "s" : ""} (${targetStr})`,
            });
          }
          if (daysUntil < 0 && !deal.exchangedAt && !deal.completedAt) {
            alerts.push({
              type: "overdue_completion",
              severity: "high",
              dealId: deal.id,
              dealName: deal.name,
              message: `Target date was ${Math.abs(daysUntil)} days ago (${targetStr}) but deal is still "${deal.status}"`,
            });
          }
        }

        if (deal.fee && deal.fee > 0) {
          const teamDeals = deals.filter(d => d.team && deal.team && d.team.some(t => deal.team!.includes(t)) && d.fee && d.fee > 0 && d.id !== deal.id);
          if (teamDeals.length >= 3) {
            const avgFee = teamDeals.reduce((s, d) => s + (d.fee || 0), 0) / teamDeals.length;
            if (deal.fee > avgFee * 3) {
              alerts.push({
                type: "unusual_fee",
                severity: "low",
                dealId: deal.id,
                dealName: deal.name,
                message: `Fee £${deal.fee.toLocaleString()} is ${(deal.fee / avgFee).toFixed(1)}x team average (£${Math.round(avgFee).toLocaleString()})`,
              });
            }
          }
        }

        if (legacyToCode(deal.status) === "SOL" && deal.amlCheckCompleted !== "YES") {
          alerts.push({
            type: "missing_aml",
            severity: "medium",
            dealId: deal.id,
            dealName: deal.name,
            message: `Deal is Under Offer but AML check is not completed`,
          });
        }
      }

      alerts.sort((a, b) => {
        const sev = { high: 0, medium: 1, low: 2 };
        return sev[a.severity] - sev[b.severity];
      });

      res.json({ alerts, count: alerts.length, generatedAt: new Date().toISOString() });
    } catch (err: any) {
      console.error("[ai-intelligence] deal-alerts error:", err?.message);
      res.status(500).json({ message: "Failed to generate deal alerts" });
    }
  });

  // ─── 2. CONTACT INTELLIGENCE ─────────────────────────────────────────
  app.get("/api/ai/contact-intelligence/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const contactId = req.params.id;
      const [contact] = await db.select().from(crmContacts).where(eq(crmContacts.id, contactId));
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const interactions = await db.select().from(crmInteractions)
        .where(eq(crmInteractions.contactId, contactId))
        .orderBy(desc(crmInteractions.interactionDate))
        .limit(50);

      const linkedDeals = await db.select().from(crmDeals).where(
        sql`${crmDeals.clientContactId} = ${contactId}
          OR ${crmDeals.vendorAgentId} = ${contactId}
          OR ${crmDeals.acquisitionAgentId} = ${contactId}
          OR ${crmDeals.purchaserAgentId} = ${contactId}
          OR ${crmDeals.leasingAgentId} = ${contactId}`
      );

      const activeDeals = linkedDeals.filter(d => { const c = legacyToCode(d.status); return c !== null && !["COM", "WIT", "INV"].includes(c); });
      const completedDeals = linkedDeals.filter(d => ["COM", "INV"].includes(legacyToCode(d.status) || ""));

      const lastInteraction = interactions[0];
      const daysSinceContact = lastInteraction?.interactionDate
        ? Math.floor((Date.now() - new Date(lastInteraction.interactionDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      const emailCount = interactions.filter(i => i.type === "email").length;
      const meetingCount = interactions.filter(i => i.type === "calendar").length;
      const totalFees = completedDeals.reduce((s, d) => s + (d.fee || 0), 0);

      const summaryData = {
        contactName: contact.name,
        company: contact.companyName,
        role: contact.role,
        totalInteractions: interactions.length,
        emailCount,
        meetingCount,
        lastContactDaysAgo: daysSinceContact,
        lastContactSubject: lastInteraction?.subject,
        activeDeals: activeDeals.length,
        completedDeals: completedDeals.length,
        totalFeesFromDeals: totalFees,
        activeDealNames: activeDeals.map(d => d.name).slice(0, 5),
      };

      const aiSummary = await safeAICall({
        system: "You are a CRM intelligence assistant for a London property firm (BGP). Write a concise 2-3 sentence relationship summary for internal use. Be specific about the numbers. If the contact hasn't been in touch recently, mention it. Be professional and direct.",
        user: JSON.stringify(summaryData),
        maxTokens: 200,
      });

      res.json({
        contact: { id: contact.id, name: contact.name, company: contact.companyName, role: contact.role, email: contact.email, phone: contact.phone },
        stats: summaryData,
        aiSummary,
        recentInteractions: interactions.slice(0, 10).map(i => ({
          type: i.type,
          subject: i.subject,
          date: i.interactionDate,
          direction: i.direction,
          bgpUser: i.bgpUser,
        })),
        linkedDeals: linkedDeals.map(d => ({
          id: d.id, name: d.name, status: d.status, fee: d.fee, team: d.team,
        })),
        warnings: [
          ...(daysSinceContact && daysSinceContact > 90 ? [{ type: "dormant", message: `No contact for ${daysSinceContact} days` }] : []),
          ...(activeDeals.length > 3 ? [{ type: "busy", message: `Involved in ${activeDeals.length} active deals` }] : []),
        ],
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[ai-intelligence] contact-intelligence error:", err?.message);
      res.status(500).json({ message: "Failed to generate contact intelligence" });
    }
  });

  // ─── 3. REQUIREMENT MATCHING ─────────────────────────────────────────
  app.get("/api/ai/requirement-matching/:propertyId", requireAuth, async (req: Request, res: Response) => {
    try {
      const propertyId = req.params.id || req.params.propertyId;
      const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, propertyId));
      if (!property) return res.status(404).json({ message: "Property not found" });

      const leasingReqs = await db.select().from(crmRequirementsLeasing);
      const investReqs = await db.select().from(crmRequirementsInvestment);
      const contacts = await db.select().from(crmContacts);
      const companies = await db.select().from(crmCompanies);

      const contactMap = new Map(contacts.map(c => [c.id, c]));
      const companyMap = new Map(companies.map(c => [c.id, c]));

      const propertyAddress = (property.name || "").toLowerCase();
      const propertyArea = (property as any).area?.toLowerCase() || "";

      const matches: Array<{
        type: "leasing" | "investment";
        requirementId: string;
        requirementName: string;
        contactName: string | null;
        companyName: string | null;
        matchReasons: string[];
        score: number;
      }> = [];

      for (const req of leasingReqs) {
        if (req.status === "Completed" || req.status === "Withdrawn") continue;
        const reasons: string[] = [];
        let score = 0;

        if (req.requirementLocations && req.requirementLocations.length > 0) {
          const locMatch = req.requirementLocations.some(loc =>
            propertyAddress.includes(loc.toLowerCase()) || (propertyArea && loc.toLowerCase().includes(propertyArea))
          );
          if (locMatch) { reasons.push("Location match"); score += 40; }
        }

        if (req.use && req.use.length > 0 && (property as any).propertyType) {
          const typeMatch = req.use.some((u: string) =>
            (property as any).propertyType?.toLowerCase().includes(u.toLowerCase())
          );
          if (typeMatch) { reasons.push("Use type match"); score += 30; }
        }

        if (reasons.length > 0) {
          const contact = req.principalContactId ? contactMap.get(req.principalContactId) : null;
          const company = req.companyId ? companyMap.get(req.companyId) : null;
          matches.push({
            type: "leasing",
            requirementId: req.id,
            requirementName: req.name,
            contactName: contact?.name || null,
            companyName: company?.name || null,
            matchReasons: reasons,
            score,
          });
        }
      }

      for (const req of investReqs) {
        if (req.status === "Completed" || req.status === "Withdrawn") continue;
        const reasons: string[] = [];
        let score = 0;

        if (req.requirementLocations && req.requirementLocations.length > 0) {
          const locMatch = req.requirementLocations.some(loc =>
            propertyAddress.includes(loc.toLowerCase()) || (propertyArea && loc.toLowerCase().includes(propertyArea))
          );
          if (locMatch) { reasons.push("Location match"); score += 40; }
        }

        if (reasons.length > 0) {
          const contact = req.principalContactId ? contactMap.get(req.principalContactId) : null;
          const company = req.companyId ? companyMap.get(req.companyId) : null;
          matches.push({
            type: "investment",
            requirementId: req.id,
            requirementName: req.name,
            contactName: contact?.name || req.contactName || null,
            companyName: company?.name || null,
            matchReasons: reasons,
            score,
          });
        }
      }

      matches.sort((a, b) => b.score - a.score);

      res.json({
        property: { id: property.id, name: property.name, address: (property as any).address },
        matches: matches.slice(0, 20),
        totalMatches: matches.length,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[ai-intelligence] requirement-matching error:", err?.message);
      res.status(500).json({ message: "Failed to match requirements" });
    }
  });

  // ─── 4. MEETING SUMMARY / DEAL NOTES ─────────────────────────────────
  app.post("/api/ai/meeting-summary", requireAuth, async (req: Request, res: Response) => {
    try {
      const { dealId, meetingSubject, meetingDate, attendees, notes } = req.body;
      if (!dealId) return res.status(400).json({ message: "dealId is required" });

      const [deal] = await db.select().from(crmDeals).where(eq(crmDeals.id, dealId));
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      const contacts = await db.select().from(crmContacts);
      const companies = await db.select().from(crmCompanies);
      const contactMap = new Map(contacts.map(c => [c.id, c]));
      const companyMap = new Map(companies.map(c => [c.id, c]));

      const dealContext = {
        dealName: deal.name,
        status: deal.status,
        propertyName: (deal as any).propertyName,
        tenant: deal.tenantId ? contactMap.get(deal.tenantId)?.name || companyMap.get(deal.tenantId)?.name : null,
        fee: deal.fee,
        team: deal.team,
      };

      const summary = await safeAICall({
        system: "You are writing meeting notes for a London property agency (Bruce Gillingham Pollard). Write professional, concise meeting notes suitable for a CRM entry. Include: key discussion points, action items, and next steps. Keep it to 3-5 bullet points.",
        user: `Deal: ${JSON.stringify(dealContext)}\nMeeting: ${meetingSubject || "Meeting"}\nDate: ${meetingDate || "Today"}\nAttendees: ${attendees || "Not specified"}\nNotes/Context: ${notes || "General progress meeting"}`,
        maxTokens: 500,
      }) || "Unable to generate summary";

      res.json({
        dealId: deal.id,
        dealName: deal.name,
        summary,
        meetingSubject,
        meetingDate,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[ai-intelligence] meeting-summary error:", err?.message);
      res.status(500).json({ message: "Failed to generate meeting summary" });
    }
  });

  // ─── 5. COMP ANALYSIS ────────────────────────────────────────────────
  app.get("/api/ai/comp-analysis/:propertyId", requireAuth, async (req: Request, res: Response) => {
    try {
      const propertyId = req.params.propertyId;
      const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, propertyId));
      if (!property) return res.status(404).json({ message: "Property not found" });

      const completedDeals = await db.select().from(crmDeals)
        .where(sql`${crmDeals.status} IN ('Completed', 'Invoiced', 'Billed', 'Exchanged')`);

      const invComps = await db.select().from(investmentComps);

      const propertyAddress = (property.name || "").toLowerCase();
      const locationTokens = propertyAddress.split(/[\s,]+/).filter(t => t.length > 3);

      const relevantComps = completedDeals.filter(d => {
        if (!d.name) return false;
        const name = d.name.toLowerCase();
        return locationTokens.some(token => name.includes(token));
      }).slice(0, 20);

      const relevantInvComps = invComps.filter(c => {
        if (!c.address) return false;
        const addr = c.address.toLowerCase();
        return locationTokens.some(token => addr.includes(token));
      }).slice(0, 20);

      const compData = {
        property: { name: property.name, address: (property as any).address },
        leasingComps: relevantComps.map(d => ({
          name: d.name,
          rentPa: d.rentPa,
          pricePsf: d.pricePsf,
          totalArea: d.totalAreaSqft,
          completionDate: d.completedAt ? new Date(d.completedAt).toISOString().slice(0, 10) : null,
          tenant: d.name,
        })),
        investmentComps: relevantInvComps.map(c => ({
          address: c.address,
          price: c.price,
          yield: c.netInitialYield,
          sqft: c.totalSqft,
          date: c.transactionDate,
        })),
      };

      let aiAnalysis = "";
      if (relevantComps.length > 0 || relevantInvComps.length > 0) {
        aiAnalysis = await safeAICall({
          system: "You are a property market analyst for a London agency. Provide a brief market analysis (3-4 sentences) based on comparable transactions. Include rent ranges, yield observations, and any market trends. Be specific with numbers.",
          user: JSON.stringify(compData),
        });
      }

      res.json({
        property: { id: property.id, name: property.name },
        leasingComps: compData.leasingComps,
        investmentComps: compData.investmentComps,
        aiAnalysis,
        totalComps: relevantComps.length + relevantInvComps.length,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[ai-intelligence] comp-analysis error:", err?.message);
      res.status(500).json({ message: "Failed to generate comp analysis" });
    }
  });

  // ─── 6. SMART SEARCH ─────────────────────────────────────────────────
  app.post("/api/ai/smart-search", requireAuth, async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      if (!query) return res.status(400).json({ message: "query is required" });

      const parsed = await safeAIJsonCall({
        system: `You parse natural language CRM search queries for a London property agency. Extract structured filters from the query. Return JSON with:
{
  "entityType": "deal" | "contact" | "company" | "property" | "all",
  "filters": {
    "name": "text to search in name/title",
    "agent": "agent name if mentioned",
    "team": "team name if mentioned (Investment, London F&B, London Retail, National Leasing, Lease Advisory, Tenant Rep, Development)",
    "status": "status if mentioned",
    "location": "location/area if mentioned (e.g. Chelsea, Mayfair, Belgravia)",
    "minFee": number or null,
    "maxFee": number or null
  },
  "interpretation": "brief description of what the user is looking for"
}`,
        user: query,
      });
      const filters = parsed.filters || {};
      const entityType = parsed.entityType || "all";

      const results: Array<{ type: string; id: string; name: string; detail: string }> = [];

      if (entityType === "deal" || entityType === "all") {
        let allDeals = await db.select().from(crmDeals);
        allDeals = allDeals.filter(d => {
          if (filters.name && !d.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
          if (filters.agent && d.internalAgent && !d.internalAgent.some((a: string) => a.toLowerCase().includes(filters.agent.toLowerCase()))) return false;
          if (filters.team && d.team && !d.team.some((t: string) => t.toLowerCase().includes(filters.team.toLowerCase()))) return false;
          if (filters.status && d.status?.toLowerCase() !== filters.status.toLowerCase()) return false;
          if (filters.location && !d.name.toLowerCase().includes(filters.location.toLowerCase())) return false;
          if (filters.minFee && (!d.fee || d.fee < filters.minFee)) return false;
          if (filters.maxFee && d.fee && d.fee > filters.maxFee) return false;
          return true;
        });
        allDeals.slice(0, 20).forEach(d => results.push({
          type: "deal", id: d.id, name: d.name,
          detail: `${d.status || "No status"} · ${d.team?.join(", ") || "No team"} · ${d.fee ? `£${d.fee.toLocaleString()}` : "No fee"}`,
        }));
      }

      if (entityType === "contact" || entityType === "all") {
        let allContacts = await db.select().from(crmContacts);
        allContacts = allContacts.filter(c => {
          if (filters.name && !c.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
          if (filters.location && !(c.companyName || "").toLowerCase().includes(filters.location.toLowerCase())) return false;
          return true;
        });
        allContacts.slice(0, 20).forEach(c => results.push({
          type: "contact", id: c.id, name: c.name,
          detail: `${c.companyName || "No company"} · ${c.role || ""}`,
        }));
      }

      if (entityType === "company" || entityType === "all") {
        let allCompanies = await db.select().from(crmCompanies);
        allCompanies = allCompanies.filter(c => {
          if (filters.name && !c.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
          return true;
        });
        allCompanies.slice(0, 20).forEach(c => results.push({
          type: "company", id: c.id, name: c.name,
          detail: `${c.companyType || "No type"}`,
        }));
      }

      if (entityType === "property" || entityType === "all") {
        let allProperties = await db.select().from(crmProperties);
        allProperties = allProperties.filter(p => {
          if (filters.name && !p.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
          if (filters.location && !p.name.toLowerCase().includes(filters.location.toLowerCase())) return false;
          return true;
        });
        allProperties.slice(0, 20).forEach(p => results.push({
          type: "property", id: p.id, name: p.name,
          detail: `${p.status || "No status"}`,
        }));
      }

      res.json({
        query,
        interpretation: parsed.interpretation || "",
        filters: parsed.filters || {},
        results: results.slice(0, 50),
        totalResults: results.length,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[ai-intelligence] smart-search error:", err?.message);
      res.status(500).json({ message: "Failed to perform smart search" });
    }
  });

  // ─── 7. DOCUMENT DRAFT FROM DEAL ──────────────────────────────────────
  app.post("/api/ai/document-draft", requireAuth, async (req: Request, res: Response) => {
    try {
      const { dealId, documentType } = req.body;
      if (!dealId) return res.status(400).json({ message: "dealId is required" });

      const [deal] = await db.select().from(crmDeals).where(eq(crmDeals.id, dealId));
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      const contacts = await db.select().from(crmContacts);
      const companies = await db.select().from(crmCompanies);
      const [property] = deal.propertyId ? await db.select().from(crmProperties).where(eq(crmProperties.id, deal.propertyId)) : [null];

      const contactMap = new Map(contacts.map(c => [c.id, c]));
      const companyMap = new Map(companies.map(c => [c.id, c]));

      const dealData = {
        name: deal.name,
        status: deal.status,
        team: deal.team,
        agent: deal.internalAgent,
        fee: deal.fee,
        feeAgreement: deal.feeAgreement,
        property: property ? { name: property.name, address: (property as any).address } : null,
        tenant: deal.tenantId ? (contactMap.get(deal.tenantId)?.name || companyMap.get(deal.tenantId)?.name) : null,
        landlord: deal.landlordId ? companyMap.get(deal.landlordId)?.name : null,
        rentPa: deal.rentPa,
        totalArea: deal.totalAreaSqft,
        pricePsf: deal.pricePsf,
        leaseLength: deal.leaseLength,
        breakOption: deal.breakOption,
        rentFree: deal.rentFree,
        capitalContribution: deal.capitalContribution,
        targetDate: deal.targetDate,
        exchangedAt: deal.exchangedAt,
        completedAt: deal.completedAt,
        comments: deal.comments,
      };

      const docType = documentType || "client_update";
      const templates: Record<string, string> = {
        client_update: "Write a professional client update email summarising the current status of this deal. Include key terms, next steps, and any outstanding items. Address it to 'Dear Client' and sign off as the BGP team.",
        instruction_letter: "Draft a formal instruction letter for this property deal. Include the property details, agreed terms (rent, lease length, break options), fee arrangement, and key conditions. Be formal and precise.",
        hots_summary: "Summarise the Heads of Terms for this deal in a clear, structured format. Include: parties, property, rent, lease term, break options, rent-free period, capital contribution, and any special conditions.",
        progress_report: "Write a brief internal progress report for this deal. Cover: current status, recent activity, key milestones achieved, upcoming deadlines, and any risks or blockers.",
      };

      const prompt = templates[docType] || templates.client_update;

      const content = await safeAICall({
        system: `You are a professional document writer for Bruce Gillingham Pollard (BGP), a London property agency specialising in Belgravia, Mayfair, and Chelsea. ${prompt}`,
        user: JSON.stringify(dealData),
        maxTokens: 1000,
      }) || "Unable to generate document";

      res.json({
        dealId: deal.id,
        dealName: deal.name,
        documentType: docType,
        content,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[ai-intelligence] document-draft error:", err?.message);
      res.status(500).json({ message: "Failed to generate document draft" });
    }
  });

  // ─── 8. INVESTMENT TRACKER INSIGHTS ───────────────────────────────────
  app.get("/api/ai/investment-insights", requireAuth, async (req: Request, res: Response) => {
    try {
      const items = await db.select().from(investmentTracker);
      const invComps = await db.select().from(investmentComps);
      const now = new Date();
      const thisMonth = now.getMonth();
      const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;

      const statusCounts: Record<string, number> = {};
      let totalGuidePrice = 0;
      let guidePriceCount = 0;
      const recentItems: typeof items = [];

      for (const item of items) {
        const status = item.status || "Unknown";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        if (item.guidePrice) { totalGuidePrice += Number(item.guidePrice); guidePriceCount++; }
        if (item.createdAt && new Date(item.createdAt).getMonth() === thisMonth) {
          recentItems.push(item);
        }
      }

      const underOffer = items.filter(i => legacyToCode(i.status) === "SOL");
      const completed = items.filter(i => i.status === "Completed");
      const live = items.filter(i => i.status === "Live");

      const avgGuidePrice = guidePriceCount > 0 ? totalGuidePrice / guidePriceCount : 0;

      const insights: Array<{ type: string; message: string; severity: "info" | "positive" | "warning" }> = [];

      insights.push({
        type: "pipeline_summary",
        message: `Pipeline: ${live.length} live, ${underOffer.length} under offer, ${completed.length} completed. Total ${items.length} tracked assets.`,
        severity: "info",
      });

      if (recentItems.length > 0) {
        insights.push({
          type: "new_this_month",
          message: `${recentItems.length} new asset${recentItems.length !== 1 ? "s" : ""} added this month.`,
          severity: "positive",
        });
      }

      if (avgGuidePrice > 0) {
        insights.push({
          type: "avg_guide_price",
          message: `Average guide price: £${Math.round(avgGuidePrice).toLocaleString()}`,
          severity: "info",
        });
      }

      const highValue = items.filter(i => i.guidePrice && Number(i.guidePrice) > avgGuidePrice * 2);
      if (highValue.length > 0) {
        insights.push({
          type: "high_value_assets",
          message: `${highValue.length} asset${highValue.length !== 1 ? "s" : ""} above 2x average guide price (£${Math.round(avgGuidePrice * 2).toLocaleString()}+)`,
          severity: "info",
        });
      }

      let aiSummary = "";
      aiSummary = await safeAICall({
        system: "You are an investment analyst for a London property firm. Provide a 2-3 sentence market commentary on this investment pipeline. Be specific with numbers and highlight any notable patterns.",
        user: JSON.stringify({
          statusCounts,
          totalAssets: items.length,
          avgGuidePrice,
          recentAdditions: recentItems.length,
          topAssets: items.filter(i => i.guidePrice).sort((a, b) => Number(b.guidePrice) - Number(a.guidePrice)).slice(0, 5).map(i => ({
            name: i.assetName, price: i.guidePrice, status: i.status,
          })),
        }),
        maxTokens: 200,
      });

      res.json({
        statusCounts,
        totalAssets: items.length,
        avgGuidePrice,
        insights,
        aiSummary,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[ai-intelligence] investment-insights error:", err?.message);
      res.status(500).json({ message: "Failed to generate investment insights" });
    }
  });

  // ─── 9. EMAIL TRIAGE ──────────────────────────────────────────────────
  app.get("/api/ai/email-triage", requireAuth, async (req: Request, res: Response) => {
    try {
      const { getValidMsToken } = await import("./microsoft");
      const msToken = await getValidMsToken(req);

      if (!msToken) {
        return res.json({
          emails: [],
          message: "Microsoft 365 not connected — connect to enable email triage",
          generatedAt: new Date().toISOString(),
        });
      }

      const graphRes = await fetch("https://graph.microsoft.com/v1.0/me/messages?$top=20&$orderby=receivedDateTime desc&$select=id,subject,bodyPreview,from,receivedDateTime,isRead,importance", {
        headers: { Authorization: `Bearer ${msToken}` },
      });

      if (!graphRes.ok) {
        return res.json({ emails: [], message: "Could not fetch emails", generatedAt: new Date().toISOString() });
      }

      const graphData = await graphRes.json();
      const emails = graphData.value || [];

      const deals = await db.select({
        id: crmDeals.id,
        name: crmDeals.name,
        status: crmDeals.status,
      }).from(crmDeals)
        .where(sql`${crmDeals.status} NOT IN ('Completed', 'Withdrawn', 'Invoiced', 'Billed')`);

      const dealNames = deals.map(d => d.name.toLowerCase());

      const triaged = emails.map((email: any) => {
        const subject = (email.subject || "").toLowerCase();
        const preview = (email.bodyPreview || "").toLowerCase();
        const combined = subject + " " + preview;

        let urgency: "high" | "medium" | "low" = "low";
        let dealMatch: { id: string; name: string } | null = null;
        const tags: string[] = [];

        if (email.importance === "high" || combined.includes("urgent") || combined.includes("asap") || combined.includes("immediately")) {
          urgency = "high";
          tags.push("urgent");
        }

        if (combined.includes("offer") || combined.includes("heads of terms") || combined.includes("hots")) {
          urgency = urgency === "low" ? "medium" : urgency;
          tags.push("deal-related");
        }

        if (combined.includes("invoice") || combined.includes("payment") || combined.includes("fee")) {
          tags.push("financial");
        }

        if (combined.includes("viewing") || combined.includes("inspection") || combined.includes("site visit")) {
          tags.push("viewing");
        }

        for (const deal of deals) {
          if (combined.includes(deal.name.toLowerCase().slice(0, 20))) {
            dealMatch = { id: deal.id, name: deal.name };
            urgency = urgency === "low" ? "medium" : urgency;
            tags.push("active-deal");
            break;
          }
        }

        return {
          id: email.id,
          subject: email.subject,
          from: email.from?.emailAddress?.name || email.from?.emailAddress?.address,
          receivedAt: email.receivedDateTime,
          isRead: email.isRead,
          urgency,
          tags,
          dealMatch,
        };
      });

      triaged.sort((a: any, b: any) => {
        const urg = { high: 0, medium: 1, low: 2 };
        return urg[a.urgency as keyof typeof urg] - urg[b.urgency as keyof typeof urg];
      });

      const summary = {
        total: triaged.length,
        high: triaged.filter((e: any) => e.urgency === "high").length,
        medium: triaged.filter((e: any) => e.urgency === "medium").length,
        dealRelated: triaged.filter((e: any) => e.dealMatch).length,
        unread: triaged.filter((e: any) => !e.isRead).length,
      };

      res.json({
        emails: triaged,
        summary,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[ai-intelligence] email-triage error:", err?.message);
      res.status(500).json({ message: "Failed to triage emails" });
    }
  });

  // ─── 10. WEEKLY TEAM DIGEST ───────────────────────────────────────────
  app.get("/api/ai/weekly-digest", requireAuth, async (req: Request, res: Response) => {
    try {
      const team = (req.query.team as string) || (req as any).user?.team || "Investment";
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const allDeals = await db.select().from(crmDeals);
      const teamDeals = allDeals.filter(d => d.team && d.team.includes(team));

      const recentlyUpdated = teamDeals.filter(d => d.updatedAt && new Date(d.updatedAt) > weekAgo);
      const newDeals = teamDeals.filter(d => d.createdAt && new Date(d.createdAt) > weekAgo);
      const completedDeals = teamDeals.filter(d =>
        ["COM", "INV", "EXC"].includes(legacyToCode(d.status) || "") &&
        d.updatedAt && new Date(d.updatedAt) > weekAgo
      );

      const activeDeals = teamDeals.filter(d => { const c = legacyToCode(d.status); return c !== null && !["COM", "WIT", "INV"].includes(c); });
      const totalActiveFees = activeDeals.reduce((s, d) => s + (d.fee || 0), 0);
      const completedFees = completedDeals.reduce((s, d) => s + (d.fee || 0), 0);

      const statusBreakdown: Record<string, number> = {};
      for (const d of activeDeals) {
        const s = d.status || "Unknown";
        statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
      }

      const invItems = team === "Investment" ? await db.select().from(investmentTracker) : [];
      const recentInvItems = invItems.filter(i => i.createdAt && new Date(i.createdAt) > weekAgo);

      const digestData = {
        team,
        period: `${weekAgo.toISOString().split("T")[0]} to ${now.toISOString().split("T")[0]}`,
        newDeals: newDeals.length,
        newDealNames: newDeals.map(d => d.name).slice(0, 10),
        completedDeals: completedDeals.length,
        completedDealNames: completedDeals.map(d => d.name).slice(0, 10),
        completedFees,
        totalActiveDeals: activeDeals.length,
        totalActiveFees,
        statusBreakdown,
        recentlyUpdated: recentlyUpdated.length,
        investmentAssets: team === "Investment" ? {
          total: invItems.length,
          newThisWeek: recentInvItems.length,
        } : null,
      };

      const aiDigest = await safeAICall({
        system: "You write concise weekly team digests for a London property agency. Write 4-6 bullet points covering: headline metric, wins, pipeline status, and anything that needs attention. Be specific with numbers. Use a positive but honest tone.",
        user: JSON.stringify(digestData),
        maxTokens: 400,
      });

      res.json({
        team,
        period: digestData.period,
        stats: {
          newDeals: newDeals.length,
          completedDeals: completedDeals.length,
          completedFees,
          totalActiveDeals: activeDeals.length,
          totalActiveFees,
          statusBreakdown,
          recentlyUpdated: recentlyUpdated.length,
        },
        highlights: {
          newDealNames: digestData.newDealNames,
          completedDealNames: digestData.completedDealNames,
        },
        investmentAssets: digestData.investmentAssets,
        aiDigest,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[ai-intelligence] weekly-digest error:", err?.message);
      res.status(500).json({ message: "Failed to generate weekly digest" });
    }
  });

  console.log("[ai-intelligence] All 10 AI intelligence endpoints registered");
}
