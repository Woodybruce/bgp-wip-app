import { Link } from "wouter";
import Placeholder from "../components/Placeholder";
import { LEASING_SECTORS, cardUrlFor, teamPagesFor, type Person } from "../lib/content";
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
  // Seniority order within a team (Charlotte, 2026-10-13), then surname.
  const rank = (p: Person) => {
    const t = p.title;
    if (/managing director|chief operat|equity director|founding director/i.test(t)) return 0;
    if ((/\bdirector\b|\bhead\b/i.test(t)) && !/associate/i.test(t)) return 1;
    if (/associate director/i.test(t)) return 2;
    if (/\bassociate\b|consultant/i.test(t)) return 3;
    if (/senior surveyor/i.test(t)) return 4;
    if (/graduate/i.test(t)) return 6;
    if (/surveyor/i.test(t)) return 5;
    return 7;
  };
  const HR_TEAM: Record<string, string> = { "Shopping Centre": "Shopping Centres", "London Estate": "London Estates", "City": "The City", "High Street": "High Streets", "Investment": "Investment", "Tenant Rep": "Brand Representation", "Lease Advisory": "Lease Advisory" };
  const groupOf = (p: Person): string => {
    if (/managing director|chief operat|\bcoo\b/i.test(p.title)) return "Leadership";
    if (p.team && HR_TEAM[p.team]) return HR_TEAM[p.team];
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
      <Placeholder className="h-64 md:h-[22rem] w-full" src="/images/office.jpg" alt="The BGP office" />
      <section className="mx-auto max-w-3xl px-4 pt-12 pb-4 text-center">
        <h1 className="display text-4xl md:text-5xl">The BGP team</h1>
        <p className="mt-5 font-light text-xl md:text-2xl text-bgp-wine">
          Connecting leading brands with the best international locations. Creating
          neighbourhoods that people love.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 md:py-16">
        {groups.map((g) => (
          <div key={g.label} className="mb-14">
            <div className="flex items-baseline justify-between border-b border-bgp-ink pb-2 mb-2">
              <h2 className="display text-2xl md:text-3xl">
                {g.href ? <Link href={g.href} className="hover:text-bgp-wine transition-colors">{g.label}</Link> : g.label}
              </h2>
              <span className="label-caps text-bgp-ink/45 tabular">{g.people.length}</span>
            </div>
            {g.people.map((p) => (
              <div
                key={p.name}
                className="group grid grid-cols-1 md:grid-cols-[2.2fr_2fr_1.4fr_2.2fr] gap-x-6 gap-y-0.5 py-4 border-b border-bgp-line items-baseline"
              >
                <p className="font-normal text-lg text-bgp-wine flex items-center gap-3">
                  <Avatar person={p} />
                  <a href={cardUrlFor(p.name)} className="hover:text-bgp-wine transition-colors" title="Business card">{p.name}</a>
                </p>
                <p className="text-base text-bgp-ink/75">{p.title}</p>
                <p className="text-base tabular text-bgp-ink/85">{p.phone}</p>
                {p.email !== "TBC" && (
                  <p className="text-base break-all">
                    <a href={`mailto:${p.email}`} className="hover:text-bgp-wine transition-colors">{p.email}</a>
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
