import { db } from "../db";
import { chatMemories, businessLearnings } from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";
import type { Request } from "express";

/**
 * Get personalized memory context for a user
 */
export async function getMemoryContext(userId: string): Promise<string> {
  const memories = await db.select()
    .from(chatMemories)
    .where(eq(chatMemories.userId, userId))
    .orderBy(desc(chatMemories.createdAt))
    .limit(100);

  if (!memories.length) return "";

  const grouped = memories.reduce((acc, mem) => {
    if (!acc[mem.category]) acc[mem.category] = [];
    acc[mem.category].push(mem.memory);
    return acc;
  }, {} as Record<string, string[]>);

  const categories = {
    preferences: "Preferences",
    business: "Business",
    deals: "Deals", 
    clients: "Clients",
    personal: "Personal",
    properties: "Properties"
  };

  let context = "\n\n## Your Memory (facts you've learned from past conversations with this user)\nUse these to personalise your responses. Reference relevant memories when they help answer a question.\n";
  
  for (const [key, label] of Object.entries(categories)) {
    if (grouped[key]?.length) {
      context += `\n### ${label}\n${grouped[key].map((m: any) => `- ${m}`).join("\n")}\n`;
    }
  }

  return context;
}

/**
 * Get global business learnings context
 */
export async function getBusinessLearningsContext(): Promise<string> {
  const learnings = await db.select()
    .from(businessLearnings)
    .orderBy(desc(businessLearnings.createdAt))
    .limit(200);

  if (!learnings.length) return "";

  const grouped = learnings.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item.learning);
    return acc;
  }, {} as Record<string, string[]>);

  const categories = {
    team_preference: "Team Preferences",
    property_insight: "Property Insights",
    client_intel: "Client & Tenant Intelligence",
    market_knowledge: "Market Knowledge",
    bgp_process: "BGP Processes & Preferences",
    general: "General"
  };

  let context = "\n\n## Business Knowledge (facts learned from conversations with BGP team)\n";
  context += "These are verified facts about BGP's business, clients, properties, and market. Use them to give informed, specific answers.\n";

  for (const [key, label] of Object.entries(categories)) {
    if (grouped[key]?.length) {
      context += `\n### ${label}\n${grouped[key].map((l: any) => `- ${l}`).join("\n")}\n`;
    }
  }

  return context;
}

/**
 * Extract and save memories from an AI conversation
 */
export async function extractAndSaveMemories(
  req: Request, 
  conversation: { role: string; content: string }[]
): Promise<void> {
  const userId = req.session?.userId || (req as any).tokenUserId;
  if (!userId || conversation.length < 2) return;

  try {
    // Use a lightweight model for memory extraction
    const { callClaude, CHATBGP_HELPER_MODEL } = await import("./claude-adapter");
    
    const result = await callClaude({
      model: CHATBGP_HELPER_MODEL,
      messages: [
        {
          role: "system",
          content: `Extract key facts about the user to remember for future conversations. Only extract concrete, reusable information like:
- Preferences (how they like things done)
- Business context (their role, current projects)
- Deal information (specific properties or transactions)
- Client relationships
- Personal details they've shared

Output as JSON array: [{"category": "preferences|business|deals|clients|personal|properties", "memory": "fact to remember"}]
Return empty array if nothing significant to remember.`
        },
        {
          role: "user", 
          content: `Extract memories from this conversation:\n${conversation.map(m => `${m.role}: ${m.content}`).join("\n\n")}`
        }
      ],
      max_tokens: 1000
    });

    let memRaw = result.choices[0].message.content?.trim() || "[]";
    if (memRaw.startsWith("```")) memRaw = memRaw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    const memories = JSON.parse(memRaw);
    
    if (Array.isArray(memories)) {
      for (const mem of memories) {
        if (mem.category && mem.memory) {
          await db.insert(chatMemories).values({
            userId: userId,
            category: mem.category,
            memory: mem.memory.substring(0, 500),
            metadata: {}
          }).onConflictDoNothing();
        }
      }
    }
  } catch (error) {
    console.error("[Memory] Failed to extract memories:", error);
  }
}

/**
 * Check if content contains sensitive information that shouldn't be saved
 */
export function isSensitiveContent(content: string): boolean {
  const sensitivePatterns = [
    /\b(password|secret|token|api[_\s-]?key)\b/i,
    /\b(visa|mastercard|amex|\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/i,
    /\b(ssn|social security|ni number|national insurance)\b/i,
  ];
  
  return sensitivePatterns.some(pattern => pattern.test(content));
}