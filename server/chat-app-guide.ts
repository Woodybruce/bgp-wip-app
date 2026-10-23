import { APP_MAP } from "./chatbgp-app-map";

const MAX_RESPONSE_CHARACTERS = 12_000;
const EXCERPT_CHARACTERS = 2_200;
const SEARCH_PAGE_SIZE = 4;
const STOP_WORDS = new Set(["a", "an", "and", "are", "at", "be", "can", "do", "does", "for", "from", "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "please", "the", "to", "was", "what", "where", "with"]);

interface GuideSection {
  sectionId: string;
  title: string;
  text: string;
}

interface GuideExcerpt {
  sectionId: string;
  title: string;
  offset: number;
  text: string;
  totalCharacters: number;
  nextOffset: number | null;
}

export interface AppGuideQuery {
  query?: string;
  sectionId?: string;
  /** Character offset for a section; result offset for search or index pages. */
  offset?: number;
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function words(value: string): string[] {
  return normalized(value).split(/\s+/).filter(Boolean);
}

function splitSections(text: string): GuideSection[] {
  const headings = [...text.matchAll(/^#{2,6}\s+(.+)$/gm)];
  if (!headings.length) return [{ sectionId: "app-guide", title: "App guide", text }];
  const used = new Map<string, number>();
  return headings.map((heading, index) => {
    const title = heading[1].trim();
    const slug = normalized(title).replace(/ /g, "-") || "app-guide";
    const duplicate = (used.get(slug) || 0) + 1;
    used.set(slug, duplicate);
    return {
      sectionId: duplicate === 1 ? slug : `${slug}-${duplicate}`,
      title,
      // Preserve every character, including the initial newline and separators.
      text: text.slice(index === 0 ? 0 : heading.index, headings[index + 1]?.index ?? text.length),
    };
  });
}

const sections = splitSections(APP_MAP);

function safeOffset(offset: number | undefined): number {
  return typeof offset === "number" && Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
}

function excerpt(section: GuideSection, offset: number, characters: number): GuideExcerpt {
  const start = Math.min(offset, section.text.length);
  const end = Math.min(start + characters, section.text.length);
  return { sectionId: section.sectionId, title: section.title, offset: start,
    text: section.text.slice(start, end), totalCharacters: section.text.length,
    nextOffset: end < section.text.length ? end : null };
}

/** Fit exact source text to a serialized tool-response budget, including JSON escaping. */
function fitSectionPage(section: GuideSection, offset: number) {
  const makeResponse = (characters: number) => ({ mode: "section" as const, ...excerpt(section, offset, characters) });
  let low = 0;
  let high = Math.min(MAX_RESPONSE_CHARACTERS, section.text.length - Math.min(offset, section.text.length));
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    if (JSON.stringify(makeResponse(midpoint)).length <= MAX_RESPONSE_CHARACTERS) low = midpoint;
    else high = midpoint - 1;
  }
  return makeResponse(low);
}

/** Paragraphs stay intact when possible; long paragraphs get overlapping windows. */
function passages(section: GuideSection): Array<{ offset: number; text: string }> {
  const result: Array<{ offset: number; text: string }> = [];
  const paragraphPattern = /[^\n]+(?:\n(?!\n|[-*#])[^\n]+)*/g;
  for (const match of section.text.matchAll(paragraphPattern)) {
    const text = match[0];
    const start = match.index!;
    for (let offset = 0; offset < text.length;) {
      result.push({ offset: start + offset, text: text.slice(offset, offset + EXCERPT_CHARACTERS) });
      if (offset + EXCERPT_CHARACTERS >= text.length) break;
      offset += EXCERPT_CHARACTERS - 500;
    }
  }
  return result;
}

const searchableSections = sections.map(section => ({ section, passages: passages(section), titleWords: new Set(words(section.title)) }));

/** Existing staff navigation documentation only; this never reads app or client records. */
export function searchAppGuide(args: AppGuideQuery = {}) {
  const offset = safeOffset(args.offset);
  const sectionId = typeof args.sectionId === "string" ? args.sectionId.trim() : "";
  if (sectionId) {
    const section = sections.find(item => item.sectionId === sectionId);
    if (!section) return { mode: "error" as const, error: "Unknown app-guide section. Call without a query to list section IDs." };
    return fitSectionPage(section, offset);
  }

  const query = typeof args.query === "string" ? args.query.trim().slice(0, 500) : "";
  if (!query) {
    const entries = sections.map(section => ({ sectionId: section.sectionId, title: section.title, totalCharacters: section.text.length }));
    const page = entries.slice(offset, offset + 30);
    const response = () => ({ mode: "index" as const,
      guidance: "Search with query, or read a sectionId. With sectionId, offset and nextOffset are character positions; otherwise they are result positions. Continue until nextOffset is null to read all text.",
      totalSections: sections.length, sections: page,
      nextOffset: offset + page.length < entries.length ? offset + page.length : null });
    while (page.length > 1 && JSON.stringify(response()).length > MAX_RESPONSE_CHARACTERS) page.pop();
    return response();
  }

  const terms = [...new Set(words(query).filter(word => !STOP_WORDS.has(word)))].slice(0, 32);
  const phrase = normalized(query);
  const ranked = searchableSections.map(({ section, passages, titleWords }) => {
    let best: { offset: number; text: string; score: number } | null = null;
    for (const passage of passages) {
      const passageWords = new Set(words(passage.text));
      const matched = terms.filter(term => passageWords.has(term));
      if (!matched.length) continue;
      // Coverage beats repeated words. Exact phrases help queries such as
      // "business card" locate their instructions within a giant section.
      const score = matched.length * 10 + terms.filter(term => titleWords.has(term)).length * 2
        + (phrase && normalized(passage.text).includes(phrase) ? 8 : 0);
      if (!best || score > best.score) best = { ...passage, score };
    }
    return best ? { section, ...best } : null;
  }).filter((match): match is NonNullable<typeof match> => match !== null)
    .sort((a, b) => b.score - a.score || a.section.sectionId.localeCompare(b.section.sectionId));

  const selected = ranked.slice(offset, offset + SEARCH_PAGE_SIZE);
  const makeResponse = (characters: number) => ({ mode: "search" as const, query,
    guidance: "Excerpts may begin partway through a section. Read sectionId from offset 0 for full context, or use a result's nextOffset to continue it. Search pagination uses top-level nextOffset.",
    totalMatches: ranked.length,
    results: selected.map(match => excerpt(match.section, match.offset, Math.min(characters, match.text.length))),
    nextOffset: offset + selected.length < ranked.length ? offset + selected.length : null });
  let characters = EXCERPT_CHARACTERS;
  while (characters > 0 && JSON.stringify(makeResponse(characters)).length > MAX_RESPONSE_CHARACTERS) characters = Math.max(0, characters - 100);
  return makeResponse(characters);
}
