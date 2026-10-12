import { Link } from "wouter";
import Placeholder from "../components/Placeholder";
import { LEASING_SECTORS, teamPagesFor, type Person } from "../lib/content";
import { useSiteContent } from "../lib/site-content";
import { useTeamPhoto } from "../lib/team-photos";

function Avatar({ person }: { person: Person }) {
  const photo = useTeamPhoto(person);
  if (!photo) return null;
  return <img src={photo} alt="" className="h-9 w-9 rounded-full object-cover grayscale shrink-0 self-center" />;
}

export default function Team() {
  const { team } = useSiteContent();
  const sorted = [...team].sort((a, b) => {
    const surname = (n: string) => n.split(" ").slice(-1)[0];
    return surname(a.name).localeCompare(surname(b.name));
  });

  return (
    <div>
      <section className="relative">
        <Placeholder className="h-80 md:h-[28rem] w-full" src="/images/office.jpg" alt="The BGP office" />
        <div className="absolute inset-0 bg-gradient-to-t from-bgp-ink/85 via-bgp-ink/45 to-bgp-ink/15 md:from-bgp-ink/70 md:via-bgp-ink/10 md:to-transparent" />
        <div className="absolute inset-0 flex items-end">
          <div className="mx-auto max-w-6xl px-4 pb-10 w-full">
            <p className="max-w-xl text-3xl md:text-4xl leading-snug font-display italic text-white" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.7), 0 2px 18px rgba(0,0,0,0.55)" }}>
              Connecting leading brands with the best international locations. Creating
              neighbourhoods that people love.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-10">
        <span className="section-label">Our teams</span>
        <div className="flex flex-wrap gap-2">
          {[
            ...LEASING_SECTORS.map((x) => ({ label: x.name, href: `/leasing/sectors/${x.slug}` })),
            { label: "Investment", href: "/investment" },
            { label: "Brand Representation", href: "/brand-representation" },
            { label: "Lease Advisory", href: "/lease-advisory" },
            { label: "Consultancy", href: "/consultancy" },
          ].map((t) => (
            <Link key={t.href} href={t.href} className="label-caps border border-bgp-wine/40 text-bgp-wine rounded-full px-4 py-2 hover:bg-bgp-wine hover:text-bgp-cream transition-colors">
              {t.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 md:py-16">
        <span className="section-label">The team</span>
        <h1 className="display text-4xl md:text-5xl mb-10">A–Z contact details</h1>
        <div className="border-t border-bgp-wine/30">
          {sorted.map((p) => (
            <div
              key={p.name}
              className="group grid grid-cols-1 md:grid-cols-[2.2fr_2fr_1.4fr_2.2fr] gap-x-6 gap-y-0.5 py-4 border-b border-bgp-line items-baseline"
            >
              <p className="font-display text-xl text-bgp-wine flex items-center gap-3">
                <Avatar person={p} />
                {teamPagesFor(p.name)[0] ? (
                  <Link href={teamPagesFor(p.name)[0].href} className="hover:text-bgp-red transition-colors">{p.name}</Link>
                ) : p.name}
              </p>
              <p className="text-base text-bgp-ink/75">
                {p.title}
                {teamPagesFor(p.name).length > 0 && (
                  <span className="block mt-1 flex flex-wrap gap-x-3">
                    {teamPagesFor(p.name).map((t) => (
                      <Link key={t.href} href={t.href} className="label-caps text-bgp-red hover:text-bgp-wine">{t.label} ↗</Link>
                    ))}
                  </span>
                )}
              </p>
              <p className="text-base tabular text-bgp-ink/85">{p.phone}</p>
              {p.email !== "TBC" && (
                <p className="text-base break-all">
                  <a href={`mailto:${p.email}`} className="hover:text-bgp-red transition-colors">{p.email}</a>
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
