import ContactCard from "./ContactCard";

// A tile for a person the team has not named yet, in italics.
function ContactSlot({ n }: { n: number }) {
  return (
    <div className="w-full max-w-[9.5rem] italic text-bgp-stone">
      <div className="aspect-[3/4] w-full bg-bgp-stone/30" />
      <p className="mt-3 label-caps md:text-[0.88rem] text-bgp-stone">Name {n}</p>
      <div className="mt-1 text-[0.88rem] leading-tight space-y-0">
        <p>Job title</p>
        <p>+44 (0)20 0000 0000</p>
        <p>name@bgp.uk.com</p>
      </div>
    </div>
  );
}
import { Band } from "./Wire";
import type { Person } from "../lib/content";

// Key contacts as the slides draw them. Slides 38 and 41: grey band, heading
// and blurb at left, tiles at right. Slides 26, 27, 28, 31, 32: on white under
// a rule; 26 and 31 put the heading above a full row of tiles.
export default function KeyContacts({ people, blurb = "Our team would be delighted to hear from you.", band = true, layout = "beside", padTo }: { people: Person[]; blurb?: string; band?: boolean; layout?: "beside" | "row"; padTo?: number }) {
  const want = padTo ?? (layout === "row" ? 5 : 3);
  const shown = people.slice(0, want);
  const slots = Array.from({ length: Math.max(0, want - shown.length) }, (_, i) => shown.length + i + 1);
  const inner = layout === "row" ? (
    <div>
      <h2 className="text-[1.73rem] font-bold text-bgp-ink mb-5">Key contacts</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-5">
        {shown.map((p) => (
          <ContactCard key={p.name} person={p} compact />
        ))}
        {slots.map((n) => <ContactSlot key={n} n={n} />)}
      </div>
    </div>
  ) : (
    <div className="grid grid-cols-1 md:grid-cols-[42fr_58fr] gap-8 md:gap-12">
      <div>
        <h2 className="text-[1.46rem] font-bold text-bgp-ink">Key contacts</h2>
        <p className="mt-3 text-[1.38rem] leading-[1.12] text-bgp-ink">{blurb}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
        {shown.map((p) => (
          <ContactCard key={p.name} person={p} compact />
        ))}
        {slots.map((n) => <ContactSlot key={n} n={n} />)}
      </div>
    </div>
  );
  if (band) return <Band className="[&>div]:py-10">{inner}</Band>;
  return (
    <section className="mx-auto max-w-[1360px] px-4">
      <div className="border-t-[3px] border-bgp-ink pt-6 pb-12">{inner}</div>
    </section>
  );
}
