import { useEffect } from "react";
import { Link, useRoute } from "wouter";
import Placeholder from "../components/Placeholder";
import { ARTICLES } from "../lib/content";

export default function ArticlePage() {
  const [, params] = useRoute("/news/:slug");
  const article = ARTICLES.find((a) => a.slug === params?.slug);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [params?.slug]);

  if (!article) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-32 text-center">
        <p className="label-caps text-bgp-burgundy">Article not found</p>
        <p className="mt-4">
          <Link href="/news" className="explore-link inline-block">Back to news &amp; insights</Link>
        </p>
      </div>
    );
  }

  return (
    <article className="mx-auto max-w-3xl px-4 py-14">
      <p className="label-caps border-b border-bgp-ink pb-2 text-bgp-ink/50">News and insights</p>

      <div className="mt-8 flex flex-wrap gap-x-6 label-caps text-bgp-ink/50">
        <span>{article.date}</span>
        <span>By {article.author}</span>
        <span>{article.category}</span>
      </div>

      <h1 className="mt-4 text-3xl md:text-4xl leading-tight">{article.title}</h1>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-[1fr_220px] gap-8 items-start">
        <Placeholder className="aspect-[4/3] w-full" src={article.image} alt={article.title} />
        <p className="text-sm text-bgp-ink/70 leading-relaxed">{article.standfirst}</p>
      </div>

      <div className="mt-10 space-y-5">
        {article.body ? (
          article.body.map((para, i) =>
            para.startsWith("## ") ? (
              <h2 key={i} className="text-base font-semibold pt-4">
                {para.slice(3)}
              </h2>
            ) : (
              <p key={i} className="text-sm leading-relaxed text-bgp-ink/80">
                {para}
              </p>
            ),
          )
        ) : (
          <p className="text-sm text-bgp-ink/50 italic">[Sample] Full article copy to follow.</p>
        )}
      </div>

      <div className="mt-12 flex items-center justify-between border-t border-bgp-ink pt-4">
        <div className="flex items-center gap-4">
          <span className="label-caps">Share</span>
          <a
            href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`https://www.bgp.uk.com/news/${slug}`)}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Share on LinkedIn"
            className="hover:text-bgp-burgundy"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z"/></svg>
          </a>
        </div>
        <Link href="/news" className="label-caps hover:text-bgp-burgundy">
          Back to news &amp; insights
        </Link>
      </div>
    </article>
  );
}
