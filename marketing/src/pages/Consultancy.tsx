import KeyContacts from "../components/KeyContacts";
import CaseStudyStrip from "../components/CaseStudyStrip";
import ClientRow from "../components/ClientRow";
import Placeholder from "../components/Placeholder";
import {
  CASE_STUDIES,
  CONSULTANCY_BODY,
  CONSULTANCY_CLIENTS,
  CONSULTANCY_CONTACTS,
  CONSULTANCY_SERVICES,
  SERVICES,
  TESTIMONIAL,
} from "../lib/content";

export default function Consultancy() {
  const service = SERVICES.find((s) => s.slug === "consultancy")!;
  return (
    <div>
      <section className="relative">
        <Placeholder className="h-72 md:h-96 w-full" src="/images/westminster.jpg" alt="Westminster and a London bus" />
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto max-w-6xl px-4 pb-10 w-full">
            <p className="max-w-md text-xl md:text-2xl leading-snug bg-bgp-cream/90 p-4 -ml-4 font-display text-bgp-wine">{service.intro}</p>
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

      <KeyContacts people={CONSULTANCY_CONTACTS} />
      <CaseStudyStrip caseStudy={CASE_STUDIES[3]} />
    </div>
  );
}
