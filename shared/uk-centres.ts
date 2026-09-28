// Major UK shopping centres / retail destinations — the peer set for the
// brand gap analysis ("at other schemes, not here") and the top-25
// benchmark (Woody, 2026-09-27: "need to compare the top 25 shopping
// centres in the country" … "Battersea Power Station, Capco need to be
// included too"). `top25` marks the benchmark set: BGP's working list of
// the 25 largest regional / super-regional centres plus Battersea Power
// Station and Shaftesbury Capital's West End estates; change it here. Points are
// approximate centre locations; `aliases` are the names press coverage
// uses, for matching openings news to a centre. `feedPage` is the centre's
// own what's-new page, followed through RSS.app (News → Brand watch →
// Centres, and the openings feed on the property's Brand Gap); `feedRss` is
// the site's own RSS where it has one (no RSS.app slot). Brent Cross,
// Bullring, Cabot Circus, WestQuay (Hammerson), Trafford Centre, centre:mk
// and Chinatown have no usable news page — Google News covers them.
// radiusKm: store-presence radius where the default 0.7km would swallow a
// neighbouring estate (the West End estates sit a few hundred metres apart).
// positioning "luxury": a luxury / prime destination — the peer set for a
// luxury scheme (Woody, 2026-09-28: the Royal Exchange benchmarks against
// Burlington Arcade, the Royal and Piccadilly Arcades and Bond Street, not
// regional malls). Luxury-only entries stay out of a mainstream scheme's peers.
export interface UkCentre { name: string; lat: number; lng: number; top25?: boolean; positioning?: "luxury"; aliases: string[]; radiusKm?: number; feedPage?: string; feedRss?: string }

