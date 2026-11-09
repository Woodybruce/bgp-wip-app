import type { Article } from "./content";

// Presentation-only content for the wireframe preview. Keep these out of the
// dashboard feed and out of the real News, Opinion and Type filter results.
export const PLACEHOLDER_ARTICLE_BODY = [
  "Placeholder copy — full article to follow. This opening paragraph reserves space for the completed story: its subject, the context behind it and the reason it matters to the reader. The final version will introduce the people, places or ideas involved using approved information from the team. No announcement or transaction is being reported in this preview.",
  "Placeholder copy — the next paragraph will develop the main point with useful background and a clear explanation of the subject. This passage shows the intended length and reading rhythm while the editorial copy is prepared. Any names, dates, quotations or figures will be added with the final story rather than represented by invented examples here.",
  "## Placeholder subheading — copy to follow",
  "Placeholder copy — this section will give the reader more detail, drawing together the relevant observations and supporting material. It can describe a place, introduce an idea or explain the work behind a project once that information has been supplied. The completed paragraph will sit alongside the chosen photography and help connect the opening introduction to the rest of the article.",
  "Placeholder copy — a further paragraph provides room for an additional perspective and any approved supporting evidence. The final text should explain what is distinctive about the subject and make its significance clear. This is illustrative editorial space only; the stock photographs show the image treatment and do not document a BGP instruction or event.",
  "## Placeholder closing section — copy to follow",
  "Placeholder copy — the concluding section will bring the story together and give readers an appropriate next step, such as exploring a related article or contacting the relevant team. Approved copy, the publication date, author credit and final images will replace these placeholders when the article is ready.",
];

const PREVIEW_TOPICS = [
  ["retail-perspective", "A fresh perspective on retail places", "/images/shop-boutique.jpg"],
  ["neighbourhood-story", "The character of a neighbourhood", "/images/st-christophers-place.jpg"],
  ["hospitality-insight", "Ideas for hospitality spaces", "/images/restaurant.jpg"],
  ["brand-conversation", "A conversation about brands", "/images/shop-menswear.jpg"],
  ["city-perspective", "Looking at the city differently", "/images/city-towers.jpg"],
  ["wellness-insight", "Space for a wellness story", "/images/gym.jpg"],
  ["places-to-meet", "Places to meet and spend time", "/images/cafe.jpg"],
  ["leisure-perspective", "A closer look at leisure", "/images/cinema.jpg"],
  ["property-perspective", "A perspective on property", "/images/office.jpg"],
] as const;

export const NEWS_PLACEHOLDERS: Article[] = PREVIEW_TOPICS.map(([slug, title, image]) => ({
  slug: `placeholder-${slug}`,
  title,
  category: "Placeholder",
  date: "Copy to follow",
  author: "",
  standfirst: "Placeholder copy — an introduction to a future article will appear here. This illustrative story and stock photograph show the intended layout while the final subject, text and imagery are prepared.",
  body: PLACEHOLDER_ARTICLE_BODY,
  image,
  isSample: true,
}));

export const isNewsPlaceholder = (article: Article) => article.isSample === true && NEWS_PLACEHOLDERS.some((item) => item.slug === article.slug);

export function withNewsPlaceholders(articles: Article[]): Article[] {
  const missing = Math.max(0, 9 - articles.length);
  const available = NEWS_PLACEHOLDERS.filter((placeholder) => !articles.some((article) => article.slug === placeholder.slug));
  return [...articles, ...available.slice(0, missing)];
}
