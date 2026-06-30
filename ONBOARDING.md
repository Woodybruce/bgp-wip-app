# Onboarding — BGP Dashboard (for Luke)

Welcome. This gets you working on the **BGP Dashboard** (Bruce Gillingham Pollard
property platform) with your own Claude Code account. ~20 minutes end to end.

Stack: React + Vite + Wouter (client) · Express + Drizzle + Postgres (server) ·
ChatBGP (Claude AI) · deployed on Railway. Repo: `Woodybruce/bgp-wip-app`.

---

## 1. Get your own Claude Code

You need your **own** Claude account with Claude Code (a Pro/Max plan, or API
billing) — it's per person.

```bash
npm install -g @anthropic-ai/claude-code
```

Then later, inside the project folder, run `claude` and sign in with `/login`
using your own account. (You can also use claude.ai/code in the browser, the
desktop app, or the VS Code / JetBrains extension — same account everywhere.)

> Ask Woody to add you as a **collaborator** on the GitHub repo
> (`github.com/Woodybruce/bgp-wip-app` → Settings → Collaborators) so you can
> push branches and open PRs.

## 2. Get the code

The repo is public, so clone it directly:

```bash
git clone https://github.com/Woodybruce/bgp-wip-app.git
cd bgp-wip-app
npm install
```

`CLAUDE.md` (already in the repo) tells your Claude Code the project rules,
branch workflow, and key files automatically — no setup needed.

## 3. Get database / secrets access (Railway)

Secrets are **not** in the repo. The database lives on Railway. Ask Woody to
invite you to the **`jubilant-cat`** Railway project (Railway dashboard →
Project → Settings → Members). Then:

```bash
# install the Railway CLI if you don't have it
npm install -g @railway/cli      # or: brew install railway

railway login                    # opens a browser
railway link                     # pick: jubilant-cat → production → bgp-wip-app
```

Run things with the production env injected:

```bash
railway run npm run dev          # run the app locally against prod env
```

For direct DB queries from your laptop, use the **public** connection string
(the internal `postgres.railway.internal` host only resolves inside Railway):

```bash
PUBURL=$(railway variables --service Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)
psql "$PUBURL" -c "select count(*) from crm_properties;"
```

> Always **read first, write deliberately** against production. There's one
> shared live database — there is no separate staging DB.

## 4. How we work together (important)

Woody bounces between his laptop and the web on a single shared branch
(`claude/terminal-coding-interface-JOGQK`). **Don't commit to that branch** — two
people on it will collide. Instead, branch-per-person:

```bash
git checkout main && git pull
git checkout -b claude/luke-<short-task-name>
# ...do the work, commit...
git push -u origin claude/luke-<short-task-name>
gh pr create --base main         # open a PR into main
```

Commit style: short, imperative, no scope prefix, no trailing period
(e.g. `Fix land registry 500 in chat-panel`).

Never force-push, rebase published commits, or `reset --hard` without asking.

## 5. Sanity check you're set up

- [ ] `claude` runs and you're signed in with your own account
- [ ] `npm run dev` starts the app (needs Railway env or a local `.env`)
- [ ] `railway whoami` shows you, and `railway status` shows `jubilant-cat`
- [ ] `psql "$PUBURL" -c "select 1;"` returns a row
- [ ] You can push a branch and open a PR

## Where to look

| Area | Path |
|------|------|
| Pages | `client/src/pages/` |
| Components | `client/src/components/` |
| Server entry | `server/index.ts` |
| REST routes | `server/routes.ts` |
| ChatBGP AI engine | `server/chatbgp.ts` |
| DB schema | `shared/schema.ts` |
| Full runbook | `replit.md` |

Stuck? Ask Woody, or ask your Claude Code — it has `CLAUDE.md` and the whole
codebase in context.
