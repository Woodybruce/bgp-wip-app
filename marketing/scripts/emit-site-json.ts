// Build step: publish the site's content as machine-readable JSON at
// /site.json. The site is a JavaScript app, so a plain fetch of any page
// returns only the <title>; ChatBGP (and anything else that can't run a
// browser) reads this file instead. Run before `vite build` so the file
// lands in public/ and ships with the bundle.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRAND_REP_CONTACTS,
  CASE_STUDIES,
  CONSULTANCY_CONTACTS,
  CONTACT,
  HERO_STATEMENT,
  HOME_INTRO,
  INVESTMENT_CONTACTS,
  LEASE_ADVISORY_CONTACTS,
  LEASING_CONTACTS,
  NAV_ITEMS,
  SERVICES,
  TEAM,
} from "../src/lib/content";

const SITE = "https://www.bgp.uk.com";
const API = "https://chatbgp.app";
const abs = (p?: string) => (p ? `${SITE}${p}` : undefined);

const person = (p: (typeof TEAM)[number]) => ({
  name: p.name,
  title: p.title,
  phone: p.phone,
  email: p.email,
  photo: abs(p.photo) ?? null,
});

const out = {
  generatedAt: new Date().toISOString(),
  site: SITE,
  note: "Content of bgp.uk.com. Pages are rendered client-side; use this file rather than fetching HTML. Live availability comes from listingsFeed.",
  heroStatement: HERO_STATEMENT,
  intro: HOME_INTRO,
  nav: NAV_ITEMS.map((n) => ({ label: n.label, url: `${SITE}${n.href}` })),
  services: SERVICES.map((s) => ({ name: s.name, url: `${SITE}/${s.slug}`, intro: s.intro, image: abs(s.image) })),
  team: TEAM.map(person),
  keyContacts: {
    leasing: LEASING_CONTACTS.map((p) => p.name),
    investment: INVESTMENT_CONTACTS.map((p) => p.name),
    leaseAdvisory: LEASE_ADVISORY_CONTACTS.map((p) => p.name),
    brandRepresentation: BRAND_REP_CONTACTS.map((p) => p.name),
    consultancy: CONSULTANCY_CONTACTS.map((p) => p.name),
  },
  caseStudies: CASE_STUDIES.map((c) => ({
    title: c.title,
    service: c.service,
    url: `${SITE}/case-studies/${c.slug}`,
    blurb: c.blurb,
    facts: Object.fromEntries(c.facts),
    image: abs(c.image) ?? null,
  })),
  contact: CONTACT,
  listingsFeed: `${API}/api/public/leasing-listings`,
  teamPhotosFeed: `${API}/api/public/team-photos`,
};

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../public/site.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(out, null, 2));
console.log(`site.json → ${target} (${out.team.length} people, ${out.caseStudies.length} case studies)`);
