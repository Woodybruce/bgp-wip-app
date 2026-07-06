import { Link } from "wouter";
import Placeholder from "../components/Placeholder";
import { ARTICLES, HERO_STATEMENT, SERVICES, STATS } from "../lib/content";

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative bg-bgp-burgundy text-bgp-paper">
        <img
          src="/images/hero-london.jpg"
          alt="Aerial view of London and the Thames"
          className="absolute inset-0 h-full w-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bgp-burgundy via-bgp-burgundy/60 to-bgp-burgundy/30" />
        <div className="relative mx-auto max-w-6xl px-4 py-28 md:py-40">
          <img src="/brand/bgp-logo-blush.svg" alt="" aria-hidden className="h-16 w-auto mb-10 opacity-90" />
          <p className="max-w-xl text-2xl md:text-3xl leading-snug">{HERO_STATEMENT}</p>
        </div>
        <a
          href="#contact"
          className="relative block bg-bgp-ink text-center label-caps text-bgp-paper py-3 hover:bg-black transition-colors"
        >
          Talk to us
        </a>
      </section>

      {/* Stats */}
      <section className="border-b border-bgp-line">
        <div className="mx-auto max-w-6xl px-4 py-14 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {STATS.map((s) => (
            <div key={s.caption}>
              <p className="text-4xl md:text-5xl tabular">{s.value}</p>
              <p className="mt-2 text-xs text-bgp-ink/60 max-w-[16ch] mx-auto">{s.caption}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Service overviews */}
      {SERVICES.map((service, i) => (
        <section key={service.slug} className={i % 2 === 1 ? "bg-bgp-mist" : ""}>
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 className="text-2xl font-semibold mb-8">{service.name}</h2>
            <div
              className={`grid grid-cols-1 md:grid-cols-2 gap-10 items-center ${
                i % 2 === 1 ? "md:[direction:rtl]" : ""
              }`}
            >
              <Placeholder className="aspect-[4/3] w-full [direction:ltr]" src={service.image} alt={service.name} />
              <div className="[direction:ltr]">
                <p className="text-sm text-bgp-ink/70 leading-relaxed max-w-sm">{service.intro}</p>
                <p className="mt-6">
                  <Link href={`/${service.slug}`} className="rule-link inline-block">
                    Find out more
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </section>
      ))}

      {/* News & insights strip */}
      <section className="bg-bgp-mist border-t border-bgp-line">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="border-b border-bgp-ink pb-2 mb-6 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">News and insights</h2>
            <Link href="/news" className="label-caps hover:text-bgp-burgundy">
              Find out more
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {ARTICLES.slice(0, 3).map((a) => (
              <Link key={a.slug} href={`/news/${a.slug}`} className="group block">
                <p className="label-caps text-bgp-ink/50 mb-2">{a.category}</p>
                <Placeholder className="aspect-[4/3] w-full" src={a.image} alt={a.title} />
                <p className="mt-3 text-sm font-semibold leading-snug group-hover:text-bgp-burgundy transition-colors">
                  {a.title}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
