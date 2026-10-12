// Site copy. Sourced from the current brucegillinghampollard.com site, the
// dashboard team directory, the December 2025 wireframe deck and Emmy's
// "Website copy 7 Oct" document (went live 2026-10-12).

export const SERVICES = [
  {
    slug: "leasing",
    name: "Leasing",
    image: "/images/clients/nova-hero.jpg",
    intro:
      "Creating neighbourhoods that people love. Retail, restaurant and leisure leasing across London's leading estates and the UK's landmark destinations — acting for landlords including The Portman Estate, Grosvenor, The Crown Estate and Landsec.",
  },
  {
    slug: "investment",
    name: "Investment",
    image: "/images/clients/city-st-pauls.jpg",
    intro:
      "Acquisition and disposal advice across retail, leisure and mixed-use investments — from single assets to portfolios, acting for private clients, property companies and institutions including Aviva Investors, Legal & General and LondonMetric.",
  },
  {
    slug: "brand-representation",
    name: "Brand Representation",
    image: "/images/fred-perry-camden.jpg",
    intro:
      "We help brands discover, secure and maximise opportunities across the UK's most exciting retail, leisure and hospitality destinations.",
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

// From Emmy's "Website copy 7 Oct" — Website: Homepage
export const HOME_INTRO = {
  lead: "We are bgp.",
  body: [
    "As the UK's largest independent retail and leisure property consultancy, we bring together specialists across our Leasing, Brand Representation, Lease Advisory, Consultancy and Investment teams to create strategies that unlock value.",
    "Specialist expertise is at the heart of BGP; but it's our collaborative approach that sets us apart. By bringing together insight from across our teams, we provide considered, commercially focused advice that shapes successful places and stronger portfolios.",
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

// Titles and contact details from the BGP team directory / public site;
// teams and leads from Woody's BGP Team Structure workbook (2026-10-12).
export const TEAM: Person[] = [
  { photo: "/images/team/woody-bruce.jpg", name: "Woody Bruce", title: "Managing Director", phone: "+44 (0)7980 313 675", email: "woody@brucegillinghampollard.com" },
  { photo: "/images/team/tracey-pollard.jpg", name: "Tracey Pollard", title: "Founding Director, Co-Head High Streets", phone: "+44 (0)7779 323 306", email: "tracey@brucegillinghampollard.com" },
  { photo: "/images/team/charlotte-roberts.jpg", name: "Charlotte Roberts", title: "Equity Director, Co-Head of Leasing", phone: "+44 (0)7738 448 338", email: "charlotte@brucegillinghampollard.com" },
  { photo: "/images/team/rupert-bentley-smith.jpg", name: "Rupert Bentley-Smith", title: "Equity Director, Co-Head of Leasing", phone: "+44 (0)7876 354 160", email: "rupert@brucegillinghampollard.com" },
  { photo: "/images/team/jack-barratt.jpg", name: "Jack Barratt", title: "Equity Director, Head of Investment", phone: "+44 (0)7788 215 044", email: "jack@brucegillinghampollard.com" },
  { photo: "/images/team/victoria-broadhead.jpg", name: "Victoria Broadhead", title: "Director, Co-Head Shopping Centres", phone: "+44 (0)7793 158 133", email: "victoria@brucegillinghampollard.com" },
  { photo: "/images/team/peter-wood.jpg", name: "Peter Wood", title: "Head of Lease Advisory and Asset Management", phone: "+44 (0)7872 602 336", email: "peter@brucegillinghampollard.com" },
  { photo: "/images/team/nick-halley.jpg", name: "Nick Halley", title: "Director, Investment", phone: "+44 (0)7766 042 736", email: "nick@brucegillinghampollard.com" },
  { photo: "/images/team/lucy-gardiner.jpg", name: "Lucy Gardiner", title: "Director, Co-Head High Streets", phone: "+44 (0)7741 877 452", email: "lucyg@brucegillinghampollard.com" },
  { photo: "/images/team/lizzie-knights.jpg", name: "Lizzie Knights", title: "Director, Co-Head London Estates & City", phone: "+44 (0)7511 902 073", email: "lizzie@brucegillinghampollard.com" },
  { photo: "/images/team/harry-elliott.jpg", name: "Harry Elliott", title: "Director, Co-Head Brand Representation", phone: "+44 (0)7568 367 777", email: "harrye@brucegillinghampollard.com" },
  { photo: "/images/team/emily-dumbell.jpg", name: "Emily Dumbell", title: "Director, Shopping Centres", phone: "+44 (0)7805 259 793", email: "emily@brucegillinghampollard.com" },
  { photo: "/images/team/nick-goodman.jpg", name: "Nick Goodman", title: "Consultant, Investment", phone: "+44 (0)7818 012 432", email: "nickgoodman@brucegillinghampollard.com" },
  { photo: "/images/team/tom-cater.jpg", name: "Tom Cater", title: "Associate Director, Lease Advisory", phone: "+44 (0)7947 484 902", email: "tom@brucegillinghampollard.com" },
  { photo: "/images/team/lucy-cope.jpg", name: "Lucy Cope", title: "Associate Director, Co-Head London Estates", phone: "+44 (0)7595 267 866", email: "lucy@brucegillinghampollard.com" },
  { photo: "/images/team/evie-north.jpg", name: "Evie North", title: "Associate Director, London Estates", phone: "+44 (0)7595 349 057", email: "evie@brucegillinghampollard.com" },
  { photo: "/images/team/alex-todd.jpg", name: "Alex Todd", title: "Senior Surveyor, Shopping Centres", phone: "+44 (0)7526 504 806", email: "alext@brucegillinghampollard.com" },
  { photo: "/images/team/millie-edwards.jpg", name: "Millie Edwards", title: "Co-Head Shopping Centres", phone: OFFICE_PHONE, email: "TBC" },
  { photo: "/images/team/ben-sykes.jpg", name: "Ben Sykes", title: "Surveyor, Shopping Centres", phone: OFFICE_PHONE, email: "TBC" },
  { photo: "/images/team/kate-martin.jpg", name: "Kate Martin", title: "Surveyor, Shopping Centres", phone: OFFICE_PHONE, email: "TBC" },
  { name: "Beth Emmens", title: "Co-Head Brand Representation", phone: OFFICE_PHONE, email: "TBC" },
  { photo: "/images/team/carly-cunliffe.jpg", name: "Carly Cunliffe", title: "Brand Representation", phone: OFFICE_PHONE, email: "TBC" },
  { photo: "/images/team/emily-cann.jpg", name: "Emily Cann", title: "Graduate Surveyor, London Estates", phone: "+44 (0)7516 660 791", email: "emilyc@brucegillinghampollard.com" },
  { photo: "/images/team/will-penfold.jpg", name: "Will Penfold", title: "Graduate Surveyor, London Estates", phone: "+44 (0)7760 881 270", email: "willp@brucegillinghampollard.com" },
  { photo: "/images/team/luke-donohoe.jpg", name: "Luke Donohoe", title: "Graduate Surveyor, Shopping Centres", phone: "+44 (0)7983 855 926", email: "luke@brucegillinghampollard.com" },
  { photo: "/images/team/libby-evans.jpg", name: "Libby Evans", title: "Graduate Surveyor, High Streets", phone: "+44 (0)7931 462 768", email: "libbye@brucegillinghampollard.com" },
  { photo: "/images/team/jonny-palmer.jpg", name: "Jonny Palmer", title: "Graduate, Investment", phone: "+44 (0)7506 439 429", email: "jonny@brucegillinghampollard.com" },
  { name: "Harriette Walker-Clark", title: "PA & Office Manager", phone: OFFICE_PHONE, email: "harriette@brucegillinghampollard.com" },
  { photo: "/images/team/layla-odriscoll.jpg", name: "Layla O'Driscoll", title: "Chief Operating Officer", phone: OFFICE_PHONE, email: "layla@brucegillinghampollard.com" },
  { photo: "/images/team/cara-milligan.jpg", name: "Cara Milligan", title: "PA — National", phone: OFFICE_PHONE, email: "cara@brucegillinghampollard.com" },
];

const byName = (...names: string[]) => TEAM.filter((p) => names.includes(p.name));

export const LEASING_CONTACTS = byName(
  "Charlotte Roberts",
  "Rupert Bentley-Smith",
  "Victoria Broadhead",
  "Millie Edwards",
  "Lizzie Knights",
  "Lucy Cope",
  "Lucy Gardiner",
  "Tracey Pollard",
);

export const INVESTMENT_CONTACTS = byName(
  "Jack Barratt",
  "Nick Halley",
  "Jonny Palmer",
);

export const LEASE_ADVISORY_CONTACTS = byName("Peter Wood", "Tom Cater");

export const BRAND_REP_CONTACTS = byName("Harry Elliott", "Beth Emmens", "Carly Cunliffe");

// Tracey, 2026-09-11: Pete Wood replaces Alex on the consultancy page.
export const CONSULTANCY_CONTACTS = byName("Tracey Pollard", "Peter Wood", "Libby Evans");

export interface CaseStudy {
  slug: string;
  title: string;
  service: string;
  blurb: string;
  image?: string;
  facts: Array<[string, string]>;
  body: string[];
}

// From the projects list on the current site; bodies are short where the team
// fuller copy from the relevant team.
export const CASE_STUDIES: CaseStudy[] = [
  {
    slug: "lucent-piccadilly",
    title: "Lucent, Piccadilly Lights",
    service: "Leasing",
    image: "/images/lucent-piccadilly.jpg",
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
      "The letting followed BGP's long-standing work with GPE across its West End portfolio, drawing on the Leasing and Brand Representation teams' relationships with the restaurant operators best placed for the space.",
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
      "BGP advised on pricing, positioning and the route to market, combining investment analysis with the firm's leasing knowledge of Soho.",
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
      "A tailored marketing campaign and clear transaction plan maximised competition for a well-let asset on one of north London's strongest retail streets.",
    ],
  },
  // Consultancy case studies — Tracey's three, 2026-09-11. Photos to follow.
  {
    slug: "city-of-london-ground-floor-study",
    title: "City of London Corporation — Ground Floor Study",
    service: "Consultancy",
    image: "/images/clients/city-street.jpg",
    blurb:
      "A strategic study defining what makes a vibrant, consistently lively ground-floor experience across the Square Mile.",
    facts: [
      ["Service", "Consultancy"],
      ["Client", "City of London Corporation"],
      ["Partners", "Aldgate Connect, Cheapside Business Alliance, Culture Mile BID, Eastern City BID, Fleet Street Quarter"],
      ["Location", "The Square Mile"],
    ],
    body: [
      "\"Developing a consistently lively and animated ground floor experience\" — produced on behalf of the City of London Corporation and the City's five Business Improvement Districts: Aldgate Connect, Cheapside Business Alliance, Culture Mile BID, Eastern City BID and Fleet Street Quarter.",
      "A strategic study defining what makes a vibrant, consistently lively ground-floor experience across the Square Mile.",
    ],
  },
  {
    slug: "crown-estate-cambridge-business-park",
    title: "The Crown Estate — Retail Strategy, Cambridge Business Park",
    service: "Consultancy",
    image: "/images/principal-place.jpg",
    blurb:
      "Advice on the role, location, specification, scale and typology of day and evening uses across the site.",
    facts: [
      ["Service", "Consultancy"],
      ["Client", "The Crown Estate"],
      ["Location", "Cambridge Business Park"],
    ],
    body: [
      "Providing advice on the role, location, specification, scale and typology of day and evening uses — F&B, retail, leisure, culture, community anchors and services — across the site.",
    ],
  },
  {
    slug: "mayfield-manchester",
    title: "Mayfield, Manchester — Amenity & Ground Floor Activation Strategy",
    service: "Consultancy",
    image: "/images/apartments.jpg",
    blurb:
      "A strategy providing clarity on the amenities and ground floor activation for a 1.67 million sq ft office and 1,400-home development.",
    facts: [
      ["Service", "Consultancy"],
      ["Location", "Mayfield, Manchester"],
      ["Offices", "1,666,267 sq ft"],
      ["Homes", "1,400"],
    ],
    body: [
      "A strategy document providing clarity on the amenities and ground floor activation for Mayfield, Manchester — a development comprising 1,666,267 sq ft of offices, 1,400 new homes and the range of facilities required to serve residents, the office catchment and visitors to Mayfield.",
      "Our work has been used to help shape ground floor unit configuration, to ensure the units are fit for purpose once built and that there is a long-term vision in place to support office lettings.",
    ],
  },
  ...(["Hammerson", "Land Securities", "Bloomberg", "The Royal Exchange"] as const).map((client) => ({
    slug: client.toLowerCase().replace(/^the /, "").replace(/[^a-z0-9]+/g, "-") + "-lease-advisory",
    title: client,
    service: "Lease Advisory",
    blurb: `Lease advisory instruction for ${client} — rent reviews, renewals and restructuring aligned to the asset strategy.`,
    image: { Hammerson: "/images/clients/bullring-interior.jpg", "Land Securities": "/images/clients/victoria-street.jpg", "The Royal Exchange": "/images/royal-exchange.jpg", Bloomberg: "/images/city-towers.jpg" }[client as string],
    facts: [["Service", "Lease Advisory"], ["Client", client]] as Array<[string, string]>,
    body: [
      `BGP's Lease Advisory team acts for ${client}, providing evidence-led advice across rent reviews, renewals and lease restructuring.`,
      "Every negotiation starts from the asset strategy and is grounded in live leasing evidence from BGP's agency teams.",
    ],
  })),
  {
    slug: "atis",
    title: "ATIS",
    service: "Brand Representation",
    image: "/images/cafe.jpg",
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
    image: "/images/gym.jpg",
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

// Tracey's key clients list, 2026-09-11.
export const CONSULTANCY_CLIENTS: Client[] = [
  { name: "City of London Corporation", domain: "cityoflondon.gov.uk" },
  { name: "The Crown Estate", domain: "thecrownestate.co.uk" },
  { name: "Landsec", domain: "landsec.com" },
  { name: "Northbank BID", domain: "thenorthbank.london" },
  { name: "Stanhope", domain: "stanhopeplc.com" },
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
  "With a forward-thinking approach that aligns with development timelines, we frequently collaborate with partners such as People Places Spaces.",
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

// ── Leasing sectors (Emmy's "Website copy 7 Oct", 2026-10-12) ─────────────
// Woody, 2026-10-12: go live with what we have — every sector is public.
export interface LeasingSector {
  slug: string;
  name: string;
  approved: boolean;
  approvedBy?: string;
  image?: string;
  gallery?: string[];
  headline: string;
  body: string[];
  howWeHelp?: string[];
  contacts: string[];
}

export const LEASING_INTRO = {
  headline:
    "Our industry renowned Leasing team has an outstanding track record in destination placemaking; delivering strategies to attract and retain the best tenants, enhance positioning and drive performance.",
  body: [
    "Our approach draws on insight gained from extensive relationships with leading occupiers, advanced market intelligence and data analytics, and partnerships with forecasting agencies to shape destinations with lasting appeal.",
    "As trusted advisors to London Estates and institutional landlords, we have led the evolution of flagship shopping centres, built celebrated independent brand hubs, and created world renowned leisure and hospitality destinations.",
  ],
};

export const LEASING_SECTORS: LeasingSector[] = [
  {
    slug: "shopping-centres",
    name: "Shopping Centres",
    approved: true,
    approvedBy: "VB & ED",
    image: "/images/sectors/shopping-centres.jpg",
    headline:
      "We advise on 21 shopping centres across the UK; from some of London's leading mixed-use destinations and major regional shopping centres to new developments under construction.",
    body: [
      "Our dedicated Shopping Centre team combines decades of deep sector expertise with a detailed understanding of each of the cities and the overall occupier market. We work closely with landlords and asset managers to develop leasing strategies that build stand out destinations while developing communities and embedding a culture around these centres. We respond to changing consumer behaviour, strengthen and create progressive and profitable tenant mix and positioning and drive long-term performance; always prioritising our focus of long term value creation for our clients.",
      "We work closely with the London Estates and High Street teams, ensuring we capture conversations early and draw occupiers out of London to our clients' shopping centres.",
      "Shopping centres are continually evolving. Changing customer habits, the growth of experiential retail, the competition for spend in store versus through social media and the expansion of leisure are reshaping what successful destinations look like.",
      "Our advice is grounded in extensive market intelligence, data and insight from our relationships with leading occupiers, enabling us to identify opportunities and anticipate what comes next.",
      "Our relationships with clients are equally long-standing. We are proud to have advised some of our shopping centre clients for more than 18 years, providing continuity of insight and advice as their assets - and the market - have continued to evolve.",
    ],
    howWeHelp: ["Leasing and strategic advice", "Asset management", "Lease consultancy", "Investment advice"],
    contacts: ["Millie Edwards", "Victoria Broadhead", "Emily Dumbell", "Alex Todd", "Ben Sykes", "Kate Martin", "Luke Donohoe"],
  },
  {
    slug: "london-estates",
    name: "London Estates",
    approved: true,
    image: "/images/sectors/london-estates.jpg",
    gallery: ["/images/gallery/mayfair-1.jpg", "/images/gallery/mayfair-2.jpg", "/images/gallery/belgravia-1.jpg"],
    headline: "We are proud to have worked across many of London's most prestigious estates for more than 15 years.",
    body: [
      "We believe that building destinations across London's estates requires a highly considered approach. Our Leasing team works with estate owners and landlords to identify opportunities, attract the right occupiers and deliver strategies that enhance the character and commercial performance of their portfolios.",
      "Working closely with our colleagues in Brand Representation, we combine extensive relationships across retail, hospitality and leisure with detailed knowledge of London's property market to create distinctive destinations. From sought after independents to established international brands looking for a London flagship, we identify the right tenant mix to reflect the character of each estate, respond to evolving customer expectations and create memorable places.",
    ],
    contacts: ["Lizzie Knights", "Lucy Cope", "Emily Cann", "Evie North", "Will Penfold"],
  },
  {
    slug: "city",
    name: "The City",
    approved: true,
    image: "/images/sectors/city.jpg",
    gallery: ["/images/gallery/onc-1.jpg", "/images/gallery/gpe-1.jpg", "/images/gallery/gpe-2.jpg"],
    headline:
      "We act on a range of destinations within the Square Mile, and understand the unique opportunities and considerations that come with leasing this part of London.",
    body: [
      "From exciting hospitality offerings to drive footfall throughout the day to new competitive socialising concepts, we create diverse tenant mixes that reflect the evolving nature of the City of London.",
    ],
    contacts: ["Lizzie Knights", "Peter Wood"],
  },
  {
    slug: "high-streets",
    name: "High Streets",
    approved: true,
    image: "/images/sectors/high-streets.jpg",
    gallery: ["/images/gallery/belgravia-2.jpg", "/images/gallery/coin-street-1.jpg", "/images/gallery/coin-street-2.jpg"],
    headline:
      "Our High Street Leasing team works on a diverse range of High Streets throughout London and across the UK.",
    body: [
      "We curate dynamic occupier mixes that reflect the needs and unique characteristics of the communities they serve; taking a long term view to build distinctive high streets that remain vibrant over time.",
    ],
    contacts: ["Lucy Gardiner", "Tracey Pollard", "Libby Evans"],
  },
];

export interface ShoppingCentre {
  slug: string;
  name: string;
  location: string;
  contacts: string[];
  image?: string;
  gallery?: string[];
  blurb: string;
}

// From the "BGP shopping centres" table in Emmy's copy document.
export const SHOPPING_CENTRES: ShoppingCentre[] = [
  { slug: "one-new-change", name: "One New Change", location: "London", image: "/images/centres/one-new-change.jpg", gallery: ["/images/gallery/onc-2.jpg", "/images/gallery/onc-3.jpg", "/images/gallery/onc-4.jpg"], contacts: ["Charlotte Roberts", "Emily Cann"], blurb: "Landsec's mixed-use destination beside St Paul's Cathedral, with a rooftop terrace and strong City lunch and after-work trade." },
  { slug: "cardinal-place", name: "Cardinal Place", location: "London", image: "/images/centres/cardinal-place.jpg", gallery: ["/images/gallery/cardinal-1.jpg", "/images/clients/victoria-street.jpg"], contacts: ["Charlotte Roberts", "Emily Cann"], blurb: "Retail and dining at the heart of Victoria, serving the office and commuter catchment around Victoria Station." },
  { slug: "o2-finchley-road", name: "O2 Finchley Road", location: "London", contacts: ["Victoria Broadhead", "Ben Sykes"], blurb: "A leisure-led north London centre anchored by cinema and gym, serving a dense residential catchment." },
  { slug: "lewisham-shopping-centre", name: "Lewisham Shopping Centre", location: "London", contacts: ["Victoria Broadhead", "Ben Sykes"], blurb: "The retail heart of Lewisham town centre, at the centre of a major south-east London regeneration area." },
  { slug: "brent-cross", name: "Brent Cross", location: "London", contacts: ["Charlotte Roberts", "Emily Dumbell", "Alex Todd"], blurb: "One of the UK's first major shopping centres, in north London, with a new town centre rising alongside it." },
  { slug: "bluewater", name: "Bluewater", location: "Kent", contacts: ["Charlotte Roberts", "Emily Dumbell", "Alex Todd"], blurb: "The south-east's landmark regional shopping and leisure destination, set in a former chalk quarry in Kent." },
  { slug: "oracle", name: "The Oracle", location: "Reading", contacts: ["Charlotte Roberts", "Emily Dumbell", "Alex Todd"], blurb: "Reading's riverside shopping and dining destination along the Kennet." },
  { slug: "westgate", name: "Westgate", location: "Oxford", contacts: ["Victoria Broadhead", "Ben Sykes"], blurb: "Oxford's city-centre shopping and dining destination, with a rooftop restaurant terrace." },
  { slug: "gunwharf-quays", name: "Gunwharf Quays", location: "Portsmouth", contacts: ["Victoria Broadhead", "Emily Dumbell"], blurb: "Portsmouth's waterfront outlet shopping and leisure destination beneath the Spinnaker Tower." },
  { slug: "bullring", name: "Bullring", location: "Birmingham", image: "/images/centres/bullring.jpg", gallery: ["/images/gallery/bullring-1.jpg", "/images/gallery/bullring-2.jpg", "/images/gallery/bullring-3.jpg"], contacts: ["Charlotte Roberts", "Emily Dumbell", "Alex Todd"], blurb: "Birmingham's flagship city-centre shopping destination, home to Selfridges." },
  { slug: "grand-central", name: "Grand Central", location: "Birmingham", contacts: ["Charlotte Roberts", "Emily Dumbell", "Alex Todd"], blurb: "The dining and retail destination above Birmingham New Street station." },
  { slug: "trinity-leeds", name: "Trinity Leeds", location: "Leeds", contacts: ["Emily Dumbell", "Alex Todd"], blurb: "The Leeds city-centre destination mixing retail with dining and leisure under its glass roof." },
  { slug: "white-rose", name: "White Rose", location: "Leeds", contacts: ["Emily Dumbell", "Alex Todd"], blurb: "Leeds' out-of-town shopping and leisure centre, with cinema and dining." },
  { slug: "liverpool-one", name: "Liverpool One", location: "Liverpool", contacts: ["Victoria Broadhead", "Ben Sykes"], blurb: "The 42-acre open-air shopping district at the heart of Liverpool city centre." },
  { slug: "the-bridges", name: "The Bridges", location: "Sunderland", contacts: ["Victoria Broadhead", "Ben Sykes"], blurb: "Sunderland city centre's principal shopping centre." },
  { slug: "tunsgate", name: "Tunsgate Quarter", location: "Guildford", contacts: ["Victoria Broadhead", "Ben Sykes"], blurb: "Guildford's boutique shopping and dining quarter, just off the High Street." },
  { slug: "paradise", name: "Paradise", location: "Birmingham", contacts: ["Victoria Broadhead"], blurb: "Birmingham's new mixed-use quarter beside the Town Hall and Chamberlain Square." },
  { slug: "braintree-outlet", name: "Braintree Village", location: "Braintree", contacts: ["Victoria Broadhead", "Ben Sykes"], blurb: "Essex's outlet shopping destination, just off the A120." },
  { slug: "clarks-village", name: "Clarks Village", location: "Street, Somerset", contacts: ["Victoria Broadhead", "Ben Sykes"], blurb: "The UK's first purpose-built outlet village, on the site of the original Clarks factory." },
  { slug: "buchanan-galleries", name: "Buchanan Galleries", location: "Glasgow", contacts: ["Victoria Broadhead", "Ben Sykes"], blurb: "Glasgow's city-centre shopping centre at the top of Buchanan Street." },
  { slug: "st-davids", name: "St David's", location: "Cardiff", contacts: ["Victoria Broadhead", "Ben Sykes"], blurb: "Cardiff's city-centre shopping destination, anchored by John Lewis." },
];

// Investment and Brand Representation page copy from Emmy's document.
export const SERVICE_COPY = {
  investment: {
    body: [
      "Acquisition and disposal advice across retail, leisure and mixed-use investments. We advise on all aspects of property investment from single assets to portfolios, acting for private clients, property companies and institutions.",
      "We take a 360-degree view of every investment opportunity, combining market intelligence with BGP's specialist leasing and lease advisory expertise.",
      "We undertake detailed due diligence across title, planning, leases and covenants, alongside rigorous financial and market analysis. This gives us a clear understanding of an asset's strengths, risks and potential — and allows us to advise on the right pricing, positioning and route to market.",
      "Every sale is supported by a tailored marketing strategy and clear transaction plan, designed to maximise competition and deliver the best possible outcome.",
      "Above all, our advice is honest, accurate and commercially focused. We build relationships for the long term, not just for the duration of a transaction.",
    ],
  },
  brandRepresentation: {
    intro: "We help brands discover, secure and maximise opportunities across the UK's most exciting retail, leisure and hospitality destinations.",
    body: [
      "Our team combine market intelligence, occupier insight and creative thinking to deliver strategies that put brands in the right place, at the right time.",
      "Global Gatekeepers: We deliver first-to-market UK retail locations for the world's most talked-about international brands.",
      "Digital to Physical: We take 'game-changing' DTC brands from URL to IRL with high-impact bricks-and-mortar debuts.",
    ],
  },
};