export const UK_CENTRES: UkCentre[] = [
  { name: "Bluewater", lat: 51.4389, lng: 0.2705, top25: true, aliases: ["Bluewater"], feedPage: "https://www.bluewater.co.uk/en/news-listing-page" },
  { name: "Lakeside", lat: 51.489, lng: 0.2848, top25: true, aliases: ["Lakeside Thurrock", "intu Lakeside", "Lakeside shopping centre"], feedPage: "https://lakeside-shopping.com/category/news/", feedRss: "https://lakeside-shopping.com/category/news/feed/" },
  { name: "Westfield London", lat: 51.5074, lng: -0.221, top25: true, aliases: ["Westfield London", "Westfield White City", "Westfield Shepherd's Bush"], feedPage: "https://www.westfield.com/en/united-kingdom/london/events" },
  { name: "Westfield Stratford", lat: 51.5439, lng: -0.0079, top25: true, aliases: ["Westfield Stratford"], feedPage: "https://www.westfield.com/en/united-kingdom/stratfordcity/events" },
  { name: "Brent Cross", lat: 51.5766, lng: -0.2237, top25: true, aliases: ["Brent Cross"] },
  { name: "Canary Wharf", lat: 51.5054, lng: -0.0192, aliases: ["Canary Wharf"] },
  { name: "Battersea Power Station", lat: 51.4818, lng: -0.1445, top25: true, aliases: ["Battersea Power Station"], feedPage: "https://batterseapowerstation.co.uk/category/news/" },
  { name: "Covent Garden", lat: 51.5117, lng: -0.1233, top25: true, positioning: "luxury", aliases: ["Covent Garden"], radiusKm: 0.3, feedPage: "https://www.coventgarden.london/press-centre" },
  { name: "Carnaby", lat: 51.5132, lng: -0.1389, top25: true, aliases: ["Carnaby Street", "Carnaby London", "Carnaby"], radiusKm: 0.3, feedPage: "https://www.thisissoho.co.uk/whats-on/" },
  { name: "Chinatown London", lat: 51.5113, lng: -0.1310, top25: true, aliases: ["Chinatown London", "London's Chinatown"], radiusKm: 0.3 },
  { name: "Royal Exchange", lat: 51.5137, lng: -0.0875, positioning: "luxury", aliases: ["Royal Exchange", "The Royal Exchange"], radiusKm: 0.08 },
  { name: "Leadenhall Market", lat: 51.5128, lng: -0.0834, positioning: "luxury", aliases: ["Leadenhall Market"], radiusKm: 0.08 },
  { name: "Burlington Arcade", lat: 51.509, lng: -0.14, positioning: "luxury", aliases: ["Burlington Arcade"], radiusKm: 0.08 },
  { name: "Piccadilly Arcade", lat: 51.5079, lng: -0.1385, positioning: "luxury", aliases: ["Piccadilly Arcade"], radiusKm: 0.05 },
  { name: "Royal Arcade", lat: 51.5093, lng: -0.1418, positioning: "luxury", aliases: ["Royal Arcade Mayfair", "Royal Arcade"], radiusKm: 0.05 },
  { name: "Bond Street", lat: 51.5118, lng: -0.1438, positioning: "luxury", aliases: ["New Bond Street", "Old Bond Street", "Bond Street"], radiusKm: 0.35 },
  { name: "Mount Street Mayfair", lat: 51.5098, lng: -0.1515, positioning: "luxury", aliases: ["Mount Street"], radiusKm: 0.2 },
  { name: "Sloane Street", lat: 51.4965, lng: -0.159, positioning: "luxury", aliases: ["Sloane Street"], radiusKm: 0.4 },
  { name: "Knightsbridge", lat: 51.4994, lng: -0.1635, positioning: "luxury", aliases: ["Brompton Road", "Knightsbridge"], radiusKm: 0.25 },
  { name: "Marylebone High Street", lat: 51.5205, lng: -0.1515, positioning: "luxury", aliases: ["Marylebone High Street", "Marylebone Village"], radiusKm: 0.3 },
  { name: "Seven Dials", lat: 51.514, lng: -0.1268, positioning: "luxury", aliases: ["Seven Dials"], radiusKm: 0.15 },
  { name: "Coal Drops Yard", lat: 51.5355, lng: -0.1257, positioning: "luxury", aliases: ["Coal Drops Yard"], radiusKm: 0.15 },
  { name: "The Glades Bromley", lat: 51.4029, lng: 0.0159, aliases: ["The Glades Bromley", "Glades shopping centre"] },
  { name: "Trafford Centre", lat: 53.4669, lng: -2.3486, top25: true, aliases: ["Trafford Centre", "intu Trafford"] },
  { name: "Manchester Arndale", lat: 53.4831, lng: -2.2416, top25: true, aliases: ["Manchester Arndale", "Arndale Centre"], feedPage: "https://manchesterarndale.com/whats-on/" },
  { name: "Meadowhall", lat: 53.4139, lng: -1.4119, top25: true, aliases: ["Meadowhall"], feedPage: "https://meadowhall.co.uk/whatson" },
  { name: "Metrocentre", lat: 54.9575, lng: -1.665, top25: true, aliases: ["Metrocentre"], feedPage: "https://themetrocentre.co.uk/news" },
  { name: "Eldon Square", lat: 54.9744, lng: -1.6153, top25: true, aliases: ["Eldon Square"], feedPage: "https://eldonsquare.co.uk/category/news/", feedRss: "https://eldonsquare.co.uk/feed/" },
  { name: "Merry Hill", lat: 52.4818, lng: -2.1207, top25: true, aliases: ["Merry Hill", "Merryhill"], feedPage: "https://mymerryhill.co.uk/news/" },
  { name: "Bullring", lat: 52.4778, lng: -1.8942, top25: true, aliases: ["Bullring", "Grand Central Birmingham"] },
  { name: "Touchwood Solihull", lat: 52.4123, lng: -1.7767, aliases: ["Touchwood"] },
  { name: "centre:mk", lat: 52.0416, lng: -0.7558, top25: true, aliases: ["centre:mk", "centre mk"] },
  { name: "Rushden Lakes", lat: 52.2926, lng: -0.5813, aliases: ["Rushden Lakes"] },
  { name: "Liverpool ONE", lat: 53.4043, lng: -2.9865, top25: true, aliases: ["Liverpool ONE"], feedPage: "https://www.liverpool-one.com/whats-on/" },
  { name: "Trinity Leeds", lat: 53.7969, lng: -1.5437, top25: true, aliases: ["Trinity Leeds"], feedPage: "https://www.trinityleeds.com/en/news-listing-page" },
  { name: "White Rose Leeds", lat: 53.758, lng: -1.5738, top25: true, aliases: ["White Rose shopping centre", "White Rose Leeds", "White Rose Centre"], feedPage: "https://www.white-rose.co.uk/en/news-listing-page" },
  { name: "St David's Cardiff", lat: 51.4796, lng: -3.1748, top25: true, aliases: ["St David's Cardiff", "St Davids Cardiff", "St David's shopping centre"], feedPage: "https://www.stdavidscardiff.com/en/news-listing-page" },
  { name: "Cabot Circus", lat: 51.4586, lng: -2.5852, top25: true, aliases: ["Cabot Circus"] },
  { name: "Cribbs Causeway", lat: 51.5252, lng: -2.5983, top25: true, aliases: ["Cribbs Causeway", "The Mall at Cribbs"], feedPage: "https://www.mallcribbs.com/whats-on/" },
  { name: "Highcross Leicester", lat: 52.636, lng: -1.1359, top25: true, aliases: ["Highcross"], feedPage: "https://highcrossleicester.com/blog" },
  { name: "Victoria Centre Nottingham", lat: 52.957, lng: -1.1482, top25: true, aliases: ["Victoria Centre Nottingham", "Victoria Centre, Nottingham", "intu Victoria Centre"], feedPage: "https://victoria-centre.com/whats-on/", feedRss: "https://victoria-centre.com/feed/" },
  { name: "The Oracle Reading", lat: 51.4525, lng: -0.9689, aliases: ["The Oracle Reading", "Oracle shopping centre"] },
  { name: "Festival Place", lat: 51.267, lng: -1.087, aliases: ["Festival Place"] },
  { name: "WestQuay", lat: 50.9034, lng: -1.4059, top25: true, aliases: ["WestQuay", "West Quay Southampton"] },
  { name: "Gunwharf Quays", lat: 50.7953, lng: -1.1077, aliases: ["Gunwharf Quays"] },
  { name: "Churchill Square Brighton", lat: 50.8225, lng: -0.1445, aliases: ["Churchill Square"] },
  { name: "The Lexicon Bracknell", lat: 51.416, lng: -0.753, aliases: ["Lexicon Bracknell", "The Lexicon"] },
  { name: "Westgate Oxford", lat: 51.75, lng: -1.2607, aliases: ["Westgate Oxford"] },
  { name: "Braintree Village", lat: 51.864, lng: 0.5457, aliases: ["Braintree Village"] },
  { name: "Braehead", lat: 55.8768, lng: -4.3651, top25: true, aliases: ["Braehead"], feedPage: "https://frasersplus.com/destinations/braehead/whats-on" },
  { name: "Silverburn", lat: 55.8214, lng: -4.3441, top25: true, aliases: ["Silverburn"], feedPage: "https://www.shopsilverburn.com/whats-new/", feedRss: "https://www.shopsilverburn.com/feed/" },
  { name: "St James Quarter", lat: 55.954, lng: -3.1852, top25: true, aliases: ["St James Quarter"], feedPage: "https://www.westfield.com/en/united-kingdom/stjamesquarter/whats-on" },
  { name: "Buchanan Galleries", lat: 55.8631, lng: -4.252, aliases: ["Buchanan Galleries"] },
];

