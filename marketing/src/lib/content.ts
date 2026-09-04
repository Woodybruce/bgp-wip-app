// Site copy. Sourced from the current brucegillinghampollard.com site, the
// dashboard team directory, and the December 2025 wireframe deck. Anything
// still marked [Sample] or TBC needs real content before launch.

export const SERVICES = [
  {
    slug: "leasing",
    name: "Leasing",
    image: "/images/stills-preview-regent-street.jpg",
    intro:
      "Creating neighbourhoods that people love. Retail, restaurant and leisure leasing across London's leading estates and the UK's landmark destinations — acting for landlords including The Portman Estate, Grosvenor, The Crown Estate and Landsec.",
  },
  {
    slug: "investment",
    name: "Investment",
    image: "/images/stills-preview-city-night.jpg",
    intro:
      "Acquisition and disposal advice across retail, leisure and mixed-use investments — from single assets to portfolios, acting for private clients, property companies and institutions including Aviva Investors, Legal & General and LondonMetric.",
  },
  {
    slug: "brand-representation",
    name: "Brand Representation",
    image: "/images/fred-perry-camden.jpg",
    intro:
      "Brand led retail estate advisory. Providing strategic support and market analysis for brand expansion across multi sector clients — acquiring space for brands to thrive in.",
  },
  {
    slug: "lease-advisory",
    name: "Lease Advisory",
    image: "/images/st-christophers-place.jpg",
    intro:
      "Lease Advisory is a core discipline within BGP's asset management offer, providing landlords and tenants with clear, evidence-led advice across rent reviews, re-gears and lease restructuring.",
  },
  {
    slug: "consultancy",
    name: "Consultancy",
    image: "/images/55-bishopsgate.jpg",
    intro:
      "Placemaking is central to our business philosophy. As such, we've evolved from traditional leasing to offering clients bespoke reporting, long-term consultancy, and strategic asset management services.",
  },
] as const;

export const NAV_ITEMS = [
  { label: "Leasing", href: "/leasing" },
  { label: "Investment", href: "/investment" },
  { label: "Brand Representation", href: "/brand-representation" },
  { label: "Lease Advisory", href: "/lease-advisory" },
  { label: "Consultancy", href: "/consultancy" },
  { label: "Team", href: "/team" },
] as const;

export const HERO_STATEMENT = "Great places are built through connected thinking.";

// From Rebrand_Copy — Website: Homepage
export const HOME_INTRO = {
  lead: "We are bgp.",
  body: [
    "As the UK's largest independent retail and leisure property consultancy, we bring together specialists across our Leasing, Brand Representation, Lease Advisory and Investment teams to create strategies that unlock value.",
    "Specialist expertise is at the heart of BGP; but it's our collaborative approach that sets us apart. By bringing together insight from across our teams, we provide considered, commercially focused advice that shapes successful places, stronger portfolios and lasting relationships.",
  ],
  servicesHeading: "Expertise across every stage of the property lifecycle.",
};

export const TESTIMONIAL = {
  quote:
    "With so many years' experience, they are no longer thought of as agents, more as part of our team.",
  name: "Camille Waxer",
  title: "Client",
};

// Figures from brucegillinghampollard.com; "15 years" per Adieu 2025 (founded 2011).
export const STATS = [
  { value: "7m", caption: "sq ft of assets our leasing team advises on" },
  { value: "244", caption: "leasing transactions completed" },
  { value: "66", caption: "brands advised in the UK and abroad" },
  { value: "15", caption: "years of BGP — est. 2011" },
] as const;

export interface Person {
  name: string;
  title: string;
  phone: string;
  email: string;
  photo?: string;
}

export const OFFICE_PHONE = "+44 (0)20 3551 5260";

