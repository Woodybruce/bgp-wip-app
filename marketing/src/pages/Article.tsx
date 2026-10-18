import { useEffect } from "react";
import { Link, useRoute } from "wouter";
import Placeholder from "../components/Placeholder";
import { useSiteContent } from "../lib/site-content";
import { isNewsPlaceholder, NEWS_PLACEHOLDERS, PLACEHOLDER_ARTICLE_BODY } from "../lib/news-placeholders";

export default function ArticlePage() {
  const [, params] = useRoute("/news/:slug");
  const { articles } = useSiteContent();
  const article = articles.find((item) => item.slug === params?.slug) ?? NEWS_PLACEHOLDERS.find((item) => item.slug === params?.slug);

  useEffect(() => { window.scrollTo(0, 0); }, [params?.slug]);

  if (!article) {
    return (
      <div className="site-container section-space">
        <h1 className="section-title">Article not found</h1>
        <Link href="/news" className="explore-link mt-8 inline-block">Back to news &amp; insights</Link>
      </div>
    );
  }

  const placeholder = isNewsPlaceholder(article);
  const suppliedBody = article.body ?? [];
  const distinctBody = suppliedBody[0]?.trim() === article.standfirst.trim() ? suppliedBody.slice(1) : suppliedBody;
  const missingBody = !distinctBody.some((paragraph) => paragraph.trim());
  const bodyParagraphs = missingBody ? PLACEHOLDER_ARTICLE_BODY : distinctBody;

  return (
    <article className="site-container section-space">
      <p className="mb-8 border-b border-bgp-ink pb-4 text-lg font-bold"><Link href="/news">News and insights</Link></p>
      <div className="bg-bgp-mist p-5 md:p-10 lg:p-12">
        <div className="label-caps flex flex-wrap justify-between gap-x-6 gap-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-3"><span>{article.date}</span><span>{article.author ? `By ${article.author}` : "Author to follow"}</span></div>
          <span>{article.category}</span>
        </div>
        <div className="mt-7 grid grid-cols-1 items-start gap-8 md:grid-cols-[3fr_2fr] md:gap-10">
          <Placeholder className="aspect-[4/3] w-full" src={placeholder ? undefined : article.image} stock={placeholder ? article.image : undefined} alt={placeholder ? "Illustrative stock photograph for an article placeholder" : article.title} label="Photo to follow" />
          <div className="min-w-0">
            <h1 className="section-title">{article.title}</h1>
            {article.standfirst && <p className="body-copy mt-6">{article.standfirst}</p>}
          </div>
        </div>

        <div className="mx-auto mt-10 max-w-[780px] space-y-6 md:mt-14">
          {(placeholder || missingBody) && <p className="label-caps border-y border-bgp-wine/25 py-3 text-bgp-wine">Placeholder article copy · final text to follow</p>}
          {bodyParagraphs.map((paragraph, index) => (
            paragraph.startsWith("## ")
              ? <h2 key={index} className="pt-4 text-xl font-light leading-[1.2]">{paragraph.slice(3)}</h2>
              : <p key={index} className="body-copy text-bgp-ink">{paragraph}</p>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-6 border-t border-bgp-ink pt-5">
          <a
            href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`https://www.bgp.uk.com/news/${article.slug}`)}`}
            target="_blank"
            rel="noreferrer"
            className="label-caps flex min-h-11 items-center gap-3 hover:text-bgp-wine"
          >
            <span>Share on LinkedIn</span>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" /></svg>
          </a>
          <Link href="/news" className="explore-link">Back to news &amp; insights</Link>
        </div>
      </div>
    </article>
  );
}
