import { Link } from "wouter";
import Placeholder from "../components/Placeholder";
import ClientRow from "../components/ClientRow";
import { ARTICLES, HERO_STATEMENT, HOME_INTRO, LEASE_ADVISORY_CLIENTS, SERVICES, TESTIMONIAL } from "../lib/content";

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
  return (
    <div>
      {/* Hero — full-bleed photo, giant wordmark */}
      <section className="relative">
        <img
          src="/images/bar.jpg"
          alt="Bar interior"
          className="h-[70vh] min-h-[480px] w-full object-cover"
        />
        <div className="absolute inset-0 bg-bgp-wine/30" />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          <h1>
            <img
              src="/brand/bgp-logo-white.svg"
              alt="bgp"
              className="h-28 md:h-44 w-auto mx-auto drop-shadow-[0_4px_24px_rgba(0,0,0,0.55)]"
            />
          </h1>
          <p
            className="mt-6 max-w-2xl font-display italic text-white text-2xl md:text-3xl leading-snug"
            style={{ textShadow: "0 2px 18px rgba(0,0,0,0.6)" }}
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
        <h2 className="display text-3xl md:text-4xl italic font-normal">{HOME_INTRO.lead}</h2>
        {HOME_INTRO.body.map((para) => (
          <p key={para.slice(0, 24)} className="mt-5 text-sm font-light text-bgp-ink/75 leading-relaxed">
            {para}
          </p>
        ))}
      </section>

      {/* Trusted-by band — quiet blush ground, the estates we act for */}
      <section className="mt-14 bg-bgp-pink/40 border-y border-bgp-pink">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <p className="label-caps text-bgp-wine/70 text-center mb-8">Trusted by London's leading estates</p>
          <ClientRow clients={LEASE_ADVISORY_CLIENTS.slice(0, 6)} />
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 pt-14 pb-2 text-center">
        <p className="display text-xl md:text-2xl">{HOME_INTRO.servicesHeading}</p>
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
                  <h2 className="display text-3xl md:text-4xl">{service.name}</h2>
                  <p className="mt-4 text-sm font-light text-bgp-ink/75 leading-relaxed max-w-sm">
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
                      <span className="text-bgp-red font-display text-5xl font-light" aria-hidden>/</span>
                      <span className="label-caps text-bgp-wine max-w-[14ch]">{stat.caption}</span>
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* Testimonial — full-bleed wine band, big italic serif */}
      <section className="bg-bgp-wine text-bgp-cream">
        <div className="mx-auto max-w-4xl px-4 py-16 md:py-20 text-center">
          <span className="font-display text-6xl leading-none text-bgp-nectar" aria-hidden>“</span>
          <blockquote className="font-display italic text-2xl md:text-3xl leading-snug -mt-4">
            {TESTIMONIAL.quote}
          </blockquote>
          <p className="mt-6 label-caps text-bgp-cream/70">{TESTIMONIAL.name} — {TESTIMONIAL.title}</p>
        </div>
      </section>

      {/* News & insights */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="display text-3xl md:text-4xl">News and insights</h2>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          <p><Link href="/news" className="explore-link">Explore</Link></p>
          <p className="text-sm font-light text-bgp-ink/75 leading-relaxed">
            The latest news, lettings, transactions and opinion from the BGP team across
            leasing, investment, brand representation and placemaking.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-8">
          {["behind-the-brand-yolk", "ardent-royal-exchange", "enduring-appeal-portman-estate"].map((slug) => ARTICLES.find((x) => x.slug === slug)!).map((a) => (
            <Link key={a.slug} href={`/news/${a.slug}`} className="group block border-t border-bgp-wine/40 pt-3">
              <p className="label-caps text-bgp-wine mb-3">{a.category}</p>
              <div className="img-frame"><Placeholder className="aspect-[4/3] w-full" src={a.image} alt={a.title} /></div>
              <p className="mt-3 text-sm font-semibold leading-snug group-hover:text-bgp-red transition-colors">
                {a.title}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
