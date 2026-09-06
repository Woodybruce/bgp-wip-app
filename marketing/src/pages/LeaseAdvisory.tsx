import { useState } from "react";
import KeyContacts from "../components/KeyContacts";
import { Link } from "wouter";
import ClientRow from "../components/ClientRow";
import Placeholder from "../components/Placeholder";
import {
  LEASE_ADVISORY_CASE_STUDIES,
  LEASE_ADVISORY_CLIENTS,
  LEASE_ADVISORY_CONTACTS,
  LEASE_ADVISORY_SERVICES,
  SERVICES,
} from "../lib/content";

export default function LeaseAdvisory() {
  const service = SERVICES.find((s) => s.slug === "lease-advisory")!;
  const [selected, setSelected] = useState(0);

  return (
    <div>
      <section className="relative">
        <Placeholder className="h-72 md:h-96 w-full" src="/images/lease-signing.jpg" alt="Signing a lease" />
        <div className="absolute inset-0 bg-gradient-to-t from-bgp-ink/70 via-bgp-ink/10 to-transparent" />
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto max-w-6xl px-4 pb-10 w-full">
            <p className="max-w-xl text-2xl md:text-3xl leading-snug font-display italic text-white" style={{ textShadow: "0 2px 16px rgba(0,0,0,0.45)" }}>{service.intro}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="display text-2xl md:text-3xl mb-8">A snapshot of clients</h2>
        <ClientRow clients={LEASE_ADVISORY_CLIENTS} />
      </section>

      <section className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-10">
          <div>
            <h2 className="display text-2xl md:text-3xl">What we offer</h2>
            <ul className="mt-6 space-y-3">
              {LEASE_ADVISORY_SERVICES.map((s, i) => (
                <li key={s.name}>
                  <button
                    onClick={() => setSelected(i)}
                    className={`text-left text-sm border-l-2 pl-3 transition-colors ${
                      selected === i
                        ? "border-bgp-burgundy font-semibold text-bgp-burgundy"
                        : "border-transparent text-bgp-ink/70 hover:text-bgp-burgundy"
                    }`}
                  >
                    {s.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-bgp-mist p-8">
            <p className="label-caps mb-3">{LEASE_ADVISORY_SERVICES[selected].name}</p>
            <p className="text-sm text-bgp-ink/70 leading-relaxed max-w-lg">
              {LEASE_ADVISORY_SERVICES[selected].detail}
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10">
        <span className="section-label">Case studies</span>
        <div className="card-strip sm:grid-cols-2 lg:grid-cols-4 mt-6">
          {LEASE_ADVISORY_CASE_STUDIES.map((cs) => (
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
      <KeyContacts people={LEASE_ADVISORY_CONTACTS} />
    </div>
  );
}
