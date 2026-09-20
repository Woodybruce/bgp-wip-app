# Landlord/client boards — Delivery 1: repair current failures

Source: "BGP landlord and client boards — implementation plan" (2026-09-20), Delivery 1 only.
Codebase: bgp-wip-app @ 19ff40c8 (worktree `.worktrees/landlord-d1`, branch `feat/landlord-board-delivery-1`).

Delivery 1 scope (verbatim): "Hide tenant-only landlord sections; fix labels/chat width, last-touch contract, status classification, truncated totals, correspondence query/role filter, market error states, folder pagination and selected upload target."

Acceptance gate (verbatim): "PostgreSQL-backed query tests; real deal/interaction reconciliation; disconnected services distinguishable from empty data; selected-folder upload test in a disposable folder."

## Global Constraints

- Do NOT change database schema or run migrations. Delivery 1 is code-only.
- Do NOT change stored company data (e.g. the Hammerson ticker row in the DB); symbol normalization happens in code at read time.
- Preserve the client-scope (`bpScope`) permission filters exactly as they are; never widen what a client account can see.
- Match existing code style: TypeScript, raw SQL via `pool.query`, node:test for tests. Test command: `node --import tsx --test <file>`. Typecheck: `npm run check` (tsc).
- No new npm dependencies.
- Numbers, statuses, and field names in each task brief are authoritative — use them verbatim.
- Commit with clear messages, one commit per logical change; the implementer commits its own work.

## Task 1: Fix the last-touch / activity contract (contacts panel reads fields the API never sends)

**Problem.** `server/brand-profile.ts` decorates each contact with `interaction_count` and `last_interaction_at` (see the IIFE at `server/brand-profile.ts:945-957`), but `client/src/components/brand-profile-panel.tsx` reads `ct.last_contacted_at` at lines ~1007-1008 and ~1565-1571 — a field the API never supplies, so "Last touch" and the 90-day engagement display are always empty/wrong. The panel's own type at `brand-profile-panel.tsx:166` already declares `last_interaction_at: string | null`.

**Required changes.**
1. In `client/src/components/brand-profile-panel.tsx`, replace every use of `ct.last_contacted_at` (and any `last_contacted_at` on contact objects in this file) with `ct.last_interaction_at`. Preserve existing sorting/formatting behaviour otherwise.
2. Check the whole file for other reads of contact interaction fields (`interaction_count`, `last_touch`) that disagree with the decorated contract (`interaction_count`, `last_interaction_at`) and align them.
3. In `server/brand-profile.ts`, find the query that feeds the "last touch"/activity aggregate (`contactInteractionStats` and `bgpInteractions`). Ensure both exclude future-dated rows (`interaction_date <= NOW()`) so future appointments never count as "last contact". If they already do, note that in the report and change nothing there.
4. Do not rename the API fields — the decorated names (`interaction_count`, `last_interaction_at`) are the contract; fix the client to match.

**Verification.** `npm run check` passes. Grep the panel for `last_contacted_at` — zero hits on contact objects. Write a short note in the report describing before/after behaviour.

## Task 2: Repair the correspondent-suggestion query (unnest on JSONB) and the landlord contact role filter

**Problem A.** `server/brand-profile.ts:735-758` runs `CROSS JOIN LATERAL unnest(participants)` where `participants` is `jsonb` (`shared/schema.ts:1398`). `unnest()` fails on jsonb, the bare `catch {}` swallows it, and pending contact suggestions are always empty. Also the exclusion `p NOT IN (SELECT LOWER(email) ...)` compares a raw-case participant against lowered emails, so case mismatches leak through.

**Fix A.** Replace the unnest with a jsonb-safe expansion:
- Use `jsonb_array_elements_text(participants)` for array values. Guard legacy rows where `participants` may be a jsonb string or null: wrap with a `CASE WHEN jsonb_typeof(participants) = 'array' THEN ... END` or filter with `jsonb_typeof(participants) = 'array'` in WHERE, whichever reads cleaner.
- `LOWER(p) AS email` in the SELECT/GROUP BY and keep display consistent.
- Fix the exclusion to compare lowered values on both sides: `LOWER(p) NOT IN (SELECT LOWER(email) FROM crm_contacts WHERE company_id = $2 AND email IS NOT NULL)`.
- Keep the company-domain ILIKE filter, the `@brucegillinghampollard.com` exclusion, the `!bpScope` guard, ORDER BY and LIMIT 20 unchanged.
- Replace the silent `catch {}` with a `catch (e)` that logs `console.warn('[brand-profile] contact suggestions failed:', e?.message)` and still falls back to empty.

