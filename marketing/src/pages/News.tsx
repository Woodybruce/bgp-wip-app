import { useMemo, useState } from "react";
import { Link } from "wouter";
import Placeholder from "../components/Placeholder";
import { SectionHead } from "../components/Wire";
import { useSiteContent } from "../lib/site-content";

const INITIAL_VISIBLE = 6;

// Filters per wireframe p45: NEWS + / OPINION + toggles and a TYPE dropdown.
export default function News() {
  const [kind, setKind] = useState<"" | "News" | "Opinion">("");
  const [category, setCategory] = useState("");
  const [expanded, setExpanded] = useState(false);
  const { articles } = useSiteContent();

  const types = useMemo(
    () => Array.from(new Set(articles.map((a) => a.category).filter((c) => c !== "News" && c !== "Opinion"))),
    [articles],
  );

  const filtered = articles.filter((a) => {
    if (kind && a.category !== kind) return false;
    if (category && a.category !== category) return false;
    return true;
  });
  // Wireframe slide 45: the first three articles as alternating feature
  // blocks, the rest as a grid of grey cards.
  const features = filtered.slice(0, 3);
  const rest = filtered.slice(3);
  const visibleRest = expanded ? rest : rest.slice(0, INITIAL_VISIBLE);

  const toggleKind = (k: "News" | "Opinion") => {
    setKind((cur) => (cur === k ? "" : k));
    setCategory("");
  };

  return (
    <div className="mx-auto max-w-[1360px] px-4 py-12 md:py-14">
      <SectionHead as="h1" title="News and insights" />

      <div className="-mt-4 flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-bgp-wine/30 pb-3">
        <span className="label-caps text-bgp-ink/60">Filter by</span>
        <button
          onClick={() => toggleKind("News")}
          className={`label-caps transition-colors ${kind === "News" ? "text-bgp-wine" : "text-bgp-wine hover:opacity-70"}`}
        >
          News +
        </button>
        <button
          onClick={() => toggleKind("Opinion")}
          className={`label-caps transition-colors ${kind === "Opinion" ? "text-bgp-wine" : "text-bgp-wine hover:opacity-70"}`}
        >
          Opinion +
        </button>
        <label className="label-caps flex items-center gap-1.5 text-bgp-wine">
          <span>Type</span>
          <span className="text-bgp-wine" aria-hidden>+</span>
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setKind(""); }}
            className="bg-transparent label-caps text-bgp-wine outline-none cursor-pointer hover:text-bgp-wine"
          >
            <option value="">All</option>
            {types.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4">
        {features.map((a, i) => (
          <Link key={a.slug} href={`/news/${a.slug}`} className="group block bg-bgp-mist p-6 md:px-[4.7%] md:pt-10 md:pb-8">
            <div className="flex justify-between label-caps font-bold text-bgp-ink mb-5">
              <span>{i % 2 ? a.category : a.date}</span>
              <span>{i % 2 ? a.date : a.category}</span>
            </div>
            <div className={`grid grid-cols-1 md:grid-cols-[59fr_3fr_38fr] gap-8 md:gap-0 items-start ${i % 2 ? "md:[direction:rtl]" : ""}`}>
              <div className="img-frame [direction:ltr]"><Placeholder className="aspect-[1.36] w-full" src={a.image} alt={a.title} /></div>
              <div className="hidden md:block" />
              <div className="[direction:ltr] flex flex-col h-full">
                <h2 className="font-normal text-3xl md:text-4xl text-bgp-wine group-hover:opacity-80 transition-opacity">{a.title}</h2>
                <p className="mt-4 text-xl leading-snug text-bgp-ink">{a.standfirst}</p>
                <p className="mt-auto pt-6 label-caps text-bgp-ink/60 self-end">Read more</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-16 text-center text-base text-bgp-ink/70">Nothing in that category yet.</p>
      )}

      <div className="mt-4 card-strip sm:grid-cols-3 sm:gap-4">
        {visibleRest.map((a) => (
          <Link key={a.slug} href={`/news/${a.slug}`} className="group block bg-bgp-mist p-4 pb-5">
            <div className="flex justify-between label-caps text-bgp-ink/60 mb-3">
              <span>{a.category}</span>
              <span>{a.date}</span>
            </div>
            <div className="img-frame"><Placeholder className="aspect-square w-full" src={a.image} alt={a.title} /></div>
            <h3 className="mt-4 font-normal text-3xl leading-tight text-bgp-wine group-hover:opacity-80 transition-opacity">{a.title}</h3>
            <p className="mt-2 label-caps text-bgp-ink/50">Read more</p>
          </Link>
        ))}
        {/* Slide 45 draws six small cards; draft cards in italics make up the number. */}
        {!expanded && Array.from({ length: Math.max(0, INITIAL_VISIBLE - visibleRest.length) }, (_, i) => (
          <div key={i} className="block bg-bgp-mist p-4 pb-5 italic text-bgp-stone">
            <div className="flex justify-between label-caps text-bgp-stone mb-3"><span>Category</span><span>Date</span></div>
            <Placeholder className="aspect-square w-full" alt={`Draft article ${i + 1}`} />
            <h3 className="mt-4 font-normal text-3xl leading-tight">Article heading goes here</h3>
            <p className="mt-2 label-caps text-bgp-stone">Read more</p>
          </div>
        ))}
      </div>

      {!expanded && rest.length > INITIAL_VISIBLE && (
        <p className="mt-10 text-right">
          <button onClick={() => setExpanded(true)} className="label-caps text-bgp-wine hover:opacity-70">
            + More listings
          </button>
        </p>
      )}
    </div>
  );
}
