import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, ne, desc, sql, and, inArray } from "drizzle-orm";
import {
  aiLeadProfiles,
  aiLeads,
  aiLeadActivity,
  crmDeals,
  crmContacts,
  crmCompanies,
  crmProperties,
  crmRequirementsLeasing,
  crmRequirementsInvestment,
  newsArticles,
  users,
  type AiLeadProfile,
  type AiLead,
} from "@shared/schema";
import { requireAuth } from "./auth";
import Anthropic from "@anthropic-ai/sdk";

function getAnthropic(): Anthropic | null {
  if (process.env.ANTHROPIC_API_KEY) {
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  if (process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
    return new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });
  }
  return null;
}

async function gatherUserContext(userId: string) {
  const [userRow] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const userName = userRow?.name || userRow?.username || "User";
  const userRole = userRow?.role || "";
  const userTeam = userRow?.team || "";

  const recentDeals = await db
    .select({ id: crmDeals.id, name: crmDeals.name, status: crmDeals.status, dealType: crmDeals.dealType, assetClass: crmDeals.assetClass })
    .from(crmDeals)
    .where(sql`${crmDeals.internalAgent} @> ARRAY[${userName}]::text[]`)
    .orderBy(desc(crmDeals.createdAt))
    .limit(15);

  const recentNews = await db
    .select({ id: newsArticles.id, title: newsArticles.title, summary: newsArticles.aiSummary, tags: newsArticles.aiTags })
    .from(newsArticles)
    .orderBy(desc(newsArticles.publishedAt))
    .limit(20);

  const properties = await db
    .select({ id: crmProperties.id, name: crmProperties.name, status: crmProperties.status, assetClass: crmProperties.assetClass, address: crmProperties.address })
    .from(crmProperties)
    .orderBy(desc(crmProperties.createdAt))
    .limit(30);

  const leasingReqs = await db
    .select({ id: crmRequirementsLeasing.id, name: crmRequirementsLeasing.name, status: crmRequirementsLeasing.status, use: crmRequirementsLeasing.use, size: crmRequirementsLeasing.size, locations: crmRequirementsLeasing.requirementLocations })
    .from(crmRequirementsLeasing)
    .orderBy(desc(crmRequirementsLeasing.createdAt))
    .limit(20);

  const investReqs = await db
    .select({ id: crmRequirementsInvestment.id, name: crmRequirementsInvestment.name, status: crmRequirementsInvestment.status, use: crmRequirementsInvestment.use, size: crmRequirementsInvestment.size, locations: crmRequirementsInvestment.requirementLocations })
    .from(crmRequirementsInvestment)
    .orderBy(desc(crmRequirementsInvestment.createdAt))
    .limit(20);

  const companies = await db
    .select({ id: crmCompanies.id, name: crmCompanies.name, companyType: crmCompanies.companyType, description: crmCompanies.description })
    .from(crmCompanies)
    .where(ne(crmCompanies.aiDisabled, true))
    .orderBy(desc(crmCompanies.createdAt))
    .limit(30);

  const previousLeads = await db
    .select()
    .from(aiLeads)
    .where(eq(aiLeads.userId, userId))
    .orderBy(desc(aiLeads.createdAt))
    .limit(20);

  const dismissedLeadIds = await db
    .select({ leadId: aiLeadActivity.leadId })
    .from(aiLeadActivity)
    .where(and(eq(aiLeadActivity.userId, userId), eq(aiLeadActivity.action, "dismissed")));

  const convertedLeadIds = await db
    .select({ leadId: aiLeadActivity.leadId })
    .from(aiLeadActivity)
    .where(and(eq(aiLeadActivity.userId, userId), eq(aiLeadActivity.action, "converted")));

  return {
    userName,
    userRole,
    userTeam,
    recentDeals,
    recentNews,
    properties,
    leasingReqs,
    investReqs,
    companies,
    previousLeads,
    dismissedTitles: previousLeads
      .filter(l => dismissedLeadIds.some(d => d.leadId === l.id))
      .map(l => l.title),
    convertedTitles: previousLeads
      .filter(l => convertedLeadIds.some(d => d.leadId === l.id))
      .map(l => l.title),
  };
}