export const TOP_25_CENTRES = UK_CENTRES.filter(centre => centre.top25);

// Peers by positioning: a luxury scheme is read against the luxury
// destinations; every other scheme against the list minus luxury-only
// entries. The benchmark rows are the top 25, or every luxury peer.
export function peerCentresFor(positioning: string | null | undefined): UkCentre[] {
  return positioning === "luxury" ? UK_CENTRES.filter(centre => centre.positioning === "luxury") : UK_CENTRES.filter(centre => centre.positioning !== "luxury" || centre.top25);
}
export function benchmarkCentresFor(positioning: string | null | undefined): UkCentre[] {
  return positioning === "luxury" ? peerCentresFor(positioning) : TOP_25_CENTRES;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// A property IS a listed centre when it sits on it: within 1.5km of the
// point (a West End estate: within its own presence radius).
export const siteRadiusKm = (centre: UkCentre) => centre.radiusKm ?? 1.5;
export function centreAt(lat: number, lng: number): UkCentre | null {
  let best: UkCentre | null = null, bestKm = Infinity;
  for (const centre of UK_CENTRES) {
    const km = haversineKm(lat, lng, centre.lat, centre.lng);
    if (km <= siteRadiusKm(centre) && km < bestKm) { best = centre; bestKm = km; }
  }
  return best;
}
