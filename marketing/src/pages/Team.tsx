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
        <div className="absolute inset-0 bg-gradient-to-t from-bgp-ink/70 via-bgp-ink/10 to-transparent" />
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto max-w-6xl px-4 pb-10 w-full">
            <p className="max-w-xl text-2xl md:text-3xl leading-snug font-display italic text-white" style={{ textShadow: "0 2px 16px rgba(0,0,0,0.45)" }}>
              Connecting leading brands with the best international locations. Creating
              neighbourhoods that people love.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <span className="section-label">The team</span>
        <h1 className="display text-3xl md:text-5xl mb-10">A–Z contact details</h1>
        <div className="border-t border-bgp-wine/30">
          {sorted.map((p) => (
            <div
              key={p.name}
              className="group grid grid-cols-1 md:grid-cols-[2.2fr_2fr_1.4fr_2.2fr] gap-x-6 gap-y-0.5 py-4 border-b border-bgp-line items-baseline"
            >
              <p className="font-display text-lg text-bgp-wine flex items-center gap-3">
                {p.photo && (
                  <img
                    src={p.photo}
                    alt=""
                    className="h-9 w-9 rounded-full object-cover grayscale shrink-0 self-center"
                  />
                )}
                {p.name}
              </p>
              <p className="text-sm font-light text-bgp-ink/70">{p.title}</p>
              <p className="text-sm tabular text-bgp-ink/80">{p.phone}</p>
              <p className="text-sm break-all">
                {p.email === "TBC" ? (
                  <span className="text-bgp-ink/40">Email to follow</span>
                ) : (
                  <a href={`mailto:${p.email}`} className="hover:text-bgp-red transition-colors">{p.email}</a>
                )}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
