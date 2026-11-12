# Work-in-progress backups (12 November 2026)

Temporary. Two builds were part-way through when usage credits ran out, and
neither is on a branch yet. These files let them be picked up again if the
working copies are lost. Delete this folder once both builds have shipped.

- `brand-page-relayout.patch`: the brand page re-layout. Apply on commit
  b5642c3 (`git apply --3way`). Built in five steps and judged once; the
  fix round and second judging are outstanding (findings in
  `brand-page-relayout-results.json`).
- `landsec-menu.patch`: the Landsec menu build. Apply on commit 9946826.
  The numbers, Deals and Properties steps are written; the menu step and
  testing are outstanding (`landsec-menu-results.json`). Before finishing,
  merge the latest shared branch: joint agents now have their own Tracker,
  Viewings and Tasks pages.
- `workflow-*.js`: the build scripts. `seed-*.sql`: local test data only.

Plans: docs/brands-review-2026-11-12.md, docs/landsec-menu-plan-2026-11-12.md.
