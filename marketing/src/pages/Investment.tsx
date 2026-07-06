import KeyContacts from "../components/KeyContacts";
import CaseStudyStrip from "../components/CaseStudyStrip";
import Placeholder from "../components/Placeholder";
import { CASE_STUDIES, LEASING_CONTACTS, SERVICES } from "../lib/content";

// Investment listings will come from the investment tracker once a public
// feed is agreed — sample cards for now, matching the wireframe layout.
const SAMPLE_INVESTMENTS = [
  { name: "[Sample] Property name / Location", client: "Client name", price: "£5,350,000", capRate: "3.62%", sold: false, wide: true },
  { name: "[Sample] Property name / Location", client: "Client name", price: "£2,325,000", capRate: "4.60%", sold: false, wide: false },
  { name: "[Sample] Property name / Location", client: "Client name", price: "£5,350,000", capRate: "3.62%", sold: false, wide: false },
  { name: "[Sample] Property name / Location", client: "Client name", price: "£5,350,000", capRate: "3.62%", sold: true, wide: false },
  { name: "[Sample] Property name / Location", client: "Client name", price: "£5,350,000", capRate: "3.62%", sold: true, wide: false },
];

export default function Investment() {
  const service = SERVICES.find((s) => s.slug === "investment")!;
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
        <h1 className="text-lg font-semibold">Snapshot of properties</h1>
        <p className="mt-1 text-xs text-bgp-ink/50">
          Please contact us for full availability · Default is date order, with available listings at the top
        </p>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
          {SAMPLE_INVESTMENTS.map((inv, i) => (
            <div key={i} className={inv.wide ? "sm:col-span-2" : ""}>
              <div className="relative">
                <Placeholder className="aspect-[4/3] w-full" />
                {inv.sold && (
                  <span className="absolute top-0 right-0 bg-bgp-stone text-bgp-ink label-caps px-3 py-1.5">Sold</span>
                )}
              </div>
              <p className="label-caps mt-3">{inv.name}</p>
              <p className="text-xs text-bgp-ink/50 uppercase">{inv.client}</p>
              <p className="mt-1 text-sm tabular">
                {inv.price} / cap rate {inv.capRate}
              </p>
            </div>
          ))}
        </div>
      </section>

      <KeyContacts people={LEASING_CONTACTS} />
      <CaseStudyStrip caseStudy={CASE_STUDIES[1]} />
    </div>
  );
}
