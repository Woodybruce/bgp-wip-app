import { useEffect, useState } from "react";
import { Link } from "wouter";
import Placeholder from "../components/Placeholder";
import { Band, SectionHead } from "../components/Wire";
import { HERO_SLIDES, HERO_STATEMENT, SERVICES } from "../lib/content";

import { useSiteContent } from "../lib/site-content";

// Home per wireframe slides 22–23: hero with the statement bottom-left,
// a row of stats, five service blocks on alternating bands with the image
// beside the copy, then News and insights on a band. All figures real:
// transactions/brands from brucegillinghampollard.com, £62m = LondonMetric
// Waitrose portfolio, 7m sq ft advised, 20+ years = Canary Wharf instruction.
const STATS: Array<{ value: string; caption: string }> = [
  { value: "244", caption: "Leasing transactions completed" },
  { value: "£62m", caption: "Largest single transaction" },
  { value: "66", caption: "Brands advised in the UK and abroad" },
  { value: "20+", caption: "Years advising Canary Wharf Group" },
];

export default function Home() {
  const { articles } = useSiteContent();
  const featured = ["behind-the-brand-yolk", "ardent-royal-exchange", "enduring-appeal-portman-estate"]
    .map((slug) => articles.find((x) => x.slug === slug))
    .filter((a): a is NonNullable<typeof a> => !!a);
  const homeArticles = featured.length === 3 ? featured : articles.slice(0, 3);
  const [slideIndex, setSlideIndex] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setSlideIndex((i) => (i + 1) % HERO_SLIDES.length), 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      {/* Hero: rotating flagship instructions, statement bottom-left */}
      <section data-hero className="relative flex items-end -mt-16 md:-mt-24 lg:-mt-28 h-[min(63vw,100vh)] min-h-[420px] overflow-hidden">
        {HERO_SLIDES.map((slide, i) => (
          <img
            key={slide.src}
            src={slide.src}
            alt={slide.alt}
            loading={i === 0 ? "eager" : "lazy"}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[1500ms] ease-in-out ${i === slideIndex ? "opacity-100" : "opacity-0"}`}
          />
        ))}
        <div className="absolute inset-0 bg-gradient-to-t from-bgp-ink/80 via-bgp-ink/25 to-bgp-ink/35" />
        <div className="relative mx-auto w-full max-w-[1360px] px-4 pb-10 md:pb-9 flex flex-wrap items-end justify-between gap-6">
          <h1 className="max-w-[62%] font-normal text-3xl md:text-4xl leading-[1.1] text-white" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>
            {HERO_STATEMENT}
          </h1>
          <p className="label-caps text-white/85" aria-live="polite">
            {HERO_SLIDES[slideIndex].place} <span className="text-bgp-nectar mx-1" aria-hidden>/</span> {HERO_SLIDES[slideIndex].capability}
          </p>
        </div>
      </section>

      {/* Slide 23: a slim dark Talk to us bar under the hero, then the stats. */}
      <a href="#contact" className="block bg-bgp-ink text-bgp-cream text-center label-caps py-2 hover:bg-bgp-wine transition-colors">Talk to us</a>

      {/* Stats row, on the grey band as slide 23 draws it */}
      <section className="bg-bgp-mist"><div className="mx-auto max-w-[1360px] px-4 py-7 md:py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-8 text-center">
          {STATS.map((s) => (
            <div key={s.caption}>
              <p className="display text-4xl md:text-7xl tabular">{s.value}</p>
              <p className="mt-2 text-xs text-bgp-ink/70 max-w-[18ch] mx-auto">{s.caption}</p>
            </div>
          ))}
        </div>
      </div></section>

      {/* Service overviews on alternating bands */}
      <div id="services">
        {SERVICES.map((service, i) => {
          const inner = (
            <>
              <h2 className="text-3xl font-bold text-bgp-ink mb-5">{service.name}</h2>
              <div className={`grid grid-cols-1 md:grid-cols-[57fr_3fr_37fr_3fr] gap-8 md:gap-0 items-start ${i % 2 ? "md:[direction:rtl]" : ""}`}>
                <div className="img-frame [direction:ltr]">
                  <Placeholder className="aspect-[1.57] w-full" src={service.image} alt={service.name} />
                </div>
                <div className="hidden md:block" />
                <div className="[direction:ltr]">
                  <p className="text-2xl leading-snug text-bgp-ink">{service.intro}</p>
                  <p className="mt-5"><Link href={`/${service.slug}`} className="explore-link">Find out more</Link></p>
                </div>
              </div>
            </>
          );
          return i % 2 ? (
            <Band key={service.slug}>{inner}</Band>
          ) : (
            <section key={service.slug} className="mx-auto max-w-[1360px] px-4 py-7 md:py-8">{inner}</section>
          );
        })}
      </div>

      {/* News & insights */}
      <Band>
        <SectionHead title="News and insights" />
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-8 md:gap-12 mb-10">
          <p className="text-base text-bgp-ink">
            The latest news, lettings, transactions and opinion from the BGP team across
            leasing, investment, brand representation and placemaking.
          </p>
          <p><Link href="/news" className="explore-link">Find out more</Link></p>
        </div>
        <div className="card-strip sm:grid-cols-3 sm:gap-8">
          {homeArticles.map((a) => (
            <Link key={a.slug} href={`/news/${a.slug}`} className="group block">
              <p className="label-caps text-bgp-ink/60 mb-3">{a.category}</p>
              <div className="img-frame"><Placeholder className="aspect-[4/3] w-full" src={a.image} alt={a.title} /></div>
              <p className="mt-3 text-sm font-bold group-hover:text-bgp-wine transition-colors">{a.title}</p>
            </Link>
          ))}
        </div>
      </Band>
    </div>
  );
}
