# Outside services that touch Landsec data

One page for the pitch (docs/landsec-pitch-plan.md, item 7). Written 11 November 2026 from the code; "to confirm" marks anything that depends on how the team uses a feature rather than on the code. The contract's AI clause: confidential information goes only into an AI system operated within BGP's own secure environment and is never used to train third-party models.

## AI

| Service | What it receives | Rule in the app |
|---|---|---|
| **Anthropic (Claude)** | ChatBGP questions and answers in the Landsec view, document and brief drafting, email and offer reading, the unit brief and heads-of-terms reading | **The only AI provider for Landsec data.** Every request in the Landsec scope (a Landsec login, or BGP staff viewing as Landsec) runs with the provider pinned to Anthropic; the CHATBGP_PROVIDER / AI_PROVIDER switch is ignored for it. Under Anthropic's commercial API terms inputs and outputs are not used to train Anthropic's models (cite the current terms in the contract schedule). |
| OpenAI, Google Gemini, Moonshot (Kimi), fal (Flux) | Nothing from the Landsec view | ChatBGP never routes a Landsec-scope request to them; Image Studio's AI edit / generate / enhance paths refuse inside the Landsec scope with a visible message. BGP's own use of these providers on non-Landsec work is unchanged. |
| Perplexity, Exa | Web-research queries from ChatBGP tools, and the Brand gap's weekly expansion read, which names the scheme, its postcode, the centres it competes with and the brands being researched | A query may name a scheme or a brand; it never carries unit, rent or deal data. Woody, 13 November 2026: this stays on for Landsec schemes ("there is no anthropic only rule"). |

Background jobs that run outside a request (the mailbox sync's email reading, brand enrichment) follow the global AI_PROVIDER switch, not the per-request lock: keep AI_PROVIDER unset (Anthropic) on Railway while Landsec correspondence is in the synced mailboxes.

## Where the data lives

| Service | What it holds |
|---|---|
| **Railway** (app hosting and the Postgres database) | The whole platform, including every Landsec record. UK/EU region to confirm with Railway's settings. |
| **Microsoft 365** (BGP's tenant: mail, calendar, SharePoint) | Landsec correspondence in BGP mailboxes, meeting diaries, and the Landsec folders on BGP's SharePoint. Synced into the app by the hourly mailbox and diary sync (subject lines, previews, attendees; attachments stay in Microsoft 365). |
| **Azure** (same tenant; Document Intelligence for OCR) | Scanned PDFs sent for text extraction when a document is read. |

## Public-register lookups (addresses and company numbers go out; nothing confidential)

Companies House; HM Land Registry (the local dataset ingest and the Business Gateway for official copies); VOA business rates; Ordnance Survey (Places, NGD); PlanIt planning registers; the Food Standards Agency hygiene register; EPC register; Nominatim / Google Maps for geocoding and maps; Edozo and PropertyData for title and comparable evidence (staff-only purchases).

## Brand, people and covenant enrichment (brand names and company numbers go out)

logo.dev and Clearbit (brand logos); RocketReach and Apollo (contact discovery on brands and agents, BGP use); covenant grades come from Companies House, the Gazette and filed accounts (Creditsafe is stubbed until a key is added), BGP-only on the brand page; Veriff (identity checks in BGP's KYC — the tenant's people, not Landsec's).

## Sending and billing

Resend (transactional email from the app); Meta WhatsApp Business (BGP's own number); web push through the browser; Xero (BGP's invoices to Landsec, from completed deals).

## Document tooling

OnlyOffice (in-app editing of Word and Excel files on BGP's own server); Canva, Dropbox and Evernote connectors exist for BGP marketing work and are not used on Landsec records (to confirm); Unsplash, Pexels and Pixabay supply stock images and receive nothing.

## Not in scope

Stripe and Revolut (BGP's own finances); ScraperAPI and the UK proxy (public web pages only).

## What Landsec can ask for

- The audit right: the app's activity log records who opened what; a per-client export and delete of Landsec data is on the roadmap after the pitch.
- Return or deletion of data at the end of the contract: all Landsec records are in the one Postgres database and the SharePoint folders, so a complete export and a complete delete are both single operations.
