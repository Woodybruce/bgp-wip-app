# CLAUDE.md

Project-specific instructions for Claude Code sessions on this repo.
Applies to both web (claude.ai/code) and terminal Claude Code.

## Project

**BGP Dashboard** — Bruce Gillingham Pollard property management platform.
React + Vite + Wouter (client), Express + Drizzle + Postgres (server),
ChatBGP (Claude-powered AI), deployed on Railway.

See `replit.md` for the full feature runbook, architecture decisions,
and integration notes.

## Working branch

Default working branch: `claude/terminal-coding-interface-JOGQK`

Woody bounces between:
- Terminal Claude Code on his laptop
- Web Claude Code (claude.ai/code) when away from his desk

Both environments share code through GitHub on this branch.

## Sync protocol (IMPORTANT)

At the **start** of every session:
1. Run `git fetch origin` and check if `origin/claude/terminal-coding-interface-JOGQK`
   is ahead of local `HEAD`.
2. If it is, `git pull origin claude/terminal-coding-interface-JOGQK` before
   touching any files. This picks up whatever was done on the other machine.
3. Report the state to Woody in one line (e.g. "Pulled 3 commits from remote"
   or "Already up to date").

At the **end** of every session, or whenever Woody says "push":
1. Commit any outstanding changes with a clear message.
2. Push: `git push -u origin claude/terminal-coding-interface-JOGQK`.
3. Confirm the push succeeded.

**Never push without being asked**, except when Woody says "push" or
equivalent ("ship it", "send it up", "save to GitHub").

**Never force-push, rebase published commits, or reset --hard** without
explicit permission.

## Commit style

- Match the existing commit style (see `git log --oneline -20`).
- Short, imperative, no scope prefix, no trailing period.
- Examples from history: "Fix land registry 500 + mobile downloads in chat-panel",
  "Fix pixelated company logos — switch from Google Favicons to Clearbit".

## Working style

- Read files before editing them. Don't guess at code you haven't seen.
- Prefer editing existing files over creating new ones.
- Don't add speculative abstractions, helpers, or "improvements" beyond what
  was asked.
- Don't add comments, docstrings, or type annotations to code you didn't change.
- Ask before making architectural changes or touching shared schemas
  (`shared/schema.ts`, migrations).
- For UI changes, say explicitly when you haven't verified in a browser.

## Key files

| Area | Path |
|------|------|
| Client entry | `client/src/main.tsx`, `client/src/App.tsx` |
| Pages (50+) | `client/src/pages/` |
| Server entry | `server/index.ts` |
| REST routes | `server/routes.ts` |
| ChatBGP AI engine | `server/chatbgp.ts` |
| CRM logic | `server/crm.ts` |
| AI model strategies | `server/models.ts` |
| DB schema | `shared/schema.ts` |
| Migrations | `migrations/` |
| Build script | `script/build.ts` |
| Project runbook | `replit.md` |
