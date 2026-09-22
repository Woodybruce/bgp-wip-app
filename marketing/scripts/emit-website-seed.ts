// One-off / repeatable: export the bundled site content as the seed the
// dashboard loads into its website_* tables when they are empty. Run with
// `npm run website-seed` from marketing/; commits to server/assets/.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTICLES,
  BRAND_REP_CONTACTS,
  CASE_STUDIES,
  CONSULTANCY_CONTACTS,
  INVESTMENT_CONTACTS,
  LEASE_ADVISORY_CONTACTS,
  LEASING_CONTACTS,
  TEAM,
} from "../src/lib/content";

const SITE = "https://www.bgp.uk.com";
const abs = (p?: string | null) => (p ? `${SITE}${p}` : null);
const GROUPS: Array<[string, { name: string }[]]> = [
  ["leasing", LEASING_CONTACTS],
  ["investment", INVESTMENT_CONTACTS],
  ["lease_advisory", LEASE_ADVISORY_CONTACTS],
  ["brand_representation", BRAND_REP_CONTACTS],
  ["consultancy", CONSULTANCY_CONTACTS],
];

const seed = {
  team: TEAM.map((p, i) => ({
    name: p.name,
    title: p.title,
    phone: p.phone,
    email: p.email === "TBC" ? null : p.email,
    photoUrl: abs(p.photo),
    groups: GROUPS.filter(([, list]) => list.some((c) => c.name === p.name)).map(([g]) => g),
    sortOrder: i,
    visible: true,
  })),
  caseStudies: CASE_STUDIES.map((c, i) => ({
    slug: c.slug,
    title: c.title,
    service: c.service,
    blurb: c.blurb,
    body: c.body,
    facts: c.facts,
    imageUrl: abs(c.image),
    sortOrder: i,
    published: true,
  })),
  news: ARTICLES.map((a, i) => ({
    slug: a.slug,
    title: a.title,
    category: a.category,
    date: a.date,
    author: a.author,
    standfirst: a.standfirst,
    body: a.body,
    imageUrl: abs(a.image),
    sortOrder: i,
    published: !a.isSample,
  })),
};

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../../server/assets/website-seed.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(seed, null, 2));
console.log(`website-seed.json → ${target} (${seed.team.length} people, ${seed.caseStudies.length} case studies, ${seed.news.length} articles)`);
