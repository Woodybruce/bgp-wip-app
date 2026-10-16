import { useState } from "react";

// "What we offer" — the same list-plus-panel on every service page
// (Lease Advisory set the pattern; Brand Representation and Consultancy
// follow it, Woody 2026-10-12). Leasing and Investment have sub-pages
// instead.
export default function ServiceList({ services, heading = "What we offer", body, variant = "panel" }: { services: Array<{ name: string; detail: string }>; heading?: string; body?: string[]; variant?: "panel" | "list" }) {
  const [selected, setSelected] = useState(0);
  const current = services[selected] ?? services[0];
  if (variant === "list") {
    // Wireframe slide 41: a grey "Additional services" box at left, the copy at right.
    return (
      <section className="mx-auto max-w-6xl px-4 py-6">
        <div className="border-t border-bgp-ink pt-8 grid grid-cols-1 md:grid-cols-[300px_1fr] gap-10 items-start">
          <div className="bg-bgp-mist p-6">
            <p className="text-xs font-bold border-b border-bgp-ink pb-2 mb-4">{heading}</p>
            <ul>
              {services.map((s) => (
                <li key={s.name} className="text-sm text-bgp-ink/85 border-b border-bgp-line py-3 last:border-0">{s.name}</li>
              ))}
            </ul>
          </div>
          <div className="space-y-4 max-w-2xl">
            {(body ?? []).map((p, i) => (
              <p key={p.slice(0, 24)} className={`text-base ${i === 0 ? "font-bold text-bgp-ink" : "text-bgp-ink/85"}`}>{p}</p>
            ))}
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      {/* Wireframe slides 38 and 41: heading at left with the copy beside it,
          then the list of services with the detail box to its right. */}
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-x-10 gap-y-4 border-b border-bgp-ink pb-6 mb-8">
        <h2 className="display text-2xl md:text-3xl">{heading}</h2>
        {body && body.length > 0 && (
          <div className="space-y-3 max-w-2xl">
            {body.map((p, i) => (
              <p key={p.slice(0, 24)} className={`text-base ${i === 0 ? "font-bold text-bgp-ink" : "text-bgp-ink/85"}`}>
                {p.includes(": ") ? <><strong className="text-bgp-ink">{p.split(": ")[0]}:</strong> {p.split(": ").slice(1).join(": ")}</> : p}
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-10">
        <div>
          <ul className="space-y-3">
            {services.map((s, i) => (
              <li key={s.name}>
                <button
                  onClick={() => setSelected(i)}
                  className={`text-left text-base transition-colors ${
                    selected === i ? "font-bold text-bgp-ink" : "text-bgp-ink/70 hover:text-bgp-wine"
                  }`}
                >
                  <span className="mr-2" aria-hidden>—</span>{s.name}
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
