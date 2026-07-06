import ContactCard from "../components/ContactCard";
import Placeholder from "../components/Placeholder";
import { TEAM } from "../lib/content";

export default function Team() {
  const sorted = [...TEAM].sort((a, b) => {
    const surname = (n: string) => n.split(" ").slice(-1)[0];
    return surname(a.name).localeCompare(surname(b.name));
  });

  return (
    <div>
      <section className="relative">
        <Placeholder className="h-80 md:h-[28rem] w-full" src="/images/office.jpg" alt="Office interior — team photo to follow" />
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto max-w-6xl px-4 pb-10 w-full">
            <p className="max-w-md text-xl md:text-2xl leading-snug bg-bgp-paper/85 p-4 -ml-4">
              Connecting leading brands with the best international locations. Creating
              neighbourhoods that people love.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <h1 className="text-lg font-semibold border-b border-bgp-ink pb-2 mb-8">A–Z contact details</h1>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
          {sorted.map((p) => (
            <ContactCard key={p.name} person={p} />
          ))}
        </div>
      </section>
    </div>
  );
}
