// Seed data for the Leisure Platform dashboard (/leisure-platform).
//
// Everything here was gathered in the L&G Leisure Fund deep dive on
// 2026-10-21 (AREF fund profiles, Companies House, L&G releases, trade
// press, operator directories). It is a research snapshot, not a live
// feed: the routes in leisure-platform.ts layer the live bits on top
// (Land Registry titles held by the fund's nominee companies, Companies
// House accounts for the operators). Update the figures here when a new
// AREF quarter or a sale lands; the sources tab in the page points at the
// documents each number came from.

export const LEISURE_FUND = {
  name: "The Leisure Fund Limited Partnership",
  manager: "LGIM Real Assets (Legal & General Property Partners (Operator) Ltd)",
  fundManager: "Andrew Ferguson",
  lpNumber: "LP005954",
  nomineeCompanies: [
    { name: "Legal & General Property Partners (Leisure) Limited", number: "04452915", role: "Title-holding nominee / GP member" },
    { name: "Legal & General Leisure Fund Trustee Limited", number: "04301197", role: "Title-holding trustee nominee" },
    { name: "Legal & General Property Partners (Leisure GP) LLP", number: "OC397021", role: "General partner (since Jan 2015)" },
    { name: "LGIM Real Assets (Operator) Limited", number: "05522016", role: "Operator / AIFM" },
  ],
  feeder: "The Leisure Feeder Unit Trust (Jersey JPUT), trustee JTC",
  launched: "June 2002",
  structure: "Closed-ended English LP; no redemption right; term runs to 31 December 2030 (LP6 filed 27 Dec 2018; earlier terms 2006, 2011, 2014, 2020)",
  asOf: "2026-03-31",
  navGbpM: 219.2,
  navJun2024GbpM: 245.6,
  gavJun2024GbpM: 375.8,
  debtJun2024GbpM: 137.9,
  gearingPct: 47.1,
  assets: 16,
  unitholders: 23,
  unitsInIssue: 525461,
  niyPct: 7.7,
  equivalentYieldPct: 7.6,
  rentPassingJun2024GbpM: 32.2,
  voidPctErv: 4.91,
  lender: "NatWest Markets PLC (formerly RBS) as security agent; charges re-registered Dec 2020, Mar 2021, Dec 2021, Jul 2023, Dec 2024",
  feeBps: 60,
  performanceFee: "17.5% over benchmark +1%, 3-year rolling",
  returns: { threeMonth: 0.3, ytd: 1.9, oneYear: -1.9, threeYear: -0.1, fiveYear: -8.6, tenYear: 0.4 },
  navPerUnitHistory: [
    { date: "2016-12-31", navP: 869.5 },
    { date: "2018-12-31", navP: 951.0 },
    { date: "2019-12-31", navP: 925.8 },
    { date: "2020-03-31", navP: 859.1 },
    { date: "2023-03-31", navP: 507.7 },
    { date: "2023-12-31", navP: 469.7 },
    { date: "2024-06-30", navP: 463.5 },
    { date: "2026-03-31", navP: 417.1 },
  ],
  unitholderBands: [
    { band: "Over 8%", holders: 4, pct: 44.6 },
    { band: "4% to 8%", holders: 6, pct: 33.8 },
    { band: "2% to 4%", holders: 4, pct: 11.5 },
    { band: "1% to 2%", holders: 4, pct: 5.0 },
    { band: "Under 1%", holders: 7, pct: 5.1 },
  ],
  majorHolders: { largest: 13.9, top3: 34.8, top5: 51.8, top10: 78.4, internalPct: 14.6, internalCount: 2, externalCount: 23 },
  knownInvestors: [
    { name: "Legal & General Assurance Society Ltd", status: "Founding LP Dec 1998 (53% of partner capital), 50% at Jun 2002; into the feeder Jul 2004; AREF shows 2 L&G internal accounts holding 14.6%", approach: "LGIM Real Assets (deferred)" },
    { name: "Lloyds Bank S.F. Nominees Ltd (Lloyds Bank pension schemes)", status: "Founding LP Dec 1998 (19%), 20% at Jun 2002; into the feeder Jul 2004; PitchBook: current", approach: "Lloyds Banking Group Pensions investment team" },
    { name: "Lloyds TSB Group Pension Trust (No. 2) Ltd (now Lloyds Bank Pension Scheme No. 2)", status: "Founding LP Dec 1998 as TSB Group Pension Trust (13%); into the feeder Jul 2004; PitchBook: current", approach: "Lloyds Banking Group Pensions; scheme is on a buy-out path (longevity swaps 2025)" },
    { name: "Shell Pensions Trust Ltd", status: "Founding LP Dec 1998 (16%), 17% at Jun 2002; into the feeder Jul 2004; later status not public", approach: "Shell Pensions Trust (Shell Contributory Pension Fund) property team" },
    { name: "Staffordshire Pension Fund", status: "Feeder unitholder; carried at £12.68m at 31 Mar 2026 against £16.60m cost (quarterly Portfolio of Investments); c. 5.8% of NAV", approach: "Staffordshire PF investment team (property kept in-house); Colliers / Hymans Robertson" },
    { name: "Greater Manchester Pension Fund", status: "Feeder unitholder from Dec 2002 (PitchBook: current)", approach: "Northern LGPS pool / GMPF in-house property team" },
    { name: "Kent Pension Fund", status: "Feeder unitholder from Dec 2002; £9.16m at 31 Mar 2015, absent from the 2016 list: sold 2015-16, buyer and price not public", approach: "Kent PF treasury and investments team; ask who bought" },
    { name: "ING Real Estate IM and DTZ Investors (client mandates)", status: "Named as external investors by Property Week, Apr 2010 (GAV £208m); status today unknown", approach: "CBRE Investment Management (ex-ING REIM) and DTZ Investors property teams" },
    { name: "THI Leisure Founder Ltd", status: "Original sponsor LP 1998-2002 (22 Grosvenor Square); ceased Jun 2002 when L&G took the GP", approach: "n/a" },
    { name: "The Leisure Fund Unit Trust (Jersey feeder) via its managing trustee: Mourant & Co Trustees (2004), Pavilion Trustees, LF Trustee Ltd (2015, JTC)", status: "Sole limited partner since Jul 2004; holds for all 25 unitholders; register private", approach: "JTC as trustee; secondaries advisers" },
  ],
  topTenants: [
    { tenant: "Vue Entertainment Ltd", pct: 13.9 },
    { tenant: "Odeon Cinemas Ltd (t/a Costa)", pct: 8.9 },
    { tenant: "Cine-UK Ltd", pct: 8.7 },
    { tenant: "United Cinemas International (UK) Ltd", pct: 7.1 },
    { tenant: "United Cinemas International (UK) Ltd", pct: 4.6 },
    { tenant: "Travelodge Hotels Ltd", pct: 3.3 },
    { tenant: "The Original Bowling Company Ltd", pct: 3.1 },
    { tenant: "Q-Park Limited", pct: 2.7 },
    { tenant: "Nando's Chickenland Ltd", pct: 2.5 },
    { tenant: "Nuffield Health", pct: 2.4 },
  ],
  sales: [
    { asset: "Meridian Leisure Park, Leicester", date: "2023-12", priceGbpM: 25.0, yieldPct: 8.5, buyer: "Greenridge Opportunities", agent: "Montagu Evans" },
    { asset: "Mansfield Leisure Park (L&G fund unconfirmed)", date: "2026-01", priceGbpM: 10.37, yieldPct: 9.74, buyer: "Private, Irish-backed", agent: "Montagu Evans" },
  ],
};

