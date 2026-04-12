#!/usr/bin/env tsx

import * as fs from "fs";

const PROD_URL = process.env.DEPLOY_URL || "https://bgp-wip-app-production-efac.up.railway.app";
let AUTH_HEADER = process.env.TEST_AUTH || "";
const LOGIN_EMAIL = process.env.TEST_EMAIL || "woody@brucegillinghampollard.com";
const LOGIN_PASS = process.env.TEST_PASSWORD || "";
const TIMEOUT = 20000;

interface TestResult {
  category: string;
  test: string;
  status: "PASS" | "FAIL" | "WARN";
  detail: string;
  time?: number;
}

const results: TestResult[] = [];

function pass(cat: string, test: string, detail: string, time?: number) {
  results.push({ category: cat, test, status: "PASS", detail, time });
}
function fail(cat: string, test: string, detail: string, time?: number) {
  results.push({ category: cat, test, status: "FAIL", detail, time });
}
function warn(cat: string, test: string, detail: string, time?: number) {
  results.push({ category: cat, test, status: "WARN", detail, time });
}

async function req(method: string, path: string, opts?: { noAuth?: boolean; body?: any; expectHtml?: boolean }): Promise<{ status: number; text: string; json: any; time: number; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (AUTH_HEADER && !opts?.noAuth) headers["Authorization"] = AUTH_HEADER;
  if (opts?.body) headers["Content-Type"] = "application/json";
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(`${PROD_URL}${path}`, {
      method,
      headers,
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, text, json, time: Date.now() - start, headers: res.headers };
  } catch (err: any) {
    clearTimeout(timeout);
    return { status: 0, text: err?.message || "Failed", json: null, time: Date.now() - start, headers: new Headers() };
  }
}

