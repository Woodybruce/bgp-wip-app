import KeyContacts from "../components/KeyContacts";
import ServiceList from "../components/ServiceList";
import { Link } from "wouter";
import ClientRow from "../components/ClientRow";
import Placeholder from "../components/Placeholder";
import { LEASE_ADVISORY_CLIENTS, LEASE_ADVISORY_SERVICES, SERVICES } from "../lib/content";
import { useSiteContent } from "../lib/site-content";

export default function LeaseAdvisory() {
  const service = SERVICES.find((s) => s.slug === "lease-advisory")!;
  const { caseStudies, contacts } = useSiteContent();
  const LEASE_ADVISORY_CASE_STUDIES = caseStudies.filter((c) => c.service === "Lease Advisory");
  const LEASE_ADVISORY_CONTACTS = contacts.lease_advisory;

  return (
    <div>
      <section className="relative">
        <Placeholder className="h-72 md:h-96 w-full" src="/images/clients/birmingham-st-martins.jpg" alt="St Martin's Square, Birmingham" />
        <div className="absolute inset-0 bg-gradient-to-t from-bgp-ink/70 via-bgp-ink/10 to-transparent" />
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto max-w-6xl px-4 pb-10 w-full">
            <p className="max-w-xl text-3xl md:text-4xl leading-snug font-display italic text-white" style={{ textShadow: "0 2px 16px rgba(0,0,0,0.45)" }}>{service.intro}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="display text-2xl md:text-3xl mb-8">A snapshot of clients</h2>
        <ClientRow clients={LEASE_ADVISORY_CLIENTS} />
      </section>

      <ServiceList services={LEASE_ADVISORY_SERVICES} />

      <section className="mx-auto max-w-6xl px-4 py-10">
        <span className="section-label">Case studies</span>
        <div className="card-strip sm:grid-cols-2 lg:grid-cols-4 mt-6">
          {LEASE_ADVISORY_CASE_STUDIES.map((cs) => (
            <Link key={cs.slug} href={`/case-studies/${cs.slug}`} className="group block">
              <div className="img-frame">
                <Placeholder className="aspect-[4/3] w-full" src={cs.image} alt={cs.title} />
              </div>
              <p className="label-caps mt-4 group-hover:text-bgp-burgundy transition-colors">{cs.title}</p>
              <p className="mt-2 text-base md:text-lg text-bgp-ink/90 leading-relaxed">{cs.blurb}</p>
              <p className="mt-3"><span className="explore-link">Read more</span></p>
            </Link>
          ))}
        </div>
      </section>
      <KeyContacts people={LEASE_ADVISORY_CONTACTS} />
    </div>
  );
}
