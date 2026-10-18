import { useEffect } from "react";
import { Link, useRoute } from "wouter";
import Placeholder from "../components/Placeholder";
import KeyContacts from "../components/KeyContacts";
import { MapSlot, QuoteBlock, SectionHead } from "../components/Wire";
import { useState } from "react";
import { type SiteContent, useSiteContent } from "../lib/site-content";
import { CASE_STUDIES, INVESTMENT_DEALS } from "../lib/content";

const contactsFor = (c: SiteContent["contacts"], service: string) =>
  ({
    Leasing: c.leasing.slice(0, 3),
    Investment: c.investment.slice(0, 3),
    "Brand Representation": c.brand_representation,
    Consultancy: c.consultancy,
    "Lease Advisory": c.lease_advisory,
  })[service] ?? c.leasing.slice(0, 3);

function Carousel({ photos, alt }: { photos: string[]; alt: string }) {
  const [i, setI] = useState(0);
  const step = (d: number) => setI((x) => (x + d + photos.length) % photos.length);
  return (
    <div className="relative mt-10 md:mt-16">
      <div className="img-frame"><Placeholder className="aspect-[1.69] w-full" src={photos[i]} alt={alt} /></div>
      {photos.length > 1 && (
        <>
          <button type="button" onClick={() => step(-1)} aria-label="Previous photo" className="absolute left-3 top-1/2 -translate-y-1/2 h-11 w-11 flex items-center justify-center bg-bgp-cream/90 text-bgp-wine text-3xl hover:bg-bgp-cream">‹</button>
          <button type="button" onClick={() => step(1)} aria-label="Next photo" className="absolute right-3 top-1/2 -translate-y-1/2 h-11 w-11 flex items-center justify-center bg-bgp-cream/90 text-bgp-wine text-3xl hover:bg-bgp-cream">›</button>
          <div className="absolute bottom-3 inset-x-0 flex justify-center gap-1.5" aria-hidden>
            {photos.map((_, k) => <span key={k} className={`h-1.5 w-1.5 rounded-full ${k === i ? "bg-bgp-cream" : "bg-bgp-cream/45"}`} />)}
          </div>
        </>
      )}
    </div>
  );
}

export default function CaseStudyPage() {
  const [, params] = useRoute("/case-studies/:slug");
  const content = useSiteContent();
  const caseStudy = content.caseStudies.find((c) => c.slug === params?.slug) ?? CASE_STUDIES.find((c) => c.slug === params?.slug);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [params?.slug]);

  if (!caseStudy) {
    return (
      <div className="site-container py-32 text-center">
        <p className="label-caps text-bgp-burgundy">Case study not found</p>
        <p className="mt-4">
          <Link href="/" className="explore-link inline-block">Back to home</Link>
        </p>
      </div>
    );
  }

  const others = content.caseStudies.filter((c) => c.slug !== caseStudy.slug).slice(0, 3);
  const contacts = contactsFor(content.contacts, caseStudy.service);
  // Wireframe: investment case studies end with similar transactions.
  const related = caseStudy.service === "Investment" ? INVESTMENT_DEALS.filter((d) => !caseStudy.title.includes(d.name.split(",")[0])).slice(0, 3) : [];
  const photos = [caseStudy.image, ...(caseStudy.gallery || [])].filter(Boolean) as string[];

  return (
    <div>
      <section className="site-container section-space">
        <h2 className="sr-only">Case study · {caseStudy.service}</h2>
        {/* Wireframe slide 32: title and intro at left with the facts panel
            beside them, then an image carousel with arrows and dots. */}
        <div className="grid grid-cols-1 md:grid-cols-[63fr_12fr_25fr] gap-y-10 md:gap-0">
          <div className="min-w-0">
            <h1 className={`display text-[clamp(32px,4vw,56px)] ${caseStudy.draft ? "italic" : ""}`}>{caseStudy.title}</h1>
            <div className={`mt-7 max-w-[58ch] space-y-5 ${caseStudy.draft ? "italic" : ""}`}>
              {caseStudy.body.map((para) => (
                <p key={para.slice(0, 32)} className="body-copy text-bgp-ink">
                  {para}
                </p>
              ))}
            </div>
          </div>
          <div className="hidden md:block" />
          <aside className="min-w-0 self-start md:border-l md:border-bgp-wine md:pl-6">
            <dl className="grid grid-cols-2 gap-x-6 border-t border-bgp-wine md:block md:border-t-0">
              {caseStudy.facts.map(([k, v]) => (
                <div key={k} className="min-w-0 border-b border-bgp-line py-3 md:border-0 md:pt-0 md:pb-5">
                  <dt className="label-caps font-bold text-bgp-wine">{k}</dt>
                  <dd className="mt-1 text-base leading-snug text-bgp-ink tabular break-words">{v}</dd>
                </div>
              ))}
            </dl>
            <a
              href="#contact"
              className="mt-6 btn block"
            >
              Talk to us
            </a>
          </aside>
        </div>
        {photos.length > 0 && <Carousel key={caseStudy.slug} photos={photos} alt={caseStudy.title} />}
      </section>

      <QuoteBlock quote={caseStudy.quote} imageSide="left" />

      <section className="site-container section-space">
        <SectionHead title="Location" />
        <MapSlot lat={caseStudy.location?.lat} lon={caseStudy.location?.lon} className="aspect-[1.2] w-full md:aspect-[2.15]" />
      </section>

      <KeyContacts band={false} people={contacts} />

      {related.length > 0 && (
        <section className="site-container section-space">
          <SectionHead title="Similar transactions" sub="By location" />
          <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((deal) => (
              <Link key={deal.name} href="/investment" className="group block">
                <div className="relative img-frame">
                  <Placeholder className="aspect-[1.85] w-full" src={deal.image} alt={deal.name} label="Photo to follow" />
                  <span className="absolute inset-x-0 top-0 label-caps px-3 py-2 text-right bg-bgp-wine text-bgp-cream">{deal.status}</span>
                </div>
                <div className="mt-3 border-t border-bgp-wine/30 pt-3">
                  <h3 className="label-caps font-bold text-bgp-wine">{deal.name}</h3>
                  <p className="mt-0.5 label-caps text-bgp-ink/45">{deal.client}</p>
                  <p className="mt-1.5 text-sm text-bgp-ink tabular">{deal.type === "Transaction" ? "" : deal.type}{deal.price ? ` · ${deal.price}` : ""}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {related.length === 0 && (
      <section className="site-container section-space">
        <SectionHead title="More case studies" />
        <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {others.map((c) => (
            <Link key={c.slug} href={`/case-studies/${c.slug}`} className="group block">
              <Placeholder className="aspect-[4/3] w-full" src={c.image} alt={c.title} />
              <p className="label-caps text-bgp-ink/50 mt-3">{c.service}</p>
              <h3 className="mt-2 label-caps font-bold text-bgp-wine group-hover:opacity-70 transition-opacity">{c.title}</h3>
            </Link>
          ))}
        </div>
      </section>
      )}
    </div>
  );
}