**Problem B.** `client/src/components/company-contacts-board.tsx` around lines 201 and 274 applies a retail/tenant-oriented role filter to landlord contacts, hiding relevant landlord-side roles. Inspect the filter, identify the role list, and for landlord-typed companies show all business-relevant roles (do not filter to retail roles like "store manager"/"head of retail" etc.). Tenant/brand companies keep existing behaviour.

**Verification.** Add `server/brand-profile-suggestions.test.ts` (node:test, `node --import tsx --test`): unit-test the SQL string or — better — factor the participant-expansion into a small pure helper (e.g. `expandParticipants(participants: unknown): string[]`) in a suitable module and test it with array/string/null/legacy inputs. `npm run check` passes.

## Task 3: Deal totals independent of the 20-row cap, using canonical status classification

**Problem.** `server/brand-profile.ts:288-300` caps the deal list at `LIMIT 20`, then `bgpSummary` (`:874-893`) derives `totalDeals`, `completedDeals`, `totalFees`, and `team` from that capped set, and classifies "completed" with `(status||'').toLowerCase().includes('complet') || includes('won')` — missing the app's canonical statuses. `shared/deal-status.ts` (~line 107) holds the canonical status vocabulary (incl. `COM`/`INV` codes).

**Required changes.**
1. Add a separate aggregate query (same WHERE/scope as the list query, including the `bpScope` clause) returning: total deal count, completed count, sum of fees, and distinct team members (union of `team` and `internal_agent` array elements). Run it over the FULL matching set — no LIMIT.
2. Keep the existing `LIMIT 20` list query for display, but return the aggregate totals in the response (extend `bgpSummary` or add e.g. `dealTotals: { total, completed, totalFees, team }`).
3. Read `shared/deal-status.ts` and use its canonical completion classification (the helper/constant it exports for completed/won statuses, including `COM`/`INV` handling) in BOTH the aggregate query and any client-side completed-count logic. If the shared module exports a SQL-usable status list, use it to build the SQL; do not hand-roll a second status list.
4. In `client/src/components/brand-profile-panel.tsx`, wherever deal counts/totals are displayed, consume the new aggregate totals so the UI can honestly show "20 of N" where the list is capped. Do not build full pagination here — that is Delivery 3.

**Verification.** Add `server/brand-profile-deals.test.ts`: pure-helper tests for the status classification (canonical `COM`, `INV`, archived and lowercase variants) and, if a helper builds the SQL, that it includes/excludes the right statuses. `npm run check` passes.

## Task 4: Landlord layout — hide tenant-only sections, fix labels and chat width

**Problem.** When `isLandlord` is true, `client/src/components/brand-profile-panel.tsx` still renders tenant-only blocks: store count / "Reported store total", rollout, competitor research, "Similar tenants", and the external leasing-requirement panel (references around lines 1281, 1295, 1315, 1555, 1737, 1748, 2050). Chat is labelled "Brand conversation" and expands full-width.

**Required changes.**
1. Read the panel around the cited lines and find every tenant-only block. Gate each behind `!isLandlord` (the API already returns `isLandlord`). Blocks to hide for landlords: store counts / "Reported store total", rollout/expansion scoring, competitor research, "Similar tenants", external occupational/leasing requirements. If a block mixes landlord-relevant and tenant-only content, hide only the tenant-only part.
2. Relabel tenant vocabulary for landlords: "Brand conversation" → "Landlord conversation" (or the existing landlord-appropriate label if one exists in the codebase — check for existing landlord label patterns first and reuse them).
3. Chat width: on desktop the chat column should occupy half the content width beside the overview content; on phone it stacks full-width below. Use the layout primitives/Tailwind classes already used elsewhere in this file — do not introduce new UI dependencies.
4. Tenant/brand companies must render exactly as before.

