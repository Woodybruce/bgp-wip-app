import { Link, useRoute } from "wouter";
import KeyContacts from "../components/KeyContacts";
import Placeholder from "../components/Placeholder";
import { LEASING_SECTORS, SHOPPING_CENTRES, isDirectorLevel, type Person } from "../lib/content";
import { useSiteContent } from "../lib/site-content";

export const peopleNamed = (team: Person[], names: string[]): Person[] =>
  names.map((n) => team.find((p) => p.name === n)).filter((p): p is Person => !!p && isDirectorLevel(p));

function NotFound() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-32 text-center">
      <p className="label-caps text-bgp-burgundy">Page not found</p>
      <p className="mt-4">
        <Link href="/leasing" className="explore-link inline-block">Back to Leasing</Link>
      </p>
    </div>
  );
}

export default function LeasingSector() {
  const [, params] = useRoute("/leasing/sectors/:slug");
  const { team } = useSiteContent();
  const sector = LEASING_SECTORS.find((s) => s.slug === params?.slug);
  if (!sector) return <NotFound />;
  const contacts = peopleNamed(team, sector.contacts);
  // Photographed centres lead the grid so the image tiles sit together.
  const centres = sector.slug === "shopping-centres" ? [...SHOPPING_CENTRES].sort((a, b) => Number(!!b.image) - Number(!!a.image)) : [];

  return (
    <div>
      <section className="relative">
        <Placeholder className="h-72 md:h-96 w-full" src={sector.image} alt={sector.name} />
        <div className="absolute inset-0 bg-gradient-to-t from-bgp-ink/70 via-bgp-ink/10 to-transparent" />
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto max-w-6xl px-4 pb-10 w-full">
            <p className="label-caps text-white/80 mb-3">
              <Link href="/leasing" className="hover:text-white">Leasing</Link> · {sector.name}
            </p>
            <h1 className="max-w-2xl text-3xl md:text-4xl leading-snug font-display italic text-white" style={{ textShadow: "0 2px 16px rgba(0,0,0,0.45)" }}>
              {sector.headline}
            </h1>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className={`grid grid-cols-1 gap-10 ${sector.howWeHelp ? "md:grid-cols-[1fr_280px]" : "md:grid-cols-2"}`}>
          <div className="space-y-4">
            <span className="section-label">Our experience</span>
            {sector.body.map((p, i) => (
              <p key={p.slice(0, 24)} className={`text-base md:text-lg leading-relaxed ${i === 0 ? "font-semibold text-bgp-ink" : "text-bgp-ink/90"}`}>{p}</p>
            ))}
          </div>
          {sector.howWeHelp && (
            <div className="bg-bgp-mist p-8 self-start">
              <p className="label-caps border-b border-bgp-ink pb-2 mb-6">How we can help</p>
              <ul className="space-y-4">
                {sector.howWeHelp.map((s) => (
                  <li key={s} className="text-sm text-bgp-ink/70 leading-relaxed border-b border-bgp-line pb-4">{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {sector.gallery && (
        <section className="mx-auto max-w-6xl px-4 pb-14">
          <div className="card-strip sm:grid-cols-3">
            {sector.gallery.map((g) => (
              <figure key={g.src}>
                <div className="img-frame"><Placeholder className="aspect-[4/3] w-full" src={g.src} alt={g.caption} /></div>
                <figcaption className="mt-2 label-caps text-bgp-ink/55">{g.caption}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {centres.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-14">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-bgp-wine/25 pb-6 mb-10">
            <div>
              <span className="section-label">Where we act</span>
              <h2 className="display text-3xl md:text-4xl">Our shopping centres</h2>
            </div>
            <p className="text-base text-bgp-ink/70 max-w-[28ch]">
              {centres.length} centres across the UK, from London to Glasgow.
            </p>
          </div>
          <div className="card-strip sm:grid-cols-2 lg:grid-cols-3 sm:gap-x-6 sm:gap-y-8">
            {centres.map((c) => {
              const inner = (
                <>
                  {c.image && (
                    <div className="img-frame">
                      <Placeholder className="aspect-[4/3] w-full" src={c.image} alt={c.name} />
                    </div>
                  )}
                  <div className={`border-t border-bgp-wine/30 pt-3 ${c.image ? "mt-3" : ""}`}>
                    <p className="font-display text-lg leading-snug text-bgp-wine">{c.name}</p>
                    <p className="mt-0.5 label-caps text-bgp-ink/45">{c.location}</p>
                    <p className="mt-2 text-base text-bgp-ink/80 leading-relaxed">{c.blurb}</p>
                    <p className="mt-1.5 label-caps text-bgp-ink/45">{c.contacts.join(" · ")}</p>
                  </div>
                </>
              );
              return (
                <Link key={c.slug} href={`/leasing/sectors/shopping-centres/${c.slug}`} className="group block">{inner}</Link>
              );
            })}
          </div>
        </section>
      )}

      {contacts.length > 0 && <KeyContacts people={contacts} />}
    </div>
  );
}

// One page per centre — brief bio, photos and contacts.
export function ShoppingCentrePage() {
  const [, params] = useRoute("/leasing/sectors/shopping-centres/:slug");
  const { team } = useSiteContent();
  const centre = SHOPPING_CENTRES.find((c) => c.slug === params?.slug);
  if (!centre) return <NotFound />;
  const contacts = peopleNamed(team, centre.contacts);
  return (
    <div>
      <section className="mx-auto max-w-6xl px-4 py-10">
        <p className="label-caps border-b border-bgp-ink pb-2 text-bgp-ink/50">
          <Link href="/leasing" className="hover:text-bgp-red">Leasing</Link> ·{" "}
          <Link href="/leasing/sectors/shopping-centres" className="hover:text-bgp-red">Shopping Centres</Link> · {centre.location}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-10 mt-8">
          <div>
            <h1 className="display text-3xl md:text-4xl">{centre.name}</h1>
            {centre.image && (
              <div className="img-frame mt-6">
                <Placeholder className="aspect-[16/9] w-full" src={centre.image} alt={centre.name} />
              </div>
            )}
            <p className="mt-6 max-w-2xl text-base md:text-lg text-bgp-ink/90 leading-relaxed">{centre.blurb}</p>
            <p className="mt-4 max-w-2xl text-base md:text-lg text-bgp-ink/90 leading-relaxed">
              BGP advises the owners of {centre.name} on leasing strategy, tenant mix and positioning, drawing on our relationships with leading occupiers and our London Estates and High Street teams.
            </p>
            {centre.gallery && (
              <div className="card-strip sm:grid-cols-3 mt-8">
                {centre.gallery.map((g) => (
                  <figure key={g.src}>
                    <div className="img-frame"><Placeholder className="aspect-[4/3] w-full" src={g.src} alt={g.caption} /></div>
                    <figcaption className="mt-2 label-caps text-bgp-ink/55">{g.caption}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
          <aside className="border-t border-bgp-ink pt-3 self-start">
            {[["Location", centre.location], ["Primary contacts", centre.contacts.join(", ")]].map(([k, v]) => (
              <div key={k} className="border-b border-bgp-line py-3">
                <p className="label-caps text-bgp-ink/50">{k}</p>
                <p className="mt-1 text-sm">{v}</p>
              </div>
            ))}
            <a href="#contact" className="mt-6 block bg-bgp-wine text-bgp-cream label-caps text-center py-3">Talk to us</a>
          </aside>
        </div>
      </section>
      {contacts.length > 0 && <KeyContacts people={contacts} />}
    </div>
  );
}
