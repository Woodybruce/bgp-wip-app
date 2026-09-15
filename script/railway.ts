/**
 * Railway management CLI — manage this service's environment variables and
 * redeploys from code, instead of clicking around the Railway dashboard.
 *
 *   npm run railway -- list                  # variable NAMES (values hidden)
 *   npm run railway -- list --values         # include values (prints secrets!)
 *   npm run railway -- get NAME
 *   npm run railway -- set NAME VALUE         # upsert + redeploy
 *   npm run railway -- set NAME VALUE --no-deploy
 *   npm run railway -- unset NAME             # delete + redeploy
 *   npm run railway -- redeploy
 *   npm run railway -- info
 *
 * Auth: needs a Railway PROJECT token in env RAILWAY_TOKEN (or
 * RAILWAY_API_TOKEN). The project / environment / service ids come from
 * script/railway.config.json (not secrets — useless without the token) and
 * can be overridden by RAILWAY_PROJECT_ID / RAILWAY_ENVIRONMENT_ID /
 * RAILWAY_SERVICE_ID.
 *
 * The token is the ONLY secret — keep it out of the repo. Set it once in the
 * Claude Code environment (or your shell) and this script — and future Claude
 * sessions — can manage Railway without the dashboard.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://backboard.railway.app/graphql/v2";

interface Cfg {
  projectId: string;
  environmentId: string;
  serviceId: string;
  projectName?: string;
  environmentName?: string;
  serviceName?: string;
}

function loadConfig(): Cfg {
  // npm scripts run from the package root; tsx invocations too. Resolve the
  // committed config relative to cwd so this works either way.
  const raw = JSON.parse(readFileSync(join(process.cwd(), "script", "railway.config.json"), "utf8"));
  return {
    projectId: process.env.RAILWAY_PROJECT_ID || raw.projectId,
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID || raw.environmentId,
    serviceId: process.env.RAILWAY_SERVICE_ID || raw.serviceId,
    projectName: raw.projectName,
    environmentName: raw.environmentName,
    serviceName: raw.serviceName,
  };
}

function getToken(): string {
  const t = process.env.RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN;
  if (!t) {
    console.error(
      "Missing RAILWAY_TOKEN. This needs a Railway PROJECT token — create one at\n" +
      "Railway → project → Settings → Tokens, then export RAILWAY_TOKEN=<token>\n" +
      "(or add it to the Claude Code environment so future sessions have it).",
    );
    process.exit(1);
  }
  return t;
}

async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Project-Access-Token": getToken() },
    body: JSON.stringify({ query, variables }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    const msg = json.errors ? json.errors.map((e: any) => e.message).join("; ") : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.data;
}

async function fetchVars(cfg: Cfg): Promise<Record<string, string>> {
  const data = await gql<{ variables: Record<string, string> }>(
    `query($p:String!,$e:String!,$s:String){ variables(projectId:$p, environmentId:$e, serviceId:$s) }`,
    { p: cfg.projectId, e: cfg.environmentId, s: cfg.serviceId },
  );
  return data.variables || {};
}

const where = (cfg: Cfg) => `${cfg.serviceName || cfg.serviceId} (${cfg.environmentName || cfg.environmentId})`;

async function listVars(showValues: boolean) {
  const cfg = loadConfig();
  const vars = await fetchVars(cfg);
  const names = Object.keys(vars).sort();
  console.log(`${names.length} variables on ${where(cfg)}:`);
  for (const n of names) console.log(showValues ? `  ${n}=${vars[n]}` : `  ${n}`);
  if (!showValues) console.log("\n(values hidden — pass --values to print them; they include secrets)");
}

async function getVar(name: string) {
  const vars = await fetchVars(loadConfig());
  if (!(name in vars)) {
    console.error(`${name} is not set.`);
    process.exit(1);
  }
  console.log(vars[name]);
}

async function redeploy() {
  const cfg = loadConfig();
  await gql(
    `mutation($e:String!,$s:String!){ serviceInstanceRedeploy(environmentId:$e, serviceId:$s) }`,
    { e: cfg.environmentId, s: cfg.serviceId },
  );
  console.log(`Redeploy triggered for ${where(cfg)}.`);
}

async function setVar(name: string, value: string, deploy: boolean) {
  const cfg = loadConfig();
  // Stage the variable (skipDeploys) then redeploy once — avoids a double
  // deploy from both the upsert and the explicit redeploy.
  await gql(
    `mutation($input:VariableUpsertInput!){ variableUpsert(input:$input) }`,
    { input: { projectId: cfg.projectId, environmentId: cfg.environmentId, serviceId: cfg.serviceId, name, value, skipDeploys: true } },
  );
  console.log(`Set ${name} on ${where(cfg)}.`);
  if (deploy) await redeploy();
  else console.log("(staged — run `npm run railway -- redeploy` to apply)");
}

async function unsetVar(name: string, deploy: boolean) {
  const cfg = loadConfig();
  await gql(
    `mutation($input:VariableDeleteInput!){ variableDelete(input:$input) }`,
    { input: { projectId: cfg.projectId, environmentId: cfg.environmentId, serviceId: cfg.serviceId, name } },
  );
  console.log(`Deleted ${name} from ${where(cfg)}.`);
  if (deploy) await redeploy();
  else console.log("(staged — run `npm run railway -- redeploy` to apply)");
}

function info() {
  const cfg = loadConfig();
  console.log(JSON.stringify(cfg, null, 2));
  console.log(`Token: ${process.env.RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN ? "present" : "MISSING (set RAILWAY_TOKEN)"}`);
}

const USAGE =
  "Railway CLI\n" +
  "  npm run railway -- list [--values]\n" +
  "  npm run railway -- get NAME\n" +
  "  npm run railway -- set NAME VALUE [--no-deploy]\n" +
  "  npm run railway -- unset NAME [--no-deploy]\n" +
  "  npm run railway -- redeploy\n" +
  "  npm run railway -- info";

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const args = argv.slice(1).filter((a) => !a.startsWith("--"));
  const deploy = !flags.has("--no-deploy");

  switch (cmd) {
    case "list":
    case "vars":
      return listVars(flags.has("--values"));
    case "get":
      if (!args[0]) throw new Error("usage: get NAME");
      return getVar(args[0]);
    case "set":
      if (args.length < 2) throw new Error("usage: set NAME VALUE  (quote values with spaces)");
      return setVar(args[0], args.slice(1).join(" "), deploy);
    case "unset":
    case "delete":
      if (!args[0]) throw new Error("usage: unset NAME");
      return unsetVar(args[0], deploy);
    case "redeploy":
      return redeploy();
    case "info":
      return info();
    default:
      console.log(USAGE);
  }
}

main().catch((e) => {
  console.error("Error:", e?.message || e);
  process.exit(1);
});
