/**
 * Branch-mode helper for ChatBGP code edits.
 *
 * ChatBGP's `edit_source_file` tool used to write straight to the working
 * tree of whichever branch was deployed (typically claude/terminal-coding-
 * interface-JOGQK). One bad edit could brick the live app. This helper lets
 * the dispatcher build the new file content in memory, commit it to a
 * `chatbgp/<YYYY-MM-DD>` branch via git plumbing — without ever touching
 * the live working tree — and tell the admin "ready to review and merge".
 *
 * Plumbing (no checkout, no working-tree change):
 *   1. `git hash-object -w --stdin` writes the new content as a blob.
 *   2. A temporary GIT_INDEX_FILE is populated from either the chatbgp
 *      branch tip (so subsequent edits stack) or HEAD (first edit of the
 *      day).
 *   3. `git update-index --add --cacheinfo` swaps the file's blob.
 *   4. `git write-tree` writes the modified tree.
 *   5. `git commit-tree` makes the commit, parented on the chatbgp branch
 *      tip if it exists, else HEAD.
 *   6. `git update-ref` moves `refs/heads/chatbgp/<date>` forward.
 *
 * The deploy branch and working tree are unchanged. To make the edit live:
 *   git checkout <deploy-branch>
 *   git merge chatbgp/<date>
 *   (and restart, if the change requires a server reload)
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface BranchCommitArgs {
  filePath: string;       // path relative to project root
  newContent: string;     // full new file content
  description: string;    // commit message subject
  userName?: string;      // who triggered the edit (for trailer)
  userEmail?: string;     // for git author
}

export interface BranchCommitResult {
  branch: string;         // e.g. "chatbgp/2026-05-09"
  commitHash: string;
  parentHash: string;
  isFirstCommit: boolean; // true if branch was created by this commit
  filePath: string;
  byteCount: number;
  message: string;        // human-readable summary
}

const PROJECT_ROOT = process.cwd();

function gitExec(cmd: string, opts: { input?: string; env?: NodeJS.ProcessEnv } = {}): string {
  return execSync(cmd, {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
    input: opts.input,
    env: { ...process.env, ...(opts.env || {}) },
  }).trim();
}

function todayStamp(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Commit a single-file change to the dated chatbgp branch. Returns the new
 * commit hash + branch name. Throws on git plumbing failure (caller should
 * surface the error).
 */
export function commitToChatbgpBranch(args: BranchCommitArgs): BranchCommitResult {
  const branchName = `chatbgp/${todayStamp()}`;
  const refName = `refs/heads/${branchName}`;

  // Sanity: must be inside a git repo.
  try {
    gitExec("git rev-parse --is-inside-work-tree");
  } catch {
    throw new Error("Not inside a git repository — branch-mode unavailable.");
  }

  // 1. Hash the new content as a blob (writes the blob to git's object store
  //    without ever touching the working tree).
  const blobHash = gitExec("git hash-object -w --stdin", { input: args.newContent });

  // 2. Decide the parent commit. If the chatbgp branch already exists,
  //    parent on its tip so edits stack. Otherwise parent on HEAD.
  let parent: string;
  let isFirstCommit: boolean;
  let baseRef: string;
  try {
    parent = gitExec(`git rev-parse --verify ${refName}`);
    baseRef = refName;
    isFirstCommit = false;
  } catch {
    parent = gitExec("git rev-parse HEAD");
    baseRef = "HEAD";
    isFirstCommit = true;
  }

  // 3. Build a temporary index that mirrors `baseRef`'s tree, then swap the
  //    file's blob. Using a temp index file keeps the live `.git/index`
  //    untouched (so the deploy branch's working tree stays clean).
  const tempIndex = path.join(
    os.tmpdir(),
    `chatbgp-index-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  try {
    const env = { GIT_INDEX_FILE: tempIndex } as NodeJS.ProcessEnv;
    gitExec(`git read-tree ${baseRef}`, { env });
    // git update-index expects a path relative to the repo root; normalise.
    const relPath = path.posix.normalize(args.filePath.replace(/^\/+/, "")).replace(/\\/g, "/");
    if (relPath.startsWith("..")) throw new Error("filePath escapes repo root");
    gitExec(
      `git update-index --add --cacheinfo 100644,${blobHash},"${relPath}"`,
      { env },
    );
    const treeHash = gitExec("git write-tree", { env });

    // 4. Build the commit. We set author + committer explicitly so commits
    //    work even when the running container's git config has no user set.
    const authorName = args.userName || "ChatBGP";
    const authorEmail = args.userEmail || "chatbgp@brucegillinghampollard.com";
    const commitEnv: NodeJS.ProcessEnv = {
      GIT_AUTHOR_NAME: authorName,
      GIT_AUTHOR_EMAIL: authorEmail,
      GIT_COMMITTER_NAME: "ChatBGP",
      GIT_COMMITTER_EMAIL: "chatbgp@brucegillinghampollard.com",
    };
    const subject = `ChatBGP: ${args.description}`.slice(0, 200);
    const body = [
      `File: ${relPath}`,
      `Triggered-by: ${authorName}`,
      "",
      "This commit was authored by ChatBGP via edit_source_file.",
      "It lives on a chatbgp/<date> branch. To make it live, an admin",
      "must merge the branch into the deploy branch (and restart if",
      "the change requires a server reload).",
    ].join("\n");
    const commitMsg = `${subject}\n\n${body}\n`;
    const commitHash = gitExec(
      `git commit-tree ${treeHash} -p ${parent}`,
      { input: commitMsg, env: commitEnv },
    );

    // 5. Move (or create) the chatbgp branch ref to point at the new commit.
    gitExec(`git update-ref ${refName} ${commitHash}`);

    return {
      branch: branchName,
      commitHash,
      parentHash: parent,
      isFirstCommit,
      filePath: relPath,
      byteCount: Buffer.byteLength(args.newContent, "utf-8"),
      message:
        `Committed to ${branchName} as ${commitHash.slice(0, 8)} ` +
        `(${args.newContent.split("\n").length} lines). ` +
        `To apply: \`git merge ${branchName}\` on the deploy branch and restart.`,
    };
  } finally {
    try { if (fs.existsSync(tempIndex)) fs.unlinkSync(tempIndex); } catch {}
  }
}

/**
 * List existing chatbgp/* branches and their tip commits — useful for the
 * `merge_chatbgp_branch` tool and for admin review.
 */
export function listChatbgpBranches(): Array<{
  branch: string;
  tipHash: string;
  tipMessage: string;
  ahead: number;          // commits ahead of HEAD
}> {
  let output: string;
  try {
    output = execSync(
      "git for-each-ref --format='%(refname:short)|%(objectname)|%(subject)' refs/heads/chatbgp/",
      { cwd: PROJECT_ROOT, encoding: "utf-8" },
    ).trim();
  } catch {
    return [];
  }
  if (!output) return [];

  const branches: Array<{ branch: string; tipHash: string; tipMessage: string; ahead: number }> = [];
  for (const line of output.split("\n")) {
    const cleaned = line.replace(/^'|'$/g, "");
    const [branch, tipHash, tipMessage] = cleaned.split("|");
    if (!branch || !tipHash) continue;
    let ahead = 0;
    try {
      const aheadStr = execSync(
        `git rev-list --count HEAD..${tipHash}`,
        { cwd: PROJECT_ROOT, encoding: "utf-8" },
      ).trim();
      ahead = parseInt(aheadStr, 10) || 0;
    } catch {}
    branches.push({ branch, tipHash, tipMessage: tipMessage || "", ahead });
  }
  return branches;
}
