import KeyContacts from "../components/KeyContacts";
import ClientRow from "../components/ClientRow";
import Placeholder from "../components/Placeholder";
import { BRAND_REP_CASE_STUDIES, BRAND_REP_CLIENTS, BRAND_REP_CONTACTS, SERVICES } from "../lib/content";

export default function BrandRepresentation() {
  const service = SERVICES.find((s) => s.slug === "brand-representation")!;
  return (
    <div>
      <section className="mx-auto max-w-6xl px-4 pt-14">
        <p className="max-w-xl text-2xl md:text-3xl leading-snug">{service.intro}</p>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="label-caps border-b border-bgp-ink pb-2 mb-8">A snapshot of clients</h2>
        <ClientRow clients={BRAND_REP_CLIENTS} />
      </section>

      <section className="mx-auto max-w-6xl px-4 py-6">
        <h2 className="text-lg font-semibold border-b border-bgp-ink pb-2 mb-8">Case studies</h2>
        <div className="space-y-10">
          {BRAND_REP_CASE_STUDIES.map((cs, i) => (
            <div key={cs.name} className={`p-6 md:p-8 ${i % 2 === 0 ? "bg-bgp-mist" : ""}`}>
              <p className="label-caps mb-4">{cs.name}</p>
              <div className={`grid grid-cols-1 md:grid-cols-2 gap-8 items-center ${i % 2 === 1 ? "md:[direction:rtl]" : ""}`}>
                <Placeholder className="aspect-[4/3] w-full [direction:ltr]" />
                <div className="[direction:ltr]">
                  <p className="text-sm text-bgp-ink/70 leading-relaxed max-w-sm">{cs.blurb}</p>
                  <p className="mt-4"><span className="rule-link inline-block cursor-pointer">Read more</span></p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <KeyContacts
        people={BRAND_REP_CONTACTS}
        blurb="Our brand representation team supports occupiers from first site to full network."
      />
    </div>
  );
}
