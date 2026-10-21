// The Double Bill paper: the written research, one section per page tab,
// kept as markdown so the public page, the in-app page and the exported
// copy all render the same text. Research pass 21 Oct 2026; numbers trace
// to the DATA_ROOM register in leisure-platform-data.ts.
//
// Markdown subset supported by mdToHtml: ## / ### headings, paragraphs,
// pipe tables, "- " bullets, "1. " ordered lists, "- [ ]" tasks, **bold**,
// *italic*, [text](url) links.

export type ResearchSection = { key: string; title: string; markdown: string };

export const RESEARCH: ResearchSection[] = [
  {
    key: "summary",
    title: "Summary",
    markdown: `
## The short version

The L&G Leisure Fund is the way into the sector at scale: sixteen cinema-anchored parks worth about £340m, a £219m NAV, no liquidity for its 23 holders since 2019, and a manager that has been selling. Units can be bought at a discount and a blocking stake is the cheapest form of control. Around it, twenty more parks are owned by sellers with a reason to sell, the restaurant line on every park is churning, and the cinema is not dying: UK admissions are running 15% ahead of 2025.

| Question | Answer |
| --- | --- |
| What is the fund really worth against NAV? | Book NIY 7.7% against 2025-26 exits at 8.5% to 10.6%. At 9.5% the equity is about a third below the published NAV, which is the margin a unit bid should take |
| Debt | NatWest Markets (ex-RBS) as security agent; £137.9m drawn at June 2024, charges re-registered as recently as December 2024; gearing 47% |
| Who owns it | 23 external holders and two L&G accounts; the top ten hold 78%. Greater Manchester Pension Fund is a named LP |
| Who sells | Pooled LGPS funds, corporate schemes heading to buy-out, charities that bought for income, and L&G itself |
| Cinema trading | Vue strong, Odeon parent-dependent, Cineworld weakest; site-level admissions are not public, so the page tracks screens, operator accounts and lease signals per park |
| Other occupiers | Big Table, Pizza Hut, TGI Fridays and Prezzo are the churn; Hollywood Bowl, Tenpin, Travelodge, Nando's and Nuffield are the keepers |
| Next locations | Twenty parks outside Landsec and L&G, ranked; Star City, Five Ways and the Showcase freeholds lead |
| Brand and platform | Double Bill. Three routes in: fund units, direct parks, operators that own property |
| Capex | Pads, EV hubs and big-box re-lets add £150,000 to £250,000 a park a year, mostly operator-funded |

What this page is: the research, the numbers behind it and the data room, in one place, with the live layers (Land Registry titles, Companies House accounts) inside the BGP app. Prepared by Bruce Gillingham Pollard, 21 October 2026.
`,
  },
  {
    key: "fund",
    title: "The fund",
    markdown: `
## Fund snapshot

The Leisure Fund Limited Partnership is a closed-ended English LP run by LGIM Real Assets, holding 16 cinema-anchored leisure parks worth about £340m against a NAV of £219.2m at 31 March 2026. It has had no issues, redemptions or matched unit transfers since 2019, so the only way in is a negotiated transfer from one of its 23 unitholders.

| Item | Detail |
| --- | --- |
| Vehicle | English limited partnership, [LP005954](https://find-and-update.company-information.service.gov.uk/company/LP005954/filing-history), launched June 2002; investors enter via The Leisure Feeder Unit Trust, a Jersey property unit trust |
| Manager / operator | Legal & General Property Partners (Operator) Ltd (AIFM); GP is Legal & General Property Partners (Leisure GP) LLP; fund manager Andrew Ferguson |
| Trustee / auditor / valuer | JTC (feeder trustee); PwC; Knight Frank, quarterly |
| Status | Closed-ended. Term runs to 31 December 2030 (LP6 filed 27 Dec 2018, after earlier terms to 2006, 2011, 2014 and 2020); AREF's "earliest wind-up 31 Dec 2020" field is stale |
| NAV | £219.2m (31 Mar 2026); £245.6m (30 Jun 2024); £451.4m (c. 2019) |
| Units in issue | 525,461, unchanged since 2017. Implied NAV per unit c. £417 at Mar 2026 against £951 at Dec 2018 |
| Assets | 16 directly held (Mar 2026); 17 valued at £375.8m (Jun 2024); 18 and £600m+ GAV at the 2018 peak |
| Gearing | 47.1% (Mar 2026 headline). Jun 2024: debt £137.9m, net debt to property 34.7%, to equity 53.0%. Cap 55% of GAV |
| Yields | NIY 7.7% (Mar 2026); Jun 2024 NIY 7.5%, equivalent 7.6%, true equivalent 8.0% |
| Fees | 60 bps a year of NAV; performance fee 17.5% over benchmark +1% on a 3-year rolling basis |
| Distributions | 100% of income, 20 days after quarter end; c. 7.6p a unit a quarter in 2024 |
| Performance | 5-year annualised total return −8.6% against +1.2% for balanced funds (to Jun 2024); 10-year +0.4% against +5.7% |
| Governance | AREF states all transactions "currently require investor approval" and the investment restrictions are "under revision" |

Sales since 2023: [Meridian Leisure Park, Leicester](https://www.propertyweek.com/news/meridian-leisure-park-in-leicester-sold-for-25m) for £25m at 8.5% (Dec 2023, Greenridge Opportunities) and [Mansfield Leisure Park](https://www.montagu-evans.co.uk/news/lg-sells-mansfield-leisure-park-for-10-37-million/) for £10.37m at 9.74% (Jan 2026; which L&G fund owned it is unconfirmed). Both sold via Montagu Evans.

## Gating: what "gated" means here

The fund was never formally suspended. It is closed-ended with no redemption right at all, the partners extended its term to 31 December 2030 in December 2018, and AREF records zero units issued, redeemed or transferred in every year from 2019 to 2024. Investors are locked in until 2030 unless they find a buyer themselves or vote to wind up early.

| Point | Evidence |
| --- | --- |
| No redemption mechanism | AREF: "The fund is closed-ended. However, the manager can raise new investment in the fund and bring in new partners." Minimum disinvestment: N/A |
| No secondary activity | Matched bargains 0 in 2019; none 2020 to 2024. Units in issue flat at 525,461 |
| Term extended to 2030 | LP6 filings: term to 3 Nov 2011 (Jan 2004), 31 Dec 2014 (Sep 2006), 31 Dec 2020 (Apr 2011), 31 Dec 2030 (Dec 2018). Four more years of lock-in than AREF's stale field suggests |
| Investors now sign off deals | AREF note: "All transactions currently require investor approval". That reads as an advisory-committee or partner-consent regime, typical of a fund in managed run-off |
| Value has halved | NAV per unit 951p (Dec 2018) to 463p (Jun 2024) to c. 417p (Mar 2026) |
| Debt still in place | NatWest Markets remains security agent; new charges registered Dec 2020, Mar 2021, Dec 2021, Jul 2023 and Dec 2024, so the facility has been amended or extended rather than repaid |

What this means for the plan: there is no fund-level liquidity for the holders, performance has been poor for a decade, and governance has already shifted towards investor consent. That is the setup in which long-standing pension-fund and insurance holders accept a discounted bid, and in which a block holder can shape the exit route.

## Unitholders: who holds the units and who is likely to sell

Twenty-three external and two L&G internal holders own 525,461 units through the Jersey feeder trust. The register is private, but AREF's concentration table shows four holders above 8% owning 44.6%, so a dominant position means buying from roughly six to ten institutions.

| Band (Jun 2024) | Holders | % of units | Value at Mar 2026 NAV (£m) |
| --- | --- | --- | --- |
| Over 8% | 4 | 44.6 | 97.8 |
| 4% to 8% | 6 | 33.8 | 74.1 |
| 2% to 4% | 4 | 11.5 | 25.2 |
| 1% to 2% | 4 | 5.0 | 11.0 |
| Under 1% | 7 | 5.1 | 11.2 |
| Largest single holder | 1 | 13.9 | 30.5 |
| Three largest | 3 | 34.8 | 76.3 |
| Ten largest | 10 | 78.4 | 171.9 |

L&G itself holds 14.6% across two accounts, so the 23 externals hold 85.4%. A 50%+ position needs about 58% of the external units; a blocking 25% needs about six of the top ten.

## Who holds it: the Companies House trail

The partnership's own filings name the founding investors and show exactly when the register went private. From December 1998 to July 2004 the investors were limited partners in their own names; on 15 July 2004 all four assigned their interests to Mourant & Co Trustees Ltd as managing trustee of The Leisure Fund Unit Trust, the Jersey feeder, and from then on the feeder has been the sole limited partner and its unit register sits with the trustee (Pavilion Trustees, then LF Trustee Ltd / JTC from February 2015).

| Holder | Role and basis | Share of partner capital | Since | Status |
| --- | --- | --- | --- | --- |
| Legal & General Assurance Society Ltd | Founding limited partner, £2,500 of £4,750 (Dec 1998); £2,550 of £5,102 (Jun 2002) | 53%, then 50% | 7 Dec 1998 | Into the feeder Jul 2004; AREF shows two L&G internal accounts holding 14.6% today |
| Lloyds Bank S.F. Nominees Ltd (nominee for the Lloyds Bank pension schemes) | Founding limited partner, £900 then £1,021 | 19%, then 20% | 7 Dec 1998 | Into the feeder Jul 2004; PitchBook lists it as current |
| TSB Group Pension Trust Ltd, later Lloyds TSB Group Pension Trust (No. 2) Ltd, today Lloyds Bank Pension Scheme No. 2 | Founding limited partner, £600 then £681 | 13% | 7 Dec 1998 | Into the feeder Jul 2004; PitchBook lists it as current; the scheme bought £5.1bn of longevity cover in 2025 and is on a buy-out path |
| Shell Pensions Trust Ltd | Founding limited partner, £750 then £850 | 16%, then 17% | 7 Dec 1998 | Into the feeder Jul 2004; later status not public |
| Staffordshire Pension Fund | Feeder unitholder, listed as "Leisure Fund Unit Trust" in its quarterly Portfolio of Investments | £12.68m at 31 Mar 2026 (book cost £16.60m); £14.52m Sep 2023 | before 2019 | Current; about 5.8% of NAV, so likely one of the six holders at 4% to 8%. Property kept in-house outside LGPS Central; adviser Colliers, consultant Hymans Robertson |
| Greater Manchester Pension Fund | Feeder unitholder | not public (PUT holdings not itemised in its reports) | Dec 2002 | Current (PitchBook); Northern LGPS, in-house property team |
| Kent Pension Fund | Feeder unitholder; "L & G Leisure £9,158k, 5.9% of property unit trusts" in the 2015 Report and Accounts | £9.16m at 31 Mar 2015 | Dec 2002 | Former per PitchBook; last documented Mar 2015; buyer and price not public |
| THI Leisure Founder Ltd | Sponsor's founder partner (THI, 22 Grosvenor Square) | £99 to £352 | Oct 1998 | Ceased 17 Jun 2002 when L&G Property Partner (Leisure) Ltd took over as general partner |
| The Leisure Fund Unit Trust (Jersey) | Sole limited partner since 15 Jul 2004 through its managing trustee | 100% of the LP | Jul 2004 | Holds for the 25 unitholders; subscriptions through the feeder took partner capital from £5,104 (Jul 2004) to £13,789 (May 2007), then the 2013 and 2017-19 raises |

Reading it: the founding three (L&G, the Lloyds schemes, Shell) owned the whole partnership until 2004 and were diluted by the 2004-07, 2013 and 2017-19 raises; their size and age make them the likeliest to be the four holders above 8% in AREF's table, with Greater Manchester among the six at 4% to 8%. The other seventeen or so feeder unitholders came in through LGIM's 2004-07 and 2013-19 raises and are not named in any public filing; Property Week put the count at "around 30 unitholders" after the 2013 raise and Institutional Investor reported 25 investors voting the 2011 extension. A full-text sweep of the published holdings of some forty LGPS funds found no other line for the fund, which points to corporate schemes, insurers and charities for the balance.

Most likely sellers, in order:

1. LGPS funds that have pooled (Northern LGPS, ACCESS, LGPS Central, Border to Coast). Legacy closed-ended property LPs are the assets pools want off their books.
2. Corporate DB schemes heading to buy-out. Insurers will not take an illiquid LP, so trustees sell before a bulk annuity.
3. Charities and endowments that bought for income and have had distributions cut from 10p to 7.6p a quarter.
4. L&G's internal accounts, if LGIM would rather hand a run-off fund to a new sponsor than carry it.

How to get to them: the register is held by JTC as trustee and by LGIM Real Assets. Andrew Ferguson is known to BGP and will help in the long run, but the first phase runs without him and without LGIM: direct, discreet approaches to the LGPS pools through their property advisers and to corporate-scheme trustees through the secondaries desks (Lazard, Campbell Lutyens, Evercore, PJT Park Hill), pricing the bid off the public AREF, Companies House and Land Registry record. Montagu Evans, who sold Meridian and Mansfield, will know which holders have asked about an exit.
`,
  },
  {
    key: "sites",
    title: "The parks",
    markdown: `
## Valuation read-across

The June 2024 book of £375.8m on £32.2m passing rent is an 8.6% gross and 7.5% net initial yield, with the portfolio 22% over-rented against ERV and 4.9% void. Comparable trades since are Meridian 8.5% (Dec 2023), Medway Valley 9.45% (2025), Mansfield 9.74% (Jan 2026), Freemans 10.6% (Jun 2025) and Savills' prime multi-let leisure yield of 8.0% (Mar 2026). On those marks the current £340m book is fair for the top seven and generous for the £5m to £10m tail. Rent risk sits in the restaurant line, and 80% of income has 10 to 15 years unexpired, so the cinema re-gears of 2030 to 2035 are the next valuation event. The ten largest lots were 84% of value, so control of the fund is really control of seven £25m to £50m parks.

## Tenant audit: the other occupiers

The cinemas are fine; the casual-dining line is where the voids and the upside are. Across the 13 researched parks there are at least nine restaurant or leisure boxes empty or just re-let since 2024, almost all from the same four covenants.

| Covenant | Sites on the parks | 2024-26 position | Action |
| --- | --- | --- | --- |
| Big Table Group (Bella Italia, Frankie & Benny's, Chiquito) | Coliseum, Sheffield, Barbican, Aspects, Merthyr, Stafford?, Ashton/Dudley | Rolling lease-driven closures; F&B Aspects closed Jan 2026, F&B Dudley Aug 2025 | Assume exit at break; pre-market every unit now |
| Pizza Hut UK (administration Oct 2025, 68 closures) | Greenwich, Middlesbrough, Aspects closed; Barbican survived | Three voids created in one month | Re-let to QSR or drive-thru format |
| TGI Fridays (two insolvencies; 33 UK sites left) | BH2 closed Jan 2026; Cheshire Oaks pad survived | 8,148 sq ft at BH2 empty | Split or re-let to a competitive-socialising operator |
| Prezzo (2023 restructuring) | Coliseum, BH2, Leeds | Trading | Watch list |
| Adventure Leisure (Mr Mulligans) | BH2 x2 (31,000 sq ft), Broadway closed Jun 2026 | 360 Play taking a Broadway unit Dec 2026 | Covenant weak; concept strong |
| Hollywood Bowl Group plc | Sheffield, Broadway (25-yr), Aspects, Vangarde, Bradford | £250.7m revenue, net cash, 92 centres | Best non-cinema covenant; expansion partner |
| Tenpin (Trive Capital) | Coliseum, Barbican | £146.5m revenue | Sound |
| Travelodge | Coliseum, Broadway, Merthyr, Aldershot | Sound | Hotel pads add value |
| Nuffield Health | Broadway, Barbican, Leeds | Sound | Keep |
| Nando's, Five Guys, McDonald's, Miller & Carter, Loungers, Wetherspoon (incoming Sheffield) | Across the estate | Sound | Core of the re-let list |
| Q-Park | Car parks | 2.7% of rent | Keep; EV revenue sits here |

Live changes by site: BH2 TGI Fridays 8,148 sq ft (closed Jan 2026), Escape Hunt added. Broadway Plaza Mr Mulligans closed Jun 2026, 360 Play opening Dec 2026. Greenwich Pizza Hut closed; the adjacent housing scheme removes 170 shared spaces. Barbican Pryzm box vacant since Jan 2024; ex-Chiquito re-let to Fry's Grillhouse. Aspects up to three F&B voids; Unit 10 marketed at £128,000. Sheffield ex-Chiquito consented for a 300-cover Wetherspoon. Bradford ex-casino (25,000 sq ft, void since 2018) consented for Funzy. Middlesbrough Unit 3 (43,000 sq ft) and three small units to let. Vangarde one 3,259 sq ft unit void. Stafford two units marketed.
`,
  },
  {
    key: "operators",
    title: "Cinemas & operators",
    markdown: `
## Cinema trading

The market is up, the chains are not equal, and site-level admissions are not public. 2026 admissions are running 15% ahead of 2025 and box office 22% ahead on The Odyssey (£89m UK) and Spider-Man: Brand New Day (£77m to £98m depending on source), after a 2025 of 123.5m admissions that was still 30% below 2019. Per-site takings come from Comscore, which sells them; the page tracks the proxy set (operator, screens, format, operator accounts, lease status) and flags each cinema's covenant.

| Operator | FY2025 turnover | Profit or loss before tax | Read-across to the fund |
| --- | --- | --- | --- |
| Vue Entertainment Ltd | £313.0m (+9.2%), FY to Nov 2025 | +£38.6m | Anchors Coliseum (16), Light Leeds (14), Barbican, Aspects (13), Merthyr: 13.9% of fund rent. Strongest UK chain today |
| Odeon Cinemas Ltd | £221.2m (+4.8%), FY Dec 2025 | −£52.5m after £22m interest to AMC | Anchors BH2 (10), Broadway Luxe (12), Greenwich (14 IMAX), Middlesbrough Luxe (11, new 2025), Stafford Luxe (6): c. 16% of rent. Parent-dependent but still opening boxes |
| Cine-UK Ltd (Cineworld) | £185.3m (−5%), FY Dec 2025 | +£5.1m | 2024 restructuring plan cut rents at c. 60 of 98 sites, 11+ exits including Middlesbrough. Anchors Valley (20), Vangarde (13 IMAX), Bradford, Aldershot (8): 8.7% of rent. Weakest covenant on the parks |
| Everyman Media Group plc | £116.6m FY25; H1 2026 +23.5% | loss £10.2m FY25; H1 26 +£1.9m | Not on the parks; the premium-format benchmark for a re-let; board exploring delisting |
| Harbor Lights (Showcase UK) | £89.95m FY to Jan 2025 | −£1.9m | Circuit for sale; Castlegate Dudley anchor if that is the 16th asset |

| Park | Cinema | Screens | Status 2026 | Lease signal |
| --- | --- | --- | --- | --- |
| Valley Centertainment, Sheffield | Cineworld | 20, IMAX, 4DX, ScreenX | Trading; Cineworld's largest by screens | Restructuring-plan class unknown; test at market rent |
| Coliseum, Ellesmere Port | Vue | 16, 3,390 seats | Trading | Vue re-gear programme; check for landlord contribution |
| The Light, Leeds | Vue | 14 | Trading, 25th year | Strongest Vue site in the book |
| Millennium, Greenwich | Odeon | 14, IMAX | Trading | Parking cut to 865 spaces pending |
| Vangarde, York | Cineworld | 13, IMAX | Trading | New-build 2019 lease |
| Aspects, Bristol | Vue | 13 | Trading | Three restaurant voids around it |
| Broadway Plaza, Birmingham | Odeon Luxe | 12 | Trading | 15-year lease from 2018, over 80% indexed |
| Middlesbrough | Odeon Luxe | 11, IMAX | Reopened Jun 2025 in ex-Cineworld box | The model for Cineworld exits elsewhere |
| BH2, Bournemouth | Odeon | 10 | Trading | 2017 new-build lease |
| Westgate, Aldershot | Cineworld | 8 | Trading | Weak scheme; watch list |
| Barbican, Plymouth | Vue | not confirmed | Trading | Pryzm box vacant next door |
| Merthyr | Vue | not confirmed | Trading | £300m resort approved adjacent |
| Leisure Exchange, Bradford | Cineworld | not confirmed | Trading | Casino void now re-let to Funzy |
| Waterfront, Stafford | Odeon Luxe | 6 | Trading | 2018 lease |

The accounts for all three majors are scanned-image filings; the app's accounts extractor reads them when Fetch accounts is pressed, and the chain trend plus each site's screens and seats is the admissions proxy until Comscore data is bought.

## Operators that own property

The big chains and the PE-backed leisure operators own almost nothing: Odeon UK £0.24m freehold, Cine-UK and Picturehouse all short leasehold, Vue leasehold, Hollywood Bowl £5.8m freehold (all Canadian), Tenpin £4.8m on 57 sites, Curzon, Everyman and The Light nil. The freehold-rich independents are family or employee owned, profitable, un-levered and not for sale: Merlin (£10.8m freehold, 19 cinemas, employee-owned), WTW/Scott (£4.4m freehold, 10 cinemas), Savoy (Gainsborough freehold, more in build), Omniplex NI (£36.6m property at valuation). Reel's freeholds sit in the Suri family propco, not the opco. Showcase is the only circuit actively for sale and the only one where the property is the prize: the UK opco carries no freehold, so the reported eleven freeholds sit with a US affiliate registered as an overseas entity (OE028889).
`,
  },
  {
    key: "buying",
    title: "Buying the fund",
    markdown: `
## Secondary market: how units trade and what to pay

There is no market: AREF records no matched bargains since 2019, so every trade will be a bilateral transfer of feeder units at a price you set. UK property LP secondaries clear at 15% to 35% below NAV, and this fund's record argues for the wide end.

| Input | Figure |
| --- | --- |
| NAV per unit, Mar 2026 (implied) | c. £417 (£219.2m / 525,461) |
| Distribution yield on NAV | c. 7% (7.6p a quarter at Jun 2024 on 463p) |
| Look-through yield at NAV | property NIY 7.7% geared at 47% is a 10% to 11% cash yield on equity before fees |
| Asset-level clearing yields 2025-26 | 8.5% to 10.6% on comparable parks, against 7.7% in the book |
| NAV marked to 9.0% | property c. £290m, equity c. £155m, 30% below the published NAV |
| NAV marked to 9.5% | property c. £275m, equity c. £140m, 36% below |
| Fees | 60 bps of NAV plus 17.5% of outperformance |
| Transfer taxes | Feeder (Jersey JPUT) units transfer free of SDRT; direct LP interests carry SDLT, so buy at the feeder |

Pricing logic: a bid at 55% to 65% of NAV (£230 to £270 a unit) buys the parks at a 9.5% to 10.5% look-through yield, which is where Mansfield and Freemans traded, and leaves 30 points of headroom to the book. Holders who have sat through −8.6% a year for five years and have no other exit will treat 60% of NAV as a real bid, and the 2018 to 2020 subscribers (112,098 units issued at 870p to 950p) are furthest under water.

## Control mechanics: what a dominant position actually buys

Units buy votes, not keys. The GP, the operator and the asset manager are all L&G entities, the titles sit in L&G nominees and the bank is NatWest, so control means the votes to direct or replace the manager and a lender who will consent. The thresholds live in the 2002 LPA and the feeder trust instrument, neither of which is public; the figures below are the usual English LP terms and must be checked.

| Layer | Who | What a holder can do |
| --- | --- | --- |
| Feeder units (Jersey JPUT) | 25 holders, trustee JTC | Vote at feeder level; the feeder votes its LP interest as instructed |
| English LP (LP005954) | GP: L&G Property Partners (Leisure GP) LLP; operator: LGIM Real Assets (Operator) Ltd | Ordinary resolutions (over 50%) and, per AREF, every transaction now needs investor approval; special (typically 75%) to remove the GP or operator, change the term, or wind up |
| Nominees | L&G Property Partners (Leisure) Ltd (04452915) and L&G Leisure Fund Trustee Ltd (04301197) | Hold title on bare trust; replaced automatically if the GP is replaced |
| Debt | NatWest Markets as security agent; charges 2015 to Dec 2024 over all main titles | Change-of-control and change-of-manager consents; LTV and ICR covenants |
| Fees | 60 bps NAV + 17.5% performance | A new manager can be appointed on lower fees once the operator is replaced |

What each stake buys:

- 10% to 15%: a seat in the investor-consent process, the quarterly reports and the register, and standing to requisition meetings.
- 25% plus: a blocking position on special resolutions, so no wind-up, portfolio sale or term extension happens without you. The cheapest control point.
- 50% plus: carries ordinary resolutions and, with the transaction-approval regime, the practical ability to direct sales, capex and refinancing.
- 75% plus: removal of the GP and operator and appointment of a new manager and AIFM; the end state if the aim is to run the parks as a branded platform.

## Execution route

1. Documents (weeks 1 to 3). Get the LPA, feeder trust instrument, latest quarterly report and valuation from a holder who wants out, via a secondaries adviser, not from LGIM; the manager is not approached in this phase. In parallel, pull all 16 titles and leases through the dashboard.
2. Price (week 3). Build the look-through model at 9.0%, 9.5% and 10.0% asset yields with today's rents and a void and incentive line for the restaurant tail. Working band: 55% to 65% of NAV.
3. Anchor seat (weeks 3 to 8). Buy one 2% to 4% holding from a charity or small corporate scheme to get onto the register and into the consent process.
4. L&G conversation (deferred). LGIM and Andrew Ferguson come in only once a blocking stake is in hand, with the platform proposal: a priced tender open to all holders, continuation under a new sponsor, L&G's own 14.6% taken out at the same price. Until then the manager's transfer-consent right is the one gate to plan around.
5. Tender (weeks 10 to 20). Run the tender through a secondaries adviser to the ten largest holders first. Target 25% as the floor, 50% as the base case.
6. Bank (from week 6). Open with NatWest on consent and a refinancing; test alternative lenders.
7. Convert (months 6 to 12). With over 50%, direct the asset plan; with over 75%, replace the GP and operator, cut fees, and fold the parks into Double Bill.

## Risks and watch-outs

| Risk | Why it matters | Mitigant or test |
| --- | --- | --- |
| Debt consent | NatWest's charges run over every main title; a change of manager or control without consent is an event of default | Get the facility terms via the quarterly report; approach NatWest early |
| Valuation gap | Book NIY 7.7% against trades at 8.5% to 10.6% | Price units off the asset yield, not NAV |
| Cinema re-gear cliff | 80% of rent has 10 to 15 years unexpired; Cineworld's plan cut rents at 60 of 98 sites; Odeon lost £52.5m in 2025 | Underwrite each cinema at market rent; Middlesbrough shows Odeon will take a Cineworld box |
| Restaurant churn | Big Table, Pizza Hut, TGI Fridays, Prezzo; 22% over-rented at Jun 2024 | Budget voids and incentives; the vacant boxes are the capex opportunity |
| Leasehold tenure | Coliseum, Aspects, Bradford, Merthyr are long leaseholds | Pull each lease before pricing pads or EV hubs |
| Tax | Transparent LP; LP interests trigger SDLT, feeder units do not | Buy at the feeder; take advice on the JPUT and NRCGT |
| Manager resistance | L&G has a fee stream and the LPA probably gives it transfer consent | Lead with an offer that gives LGIM an exit |
| Regulatory | The operator is an AIFM; a replacement needs permissions or a hosted AIFM | Line up a hosted AIFM before any removal vote |
| Parking erosion | Greenwich loses 170 shared spaces to housing | Treat car parks as assets in the underwrite |
| Concentration | Top three tenants 31.5% of rent; top ten 57.3% | Spread anchor risk across the wider platform |
`,
  },
  {
    key: "growth",
    title: "Growth & capex",
    markdown: `
## Next top leisure park locations beyond Landsec

Twenty cinema-anchored parks outside Landsec's 14 and the L&G Leisure Fund are ranked on the Targets tab by dominance and the chance of a motivated seller. Prime multi-let leisure yields have sat at 8.0% since Q1 2024 (Savills, Mar 2026) and 2025-26 trades cleared at 8.5% to 10.6%, so the secondary tail is priced for a platform buyer. The motivated sellers are L&G (serial seller), PE and opportunity funds with 2023-25 vintages (Greenridge, Prestbury, AEW REIT), open-ended funds (AEW Core, Aviva) and cash-strapped councils (Wakefield). Aviva's own Sept 2019 brochures confirm Festival Leisure Park Basildon and Crawley Leisure Park as Aviva holdings; British Land's list confirms Teesside.

Still to resolve by Land Registry pull: Colonnades Croydon, Valley Park Croydon, Sol Northampton, Festival Park Stoke, Ashton, Castlegate Dudley, Woodside Watford, Boldon, Kingswood Hull, Brewery Quarter Cheltenham, Cardinal Park Ipswich.

## Capex and new income: drive-thru pads, EV, reconfiguration

The parks sit on 10 to 23 acres of surface car park next to arterial roads, which is exactly the land drive-thru and charge-point operators are paying for. On today's evidence a single pad plus a charging hub adds £150,000 to £250,000 a year of indexed income per park at a cost mostly borne by the operator.

| Line | Evidence | Per-park case |
| --- | --- | --- |
| Drive-thru pads | Allsop: coffee drive-thru rents moved from c. £90,000 to over £100,000 a year; prime yields c. 5.5% with 10+ years certain. Star City holds consent for a pad; Mansfield's McDonald's drive-thru was re-geared before sale | One to two pads per park: Greggs, Starbucks, Tim Hortons, Popeyes, Costa. £100,000 to £200,000 a year capitalised at 6% adds £1.7m to £3.3m a park |
| EV charging hubs | Savills: £3,000 to £5,000 per bay a year or 5% revenue share on 30-year CPI leases; £10,000+ per bay where the landlord funds the supply. New permitted-development rights for non-domestic car parks confirmed 2026. Broadway already has charging | 12 to 24 bays per park with an operator (InstaVolt, Osprey, Gridserve, EV Network, Be.EV) funding grid and kit |
| Vacant big boxes | Middlesbrough Unit 3 (43,000 sq ft), Bradford casino (25,000 sq ft), Barbican Pryzm, BH2 TGI (8,148 sq ft) | Competitive socialising and family play (Flip Out, Gravity, Lane7, 360 Play, padel, Puttshack, Boom) take 15,000 to 45,000 sq ft boxes on 15-year terms |
| Restaurant re-lets | Pizza Hut, F&B and Chiquito boxes are 4,000 to 6,000 sq ft with car-park frontage | Drive-thru-capable where the box fronts the road; otherwise QSR and pub |
| Hotels and health | Travelodge at four parks, Nuffield at three | Pad hotels on surplus parking; Broadway's 1,300-space car park is over-provided |
| Energy | Large flat roofs on cinema boxes | Rooftop solar with a sleeved PPA to the operators |
| Car-park income | Q-Park 2.7% of rent | Keep in hand on acquisition; EV share and ANPR raise yield |

Capex budget shape per park: £250,000 to £500,000 for public realm and lighting, £300,000 to £800,000 landlord contribution per big-box re-let, pads and EV largely operator-funded. On a £340m estate, a £10m to £15m programme over three years is the right scale, funded from the discount paid on the units.

## Anything else worth worrying about or using

- Business rates. The April 2026 revaluation adds a surcharge of up to 20% on hereditaments over £500,000 rateable value, which catches most multiplexes and bowling boxes.
- Cineworld's appeal. Permission to appeal the 2024 restructuring plan was granted. If landlords win, Cineworld rents on the parks go back up; if they lose, the precedent for cramming down leisure landlords is set.
- The data moat is the business. Nobody in the sector has site-level admissions, lease, title and covenant data in one place. Buying Comscore site data for the 40 target parks turns this page into the sector's information layer.
- Fund screen. Run the AREF database for other closed-ended property LPs past their wind-up date with no matched bargains.
- Operator consolidation. Showcase, Everyman, Buzz Bingo and Curzon are all in corporate processes in 2026. Be the landlord in the room.
- Parking. Check every park for adjoining residential allocations in the local plan before pricing.
- Resorts and events. Merthyr's £300m ski and water-park approval and the Marine Lake Events Centre at Southport show councils still back destination leisure.
- Kinepolis. Having bought Showcase's US sites, a Belgian operator with no UK screens is a natural anchor for a vacant-box programme.
- Landsec. Out of scope, but Workman now manages its 14 parks and Landsec has been exiting non-core; if that portfolio comes to market it is the only other block of scale.
`,
  },
  {
    key: "platform",
    title: "Platform & brand",
    markdown: `
## The thesis

Cinema-anchored leisure parks are priced as if the cinema is dying (8.5% to 10.6% exits) while 2026 admissions are running 15% up and the operators are re-gearing rather than leaving. The institutions that built the sector in 2002 to 2018 (L&G, M&G, Aviva, DTZ Investors) are all sellers, nobody has assembled a specialist buyer, and the parks need the three things institutions stopped giving them: energy, capex and information. A branded platform that buys at 9% to 10%, re-lets the restaurant tail, adds pads and charging, and runs the cinema relationship centrally should hold at 7.5% to 8% in three years.

| Route | What it buys | Pace | Pricing | Example |
| --- | --- | --- | --- | --- |
| Fund units | Scale in one move: 16 parks, £340m, through 23 holders and one manager | 6 to 12 months to control | 55% to 65% of NAV, i.e. 9.5% to 10.5% look-through | L&G Leisure Fund; the same play exists at other closed-ended property LPs in run-off |
| Direct assets | Dominant single parks from motivated sellers | Deal by deal, 3 months each | 8.5% to 10.6% | Star City, Medway Valley, Freemans, Five Ways, Cornerhouse |
| Operators with property | Trading business plus freeholds, and an operating team | Corporate process, 6 to 9 months | EV at 5x to 7x EBITDA, property backing the debt | Showcase UK (for sale, 16 sites, 11 reported freeholds in a US affiliate); Merlin; WTW/Scott; Reel plus propco |

Showcase as the worked example: a circuit the owner must sell whole, 16 sites with 11 reported freeholds including Teesside, Dudley and Birstall, £90m turnover, losing £1.9m, with a stalled £55m deal because the operator buyer (The Light) needed a property partner (Frasers) and the partner re-cut the price. That is the shape of every operator deal in this sector: the property buyer sets the price and the operator is the tenant. Double Bill should be the property partner of choice for the next Showcase, Omniplex or Everyman move rather than the operator.

Operators are wanted only where they own property. Merlin and WTW/Scott are the only freehold-rich cinema businesses and neither is for sale; the right move is a relationship, not a bid. Everyman is in play (delisting talk, Joseph Lewis on the board) but owns nothing. Savoy, Omniplex and Arc own some freeholds and are growing; they are tenants and co-investors for the parks.

Platform shape: a UK holding company owning the fund-unit vehicle, a direct-asset propco and minority stakes or JVs with property-owning operators, with BGP as asset manager and this page as the information layer the sector lacks.
`,
  },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s: string): string {
  let t = esc(s);
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  t = t.replace(/(^|[\s(])\*([^*]+)\*(?=[\s).,;:]|$)/g, "$1<em>$2</em>");
  return t;
}

