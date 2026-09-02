import { useMemo, useState } from "react";
import { Link } from "wouter";
import Placeholder from "../components/Placeholder";
import { ARTICLES } from "../lib/content";

const INITIAL_VISIBLE = 6;

// Filters per wireframe p45: NEWS + / OPINION + toggles and a TYPE dropdown.
export default function News() {
  const [kind, setKind] = useState<"" | "News" | "Opinion">("");
  const [category, setCategory] = useState("");
  const [expanded, setExpanded] = useState(false);

  const types = useMemo(
    () => Array.from(new Set(ARTICLES.map((a) => a.category).filter((c) => c !== "News" && c !== "Opinion"))),
    [],
  );

  const filtered = ARTICLES.filter((a) => {
    if (kind && a.category !== kind) return false;
    if (category && a.category !== category) return false;
    return true;
  });
  const [featured, ...rest] = filtered;
  const visibleRest = expanded ? rest : rest.slice(0, INITIAL_VISIBLE);

  const toggleKind = (k: "News" | "Opinion") => {
    setKind((cur) => (cur === k ? "" : k));
    setCategory("");
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="display text-3xl md:text-4xl">News and insights</h1>

      <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 border-y border-bgp-wine/30 py-3">
        <span className="label-caps text-bgp-ink/60">Filter by</span>
        <button
          onClick={() => toggleKind("News")}
          className={`label-caps transition-colors ${kind === "News" ? "text-bgp-red" : "text-bgp-wine hover:text-bgp-red"}`}
        >
          News +
        </button>
        <button
          onClick={() => toggleKind("Opinion")}
          className={`label-caps transition-colors ${kind === "Opinion" ? "text-bgp-red" : "text-bgp-wine hover:text-bgp-red"}`}
        >
          Opinion +
        </button>
        <label className="label-caps flex items-center gap-1.5 text-bgp-wine">
          <span>Type</span>
          <span className="text-bgp-red" aria-hidden>+</span>
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setKind(""); }}
            className="bg-transparent label-caps text-bgp-wine outline-none cursor-pointer hover:text-bgp-red"
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

      {featured && (
        <Link href={`/news/${featured.slug}`} className="group block bg-bgp-grey p-6 md:p-8 mt-8">
          <div className="flex justify-between label-caps text-bgp-ink/50 mb-4">
            <span>{featured.date}</span>
            <span>{featured.category}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="img-frame"><Placeholder className="aspect-[4/3] w-full" src={featured.image} alt={featured.title} /></div>
            <div>
              <h2 className="display text-2xl md:text-3xl leading-tight group-hover:text-bgp-red transition-colors">
                {featured.title}
              </h2>
              <p className="mt-4 text-sm font-light text-bgp-ink/70 leading-relaxed max-w-sm">{featured.standfirst}</p>
              <p className="mt-4"><span className="explore-link inline-block">Read more</span></p>
            </div>
          </div>
        </Link>
      )}

      {filtered.length === 0 && (
        <p className="py-16 text-center text-sm font-light text-bgp-ink/60">Nothing in that category yet.</p>
      )}

      <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-8">
        {visibleRest.map((a) => (
          <Link key={a.slug} href={`/news/${a.slug}`} className="group block border-t border-bgp-wine/40 pt-3">
            <div className="flex justify-between label-caps text-bgp-wine mb-3">
              <span>{a.category}</span>
              <span className="text-bgp-ink/50">{a.date}</span>
            </div>
            <div className="img-frame"><Placeholder className="aspect-[4/3] w-full" src={a.image} alt={a.title} /></div>
            <h3 className="mt-3 text-base font-semibold leading-snug group-hover:text-bgp-red transition-colors">{a.title}</h3>
            <p className="mt-2 label-caps text-bgp-ink/50">Read more</p>
          </Link>
        ))}
      </div>

      {!expanded && rest.length > INITIAL_VISIBLE && (
        <p className="mt-10 text-right">
          <button onClick={() => setExpanded(true)} className="label-caps text-bgp-wine hover:text-bgp-red">
            + More listings
          </button>
        </p>
      )}
    </div>
  );
}