async function generateLeads(userId: string, profile: AiLeadProfile): Promise<any[]> {
  const anthropic = getAnthropic();
  if (!anthropic) {
    throw new Error("AI service not available — missing API key");
  }

  const context = await gatherUserContext(userId);
  const existingTitles = context.previousLeads.map(l => l.title);

  const systemPrompt = `You are an expert commercial property lead generation AI for Bruce Gillingham Pollard (BGP), a London-based property consultancy.
Your job is to identify actionable business leads for ${context.userName} (${context.userRole || "team member"}, ${context.userTeam || "BGP"} team).

THEIR LEAD PROFILE:
- Focus areas: ${(profile.focusAreas || []).join(", ") || "not specified"}
- Asset classes: ${(profile.assetClasses || []).join(", ") || "not specified"}
- Deal types: ${(profile.dealTypes || []).join(", ") || "not specified"}
- Custom brief: ${profile.customPrompt || "none"}

WHAT THEY PREVIOUSLY DISMISSED (avoid similar leads):
${context.dismissedTitles.slice(0, 10).join("\n") || "None yet"}

WHAT THEY CONVERTED (do more like these):
${context.convertedTitles.slice(0, 10).join("\n") || "None yet"}

DO NOT duplicate these existing leads:
${existingTitles.slice(0, 15).join("\n") || "None yet"}

Generate 3-6 high-quality, actionable leads based on the data provided. Each lead should:
1. Be specific and actionable — not vague
2. Reference real data from the CRM, news, or requirements where possible
3. Include a confidence score (0-100) based on how strong the signal is
4. Suggest a concrete next action
5. Explain WHY this is a lead (the reasoning)

Return a JSON array of leads, each with:
{
  "title": "Short descriptive title",
  "summary": "2-3 sentence explanation of the opportunity",
  "sourceType": "news|deal|property|requirement|email|market|introduction",
  "sourceContext": "What data triggered this lead",
  "area": "Geographic area if relevant",
  "assetClass": "Office|Retail|Industrial|Residential|Mixed Use|etc",
  "opportunityType": "Leasing|Investment|Advisory|Acquisition|Disposal|Introduction",
  "confidence": 50,
  "suggestedAction": "What should they do next",
  "aiReasoning": "Why this is a good lead for this person"
}

Return ONLY the JSON array, no other text.`;

  const userPrompt = `Here is the current CRM and market data to analyse for leads:

RECENT DEALS (${context.userName}'s):
${JSON.stringify(context.recentDeals.slice(0, 10), null, 1)}

ACTIVE PROPERTIES:
${JSON.stringify(context.properties.slice(0, 20), null, 1)}

ACTIVE LEASING REQUIREMENTS:
${JSON.stringify(context.leasingReqs.slice(0, 15), null, 1)}

ACTIVE INVESTMENT REQUIREMENTS:
${JSON.stringify(context.investReqs.slice(0, 15), null, 1)}

RECENT NEWS ARTICLES:
${JSON.stringify(context.recentNews.slice(0, 15), null, 1)}

COMPANIES IN CRM:
${JSON.stringify(context.companies.slice(0, 20), null, 1)}

Generate leads now.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [
        { role: "user", content: userPrompt },
      ],
      system: systemPrompt,
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const leads = JSON.parse(jsonMatch[0]);
    return Array.isArray(leads) ? leads : [];
  } catch (e: any) {
    console.error("[leads] AI generation failed:", e?.message);
    return [];
  }
}

async function generateSetupQuestions(userId: string): Promise<any> {
  const anthropic = getAnthropic();
  if (!anthropic) return { questions: [] };

  const context = await gatherUserContext(userId);

  const prompt = `You are setting up a personalised lead generation profile for ${context.userName} at BGP (a London commercial property consultancy).
Based on their current deals and activity, suggest good defaults and ask 2-3 short questions to tailor their lead preferences.

Their current deals: ${JSON.stringify(context.recentDeals.slice(0, 5))}
Their role: ${context.userRole || "not specified"}

Return JSON:
{
  "greeting": "A short personalised greeting",
  "suggestedAreas": ["area1", "area2"],
  "suggestedAssetClasses": ["class1", "class2"],
  "suggestedDealTypes": ["type1", "type2"],
  "questions": [
    {"id": "q1", "text": "Question text", "type": "text"},
    {"id": "q2", "text": "Question text", "type": "multiselect", "options": ["opt1", "opt2"]}
  ]
}
Return ONLY the JSON.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { questions: [] };
    return JSON.parse(jsonMatch[0]);
  } catch (e: any) {
    console.error("[leads] Setup questions failed:", e?.message);
    return {
      greeting: `Hi ${context.userName}! Let's set up your lead preferences.`,
      suggestedAreas: ["Mayfair", "Soho", "Fitzrovia", "Marylebone", "Victoria"],
      suggestedAssetClasses: ["Office", "Retail", "Mixed Use"],
      suggestedDealTypes: ["Leasing", "Investment", "Advisory"],
      questions: [
        { id: "q1", text: "What types of opportunities are you most focused on right now?", type: "text" },
        { id: "q2", text: "Any specific companies or sectors you're targeting?", type: "text" },
      ],
    };
  }
}

