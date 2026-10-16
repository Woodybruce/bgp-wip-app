import { Link, useRoute } from "wouter";
import KeyContacts from "../components/KeyContacts";
import Placeholder from "../components/Placeholder";
import CaseStudyStrip from "../components/CaseStudyStrip";
import { MapSlot, SectionHead } from "../components/Wire";
import { LEASING_SECTORS, SHOPPING_CENTRES, isDirectorLevel, type Person } from "../lib/content";
import { findCaseStudy, useSiteContent } from "../lib/site-content";

export const peopleNamed = (team: Person[], names: string[]): Person[] =>
  names.map((n) => team.find((p) => p.name === n)).filter((p): p is Person => !!p && isDirectorLevel(p));

function NotFound() {
  return (
    <div className="mx-auto max-w-[1360px] px-4 py-32 text-center">
      <p className="label-caps text-bgp-burgundy">Page not found</p>
      <p className="mt-4">
        <Link href="/leasing" className="explore-link inline-block">Back to Leasing</Link>
      </p>
    </div>
  );
}

// Stock stand-ins for shopping centres without their own photo yet.
const CENTRE_STOCK = ["/images/food-hall.jpg", "/images/shop-browse.jpg", "/images/cafe.jpg", "/images/shop-menswear.jpg"];

export default function LeasingSector() {
  const [, params] = useRoute("/leasing/sectors/:slug");
  const content = useSiteContent();
  const { team } = content;
  const sector = LEASING_SECTORS.find((s) => s.slug === params?.slug);
  if (!sector) return <NotFound />;
  const contacts = peopleNamed(team, sector.contacts);
  // Photographed centres lead the grid so the image tiles sit together.
  const centres = sector.slug === "shopping-centres" ? [...SHOPPING_CENTRES].sort((a, b) => a.name.localeCompare(b.name)) : [];

  return (
    <div>
      {/* Wireframe slide 28: plain photo, then the title with Contact and
          Download at right, the statement beside the title, description
          beside the lead image, more photos, a location map. */}
      <Placeholder className="h-64 md:h-auto md:aspect-[2.96] w-full" src={sector.image} alt={sector.name} />

      <section className="mx-auto max-w-[1360px] px-4 py-7 md:py-8">
        <p className="label-caps text-bgp-ink/50 mb-4"><Link href="/leasing" className="hover:text-bgp-wine">Leasing</Link> · {sector.name}</p>
        {/* Slide 28: title row with Contact and Download at right; the statement on the next row in the right column;
            a narrow text column beside a wide image; then a landscape and a lower, portrait image. */}
        <div className="flex items-start justify-between gap-8">
          <h1 className="font-normal text-3xl md:text-5xl">{sector.name}</h1>
          <span className="flex flex-col items-end gap-1 shrink-0 label-caps text-bgp-wine">
            <a href="#contact" className="hover:opacity-70">Contact</a>
            <a href="#contact" className="hover:opacity-70">Download</a>
          </span>
        </div>
        {!sector.howWeHelp && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-[27fr_61fr] md:gap-x-[12%]">
            <div />
            <p className="font-normal text-xl md:text-2xl text-bgp-ink">{sector.headline}</p>
          </div>
        )}
        {sector.howWeHelp && <p className="mt-4 font-normal text-xl md:text-2xl text-bgp-ink md:w-[60%] md:ml-auto">{sector.headline}</p>}
        <div className={`mt-8 grid grid-cols-1 gap-10 items-start ${sector.howWeHelp ? "md:grid-cols-[1fr_280px]" : "md:grid-cols-[30fr_64fr] md:gap-x-[6%]"}`}>
          <div className="space-y-4">
            {sector.body.map((p, i) => (
              <p key={p.slice(0, 24)} className="text-base text-bgp-ink">{p}</p>
            ))}
          </div>
          {!sector.howWeHelp && (
            <figure className="img-frame">
              <Placeholder className="aspect-[1.61] w-full" src={sector.gallery?.[0]?.src} alt={sector.gallery?.[0]?.caption ?? sector.name} />
              {sector.gallery?.[0] && <figcaption className="mt-2 label-caps text-bgp-ink/55">{sector.gallery[0].caption}</figcaption>}
            </figure>
          )}
          {sector.howWeHelp && (
            <div className="bg-bgp-mist p-8 self-start">
              <p className="label-caps border-b border-bgp-ink pb-2 mb-6">How we can help</p>
              <ul className="space-y-4">
                {sector.howWeHelp.map((s) => (
                  <li key={s} className="text-sm text-bgp-ink/70 border-b border-bgp-line pb-4">{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {!sector.howWeHelp && (
        <section className="mx-auto max-w-[1360px] px-4 pb-9">
          <div className="grid grid-cols-1 md:grid-cols-[57fr_12fr_31fr] gap-6 md:gap-0 items-start">
            <figure>
              <div className="img-frame"><Placeholder className="aspect-[1.69] w-full" src={sector.gallery?.[1]?.src} alt={sector.gallery?.[1]?.caption ?? sector.name} /></div>
              {sector.gallery?.[1] && <figcaption className="mt-2 label-caps text-bgp-ink/55">{sector.gallery[1].caption}</figcaption>}
            </figure>
            <div />
            <figure className="md:mt-40">
              <div className="img-frame"><Placeholder className="aspect-[0.77] w-full" src={sector.gallery?.[2]?.src} alt={sector.gallery?.[2]?.caption ?? sector.name} /></div>
              {sector.gallery?.[2] && <figcaption className="mt-2 label-caps text-bgp-ink/55">{sector.gallery[2].caption}</figcaption>}
            </figure>
          </div>
        </section>
      )}
      {sector.howWeHelp && sector.gallery && sector.gallery.length > 1 && (
        <section className="mx-auto max-w-[1360px] px-4 pb-9">
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
        <section className="mx-auto max-w-[1360px] px-4 pb-9">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-bgp-wine/25 pb-6 mb-10">
            <div>
              <span className="section-label">Leasing teams</span>
              <h2 className="display text-3xl md:text-4xl">Our shopping centres</h2>
            </div>
            <p className="text-base text-bgp-ink/70">
              {centres.length} centres across the UK, from London to Glasgow.
            </p>
          </div>
          <div className="card-strip sm:grid-cols-2 lg:grid-cols-3 sm:gap-x-6 sm:gap-y-8">
            {centres.map((c, i) => {
              // Every tile carries a photo; a centre without one shows a
              // tagged stock stand-in so the grid stays even (Woody, 2026-10-16).
              const inner = (
                <>
                  <div className="img-frame">
                    <Placeholder className="aspect-[4/3] w-full" src={c.image} alt={c.name} stock={CENTRE_STOCK[i % CENTRE_STOCK.length]} />
                  </div>
                  <div className="border-t border-bgp-wine/30 pt-3 mt-3">
                    <p className="font-normal text-lg text-bgp-wine">{c.name}</p>
                    <p className="mt-0.5 label-caps text-bgp-ink/45">{c.location}</p>
                    <p className="mt-2 text-base text-bgp-ink">{c.blurb}</p>
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

      <section className="mx-auto max-w-[1360px] px-4 pb-9">
        <SectionHead title="Location" />
        <MapSlot lat={sector.map?.lat} lon={sector.map?.lon} zoom={sector.map?.zoom} marker={false} pins={sector.map?.pins} className="aspect-[3.38] w-full" />
      </section>

      <KeyContacts band={false} people={contacts} />
      <CaseStudyStrip band caseStudies={(sector.caseStudies ?? []).map((slug) => findCaseStudy(content, slug)).filter(Boolean) as any} />
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
      <section className="mx-auto max-w-[1360px] px-4 py-7">
        <p className="label-caps border-b border-bgp-ink pb-2 text-bgp-ink/50">
          <Link href="/leasing" className="hover:text-bgp-wine">Leasing</Link> ·{" "}
          <Link href="/leasing/sectors/shopping-centres" className="hover:text-bgp-wine">Shopping Centres</Link> · {centre.location}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-10 mt-8">
          <div>
            <h1 className="font-normal text-3xl md:text-5xl">{centre.name}</h1>
            <div className="img-frame mt-6">
              <Placeholder className="aspect-[16/9] w-full" src={centre.image} alt={centre.name} stock={CENTRE_STOCK[0]} />
            </div>
            <p className="mt-6 text-base md:text-lg text-bgp-ink">{centre.blurb}</p>
            {/* Generic second paragraph, the same on every centre: italic until the team writes each one. */}
            <p className="mt-4 text-base md:text-lg text-bgp-ink italic">
              BGP advises the owners of {centre.name} on leasing strategy, tenant mix and positioning, drawing on our relationships with leading occupiers and our London Estates and High Street teams.
            </p>
            <div className="card-strip sm:grid-cols-3 mt-8">
              {(centre.gallery ?? [1, 2, 3].map((k) => ({ src: undefined as string | undefined, caption: `Photo ${k} to follow`, stock: CENTRE_STOCK[k % CENTRE_STOCK.length] }))).map((g: { src?: string; caption: string; stock?: string }) => (
                <figure key={g.caption}>
                  <div className="img-frame"><Placeholder className="aspect-[4/3] w-full" src={g.src} alt={g.caption} stock={g.stock} /></div>
                  <figcaption className={`mt-2 label-caps text-bgp-ink/55 ${g.src ? "" : "italic"}`}>{g.caption}</figcaption>
                </figure>
              ))}
            </div>
          </div>
          <aside className="border-t border-bgp-ink pt-3 self-start">
            {[["Location", centre.location], ["Primary contacts", centre.contacts.join(", ")]].map(([k, v]) => (
              <div key={k} className="border-b border-bgp-line py-3">
                <p className="label-caps text-bgp-ink/50">{k}</p>
                <p className="mt-1 text-sm">{v}</p>
              </div>
            ))}
            <a href="#contact" className="btn mt-6 block">Talk to us</a>
          </aside>
        </div>
      </section>
      {contacts.length > 0 && <KeyContacts band={false} people={contacts} />}
    </div>
  );
}