// Titles and contact details from the BGP team directory / public site.
export const TEAM: Person[] = [
  { name: "Woody Bruce", title: "Managing Director", phone: "+44 (0)7980 313 675", email: "woody@brucegillinghampollard.com" },
  { name: "Tracey Pollard", title: "Founding Director", phone: "+44 (0)7779 323 306", email: "tracey@brucegillinghampollard.com" },
  { photo: "/images/team/charlotte-roberts.jpg", name: "Charlotte Roberts", title: "Equity Director, Co-Head London Estates", phone: "+44 (0)7738 448 338", email: "charlotte@brucegillinghampollard.com" },
  { name: "Rupert Bentley-Smith", title: "Equity Director, Co-Head London Estates", phone: "+44 (0)7876 354 160", email: "rupert@brucegillinghampollard.com" },
  { photo: "/images/team/jack-barratt.jpg", name: "Jack Barratt", title: "Equity Director, Head of Investment", phone: "+44 (0)7788 215 044", email: "jack@brucegillinghampollard.com" },
  { name: "Victoria Broadhead", title: "Head of National", phone: "+44 (0)7793 158 133", email: "victoria@brucegillinghampollard.com" },
  { photo: "/images/team/peter-wood.jpg", name: "Peter Wood", title: "Head of Lease Consultancy and Asset Management", phone: "+44 (0)7872 602 336", email: "peter@brucegillinghampollard.com" },
  { photo: "/images/team/nick-halley.jpg", name: "Nick Halley", title: "Director, Investment", phone: "+44 (0)7766 042 736", email: "nick@brucegillinghampollard.com" },
  { name: "Lucy Gardiner", title: "Director, National Leasing", phone: "+44 (0)7741 877 452", email: "lucyg@brucegillinghampollard.com" },
  { name: "Lizzie Knights", title: "Director, London Leasing", phone: "+44 (0)7511 902 073", email: "lizzie@brucegillinghampollard.com" },
  { photo: "/images/team/harry-elliott.jpg", name: "Harry Elliott", title: "Director, Brand Representation", phone: "+44 (0)7568 367 777", email: "harrye@brucegillinghampollard.com" },
  { photo: "/images/team/emily-dumbell.jpg", name: "Emily Dumbell", title: "Director, National Leasing", phone: "+44 (0)7805 259 793", email: "emily@brucegillinghampollard.com" },
  { name: "Nick Goodman", title: "Consultant, Investment", phone: "+44 (0)7818 012 432", email: "nickgoodman@brucegillinghampollard.com" },
  { photo: "/images/team/tom-cater.jpg", name: "Tom Cater", title: "Associate Director, Lease Advisory", phone: "+44 (0)7947 484 902", email: "tom@brucegillinghampollard.com" },
  { name: "Lucy Cope", title: "Associate Director, London Leasing", phone: "+44 (0)7595 267 866", email: "lucy@brucegillinghampollard.com" },
  { photo: "/images/team/evie-north.jpg", name: "Evie North", title: "Associate Director, Brand Representation", phone: "+44 (0)7595 349 057", email: "evie@brucegillinghampollard.com" },
  { photo: "/images/team/alex-todd.jpg", name: "Alex Todd", title: "Senior Surveyor, Development", phone: "+44 (0)7526 504 806", email: "alext@brucegillinghampollard.com" },
  { name: "Millie Edwards", title: "Leasing", phone: OFFICE_PHONE, email: "TBC" },
  { photo: "/images/team/emily-cann.jpg", name: "Emily Cann", title: "Graduate Surveyor, London Leasing", phone: "+44 (0)7516 660 791", email: "emilyc@brucegillinghampollard.com" },
  { name: "Will Penfold", title: "Graduate Surveyor, London Leasing", phone: "+44 (0)7760 881 270", email: "willp@brucegillinghampollard.com" },
  { photo: "/images/team/luke-donohoe.jpg", name: "Luke Donohoe", title: "Graduate Surveyor, National Leasing", phone: "+44 (0)7983 855 926", email: "luke@brucegillinghampollard.com" },
  { photo: "/images/team/libby-evans.jpg", name: "Libby Evans", title: "Graduate Surveyor, Development", phone: "+44 (0)7931 462 768", email: "libbye@brucegillinghampollard.com" },
  { photo: "/images/team/jonny-palmer.jpg", name: "Jonny Palmer", title: "Graduate, Investment", phone: "+44 (0)7506 439 429", email: "jonny@brucegillinghampollard.com" },
  { name: "Harriette Walker-Clark", title: "PA & Office Manager", phone: OFFICE_PHONE, email: "harriette@brucegillinghampollard.com" },
  { name: "Layla O'Driscoll", title: "PA & Office Manager", phone: OFFICE_PHONE, email: "layla@brucegillinghampollard.com" },
  { photo: "/images/team/cara-milligan.jpg", name: "Cara Milligan", title: "PA — National", phone: OFFICE_PHONE, email: "cara@brucegillinghampollard.com" },
];

const byName = (...names: string[]) => TEAM.filter((p) => names.includes(p.name));

