# Model Studio — Upgrade Plan

Goal: make Model Studio a trustworthy, Excel-grade modelling surface. Today there is **no calculation engine**: runs write inputs into a copy of the template with SheetJS and read back whatever values Excel last cached; AI-generated models carry LLM-invented numbers; sensitivity/batch runs persist Claude's guesses as completed runs. `@univerjs/presets` is installed but never imported.

## Phase 1 — Stop the bleeding (this branch of work)

### Server maths (server/excel-builder.ts, server/models-advanced.ts)
1. Exit proceeds double/triple-counted in XIRR / MOIC / profit (excel-builder ~902–937; add-in twin code ~2415–2448).
2. DSCR and Interest Cover formulas reference a blank header row → always 0 (~1153, ~1162).
3. Amortising-loan interest/principal split wrong (~743–754).
4. Hardcoded fake sensitivity coefficients (~1255–1260, ~1322–1326) — remove or mark clearly as non-computed.
5. Gross rent goes negative during void periods (~643–670) — floor at 0.
6. "DCF" sheet has a discount rate nothing references (~1777–1795) — wire it or remove the pretence.
7. models-advanced.ts ~390–397: sensitivity/batch runs ask Claude to estimate outputs and persist them as completed runs. Mark these runs `status: "estimated"` (or refuse) — never present guesses as computed results.

### Page structure & UX (client/src/pages/models.tsx)
1. **Wire up the dead components.** ~2,200 of 3,011 lines are unreachable: SpreadsheetViewer, RunModelForm, RunDetails, EmbeddedExcel, SmartRunPanel, SensitivityPanel, ComparePanel, BatchRunPanel, DependencyMap, VersionHistory, MemoButton, ModelDashboard, ModelQA, PropertyLinkBadge are never rendered. Restructure `ModelsPage` into tabs (Templates / Runs / Smart Run / Sensitivity / Compare / Batch) that actually mount them.
2. **Run/template clicks open detail, not download.** Run click → RunDetails dialog (Summary + Excel tabs). Template click → SpreadsheetViewer. Downloads stay on explicit buttons.
3. Remove/fix `OpenInExcelButton` — its endpoint `/api/models/runs/:id/open-in-excel` does not exist (404).
4. Kill the N+1 queries: list endpoints should include `templateName` / sheet counts so cards don't each fetch detail.
5. Delete confirmation dialogs on templates and runs (AlertDialog, not one-click).
6. Grid interaction: click = select (show in formula bar), double-click/Enter/F2 = edit. Honour server `format` metadata for numbers instead of the `|v| < 1 → %` heuristic.
7. Sensitivity heatmap: colour per-column relative to that column's min/max, not hardcoded IRR thresholds applied to every metric.
8. Smart Run results card: derive labels/groups from the template's `outputMapping` instead of a hardcoded BGP schema.

## Phase 2 — A real engine
1. Server-side run path on **HyperFormula**: load template → set input cells → recalc → read output cells. No more stale Excel caches; outputs become computed and testable.
2. Client-side: replace the hand-rolled `<table>` grid with **Univer** (already a dependency) as the single spreadsheet surface — proper select/edit semantics, number formats, formula bar.
3. Store raw numbers + format hints in `outputValues`; render formats client-side from mapping.
4. Unify the three Excel surfaces (grid / SharePoint iframe / add-in) so state cannot diverge: one canonical stored workbook per run.

## Phase 3 — Trust & scale
1. Golden-file maths tests: known input set → expected IRR/MOIC/yields, run in CI.
2. Scenario/version data model (runs as immutable versions of a scenario).
3. Decimal-safe money handling (integer pence or decimal library — no raw floats for £).
4. Row-level ownership/audit on templates and runs.
5. Smart Run: the review step is editable AND is what actually runs.
