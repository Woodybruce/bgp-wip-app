# Usability and design review — 7 September 2026

The app has an established visual language worth retaining: warm neutral surfaces, terracotta actions, serif headings, compact pills and dedicated phone sections. The main weaknesses found in this pass were information hierarchy, editing feedback and consistency between client permissions and the controls shown.

The review began from local commit `497aafa5` on `claude/terminal-coding-interface-JOGQK`. GitHub had no newer commits when fetched. Work remains in the isolated Codex checkout; the original Claude checkout is unchanged. Nothing was pushed or deployed.

## Implemented in this pass

| Finding | Change |
| --- | --- |
| Phone WIP controls filled the screen before any figures appeared. | Single-row scrolling Deals navigation; compact WIP heading; Add deal stays visible; More contains Refresh Xero, Download Excel and Print; search stays visible and Filters expands the other filter groups with an active count. |
| Finding a deal required scrolling past every summary board. | View N deals jumps to the phone cards, and Back to summary returns to the figures. Both moves transfer keyboard focus. Existing charts and cross-filtering remain. |
| Columns appeared on phones but only changed the desktop table. | The control appears only with the desktop table. |
| Rapidly closing More and opening a filter could immediately dismiss the filter. | The closing menu preserves focus that has already moved to another control; normal Escape still returns focus to More. Browser focus-event tracing reproduced the delayed restoration race. |
| A failed WIP request could look like a valid empty £0 report. | Initial failures show a clear error and Retry. Failed background refreshes retain the previous figures with an explicit stale-data notice. |
| Scoped client property fields were rendered as plain text or omitted. | Status, Asset class, BGP team, Website and Area now expose their permitted editors, including blank fields. Server record scoping and separate ownership/internal-tool rules remain. |
| Text, number and select inline editors required a mouse. | Native keyboard-accessible triggers, optional descriptive labels and focus restoration. The property address/name edit trigger is also a labelled button. |
| Numeric input such as `120k` silently became `120`. | Full-value validation accepts decimal numbers, correctly grouped commas and blank-to-null; invalid input remains editable with an explanatory error. |
| Inline edits closed before asynchronous saves succeeded. | Shared editors support Promise callbacks, show Saving, preserve rejected drafts and offer Save/Cancel. Property Website and Area use this completion-aware path. Synchronous guards prevent Enter/blur/unmount from duplicating a save or committing a cancelled edit. |
| Same-deal background updates erased open form drafts. | Reset only when opening or switching records. A newer-version notice explains when the preserved draft differs from the live record. Cancel/reopen loads the latest values. |
| Client deal forms offered internal fee controls that the API rejects or discards. | Fee, Fee Agreement and allocation panels/requests are hidden from clients; business rent, pricing, area, tenure and lease terms remain. |

At a 390 × 664 CSS-pixel phone viewport, the WIP summary moved from **639px to 405px** from the top: **234px earlier, about 37% less preceding space**. Its totals now fit above the fixed bottom navigation; View deals is visible without first scrolling through the report. This measures screen space, not a measured improvement in task-completion time.

## Next design priorities

1. **Put the user's work ahead of the tool directory.** A compact phone task preview should sit immediately after portfolio/billing figures. Current tasks follow shortcuts, Boards and the AI briefing. Keep the broader tools available below. Source: `client/src/components/mobile-home.tsx`.
2. **Use consistent metric names across devices.** Phone “Total billing” includes WIP plus invoiced fees; “Total net fees” would match that measure. Phone “Units” counts tracker entries, whereas desktop “Total units” counts the rent roll; call the former “Tracked units.” These are different measures, not evidence of an arithmetic bug. Source: `client/src/components/mobile-home.tsx`.
3. **Separate brand navigation from AI prompts.** Staff brand pages show eight suggested questions styled like section tabs. Put these actions in a compact Suggested questions disclosure with sentence-case buttons. Preserve the intentional staff Chat-first and client Contacts-first landing. Sources: `client/src/components/mobile-brand-view.tsx`, `client/src/components/brand-profile-panel.tsx`.
4. **Extend reliable saving and concurrency handling.** Migrate other void mutation callbacks to completion-aware saves as their screens are touched. Add server-backed conflict handling before claiming simultaneous edits are safe. The deal dialog still submits a full form; its new notice informs the user, but does not prevent last-write-wins overwrites. A naive per-field payload diff is insufficient: floor areas/total, property/unit/team, billing contact fields and entity pairs have dependencies.

The larger changes above are recommendations, not implemented redesigns. The parked items in `qa/UX-NOTES.md` remain parked.

## Validation and evidence

- TypeScript check and production build passed.
- 63 focused regression tests passed, including 15 shared-editor cases and 3 deal-draft cases.
- Established desktop smoke: 52 checks passed. The optional database tracker-sync subcheck was not rerun in that invocation; no tracker logic changed in this pass.
- Established phone session/navigation smoke: 21 checks passed, including staff/client account isolation and fixture cleanup.
- Visual sweep: 22 actual staff/client desktop and phone views, covering home, deals, WIP (staff), properties, a property record and a brand profile. No horizontal page overflow or uncaught JavaScript errors were recorded. The first brand capture used an incorrect `/brands/:id` URL; it was corrected to `/companies/:id`, recaptured separately, and all final captures use the actual route.
- Final focused interaction suite: **48/48 checks passed over local HTTPS**, with zero uncaught page errors. It covers Secure/HttpOnly session cookies, phone actions/filter persistence/chart jumps, normal and rapid menu focus transitions, cold and stale WIP error recovery, client keyboard editing, invalid-number rejection, failed-save retry and fixture restoration, business-field visibility without fee requests, and real 30-second deal-query refreshes preserving drafts with the newer-version notice. Results: `audit-evidence/ux-20260906/final/results.json` beside the checkout.

The companion `BGP-USABILITY-REVIEW.html` and `audit-evidence/ux-20260906/` sit beside this checkout in the Codex workspace. The report presents matched before/after WIP screenshots. `qa/ux-review.mjs` and `qa/ux-smoke.mjs` preserve the local visual and interaction checks.

Tests use an isolated fixture database and Chrome with desktop/phone emulation, not production records or physical Safari devices. The final focused pass uses local HTTPS so production Secure session cookies can be exercised. Earlier plain-HTTP captures used bearer authentication; cookie-only ancillary requests can fail in that setup, so missing names, imagery and unconfigured provider panels are not treated as established production design defects. No live Microsoft, Xero or AI action was invoked by the focused suite.

This is a focused usability review, not a whole-app accessibility certification. Label dropdowns retain their existing save behavior; only Promise-aware callers can keep an asynchronous failure in an open editor. Existing number-popover unmount commits remain, and an unmounted editor cannot display a later failure. No schema, access-scope policy or deployment configuration changed.