export const LEASING_CONTACTS = byName(
  "Charlotte Roberts",
  "Rupert Bentley-Smith",
  "Victoria Broadhead",
  "Lizzie Knights",
  "Emily Dumbell",
  "Lucy Cope",
);

export const INVESTMENT_CONTACTS = byName(
  "Jack Barratt",
  "Nick Halley",
  "Jonny Palmer",
);

export const LEASE_ADVISORY_CONTACTS = byName("Peter Wood", "Tom Cater");

export const BRAND_REP_CONTACTS = byName("Harry Elliott", "Evie North");

export const CONSULTANCY_CONTACTS = byName("Tracey Pollard", "Alex Todd", "Libby Evans");

export interface CaseStudy {
  slug: string;
  title: string;
  service: string;
  blurb: string;
  image?: string;
  facts: Array<[string, string]>;
  body: string[];
}

// From the projects list on the current site; bodies marked [Sample] need
// fuller copy from the relevant team.
export const CASE_STUDIES: CaseStudy[] = [
  {
    slug: "lucent-piccadilly",
    title: "Lucent, Piccadilly Lights",
    service: "Leasing",
    image: "/images/stills-preview-piccadilly.jpg",
    blurb:
      "Restaurant leasing for Landsec at Lucent W1 — the landmark development behind the world-famous Piccadilly Lights.",
    facts: [
      ["Service", "Leasing"],
      ["Client", "Landsec"],
      ["Scheme", "Lucent W1 — 144,000 sq ft"],
      ["Sector", "Restaurant & leisure"],
      ["Location", "Piccadilly Circus, W1"],
    ],
    body: [
      "Lucent is Landsec's 144,000 sq ft development behind the Piccadilly Lights — office, retail and restaurant space on one of the most famous corners in the world, completed in 2023.",
      "BGP advised Landsec on the food & beverage leasing of the scheme, shaping the restaurant strategy and securing occupiers for space that sits directly behind the Lights, with some of the highest footfall in the West End.",
      "Photograph: Thomas Dahlstrøm Nielsen, CC BY-SA 4.0.",
    ],
  },
  {
    slug: "20-hanover-square",
    title: "20 Hanover Square",
    service: "Leasing",
    image: "/images/hanover-square.jpg",
    blurb:
      "A 10,000 sq ft Mayfair restaurant opportunity for Great Portland Estates — one of the West End's landmark restaurant lettings.",
    facts: [
      ["Service", "Leasing"],
      ["Client", "Great Portland Estates"],
      ["Size", "10,000 sq ft"],
      ["Sector", "Restaurant"],
      ["Location", "Mayfair"],
    ],
    body: [
      "A 10,000 sq ft restaurant opportunity at 20 Hanover Square, acting for Great Portland Estates — one of the West End's landmark restaurant lettings.",
      "[Sample] Full case study copy to follow from the leasing team.",
    ],
  },
  {
    slug: "19-golden-square",
    title: "19 Golden Square, Soho",
    service: "Investment",
    image: "/images/city-towers.jpg",
    blurb:
      "Acquired for Vectis Property Group for £10.5m, with redevelopment potential at the heart of Soho.",
    facts: [
      ["Service", "Investment"],
      ["Client", "Vectis Property Group"],
      ["Status", "Acquired"],
      ["Price", "£10,500,000"],
      ["Location", "Soho"],
    ],
    body: [
      "Acquired on behalf of Vectis Property Group for £10.5m, 19 Golden Square offers redevelopment potential at the heart of Soho.",
      "[Sample] Full case study copy to follow from the investment team.",
    ],
  },
  {
    slug: "213-214-upper-street",
    title: "213–214 Upper Street",
    service: "Investment",
    image: "/images/shop-boutique.jpg",
    blurb:
      "Sold on behalf of a private client for £5.35m, reflecting a 3.62% cap rate on Islington's prime retail pitch.",
    facts: [
      ["Service", "Investment"],
      ["Strategy", "Value add"],
      ["Status", "Sold (March 2024)"],
      ["Sector", "Retail"],
      ["Price", "£5,350,000 / cap rate 3.62%"],
      ["Location", "Islington"],
    ],
    body: [
      "Sold on behalf of a private client for £5,350,000, reflecting a 3.62% cap rate on Islington's prime retail pitch.",
      "[Sample] Full case study copy to follow from the investment team.",
    ],
  },
  {
    slug: "heddon-street",
    title: "Heddon Street, The Crown Estate",
    service: "Consultancy",
    image: "/images/heddon-street.jpg",
    blurb:
      "Long-term advice to The Crown Estate on one of the West End's best-loved restaurant and bar destinations, off Regent Street.",
    facts: [
      ["Service", "Consultancy"],
      ["Client", "The Crown Estate"],
      ["Sector", "Restaurant & bar"],
      ["Location", "West End"],
    ],
    body: [
      "Long-term advice to The Crown Estate on Heddon Street — one of the West End's best-loved restaurant and bar destinations, just off Regent Street.",
      "[Sample] Full case study copy to follow from the consultancy team.",
    ],
  },
  ...(["Hammerson", "Land Securities", "Bloomberg", "The Royal Exchange"] as const).map((client) => ({
    slug: client.toLowerCase().replace(/^the /, "").replace(/[^a-z0-9]+/g, "-") + "-lease-advisory",
    title: client,
    service: "Lease Advisory",
    blurb: `Lease advisory instruction for ${client} — rent reviews, renewals and restructuring aligned to the asset strategy.`,
    image: client === "The Royal Exchange" ? "/images/stills-preview-royal-exchange.jpg" : undefined,
    facts: [["Service", "Lease Advisory"], ["Client", client]] as Array<[string, string]>,
    body: [
      `BGP's Lease Advisory team acts for ${client}, providing evidence-led advice across rent reviews, renewals and lease restructuring.`,
      "[Sample] Full case study copy to follow from the Lease Advisory team.",
    ],
  })),
  {
    slug: "atis",
    title: "ATIS",
    service: "Brand Representation",
    image: "/images/stills-preview-central-cafe.jpg",
    blurb:
      "A new healthy grab & go lifestyle restaurant offering seriously tasty bowls and salads. We acquired their first site on City Road in the Atlas Building.",
    facts: [
      ["Service", "Brand Representation"],
      ["Client", "ATIS"],
      ["Sector", "F&B — healthy grab & go"],
      ["First site", "City Road, Atlas Building"],
    ],
    body: [
      "A new healthy grab & go lifestyle restaurant offering seriously tasty bowls and salads. We acquired their first site on City Road in the Atlas Building, also serving cold press juices, artisanal coffees and kombucha on tap.",
    ],
  },
  {
    slug: "fred-perry",
    title: "Fred Perry",
    service: "Brand Representation",
    image: "/images/shop-menswear.jpg",
    blurb:
      "One of the UK's most iconic brands, steeped in a rich history of music, sport and culture.",
    facts: [
      ["Service", "Brand Representation"],
      ["Client", "Fred Perry"],
      ["Sector", "Fashion retail"],
      ["Coverage", "UK & international"],
    ],
    body: [
      "One of the UK's most iconic brands, steeped in a rich history of music, sport and culture. With stores worldwide and a cult following, Fred Perry continues to increase its presence in key locations.",
    ],
  },
  {
    slug: "barrys-bootcamp",
    title: "Barry's Bootcamp",
    service: "Brand Representation",
    image: "/images/stills-preview-gym.jpg",
    blurb:
      "Described as the 'hardest workout in the world' — acquisition strategy throughout London.",
    facts: [
      ["Service", "Brand Representation"],
      ["Client", "Barry's Bootcamp"],
      ["Sector", "Fitness & wellness"],
      ["Coverage", "London & UK"],
    ],
    body: [
      "Described as the 'hardest workout in the world', BGP have been working with Barry's Bootcamp for several years to help with their acquisition strategy throughout London.",
    ],
  },
  {
    slug: "yolk",
    title: "YOLK",
    service: "Brand Representation",
    image: "/images/food-hall.jpg",
    blurb:
      "Fine fast food, freshly prepared — from a 2014 pop-up to ten permanent locations across London.",
    facts: [
      ["Service", "Brand Representation"],
      ["Client", "YOLK"],
      ["Sector", "F&B — fine fast food"],
      ["Locations", "10+ across London"],
    ],
    body: [
      "Fine fast food, freshly prepared. From a 2014 pop-up to ten permanent locations across London — most recently Holborn, launched under the brand's refreshed 'Good Bites Only' identity.",
      "The brand team focuses on visible, high footfall areas. For expansion opportunities, contact Jamie Orme or Evie North.",
    ],
  },
];