async function run() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   BGP DASHBOARD — POST-DEPLOY SMOKE TEST        ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`Target:  ${PROD_URL}`);
  console.log(`Time:    ${new Date().toISOString()}`);
  console.log("");

  // ─── 0. AUTO-LOGIN ──────────────────────────────────
  if (!AUTH_HEADER && LOGIN_PASS) {
    console.log("  [0/10] Logging in...");
    const loginRes = await req("POST", "/api/auth/login", { body: { username: LOGIN_EMAIL, password: LOGIN_PASS }, noAuth: true });
    if (loginRes.status === 200 && loginRes.json?.token) {
      AUTH_HEADER = `Bearer ${loginRes.json.token}`;
      pass("Login", "Auto-login", `Logged in as ${loginRes.json.name || LOGIN_EMAIL}`, loginRes.time);
    } else {
      fail("Login", "Auto-login", `HTTP ${loginRes.status} — ${loginRes.json?.message || "failed"}`, loginRes.time);
    }
  }

  // ─── 1. APP REACHABLE ─────────────────────────────
  console.log("  [1/10] App reachable...");
  const home = await req("GET", "/");
  if (home.status === 200 && home.text.includes("<html")) {
    pass("Reachable", "Homepage loads", `HTTP 200`, home.time);
  } else if (home.status === 0) {
    fail("Reachable", "Homepage loads", `Connection failed: ${home.text}`, home.time);
    printReport();
    return;
  } else {
    fail("Reachable", "Homepage loads", `HTTP ${home.status}`, home.time);
  }

  // ─── 2. JS ASSETS LOAD ────────────────────────────
  console.log("  [2/10] JS assets load...");
  const jsMatch = home.text.match(/src="(\/assets\/index-[^"]+\.js)"/);
  if (jsMatch) {
    const jsPath = jsMatch[1];
    const jsRes = await req("GET", jsPath, { noAuth: true });
    if (jsRes.status === 200 && jsRes.text.length > 1000) {
      pass("Assets", "Main JS bundle loads", `${(jsRes.text.length / 1024).toFixed(0)}KB`, jsRes.time);
    } else {
      fail("Assets", "Main JS bundle loads", `HTTP ${jsRes.status}, ${jsRes.text.length} bytes`);
    }
  } else {
    fail("Assets", "Main JS bundle loads", "Could not find JS bundle reference in HTML");
  }

  // ─── 3. SERVICE WORKER ─────────────────────────────
  console.log("  [3/10] Service worker...");
  const sw = await req("GET", "/sw.js", { noAuth: true });
  if (sw.status === 200) {
    const versionMatch = sw.text.match(/CACHE_NAME\s*=\s*'([^']+)'/);
    const version = versionMatch ? versionMatch[1] : "unknown";
    pass("SW", "Service worker loads", `Version: ${version}`, sw.time);
  } else {
    fail("SW", "Service worker loads", `HTTP ${sw.status}`);
  }

  // ─── 4. AUTH ───────────────────────────────────────
  console.log("  [4/10] Authentication...");
  if (!AUTH_HEADER) {
    warn("Auth", "Auth check", "No TEST_AUTH provided — skipping authenticated tests");
  } else {
    const me = await req("GET", "/api/auth/me");
    if (me.status === 200 && me.json?.name) {
      pass("Auth", "Login works", `Logged in as ${me.json.name}`, me.time);
    } else {
      fail("Auth", "Login works", `HTTP ${me.status} — token may be expired`, me.time);
    }

    const noAuth = await req("GET", "/api/crm/contacts?limit=1", { noAuth: true });
    if (noAuth.status === 401 || noAuth.status === 403) {
      pass("Auth", "Unauthenticated blocked", `HTTP ${noAuth.status}`);
    } else {
      fail("Auth", "Unauthenticated blocked", `HTTP ${noAuth.status} — should be 401/403`);
    }
  }

  // ─── 5. KEY API ENDPOINTS ──────────────────────────
  console.log("  [5/10] API endpoints...");
  const endpoints = [
    { name: "Contacts", path: "/api/crm/contacts?limit=3" },
    { name: "Companies", path: "/api/crm/companies?limit=3" },
    { name: "Properties", path: "/api/crm/properties?limit=3" },
    { name: "Deals", path: "/api/crm/deals?limit=3" },
    { name: "Investment tracker", path: "/api/investment-tracker" },
    { name: "Available units", path: "/api/available-units" },
    { name: "WIP report", path: "/api/wip" },
    { name: "Chat threads", path: "/api/chat/threads" },
    { name: "Chat notifications", path: "/api/chat/notifications" },
    { name: "News articles", path: "/api/news-feed/articles" },
    { name: "Users", path: "/api/users" },
    { name: "Dashboard intel", path: "/api/dashboard/intelligence" },
    { name: "Doc templates", path: "/api/doc-templates" },
    { name: "Model templates", path: "/api/models/templates" },
    { name: "CRM stats", path: "/api/crm/stats" },
    { name: "Global search", path: "/api/search?q=test" },
    { name: "ChatBGP status", path: "/api/chatbgp/status" },
  ];

  for (const ep of endpoints) {
    if (!AUTH_HEADER) { warn("API", ep.name, "Skipped — no auth"); continue; }
    const r = await req("GET", ep.path);
    if (r.status === 200) {
      if (r.text.includes("<!DOCTYPE") || r.text.includes("<html")) {
        fail("API", ep.name, "Got HTML instead of JSON — routing issue", r.time);
      } else if (r.time > 5000) {
        warn("API", ep.name, `Slow: ${r.time}ms`, r.time);
      } else {
        const count = Array.isArray(r.json) ? ` (${r.json.length} items)` : "";
        pass("API", ep.name, `OK${count}`, r.time);
      }
    } else {
      fail("API", ep.name, `HTTP ${r.status}`, r.time);
    }
  }

  // ─── 6. FRONTEND PAGES ─────────────────────────────
  console.log("  [6/10] Frontend pages...");
  const pages = ["/", "/chat", "/chatbgp", "/contacts", "/companies", "/deals", "/properties", "/documents", "/settings", "/deals/wip-report", "/investment-tracker"];
  for (const page of pages) {
    const r = await req("GET", page, { noAuth: true });
    if (r.status === 200 && r.text.includes("<html")) {
      pass("Pages", page, "Loads", r.time);
    } else {
      fail("Pages", page, `HTTP ${r.status}`, r.time);
    }
  }

  // ─── 7. API ERROR HANDLING ─────────────────────────
  console.log("  [7/10] Error handling...");
  const bad = await req("GET", "/api/nonexistent-route-xyz");
  if (bad.status === 404 && bad.json?.message) {
    pass("Errors", "API 404 returns JSON", "Correct");
  } else if (bad.text.includes("<html")) {
    fail("Errors", "API 404 returns JSON", "Got HTML — SPA catch-all intercepting API");
  } else {
    warn("Errors", "API 404 returns JSON", `HTTP ${bad.status}`);
  }

  // ─── 8. CHATBGP AI RESPONSE ────────────────────────
  console.log("  [8/10] ChatBGP AI response...");
  if (!AUTH_HEADER) {
    warn("AI", "ChatBGP responds", "Skipped — no auth");
  } else {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const aiRes = await fetch(`${PROD_URL}/api/chatbgp/chat`, {
        method: "POST",
        headers: { "Authorization": AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "Reply with just OK" }] }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const aiText = await aiRes.text();
      const elapsed = Date.now() - start;
      if (aiRes.status === 200 && aiText.includes("data: ")) {
        const dataLines = aiText.split("\n").filter(l => l.startsWith("data: "));
        const last = dataLines.length > 0 ? JSON.parse(dataLines[dataLines.length - 1].replace("data: ", "")) : null;
        if (last?.reply) {
          pass("AI", "ChatBGP responds", `"${last.reply.substring(0, 50)}"`, elapsed);
        } else {
          fail("AI", "ChatBGP responds", "SSE data but no reply", elapsed);
        }
      } else {
        fail("AI", "ChatBGP responds", `HTTP ${aiRes.status}`, elapsed);
      }
    } catch (err: any) {
      fail("AI", "ChatBGP responds", `Error: ${err?.message}`, Date.now() - start);
    }
  }

  // ─── 9. MEDIA SERVING ──────────────────────────────
  console.log("  [9/10] Media serving...");
  const mediaCheck = await req("GET", "/api/chat-media/nonexistent-file.png");
  if (mediaCheck.status === 404 || mediaCheck.status === 400) {
    pass("Media", "Chat media endpoint active", `HTTP ${mediaCheck.status} for missing file`);
  } else if (mediaCheck.status === 200) {
    warn("Media", "Chat media endpoint active", "Returned 200 for nonexistent file");
  } else {
    fail("Media", "Chat media endpoint active", `HTTP ${mediaCheck.status}`);
  }

  // ─── 10. PERFORMANCE ──────────────────────────────
  console.log("  [10/10] Performance...");
  if (AUTH_HEADER) {
    const perfTargets = [
      { name: "Contacts page data", path: "/api/crm/contacts?limit=50" },
      { name: "Deals page data", path: "/api/crm/deals?limit=50" },
      { name: "Properties page data", path: "/api/crm/properties?limit=50" },
      { name: "Investment tracker", path: "/api/investment-tracker" },
      { name: "WIP report", path: "/api/wip" },
    ];
    for (const ep of perfTargets) {
      const r = await req("GET", ep.path);
      if (r.time > 5000) fail("Perf", ep.name, `${r.time}ms — too slow`, r.time);
      else if (r.time > 3000) warn("Perf", ep.name, `${r.time}ms`, r.time);
      else pass("Perf", ep.name, `${r.time}ms`, r.time);
    }
  }

  printReport();
}

