#!/usr/bin/env bash
# Railway read-only helper for Claude Code sessions (web or terminal).
#
# The project token comes from the Claude environment settings as
# RAILWAY_PROJECT_TOKEN (never the repo, never the chat — CLAUDE.md
# "Marketing site deploys"). .claude/settings.json pre-approves
# `bash script/railway.sh …` so a session can check a deploy, read logs or
# confirm a variable without a permission prompt.
#
#   bash script/railway.sh deploys            latest deployments of the dashboard service
#   bash script/railway.sh logs [deploymentId] runtime logs (default: latest deployment), last 400 lines
#   bash script/railway.sh build [deploymentId] build logs
#   bash script/railway.sh vars NAME [NAME…]  whether each variable is set and how long it is — never the value
#   bash script/railway.sh var NAME           the value of ONE variable — only for non-secret settings (URLs, env names)
#   bash script/railway.sh query '<graphql>'  any GraphQL query
#
# Nothing here mutates: no redeploys, no variable writes.
set -euo pipefail

API="https://backboard.railway.app/graphql/v2"
PROJECT_ID="ff22a876-8ad0-4169-9fe1-edd4a5ec5f8e"
ENV_ID="bf473cc6-0411-4eb6-8566-cceaa38fe981"
SERVICE_ID="5c30a1ab-95c2-41a0-ae7f-fb61a1a780e6"   # bgp-wip-app (the dashboard)

if [ -z "${RAILWAY_PROJECT_TOKEN:-}" ]; then
  echo "RAILWAY_PROJECT_TOKEN is not set. Mint a project token in Railway → Tokens and add it to the Claude environment settings (claude.ai/code → the environment → Secrets)." >&2
  exit 2
fi

gql() {
  local query="$1"
  python3 -I - "$query" <<'EOF'
import json, sys
print(json.dumps({"query": sys.argv[1]}))
EOF
}

call() {
  curl -sS -m 60 -X POST "$API" \
    -H "Content-Type: application/json" \
    -H "Project-Access-Token: $RAILWAY_PROJECT_TOKEN" \
    --data-binary "$(gql "$1")"
}

latest_deployment_id() {
  call "query { deployments(first: 1, input: { projectId: \"$PROJECT_ID\", environmentId: \"$ENV_ID\", serviceId: \"$SERVICE_ID\" }) { edges { node { id } } } }" \
    | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print(d["data"]["deployments"]["edges"][0]["node"]["id"])'
}

cmd="${1:-}"
case "$cmd" in
  deploys)
    call "query { deployments(first: 6, input: { projectId: \"$PROJECT_ID\", environmentId: \"$ENV_ID\", serviceId: \"$SERVICE_ID\" }) { edges { node { id status createdAt updatedAt meta } } } }" \
      | python3 -I -c '
import json,sys
d=json.load(sys.stdin)
for e in d["data"]["deployments"]["edges"]:
    n=e["node"]; m=n.get("meta") or {}
    print(n["status"].ljust(10), n["createdAt"][11:19], "->", n["updatedAt"][11:19], (m.get("commitHash") or "")[:8], (m.get("commitMessage") or "").split("\n")[0][:70], n["id"])'
    ;;
  logs|build)
    dep="${2:-$(latest_deployment_id)}"
    field=$([ "$cmd" = "logs" ] && echo deploymentLogs || echo buildLogs)
    call "query { $field(deploymentId: \"$dep\", limit: 400) { timestamp message severity } }" \
      | python3 -I -c '
import json,sys
d=json.load(sys.stdin)
for l in (d.get("data") or {}).get(sys.argv[1]) or []:
    print(l["timestamp"][11:19], (l.get("message") or "")[:220])' "$field"
    ;;
  vars)
    shift
    [ $# -gt 0 ] || { echo "usage: railway.sh vars NAME [NAME…]" >&2; exit 2; }
    call "query { variables(projectId: \"$PROJECT_ID\", environmentId: \"$ENV_ID\", serviceId: \"$SERVICE_ID\") }" \
      | python3 -I -c '
import json,sys
v=json.load(sys.stdin)["data"]["variables"]
for k in sys.argv[1:]:
    val=v.get(k)
    print(f"{k}: NOT SET" if val is None else f"{k}: set, {len(val)} chars")' "$@"
    ;;
  var)
    name="${2:?usage: railway.sh var NAME}"
    case "$name" in
      *URI*|*URL*|*_ENV|*_MODE|*_HOST|NODE_ENV|PORT) ;;
      *) echo "refusing to print $name — only URL / env-name style settings are shown; use 'vars' to see whether it is set" >&2; exit 2 ;;
    esac
    call "query { variables(projectId: \"$PROJECT_ID\", environmentId: \"$ENV_ID\", serviceId: \"$SERVICE_ID\") }" \
      | python3 -I -c 'import json,sys; v=json.load(sys.stdin)["data"]["variables"]; print(repr(v.get(sys.argv[1])))' "$name"
    ;;
  query)
    call "${2:?usage: railway.sh query '<graphql>'}"
    echo
    ;;
  *)
    sed -n '2,17p' "$0" >&2
    exit 2
    ;;
esac