export type LeisureSite = {
  key: string;
  name: string;
  town: string;
  postcode: string;
  region: string;
  cinema: string;
  screens: number | null;
  cinemaChNumber: string | null;
  valueBandGbpM: string;
  pctOfFund: number | null;
  tenure: string;
  titleNumbers: string[];
  occupiers: string[];
  voids: string[];
  flags: string[];
  confidence: "confirmed" | "likely" | "unresolved";
};

export const LEISURE_SITES: LeisureSite[] = [
  { key: "coliseum", name: "Coliseum Leisure Park + Cheshire Oaks pads", town: "Ellesmere Port", postcode: "CH65 9HD", region: "North West", cinema: "Vue", screens: 16, cinemaChNumber: "04699504", valueBandGbpM: "40-50", pctOfFund: 11.39, tenure: "Leasehold", titleNumbers: ["CH430688"], occupiers: ["Tenpin", "Travelodge", "Five Guys", "Nando's", "Miller & Carter", "Bella Italia", "Chiquito", "Prezzo", "Haute Dolci", "Paradise Island Golf", "KFC (pad)", "TGI Fridays (pad)", "Costa (pad)"], voids: ["Zizzi (closed)"], flags: ["Big Table + Prezzo exposure"], confidence: "confirmed" },
  { key: "valley", name: "Valley Centertainment", town: "Sheffield", postcode: "S9 2EP", region: "Yorkshire", cinema: "Cineworld", screens: 20, cinemaChNumber: "03005901", valueBandGbpM: "40-50", pctOfFund: 11.24, tenure: "Freehold", titleNumbers: ["SYK356620"], occupiers: ["Hollywood Bowl (28 lanes)", "Five Guys", "Pizza Express", "Nando's", "Bella Italia", "Frankie & Benny's", "Burger King", "Laser Quest", "Paradise Island Golf", "Monkey Bizness"], voids: ["Ex-Chiquito: consent Feb 2026 for 300-cover Wetherspoon"], flags: ["Cineworld restructuring-plan class unknown"], confidence: "confirmed" },
  { key: "bh2", name: "BH2", town: "Bournemouth", postcode: "BH2 5AU", region: "South West", cinema: "Odeon", screens: 10, cinemaChNumber: "01854132", valueBandGbpM: "30-40", pctOfFund: 10.51, tenure: "Not confirmed", titleNumbers: [], occupiers: ["Adventure Leisure x2 (31,000 sq ft)", "Boom Battle Bar", "Escape Hunt", "Five Guys", "Nando's", "Prezzo", "ASK", "Real Greek", "Slim Chickens", "Miller & Carter", "BrewDog", "Pizza Express", "Shark Tail", "Yogoo"], voids: ["TGI Fridays 8,148 sq ft (closed Jan 2026)"], flags: ["Adventure Leisure covenant (sister site closed Jun 2026)"], confidence: "confirmed" },
  { key: "light-leeds", name: "The Light", town: "Leeds", postcode: "LS1 8TL", region: "Yorkshire", cinema: "Vue", screens: 14, cinemaChNumber: "04699504", valueBandGbpM: "30-40", pctOfFund: 10.38, tenure: "Not confirmed", titleNumbers: [], occupiers: ["Radisson Blu (148 beds)", "Nuffield Health", "Turtle Bay", "Prezzo", "Junkyard Golf", "Fun Station"], voids: ["Small units 230-3,393 sq ft to let"], flags: ["Fund ownership from AREF only"], confidence: "confirmed" },
  { key: "broadway", name: "Broadway Plaza", town: "Birmingham", postcode: "B16 8LP", region: "West Midlands", cinema: "Odeon Luxe", screens: 12, cinemaChNumber: "01854132", valueBandGbpM: "30-40", pctOfFund: 9.37, tenure: "Not confirmed", titleNumbers: [], occupiers: ["Hollywood Bowl (25-yr lease)", "Travelodge", "Nuffield Health", "Rock Up", "Meat Club", "Domino's", "Costa", "1,300-space car park"], voids: ["Mr Mulligans (closed Jun 2026); 360 Play opening Dec 2026"], flags: ["Bought £46.95m Sept 2018", "EV charging live"], confidence: "confirmed" },
  { key: "greenwich", name: "Millennium Leisure Park", town: "Greenwich", postcode: "SE10 0QJ", region: "London", cinema: "Odeon", screens: 14, cinemaChNumber: "01854132", valueBandGbpM: "30-40", pctOfFund: 9.14, tenure: "Not confirmed", titleNumbers: [], occupiers: ["Nando's", "Burger King", "Sichuan"], voids: ["Pizza Hut (closed Oct 2025)"], flags: ["Adjacent 1,251-home consent cuts shared parking 1,035 to 865"], confidence: "confirmed" },
  { key: "barbican", name: "Barbican Leisure Park", town: "Plymouth", postcode: "PL4 0LG", region: "South West", cinema: "Vue", screens: null, cinemaChNumber: "04699504", valueBandGbpM: "30-40", pctOfFund: 8.17, tenure: "Not confirmed", titleNumbers: [], occupiers: ["Tenpin (26 lanes)", "Nuffield Health", "Pizza Express", "Nando's", "Bella Italia", "Frankie & Benny's", "Pizza Hut", "Fry's Grillhouse"], voids: ["Pryzm nightclub box (closed Jan 2024)"], flags: ["168,000 sq ft"], confidence: "confirmed" },
  { key: "aspects", name: "Aspects Leisure Park", town: "Longwell Green, Bristol", postcode: "BS15 9LA", region: "South West", cinema: "Vue", screens: 13, cinemaChNumber: "04699504", valueBandGbpM: "10-20", pctOfFund: 5.06, tenure: "Leasehold", titleNumbers: ["GR203928", "GR219127"], occupiers: ["Hollywood Bowl", "The Gym Group", "Nando's", "McDonald's", "Kaspa's", "Wishing Well (Greene King)"], voids: ["Frankie & Benny's (Jan 2026)", "Pizza Hut (Oct 2025)", "Ex-Chiquito (2020)", "Unit 10 5,102 sq ft at £128,000"], flags: ["Three restaurant voids"], confidence: "confirmed" },
  { key: "vangarde", name: "Vangarde Leisure Park", town: "York", postcode: "YO32 9AE", region: "Yorkshire", cinema: "Cineworld", screens: 13, cinemaChNumber: "03005901", valueBandGbpM: "10-20", pctOfFund: 5.04, tenure: "Leasehold (York Community Stadium)", titleNumbers: [], occupiers: ["Hollywood Bowl", "Puttstars", "Loungers", "NHS x3", "York Against Cancer", "City of York Council"], voids: ["R4(B) 3,259 sq ft"], flags: ["Built by the fund 2017-19 (£35m)"], confidence: "confirmed" },
  { key: "merthyr", name: "Merthyr Leisure Village", town: "Merthyr Tydfil", postcode: "CF48 1UT", region: "Wales", cinema: "Vue", screens: null, cinemaChNumber: "04699504", valueBandGbpM: "10-20", pctOfFund: 3.34, tenure: "Leasehold", titleNumbers: ["CYM403922"], occupiers: ["Travelodge", "Nando's", "Frankie & Benny's", "McDonald's", "Subway", "Oriental Garden"], voids: [], flags: ["£300m Rhydycar West resort approved Jan 2026 next door"], confidence: "confirmed" },
  { key: "bradford", name: "The Leisure Exchange", town: "Bradford", postcode: "BD1 5LD", region: "Yorkshire", cinema: "Cineworld", screens: null, cinemaChNumber: "03005901", valueBandGbpM: "5-10", pctOfFund: 2.7, tenure: "Leasehold", titleNumbers: ["WYK680347"], occupiers: ["Hollywood Bowl (28 lanes)", "Holiday Inn Express", "Nando's", "Funzy"], voids: ["Ex-Grosvenor casino 25,000 sq ft (consent Aug 2026 for Funzy)", "Unit A2"], flags: ["Was 5.15% of fund in 2019"], confidence: "confirmed" },
  { key: "middlesbrough", name: "Middlesbrough Leisure Park", town: "Middlesbrough", postcode: "TS4 2AP", region: "North East", cinema: "Odeon Luxe (ex-Cineworld)", screens: 11, cinemaChNumber: "01854132", valueBandGbpM: "5-10", pctOfFund: 2.0, tenure: "Freehold + leasehold", titleNumbers: ["CE158802", "CE159797", "CE157799", "CE158809"], occupiers: ["Nando's", "McDonald's", "Subway"], voids: ["Unit 3 43,000 sq ft", "Unit 2 3,228", "Unit 2A 3,700", "Unit 5a 2,606 (£60,000)", "Pizza Hut (Oct 2025)"], flags: ["Cineworld closed Jan 2025; Odeon reopened Jun 2025"], confidence: "confirmed" },
  { key: "stafford", name: "Waterfront", town: "Stafford", postcode: "ST16 2HQ", region: "West Midlands", cinema: "Odeon Luxe", screens: 6, cinemaChNumber: "01854132", valueBandGbpM: "5-10", pctOfFund: 1.7, tenure: "Not confirmed", titleNumbers: [], occupiers: ["Superbowl UK", "Nando's", "Zizzi", "Greggs", "Costa"], voids: ["Two 4-5,000 sq ft units"], flags: ["Bought c. £10m from LXB 2018"], confidence: "confirmed" },
  { key: "aldershot", name: "Westgate Leisure Park", town: "Aldershot", postcode: "GU11 1WG", region: "South East", cinema: "Cineworld", screens: 8, cinemaChNumber: "03005901", valueBandGbpM: "5-10", pctOfFund: 2.5, tenure: "Not confirmed", titleNumbers: ["HP737689"], occupiers: ["Morrisons", "Travelodge (91 beds)", "Superbowl", "Pure Gym", "Pizza Express", "Nando's"], voids: ["One restaurant unit"], flags: ["Title charged to the fund's facility 2013; only SE candidate"], confidence: "likely" },
  { key: "yeovil", name: "Yeovil (Old Town Station land)", town: "Yeovil", postcode: "BA20 1NP", region: "South West", cinema: "Cineworld (unverified)", screens: null, cinemaChNumber: "03005901", valueBandGbpM: "10-20", pctOfFund: 4.0, tenure: "Freehold (per 2014 charge)", titleNumbers: [], occupiers: [], voids: [], flags: ["Named in the Dec 2014 charge over the nominee; likely the unidentified South West asset"], confidence: "unresolved" },
  { key: "sixteenth", name: "Ashton Leisure Park or Castlegate Dudley", town: "Ashton-under-Lyne / Dudley", postcode: "OL7 0PG", region: "North West / West Midlands", cinema: "Cineworld (14) / Showcase (14)", screens: 14, cinemaChNumber: null, valueBandGbpM: "5-10", pctOfFund: 1.5, tenure: "Not confirmed", titleNumbers: [], occupiers: ["Hollywood Bowl", "Nando's", "Frankie & Benny's", "Chiquito", "Pizza Hut"], voids: ["Pizza Hut closures Oct 2025 at both", "F&B Dudley closed Aug 2025"], flags: ["One of these is probably the 16th asset"], confidence: "unresolved" },
];

