import { Link } from "wouter";
import KeyContacts from "../components/KeyContacts";
import ClientRow from "../components/ClientRow";
import Placeholder from "../components/Placeholder";
import { CONSULTANCY_BODY, CONSULTANCY_CLIENTS, CONSULTANCY_SERVICES, SERVICES, TESTIMONIAL } from "../lib/content";
import { useSiteContent } from "../lib/site-content";

export default function Consultancy() {
  const service = SERVICES.find((s) => s.slug === "consultancy")!;
  const content = useSiteContent();
  const CONSULTANCY_CONTACTS = content.contacts.consultancy;
  const caseStudies = content.caseStudies.filter((c) => c.service === "Consultancy");
  return (
    <div>
      <section className="relative">
        <Placeholder className="h-72 md:h-96 w-full" src="/images/westminster.jpg" alt="Westminster and a London bus" />
        <div className="absolute inset-0 bg-gradient-to-t from-bgp-ink/70 via-bgp-ink/10 to-transparent" />
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto max-w-6xl px-4 pb-10 w-full">
            <p className="max-w-xl text-2xl md:text-3xl leading-snug font-display italic text-white" style={{ textShadow: "0 2px 16px rgba(0,0,0,0.45)" }}>{service.intro}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="display text-2xl md:text-3xl mb-8">A snapshot of clients</h2>
        <ClientRow clients={CONSULTANCY_CLIENTS} />
      </section>

      <section className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <div className="bg-bgp-mist p-8">
            <p className="label-caps border-b border-bgp-ink pb-2 mb-6">Additional services</p>
            <ul className="space-y-4">
              {CONSULTANCY_SERVICES.map((s) => (
                <li key={s} className="text-sm text-bgp-ink/70 leading-relaxed border-b border-bgp-line pb-4">
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            <p className="text-sm font-semibold leading-relaxed">{CONSULTANCY_BODY[0]}</p>
            {CONSULTANCY_BODY.slice(1).map((p) => (
              <p key={p.slice(0, 20)} className="text-sm text-bgp-ink/70 leading-relaxed">
                {p}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* Client quote */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 items-center max-w-2xl">
          <Placeholder className="aspect-square w-full" />
          <div>
            <p className="text-lg italic leading-relaxed text-bgp-ink/80">"{TESTIMONIAL.quote}"</p>
            <p className="label-caps mt-4">{TESTIMONIAL.name}</p>
            <p className="text-xs text-bgp-ink/50 uppercase">{TESTIMONIAL.title}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10">
        <span className="section-label">Case studies</span>
        <div className="card-strip sm:grid-cols-3 mt-6">
          {caseStudies.map((cs) => (
            <Link key={cs.slug} href={`/case-studies/${cs.slug}`} className="group block">
              <div className="img-frame">
                <Placeholder className="aspect-[4/3] w-full" src={cs.image} alt={cs.title} />
              </div>
              <p className="label-caps mt-4 group-hover:text-bgp-burgundy transition-colors">{cs.title}</p>
              <p className="mt-2 text-[15px] font-light text-bgp-ink/85 leading-relaxed">{cs.blurb}</p>
              <p className="mt-3"><span className="explore-link">Read more</span></p>
            </Link>
          ))}
        </div>
      </section>
      <KeyContacts people={CONSULTANCY_CONTACTS} />
    </div>
  );
}
