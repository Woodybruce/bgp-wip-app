import { useEffect } from "react";
import { Fragment } from "react";
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
      <div className="mx-auto max-w-[1360px] px-4 py-32 text-center">
        <p className="label-caps text-bgp-burgundy">Article not found</p>
        <p className="mt-4">
          <Link href="/news" className="explore-link inline-block">Back to news &amp; insights</Link>
        </p>
      </div>
    );
  }

  return (
    <article className="mx-auto max-w-[1360px] px-4 py-7 md:py-8">
      <h2 className="text-2xl font-bold text-bgp-ink border-b border-bgp-ink pb-2">News and insights</h2>

      <div className="mt-4 flex flex-wrap justify-between gap-x-6 label-caps text-bgp-ink/50 bg-bgp-mist px-4 py-2">
        <span>{article.date} <span className="mx-2 text-bgp-ink/30">·</span> By {article.author}</span>
        <span>{article.category}</span>
      </div>

      {/* Wireframe slide 46: a 54% photo beside the headline and standfirst, then the whole article at full width with a second photo set into it. */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-[56fr_4fr_40fr] gap-8 md:gap-0 items-start">
        <Placeholder className="aspect-[1.31] w-full" src={article.image} alt={article.title} />
        <div className="hidden md:block" />
        <div>
          <h1 className="font-light text-3xl md:text-4xl text-bgp-wine">{article.title}</h1>
          <p className="mt-4 text-xl leading-snug text-bgp-ink/75">{article.standfirst}</p>
        </div>
      </div>

      <div className="mt-8 space-y-5 md:ml-[8%] md:mr-[4%] [&>p]:text-base [&>p]:text-bgp-ink/85">
        {article.body ? (
          article.body.map((para, i) => (
            <Fragment key={i}>
              {i === Math.floor(article.body!.length * 0.55) && (
                <Placeholder className="aspect-[2.02] w-full md:float-right md:w-[56%] md:ml-10 md:mb-4" alt={`${article.title} second photo`} label="Photo to follow" />
              )}
              {para.startsWith("## ") ? <h2 className="text-lg font-bold pt-4">{para.slice(3)}</h2> : <p>{para}</p>}
            </Fragment>
          ))
        ) : (
          <p>{article.standfirst}</p>
        )}
        <div className="clear-both" />
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