export type LeisureOperator = {
  name: string;
  chNumber: string;
  kind: "cinema" | "leisure" | "f&b" | "hotel";
  owner: string;
  sitesOnParks: string[];
  latestFromResearch: string;
  propertyOwned: string;
  verdict: string;
};

export const LEISURE_OPERATORS: LeisureOperator[] = [
  { name: "Vue Entertainment Ltd", chNumber: "04699504", kind: "cinema", owner: "Vue International (post 2023/24 debt-for-equity)", sitesOnParks: ["Coliseum", "The Light Leeds", "Barbican", "Aspects", "Merthyr"], latestFromResearch: "FY Nov 2025: turnover £313.0m (+9.2%), PBT +£38.6m, cash £79.6m", propertyOwned: "Leasehold estate", verdict: "Strongest UK chain; 13.9% of fund rent" },
  { name: "Odeon Cinemas Ltd", chNumber: "01854132", kind: "cinema", owner: "AMC Entertainment", sitesOnParks: ["BH2", "Broadway Plaza", "Greenwich", "Middlesbrough", "Stafford"], latestFromResearch: "FY Dec 2025: turnover £221.2m (+4.8%), loss before tax £52.5m after £22m parent interest; rent £47.4m", propertyOwned: "Freehold NBV £0.24m", verdict: "Parent-dependent but still opening boxes" },
  { name: "Cine-UK Ltd (Cineworld)", chNumber: "03005901", kind: "cinema", owner: "Cineworld Holdings", sitesOnParks: ["Valley Centertainment", "Vangarde", "Bradford", "Aldershot", "Yeovil?"], latestFromResearch: "FY Dec 2025: turnover £185.3m (−5%), PBT +£5.1m; 2024 restructuring plan cut rents at c. 60 sites, 11+ exits", propertyOwned: "Short leasehold only; lease liabilities £213m", verdict: "Weakest covenant on the parks" },
  { name: "Harbor Lights Entertainment (UK) Ltd (Showcase)", chNumber: "02141131", kind: "cinema", owner: "Paramount Skydance (Ellison)", sitesOnParks: ["Castlegate Dudley?", "Teesside", "Birstall"], latestFromResearch: "FY Jan 2025: turnover £89.95m, loss £1.9m, net liabilities £70m; circuit for sale (£55m Light/Frasers deal stalled 2026)", propertyOwned: "Opco nil; freeholds (reported 11) in US affiliate OE028889", verdict: "For sale — property-partner opportunity" },
  { name: "Merlin Cinemas Ltd", chNumber: "03664605", kind: "cinema", owner: "Employee Ownership Trust (Geoff Greaves)", sitesOnParks: [], latestFromResearch: "FY Apr 2025: turnover £11.1m (+16%), PBT £0.67m", propertyOwned: "Freehold NBV £10.8m, 'largely freehold'", verdict: "Best freehold-backed independent; relationship" },
  { name: "WTW-Scott Cinemas Ltd", chNumber: "04069346", kind: "cinema", owner: "Williams family", sitesOnParks: [], latestFromResearch: "FY Mar 2025: turnover £9.0m, PBT £252k", propertyOwned: "Freehold NBV £4.4m (group)", verdict: "Possible seller of marginal freehold sites" },
  { name: "Reel Cinemas Ltd", chNumber: "03561597", kind: "cinema", owner: "Suri family", sitesOnParks: [], latestFromResearch: "FY Jan 2026: turnover £15.3m (−5%), loss £1.37m", propertyOwned: "Freeholds in family propco, not opco", verdict: "Propco conversation only" },
  { name: "Everyman Media Group plc", chNumber: "08684079", kind: "cinema", owner: "AIM listed; delisting talk Jul 2026", sitesOnParks: [], latestFromResearch: "FY25 revenue £116.6m; H1 2026 +23.5%, PBT £1.9m; net debt £17.4m", propertyOwned: "None", verdict: "In play but fails freehold test" },
  { name: "Hollywood Bowl Group plc", chNumber: "10229630", kind: "leisure", owner: "LSE listed", sitesOnParks: ["Valley Centertainment", "Broadway Plaza", "Aspects", "Vangarde", "Bradford"], latestFromResearch: "FY Sep 2025: revenue £250.7m, PBT £34.6m, net cash £15.2m", propertyOwned: "UK leasehold; £5.8m Canadian freehold", verdict: "Best non-cinema covenant; expansion partner" },
  { name: "Tenpin Ltd", chNumber: "04789703", kind: "leisure", owner: "Trive Capital (2024)", sitesOnParks: ["Coliseum", "Barbican"], latestFromResearch: "FY Dec 2025: revenue £146.5m, PBT £19.0m, 57 centres", propertyOwned: "Freehold NBV £4.8m (one site)", verdict: "Sound" },
  { name: "Big Table Group (Bella Italia, F&B, Chiquito)", chNumber: "11170327", kind: "f&b", owner: "Epiris / Cafe Rouge group", sitesOnParks: ["Coliseum", "Valley", "Barbican", "Aspects", "Merthyr"], latestFromResearch: "Rolling lease-driven closures 2025-26 (Aspects F&B Jan 2026, Dudley Aug 2025)", propertyOwned: "None", verdict: "Assume exit at break" },
  { name: "Travelodge Hotels Ltd", chNumber: "00769170", kind: "hotel", owner: "GoldenTree / Avenue / Goldman", sitesOnParks: ["Coliseum", "Broadway Plaza", "Merthyr", "Aldershot"], latestFromResearch: "Sound", propertyOwned: "Leasehold", verdict: "Hotel pads add value" },
  { name: "Nando's Chickenland Ltd", chNumber: "01955868", kind: "f&b", owner: "Enthoven family", sitesOnParks: ["Most parks"], latestFromResearch: "2.5% of fund rent", propertyOwned: "None", verdict: "Core re-let covenant" },
];

