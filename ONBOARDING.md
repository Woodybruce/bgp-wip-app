# BGP Dashboard — Claude Code onboarding

Welcome! This guide primes your Claude Code session on the **BGP Dashboard**
(Bruce Gillingham Pollard's property-management platform) so you can get useful
work done without knowing the codebase.

## What this project is

- **BGP Dashboard** — CRM, deals/WIP, properties, leasing schedules, news
  intelligence, expenses, and **ChatBGP** (the AI assistant the team talks to
  inside the app, powered by Claude Fable 5).
- Stack: React + Vite client (`client/`), Express + Drizzle + Postgres server
  (`server/`), deployed on Railway.
- The full feature runbook and past decisions live in `replit.md` — skim it
  before large changes.

## The one rule that matters most

**Everything happens on the branch `claude/terminal-coding-interface-JOGQK`.**

At the start of every session: `git fetch origin` and pull that branch before
touching files — several people (and ChatBGP itself) commit to it, so it moves
fast. Never force-push, never rebase published commits, never `reset --hard`.
Pushing to the branch deploys the app automatically (GitHub Action →
`/api/admin/deploy`), so only push when the work is complete and type-checked.

## House rules

- Read files before editing them; prefer editing over creating new files.
- No speculative refactors or "improvements" beyond what was asked.
- Ask before touching `shared/schema.ts` or `migrations/`.
- Record decisions and new features in `replit.md` so future sessions have
  context.
- Commit style: short, imperative, no prefix, no trailing full stop —
  e.g. `Fix land registry 500 + mobile downloads in chat-panel`.
- Run `npx tsc --noEmit` before pushing. The branch carries a few hundred
  pre-existing type errors — the bar is "no NEW errors", not zero.

## ChatBGP vs Claude Code — who does what

- **ChatBGP** (in the app) is for *using* the platform: enriching companies,
  searching team email, generating documents, updating the CRM. It can even
  edit its own source code on the server.
- **Claude Code** (this session) is for *changing* the platform: fixing bugs,
  adding tools and features, reviewing what ChatBGP built.
- If someone reports "ChatBGP said X is broken", the fix usually lives in
  `server/chatbgp.ts` (the AI engine, its tools live there too).

## Where things live

| Area | Path |
|------|------|
| ChatBGP AI engine + all its tools | `server/chatbgp.ts` |
| REST routes | `server/routes.ts` |
| CRM logic | `server/crm.ts` |
| Expenses / approvals / Xero posting | `server/stripe-issuing.ts`, `server/expense-*.ts` |
| News feeds + paywall logins | `server/news-feeds.ts`, `server/auth-cookies.ts` |
| Contact enrichment (RocketReach/Apollo) | `server/rocketreach-contacts.ts`, `server/contacts-discovery.ts` |
| Companies House accounts reader | `server/ch-accounts.ts` |
| DB schema | `shared/schema.ts` |
| Client pages (50+) | `client/src/pages/` |
| Mobile app UI | `client/src/components/mobile-app.tsx` |
| Push-to-deploy | `server/auto-deploy.ts`, `.github/workflows/auto-deploy.yml` |
| Admin integrations status | `server/integrations-status.ts` |

## Good first prompts

- "Pull the latest JOGQK and tell me what changed this week."
- "ChatBGP reported this bug: *paste the message* — find and fix it."
- "Add [publication] to the news feeds."
- "Why is [tile/page] showing the wrong number?"

## Who to ask

Woody Bruce (woody@brucegillinghampollard.com) owns the platform and approves
anything architectural, schema changes, or new paid integrations.
