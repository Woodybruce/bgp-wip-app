import { useEffect, useState } from "react";
import { Link } from "wouter";
import Placeholder from "../components/Placeholder";
import { Band, SectionHead } from "../components/Wire";
import { HERO_SLIDES, HERO_STATEMENT, SERVICES } from "../lib/content";
import { useSiteContent } from "../lib/site-content";

const STATS = [
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
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyPreference = () => { if (preference.matches) setPaused(true); };
    applyPreference();
    preference.addEventListener("change", applyPreference);
    return () => preference.removeEventListener("change", applyPreference);
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setSlideIndex((i) => (i + 1) % HERO_SLIDES.length), 7000);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <div>
      <section data-hero className="site-hero" aria-label="BGP places and expertise">
        {HERO_SLIDES.map((slide, i) => (
          <img
            key={slide.src}
            src={slide.src}
            alt={i === slideIndex ? slide.alt : ""}
            aria-hidden={i !== slideIndex}
            loading={i === 0 ? "eager" : "lazy"}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${i === slideIndex ? "opacity-100" : "opacity-0"}`}
          />
        ))}
        <div className="hero-shade" />
        <div className="site-container hero-content">
          <h1 className="hero-statement">{HERO_STATEMENT}</h1>
          <div className="mt-7 flex items-center gap-1 text-bgp-cream md:absolute md:bottom-12 md:right-12 md:mt-0" aria-label="Hero photographs">
            {HERO_SLIDES.map((slide, i) => (
              <button
                key={slide.src}
                type="button"
                aria-label={`Show photograph ${i + 1}: ${slide.alt}`}
                aria-pressed={slideIndex === i}
                className="flex h-11 w-9 items-center justify-center"
                onClick={() => { setSlideIndex(i); setPaused(true); }}
              >
                <span className={`h-1.5 w-6 ${slideIndex === i ? "bg-bgp-nectar" : "bg-bgp-cream/50"}`} />
              </button>
            ))}
            <button type="button" aria-label={paused ? "Play slideshow" : "Pause slideshow"} onClick={() => setPaused(!paused)} className="ml-2 flex h-11 w-11 items-center justify-center border border-bgp-cream/40 text-sm">
              <span aria-hidden>{paused ? "▶" : "Ⅱ"}</span>
            </button>
          </div>
        </div>
      </section>

      <a href="#contact" className="label-caps flex min-h-11 items-center justify-center bg-bgp-wine text-bgp-cream transition-colors hover:bg-bgp-ink">Talk to us</a>

      <section className="bg-bgp-mist" aria-label="BGP in numbers">
        <div className="site-container grid grid-cols-2 gap-x-6 gap-y-10 py-12 text-center md:grid-cols-4 md:py-16">
          {STATS.map((s) => (
            <div key={s.caption}>
              <p className="font-sans font-light text-[clamp(3rem,5.7vw,5.125rem)] leading-none tabular text-bgp-wine">{s.value}</p>
              <p className="mx-auto mt-4 max-w-[20ch] text-base leading-[1.2] lg:text-lg">{s.caption}</p>
            </div>
          ))}
        </div>
      </section>

      <div id="services">
        {SERVICES.map((service, i) => (
          <section key={service.slug} className={i % 2 ? "bg-bgp-stone/[.08]" : ""}>
            <div className={`site-container home-service ${i % 2 ? "home-service--reverse" : ""} ${i === 1 || i === 2 || i === 4 ? "home-service--balanced" : ""}`}>
              <h2 className="section-title home-service__title">{service.name}</h2>
              <div className="img-frame home-service__image">
                <Placeholder className={`${i === 0 ? "aspect-[1.56]" : i === 1 ? "aspect-square" : "aspect-[8/7]"} w-full`} src={service.image} alt={service.name} />
              </div>
              <div className="home-service__copy">
                <p className="intro-copy max-w-[30ch]">{service.intro}</p>
                <Link href={`/${service.slug}`} className="explore-link mt-5">Find out more<span className="sr-only"> about {service.name}</span></Link>
              </div>
            </div>
          </section>
        ))}
      </div>

      <Link href="/news" aria-label="Explore news and insights" className="group block">
      <Band>
        <SectionHead title="News and insights" />
        <div className="mb-10 flex flex-col items-start gap-4">
          <p className="body-copy max-w-[52ch]">The latest news, lettings, transactions and opinion from the BGP team across leasing, investment, brand representation and placemaking.</p>
          <span className="explore-link">Find out more</span>
        </div>
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-3 sm:gap-8">
          {homeArticles.map((a) => (
            <div key={a.slug}>
              <p className="label-caps text-bgp-wine mb-3">{a.category}</p>
              <div className="img-frame"><Placeholder className="aspect-square w-full" src={a.image} alt={a.title} /></div>
              <h3 className="mt-5 font-sans font-medium text-xl leading-[1.2] text-bgp-wine group-hover:underline underline-offset-4">{a.title}</h3>
            </div>
          ))}
        </div>
      </Band>
      </Link>
    </div>
  );
}
