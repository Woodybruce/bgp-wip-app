# Whole-portfolio contacts review and improvements

The live Landsec dashboard showed 17 internal entries, 33 deal/tracker entries and 200 occupiers. These were incomplete samples: the endpoint silently capped directors at 8, deal contacts and brands at 20, tracker and consultancy records at 15, and occupiers at 200. The interface then stacked those samples in scrolling accordions without search or scheme filtering.

Relationships were reduced to display strings. BGP staff names opened `/hr`, which is not a client destination, and every unresolved tracker unit opened the same generic `/available` route. Several people could appear under an arbitrary scheme because `DISTINCT ON` discarded their other relationships. Tenancy name matching could even add a different company alongside an explicitly linked company.

## Result

- The dashboard is a short preview with search and View all. Full view is a desktop dialog or phone sheet, with group/property filters and 12 records per page.
- Search covers names, CRM company names, roles, email/phone and every associated scheme, deal and unit. Changing filters returns to page one. Matching relationship context is brought into the preview; Show all links reveals the remainder.
- Each person is deduplicated by contact ID, retaining every relationship. Same-name people remain separate records. Counts represent records (people, companies or unresolved units), not a fabricated total of unique people.
- Actual property/deal links and permitted CRM profiles are separate actions; email and telephone are accessible directly. Unit names appear beside their property because a separate unit detail route does not currently exist.
- Complete data replaces capped samples. All nine explicit deal-contact fields populate, including client non-directors and vendor/acquisition/purchaser agents. Tracker companies, named viewing/offer contacts, property client contacts, pinned people and linked consultants retain their evidence.
- Pins/hides follow the property on which they were set. Hiding a person at one scheme does not remove their other scheme links or an independent company-director relationship.
- Canonical tenancy links take precedence. Name-only matches are labelled unconfirmed; ambiguous or unresolved names retain the real tenancy context without guessing a CRM identity.
- Loading, retry and no-match states are explicit. Failed requests no longer look like an empty portfolio. A versioned query key discards the obsolete response shape; automatic 30-second polling is disabled for this full contact set.

## Boundaries

The endpoint remains a read of owned and explicitly shared properties. No database schema, stored contact identity, permissions or edit handlers changed. Existing CRM profile read rules determine whether a profile action is offered. People outside the category-based Brand CRM (for example retail occupiers and consultants) remain visible through their actual portfolio relationships. Their property/deal links remain available.

This does not clean up old imported employers or merge duplicate contacts. It does not change the separate Landsec Contacts CRM tab or make requirement-only brand agents count as portfolio contacts without portfolio evidence. The per-property contacts panel is also unchanged. Direct-property deal scope is retained; deals missing their property link still need their underlying record corrected.

## Landsec logo

The live sidebar showed a solid white square above “Powered by BGP”. Its image filter flattened every pixel of an opaque fetched logo to white. The fixed sidebar uses the existing transparent Landsec mark as an alpha mask tinted by the sidebar foreground. Light brand backgrounds now receive the corresponding dark foreground; the old delayed background-colour sampling is removed. Other clients keep their own full-colour images, with their company name if loading fails.

## Verification

Run the standard regression suite and TypeScript, then the actual SQL test against a separate disposable database:

```sh
npm run qa:regression
npm run check -- --incremental false
PORTFOLIO_CONTACTS_DATABASE_URL='postgresql:///bgp_crm_directory_regression?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' node --import tsx qa/regression/portfolio-contacts-postgres.mjs
```

The SQL test uses transaction-local synthetic tables and rolls back. For the actual local app with the sanitised smoke fixture:

```sh
CRM_SMOKE_DATABASE_URL='postgresql:///bgp_smoke?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' \
SMOKE_BASE=https://127.0.0.1:5446 SMOKE_LOCAL_TLS=1 \
SMOKE_CHROMIUM='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
UX_OUTPUT='/tmp/bgp-portfolio-evidence' node qa/portfolio-contacts-smoke.mjs
```

Both scripts reject non-local database targets and never load `.env`. The browser script removes its own synthetic records afterward. Production data and provider integrations are not modified by these checks.

The local pass includes **82 standard regressions, 24 PostgreSQL checks, 70 contacts browser/API checks and 25 logo browser checks**, plus a production build and TypeScript. Authenticated browser checks exercise the actual desktop home and the separate client phone home, and include successful edits of owned/shared properties and a shared-property deal. Screenshots were inspected as well as checking element visibility and links. The phone close control was corrected after visual review found the global button positioning rule pushing it below the title.

`qa/client-brand-logo-smoke.mjs` checks the actual Landsec mark and the real sidebar palette chooser, with opaque, broken and delayed fetched-logo responses. It verifies the bundled image's alpha shape, rendered dimensions and at least 4.5:1 contrast on both light and dark sidebars. It does not certify the wider timing of fetched brand-colour overrides during session restore. Run it with the same `SMOKE_BASE`, `SMOKE_LOCAL_TLS`, `SMOKE_CHROMIUM` and `UX_OUTPUT` variables above; it does not access the database directly.

Performance was also sampled on temporary data: 61 schemes, 2,453 tenancy rows and 675 total CRM companies. Query plus mapping took about 98ms with canonical company IDs and 699ms with name-only tenancies; the canonical case skipped company-name scans. The full result was about 2.3MB uncompressed with three contacts per company. These are local synthetic measurements, not live timings. Larger global company directories can make name matching slower, and client-side pagination still fetches the full result. Resolving each distinct name pair once, or adding server-side search/pagination when measured load warrants it, is a useful follow-up.
