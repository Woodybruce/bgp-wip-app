# Leisure Platform — data room

Source documents behind the L&G Leisure Fund deep dive and the leisure-park
platform target list (research pass 21 Oct 2026). The register of every
source, with the live URL and what each one gave, is `DATA_ROOM` in
`server/leisure-platform-data.ts` and is shown on the Data room tab of
`/leisure-platform` in the app. The written analysis lives in the Claude
doc linked from that page.

`data-room/` holds the PDFs that were downloaded during the research:

| File | What it is |
| --- | --- |
| aref-leisure-fund-profile-2024.pdf | AREF Property Fund Vision profile, data to 30 Jun 2024 (assets, tenants, debt, unitholder bands, fees) |
| aref-leisure-fund-profile-2019.pdf | Earlier AREF profile (NAV £451.4m, 18 assets) |
| lg-press-broadway-plaza-2018.pdf | L&G press release, Broadway Plaza acquisition, fund over £600m |
| vue-entertainment-fy2025.pdf | Vue Entertainment Ltd accounts FY to 30 Nov 2025 (scanned) |
| odeon-cinemas-fy2025.pdf | Odeon Cinemas Ltd accounts FY to 31 Dec 2025 (scanned) |
| cine-uk-fy2025.pdf | Cine-UK Ltd accounts FY to 31 Dec 2025 (scanned) |
| showcase-harbor-lights-uk-fy2025.pdf | Harbor Lights Entertainment (UK) Ltd (Showcase) accounts FY to Jan 2025 |
| merlin-cinemas-fy2025.pdf | Merlin Cinemas Ltd accounts FY to Apr 2025 |
| savoy-cinemas-fy2025.pdf | Savoy Cinemas Ltd accounts FY Dec 2025 |
| light-cinemas-group-2025.pdf | Light Cinemas Group Ltd accounts to Jul 2025 |
| tenpin-fy2025.pdf | Tenpin Ltd accounts FY Dec 2025 |
| omniplex-ni-fy2025.pdf | Omniplex Holdings (NI) Ltd accounts FY Oct 2025 |
| curzon-media-group-fy2025.pdf | Curzon Media Group Ltd accounts FY2025 |
| picturehouse-fy2024.pdf | Picturehouse Cinemas Ltd accounts FY2024 |

Add a new document by dropping the PDF here and adding a `DATA_ROOM` row
with its `file` name; the page serves it at
`/api/leisure-platform/data-room/<file>`.