export type LeisureTarget = {
  name: string;
  type: "fund" | "direct" | "operator";
  owner: string;
  sizeGbpM: string;
  cinema: string;
  priority: "A" | "B" | "C";
  approach: string;
  note: string;
};

export const LEISURE_TARGETS: LeisureTarget[] = [
  { name: "L&G Leisure Fund units", type: "fund", owner: "23 holders via JTC; LGIM Real Assets", sizeGbpM: "219 NAV / 340 GAV", cinema: "Vue, Odeon, Cineworld", priority: "A", approach: "Document request, anchor stake, priced tender at 55-65% of NAV", note: "No liquidity since 2019; investor-consent regime" },
  { name: "Star City, Birmingham", type: "direct", owner: "Quadrant Estates / CarVal", sizeGbpM: "60-65", cinema: "Vue (regeared +25 yrs)", priority: "A", approach: "Off-market via Savills", note: "410,000 sq ft, 23 acres; drive-thru + logistics consents" },
  { name: "Five Ways, Birmingham", type: "direct", owner: "AEW UK Core Property Fund", sizeGbpM: "25", cinema: "Cineworld 12", priority: "A", approach: "Approach AEW; open-ended fund liquidity", note: "Bought out of administration 2021 at 9.5%" },
  { name: "Showcase UK circuit", type: "operator", owner: "Harbor Lights / Paramount Skydance", sizeGbpM: "55 talked", cinema: "Showcase 16 sites", priority: "A", approach: "Property partner to winning operator, or bid for freeholds", note: "£55m Light/Frasers deal stalled 2026; Greidinger, Kinepolis, Omniplex named" },
  { name: "Medway Valley, Rochester", type: "direct", owner: "Prestbury (2025, £26m, 9.45%)", sizeGbpM: "26", cinema: "Cineworld 9", priority: "B", approach: "JV or forward purchase", note: "Rent £2.6m, WAULT 10.5 yrs" },
  { name: "The Cornerhouse, Nottingham", type: "direct", owner: "Orchard Street for SJP", sizeGbpM: "65 (2017)", cinema: "Vue (replaced Cineworld 2025)", priority: "B", approach: "Approach Orchard Street", note: "SJP funds under redemption pressure (unverified)" },
  { name: "Printworks, Manchester", type: "direct", owner: "DTZ Investors", sizeGbpM: "108 (2017)", cinema: "Vue 23 IMAX", priority: "B", approach: "Approach DTZI", note: "20-yr Vue regear; nine years held" },
  { name: "Stevenage Leisure Park", type: "direct", owner: "L&G Managed Fund", sizeGbpM: "40 (2012)", cinema: "Cineworld 16", priority: "B", approach: "Ask L&G alongside fund approach", note: "Bought at 6.5%; re-base to 8.5%" },
  { name: "Festival Leisure Park, Basildon", type: "direct", owner: "Aviva Investors (Aviva portfolio brochure, Sept 2019)", sizeGbpM: "n/a", cinema: "Cineworld 54,968 sq ft", priority: "B", approach: "Portfolio approach to Aviva", note: "236,068 sq ft, 20 units: Hollywood Bowl 29,766, Travelodge 30,163, 360 Play 29,900, Mr Mulligans, Bella Italia, F&B, TGI, Pizza Hut, Harvester, Toby, Wagamama, Nando's" },
  { name: "Crawley Leisure Park", type: "direct", owner: "Aviva Investors (Aviva portfolio brochure, Sept 2019)", sizeGbpM: "n/a", cinema: "Cineworld 62,350 sq ft", priority: "B", approach: "Portfolio approach to Aviva", note: "168,326 sq ft, 8 units: Hollywood Bowl 32,502, Nuffield 39,261, Chiquito, Harvester, Xenia Lounge; Gatwick catchment" },
  { name: "Southwater Square, Telford", type: "direct", owner: "M Core / LCP (2025)", sizeGbpM: "n/a", cinema: "Cineworld 11 IMAX", priority: "B", approach: "Approach M Core", note: "Town-centre regen" },
  { name: "Other closed-ended leisure/retail LPs in run-off", type: "fund", owner: "Various", sizeGbpM: "n/a", cinema: "n/a", priority: "B", approach: "Screen AREF for funds past wind-up with zero matched bargains", note: "Same discounted-unit play" },
  { name: "Freemans Leisure Park, Leicester", type: "direct", owner: "AEW UK REIT (Jun 2025, £11.15m, 10.6%)", sizeGbpM: "11", cinema: "Odeon", priority: "C", approach: "Watch for recycling", note: "" },
  { name: "Meridian Leisure Park, Leicester", type: "direct", owner: "Greenridge Opportunities (Dec 2023, £25m, 8.5%)", sizeGbpM: "25", cinema: "Vue", priority: "C", approach: "Approach 2027", note: "Ex-L&G Leisure Fund" },
  { name: "Teesside Leisure Park", type: "direct", owner: "British Land (BL asset list Sept 2016: Teesside, Stockton, 569,000 sq ft, 100%)", sizeGbpM: "n/a", cinema: "Showcase de Lux", priority: "C", approach: "Carve-out approach to BL", note: "Vacant ex-casino; BL also 76.5% of Glasgow Fort" },
  { name: "Broadway Leisure, Bexleyheath", type: "direct", owner: "Aviva Investors (Aviva parks list, Sept 2019; 5 units)", sizeGbpM: "n/a", cinema: "Cineworld", priority: "C", approach: "Same Aviva portfolio conversation", note: "From Woody's Aviva file; current ownership to confirm" },
  { name: "Leigh Sports Village leisure", type: "direct", owner: "Aviva Investors (Aviva parks list, Sept 2019; 8 units)", sizeGbpM: "n/a", cinema: "to confirm", priority: "C", approach: "Same Aviva portfolio conversation", note: "From Woody's Aviva file; current ownership to confirm" },
  { name: "Westgate, Wakefield", type: "direct", owner: "Wakefield Council (2019, £13.3m)", sizeGbpM: "13", cinema: "Cineworld", priority: "C", approach: "Council disposal route", note: "" },
  { name: "Robin Park, Wigan", type: "direct", owner: "Private investor (2025, £8.3m, 8.5%)", sizeGbpM: "8", cinema: "Omniplex", priority: "C", approach: "Pricing benchmark", note: "" },
  { name: "Mansfield Leisure Park", type: "direct", owner: "Private Irish-backed (Jan 2026, £10.37m, 9.74%)", sizeGbpM: "10", cinema: "Odeon 8 IMAX", priority: "C", approach: "Private buyer may flip", note: "" },
  { name: "Merlin Cinemas", type: "operator", owner: "Employee Ownership Trust", sizeGbpM: "11 turnover / 10.8 freehold", cinema: "19 cinemas", priority: "C", approach: "Relationship; co-invest in freeholds", note: "Not for sale" },
  { name: "WTW/Scott Cinemas", type: "operator", owner: "Williams family", sizeGbpM: "9 turnover / 4.4 freehold", cinema: "10 cinemas", priority: "C", approach: "Offer for marginal freehold sites", note: "" },
  { name: "Reel Cinemas + propco", type: "operator", owner: "Suri family", sizeGbpM: "15 turnover", cinema: "15 cinemas", priority: "C", approach: "Propco conversation", note: "" },
  { name: "Buzz Bingo", type: "operator", owner: "ICG; Oakvale running a sale (Oct 2026)", sizeGbpM: "241 revenue", cinema: "n/a", priority: "C", approach: "Watch", note: "Bingo boxes sit on leisure parks" },
];