export const BRAND_REP_CASE_STUDIES = CASE_STUDIES.filter((c) => c.service === "Brand Representation");
export const LEASE_ADVISORY_CASE_STUDIES = CASE_STUDIES.filter((c) => c.service === "Lease Advisory");

export const caseStudyBySlug = (slug: string): CaseStudy =>
  CASE_STUDIES.find((c) => c.slug === slug) ?? CASE_STUDIES[0];

// Real transactions from the current site's investment track record.
export interface InvestmentDeal {
  name: string;
  client: string;
  price: string;
  capRate: string | null;
  sold: boolean;
  wide: boolean;
  image?: string;
}

export const INVESTMENT_DEALS: InvestmentDeal[] = [
  { image: "/images/supermarket.jpg", name: "LondonMetric Waitrose Portfolio", client: "LondonMetric PLC", price: "£62,000,000", capRate: null, sold: true, wide: true },
  { image: "/images/shop-rails.jpg", name: "St Peters & Four Pools", client: "Brydell Partners", price: "£16,900,000", capRate: null, sold: true, wide: false },
  { image: "/images/cinema.jpg", name: "Robin Leisure Park", client: "Otium Real Estate", price: "£12,480,000", capRate: "8.30%", sold: true, wide: false },
  { image: "/images/city-towers.jpg", name: "19 Golden Square, Soho", client: "Vectis Property Group", price: "£10,500,000", capRate: null, sold: true, wide: false },
  { image: "/images/restaurant.jpg", name: "The Ivy, 39 Milsom Street, Bath", client: "Legal & General", price: "£8,050,000", capRate: null, sold: true, wide: false },
  { image: "/images/shop-browse.jpg", name: "52–55 Friar Street, Reading", client: "Aviva Investors", price: "£6,500,000", capRate: null, sold: true, wide: false },
  { image: "/images/apartments.jpg", name: "Riverlight, Nine Elms", client: "St James / Berkeley", price: "£5,800,000", capRate: "4.22%", sold: true, wide: false },
  { image: "/images/shop-boutique.jpg", name: "213–214 Upper Street", client: "Private Client", price: "£5,350,000", capRate: "3.62%", sold: true, wide: false },
  { image: "/images/grocery-aisle.jpg", name: "Tesco, Fulham Reach", client: "St George PLC", price: "£2,325,000", capRate: "4.60%", sold: true, wide: false },
];

