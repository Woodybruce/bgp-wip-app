import { useEffect, useState } from "react";
import { Link } from "wouter";
import Placeholder from "../components/Placeholder";
import { HERO_SLIDES, HERO_STATEMENT, HOME_INTRO, SERVICES, TESTIMONIAL } from "../lib/content";
import { useSiteContent } from "../lib/site-content";

// Per-section stats per the v2c layout. All figures real: transactions/brands
// from brucegillinghampollard.com, £62m = LondonMetric Waitrose portfolio,
// 7m sq ft advised, 20+ years = Canary Wharf instruction.
const SERVICE_STATS: Record<string, { value: string; caption: string }> = {
  leasing: { value: "244", caption: "Leasing transactions completed" },
  investment: { value: "£62m", caption: "Largest single transaction" },
  "brand-representation": { value: "66", caption: "Brands advised in the UK and abroad" },
  "lease-advisory": { value: "7m", caption: "Sq ft of assets currently advising on" },
  consultancy: { value: "20+", caption: "Years advising Canary Wharf Group" },
};

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
      {/* Hero — rotating flagship instructions, frame logo */}
      <section className="relative h-[70vh] min-h-[480px] overflow-hidden">
        {HERO_SLIDES.map((slide, i) => (
          <img
            key={slide.src}
            src={slide.src}
            alt={slide.alt}
            loading={i === 0 ? "eager" : "lazy"}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[1500ms] ease-in-out ${i === slideIndex ? "opacity-100" : "opacity-0"}`}
          />
        ))}
        <div className="absolute inset-0 bg-bgp-wine/30" />
        <p
          className="absolute bottom-5 left-4 md:left-8 label-caps text-white/90"
          style={{ textShadow: "0 1px 8px rgba(0,0,0,0.6)" }}
          aria-live="polite"
        >
          {HERO_SLIDES[slideIndex].place} <span className="text-bgp-nectar mx-1" aria-hidden>/</span> {HERO_SLIDES[slideIndex].capability}
        </p>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          <h1>
            <img
              src="/brand/bgp-frame-white.svg"
              alt="bgp"
              className="h-24 md:h-36 w-auto mx-auto drop-shadow-[0_4px_24px_rgba(0,0,0,0.55)]"
            />
          </h1>
          <p
            className="mt-6 max-w-2xl font-display font-bold uppercase tracking-[-0.03em] leading-none text-white text-3xl md:text-4xl"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,0.7), 0 4px 28px rgba(0,0,0,0.6)" }}
          >
            {HERO_STATEMENT}
          </p>
          <a href="#services" aria-label="Scroll to services" className="mt-10 text-white text-2xl animate-bounce">
            ↓
          </a>
        </div>
      </section>

      {/* We are bgp — intro copy from Rebrand_Copy */}
      <section className="mx-auto max-w-3xl px-4 pt-16 pb-4 text-center">
        <h2 className="display text-3xl md:text-4xl">{HOME_INTRO.lead}</h2>
        {HOME_INTRO.body.map((para) => (
          <p key={para.slice(0, 24)} className="mt-5 text-base md:text-lg text-bgp-ink/90">
            {para}
          </p>
        ))}
      </section>

      <section className="mx-auto max-w-3xl px-4 pt-16 pb-2 text-center">
        <span className="section-label">What we do</span>
        <p className="display text-2xl md:text-3xl">{HOME_INTRO.servicesHeading}</p>
      </section>

      {/* Service sections with stats */}
      <div id="services">
        {SERVICES.map((service, i) => {
          const stat = SERVICE_STATS[service.slug];
          const imageFirst = i % 2 === 0;
          return (
            <section key={service.slug} className="mx-auto max-w-6xl px-4 py-14">
              <div className={`grid grid-cols-1 md:grid-cols-2 gap-10 items-start ${imageFirst ? "" : "md:[direction:rtl]"}`}>
                <div className="img-frame [direction:ltr]">
                  <Placeholder
                    className="aspect-[4/3] w-full"
                    src={service.image}
                    alt={service.name}
                  />
                </div>
                <div className="[direction:ltr] md:border-l md:border-bgp-wine/25 md:pl-8">
                  <span className="label-caps text-bgp-stone tabular">{String(i + 1).padStart(2, "0")}</span>
                  <h2 className="display text-3xl md:text-4xl mt-1.5">{service.name}</h2>
                  <p className="mt-4 text-base md:text-lg text-bgp-ink/90 max-w-sm">
                    {service.intro}
                  </p>
                  <p className="mt-5">
                    <Link href={`/${service.slug}`} className="explore-link">
                      Explore
                    </Link>
                  </p>
                  {stat && (
                    <div className="mt-10 flex items-center gap-4">
                      <span className="display text-6xl md:text-7xl tabular">{stat.value}</span>
                      <span className="text-bgp-stone font-display text-5xl" aria-hidden>/</span>
                      <span className="label-caps text-bgp-wine max-w-[14ch]">{stat.caption}</span>
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* Testimonial — full-bleed Bordeaux band */}
      <section className="bg-bgp-wine text-bgp-cream">
        <div className="mx-auto max-w-4xl px-4 py-16 md:py-20 text-center">
          <span className="font-display text-6xl leading-none text-bgp-nectar" aria-hidden>“</span>
          <blockquote className="font-light text-2xl md:text-3xl -mt-4">
            {TESTIMONIAL.quote}
          </blockquote>
          <p className="mt-6 label-caps text-bgp-cream/70">{TESTIMONIAL.name}, {TESTIMONIAL.title}</p>
        </div>
      </section>

      {/* News & insights */}
      <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <span className="section-label">Journal</span>
        <h2 className="display text-3xl md:text-4xl">News and insights</h2>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          <p><Link href="/news" className="explore-link">Explore</Link></p>
          <p className="text-base md:text-lg text-bgp-ink/90">
            The latest news, lettings, transactions and opinion from the BGP team across
            leasing, investment, brand representation and placemaking.
          </p>
        </div>
        <div className="mt-10 card-strip sm:grid-cols-3 sm:gap-8">
          {homeArticles.map((a) => (
            <Link key={a.slug} href={`/news/${a.slug}`} className="group block border-t border-bgp-wine/40 pt-3">
              <p className="label-caps text-bgp-wine mb-3">{a.category}</p>
              <div className="img-frame"><Placeholder className="aspect-[4/3] w-full" src={a.image} alt={a.title} /></div>
              <p className="mt-3 text-sm font-semibold group-hover:text-bgp-wine transition-colors">
                {a.title}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
