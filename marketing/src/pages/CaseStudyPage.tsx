import { useEffect } from "react";
import { Link, useRoute } from "wouter";
import Placeholder from "../components/Placeholder";
import KeyContacts from "../components/KeyContacts";
import {
  BRAND_REP_CONTACTS,
  CASE_STUDIES,
  CONSULTANCY_CONTACTS,
  INVESTMENT_CONTACTS,
  LEASING_CONTACTS,
  Person,
} from "../lib/content";

const CONTACTS_BY_SERVICE: Record<string, Person[]> = {
  Leasing: LEASING_CONTACTS.slice(0, 3),
  Investment: INVESTMENT_CONTACTS.slice(0, 3),
  "Brand Representation": BRAND_REP_CONTACTS,
  Consultancy: CONSULTANCY_CONTACTS,
};

export default function CaseStudyPage() {
  const [, params] = useRoute("/case-studies/:slug");
  const caseStudy = CASE_STUDIES.find((c) => c.slug === params?.slug);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [params?.slug]);

  if (!caseStudy) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-32 text-center">
        <p className="label-caps text-bgp-burgundy">Case study not found</p>
        <p className="mt-4">
          <Link href="/" className="explore-link inline-block">Back to home</Link>
        </p>
      </div>
    );
  }

  const others = CASE_STUDIES.filter((c) => c.slug !== caseStudy.slug).slice(0, 3);
  const contacts = CONTACTS_BY_SERVICE[caseStudy.service] ?? LEASING_CONTACTS.slice(0, 3);

  return (
    <div>
      <section className="mx-auto max-w-6xl px-4 py-10">
        <p className="label-caps border-b border-bgp-ink pb-2 text-bgp-ink/50">
          Case study · {caseStudy.service}
        </p>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-[1fr_220px] gap-10">
          <div>
            <h1 className="display text-3xl md:text-4xl leading-tight">{caseStudy.title}</h1>
            <div className="mt-6">
              <Placeholder className="aspect-[16/10] w-full" src={caseStudy.image} alt={caseStudy.title} />
            </div>
            <div className="mt-8 space-y-4 max-w-xl">
              {caseStudy.body.map((para) => (
                <p key={para.slice(0, 32)} className="text-sm leading-relaxed text-bgp-ink/80">
                  {para}
                </p>
              ))}
            </div>
          </div>

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
              className="mt-6 block bg-bgp-burgundy text-bgp-paper text-center label-caps py-3 hover:bg-bgp-ink transition-colors"
            >
              Talk to us
            </a>
          </aside>
        </div>
      </section>

      <KeyContacts people={contacts} />

      <section className="mx-auto max-w-6xl px-4 py-10">
        <h2 className="display text-2xl md:text-3xl mb-8">More case studies</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {others.map((c) => (
            <Link key={c.slug} href={`/case-studies/${c.slug}`} className="group block">
              <Placeholder className="aspect-[4/3] w-full" src={c.image} alt={c.title} />
              <p className="label-caps text-bgp-ink/50 mt-3">{c.service}</p>
              <p className="mt-1 text-sm font-semibold group-hover:text-bgp-burgundy transition-colors">{c.title}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
