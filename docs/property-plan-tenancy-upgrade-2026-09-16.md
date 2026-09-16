# Property plans and tenancy schedules — 16 September 2026

Implemented on `claude/terminal-coding-interface-JOGQK`. Validation below uses a disposable local app; production deployment and real-plan acceptance must be verified separately.

## What changed

The property page now uses the boundary-tracing and image-reading components used by the lease-advisory evidence plans. The old detector that immediately saved rectangular boxes has been retired.

- **Trace unit:** click a clear point inside a unit, inspect the proposed boundary, and choose its tenancy row before saving. Manual drawing remains available for open, faint or complicated boundaries.
- **Scan units:** the server traces candidate boundaries and uses the shared image reader to identify them. Results are saved as a review, with a plan preview and editable labels/links. Nothing is selected for acceptance by default. Only chosen outlines are saved.
- **Tenancy links:** outlines can link directly to a canonical tenancy row, even when that row has no separate physical-unit record. Rent, lease dates, occupancy and unit names are read from that row. Renaming a unit does not break its link. Conflicting matches require an explicit choice.
- **Navigation:** an outline opens the corresponding tenancy row for editing; a tenancy row opens and highlights its outline across plan floors. The open outline details refresh after schedule edits.
- **Calendar dates:** lease dates now remain calendar dates in schedule and plan responses, display and editing. Browser QA found that UTC conversion previously shifted summer dates back a day in the tenancy table and its editor.
- **Image quality:** PNG, JPEG and WebP uploads keep their original bytes. The server reads actual dimensions and validates the image. EXIF orientation and transparent backgrounds are handled in separate tracing/vision working images. PDF pages use a bundled worker and bounded high-resolution PNG rendering; interrupted multi-page uploads can resume.
- **Client access:** authorised clients can upload, trace, draw, link, edit and remove outlines on their own/shared properties and accept a prepared scan. Starting the paid AI scan remains a staff action. Cross-property writes are denied.

Original geometry and tenancy rows are not bulk-replaced. Removing an outline or its plan does not delete the tenancy record. The unit picker no longer creates physical units merely by opening it.

## Data and concurrency

Migration `0036_property_plan_tenancy_and_scan_review.sql` adds the optional tenancy link and a scan-review table. The same additive statements are included in the existing startup schema flow. No backfill guesses tenancy associations.

Scan jobs persist their progress and proposed outlines. Concurrent starts reuse one running job per plan; abandoned jobs expire. Applying a review is transactional and idempotent, checks the current image and property access, validates every link, and rejects overlapping or duplicate unit assignments. Manual outline writes use the same parent-plan lock. Authorisation runs before reserving a transaction connection, avoiding pool exhaustion under concurrent client edits.

The extracted vision reader is shared with evidence plans. Its existing classification, geometry and provider-timeout regressions remain in the suite. The displayed source image is not replaced with a compressed analysis image.

## Verification

- 417 regression tests passed, including the existing evidence-plan tests and new property-plan UI, upload, linking, scan, cache and timezone tests.
- 28 isolated PostgreSQL/route/worker checks passed. These cover the real migration, concurrent jobs/apply, rollback, stale images and job leases, canonical/legacy links, access failures, synthetic L-shaped boundaries, transparent PNGs, rotated JPEGs and exact calendar dates. Eleven tenancy PostgreSQL checks also passed.
- 38 requests through the running disposable app, plus four final-build/restart status assertions, passed using staff and client test accounts. They cover upload, original-image retrieval, local tracing, outline CRUD, link changes, tenancy rent updates reflected in the plan, scan acceptance/replay and out-of-scope denials.
- TypeScript and production builds passed. The final occupancy-priority adjustment also passed the focused linking/upload regressions.

Browser QA was completed after the Mac was unlocked, against a disposable local database and a scoped client account. Clicking inside a synthetic unit traced the correct boundary; saving it linked the drawer to the chosen tenancy row. Manual four-corner drawing produced the expected preview. Reviewing and saving two prepared proposals worked; a separate check accepted only one and left the unticked proposal unsaved. The editor preserved the original outline throughout. The tenancy link opened the correct filtered row, and the corrected lease expiry and review dates matched the plan. Saving an unchanged date preserved its exact database value.

A synthetic one-page PDF also passed the actual browser upload flow. The bundled PDF worker rendered it to a loaded 1,785 × 2,526 image at 3× scale, and the new plan displayed crisp readable text. The browser file chooser caused a long test-tool delay before selection returned; the subsequent in-app conversion/upload completed successfully. This checks the PDF pipeline, not the recognition coverage of a complex CAD plan.

At 390px width the scan-review modal had no horizontal overflow and its preview, selection, tenancy picker and save control remained accessible by scrolling; accepting a selected outline worked. This is a narrow-viewport check, not full physical-phone verification. The existing app deliberately detects touch/mobile devices separately and retains its pinned desktop sidebar in a narrow Mac browser; that shell makes the underlying property page cramped at this width.

These checks used synthetic plans and a mocked identity reader. No real plan was sent to an external provider during this change. Real-plan recognition accuracy and the device-specific phone shell remain separate acceptance checks.

## Remaining limits and acceptance check

Automatic recognition is still a proposal, not a guarantee that every demise is found. Poor scans, open walls, narrow units and merged fills can need manual tracing/drawing. A ready scan may explicitly report incomplete sections or no usable boundaries.

Existing incorrect rectangles are preserved. A scan skips areas overlapping saved outlines; remove an incorrect outline before tracing its replacement. This avoids silently deleting previous work but does not clean up old geometry automatically.

PDFs are rendered at up to 3× scale, with a 6,500-pixel longest side and a 24-megapixel canvas budget. Very large CAD sheets can still benefit from a separate high-resolution image export. This does not restore detail already lost in an older upload.

Before production acceptance, visually check a real small-building plan and a shopping-centre plan: upload, zoom, trace an irregular unit, link it, edit its rent through the tenancy link, return to the plan, review a scan, accept only correct outlines, and repeat the manual actions as a scoped client. Confirm both phone and desktop layouts. A live provider scan and comparison with the known unit list are still needed to measure real-plan coverage.
