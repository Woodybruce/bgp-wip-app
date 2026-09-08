// CI supplies the exact smoke-tested commit. Build output is staged away
// from the served release, and the status endpoint confirms the restarted
// bundle's compiled SHA before the workflow reports success.
import type { Express, Request, Response } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";

const runFile = promisify(execFile);
const REPO_DIR = process.cwd();
const DEPLOYED_SHA_MARKER = path.join(REPO_DIR, ".deployed-sha");
const RUNNING_SHA = process.env.BGP_BUILD_SHA || "";

type DeploymentState = {
  status: "checking" | "building" | "migrating" | "restarting" | "failed";
  sha: string;
  error?: string;
};
let deploying = false;
let deploymentState: DeploymentState | null = null;

async function git(args: string[]): Promise<string> {
  const { stdout } = await runFile("git", args, { cwd: REPO_DIR, timeout: 120_000, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

async function isDeployAuthorized(req: Request): Promise<boolean> {
  const secret = process.env.DEPLOY_WEBHOOK_SECRET;
  const provided = req.header("x-deploy-secret") || "";
  if (secret && provided && provided === secret) return true;
  const userId = req.session?.userId || req.tokenUserId;
  if (!userId) return false;
  try {
    const { pool } = await import("./db");
    const result = await pool.query("SELECT is_admin, is_active FROM users WHERE id = $1", [userId]);
    return result.rows[0]?.is_admin === true && result.rows[0]?.is_active !== false;
  } catch {
    return false;
  }
}

async function requireCleanCheckout(expectedSha?: string): Promise<void> {
  const dirty = await git(["status", "--porcelain", "--untracked-files=normal", "--", ".", ":(exclude).deployed-sha"]);
  if (dirty) throw new Error("Local checkout has edits; commit and test them in CI before deployment");
  if (expectedSha && await git(["rev-parse", "HEAD"]) !== expectedSha) {
    throw new Error("Checkout changed during deployment; the tested commit was not built");
  }
}

function validateBuiltRelease(stagedDir: string): void {
  for (const relative of ["index.cjs", "public/index.html"]) {
    if (!fs.statSync(path.join(stagedDir, relative)).isFile()) throw new Error(`Build is missing ${relative}`);
  }
}

// Keep the handoff short and restore the complete old directory on failure.
// This is a two-rename handoff, not an atomic multi-instance release switch.
export function promoteBuiltRelease(stagedDir: string, liveDir: string, previousDir: string): void {
  validateBuiltRelease(stagedDir);
  const hadLive = fs.existsSync(liveDir);
  if (hadLive) fs.renameSync(liveDir, previousDir);
  try {
    fs.renameSync(stagedDir, liveDir);
  } catch (error) {
    if (hadLive) fs.renameSync(previousDir, liveDir);
    throw error;
  }
}

async function buildAndActivate(sha: string): Promise<void> {
  const cacheDir = path.join(REPO_DIR, "node_modules", ".cache");
  await fs.promises.mkdir(cacheDir, { recursive: true });
  const stagedDir = await fs.promises.mkdtemp(path.join(cacheDir, "bgp-deploy-"));
  const liveDir = path.join(REPO_DIR, "dist");
  const previousDir = `${stagedDir}.previous`;
  let promoted = false;
  const priorMarker = fs.existsSync(DEPLOYED_SHA_MARKER) ? fs.readFileSync(DEPLOYED_SHA_MARKER, "utf8") : null;
  try {
    deploymentState = { status: "building", sha };
    await runFile("npm", ["run", "build"], {
      cwd: REPO_DIR,
      timeout: 15 * 60_000,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, DATABASE_URL: undefined, NODE_ENV: "production", BGP_BUILD_OUTPUT_DIR: stagedDir, BGP_BUILD_SHA: sha },
    });
    await requireCleanCheckout(sha);
    validateBuiltRelease(stagedDir);

    // Preserve the existing deployment migrations as an explicit phase only
    // after compilation succeeds. A migration failure stops activation, but
    // completed additive database changes cannot be automatically rolled back.
    deploymentState = { status: "migrating", sha };
    await runFile("npm", ["run", "build", "--", "--migrate-only"], {
      cwd: REPO_DIR,
      timeout: 5 * 60_000,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, NODE_ENV: "production" },
    });
    await requireCleanCheckout(sha);

    // Existing tabs may still request an older content-hashed lazy chunk.
    // Preserve those files alongside the new assets before changing index.html.
    const oldAssets = path.join(liveDir, "public", "assets");
    if (fs.existsSync(oldAssets)) {
      await fs.promises.cp(oldAssets, path.join(stagedDir, "public", "assets"), { recursive: true, force: false, errorOnExist: false });
    }
    promoteBuiltRelease(stagedDir, liveDir, previousDir);
    promoted = true;
    fs.writeFileSync(DEPLOYED_SHA_MARKER, sha);
    deploymentState = { status: "restarting", sha };
    process.kill(1, "SIGUSR2");
  } catch (error) {
    if (promoted) {
      fs.renameSync(liveDir, stagedDir);
      if (fs.existsSync(previousDir)) fs.renameSync(previousDir, liveDir);
      if (priorMarker !== null) fs.writeFileSync(DEPLOYED_SHA_MARKER, priorMarker);
      else fs.rmSync(DEPLOYED_SHA_MARKER, { force: true });
    }
    throw error;
  } finally {
    // Only the unique staging directory is removed; retained previous
    // releases are deliberately left for a manual rollback/cleanup policy.
    await fs.promises.rm(stagedDir, { recursive: true, force: true });
  }
}

export function registerAutoDeployRoutes(app: Express) {
  app.get("/api/admin/deploy/status", async (req: Request, res: Response) => {
    if (!(await isDeployAuthorized(req))) return res.status(403).json({ error: "Deploy not authorised" });
    res.set("Cache-Control", "no-store");
    if (deploymentState) return res.json(deploymentState);
    return res.json({ status: RUNNING_SHA ? "deployed" : "unknown", sha: RUNNING_SHA || null });
  });

  app.post("/api/admin/deploy", async (req: Request, res: Response) => {
    if (!(await isDeployAuthorized(req))) return res.status(403).json({ error: "Deploy not authorised" });
    const sha = String(req.header("x-deploy-sha") || req.body?.sha || "").toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(sha)) return res.status(400).json({ error: "The exact CI-tested commit SHA is required" });
    if (deploying) return res.status(409).json({ status: "already_deploying", sha: deploymentState?.sha });
    deploying = true;
    deploymentState = { status: "checking", sha };
    try {
      await requireCleanCheckout();
      const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
      if (branch === "HEAD") throw new Error("Deploy requires the configured working branch");
      await git(["fetch", "--no-tags", "origin", branch]);
      if (await git(["rev-parse", "FETCH_HEAD"]) !== sha) {
        throw new Error("Remote branch no longer matches the tested SHA; wait for its own CI run");
      }
      if (await git(["rev-list", "--count", `${sha}..HEAD`]) !== "0") {
        throw new Error("Server has local or diverged commits; publish and test them through CI first");
      }
      const checkoutSha = await git(["rev-parse", "HEAD"]);
      const dependencyChanges = await git(["diff", "--name-only", RUNNING_SHA || checkoutSha, sha, "--", "package.json", "package-lock.json", "npm-shrinkwrap.json", ".npmrc"]);
      if (dependencyChanges) {
        throw new Error("Dependencies changed since the running release; deploy through the native platform with a fresh dependency install");
      }
      if (checkoutSha !== sha) await git(["merge", "--ff-only", sha]);
      await requireCleanCheckout(sha);
      if (RUNNING_SHA === sha) {
        deploying = false;
        deploymentState = null;
        return res.json({ status: "up_to_date", sha });
      }

      res.status(202).json({ status: "building", sha });
      void buildAndActivate(sha).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[deploy] release failed:", message.slice(0, 500));
        deploymentState = { status: "failed", sha, error: message.slice(0, 500) };
      }).finally(() => { deploying = false; });
    } catch (error) {
      deploying = false;
      const message = error instanceof Error ? error.message : String(error);
      deploymentState = { status: "failed", sha, error: message };
      return res.status(409).json(deploymentState);
    }
  });
}
