# Expansion section review, 14 November 2026

Woody, 14 November 2026, on a brand's Expansion tab: "Can you consider the
expansion section how it works if its good enough and also the display
doesn't look great between the 2? Needs improvement and Design tidy up", then
"we can add pay walls etc if have other ideas to give us an edge on their
expansion strategies" (read here as: paid sources are allowed).

## How it works today

- **Signals** (`brand_signals`): rows written by the news search, the
  newsletter reader (Propel and the like), the brand's own website and social
  feeds, Apollo (headcount) and staff (**Log intel**). Each has a kind
  (opening, closure, requirement, funding, hiring, exec change, sector move,
  rumour, news), a size, a tone and a date.
- **The score** (`computeExpansionScoreV2` in `server/hunter-score.ts`): four
  parts of 25. UK momentum (openings, closures, hiring, "coming soon" sites,
  the hand-set rollout badge), Capacity (covenant grade, funding news, share
  price), Intent (requirements, market listings, a tenant rep, unit
  enquiries), BGP engagement (deals, offers, viewings, contact). Signals lose
  half their weight every six months.
- **The nightly tidy** (`normaliseBrandFacts`): one AI read per brand that
  removes duplicates, dates each fact and tags it UK or abroad, confirmed or
  rumour. It runs for 25 brands a night.

## Verdict: not good enough yet

Read on the live app for Greene King, Jersey Mike's, Wingstop, Gail's, Blank
Street, Popeyes, Five Guys, Loungers and Nando's (14 November 2026).

1. **It counts headlines, it does not measure the estate.** Jersey Mike's
   reads 18 "openings" in 12 months: most are write-ups of its first UK
   restaurant.
   The store list holds 3 of Greene King's 2,500 pubs, 45 of Gail's 175 and
   none of Popeyes', so net openings cannot be worked out from it.
2. **The same story was scored more than once.** Fixed on 14 November (one
   story, one count).
3. **One number mixes two questions.** "Is this brand expanding?" and "how
   close is it to BGP?" are added together. Five Guys reads 27 (Hot) with 13 of
   those points from BGP's own deals and contact and 3 for momentum; Blank
   Street, with 84 contacts in 90 days and 45 shops, reads 17.
4. **Capacity is the same for nearly everyone.** A grade A covenant is 8
   points and almost every brand sampled has it. Turnover (£2.5bn for Greene
   King), profit, debt and private equity backing do not count.
5. **Intent is nearly always empty.** Nando's, Popeyes and Loungers score 0:
   it only fills from a requirement on file. A stated target in the press
   ("400 sites", "nearly 100 openings in FY27") is not counted unless the
   story was filed as a requirement.
6. **The hand-set badge never expires.** Greene King is marked Scaling (+5)
   while the signals show a 24-pub sale and headcount down 20%.
7. **A disposal is not a contraction.** "Agreed to sell a 24-pub package" is
   filed as a sector move and scores nothing.
8. **UK and abroad are not told apart on the page**, and an opening at
   Barcelona Airport counted towards Five Guys' UK momentum.
9. **"Previous expansion research" is press cuttings**, not a read of what
   the brand wants.
10. **Most of the Signals list was noise**: Instagram posts, awards and
    Christmas menus filed as news.

## Changed on 14 November 2026

- The score counts one story once (`dedupeFacts`), and a fall in headcount is
  its own line, not "UK closures". `SCORE_VERSION` 4.
- The score card shows the figure with its band and the four parts one under
  the other, each with the reasons that counted (staff).
- Signals are one line each in three columns, with the estate list first and
  general coverage folded under **Other news**.
- The saved research is headed "Recent press reports" when that is what it
  is, and opens to a short read.

## What the section should answer

1. Are they growing? Net sites in 12 months, and the pipeline.
2. What do they take? Size, format and rent, from the deals they have done.
3. Where next? Towns they are in against the gaps; sites coming soon;
   applications in.
4. When? Lease expiries, the financial year, a fresh funding round.
5. Who decides? The property director and the retained agent.
6. How close is BGP? Kept as its own figure, not added in.

## Ideas (none built; each waits on Woody)

### From what the app already holds, or free sources

- **A. Two figures in place of one**: Expansion (market evidence only) and
  Relationship (BGP's own work). Changes the Hunter board and the alerts.
- **B. Count the stores.** A monthly sweep of each brand's own store finder:
  net openings and closures by town, and the "coming soon" list. The truest
  measure there is. Costs a web read per brand per month.
- **C. Run the nightly tidy on every brand**, not 25 a night, so every
  signal is de-duplicated, dated and tagged UK or abroad. Costs AI reads.
- **D. Read the accounts for stated plans.** The accounts are already read
  for the covenant: the strategic report says how many sites they plan,
  their capital spend and their lease commitments. Free (Companies House).
- **E. What they take.** Read size and rent from the deal stories already
  held ("2,033 sq ft at Lakeside", "10,000 sq ft at the Pompey Centre") into
  a typical size and format per brand.
- **F. Planning and licensing applications.** A shopfront, signage or
  change-of-use application, or a premises licence application, names the
  operator months before the press does. Planning is searchable nationally
  through PlanIt; licensing registers are council by council.
- **G. Job adverts by town.** "General Manager, new opening, Reading" and
  "Acquisitions Surveyor" are the pipeline in plain sight. Adzuna has a free
  feed.
- **H. Registered leases.** HM Land Registry's company ownership data lists
  the leases a brand's companies hold and when they took them; the term is
  on the paid register.
- **I. Estate sales as contraction**, and a rollout badge that follows the
  evidence (or lapses after six months).
- **J. BGP's own emails and chat** read for what a brand says it wants. The
  biggest edge and the one no competitor can buy. Parked: needs Woody's yes.

### Paid sources

- **Green Street (Local Data Company)**: every opening and closure by brand
  and address. The standard for net estate change.
- **Hospitality operator trackers** (CGA by NIQ, Lumina Intelligence, MCA
  Insight): outlet counts, pipelines and trading by operator.
- **Trade press behind paywalls** (Propel Premium, Property Week, EG, React
  News): Propel's newsletters are read already; the rest are not.
- **EG Radius or CoStar**: deals done, availability and lease expiries by
  tenant.
- **Glenigan or Barbour ABI**: fit-out contracts and planning leads.
- **Beauhurst or PitchBook**: funding rounds and private equity ownership,
  which is where a rollout mandate comes from.
- **Footfall and spend** (Placer.ai, Huq): where a brand trades well, which
  is where it will look next.

Prices are by quotation and were not checked for this note.