// Real client rosters from the projects page. Logos resolve via the Clearbit
// logo API (same source as the dashboard); unresolved domains fall back to the
// client name in a circle.
export interface Client {
  name: string;
  domain?: string;
}

export const BRAND_REP_CLIENTS: Client[] = [
  { name: "Fred Perry", domain: "fredperry.com" },
  { name: "Barry's Bootcamp", domain: "barrys.com" },
  { name: "YOLK", domain: "yolklondon.com" },
  { name: "ATIS", domain: "atisfood.com" },
  { name: "Ted's Grooming Room", domain: "tedsgroomingroom.com" },
  { name: "Borough Kitchen", domain: "boroughkitchen.com" },
  { name: "The Black Penny", domain: "theblackpenny.com" },
  { name: "Little Houses Group", domain: "littlehousesgroup.com" },
  { name: "Related", domain: "related.com" },
];

// Per Pete Wood (2026-09-04) — his edit of the first draft list.
export const LEASE_ADVISORY_CLIENTS: Client[] = [
  { name: "Landsec", domain: "landsec.com" },
  { name: "Hammerson", domain: "hammerson.com" },
  { name: "Bloomberg", domain: "bloomberg.com" },
  { name: "Schroders", domain: "schroders.com" },
  { name: "Brookfield", domain: "brookfield.com" },
  { name: "Columbia Threadneedle", domain: "columbiathreadneedle.com" },
  { name: "Aberdeen", domain: "aberdeeninvestments.com" },
  { name: "AXA", domain: "axa-im.com" },
  { name: "Ardent", domain: "ardentcompanies.com" },
  { name: "City of London", domain: "cityoflondon.gov.uk" },
  { name: "Capital Real Estate Partners", domain: "capitalrealestatepartners.com" },
  { name: "Din Tai Fung", domain: "dintaifung.co.uk" },
  { name: "Barry's", domain: "barrys.com" },
];

export const CONSULTANCY_CLIENTS: Client[] = [
  { name: "Landsec", domain: "landsec.com" },
  { name: "The Crown Estate", domain: "thecrownestate.co.uk" },
  { name: "Berkeley Group", domain: "berkeleygroup.co.uk" },
  { name: "Nuveen", domain: "nuveen.com" },
  { name: "Hermes", domain: "federatedhermes.com" },
  { name: "Almacantar", domain: "almacantar.com" },
  { name: "Consolidated Developments", domain: "consolidateddevelopments.com" },
  { name: "St George", domain: "stgeorgeplc.co.uk" },
];