export function setupLeadsRoutes(app: Express) {
  app.get("/api/leads/profile", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId || req.tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const [profile] = await db
        .select()
        .from(aiLeadProfiles)
        .where(eq(aiLeadProfiles.userId, userId))
        .limit(1);

      res.json(profile || null);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/leads/setup", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId || req.tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const setup = await generateSetupQuestions(userId);
      res.json(setup);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/leads/profile", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId || req.tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const { focusAreas, assetClasses, dealTypes, customPrompt } = req.body;

      const [existing] = await db
        .select()
        .from(aiLeadProfiles)
        .where(eq(aiLeadProfiles.userId, userId))
        .limit(1);

      if (existing) {
        await db
          .update(aiLeadProfiles)
          .set({
            focusAreas: focusAreas || existing.focusAreas,
            assetClasses: assetClasses || existing.assetClasses,
            dealTypes: dealTypes || existing.dealTypes,
            customPrompt: customPrompt !== undefined ? customPrompt : existing.customPrompt,
            setupComplete: true,
            updatedAt: new Date(),
          })
          .where(eq(aiLeadProfiles.id, existing.id));

        const [updated] = await db.select().from(aiLeadProfiles).where(eq(aiLeadProfiles.id, existing.id));
        return res.json(updated);
      }

      const [profile] = await db
        .insert(aiLeadProfiles)
        .values({
          userId,
          focusAreas: focusAreas || [],
          assetClasses: assetClasses || [],
          dealTypes: dealTypes || [],
          customPrompt: customPrompt || null,
          setupComplete: true,
        })
        .returning();

      res.json(profile);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/leads", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId || req.tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const statusFilter = (req.query.status as string) || "new,saved";
      const statuses = statusFilter.split(",");

      const leads = await db
        .select()
        .from(aiLeads)
        .where(and(
          eq(aiLeads.userId, userId),
          inArray(aiLeads.status, statuses)
        ))
        .orderBy(desc(aiLeads.confidence), desc(aiLeads.createdAt))
        .limit(50);

      res.json(leads);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/leads/generate", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId || req.tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const [profile] = await db
        .select()
        .from(aiLeadProfiles)
        .where(eq(aiLeadProfiles.userId, userId))
        .limit(1);

      if (!profile) {
        return res.status(400).json({ error: "Please set up your lead profile first" });
      }

      const rawLeads = await generateLeads(userId, profile);
      const insertedLeads: AiLead[] = [];

      for (const lead of rawLeads) {
        try {
          const [inserted] = await db
            .insert(aiLeads)
            .values({
              userId,
              title: lead.title || "Untitled Lead",
              summary: lead.summary || "",
              sourceType: lead.sourceType || "market",
              sourceContext: lead.sourceContext || null,
              area: lead.area || null,
              assetClass: lead.assetClass || null,
              opportunityType: lead.opportunityType || null,
              confidence: Math.min(100, Math.max(0, lead.confidence || 50)),
              status: "new",
              suggestedAction: lead.suggestedAction || null,
              aiReasoning: lead.aiReasoning || null,
            })
            .returning();

          insertedLeads.push(inserted);
        } catch (e: any) {
          console.error("[leads] Failed to insert lead:", e?.message);
        }
      }

      console.log(`[leads] Generated ${insertedLeads.length} leads for user ${userId}`);
      res.json(insertedLeads);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/leads/:id/action", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId || req.tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const leadId = req.params.id;
      const { action, note } = req.body;

      if (!["dismissed", "saved", "converted", "archived"].includes(action)) {
        return res.status(400).json({ error: "Invalid action" });
      }

      const statusMap: Record<string, string> = {
        dismissed: "dismissed",
        saved: "saved",
        converted: "converted",
        archived: "archived",
      };

      await db
        .update(aiLeads)
        .set({ status: statusMap[action], updatedAt: new Date() })
        .where(and(eq(aiLeads.id, leadId), eq(aiLeads.userId, userId)));

      await db.insert(aiLeadActivity).values({
        leadId,
        userId,
        action,
        note: note || null,
      });

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/leads/stats", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId || req.tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const result = await db.execute(sql`
        SELECT status, COUNT(*)::int as count
        FROM ai_leads
        WHERE user_id = ${userId}
        GROUP BY status
      `);

      const stats: Record<string, number> = {};
      for (const row of result.rows as any[]) {
        stats[row.status] = row.count;
      }

      res.json({
        new: stats.new || 0,
        saved: stats.saved || 0,
        converted: stats.converted || 0,
        dismissed: stats.dismissed || 0,
        total: Object.values(stats).reduce((a, b) => a + b, 0),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log("[leads] AI Leads routes registered");
}
