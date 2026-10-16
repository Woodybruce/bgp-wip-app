import { useEffect, useState } from "react";
import { Link } from "wouter";
import Placeholder from "../components/Placeholder";
import { Band, SectionHead } from "../components/Wire";
import { CONSULTANCY_BODY, HERO_SLIDES, HERO_STATEMENT, HOME_INTRO, LEASE_ADVISORY_BODY, LEASING_INTRO, SERVICES, SERVICE_COPY, TESTIMONIAL } from "../lib/content";

// Slide 23 gives each service overview about five lines, so each block
// carries its intro plus one paragraph from its own page.
const SECOND_PARAGRAPH: Record<string, string> = {
  leasing: LEASING_INTRO.body[0],
  investment: SERVICE_COPY.investment.body[0],
  "brand-representation": SERVICE_COPY.brandRepresentation.body[0],
  "lease-advisory": LEASE_ADVISORY_BODY[1],
  consultancy: CONSULTANCY_BODY[1],
};
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
      <section className="relative flex items-end h-[70vh] min-h-[480px] overflow-hidden">
        {HERO_SLIDES.map((slide, i) => (
          <img
            key={slide.src}
            src={slide.src}
            alt={slide.alt}
            loading={i === 0 ? "eager" : "lazy"}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[1500ms] ease-in-out ${i === slideIndex ? "opacity-100" : "opacity-0"}`}
          />
        ))}
        <div className="absolute inset-0 bg-gradient-to-t from-bgp-ink/80 via-bgp-ink/25 to-bgp-ink/5" />
        <div className="relative mx-auto w-full max-w-6xl px-4 pb-10 md:pb-14 flex flex-wrap items-end justify-between gap-6">
          <h1 className="max-w-2xl font-light text-3xl md:text-5xl leading-[1.1] text-white" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>
            {HERO_STATEMENT}
          </h1>
          <p className="label-caps text-white/85" aria-live="polite">
            {HERO_SLIDES[slideIndex].place} <span className="text-bgp-nectar mx-1" aria-hidden>/</span> {HERO_SLIDES[slideIndex].capability}
          </p>
        </div>
      </section>

      {/* Stats row */}
      <section className="mx-auto max-w-6xl px-4 py-10 md:py-12 border-b border-bgp-line">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-8 text-center">
          {STATS.map((s) => (
            <div key={s.caption}>
              <p className="display text-4xl md:text-5xl tabular">{s.value}</p>
              <p className="mt-2 text-xs text-bgp-ink/70 max-w-[18ch] mx-auto">{s.caption}</p>
            </div>
          ))}
        </div>
      </section>

      {/* We are bgp */}
      <section className="mx-auto max-w-6xl px-4 py-14 md:py-16">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-8 md:gap-12">
          <h2 className="display text-3xl md:text-4xl">{HOME_INTRO.lead}</h2>
          <div className="space-y-4">
            {HOME_INTRO.body.map((para) => (
              <p key={para.slice(0, 24)} className="text-base md:text-lg text-bgp-ink/90">{para}</p>
            ))}
            <p className="font-light text-lg md:text-xl text-bgp-wine pt-2">{HOME_INTRO.servicesHeading}</p>
          </div>
        </div>
      </section>

      {/* Service overviews on alternating bands */}
      <div id="services">
        {SERVICES.map((service, i) => {
          const inner = (
            <>
              <SectionHead title={service.name} rule={false} />
              <div className={`grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-8 md:gap-12 items-start ${i % 2 ? "md:[direction:rtl]" : ""}`}>
                <div className="img-frame [direction:ltr]">
                  <Placeholder className="aspect-[4/3] w-full" src={service.image} alt={service.name} />
                </div>
                <div className="[direction:ltr]">
                  <p className="text-base md:text-lg text-bgp-ink/90">{service.intro}</p>
                  {SECOND_PARAGRAPH[service.slug] && <p className="mt-3 text-base md:text-lg text-bgp-ink/90">{SECOND_PARAGRAPH[service.slug]}</p>}
                  <p className="mt-5"><Link href={`/${service.slug}`} className="explore-link">Find out more</Link></p>
                </div>
              </div>
            </>
          );
          return i % 2 ? (
            <Band key={service.slug}>{inner}</Band>
          ) : (
            <section key={service.slug} className="mx-auto max-w-6xl px-4 py-12 md:py-14">{inner}</section>
          );
        })}
      </div>

      {/* Testimonial */}
      <section className="mx-auto max-w-6xl px-4 py-12 md:py-14">
        <div className="max-w-3xl border-l-2 border-bgp-wine pl-6">
          <blockquote className="font-light text-xl md:text-2xl text-bgp-ink/85">“{TESTIMONIAL.quote}”</blockquote>
          <p className="mt-4 label-caps">{TESTIMONIAL.name}</p>
          <p className="text-xs text-bgp-ink/55 uppercase">{TESTIMONIAL.title}</p>
        </div>
      </section>

      {/* News & insights */}
      <Band>
        <SectionHead title="News and insights" />
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-8 md:gap-12 mb-10">
          <p className="text-base text-bgp-ink/90">
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
