// Site copy. Anything marked [Sample] or "TBC" is placeholder awaiting
// real content from BGP — replace before launch.

export const SERVICES = [
  {
    slug: "leasing",
    name: "Leasing",
    intro:
      "[Sample] Retail and leisure leasing across London and the UK — acting for landlords and estates to curate the right mix and deliver lettings that endure.",
  },
  {
    slug: "investment",
    name: "Investment",
    intro:
      "[Sample] Acquisition and disposal advice across retail, leisure and mixed-use investments, from private clients to institutions.",
  },
  {
    slug: "brand-representation",
    name: "Brand Representation",
    intro:
      "Brand led retail estate advisory. Providing strategic support, market analysis for brand expansion across multi sector clients.",
  },
  {
    slug: "lease-advisory",
    name: "Lease Advisory",
    intro:
      "[Sample] Rent reviews, lease renewals and restructuring — protecting and enhancing value through the life of the lease.",
  },
  {
    slug: "consultancy",
    name: "Consultancy",
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

export const HERO_STATEMENT =
  "We combine deep market insight with relentless delivery to create impact and relationships that stand the test of time.";

export const STATS = [
  { value: "£XXXm", caption: "[Sample] transacted in the last 12 months" },
  { value: "XXX", caption: "[Sample] lettings completed" },
  { value: "XX", caption: "[Sample] estates and landlords advised" },
  { value: "XX yrs", caption: "[Sample] combined team experience" },
] as const;

export interface Person {
  name: string;
  title: string;
  phone: string;
  email: string;
}

// Names from the wireframe deck; titles and contact details are placeholders.
export const TEAM: Person[] = [
  { name: "Rob Barnes", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Jack Barratt", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Rupert Bentley-Smith", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Victoria Broadhead", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Woody Bruce", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Emily Cann", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Danny Cardosi", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Tom Cater", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Harry Cody-Owen", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Lucy Cope", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Luke Donohoe", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Emily Dumbell", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Millie Edwards", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Harry Elliott", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Libby Evans", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Nick Halley", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Jonny Palmer", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
  { name: "Ollie Wilkinson", title: "Title TBC", phone: "+44 (0)20 3551 5260", email: "TBC" },
];

export const LEASING_CONTACTS = TEAM.filter((p) =>
  ["Jack Barratt", "Nick Halley", "Ollie Wilkinson", "Danny Cardosi", "Jonny Palmer"].includes(p.name),
);

export interface CaseStudy {
  slug: string;
  title: string;
  service: string;
  blurb: string;
}

export const CASE_STUDIES: CaseStudy[] = [
  {
    slug: "20-hanover-square",
    title: "20 Hanover Square",
    service: "Leasing",
    blurb: "[Sample] Case study copy to follow from the leasing team.",
  },
  {
    slug: "19-golden-square",
    title: "19 Golden Square, Soho",
    service: "Investment",
    blurb: "[Sample] Case study copy to follow from the investment team.",
  },
  {
    slug: "213-214-upper-street",
    title: "213–214 Upper Street",
    service: "Investment",
    blurb: "[Sample] Value add. Sold (March 2024). Retail. Full case study copy to follow.",
  },
  {
    slug: "the-crown-estate",
    title: "The Crown Estate",
    service: "Consultancy",
    blurb: "[Sample] Case study copy to follow from the consultancy team.",
  },
];

export const BRAND_REP_CASE_STUDIES = [
  {
    name: "ATIS",
    blurb:
      "A new healthy grab & go lifestyle restaurant offering seriously tasty bowls and salads. We acquired their first site on City Road in the Atlas Building, also serving cold press juices, artisanal coffees and kombucha on tap.",
  },
  {
    name: "Fred Perry",
    blurb:
      "One of the UK's most iconic brands, steeped in a rich history of music, sport and culture. With stores worldwide and a cult following, Fred Perry continues to increase its presence in key locations.",
  },
  {
    name: "Barry's Bootcamp",
    blurb:
      "Described as the 'hardest workout in the world', BGP have been working with Barry's Bootcamp for several years to help with their acquisition strategy throughout London.",
  },
];

export const LEASE_ADVISORY_SERVICES = [
  { name: "Asset review", detail: "[Sample] Detail copy to follow." },
  { name: "Rental valuations", detail: "[Sample] Detail copy to follow." },
  {
    name: "Lease restructuring",
    detail:
      "[Sample] Advice on regears, surrenders and renewals to align the lease structure with asset strategy — detail copy to follow.",
  },
  { name: "Rent reviews", detail: "[Sample] Detail copy to follow." },
  { name: "Expert witness", detail: "[Sample] Detail copy to follow." },
];

export const CONSULTANCY_SERVICES = [
  "Pre-purchase advice for investment acquisitions, independent of our own investment team",
  "Asset management strategy and implementation",
  "[Sample] Additional service to be confirmed",
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
  body: string[] | null; // null = stub awaiting real copy
  isSample?: boolean;
}

export const ARTICLES: Article[] = [
  {
    slug: "enduring-appeal-portman-estate",
    title: "The Enduring Appeal of the Portman Estate",
    category: "Estates",
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
    slug: "store-wars-battle-of-the-retail-parks",
    title: "Store Wars: Battle of the Retail Parks",
    category: "Retail",
    date: "Date TBC",
    author: "TBC",
    standfirst: "[Sample] Article copy to follow.",
    body: null,
    isSample: true,
  },
  {
    slug: "from-shell-to-sell",
    title: "From Shell to Sell: Old Warehouses Flip to Future Workspaces",
    category: "Investment",
    date: "Date TBC",
    author: "TBC",
    standfirst: "[Sample] Article copy to follow.",
    body: null,
    isSample: true,
  },
  {
    slug: "build-it-big",
    title: "Build It Big: Developers Raise the Roof on Urban Growth",
    category: "Development",
    date: "Date TBC",
    author: "TBC",
    standfirst: "[Sample] Article copy to follow.",
    body: null,
    isSample: true,
  },
];

export const CONTACT = {
  addressLines: ["First Floor", "55 Wells Street", "London W1T 3PT"],
  phone: "020 3551 5260",
  email: "harriette@brucegillinghampollard.com",
};
