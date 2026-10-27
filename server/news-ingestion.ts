/** Shared public-news policy and bounded ingestion helpers. No database or
 * provider clients here, so failure and provenance rules can be tested. */
export const PUBLIC_NEWS_SOURCE_TYPES = ["rss", "rssapp", "api", "google_news", "market_landlord", "market_centre", "market_openings"];
export function isPublicNewsSource(source: { type?: string | null; category?: string | null; active?: boolean | null }): boolean {
  return source.active !== false && PUBLIC_NEWS_SOURCE_TYPES.includes(source.type || "") && !/^brand:/i.test(source.category || "");
}

/** Promote only a known public search copy, never private/email/orphan data. */
export function canPromotePublicNewsSource(previous: { type?: string | null; category?: string | null }, incoming: { type?: string | null; category?: string | null; active?: boolean | null }): boolean {
  return isPublicNewsSource(incoming) && previous.type === "google_news" && /^brand:/i.test(previous.category || "");
}

/** Constant-only SQL policy; aliases are identifiers, never user input. */
export function publicNewsSourceSql(alias = "ns"): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid news-source alias");
  return `${alias}.active IS NOT FALSE AND ${alias}.type IN (${PUBLIC_NEWS_SOURCE_TYPES.map(type => `'${type}'`).join(",")}) AND (${alias}.category IS NULL OR lower(${alias}.category) NOT LIKE 'brand:%')`;
}

export function newsArticleUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    if (/^(?:localhost$|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|\[?::1\]?$)/i.test(url.hostname)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|fbclid|gclid|msclkid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

/** Publication dates must come from source metadata. Collection time is
 * stored separately in fetched_at, never substituted for publication. */
export function newsPublicationDate(...values: unknown[]): Date | null {
  for (const value of values) {
    if (typeof value !== "string" && !(value instanceof Date)) continue;
    const date = new Date(value);
    if (Number.isFinite(+date) && +date > 0) return date;
  }
  return null;
}

export function isRssNewsSource(source: { type?: string | null; feedUrl?: string | null }): boolean {
  return source.type !== "api" && !!newsArticleUrl(source.feedUrl);
}

export function greenStreetArticleUrl(article: { gsNewsUrl?: unknown }): string | null {
  const value = newsArticleUrl(article.gsNewsUrl);
  if (!value) return null;
  const url = new URL(value);
  return /^(?:www\.)?greenstreetnews\.com$/i.test(url.hostname) && url.pathname.replace(/\//g, "").length > 2 && !/^\/api(?:\/|$)/i.test(url.pathname) ? value : null;
}

/** Single process coalescing: overlapping cron/startup/manual requests join
 * the same work, then a later request can retry even after failure. */
export function singleFlight<T>() {
  let pending: Promise<T> | undefined;
  return (work: () => Promise<T>): Promise<T> => {
    if (!pending) pending = Promise.resolve().then(work).finally(() => { pending = undefined; });
    return pending;
  };
}

export async function forEachNewsItem<T>(items: T[], process: (item: T) => Promise<void>, onError: (error: unknown) => void): Promise<number> {
  let errors = 0;
  for (const item of items) {
    try { await process(item); }
    catch (error) { errors++; onError(error); }
  }
  return errors;
}

export function newsScoringLimit(value = process.env.NEWS_SCORING_BATCH_LIMIT): number {
  if (value == null || value.trim() === "") return 100;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.floor(parsed))) : 100;
}
export interface ValidatedNewsScore {
  index: number;
  relevanceScores: Record<string, number>;
  tags: string[];
  aiSummary: string | null;
}
export function validateNewsScores(value: unknown, batchLength: number, teams: string[], vocabulary: readonly string[]): ValidatedNewsScore[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as any).articles)) return [];
  const seen = new Set<number>();
  const valid: ValidatedNewsScore[] = [];
  for (const item of (value as any).articles) {
    if (!item || !Number.isInteger(item.index) || item.index < 1 || item.index > batchLength || seen.has(item.index)) continue;
    if (!item.relevanceScores || teams.some(team => typeof item.relevanceScores[team] !== "number" || !Number.isFinite(item.relevanceScores[team]) || item.relevanceScores[team] < 0 || item.relevanceScores[team] > 100)) continue;
    if (item.aiSummary != null && (typeof item.aiSummary !== "string" || item.aiSummary.length > 2000)) continue;
    seen.add(item.index);
    valid.push({ index: item.index,
      relevanceScores: Object.fromEntries(teams.map(team => [team, Math.round(item.relevanceScores[team])])),
      tags: Array.isArray(item.tags) ? [...new Set<string>(item.tags.filter((tag: unknown) => typeof tag === "string" && vocabulary.includes(tag)))].slice(0, 4) : [],
      aiSummary: typeof item.aiSummary === "string" ? item.aiSummary.trim() || null : null,
    });
  }
  return valid;
}

/** At most one provider call per five articles, no retry loop. A provider
 * outage or malformed batch stops this pass; unsaved rows stay retryable. */
export async function scoreNewsBatches<T>(articles: T[], options: {
  teams: string[];
  vocabulary: readonly string[];
  score: (batch: T[]) => Promise<unknown>;
  save: (article: T, score: ValidatedNewsScore) => Promise<void>;
  onError: (error: unknown) => void;
}): Promise<number> {
  let scored = 0;
  for (let offset = 0; offset < Math.min(articles.length, 100); offset += 5) {
    const batch = articles.slice(offset, offset + 5);
    try {
      const values = validateNewsScores(await options.score(batch), batch.length, options.teams, options.vocabulary);
      for (const value of values) { await options.save(batch[value.index - 1], value); scored++; }
      if (values.length !== batch.length) {
        options.onError(new Error("News scoring returned incomplete or invalid results; unscored items remain pending"));
        break;
      }
    } catch (error) { options.onError(error); break; }
  }
  return scored;
}


export function newsViewerId(request: { session?: { userId?: unknown } | null; tokenUserId?: unknown }): string | null {
  const id = request.session?.userId || request.tokenUserId;
  return typeof id === "string" && id.length ? id : null;
}
