import { useState } from "react";

// "What we offer" — the same list-plus-panel on every service page
// (Lease Advisory set the pattern; Brand Representation and Consultancy
// follow it, Woody 2026-10-12). Leasing and Investment have sub-pages
// instead.
export default function ServiceList({ services, heading = "What we offer" }: { services: Array<{ name: string; detail: string }>; heading?: string }) {
  const [selected, setSelected] = useState(0);
  const current = services[selected] ?? services[0];
  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-10">
        <div>
          <h2 className="display text-2xl md:text-3xl">{heading}</h2>
          <ul className="mt-6 space-y-3">
            {services.map((s, i) => (
              <li key={s.name}>
                <button
                  onClick={() => setSelected(i)}
                  className={`text-left text-base border-l-2 pl-3 transition-colors ${
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
          <p className="label-caps mb-3">{current.name}</p>
          <p className="text-base md:text-lg text-bgp-ink/85 max-w-xl">{current.detail}</p>
        </div>
      </div>
    </section>
  );
}
