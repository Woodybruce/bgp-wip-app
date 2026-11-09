import { isPrivateEmailRecord, PRIVATE_MAIL_POLICY_VERSION } from "./private-mail";
import { isPublicNewsSource, newsArticleUrl } from "./news-ingestion";

// Older news cards used the first six articles as evidence regardless of the
// model's sources; older email cards omitted mailbox/recipient checks. Keep
// those rows for audit, but never reuse them as published evidence or themes.
export const INSIGHTS_SOURCE_POLICY_VERSION = "public-sources-20261027-v1";

export function parseInsightEvidence(value: unknown): any[] {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return []; } }
  return Array.isArray(value) ? value.filter(item => item && typeof item === "object") : [];
}

export function isPublishableInsight(row: { source_kind?: string; evidence?: unknown }): boolean {
  const evidence = parseInsightEvidence(row.evidence);
  if (evidence.some(item => isPrivateEmailRecord(item))) return false;
  if (row.source_kind === "portfolio") return true; // audience/company scope is enforced by the route
  if (row.source_kind !== "news" && row.source_kind !== "market-report") return false;
  return evidence.length > 0 && evidence.every(item => item.policyVersion === INSIGHTS_SOURCE_POLICY_VERSION && (
    row.source_kind === "news" ? item.type === "article" && typeof item.id === "string" && !!newsArticleUrl(item.url)
      : item.type === "report-email" && item.mailPrivacyPolicy === PRIVATE_MAIL_POLICY_VERSION
  ));
}

export function insightEvidenceForSources(sourceIds: unknown, supplied: any[]): any[] | null {
  if (!Array.isArray(sourceIds) || sourceIds.length < 1 || sourceIds.length > 6 || sourceIds.some(id => typeof id !== "string")) return null;
  const available = new Map(supplied.map(item => [item.id, item]));
  const ids = [...new Set<string>(sourceIds)];
  if (ids.some(id => !available.has(id))) return null;
  return ids.map(id => available.get(id));
}

/** Bounds the actual model input and its evidence together, preserving which
 * database row was last consumed even when invalid URLs are skipped. */
export function prepareInsightNewsBatch(rows: any[], budget = 8500): { material: string; evidence: any[]; lastScanned: any | null } {
  const lines: string[] = [], evidence: any[] = [];
  let lastScanned: any | null = null, length = 0;
  for (const row of rows) {
    const url = newsArticleUrl(row.url);
    if (!isPublicNewsSource({ type: row.source_type, category: row.source_category, active: row.source_active }) || !url) { lastScanned = row; continue; }
    const line = `[article_id=${row.id}] [${String(row.source_name || "Publisher").slice(0, 90)}] ${String(row.title || "").slice(0, 180)}: ${String(row.summary || row.ai_summary || "").slice(0, 260)}`;
    if (length + line.length + 1 > budget) break;
    lines.push(line); length += line.length + 1; lastScanned = row;
    evidence.push({ type: "article", id: String(row.id), title: row.title, url, policyVersion: INSIGHTS_SOURCE_POLICY_VERSION });
  }
  return { material: lines.join("\n"), evidence, lastScanned };
}
