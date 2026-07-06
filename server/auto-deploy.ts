// Push-to-deploy: GitHub Actions calls POST /api/admin/deploy on every push
// to the working branch (.github/workflows/auto-deploy.yml). The endpoint
// reconciles the server checkout with GitHub — publishing any server-local
// commits (ChatBGP self-edits) first — then rebuilds and restarts, so
// "fixed in source" and "live" can no longer drift apart.
//
// Auth: x-deploy-secret header must equal DEPLOY_WEBHOOK_SECRET, or a
// signed-in admin session (manual "deploy now").
//
// Failure stance: a build failure keeps the current bundle running; a
// rebase conflict aborts cleanly and reports "diverged" without touching
// the running app.

import type { Express, Request, Response } from "express";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const DEPLOYED_SHA_MARKER = path.join(process.cwd(), ".deployed-sha");

function sh(cmd: string, timeoutMs = 120_000): string {
  return execSync(cmd, { encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

let deploying = false;

export function registerAutoDeployRoutes(app: Express) {
  app.post("/api/admin/deploy", async (req: Request, res: Response) => {
    const secret = process.env.DEPLOY_WEBHOOK_SECRET;
    const provided = req.header("x-deploy-secret") || "";
    let authed = !!(secret && provided && provided === secret);
    if (!authed) {
      const sessionUserId = (req.session as any)?.userId || (req as any).tokenUserId;
      if (sessionUserId) {
        try {
          const { pool } = await import("./db");
          const r = await pool.query("SELECT is_admin FROM users WHERE id = $1", [sessionUserId]);
          authed = !!r.rows[0]?.is_admin;
        } catch {}
      }
    }
    if (!authed) return res.status(403).json({ error: "Deploy not authorised" });

    if (deploying) return res.status(409).json({ status: "already_deploying" });
    deploying = true;
    const steps: string[] = [];
    try {
      const branch = sh("git rev-parse --abbrev-ref HEAD");
      sh(`git fetch origin ${branch}`);
      const localSha = sh("git rev-parse HEAD");
      const remoteSha = sh(`git rev-parse origin/${branch}`);
      const deployedSha = fs.existsSync(DEPLOYED_SHA_MARKER) ? fs.readFileSync(DEPLOYED_SHA_MARKER, "utf8").trim() : "";

      if (localSha === remoteSha && localSha === deployedSha) {
        deploying = false;
        return res.json({ status: "up_to_date", sha: localSha.slice(0, 7) });
      }

      // Publish server-local commits (ChatBGP self-edits, in-place merges)
      // before pulling, so GitHub stays the single source of truth. Best
      // effort — a failed push (no credentials) doesn't block the deploy.
      const localAhead = sh(`git rev-list --count origin/${branch}..HEAD`);
      if (localAhead !== "0") {
        try {
          sh(`git push origin HEAD:${branch}`);
          steps.push(`published ${localAhead} server-local commit(s) to GitHub`);
        } catch (e: any) {
          steps.push(`could not publish local commits (${String(e?.message || e).slice(0, 120)}) — continuing`);
        }
      }

      const remoteAhead = sh(`git rev-list --count HEAD..origin/${branch}`);
      if (remoteAhead !== "0") {
        try {
          sh(`git pull --rebase origin ${branch}`, 300_000);
          steps.push(`rebased onto ${remoteAhead} new GitHub commit(s)`);
          try { sh(`git push origin HEAD:${branch}`); } catch {}
        } catch (e: any) {
          try { sh("git rebase --abort || true"); } catch {}
          deploying = false;
          return res.status(500).json({
            status: "diverged",
            error: "Server checkout and GitHub have conflicting histories — resolve manually, current bundle untouched.",
            steps,
          });
        }
      }

      // Respond before the multi-minute build so the webhook doesn't time out.
      const sha = sh("git rev-parse HEAD");
      res.json({ status: "deploying", sha: sha.slice(0, 7), steps });

      setImmediate(() => {
        try {
          console.log(`[deploy] building ${sha.slice(0, 7)}…`);
          sh("npm run build", 15 * 60_000);
          fs.writeFileSync(DEPLOYED_SHA_MARKER, sha);
          console.log("[deploy] build ok — restarting");
          execSync("kill -USR2 1 2>/dev/null || true", { timeout: 5000 });
        } catch (e: any) {
          console.error("[deploy] build failed — keeping current bundle:", String(e?.message || e).slice(0, 300));
        } finally {
          deploying = false;
        }
      });
    } catch (e: any) {
      deploying = false;
      if (!res.headersSent) {
        res.status(500).json({ status: "error", error: String(e?.message || e).slice(0, 300), steps });
      }
    }
  });
}
