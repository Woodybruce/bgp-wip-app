import { Type } from "@sinclair/typebox";

let sessionCookie: string | null = null;

async function login(config: { dashboardUrl: string; username: string; password: string }): Promise<string> {
  if (sessionCookie) return sessionCookie;

  const res = await fetch(`${config.dashboardUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: config.username, password: config.password }),
    redirect: "manual",
  });

  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    sessionCookie = setCookie.split(";")[0];
  }

  if (!res.ok && res.status !== 302) {
    throw new Error(`Login failed (${res.status})`);
  }

  return sessionCookie || "";
}

async function dashboardGet(config: any, path: string): Promise<any> {
  const cookie = await login(config);
  const res = await fetch(`${config.dashboardUrl}${path}`, {
    headers: { Cookie: cookie },
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

async function dashboardPost(config: any, path: string, body: any): Promise<any> {
  const cookie = await login(config);
  const res = await fetch(`${config.dashboardUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

function formatResults(data: any[], fields: string[], maxItems = 10): string {
  if (!data || data.length === 0) return "No results found.";
  const items = data.slice(0, maxItems);
  const lines = items.map((item, i) => {
    const parts = fields
      .map((f) => {
        const val = item[f] || item[f.toLowerCase()];
        return val ? `${f}: ${val}` : null;
      })
      .filter(Boolean);
    return `${i + 1}. ${parts.join(" | ")}`;
  });
  if (data.length > maxItems) lines.push(`... and ${data.length - maxItems} more`);
  return lines.join("\n");
}

export default function (api: any) {
  const config = api.config;

  api.registerTool({
    name: "bgp_diary",
    description:
      "Get BGP team diary entries — meetings, viewings, appointments. Shows what the team has scheduled.",
    parameters: Type.Object({}),
    async execute() {
      const data = await dashboardGet(config, "/api/diary");
      return {
        content: [
          {
            type: "text",
            text: `BGP Diary (${data.length} entries):\n${formatResults(data, ["title", "date", "time", "location", "team"])}`,
          },
        ],
      };
    },
  });

  api.registerTool({
    name: "bgp_news",
    description:
      "Get the latest property news from BGP's AI-curated news feed. Articles are scored for relevance to each BGP team.",
    parameters: Type.Object({
      team: Type.Optional(
        Type.String({
          description: "Filter news by team relevance: Investment, London Leasing, Lease Advisory, National Leasing, Tenant Rep, or Development",
        })
      ),
      limit: Type.Optional(Type.Number({ description: "Number of articles to return (default 10)" })),
    }),
    async execute(_id: string, params: { team?: string; limit?: number }) {
      const teamParam = params.team ? `&team=${encodeURIComponent(params.team)}` : "";
      const limit = params.limit || 10;
      const data = await dashboardGet(config, `/api/news-feed/articles?limit=${limit}${teamParam}`);
      const articles = (data || []).slice(0, limit);
      const lines = articles.map((a: any, i: number) => {
        const score = params.team && a.aiRelevanceScores ? a.aiRelevanceScores[params.team] || "?" : "";
        const scoreStr = score ? ` [Relevance: ${score}/100]` : "";
        return `${i + 1}. ${a.title} — ${a.sourceName || "Unknown source"}${scoreStr}\n   ${a.aiSummary || a.summary || ""}\n   ${a.url}`;
      });
      return {
        content: [
          {
            type: "text",
            text: `Latest Property News${params.team ? ` (for ${params.team})` : ""}:\n\n${lines.join("\n\n")}`,
          },
        ],
      };
    },
  });

  api.registerTool({
    name: "bgp_chat",
    description:
      "Chat with ChatBGP, the AI property assistant for Bruce Gillingham Pollard. Ask about property market trends, tenant requirements, lease advice, valuations, or anything related to Central London property. ChatBGP has access to BGP's knowledge base, financial models, document templates, and CRM data.",
    parameters: Type.Object({
      message: Type.String({ description: "Your question or message for the ChatBGP AI assistant" }),
    }),
    async execute(_id: string, params: { message: string }) {
      const data = await dashboardPost(config, "/api/chatbgp/chat", {
        messages: [{ role: "user", content: params.message }],
      });
      return {
        content: [
          {
            type: "text",
            text: data.reply || "No response from ChatBGP",
          },
        ],
      };
    },
  });

}
