import { useMemo, useState } from "react";
import { Link } from "wouter";
import Placeholder from "../components/Placeholder";
import { ARTICLES } from "../lib/content";

export default function News() {
  const [category, setCategory] = useState("");
  const categories = useMemo(
    () => Array.from(new Set(ARTICLES.map((a) => a.category))),
    [],
  );
  const filtered = category ? ARTICLES.filter((a) => a.category === category) : ARTICLES;
  const [featured, ...rest] = filtered;

  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="text-lg font-semibold border-b border-bgp-ink pb-2">News and insights</h1>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-bgp-ink py-3">
        <span className="label-caps text-bgp-ink/50">Filter by</span>
        <label className="label-caps flex items-center gap-2">
          <span className="text-bgp-ink/50">Type</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="bg-transparent label-caps outline-none cursor-pointer hover:text-bgp-burgundy"
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      {featured && (
        <Link href={`/news/${featured.slug}`} className="group block bg-bgp-mist p-6 md:p-8 mt-8">
          <div className="flex justify-between label-caps text-bgp-ink/50 mb-4">
            <span>{featured.date}</span>
            <span>{featured.category}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <Placeholder className="aspect-[4/3] w-full" />
            <div>
              <h2 className="text-2xl md:text-3xl leading-tight group-hover:text-bgp-burgundy transition-colors">
                {featured.title}
              </h2>
              <p className="mt-4 text-sm text-bgp-ink/70 leading-relaxed max-w-sm">{featured.standfirst}</p>
              <p className="mt-4"><span className="rule-link inline-block">Read more</span></p>
            </div>
          </div>
        </Link>
      )}

      <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-6">
        {rest.map((a) => (
          <Link key={a.slug} href={`/news/${a.slug}`} className="group block bg-bgp-mist p-4">
            <div className="flex justify-between label-caps text-bgp-ink/50 mb-3">
              <span>{a.category}</span>
              <span>{a.date}</span>
            </div>
            <Placeholder className="aspect-[4/3] w-full" />
            <h3 className="mt-3 text-lg leading-snug group-hover:text-bgp-burgundy transition-colors">{a.title}</h3>
            <p className="mt-2 label-caps text-bgp-ink/50">Read more</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
