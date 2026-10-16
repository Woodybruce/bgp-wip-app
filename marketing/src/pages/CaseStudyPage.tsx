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
    <div className="relative mt-8">
      <div className="img-frame"><Placeholder className="aspect-[16/10] w-full" src={photos[i]} alt={alt} /></div>
      {photos.length > 1 && (
        <>
          <button type="button" onClick={() => step(-1)} aria-label="Previous photo" className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 flex items-center justify-center bg-bgp-cream/85 text-bgp-wine text-xl hover:bg-bgp-cream">‹</button>
          <button type="button" onClick={() => step(1)} aria-label="Next photo" className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 flex items-center justify-center bg-bgp-cream/85 text-bgp-wine text-xl hover:bg-bgp-cream">›</button>
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
      <div className="mx-auto max-w-[1360px] px-4 py-32 text-center">
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
      <section className="mx-auto max-w-[1360px] px-4 py-7">
        <p className="label-caps border-b border-bgp-ink pb-2 text-bgp-ink/50">
          Case study · {caseStudy.service}
        </p>
        {/* Wireframe slide 32: title and intro at left with the facts panel
            beside them, then an image carousel with arrows and dots. */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-[63fr_12fr_25fr] gap-6 md:gap-0">
          <div>
            <h1 className={`font-light text-3xl md:text-4xl ${caseStudy.draft ? "italic" : ""}`}>{caseStudy.title}</h1>
            <div className={`mt-5 space-y-4 ${caseStudy.draft ? "italic" : ""}`}>
              {caseStudy.body.map((para) => (
                <p key={para.slice(0, 32)} className="text-base text-bgp-ink/85">
                  {para}
                </p>
              ))}
            </div>
            {photos.length > 0 && <Carousel photos={photos} alt={caseStudy.title} />}
          </div>
          <div className="hidden md:block" />
          <aside>
            <dl className="border-t border-bgp-ink">
              {caseStudy.facts.map(([k, v]) => (
                <div key={k} className="border-b border-bgp-line py-3">
                  <dt className="label-caps text-bgp-ink/50">{k}</dt>
                  <dd className="mt-1 text-sm tabular">{v}</dd>
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
      </section>

      <QuoteBlock quote={caseStudy.quote} imageSide="left" />

      <section className="mx-auto max-w-[1360px] px-4 pb-10">
        <SectionHead title="Location" />
        <MapSlot lat={caseStudy.location?.lat} lon={caseStudy.location?.lon} />
      </section>

      <KeyContacts band={false} people={contacts} />

      {related.length > 0 && (
        <section className="mx-auto max-w-[1360px] px-4 py-7">
          <SectionHead title="Similar transactions" sub="By location" />
          <div className="card-strip sm:grid-cols-3 sm:gap-6">
            {related.map((deal) => (
              <Link key={deal.name} href="/investment" className="group block">
                <div className="relative img-frame">
                  <Placeholder className="aspect-[4/3] w-full" src={deal.image} alt={deal.name} label="Photo to follow" />
                  <span className="absolute top-0 right-0 label-caps px-3 py-1.5 bg-bgp-wine text-bgp-cream">{deal.status}</span>
                </div>
                <div className="mt-3 border-t border-bgp-wine/30 pt-3">
                  <p className="font-normal text-lg text-bgp-wine">{deal.name}</p>
                  <p className="mt-0.5 label-caps text-bgp-ink/45">{deal.client}</p>
                  <p className="mt-1.5 text-sm text-bgp-ink/80 tabular">{deal.type === "Transaction" ? "" : deal.type}{deal.price ? ` · ${deal.price}` : ""}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {related.length === 0 && (
      <section className="mx-auto max-w-[1360px] px-4 py-7">
        <SectionHead title="More case studies" />
        <div className="card-strip sm:grid-cols-3">
          {others.map((c) => (
            <Link key={c.slug} href={`/case-studies/${c.slug}`} className="group block">
              <Placeholder className="aspect-[4/3] w-full" src={c.image} alt={c.title} />
              <p className="label-caps text-bgp-ink/50 mt-3">{c.service}</p>
              <p className="mt-1 text-sm font-semibold group-hover:text-bgp-burgundy transition-colors">{c.title}</p>
            </Link>
          ))}
        </div>
      </section>
      )}
    </div>
  );
}
