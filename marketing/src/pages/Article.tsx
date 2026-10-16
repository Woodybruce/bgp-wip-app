import { useEffect } from "react";
import { Link, useRoute } from "wouter";
import Placeholder from "../components/Placeholder";
import { useSiteContent } from "../lib/site-content";

export default function ArticlePage() {
  const [, params] = useRoute("/news/:slug");
  const { articles } = useSiteContent();
  const article = articles.find((a) => a.slug === params?.slug);

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
    <article className="mx-auto max-w-4xl px-4 py-14">
      <h2 className="text-sm font-bold text-bgp-ink border-b border-bgp-ink pb-2">News and insights</h2>

      <div className="mt-4 flex flex-wrap justify-between gap-x-6 label-caps text-bgp-ink/50 bg-bgp-mist px-4 py-2">
        <span>{article.date} <span className="mx-2 text-bgp-ink/30">·</span> By {article.author}</span>
        <span>{article.category}</span>
      </div>

      {/* Wireframe slide 46: image at left, headline and standfirst beside it */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-[1.3fr_1fr] gap-8 items-start">
        <Placeholder className="aspect-[4/3] w-full" src={article.image} alt={article.title} />
        <div>
          <h1 className="font-light text-2xl md:text-3xl text-bgp-wine">{article.title}</h1>
          <p className="mt-4 text-sm text-bgp-ink/75">{article.standfirst}</p>
        </div>
      </div>

      <div className="mt-10 space-y-5 max-w-3xl">
        {article.body ? (
          article.body.map((para, i) =>
            para.startsWith("## ") ? (
              <h2 key={i} className="text-base font-semibold pt-4">
                {para.slice(3)}
              </h2>
            ) : (
              <p key={i} className="text-base text-bgp-ink/85">
                {para}
              </p>
            ),
          )
        ) : (
          <p className="text-base text-bgp-ink/85">{article.standfirst}</p>
        )}
      </div>

      <div className="mt-12 flex items-center justify-between border-t border-bgp-ink pt-4">
        <div className="flex items-center gap-4">
          <span className="label-caps">Share</span>
          <a
            href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`https://www.bgp.uk.com/news/${article.slug}`)}`}
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
