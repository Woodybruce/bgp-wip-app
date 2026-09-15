import { useEffect, useState } from "react";
import {
  ARTICLES,
  BRAND_REP_CONTACTS,
  CASE_STUDIES,
  CONSULTANCY_CONTACTS,
  INVESTMENT_CONTACTS,
  LEASE_ADVISORY_CONTACTS,
  LEASING_CONTACTS,
  OFFICE_PHONE,
  TEAM,
  type Article,
  type CaseStudy,
  type Person,
} from "./content";

// Team, case studies and news are edited in the BGP dashboard (Website page
// / ChatBGP) and served from chatbgp.app. The bundled copy in content.ts
// renders instantly and stays as the fallback if the API is unreachable.
const API_BASE = (import.meta.env.VITE_BGP_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export type ContactGroup = "leasing" | "investment" | "lease_advisory" | "brand_representation" | "consultancy";

export interface SiteContent {
  team: Person[];
  caseStudies: CaseStudy[];
  articles: Article[];
  contacts: Record<ContactGroup, Person[]>;
  live: boolean;
}

const BUNDLED: SiteContent = {
  team: TEAM,
  caseStudies: CASE_STUDIES,
  articles: ARTICLES,
  contacts: {
    leasing: LEASING_CONTACTS,
    investment: INVESTMENT_CONTACTS,
    lease_advisory: LEASE_ADVISORY_CONTACTS,
    brand_representation: BRAND_REP_CONTACTS,
    consultancy: CONSULTANCY_CONTACTS,
  },
  live: false,
};

function fromApi(j: any): SiteContent {
  const team: Array<Person & { groups: string[] }> = (j.team || []).map((r: any) => ({
    name: r.name,
    title: r.title,
    phone: r.phone || OFFICE_PHONE,
    email: r.email || "",
    photo: r.photoUrl || undefined,
    groups: r.groups || [],
  }));
  const byGroup = (g: ContactGroup): Person[] => team.filter((p) => p.groups.includes(g)).map(({ groups, ...p }) => p);
  return {
    team: team.map(({ groups, ...p }) => p),
    caseStudies: (j.caseStudies || []).map((r: any) => ({
      slug: r.slug,
      title: r.title,
      service: r.service,
      blurb: r.blurb,
      image: r.imageUrl || undefined,
      facts: Array.isArray(r.facts) ? r.facts : [],
      body: r.body || [],
    })),
    articles: (j.news || []).map((r: any) => ({
      slug: r.slug,
      title: r.title,
      category: r.category || "News",
      date: r.date || "",
      author: r.author || "BGP",
      standfirst: r.standfirst || "",
      body: r.body ?? null,
      image: r.imageUrl || undefined,
    })),
    contacts: {
      leasing: byGroup("leasing"),
      investment: byGroup("investment"),
      lease_advisory: byGroup("lease_advisory"),
      brand_representation: byGroup("brand_representation"),
      consultancy: byGroup("consultancy"),
    },
    live: true,
  };
}

let cached: SiteContent | null = null;
let inflight: Promise<SiteContent> | null = null;
function load(): Promise<SiteContent> {
  if (cached) return Promise.resolve(cached);
  if (!API_BASE) return Promise.resolve((cached = BUNDLED));
  if (!inflight) {
    inflight = fetch(`${API_BASE}/api/public/website/all`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        const c = fromApi(j);
        // An empty group would blank a Key contacts panel — keep the bundled list.
        for (const g of Object.keys(c.contacts) as ContactGroup[]) if (!c.contacts[g].length) c.contacts[g] = BUNDLED.contacts[g];
        if (!c.team.length) c.team = BUNDLED.team;
        if (!c.caseStudies.length) c.caseStudies = BUNDLED.caseStudies;
        if (!c.articles.length) c.articles = BUNDLED.articles;
        return (cached = c);
      })
      .catch(() => (cached = BUNDLED));
  }
  return inflight;
}

export function useSiteContent(): SiteContent {
  const [content, setContent] = useState<SiteContent>(cached ?? BUNDLED);
  useEffect(() => {
    if (cached) { setContent(cached); return; }
    let alive = true;
    load().then((c) => { if (alive) setContent(c); });
    return () => { alive = false; };
  }, []);
  return content;
}

export const findCaseStudy = (c: SiteContent, slug: string): CaseStudy =>
  c.caseStudies.find((x) => x.slug === slug) ?? CASE_STUDIES.find((x) => x.slug === slug) ?? c.caseStudies[0];
