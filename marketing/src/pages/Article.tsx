import { Fragment, useEffect, useId, useState } from "react";
import { Link, useRoute } from "wouter";
import Placeholder from "../components/Placeholder";
import FittedHeading from "../components/FittedHeading";
import { useSiteContent } from "../lib/site-content";
import { isNewsPlaceholder, NEWS_PLACEHOLDERS, PLACEHOLDER_ARTICLE_BODY } from "../lib/news-placeholders";
import "./news-article.css";

function ArticleGallery({ image, title, placeholder }: { image?: string; title: string; placeholder: boolean }) {
  const [selected, setSelected] = useState(0);
  const id = useId();
  // The supplied lead photograph stays first. Additional photographs are
  // explicitly labelled stand-ins until article-specific images arrive.
  const photos = [
    { src: placeholder ? undefined : image, stock: placeholder ? image : undefined, alt: placeholder ? "Placeholder article photograph" : title },
    { src: undefined, stock: "/images/shop-browse.jpg", alt: "Placeholder article photograph — final image to follow" },
    { src: undefined, stock: "/images/restaurant.jpg", alt: "Placeholder article photograph — final image to follow" },
  ];
  const photo = photos[selected];
  return (
    <div role="region" aria-roledescription="carousel" aria-label="Article photographs" className="relative min-w-0">
      <div id={id} className="[&>div>span]:bottom-auto [&>div>span]:top-2">
        <Placeholder className="aspect-[4/3] w-full" src={photo.src} stock={photo.stock} alt={photo.alt} label="Photo to follow" />
      </div>
      <button type="button" aria-label="Previous article photograph" aria-controls={id} onClick={() => setSelected((current) => (current + photos.length - 1) % photos.length)} className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center bg-bgp-cream/85 text-3xl text-bgp-wine hover:bg-bgp-cream">‹</button>
      <button type="button" aria-label="Next article photograph" aria-controls={id} onClick={() => setSelected((current) => (current + 1) % photos.length)} className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center bg-bgp-cream/85 text-3xl text-bgp-wine hover:bg-bgp-cream">›</button>
      <div className="absolute inset-x-0 bottom-1 flex justify-center">
        {photos.map((_, index) => (
          <button key={index} type="button" aria-label={`Show article photograph ${index + 1}`} aria-controls={id} aria-pressed={selected === index} onClick={() => setSelected(index)} className="flex h-11 w-11 items-center justify-center">
            <span className={`h-2.5 w-2.5 rounded-full border border-bgp-cream ${selected === index ? "bg-bgp-cream" : "bg-bgp-wine/35"}`} />
          </button>
        ))}
      </div>
      <span className="sr-only" role="status">Photograph {selected + 1} of {photos.length}</span>
    </div>
  );
}

function ArticleShare({ slug, title }: { slug: string; title: string }) {
  const [message, setMessage] = useState("");
  const [manualCopy, setManualCopy] = useState(false);
  const url = `https://www.bgp.uk.com/news/${slug}`;
  const shareOrCopy = async () => {
    setMessage("");
    setManualCopy(false);
    if (navigator.share) {
      try { await navigator.share({ title, url }); return; }
      catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Link copied");
    } catch {
      setManualCopy(true);
      setMessage("Select and copy the article link below.");
    }
  };

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="label-caps">Share</span>
        <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer" aria-label="Share on LinkedIn" title="Share on LinkedIn" className="flex h-11 w-11 items-center justify-center text-bgp-wine hover:opacity-70">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" /></svg>
        </a>
        <button type="button" onClick={shareOrCopy} aria-label="Share article or copy link" title="Share article or copy link" className="flex h-11 w-11 items-center justify-center text-bgp-wine hover:opacity-70">
          <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 15V3m-4 4 4-4 4 4M7 11H4v10h16V11h-3" /></svg>
        </button>
        <span role="status" className="text-sm text-bgp-wine">{message}</span>
      </div>
      {manualCopy && <label className="mt-2 block text-sm">Article link<input readOnly value={url} onFocus={(event) => event.currentTarget.select()} className="mt-1 block w-full border border-bgp-wine/30 bg-bgp-cream p-2 text-base" /></label>}
    </div>
  );
}

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
  const insetIndex = bodyParagraphs.join(" ").length > 1600
    ? bodyParagraphs.findIndex((paragraph, index) => index >= Math.floor(bodyParagraphs.length / 2) && !paragraph.startsWith("## "))
    : -1;

  return (
    <article className="article-page site-container section-space">
      <p className="article-section-label mb-8 border-b border-bgp-ink pb-4 font-bold"><Link href="/news">News and insights</Link></p>
      <div className="bg-bgp-mist p-5 md:p-10 lg:p-12">
        <div className="article-meta label-caps flex flex-wrap justify-between gap-x-6 gap-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-3"><span>{article.date}</span><span>{article.author ? `By ${article.author}` : "Author to follow"}</span></div>
          <span>{article.category}</span>
        </div>
        <div className="mt-7 grid grid-cols-1 items-start gap-8 md:grid-cols-[3fr_2fr] md:gap-10">
          <ArticleGallery key={article.slug} image={article.image} title={article.title} placeholder={placeholder} />
          <div className="min-w-0">
            <FittedHeading as="h1" className="article-title section-title">{article.title}</FittedHeading>
            {article.standfirst && <p className="article-standfirst body-copy mt-6">{article.standfirst}</p>}
          </div>
        </div>

        <div className="article-body mx-auto mt-10 flow-root w-full md:mt-14 md:w-[84%]">
          {(placeholder || missingBody) && <p className="label-caps border-y border-bgp-wine/25 py-3 text-bgp-wine">Placeholder article copy · final text to follow</p>}
          {bodyParagraphs.map((paragraph, index) => (
            <Fragment key={index}>
              {index === insetIndex && (
                <figure className="w-full md:float-right md:mb-6 md:ml-8 md:w-[60%]">
                  <Placeholder className="aspect-[4/3] w-full" stock="/images/cafe.jpg" alt="Illustrative stock photograph — final article image to follow" label="Article image to follow" />
                  <figcaption className="sr-only">Placeholder article photography; the final image will be supplied.</figcaption>
                </figure>
              )}
              {paragraph.startsWith("## ")
                ? <h2 className="clear-both font-light leading-[1.2]">{paragraph.slice(3)}</h2>
                : <p className="body-copy text-bgp-ink">{paragraph}</p>}
            </Fragment>
          ))}
        </div>

        <div className="article-sharing mx-auto mt-12 flex w-full flex-wrap items-center justify-between gap-6 border-t border-bgp-ink pt-5 md:w-[84%]">
          <ArticleShare key={article.slug} slug={article.slug} title={article.title} />
          <Link href="/news" className="explore-link">Back to news &amp; insights</Link>
        </div>
      </div>
    </article>
  );
}