**Verification.** `npm run check` passes. In the report, list each block now gated with its line number, and state what a landlord page renders vs a tenant page.

## Task 5: Market data — verified symbols, no 6h null-caching, explicit error/stale states

**Problem.** `server/stock-price.ts:225-236` caches results (including `null`) for 6h, so one failed/invalid lookup shows "fetching…" or nothing for hours. Exchange-prefixed tickers (e.g. `LON:HMSO`) are passed unchanged to Yahoo. The Hammerson record stores `HMSON` (a stray N — correct LSE ticker is `HMSO`); do NOT edit the DB row — normalize at read time.

**Required changes.**
1. `getStockSnapshot`: do not cache `null` for the full TTL. Either skip caching nulls entirely or use a short negative-cache TTL (≤ 60s). Keep the 6h TTL for successful quotes.
2. Add a normalization step applied before lookup: strip exchange prefixes (`LON:`, `LSE:` etc. → bare symbol), trim/uppercase, and map to the Yahoo instrument format (London listings trade in pence and use the `.L` suffix — check how the module currently forms Yahoo symbols and keep that convention, e.g. `HMSO.L`).
3. Add a defensive alias map for known one-off stored mistakes, starting with `HMSON` → `HMSO` (with a comment that the durable fix is data cleanup in Delivery 2/6). Keep it tiny and explicit.
4. Distinguish states for the caller: make the return type (or a wrapper) able to express `ok` (with quote + timestamp) vs `invalid symbol` vs `provider error/unavailable`, instead of a bare null for everything. Update the API route and `client/src/components/brand-profile-panel.tsx` (~line 3190 and the market card near :5047) so the UI shows: live quote with timestamp; "price unavailable — provider error" (retryable); or "unknown ticker" — never an endless "fetching…". Keep any existing last-good/stale display if present.
5. Private/non-listed companies must not show the stock panel (preserve existing gating).

**Verification.** Add `server/stock-price.test.ts`: tests for prefix stripping, `HMSON`→`HMSO` alias, `.L` suffix formation, null-not-cached-6h behaviour (short or no negative cache), and state mapping. `npm run check` passes.

## Task 6: SharePoint folder pagination and selected-folder upload

**Problem.** Drive-item listings in `server/microsoft.ts` (~2719-2767) follow only the first page (`@odata.nextLink` ignored), so folders with many items truncate. The linked-folder upload path (~`server/microsoft.ts:2932`, `:3056`; `server/client-sharepoint.ts:119`; `client/src/pages/properties.tsx:1744`, `:1754`, `:2256`) can fall back to the SharePoint root instead of the folder the user selected.

**Required changes.**
1. Find every Graph drive-item children listing used by the CRM document/folder features and make it follow `@odata.nextLink` until exhausted (with a sane page cap, e.g. 50 pages, to bound pathological loops, and a warn-log if the cap is hit). Do not change the returned item shape.
2. Trace the upload path from `client/src/pages/properties.tsx` (the folder picker / current-folder state around lines 1744, 1754, 2256) through the API to `server/microsoft.ts`/`server/client-sharepoint.ts`. Fix it so an upload always lands in the currently selected folder's drive/item ID. If no folder is selected, keep existing default behaviour but do NOT silently fall back to root when a folder WAS selected — if the selected folder's IDs are missing, return a clear 4xx error instead.
3. Keep the two existing folder-root conventions working (do not migrate folders — that is Delivery 5).

**Verification.** Factor pagination into a helper (e.g. `listAllChildren(fetchPage)`) and add `server/microsoft-graph-pagination.test.ts` testing multi-page accumulation, the page cap, and error propagation, using a stubbed fetch. For upload targeting, extract the "resolve upload destination" decision into a pure function and test: selected folder present → its IDs; none selected → default; selected but IDs missing → error, not root. `npm run check` passes.

## Out of scope for Delivery 1 (do not implement)

- The account resolver, portfolio reconciliation, Hammerson pilot (Deliveries 2, 6)
- The dedicated landlord workspace page, full deal pagination (Delivery 3)
- Automatic preparation/media pipeline changes (Delivery 4)
- Folder tree migration, entity-level KYC (Deliveries 5, 7)
