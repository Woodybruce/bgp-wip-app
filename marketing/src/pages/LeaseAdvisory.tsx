import { useState } from "react";
import KeyContacts from "../components/KeyContacts";
import CaseStudyStrip from "../components/CaseStudyStrip";
import ClientRow from "../components/ClientRow";
import Placeholder from "../components/Placeholder";
import {
  CASE_STUDIES,
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
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto max-w-6xl px-4 pb-10 w-full">
            <p className="max-w-md text-xl md:text-2xl leading-snug bg-bgp-paper/85 p-4 -ml-4">{service.intro}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="label-caps border-b border-bgp-ink pb-2 mb-8">A snapshot of clients</h2>
        <ClientRow clients={LEASE_ADVISORY_CLIENTS} />
      </section>

      <section className="mx-auto max-w-6xl px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-10">
          <div>
            <h2 className="text-2xl font-semibold">What we offer</h2>
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

      <KeyContacts people={LEASE_ADVISORY_CONTACTS} />
      <CaseStudyStrip caseStudy={CASE_STUDIES[0]} />
    </div>
  );
}