function printReport() {
  const passes = results.filter(r => r.status === "PASS");
  const fails = results.filter(r => r.status === "FAIL");
  const warns = results.filter(r => r.status === "WARN");

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║                  RESULTS                         ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`\n  PASS: ${passes.length}  |  FAIL: ${fails.length}  |  WARN: ${warns.length}  |  TOTAL: ${results.length}\n`);

  if (fails.length > 0) {
    console.log("┌────────────────────────────────────────────┐");
    console.log("│  FAILURES                                  │");
    console.log("└────────────────────────────────────────────┘");
    for (const f of fails) {
      console.log(`  FAIL [${f.category}] ${f.test}`);
      console.log(`       ${f.detail}${f.time ? ` (${f.time}ms)` : ""}`);
      console.log("");
    }
  }

  if (warns.length > 0) {
    console.log("┌────────────────────────────────────────────┐");
    console.log("│  WARNINGS                                  │");
    console.log("└────────────────────────────────────────────┘");
    for (const w of warns) {
      console.log(`  WARN [${w.category}] ${w.test}`);
      console.log(`       ${w.detail}`);
      console.log("");
    }
  }

  const reportPath = `post-deploy-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    target: PROD_URL,
    summary: { total: results.length, passed: passes.length, failed: fails.length, warnings: warns.length },
    failures: fails,
    warnings: warns,
    all: results,
  }, null, 2));
  console.log(`Report saved: ${reportPath}`);

  if (fails.length > 0) {
    console.log(`\n  ${fails.length} FAILURE(S) — published app has issues!\n`);
    process.exit(1);
  } else {
    console.log(`\n  ALL CLEAR — published app is healthy.\n`);
  }
}

run().catch(err => {
  console.error("Smoke test crashed:", err);
  process.exit(2);
});