export type DataRoomSource = {
  title: string;
  kind: "fund" | "companies-house" | "accounts" | "press" | "site" | "market" | "operators" | "owners";
  url: string | null;
  file: string | null;
  date: string;
  note: string;
};

// The data room register. `file` is served from docs/leisure-platform/data-room/.
export const DATA_ROOM: DataRoomSource[] = [
  { title: "AREF fund page — Leisure Fund LP (data at 31 Mar 2026)", kind: "fund", url: "https://www.aref.org.uk/funds/leisure-fund-limited-partnership.html", file: null, date: "2026-03-31", note: "NAV £219.2m, 16 assets, 23 holders, gearing 47.1%, NIY 7.7%" },
  { title: "AREF Property Fund Vision profile (data to Jun 2024)", kind: "fund", url: "https://www.aref.org.uk/asset/E3849810-A837-4224-B2F6F6DAC9F7EFEE", file: "aref-leisure-fund-profile-2024.pdf", date: "2024-06-30", note: "Top-10 assets, tenants, debt £137.9m, unitholder bands, fees, liquidity" },
  { title: "AREF profile, earlier (c. 2019-20)", kind: "fund", url: "https://www.aref.org.uk/asset/AEAADB25-ACA4-4220-BF4DA5B68539B8A1/", file: "aref-leisure-fund-profile-2019.pdf", date: "2020-03-31", note: "NAV £451.4m, 18 assets, NAV per unit history" },
  { title: "LGIM Leisure Property Investment Fund page", kind: "fund", url: "https://am.landg.com/en-uk/institutional/private-markets/real-estate-equity/specialist-funds/leisure-property-investment-fund/", file: null, date: "2020-12-31", note: "Strategy, 18 properties, 115+ occupiers" },
  { title: "L&G press release: Broadway Plaza acquisition, fund over £600m", kind: "press", url: "https://group.legalandgeneral.com/media/gt3houyi/100918-birmingham-leisure-fund-acquisition-final.pdf", file: "lg-press-broadway-plaza-2018.pdf", date: "2018-09-10", note: "18 assets, WAULT 15 yrs, 2017 return 12.9%" },
  { title: "Companies House: The Leisure Fund LP (LP005954) filing history", kind: "companies-house", url: "https://find-and-update.company-information.service.gov.uk/company/LP005954/filing-history", file: null, date: "2019-01-04", note: "LP6 partner admissions, term changes 2011 and 2019, GP appointed 2015" },
  { title: "Companies House: L&G Property Partners (Leisure) Ltd charges", kind: "companies-house", url: "https://find-and-update.company-information.service.gov.uk/company/04452915/charges", file: null, date: "2024-12-02", note: "NatWest security agent; title numbers for Coliseum, Sheffield, Aspects, Merthyr, Bradford, Middlesbrough, Aldershot, Yeovil, York stadium" },
  { title: "Companies House: L&G Leisure Fund Trustee Ltd charges", kind: "companies-house", url: "https://find-and-update.company-information.service.gov.uk/company/04301197/charges", file: null, date: "2024-12-02", note: "Mirror charges on the trustee nominee" },
  { title: "Companies House: Leisure GP LLP officers (OC397021)", kind: "companies-house", url: "https://find-and-update.company-information.service.gov.uk/company/OC397021/officers", file: null, date: "2014-12-10", note: "Members: L&G Property Ltd and L&G Property Partners (Leisure) Ltd" },
  { title: "PEI / Real Estate Capital: £150m refinancing (RBS + LGIM)", kind: "press", url: "https://www.pei-privaterealestate.com/credit/lg-secures-150m-to-refinance-leisure-fund/", file: null, date: "2015-09-21", note: "£30m term + £60m RCF (RBS) + £60m LGIM term, 5 years, all-in under 2.7%" },
  { title: "Health Club Management: £67m raise, 8 assets, £260m", kind: "press", url: "https://www.healthclubmanagement.co.uk/health-club-management-news/Legal-General-announce-%C2%A367m-investment-into-Leisure-Fund/305841", file: null, date: "2013-06-20", note: "Cost of debt 5.3%, distribution over 6%" },
  { title: "Property Week: Meridian Leisure Park sold £25m", kind: "press", url: "https://www.propertyweek.com/news/meridian-leisure-park-in-leicester-sold-for-25m", file: null, date: "2023-12-21", note: "8.5% yield, Greenridge, Montagu Evans" },
  { title: "Montagu Evans: Mansfield Leisure Park sold £10.37m", kind: "press", url: "https://www.montagu-evans.co.uk/news/lg-sells-mansfield-leisure-park-for-10-37-million/", file: null, date: "2026-01-15", note: "9.74% NIY, Odeon 8 + IMAX" },
  { title: "Savills: UK leisure investment market", kind: "market", url: "https://www.savills.co.uk/research_articles/229130/388824-0", file: null, date: "2026-03-12", note: "Prime multi-let leisure 8.0%; 2025 deals Medway, Freemans, Robin Park, Southwater" },
  { title: "UK Cinema Association: August 2026 admissions", kind: "market", url: "https://www.cinemauk.org.uk/2026/09/stunning-august-admissions-see-uk-cinema-power-ahead-in-2026/", file: null, date: "2026-09-10", note: "17.0m August, +56%; YTD admissions +15%, box office +22%" },
  { title: "UK Cinema Association: 2025 full year", kind: "market", url: "https://www.cinemauk.org.uk/2026/01/uk-box-office-holds-firm-in-2025/", file: null, date: "2026-01-15", note: "123.5m admissions (−2.4%), £989.5m box office" },
  { title: "Vue Entertainment Ltd accounts FY to 30 Nov 2025", kind: "accounts", url: "https://find-and-update.company-information.service.gov.uk/company/04699504/filing-history", file: "vue-entertainment-fy2025.pdf", date: "2026-07-04", note: "Scanned filing; turnover £313.0m, PBT £38.6m" },
  { title: "Odeon Cinemas Ltd accounts FY to 31 Dec 2025", kind: "accounts", url: "https://find-and-update.company-information.service.gov.uk/company/01854132/filing-history", file: "odeon-cinemas-fy2025.pdf", date: "2026-09-21", note: "Scanned filing; turnover £221.2m, loss £52.5m" },
  { title: "Cine-UK Ltd accounts FY to 31 Dec 2025", kind: "accounts", url: "https://find-and-update.company-information.service.gov.uk/company/03005901/filing-history", file: "cine-uk-fy2025.pdf", date: "2026-10-02", note: "Scanned filing; turnover £185.3m, PBT £5.1m" },
  { title: "Harbor Lights Entertainment (UK) Ltd accounts FY to Jan 2025 (Showcase)", kind: "accounts", url: "https://find-and-update.company-information.service.gov.uk/company/02141131/filing-history", file: "showcase-harbor-lights-uk-fy2025.pdf", date: "2025-10-01", note: "Turnover £89.95m, loss £1.9m, net liabilities £70m" },
  { title: "Merlin Cinemas Ltd accounts FY to Apr 2025", kind: "accounts", url: "https://find-and-update.company-information.service.gov.uk/company/03664605/filing-history", file: "merlin-cinemas-fy2025.pdf", date: "2025-12-01", note: "Freehold NBV £10.8m" },
  { title: "Savoy Cinemas Ltd accounts FY Dec 2025", kind: "accounts", url: "https://find-and-update.company-information.service.gov.uk/company/04089112/filing-history", file: "savoy-cinemas-fy2025.pdf", date: "2026-09-01", note: "Gainsborough freehold" },
  { title: "Light Cinemas Group Ltd accounts to Jul 2025", kind: "accounts", url: "https://find-and-update.company-information.service.gov.uk/company/08822170/filing-history", file: "light-cinemas-group-2025.pdf", date: "2026-04-01", note: "Going-concern uncertainty; no property" },
  { title: "Tenpin Ltd accounts FY Dec 2025", kind: "accounts", url: "https://find-and-update.company-information.service.gov.uk/company/04789703/filing-history", file: "tenpin-fy2025.pdf", date: "2026-09-01", note: "Revenue £146.5m" },
  { title: "Omniplex Holdings (NI) Ltd accounts FY Oct 2025", kind: "accounts", url: "https://find-and-update.company-information.service.gov.uk/company/NI033794/filing-history", file: "omniplex-ni-fy2025.pdf", date: "2026-07-01", note: "Property at valuation £36.6m" },
  { title: "Curzon parent accounts FY2025", kind: "accounts", url: "https://find-and-update.company-information.service.gov.uk/company/12349129/filing-history", file: "curzon-media-group-fy2025.pdf", date: "2026-09-01", note: "Short leasehold only" },
  { title: "Picturehouse Cinemas Ltd accounts FY2024", kind: "accounts", url: "https://find-and-update.company-information.service.gov.uk/company/02310403/filing-history", file: "picturehouse-fy2024.pdf", date: "2025-10-01", note: "Loss £10.2m" },
  { title: "Hollywood Bowl Group annual report 2025", kind: "operators", url: "https://www.hollywoodbowlgroup.com/application/files/4017/6760/2051/HollywoodBowl_AR25_Full_report.pdf", file: null, date: "2025-12-01", note: "Revenue £250.7m; freehold £5.8m (Canada)" },
  { title: "Everyman Media Group H1 2026 RNS", kind: "operators", url: "https://data.fca.org.uk/artefacts/NSM/RNS/30fb5b41-80bc-4409-9ce9-e6e631e2e5af.html", file: null, date: "2026-07-27", note: "Revenue +23.5%, delisting talk" },
  { title: "Screen Daily: Showcase UK sale to The Light in doubt", kind: "operators", url: "https://www.screendaily.com/news/sale-of-showcases-uk-cinemas-to-the-light-in-doubt/5219269.article", file: null, date: "2026-08-01", note: "Frasers re-cut price; circuit back on market" },
  { title: "Macfarlanes: Cineworld restructuring plan", kind: "operators", url: "https://www.macfarlanes.com/insights/102jku6/never-say-never-again-cineworlds-restructuring-plan-overrides-promises-not-to/", file: null, date: "2024-10-01", note: "Rent cuts; permission to appeal" },
  { title: "Completely Retail: L&G leisure schemes portfolio", kind: "site", url: "https://completelyretail.co.uk/portfolio/LegalAndGeneral/schemes/leisure-schemes", file: null, date: "2026-10-21", note: "18 L&G leisure schemes across all L&G funds" },
  { title: "Curson Sowerby: BH2 tenant schedule", kind: "site", url: "https://www.cspretail.com/properties/bh2/", file: null, date: "2024-04-02", note: "17 units, 131,473 sq ft" },
  { title: "Curson Sowerby: Vangarde tenant schedule", kind: "site", url: "https://www.cspretail.com/properties/vangarde-leisure-park/", file: null, date: "2024-04-11", note: "Cineworld 49,482 sq ft; one void" },
  { title: "Royal Greenwich planning report 24/1695/F (Millennium Retail Park car park)", kind: "site", url: "https://committees.royalgreenwich.gov.uk/documents/s14646/6%20-%20Millennium%20Retail%20Prk%20Car%20Park%2059%20Bugsbys%20Way%20land%20bound%20by%20Bugsbys%20Way%20Peartree%20Way%20and%20.pdf", file: null, date: "2025-05-17", note: "Parking falls 1,035 to 865; no obligation to re-provide Odeon parking" },
  { title: "Shef News: Wetherspoon consent at Valley Centertainment", kind: "site", url: "https://shefnews.co.uk/index.php/2026/02/27/green-light-given-to-new-wetherspoons-on-sheffield-leisure-complex/", file: null, date: "2026-02-27", note: "Ex-Chiquito unit" },
  { title: "Asian Standard: Bradford Leisure Exchange casino conversion approved", kind: "site", url: "https://www.asianstandard.co.uk/plan-to-create-best-entertainment-centre-in-the-uk-is-approved/", file: null, date: "2026-08-15", note: "Funzy expansion" },
  { title: "Time Out: TGI Fridays closures Jan 2026", kind: "site", url: "https://www.timeout.com/uk/news/tgi-fridays-has-shut-16-uk-restaurants-full-list-of-closed-locations-011526", file: null, date: "2026-01-15", note: "BH2 closed" },
  { title: "Heart: Pizza Hut 68 closures Oct 2025", kind: "site", url: "https://www.heart.co.uk/lifestyle/pizza-hut-closing-68-uk-stores-full-list-locations-restaurants-shut/", file: null, date: "2025-10-20", note: "Greenwich, Middlesbrough, Aspects, Ashton, Dudley" },
  { title: "Allsop: northern alternatives, drive-thru rents and yields", kind: "market", url: "https://www.allsop.co.uk/professional-services-management/valuation/intelligence-hub/northern-spotlights/northern-alternatives-sector/", file: null, date: "2025-06-01", note: "Rents over £100k pa; prime 5.5%" },
  { title: "Savills: EV charging income for landlords", kind: "market", url: "https://www.savills.co.uk/insight-and-opinion/savills-news/349355-0/commercial-landlords-could-be-missing-out-on-up-to-%C2%A31.25m-income-from-ev-charging-sites", file: null, date: "2024-06-01", note: "£3-5k per bay; £0.9-1.25m per lease" },
  { title: "Workman appointed to manage Landsec's 14 leisure parks", kind: "market", url: "https://www.twinfm.com/article/workman-wins-contract-to-manage-landsecs-leisure-park-portfolio", file: null, date: "2025-12-01", note: "Landsec exclusion list" },
  { title: "Property Week: Star City marketed at £65m", kind: "market", url: "https://www.propertyweek.com/news/birminghams-star-city-placed-up-for-sale-for-65m", file: null, date: "2023-04-01", note: "Target 1" },
  { title: "AEW UK REIT RNS: Freemans Leisure Park acquisition", kind: "market", url: "https://www.investegate.co.uk/announcement/rns/aew-uk-reit--aewu/acquisition-of-a-high-yielding-leisure-park/8920556", file: null, date: "2025-06-10", note: "£11.15m, 10.6%" },
  { title: "Staffordshire Pension Fund: Portfolio of Investments at 31 Mar 2026 (Pensions Panel 2 Jun 2026)", kind: "owners", url: "https://staffordshire.moderngov.co.uk/documents/s207415/", file: null, date: "2026-06-02", note: "Line 'Leisure Fund Unit Trust – Leisure Properties – LP – Leisure': MV £12.68m, book cost £16.60m; earlier quarters £12.83m, £12.92m, £13.51m, £14.52m" },
  { title: "Property Week: L&G hires Andrew Ferguson for leisure fund", kind: "press", url: "https://www.propertyweek.com/news/lg-hires-andrew-ferguson-for-leisure-fund", file: null, date: "2010-04-01", note: "GAV £208m; 'external investors include ING and DTZ Investors'" },
  { title: "Kent Pension Fund: Report and Accounts 2015, note 15a", kind: "owners", url: "https://democracy.kent.gov.uk/documents/s59262/2015%20report%20and%20accounts%2014-08-15.pdf", file: null, date: "2015-08-14", note: "Property unit trusts over 5%: 'L & G Leisure £9,158k, 5.9%'" },
  { title: "Companies House LP005954: filings 1998-2014 (LP5 registration, LP6 partner admissions and transfers)", kind: "companies-house", url: "https://find-and-update.company-information.service.gov.uk/company/LP005954/filing-history", file: "companies-house-lp005954-filings-1998-2014.pdf", date: "2014-04-05", note: "Founding partners Dec 1998: L&G Assurance Society £2,500, Lloyds Bank S.F. Nominees £900, TSB Group Pension Trust £600, Shell Pensions Trust £750; all four assigned to the feeder trustee Mourant & Co Trustees Jul 2004; feeder subscriptions 2004-07 to £13,789 of participations" },
  { title: "Companies House LP005954: LP6 Feb 2015, feeder trustee Pavilion Trustees to LF Trustee Ltd", kind: "companies-house", url: "https://find-and-update.company-information.service.gov.uk/company/LP005954/filing-history", file: "companies-house-lp005954-lp6-2015-trustee-transfer.pdf", date: "2015-02-09", note: "£26,537 of capital contributions transferred; the feeder is the sole limited partner" },
  { title: "Companies House LP005954: LP6 Jan 2015, second GP (Leisure GP LLP)", kind: "companies-house", url: "https://find-and-update.company-information.service.gov.uk/company/LP005954/filing-history", file: "companies-house-lp005954-lp6-2015-second-gp.pdf", date: "2015-01-07", note: "L&G Property Partners (Leisure) Ltd transferred part of its GP interest to L&G Property Partners (Leisure GP) LLP" },
  { title: "Companies House LP005954: LP6 Dec 2018, term extended to 31 December 2030", kind: "companies-house", url: "https://find-and-update.company-information.service.gov.uk/company/LP005954/filing-history", file: "companies-house-lp005954-lp6-2018-term-to-2030.pdf", date: "2018-12-27", note: "Previous term 31 Dec 2014 subject to extension; new term to 31 Dec 2030 unless terminated earlier under the LPA" },
  // Files Woody uploaded on 2026-10-21; held outside the repo (drop them into docs/leisure-platform/data-room to serve them).
  { title: "Aviva Investors parks list (Woody's file: Aviva_parks.pdf)", kind: "owners", url: null, file: null, date: "2019-09-26", note: "92 Aviva retail and leisure schemes with unit counts: Festival Basildon (20), Crawley Leisure Park (8), Broadway Leisure Bexleyheath (5), Leigh Sports Village (8), MK Leisure Plaza (2), Odeon Swiss Cottage" },
  { title: "Aviva Investors portfolio brochure A-D (13315_Aviva_iPDF_A-D_26Sept19)", kind: "owners", url: null, file: null, date: "2019-09-26", note: "Festival Leisure Park Basildon 236,068 sq ft and Crawley Leisure Park 168,326 sq ft with full tenancy schedules and Aviva contacts" },
  { title: "Aviva Investors portfolio brochures E-K, L-O, P-Z (26 Sept 2019)", kind: "owners", url: null, file: null, date: "2019-09-26", note: "Rest of the Aviva retail-park estate; no further cinema-anchored parks" },
  { title: "British Land property list at 30 Sept 2016 (Woody's file)", kind: "owners", url: null, file: null, date: "2016-09-30", note: "Teesside Stockton 569,000 sq ft (100%), Glasgow Fort (76.5%), Giltbrook, Meadowhall (50%); leisure line is Virgin Active gyms and Debenhams" },
];

// Gate for the public, read-only page at /public/leisure-platform/<token>.
// Anyone with the link can read it; set LEISURE_PLATFORM_PUBLIC_TOKEN on
// Railway to rotate it without a deploy.
export const LEISURE_PLATFORM_PUBLIC_TOKEN = "766uc7el3s068nlf8062";
