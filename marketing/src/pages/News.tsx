import { useMemo, useState } from "react";
import { Link } from "wouter";
import Placeholder from "../components/Placeholder";
import { SectionHead } from "../components/Wire";
import { useSiteContent } from "../lib/site-content";
import { isNewsPlaceholder, withNewsPlaceholders } from "../lib/news-placeholders";
import "./news-article.css";

const INITIAL_VISIBLE = 6;

export default function News() {
  const [kind, setKind] = useState<"" | "News" | "Opinion">("");
  const [category, setCategory] = useState("");
  const [expanded, setExpanded] = useState(false);
  const { articles } = useSiteContent();
  const types = useMemo(() => Array.from(new Set(articles.map((article) => article.category).filter((type) => type !== "News" && type !== "Opinion"))), [articles]);
  const filtered = articles.filter((article) => (!kind || article.category === kind) && (!category || article.category === category));
  const displayed = !kind && !category ? withNewsPlaceholders(filtered) : filtered;
  const features = displayed.slice(0, 3);
  const rest = displayed.slice(3);
  const visibleRest = expanded ? rest : rest.slice(0, INITIAL_VISIBLE);
  const archiveRows = Array.from({ length: Math.ceil(visibleRest.length / 3) }, (_, index) => visibleRest.slice(index * 3, index * 3 + 3));

  const toggleKind = (next: "News" | "Opinion") => {
    setKind((current) => current === next ? "" : next);
    setCategory("");
    setExpanded(false);
  };

  return (
    <div className="news-page site-container section-space">
      <SectionHead as="h1" title="News and insights" />
      <div className="news-filters flex flex-wrap items-center gap-x-8 gap-y-2 border-b border-bgp-ink py-3">
        <span className="label-caps">Filter by</span>
        {(["News", "Opinion"] as const).map((type) => (
          <button key={type} type="button" onClick={() => toggleKind(type)} aria-pressed={kind === type} className={`label-caps min-h-11 hover:text-bgp-wine ${kind === type ? "text-bgp-wine underline underline-offset-4" : "text-bgp-ink"}`}>
            {type} {kind === type ? "−" : "+"}
          </button>
        ))}
        <label className="label-caps flex min-h-11 items-center gap-2">
          <span>Type +</span>
          <select value={category} onChange={(event) => { setCategory(event.target.value); setKind(""); setExpanded(false); }} className="min-h-11 max-w-[200px] cursor-pointer bg-transparent py-2 text-bgp-ink">
            <option value="">All</option>
            {types.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-8 space-y-6 md:mt-12">
        {features.map((article, index) => (
          <Link key={article.slug} href={`/news/${article.slug}`} className="group block bg-bgp-mist p-5 md:p-8">
            <div className="news-meta label-caps mb-5 flex flex-wrap justify-between gap-3">
              <span>{index % 2 ? article.category : article.date}</span>
              <span>{index % 2 ? article.date : article.category}</span>
            </div>
            <div className={`grid grid-cols-1 gap-7 md:gap-10 ${index % 2 ? "md:grid-cols-[2fr_3fr]" : "md:grid-cols-[3fr_2fr]"}`}>
              <div className={`img-frame ${index % 2 ? "md:order-2" : ""}`}><Placeholder className="aspect-[4/3] w-full" src={isNewsPlaceholder(article) ? undefined : article.image} stock={isNewsPlaceholder(article) ? article.image : undefined} alt={isNewsPlaceholder(article) ? "Illustrative stock photograph for an article placeholder" : article.title} label="Photo to follow" /></div>
              <div className="flex min-w-0 flex-col items-start">
                <h2 className="news-feature-title section-title group-hover:opacity-75">{article.title}</h2>
                {article.standfirst && <p className="news-feature-copy body-copy mt-6">{article.standfirst}</p>}
                <span className="news-read-more explore-link mt-auto pt-8">Read more</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {displayed.length === 0 && <p className="body-copy py-16">Nothing in that category yet.</p>}

      {visibleRest.length > 0 && (
        <div className="mt-6 space-y-6">
          {archiveRows.map((row) => (
            <div key={row[0].slug} className="grid grid-cols-1 gap-x-2 gap-y-8 bg-bgp-mist p-3 md:grid-cols-3 md:p-0">
              {row.map((article) => (
                <Link key={article.slug} href={`/news/${article.slug}`} className="group flex min-w-0 flex-col pb-3">
                  <div className="news-meta label-caps mb-2 flex flex-wrap justify-between gap-2 px-1 pt-2"><span>{article.category}</span><span>{article.date}</span></div>
                  <div className="img-frame"><Placeholder className="aspect-square w-full" src={isNewsPlaceholder(article) ? undefined : article.image} stock={isNewsPlaceholder(article) ? article.image : undefined} alt={isNewsPlaceholder(article) ? "Illustrative stock photograph for an article placeholder" : article.title} label="Photo to follow" /></div>
                  <h2 className="news-archive-title mt-3 px-1 font-display font-bold uppercase leading-none tracking-[-0.03em] text-bgp-wine group-hover:opacity-75">{article.title}</h2>
                  <span className="news-read-more explore-link mt-auto self-start px-1 pt-5">Read more</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}

      {!expanded && rest.length > INITIAL_VISIBLE && <button type="button" onClick={() => setExpanded(true)} className="news-read-more explore-link mt-10 min-h-11">+ More listings</button>}
    </div>
  );
}
