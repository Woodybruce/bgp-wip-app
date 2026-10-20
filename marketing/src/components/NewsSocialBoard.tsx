import { useId, useMemo, useState } from "react";
import { Link } from "wouter";
import type { Article } from "../lib/content";
import { SOCIAL_POSTS, type SocialPost } from "../lib/social-posts";
import { useSiteContent } from "../lib/site-content";
import "./news-social-board.css";

type Filter = "All" | "News" | "Opinion" | "Social";
const FILTERS: readonly Filter[] = ["All", "News", "Opinion", "Social"];
const FEATURED_SLUGS = [
  "enduring-appeal-portman-estate",
  "behind-the-brand-yolk",
  "wellness-placemaking-essential",
  "adieu-2025",
];

const IMAGE_ALTS: Record<string, string> = {
  "/images/anna-nina.jpg": "Independent shops and red-brick buildings on Chiltern Street",
  "/images/news-yolk.jpg": "Customers outside YOLK’s London shopfront",
  "/images/hero-london.jpg": "The River Thames, Tower Bridge and the London skyline",
  "/images/gym.jpg": "Weights and people training in a gym",
};
const titleFor = (article: Article) => article.title;

function ProviderIcon({ provider }: { provider: SocialPost["provider"] }) {
  return (
    <svg className="nsb-provider-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      {provider === "Instagram"
        ? <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none" /></>
        : <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7.5 10v7m3.5 0v-7m0 3c0-4 6-4 6 0v4" /><circle cx="7.5" cy="7" r=".8" fill="currentColor" stroke="none" /></>}
    </svg>
  );
}

function ArticleImage({ article }: { article: Article }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`nsb-article-image${!article.image || failed ? " nsb-article-image--empty" : ""}`}>
      {article.image && !failed
        ? <img src={article.image} alt={IMAGE_ALTS[article.image] ?? article.title} loading="lazy" onError={() => setFailed(true)} />
        : <span className="nsb-image-wordmark" aria-hidden="true">BGP<span>News</span></span>}
    </div>
  );
}

function SocialCard({ post }: { post: SocialPost }) {
  return (
    <article className="nsb-social-card">
      <a className="nsb-social-link" href={post.url} target="_blank" rel="noopener noreferrer" aria-label={`${post.title} View ${post.account} on ${post.provider} (opens in a new tab)`}>
        <div className="nsb-social-image">
          <img src={post.image} alt={post.imageAlt} width={post.imageWidth} height={post.imageHeight} style={{ objectPosition: post.imagePosition }} loading="lazy" />
          <span className="nsb-social-badge"><ProviderIcon provider={post.provider} />{post.provider}</span>
        </div>
        <div className="nsb-social-copy">
          <div><p className="nsb-meta">{post.account} on {post.provider}</p><h3>{post.title}</h3></div>

        </div>
      </a>
    </article>
  );
}

