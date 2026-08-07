# Rolling QA log

Memory for the rolling visual-testing routine. Each round runs in a FRESH
session with no chat history — this file is how rounds remember each other.
Read it before testing; append a terse entry after. Keep entries short.

## How to use
- Pick the next journey from the rotation below — cover what recent rounds
  didn't. One exploratory journey per round, plus the scripted regression.
- Known flakes and environment noise are listed so they aren't re-triaged
  every round. Add new ones as found.
- UX/improvement suggestions go to `qa/UX-NOTES.md` (NOT implemented without
  Woody's numbered confirmation).

## Rotation (persona × surface)
1. BGP staff · desktop (victoria@brucegillinghampollard.com)
2. Landsec client · desktop (mark.warne@landsec.com)
3. Landsec client · mobile 390px
4. BGP staff · mobile 390px

Vary the task each visit: tracker work, brand profiles, requirements, deals
board, tenancy schedules, ChatBGP, comps, tasks, contacts, news, Image Studio.

## Environment noise (ignore, do not triage)
- 503s from AI/M365 endpoints — no Anthropic/Microsoft keys locally
- 404s on missing brand/unit photos
- 429s from the login rate limiter after repeated runs (restart app to clear)
- URL-less "Failed to load resource" console echoes

## Known flakes
- postgres dies on container restart — `service postgresql start`, rm stale
  postmaster.pid if needed
- bare root gotos can throw ERR_ABORTED on redirect-on-mount — hardened in
  qa helpers (round 204); use the tolerant visit() pattern
- tsx does not hot-reload server/*.ts — restart the server after server fixes

## Rounds
(carried over: the previous rolling session completed ~204 scripted rounds
green through 2026-08-06, growing qa/two-bot-round.mjs as it went)