export const LEASE_ADVISORY_SERVICES = [
  {
    name: "Rent reviews",
    detail:
      "Acting for landlords and occupiers on rent reviews across retail, restaurant and leisure — grounded in live leasing evidence from our agency teams.",
  },
  {
    name: "Lease renewals",
    detail:
      "Negotiating renewals that enable landlords and occupiers to optimise value and manage risk, ensuring each agreement is structured around operational needs and supports the wider strategy for the asset.",
  },
  {
    name: "Lease restructuring",
    detail:
      "Bespoke advice on re-gears, surrenders and re-lettings, to align the lease structure with asset or brand strategy.",
  },
  {
    name: "Portfolio & estate advisory",
    detail:
      "BGP provide portfolio and estate advisory across long-term instructions, bringing extensive experience in shaping strategy, managing lease events and ensuring assets perform in line with business objectives. We deliver coordinated advice across multi-asset holdings, identifying opportunities to enhance value, reduce risk and optimise performance throughout the ownership lifecycle.",
  },
  {
    name: "Expert advice",
    detail: "Our team has extensive experience in dispute resolution, regularly acting as Expert Witness in rent review proceedings and providing representations to Arbitrators and Independent Experts, as well as preparing Expert Reports for Court.",
  },
];

export const CONSULTANCY_SERVICES = [
  "Pre-purchase advice for investment acquisitions, independent of our own investment team",
  "Asset management strategy and implementation",
  "Bespoke reporting and long-term placemaking consultancy",
];

export const CONSULTANCY_BODY = [
  "With a forward-thinking approach that aligns with development timelines, we frequently collaborate with partners such as People Places Spaces and Fier & Folk.",
  "Together, we deliver thoughtful strategies for ground floor amenities—whether for office developments, residential schemes, or business and science parks.",
  "In long-term development, it's essential to integrate insights into global future trends and explore how to activate spaces on a meanwhile-use basis.",
];

export interface Article {
  slug: string;
  title: string;
  category: string;
  date: string;
  author: string;
  standfirst: string;
  body: string[] | null; // null = full copy still to be migrated from the current journal
  image?: string;
  isSample?: boolean;
}