/** Render the markdown subset used in RESEARCH to HTML (no document wrapper). */
export function mdToHtml(md: string): string {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let i = 0;
  const flushPara = (buf: string[]) => {
    if (buf.length) out.push(`<p>${inline(buf.join(" "))}</p>`);
    buf.length = 0;
  };
  const para: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { flushPara(para); i++; continue; }
    if (/^###\s/.test(t)) { flushPara(para); out.push(`<h3>${inline(t.slice(4))}</h3>`); i++; continue; }
    if (/^##\s/.test(t)) { flushPara(para); out.push(`<h2>${inline(t.slice(3))}</h2>`); i++; continue; }
    if (/^\|/.test(t)) {
      flushPara(para);
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i].trim())) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      if (rows.length) {
        const [head, ...body] = rows;
        out.push(`<div class="tw"><table><thead><tr>${head.map((h) => `<th class="al">${inline(h)}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td class="al">${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`);
      }
      continue;
    }
    if (/^(-|\d+\.)\s/.test(t)) {
      flushPara(para);
      const ordered = /^\d+\./.test(t);
      const items: string[] = [];
      while (i < lines.length && /^(-|\d+\.)\s/.test(lines[i].trim())) {
        let item = lines[i].trim().replace(/^(-|\d+\.)\s+/, "");
        const task = /^\[( |x)\]\s/.exec(item);
        if (task) item = `<span class="task">${task[1] === "x" ? "&#9745;" : "&#9744;"}</span> ${item.slice(4)}`;
        items.push(`<li>${task ? item.replace(/^(<span class="task">.*?<\/span>) (.*)$/, (_m, a, b) => `${a} ${inline(b)}`) : inline(item)}</li>`);
        i++;
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    para.push(t);
    i++;
  }
  flushPara(para);
  return out.join("\n");
}

export function researchHtml(): Array<{ key: string; title: string; html: string }> {
  return RESEARCH.map((r) => ({ key: r.key, title: r.title, html: mdToHtml(r.markdown) }));
}