function FeaturedCarousel({ articles }: { articles: Article[] }) {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const index = selected % articles.length;
  const article = articles[index];
  const move = (step: number) => setSelected((current) => (current + step + articles.length) % articles.length);

  return (
    <div className="nsb-feature" role="region" aria-roledescription="carousel" aria-label="Featured journal stories"
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          move(event.key === "ArrowRight" ? 1 : -1);
        }
      }}>
      <article id={id} className="nsb-feature-story" aria-roledescription="slide" aria-label={`${index + 1} of ${articles.length}`}>
        <Link href={`/news/${article.slug}`} className="nsb-feature-link">
          <ArticleImage key={article.image ?? article.slug} article={article} />
          <div className="nsb-feature-copy">
            <p className="nsb-meta"><span>{article.category}</span>{article.date && <span>{article.date}</span>}</p>
            <h3>{titleFor(article)}</h3>
            {article.standfirst && <p className="nsb-feature-description">{article.standfirst}</p>}
            <span className="nsb-text-link">Read the story</span>
          </div>
        </Link>
      </article>
      {articles.length > 1 && (
        <div className="nsb-carousel-controls">
          <span className="nsb-count" role="status" aria-live="polite" aria-atomic="true">
            <span className="nsb-sr-only">Story </span>{String(index + 1).padStart(2, "0")}<span aria-hidden="true"> / </span><span className="nsb-sr-only"> of </span>{String(articles.length).padStart(2, "0")}
          </span>
          <div className="nsb-carousel-dots" role="group" aria-label="Choose a featured story">
            {articles.map((item, itemIndex) => (
              <button key={item.slug} type="button" aria-label={`Show ${titleFor(item)}`} aria-pressed={index === itemIndex} aria-controls={id} onClick={() => setSelected(itemIndex)}><span /></button>
            ))}
          </div>
          <div className="nsb-carousel-arrows">
            <button type="button" aria-label="Previous story" aria-controls={id} onClick={() => move(-1)}>Previous</button>
            <button type="button" aria-label="Next story" aria-controls={id} onClick={() => move(1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ArticleCard({ article }: { article: Article }) {
  return (
    <article className="nsb-journal-card">
      <Link href={`/news/${article.slug}`} className="nsb-journal-link">
        <ArticleImage key={article.image ?? article.slug} article={article} />
        <p className="nsb-meta"><span>{article.category}</span>{article.date && <span>{article.date}</span>}</p>
        <h3>{titleFor(article)}</h3>
        {article.author && <p className="nsb-author">By {article.author}</p>}
        <span className="nsb-text-link">Read the story</span>
      </Link>
    </article>
  );
}

export default function NewsSocialBoard({ compact = false }: { compact?: boolean }) {
  const { articles: siteArticles } = useSiteContent();
  const [filter, setFilter] = useState<Filter>("All");
  const id = useId();
  const Heading = compact ? "h2" : "h1";
  const articles = useMemo(() => siteArticles.filter((article) => !article.isSample), [siteArticles]);
  const featured = useMemo(() => {
    const preferred = FEATURED_SLUGS.flatMap((slug) => articles.filter((article) => article.slug === slug));
    return [...preferred, ...articles.filter((article) => !FEATURED_SLUGS.includes(article.slug))].slice(0, 4);
  }, [articles]);
  const filtered = articles.filter((article) => filter === "All" || (filter === "Opinion"
    ? article.category.toLowerCase() === "opinion"
    : filter === "News" && article.category.toLowerCase() !== "opinion"));
  const showBoard = compact || filter === "All";
  const showArchive = !compact && filter !== "Social";

  return (
    <section className={`news-social-board${compact ? " news-social-board--compact" : ""}`} aria-labelledby={`${id}-title`}>
      <div className="nsb-heading">
        <div><p className="nsb-eyebrow">BGP</p><Heading id={`${id}-title`}>News and insights</Heading></div>
        <div className="nsb-heading-aside">
          <p>The latest news, lettings, transactions and opinion from the BGP team across leasing, investment, brand representation and placemaking.</p>
          {compact && <Link href="/news" className="nsb-text-link">Find out more</Link>}
        </div>
      </div>

      {!compact && (
        <div className="nsb-filters" role="group" aria-label="Filter journal">
          {FILTERS.map((item) => <button key={item} type="button" aria-pressed={filter === item} aria-controls={`${id}-results`} onClick={() => setFilter(item)}>{item}</button>)}
        </div>
      )}

      <div id={`${id}-results`}>
        {!compact && <p className="nsb-sr-only" role="status">{filter === "Social" ? `${SOCIAL_POSTS.length} selected social posts` : `${filtered.length} ${filter === "All" ? "journal" : filter.toLowerCase()} stories${filter === "All" ? ` and ${SOCIAL_POSTS.length} selected social posts` : ""}`}</p>}
        {showBoard && (
          <div className={`nsb-mosaic${featured.length === 0 ? " nsb-mosaic--social-only" : ""}`}>
            {!compact && <h2 className="nsb-sr-only">Featured stories and selected social posts</h2>}
            {featured.length > 0 && <FeaturedCarousel key={featured.map((article) => article.slug).join(",")} articles={featured} />}
            <div className="nsb-social-column" aria-label="Selected BGP social posts">
              {SOCIAL_POSTS.map((post) => <SocialCard key={post.id} post={post} />)}
            </div>
          </div>
        )}
        {!compact && filter === "Social" && (
          <div className="nsb-social-grid" aria-label="Selected BGP social posts"><h2 className="nsb-sr-only">Selected social posts</h2>{SOCIAL_POSTS.map((post) => <SocialCard key={post.id} post={post} />)}</div>
        )}
        {showArchive && (
          <div className={`nsb-archive${filter !== "All" ? " nsb-archive--filtered" : ""}`}>
            {filter === "All" && <div className="nsb-archive-heading"><h2>News</h2><p>{articles.length} {articles.length === 1 ? "story" : "stories"}</p></div>}
            {filter !== "All" && <h2 className="nsb-sr-only">{filter} stories</h2>}
            {filtered.length > 0
              ? <div className="nsb-article-grid">{filtered.map((article) => <ArticleCard key={article.slug} article={article} />)}</div>
              : <p className="nsb-empty">There are no {filter.toLowerCase()} stories to show yet.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
