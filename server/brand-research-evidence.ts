import type { PerplexityResponse } from "./perplexity";
import { isBrandNewsRelevant } from "./brand-news-relevance";
import { newsArticleUrl } from "./news-ingestion";
import { isNewsErrorTitle } from "../shared/news-title";

type Source = { url: string; title: string; excerpt: string | null };
export type SourcedBrandSignal = {
  signal_type: "opening" | "closure" | "funding" | "exec_change" | "sector_move" | "rumour" | "news";
  headline: string; detail: string | null; source_url: string; signal_date: string | null;
  magnitude: "small" | "medium" | "large"; sentiment: "positive" | "neutral" | "negative";
};
const plain = (value: unknown) => typeof value === "string" ? value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";

/** Only search/citation metadata supplied by the provider is evidence. Its
 * generated answer is deliberately not a source of headlines or excerpts. */
export function brandResearchSources(response: PerplexityResponse): Source[] {
  const metadata = [...(Array.isArray(response.raw?.search_results) ? response.raw.search_results : []),
    ...(Array.isArray(response.raw?.output) ? response.raw.output.filter((entry: any) => String(entry?.type).includes("search") && Array.isArray(entry.results)).flatMap((entry: any) => entry.results) : [])];
  const found = new Map<string, Source>();
  for (const entry of [...metadata, ...(response.citations || [])]) {
    const url = newsArticleUrl(entry?.url);
    if (!url || new URL(url).pathname.replace(/\//g, "").length < 3) continue;
    const title = plain(entry?.title);
    if (title.length < 12 || isNewsErrorTitle(title)) continue;
    const existing = found.get(url);
    const excerpt = plain(entry?.snippet || entry?.description || entry?.text || entry?.content).slice(0, 1200) || null;
    if (!existing || !existing.excerpt && excerpt) found.set(url, { url, title: title.slice(0, 400), excerpt });
  }
  return [...found.values()].slice(0, 12);
}

function exactEventDate(value: unknown, quote: unknown, source: Source): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) return null;
  const evidence = plain(quote);
  const sourceText = `${source.title} ${source.excerpt || ""}`;
  if (evidence.length < 10 || !sourceText.toLowerCase().includes(evidence.toLowerCase())) return null;
  const day = date.getUTCDate(), year = date.getUTCFullYear();
  const month = date.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const shortMonth = date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  // A source publication timestamp is not the event's date. An exact day
  // must appear in the cited text; a month/quarter/"recently" stays unknown.
  const written = new RegExp(`\\b(?:${day}(?:st|nd|rd|th)?\\s+(?:${month}|${shortMonth})\\s+${year}|(?:${month}|${shortMonth})\\s+${day}(?:st|nd|rd|th)?,?\\s+${year})\\b`, "i");
  return evidence.includes(value) || written.test(evidence) ? value : null;
}

export function sourcedBrandResearchSignals(company: any, events: unknown, response: PerplexityResponse): SourcedBrandSignal[] {
  if (!Array.isArray(events)) return [];
  const sources = new Map(brandResearchSources(response).map(source => [source.url, source]));
  const seen = new Set<string>(), result: SourcedBrandSignal[] = [];
  for (const event of events.slice(0, 20)) {
    if (!event || typeof event !== "object") continue;
    const url = newsArticleUrl(event.source_url);
    const source = url ? sources.get(url) : null;
    if (!url || !source || seen.has(url) || !isBrandNewsRelevant(company, { title: source.title, summary: source.excerpt, url })) continue;
    if (!["opening", "closure", "funding", "exec_change", "sector_move", "rumour", "news"].includes(event.signal_type)) continue;
    seen.add(url);
    result.push({ signal_type: event.signal_type, headline: source.title, detail: source.excerpt,
      source_url: url, signal_date: exactEventDate(event.signal_date, event.date_evidence, source),
      magnitude: ["small", "medium", "large"].includes(event.magnitude) ? event.magnitude : "small",
      sentiment: ["positive", "neutral", "negative"].includes(event.sentiment) ? event.sentiment : "neutral",
    });
  }
  return result;
}

export function sourcedBrandResearchAnalysis(signals: SourcedBrandSignal[]): string | null {
  if (!signals.length) return null;
  return `Recent sourced reporting:\n\n${signals.slice(0, 8).map(signal => `${signal.headline}${signal.detail ? ` — ${signal.detail}` : ""}\nSource: ${signal.source_url}`).join("\n\n")}`;
}
