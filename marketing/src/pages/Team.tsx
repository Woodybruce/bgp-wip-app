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
  // Grouped by team rather than A–Z (Woody, 2026-10-12). A person's team is
  // what their title says; failing that, the first page they belong to; leadership and
  // operations bookend the list. Within a team, directors first, then A–Z.
  const surname = (n: string) => n.split(" ").slice(-1)[0];
  const rank = (p: Person) => (/managing director|chief operating|equity director/i.test(p.title) ? 0 : /\bdirector\b|\bhead\b/i.test(p.title) && !/associate/i.test(p.title) ? 1 : /associate director/i.test(p.title) ? 2 : 3);
  const groupOf = (p: Person): string => {
    if (/managing director|chief operating officer|\bcoo\b/i.test(p.title)) return "Leadership";
    for (const [re, label] of [[/shopping centre/i, "Shopping Centres"], [/london estate/i, "London Estates"], [/\bcity\b/i, "The City"], [/high street/i, "High Streets"], [/investment/i, "Investment"], [/brand rep/i, "Brand Representation"], [/lease advisory|asset management/i, "Lease Advisory"], [/consultan/i, "Consultancy"]] as Array<[RegExp, string]>) {
      if (re.test(p.title)) return label;
    }
    const first = teamPagesFor(p.name)[0];
    if (first) return first.label;
    return "Operations";
  };
  const KNOWN = ["Leadership", "Leasing", ...LEASING_SECTORS.map((x) => x.name), "Investment", "Brand Representation", "Lease Advisory", "Consultancy", "Operations"];
  const ORDER = [...KNOWN, ...Array.from(new Set(team.map(groupOf))).filter((l) => !KNOWN.includes(l))];
  const HREF: Record<string, string> = Object.fromEntries([
    ["Leasing", "/leasing"],
    ...LEASING_SECTORS.map((x) => [x.name, `/leasing/sectors/${x.slug}`]),
    ["Investment", "/investment"], ["Brand Representation", "/brand-representation"], ["Lease Advisory", "/lease-advisory"], ["Consultancy", "/consultancy"],
  ]);
  const groups = ORDER.map((label) => ({
    label,
    href: HREF[label],
    people: team.filter((p) => groupOf(p) === label).sort((a, b) => rank(a) - rank(b) || surname(a.name).localeCompare(surname(b.name))),
  })).filter((g) => g.people.length > 0);

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

      <section className="mx-auto max-w-6xl px-4 py-14 md:py-16">
        <h1 className="sr-only">The BGP team</h1>
        {groups.map((g) => (
          <div key={g.label} className="mb-14">
            <div className="flex items-baseline justify-between border-b border-bgp-ink pb-2 mb-2">
              <h2 className="display text-2xl md:text-3xl">
                {g.href ? <Link href={g.href} className="hover:text-bgp-red transition-colors">{g.label}</Link> : g.label}
              </h2>
              <span className="label-caps text-bgp-ink/45 tabular">{g.people.length}</span>
            </div>
            {g.people.map((p) => (
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
                <p className="text-base text-bgp-ink/75">{p.title}</p>
                <p className="text-base tabular text-bgp-ink/85">{p.phone}</p>
                {p.email !== "TBC" && (
                  <p className="text-base break-all">
                    <a href={`mailto:${p.email}`} className="hover:text-bgp-red transition-colors">{p.email}</a>
                  </p>
                )}
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
