# Evidence-plan demises, information and labels

Pete's examples exposed failures in geometry, interaction and persistence. Scanning requested bounding boxes, expanded them around all nearby saturated pixels, and then stored rectangles. Large units could not fit the scan tiles; small pale units were discarded. Refresh could delete existing AI units before validating their replacements. Frontage guesses and marker collision nudges could place labels outside a demise. Drawing clicks were intercepted by existing shapes, and units without evidence had no visible label. Linked schedule fields were hidden from the editor; failed saves closed it and discarded the visible draft.

## Implemented workflow

- **Refresh units** reads a whole-level overview plus detailed tiles. AI identifies labels/interior seeds; a connected-pixel contour supplies the boundary. Actual closed white or pale units are eligible. Truncated responses retry; ambiguous labels and unreliable boundaries remain for review.
- Refresh never deletes unit rows. It adds missing units and may refine the polygon of a uniquely matched, overlapping AI unit. Existing IDs, facts, evidence and saved marker positions remain. Human corrections are marked manual and protected from scanning.
- **Trace unit** follows the closed region under a click without an AI-provider call. The outline is a preview until the user names and saves it. **Trace boundary** replaces a selected unit's geometry while keeping its identity and evidence. A mall/open region that cannot be confidently bounded returns guidance instead of a false outline.
- **Draw unit** and **Redraw boundary** work over existing outlines. **Undo point**, **Finish outline** and **Cancel** make completion explicit; repeated double-click events do not add duplicate corners. Invalid/self-crossing geometry cannot be saved.
- Every outlined unit has a selectable circle and a searchable unit-list row, including units with no evidence. The disc fits within its own polygon and retains its saved anchor. Dragging and arrow keys move labels; saved coordinates are normalised to the plan image and remain correct after zoom/pan/reload.
- **Edit** accepts manual unit facts and notes. For a matched schedule row, the same editor updates the canonical tenancy schedule, including explicit blank and zero values. **Link schedule row** lets the user review a unique row and explicitly adopt its reference. Stale/ambiguous matches are rejected. The legal tenant name is retained when the trading name is edited.
- **Add evidence** and **Edit evidence** update Zone A/type and the unit's circle. Failed saves retain drafts and display an error. On phones, a bottom sheet contains unit details while the canvas remains available after closing it.

## Related persistence repairs

Saved labels are no longer renamed by a plan read. Evidence matching requires an unambiguous reference or compatible tenant match; a conflicting explicit unit reference is not silently overridden. GET responses include the newly linked evidence. The source-document route is reachable instead of being parsed as a plan UUID. Destructive evidence deduplication on every server start was removed.

Drawing/marker saves include the background version and reject a changed image. Crop updates lock the level and its units, reject a stale image or crop that would cut off a saved outline, then remap the surviving geometry together. No schema or migration was added. Property/deal access and editing policies are unchanged; canonical schedule writes check the property's scope.

## Verification and limits

Passed on the completed implementation: **144 regression tests**, **27 real PostgreSQL checks**, **37 authenticated desktop/phone browser and API checks**, TypeScript checking and the production build. Browser checks include the real trace endpoint, preview-before-save, contained label circle, failed-save retry, schedule writes, ID-preserving redraw and persisted marker movement after zoom/pan/reload. Delayed trace responses cannot reopen a cancelled operation, overwrite a newer drawing, or apply coordinates to an unseen replacement image.

The original 1707×1280 August Brent Cross JPEG was extracted unchanged from `server/assets/demos/brent-cross-evidence-map.html` (SHA-256 `3819ad24f27eb83de251c2139f833e68b5b03b355f30479edaf311acb0beedb5`). Actual-image tracing followed 10 sampled units, including Lakeland's L-shape, adjacent D2/D3/Superdrug, John Lewis, Clarks, Zara, M&S, Fenwick and a small kiosk. A mall seed was rejected. Those seeds were selected by a human; this verifies boundary tracing, not the completeness of a live AI scan.

The browser suite uses that original artwork, synthetic unit fixtures, a disposable local database, actual authentication/routes and real saves. Its baseline synthetic rectangles are deliberately not claims about actual shop demises. It separately calls the real trace endpoint against John Lewis and checks the saved contour and contained circle. Provider requests are blocked in browser testing; all test writes target the disposable database.

After sign-in became available, read-only inspection of the displayed live plan showed **177 units, 84 evidence entries and 20 unlinked entries**. The lower level rendered **67 outlines, all with four corners**, and the page still had the old Re-detect/interface. Its displayed 2845×2134 background was copied locally for tracing comparison. No live edit/save/scan was submitted. These changes are not a claim that every current production outline has been corrected. After deployment, refresh the level and review existing outlines; use Trace boundary/Redraw boundary for any incorrect retained unit. Broken/indistinct linework, a seed over a logo, or conflicting labels may still need another interior click or manual drawing. A differently arranged replacement drawing still requires alignment; normalised coordinates cannot infer that transformation. Explicit schedule linking currently uses a unique canonical unit reference because the existing schema has no dedicated schedule-row foreign key.

Local tracing against that exact displayed live JPEG also passed all **10 sampled units**, and rejected the mall seed. This comparison exposed a dark-grey D3 fill connecting to the plan's wall lines; tighter tolerance for neutral dark fills removed that erroneous extension while preserving the adjacent Lakeland, D2 and Superdrug contours. Saved full-plan and close-up overlays show those results. The sample verifies tracing on the current artwork; AI recognition completeness across the entire live plan remains untested.

## Reproduce

```sh
npm run qa:regression
npm run check -- --incremental false
node --import tsx script/build.ts

EVIDENCE_PLAN_DATABASE_URL='postgresql:///bgp_crm_directory_regression?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' \
  node qa/regression/evidence-plan-data-postgres.mjs

EVIDENCE_SMOKE_DATABASE_URL='postgresql:///bgp_smoke?host=/tmp/bgp-smoke-20260906/socket&port=55441&user=postgres' \
SMOKE_BASE='https://127.0.0.1:5446' SMOKE_LOCAL_TLS=1 \
SMOKE_CHROMIUM='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  node qa/evidence-plan-smoke.mjs
```

The database/browser commands require the existing disposable fixture, a built local app and the local HTTPS proxy. They reject unexpected database/host targets and clean up their own synthetic records.