// Real articles from the current journal (brucegillinghampollard.com/journal).
export const ARTICLES: Article[] = [
  {
    slug: "ardent-royal-exchange",
    image: "/images/royal-exchange.jpg",
    title: "Ardent UK Completes Royal Exchange Acquisition",
    category: "Investment",
    date: "2026",
    author: "BGP",
    standfirst: "Ardent UK has completed its acquisition of the Royal Exchange.",
    body: null,
  },
  {
    slug: "adieu-2025",
    image: "/images/hero-london.jpg",
    title: "Adieu 2025…",
    category: "News",
    date: "05.01.26",
    author: "Woody Bruce",
    standfirst:
      "Well that's that for 2025. And I don't think anyone in this industry can claim that it didn't have its challenges.",
    body: [
      "Well that's that for 2025. And I don't think anyone in this industry can claim that it didn't have its challenges. But looking back, there's a lot to be positive about.",
      "We've grown the team and strengthened the way our divisions work together — Investment, Leasing, Lease Consultancy and Brand Representation. We've had some brilliant deals across the board – well done team – all of which contributed to 2026 being our best year to date.",
      "We've got a lot lined up for 2026 – our 15th birthday year. A new website, a complete rebrand and even… a new name?!",
      "Hugest thanks to our clients, colleagues and associates. Wishing you all the best for 2026.",
    ],
  },
  {
    slug: "get-ready-for-the-queues",
    image: "/images/shop-rails.jpg",
    title: "Get Ready for the Queues: How Digital-First Brands are Turning Followers into Footfall",
    category: "Breakthrough brands",
    date: "2026",
    author: "Millie Edwards",
    standfirst:
      "Edikted's UK expansion to Carnaby Street exemplifies how DTC brands leverage digital communities to drive physical retail success through experiential design.",
    body: null,
  },
  {
    slug: "enduring-appeal-portman-estate",
    image: "/images/anna-nina.jpg",
    title: "The Enduring Appeal of the Portman Estate",
    category: "Opinion",
    date: "05.11.25",
    author: "Lucy Cope",
    standfirst:
      "Chiltern Firehouse has been back in the news recently, having reopened for a couple of high profile celebrity parties. Sadly, the world famous hotel, restaurant and bar remains closed to the public for now.",
    body: [
      "Dating back to 2010, the role of the Portman Estate's partnership with the Chiltern Firehouse in transforming Chiltern Street into one of London's most recognisable destinations can't be overstated. But the really positive news is that since the hotel's temporary closure, a series of dynamic new openings have reinforced the vibrancy of the area. The retail and F&B scene continues to thrive, offering some of the most coveted new retail and restaurant experiences in London.",
      "## Chiltern Street and its surroundings are at historically low vacancy levels",
      "As sole agents on the Portman Estate, our team is tasked with curating a vibrant mix of independent retailers and market leading F&B operators to cater to the tourists, office workers and locals of Marylebone. Having worked on the instruction for 3 years, I've seen the market evolve — and I can confidently say that operator demand for space across the Estate is stronger than ever. Over the past six months, every available unit on Chiltern Street has received multiple competitive offers — often eight or more — reflecting the exceptional popularity of the location. Chiltern Street today is fully let or under offer, while the surrounding Portman Marylebone area encompassing Dorset Street, Blandford Street, Seymour Place and New Quebec Street are at a historically low vacancy rate.",
      "## Character and community drive leasing activity",
      "The footfall statistics for Chiltern Street are good, but footfall is not the key driver of tenant demand at this location. The independent retailers and restaurateurs who choose to open here are not just looking for a site — they're looking for a setting that values their individuality and tells their story. The street offers a distinct character within London's retail environment, fostering a sense of destination rather than a transaction — a key consideration as the 'flight to quality' trend sees brands continue to seek out fewer, often smaller sites in premium locations.",
      "## Footfall driving F&B lettings",
      "Maset is a new Mediterranean restaurant and wine bar inspired by the Occitan region, currently soft-launching at 40–42 Chiltern Street. Created by the owners of the successful Michelin Guide restaurants Lurra and Donostia on Seymour Place, Maset opened last week in a unit which was subject to considerable interest from both retail and restaurant operators. As the only restaurant on the iconic red-bricked street, the site was destined for something special which Maset absolutely delivers.",
      "Similarly, the old Flower House pub at 56 Blandford Street has been let to Public House Group for their new pub 'The Hart' following an incredibly competitive bidding war among London's best restaurant and pub operators.",
      "Renowned hospitality name Angela Hartnett recently chose Portman's Dorset Street as the location for the fourth Cafe Murano restaurant. The arrival of such a prestigious name has enhanced the F&B offering across the estate, with the restaurant being especially popular with locals.",
      "Cafe Murano and The Hart book-end The Portman Estate's Chiltern Street holdings with two fantastic all-day dining venues, whilst Maset offers a third option situated centrally between the two. This bolstered food and beverage offering, bringing three new and diverse cuisines to the area, supports and complements the curated boutique retail that Chiltern Street is well-known for.",
      "## Distinctive international operators diversifying retail",
      "When it comes to retail, Chiltern Street continues to attract distinctive, design-led brands; Amsterdam brand Anna & Nina brought its first London store to 54 Chiltern Street last year, and has landed with a pop of colour creating an eye-catching cherry red frontage.",
      "Jacques Marie Mage has also opened its first London store at 20–22 Chiltern Street, on the Estate and is proving a very successful addition. Behind the scenes we are working with a number of international fashion and lifestyle brands which will broaden the retail offering to a rounded mix of beauty, lifestyle, accessories and apparel.",
      "Although we all look forward to the return of Chiltern Firehouse, the ongoing strength of demand across the Portman Estate speaks for itself. Chiltern Street's blend of authenticity, individuality and quality continues to attract operators who want to be part of something distinctive. I look forward to seeing its uniquely vibrant mix of independent F&B and retail continue to thrive.",
    ],
  },
  {
    slug: "millie-edwards-joins-leasing-team",
    title: "Bruce Gillingham Pollard Appoints Millie Edwards to Leasing Team and Announces Promotions",
    category: "News",
    date: "2025",
    author: "BGP",
    standfirst: "Staff announcement regarding new appointments and team promotions.",
    body: null,
  },
  {
    slug: "spotlight-on-the-grads",
    title: "Spotlight on: The Grads!",
    category: "News",
    date: "2025",
    author: "Emily Mitchell",
    standfirst: "A feature highlighting the graduates driving BGP's teams forward.",
    body: null,
  },
  {
    slug: "kilburn-mews",
    title: "Bruce Gillingham Pollard Appointed to Lease Kilburn Mews",
    category: "News",
    date: "2025",
    author: "BGP",
    standfirst: "BGP has been appointed leasing agents on the Kilburn Mews scheme.",
    body: null,
  },
  {
    slug: "why-part-time-staff-are-key",
    image: "/images/shop-boutique.jpg",
    title: "Why Part Time Staff are Key to the In Store Experience",
    category: "Opinion",
    date: "2025",
    author: "Paris Fixman",
    standfirst:
      "The critical role of part-time retail workers amid employment cost pressures affecting experiential retail.",
    body: null,
  },
  {
    slug: "wellness-placemaking-essential",
    image: "/images/gym.jpg",
    title: "Wellness is No Longer an Afterthought; It's a Placemaking Essential",
    category: "Opinion",
    date: "28.07.25",
    author: "Evie North",
    standfirst:
      "Karve opened in Victoria — the third location for the premium pilates studio that offers its clients everything from classes and coffee to a strong community.",
    body: [
      "Karve opened in Victoria – the third location for the premium pilates studio that offers its clients everything from classes and coffee to a strong community. Our recent client work demonstrates a significant shift: wellness is no longer an add on to placemaking schemes. In fact in many mixed use developments, wellness businesses are becoming the anchor.",
      "When it comes to London leasing, BGP was ahead of the wellness trend. We advised on some of the first and most progressive wellness tenant mixes.",
      "Wellness operators are now a key element when creating a place that people want to travel to. They bring footfall daily, and consistently throughout the day — unlike dining, which peaks around mealtimes.",
      "The pub is no longer the default place to meet and socialise, particularly for Gen Z. Instead, wellness studios and cafes are leaping into the (alcohol free) mixer.",
      "Wellness is no longer an afterthought for landlords – it's part of a habitual human lifestyle change.",
    ],
  },
  {
    slug: "behind-the-brand-yolk",
    image: "/images/news-yolk.jpg",
    title: "Behind the Brand | YOLK",
    category: "Retail",
    date: "24.06.25",
    author: "BGP",
    standfirst:
      "From a 2014 pop-up to ten permanent locations across London — how YOLK built 'fine fast food' into a breakthrough brand.",
    body: [
      "YOLK recently opened its tenth location, in Holborn. The brand began as a pop-up venture in 2014, when founder Nick Philpot realised there was a gap in the market between basic fast food and time-intensive dining experiences.",
      "YOLK's appeal stems from offering freshly prepared, premium food options with quality ingredients — distinguishing it from typical grab-and-go venues. Menu items like the Flying Tiger Steak showcase this elevated approach.",
      "Store design prioritises efficiency through click and collect and digital ordering screens, serving office workers and tourists seeking convenient meals of real quality.",
      "The Holborn location features the brand's refreshed identity — 'Good Bites Only' — louder, bolder and built to match the energy, with digital menu boards and an open kitchen concept.",
      "The brand team focuses on visible, high footfall areas. For expansion opportunities, contact Jamie Orme or Evie North.",
    ],
  },
  {
    slug: "pride-doesnt-end-in-july",
    title: "Pride doesn't end in July. How London's Queer Spaces Make Inclusivity Part of our London Neighbourhoods",
    category: "Opinion",
    date: "2025",
    author: "Harry Elliott",
    standfirst: "How London's queer spaces make inclusivity part of our neighbourhoods, all year round.",
    body: null,
  },
  {
    slug: "salad-project-nova-victoria",
    image: "/images/food-hall.jpg",
    title: "The Salad Project set to Open in Nova Victoria",
    category: "News",
    date: "2025",
    author: "BGP",
    standfirst: "The Salad Project is set to open at Nova Victoria.",
    body: null,
  },
  {
    slug: "wimbledon-aldi-for-sale",
    title: "New Wimbledon Aldi Store Offered for Sale",
    category: "News",
    date: "2025",
    author: "BGP",
    standfirst: "A new Wimbledon Aldi store has been brought to market.",
    body: null,
  },
];

export const CONTACT = {
  addressLines: ["First Floor", "55 Wells Street", "London W1T 3PT"],
  phone: "020 3551 5260",
  email: "harriette@brucegillinghampollard.com",
};
