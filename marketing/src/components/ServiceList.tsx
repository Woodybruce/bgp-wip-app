import { useState } from "react";

// "What we offer" — the same list-plus-panel on every service page
// (Lease Advisory set the pattern; Brand Representation and Consultancy
// follow it, Woody 2026-10-12). Leasing and Investment have sub-pages
// instead.
export default function ServiceList({ services, heading = "What we offer", body, variant = "panel" }: { services: Array<{ name: string; detail: string }>; heading?: string; body?: string[]; variant?: "panel" | "list" }) {
  const [selected, setSelected] = useState(0);
  // Slide 38 lists seven services; slide 41 lists three. Missing ones show in italics.
  const padded: Array<{ name: string; detail: string; draft?: boolean }> = [...services, ...Array.from({ length: Math.max(0, 7 - services.length) }, (_, i) => ({ name: `Service ${services.length + i + 1} to follow`, detail: "Draft: a short paragraph on this service, what it covers and a recent example, to be written by the team.", draft: true }))];
  const current = padded[selected] ?? padded[0];
  const isDraft = (s: { draft?: boolean }) => !!s.draft;
  if (variant === "list") {
    // Wireframe slide 41: a grey "Additional services" box at left, the copy at right.
    return (
      <section className="mx-auto max-w-[1360px] px-4 py-6">
        <div className="border-t-[3px] border-bgp-ink pt-8 grid grid-cols-1 md:grid-cols-[46fr_54fr] gap-10 items-start">
          <div className="bg-bgp-mist p-6">
            <p className="text-xs font-bold border-b border-bgp-ink pb-2 mb-4">{heading}</p>
            <ul>
              {services.slice(0, 3).map((s) => (
                <li key={s.name} className="text-base text-bgp-ink/85 border-b border-bgp-line py-3 last:border-0">{s.name}</li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            {(body ?? []).map((p, i) => (
              <p key={p.slice(0, 24)} className={`text-base ${i === 0 ? "font-bold text-bgp-ink" : "text-bgp-ink/85"}`}>{p}</p>
            ))}
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="mx-auto max-w-[1360px] px-4 py-6">
      {/* Wireframe slides 38 and 41: heading at left with the copy beside it,
          then the list of services with the detail box to its right. */}
      <div className="grid grid-cols-1 md:grid-cols-[46fr_54fr] gap-x-10 gap-y-4 border-t-[3px] border-bgp-ink pt-6 mb-8">
        <h2 className="font-light text-3xl md:text-5xl text-bgp-ink whitespace-nowrap">{heading}</h2>
        {body && body.length > 0 && (
          <div className="space-y-3">
            {/* Slide 38 sets one short paragraph beside the heading. */}
            {body.slice(0, 1).map((p) => (
              <p key={p.slice(0, 24)} className="text-2xl leading-snug text-bgp-ink/85">{p}</p>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[46fr_54fr] gap-10">
        <div>
          <ul className="space-y-4">
            {padded.map((s, i) => (
              <li key={s.name}>
                <button
                  onClick={() => setSelected(i)}
                  className={`text-left text-2xl transition-colors ${isDraft(s) ? "italic" : ""} ${
                    selected === i ? "font-bold text-bgp-ink" : "text-bgp-ink/70 hover:text-bgp-wine"
                  }`}
                >
                  <span className="mr-2" aria-hidden>—</span>{s.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-bgp-mist p-6 md:p-10 flex flex-col min-h-[20rem]">
          <p className={`text-base text-bgp-ink/85 ${isDraft(current) ? "italic" : ""}`}>{current.detail}</p>
          {/* Slide 38 fills this box with about seven lines; short entries show the gap in italics. */}
          {!isDraft(current) && current.detail.length < 220 && (
            <p className="mt-3 text-base text-bgp-ink/85 italic">Draft: two or three more sentences from the team on how this works in practice, a recent example, and what it meant for the client.</p>
          )}
          <button type="button" onClick={() => setSelected((selected + 1) % padded.length)} aria-label="Next service" className="mt-6 self-end text-4xl leading-none text-bgp-ink hover:text-bgp-wine">→</button>
        </div>
      </div>
    </section>
  );
}
