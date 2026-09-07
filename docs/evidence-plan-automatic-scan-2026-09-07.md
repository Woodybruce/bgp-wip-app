# Brent Cross automatic scan verification — 7 September 2026

The final tested worker retains **51 selectable retail outlines**. All 21 independently annotated development test points are covered, with all 19 readable unit references correct at those locations. Three kiosk identities remain unlabelled for manual confirmation; one small kiosk contour still has a notch around printed text and needs boundary cleanup. The code has been tested locally, not deployed to the existing live plan.

This round tests the actual automatic scanner on the displayed Brent Cross Lower Level image (2845 × 2134, SHA-256 `a5c567282a6855bd08b122602fec8e5ee083cb912c0118d14ff5b02650a1146d`). The user explicitly authorized sending this image to Anthropic. The app's scanner uses `claude-sonnet-4-6`; this work changes its image preparation, classification contract and geometry handling.

## Faults reproduced and changes

The initial real-provider scan saved 48 outlines but covered only 2 of 16 independently sampled demises. It confused generated blue region numbers with printed unit numbers and assigned names to the wrong candidate shapes. Supplying an unmarked image alongside a tagged geometry image improved coverage to 11/16, but global candidate-number matching still produced wrong associations and conflicts.

The scanner now classifies each fixed candidate in a separate close-up. Each pair contains an unmarked source crop and the identical crop with only one candidate outlined and the exterior faded white. Concave notches are faded too, making L-shaped exclusions explicit without altering the original image. Responses must judge every candidate exactly once. Unknown IDs, duplicate IDs, missing decisions, non-boolean decisions and truncated replies fail the batch. Geometry is taken from the supplied candidate, never from model-generated coordinates. A rejected region is excluded, and readable source labels remain distinct from generated candidate tags.

The geometric inventory missed small kiosks and split some units around printed logos. Tiny coloured candidates now have bounded size/seed fallbacks. A repair can close one- or two-pixel gaps only within a single small coloured component’s existing bounds, add at most 5% of its pixels and must enclose a substantial logo hole. Normal large notches and adjacent units remain separate. Small bounded fills have a limited allowance for large logos; enclosing mall/page backgrounds remain rejected. A one-pixel tolerance removes nested duplicate fragments. On the actual image this recovers full D16, Boots, Starbucks and Chick outlines while all 16 original sample polygons remain byte-identical. Final inventory: 151 candidates, still including header fragments that vision must reject.

Valid boundaries are retained even when a printed number is unreadable or duplicated. The previous worker discarded two genuine kiosks after the model called both `KIOSK 3`. Such new boundaries now get stable, position-based `Unlabelled …` references. They remain selectable and editable, appear in the existing review queue, and their numeric placeholders cannot inherit tenancy facts through tenant-name fallback. Existing overlapping manual units and saved facts remain protected.

Progress follows the actual batches (normally 12 candidates each, up to 20 batches), with one retry per batch. SDK calls time out after 75 seconds, hidden retries are disabled, and existing heartbeat/expiry/transaction protections remain. The evaluator independently caps a run at 20 requests including retries. Exhausting that cap is incomplete; production's 30-minute job limit can stop a repeatedly slow scan before all sections finish.

## Evaluation scope

`qa/evidence-plan-automatic-eval.mjs` extracts and executes the actual scanner/worker source with the real provider and disposable PostgreSQL schema. It retains exact input images/prompts, raw responses, source hashes, usage, persisted polygons and overlays. It never receives the independent sample points or labels. Each run starts with an empty level, without schedule records, manual seeds or existing units. It does not mutate the production plan.

`qa/evidence-plan-score.mjs` reads the independent annotation only after provider output exists. This regression sample, used to guide successive improvements rather than held out from development, comprises 16 identifiable demises, 5 non-unit controls and 11 neighbouring-unit pairs. Point coverage is not boundary accuracy or whole-plan recall; extra predictions remain unscored. Labels are compared at their actual sampled location, with only conservative reference formatting normalization.

| Input | Saved outlines | Sample interiors | Printed references | Tenant names |
|---|---:|---:|---:|---:|
| Initial global overlay | 48 | 2/16 | 0/16 | 1/13 |
| Clean source plus global overlay | 59 | 11/16 | 6/16 | 7/13 |
| Individual close-ups | 42 | 15/16 | 15/16 | 12/13 |
| Exact boundary exterior faded | 46 | 16/16 | 16/16 | 13/13 |
| Small/label-interrupted boundaries recovered | 49 | 16/16 | 16/16 | 13/13 |

Five real provider runs completed: 10, 10, 13, 13 and 13 requests, respectively. In the fifth run all 16 original sample points remained correct and four of five additional targeted failure cases were saved. Chick and the previously present KIOSK 5/Krispy Kreme were both lost at persistence because the model read the same number on them.

The final worker-only saving change was checked using an **exact recorded-response replay of the fifth run**, not a sixth provider run. The harness requires unchanged detection/request-building and geometry source, then verifies the model, token limit, ordered prompts, every image hash and request options for all 13 responses before reuse. All requests matched; no new provider calls occurred. The replay saved 51 units: all previous 49 boundaries/labels were unchanged, and Chick and KIOSK 5 were retained as unlabelled outlines.

The separately labelled post-replay comparison covers all 16 original and all 5 additional points, with 19/19 readable references and 15/17 printed tenant labels correct. The original five negative controls remain excluded and all eleven tested neighbour pairs remain separate. These are development regression samples used to guide fixes, not held-out recall or polygon-IoU measurements.

The final full-page visual review found no other obvious missing retail/café/kiosk demises or false units among the 51 selections. **Remaining cleanup:** confirm Chick, KIOSK 5/Krispy Kreme and Auntie Anne’s identities; KIOSK 5’s tiny contour retains an inward notch around printed text (about 18 × 5 pixels) and needs manual boundary tidying. Some kiosk tenant names in the page legend and Hasty Tasty Pizza’s name remain unread. Centre Showcase promotional space is excluded from the retail scan. This does not certify survey-grade boundaries or every possible commercialisation space.

## Validation and evidence

Final standard regression suite: **195 passed**. TypeScript and the production build passed. Seven actual PostgreSQL concurrency/expiry checks passed; both the real scans and verified replay persisted results into disposable schemas and cleaned them afterward. Focused tests cover unmarked/masked image coordinates, concave exclusions, strict response binding, small-logo repairs, adjacent separation, retained editable ambiguous outlines, and protection against guessed lease links or overwritten manual facts. Existing desktop/phone editing was verified in the earlier browser suite; no new production browser scan was submitted in this round.

The local audit directory `../audit-evidence/evidence-plan-20260907/` contains all five `automatic-provider-brent-cross*` runs, the final `automatic-brent-cross-final-verified-replay`, exact request/response and geometry hashes, independent annotation files, `post-replay-sample-comparison.json`, and `brent-cross-masked-full-plan-visual-review.md`. Private drawing artifacts and credentials are not committed. Provider credentials were supplied only in memory to real runs; the replay used no provider credentials.

## Saved records and deployment

Refresh preserves saved facts, IDs, markers and evidence links. It can refine a uniquely matched, overlapping AI outline; manual edits remain protected. Existing overlapping or incorrectly labelled AI rows can still prevent new outlines being inserted. Fresh-image scan results do not prove that refreshing the current live plan repairs every historical row. Review those conflicts individually; this change does not bulk-delete or replace existing units.

No shared schema or client permission changes are included. No production push/deployment is part of this test round. Existing browser checks covered manual drawing, selection and editing; the new tests cover backend automatic classification and persistence, not a new live production scan.
