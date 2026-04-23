// RSS.app API client — turns arbitrary URLs into RSS feeds
// https://rss.app API v1. Auth: Bearer {API_KEY}:{API_SECRET}
const RSSAPP_BASE = "https://api.rss.app/v1";

function authHeader(): string | null {
  const key = process.env.RSSAPP_API_KEY;
  const secret = process.env.RSSAPP_API_SECRET;
  if (!key || !secret) return null;
  return `Bearer ${key}:${secret}`;
}

export interface RssAppFeed {
  id: string;
  rss_feed_url: string;
  title: string;
  source_url: string;
  icon?: string;
  description?: string;
}

export async function rssappHealth(): Promise<{ ok: boolean; error?: string; feedCount?: number }> {
  const auth = authHeader();
  if (!auth) return { ok: false, error: "RSSAPP_API_KEY or RSSAPP_API_SECRET not set" };
  try {
    const res = await fetch(`${RSSAPP_BASE}/feeds?limit=1`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    const data: any = await res.json();
    return { ok: true, feedCount: data.total ?? data.data?.length ?? 0 };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Unknown error" };
  }
}

export async function createRssAppFeed(sourceUrl: string): Promise<RssAppFeed> {
  const auth = authHeader();
  if (!auth) throw new Error("RSS.app not configured (RSSAPP_API_KEY + RSSAPP_API_SECRET)");
  const res = await fetch(`${RSSAPP_BASE}/feeds`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ url: sourceUrl }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`RSS.app create feed failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as RssAppFeed;
}

export async function listRssAppFeeds(): Promise<RssAppFeed[]> {
  const auth = authHeader();
  if (!auth) return [];
  const res = await fetch(`${RSSAPP_BASE}/feeds?limit=100`, {
    headers: { Authorization: auth },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];
  const data: any = await res.json();
  return (data.data || []) as RssAppFeed[];
}

export async function deleteRssAppFeed(feedId: string): Promise<void> {
  const auth = authHeader();
  if (!auth) throw new Error("RSS.app not configured");
  const res = await fetch(`${RSSAPP_BASE}/feeds/${feedId}`, {
    method: "DELETE",
    headers: { Authorization: auth },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`RSS.app delete failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

// Google News RSS — no API key required, URL-based query feeds
export function googleNewsRssUrl(query: string, opts?: { hl?: string; gl?: string; ceid?: string }): string {
  const hl = opts?.hl || "en-GB";
  const gl = opts?.gl || "GB";
  const ceid = opts?.ceid || "GB:en";
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}
