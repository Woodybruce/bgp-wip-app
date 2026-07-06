import { useState } from "react";
import KeyContacts from "../components/KeyContacts";
import CaseStudyStrip from "../components/CaseStudyStrip";
import Placeholder from "../components/Placeholder";
import { CASE_STUDIES, LEASE_ADVISORY_SERVICES, LEASING_CONTACTS, SERVICES } from "../lib/content";

const CLIENT_COUNT = 14;

export default function LeaseAdvisory() {
  const service = SERVICES.find((s) => s.slug === "lease-advisory")!;
  const [selected, setSelected] = useState(2); // wireframe shows Lease Restructuring active

  return (
    <div>
      <section className="relative">
        <Placeholder className="h-72 md:h-96 w-full" />
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto max-w-6xl px-4 pb-10 w-full">
            <p className="max-w-md text-xl md:text-2xl leading-snug bg-bgp-paper/85 p-4 -ml-4">{service.intro}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="label-caps border-b border-bgp-ink pb-2 mb-8">A snapshot of clients</h2>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-6">
          {Array.from({ length: CLIENT_COUNT }).map((_, i) => (
            <div
              key={i}
              className="aspect-square rounded-full border border-bgp-line flex items-center justify-center label-caps text-bgp-stone"
            >
              Logo
            </div>
          ))}
        </div>
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

      <KeyContacts people={LEASING_CONTACTS.slice(0, 3)} />
      <CaseStudyStrip caseStudy={CASE_STUDIES[0]} />
    </div>
  );
}
