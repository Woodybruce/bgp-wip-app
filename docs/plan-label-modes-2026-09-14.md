# Evidence-plan label choices

Pete can choose **Compact labels**, **Circles** or **Dots only** in the plan viewer. Compact labels are the default. The choice is stored per signed-in user in that browser and applies across plans; it does not change another user's view.

- Compact labels show the unit reference and an evidence-colour dot. Select a unit for its details, or turn on **Compare rents** to show available Zone A figures together.
- Circles retain the coloured summary format. The existing **£ ZA** control shows or hides the figures.
- Dots only keeps the drawing clear, with a compact label for the selected unit where it fits.
- Unit numbers and Clean plan remain available. Switching presentation does not reset an open unit-edit form.

Annotations use a fixed 12px sans-serif reference and 11px monospace price at every zoom. Labels that cannot fit within their demise become dots; a dot that cannot fit remains available through the unit outline and list. Compact labels also resolve collisions by prioritising the selected unit, then evidence. This changes presentation only: it does not move saved anchors or infer new unit identities.

The scan-review links for Zara and Holland & Barrett are separate from this change. No production geometry, evidence, tenancy records or access permissions are modified by these display controls.

Validation on 14–15 September: 31 marker containment/collision, outline-display and evidence-data regressions passed; TypeScript check and production build passed. Local browser checks used the original 2845×2134 Brent Cross image with synthetic QA tenants/evidence and verified all three styles, fixed 12px Arial references, retained/saved edits, saved keyboard label movement, preference persistence after reload, and Compare rents / £ ZA control consistency. The disposable QA servers and database were stopped afterwards. No live deployment or physical-phone check was performed.
