// Default seed vocabulary for the AI news tagger. At runtime the controlled
// vocabulary lives in the news_tags table (editable by any logged-in user
// via the news settings UI) — this file only seeds it on first run / dev
// reset and provides a safe fallback if the DB read fails.
export const DEFAULT_NEWS_TAGS = [
  "new openings",
  "flagships",
  "dtc",
  "brand performance",
  "global retail",
  "retail",
  "fashion",
  "high street",
  "wellness",
  "new operators",
] as const;
