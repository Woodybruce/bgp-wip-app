#!/usr/bin/env tsx

const BASE_URL = process.env.TEST_URL || "http://localhost:5000";
const AUTH_HEADER = process.env.TEST_AUTH || "";

interface TestResult {
  category: string;
  test: string;
  status: "PASS" | "FAIL" | "WARN";
  detail: string;
  httpStatus?: number;
  responseTime?: number;
}

const results: TestResult[] = [];
const cleanupIds: { type: string; id: string }[] = [];

async function api(
  method: string,
  path: string,
  body?: any,
  opts?: { timeout?: number; noAuth?: boolean }
): Promise<{ status: number; body: any; time: number; rawText: string }> {
  const headers: Record<string, string> = {};
  if (AUTH_HEADER && !opts?.noAuth) headers["Authorization"] = AUTH_HEADER;
  if (body) headers["Content-Type"] = "application/json";

  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts?.timeout || 15000);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const rawText = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(rawText); } catch { parsed = rawText; }
    return { status: res.status, body: parsed, time: Date.now() - start, rawText };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return { status: 0, body: null, time: Date.now() - start, rawText: err?.message || "Request failed" };
  }
}

function pass(cat: string, test: string, detail: string, httpStatus?: number, time?: number) {
  results.push({ category: cat, test, status: "PASS", detail, httpStatus, responseTime: time });
}
function fail(cat: string, test: string, detail: string, httpStatus?: number, time?: number) {
  results.push({ category: cat, test, status: "FAIL", detail, httpStatus, responseTime: time });
}
function warn(cat: string, test: string, detail: string, httpStatus?: number, time?: number) {
  results.push({ category: cat, test, status: "WARN", detail, httpStatus, responseTime: time });
}

async function testEndpoint(
  category: string, name: string, method: string, path: string,
  body?: any,
  opts?: { expectArray?: boolean; expectFields?: string[]; minItems?: number }
) {
  const r = await api(method, path, body);
  if (r.status === 0) { fail(category, name, `Timeout/connection error: ${r.rawText}`, 0, r.time); return r; }
  if (r.status >= 500) { fail(category, name, `Server error: ${JSON.stringify(r.body).substring(0, 200)}`, r.status, r.time); return r; }
  if (r.status >= 400) { fail(category, name, `Client error: ${JSON.stringify(r.body).substring(0, 200)}`, r.status, r.time); return r; }

  if (typeof r.body === "string" && (r.body.includes("<!DOCTYPE") || r.body.includes("<html"))) {
    fail(category, name, "Got HTML instead of JSON — likely a routing issue", r.status, r.time);
    return r;
  }

  if (opts?.expectArray && !Array.isArray(r.body)) {
    fail(category, name, `Expected array, got ${typeof r.body}`, r.status, r.time);
    return r;
  }

  if (opts?.expectFields) {
    const target = Array.isArray(r.body) ? (r.body[0] || {}) : r.body;
    const missing = opts.expectFields.filter(f => !(f in target));
    if (missing.length > 0 && (Array.isArray(r.body) ? r.body.length > 0 : true)) {
      fail(category, name, `Missing required fields: ${missing.join(", ")}`, r.status, r.time);
      return r;
    }
  }

  if (opts?.minItems !== undefined && Array.isArray(r.body) && r.body.length < opts.minItems) {
    warn(category, name, `Only ${r.body.length} items (expected >= ${opts.minItems})`, r.status, r.time);
    return r;
  }

  if (r.time > 10000) {
    warn(category, name, `Slow: ${r.time}ms`, r.status, r.time);
    return r;
  }

  const itemCount = Array.isArray(r.body) ? ` (${r.body.length} items)` : "";
  pass(category, name, `OK${itemCount}`, r.status, r.time);
  return r;
}

async function testCrudLifecycle(
  category: string, basePath: string,
  createData: any, updateData: any, updateField: string, updateExpectedValue: string
) {
  const create = await testEndpoint(category, "Create", "POST", basePath, createData);
  if (create.status < 200 || create.status >= 300 || !create.body?.id) return;
  const id = create.body.id;
  cleanupIds.push({ type: basePath, id });

  await testEndpoint(category, "Get by ID", "GET", `${basePath}/${id}`, undefined, {
    expectFields: ["id"],
  });

  await testEndpoint(category, "Update", "PUT", `${basePath}/${id}`, updateData);

  const afterUpdate = await api("GET", `${basePath}/${id}`);
  if (afterUpdate.body?.[updateField] === updateExpectedValue) {
    pass(category, "Update persisted", `${updateField} = "${updateExpectedValue}"`);
  } else {
    fail(category, "Update persisted", `${updateField} is "${afterUpdate.body?.[updateField]}" — expected "${updateExpectedValue}"`);
  }

  await testEndpoint(category, "Delete", "DELETE", `${basePath}/${id}`);

  const afterDelete = await api("GET", `${basePath}/${id}`);
  if (afterDelete.status === 404 || afterDelete.status === 500) {
    pass(category, "Delete confirmed", "Item gone after delete");
  } else if (afterDelete.body?.id) {
    fail(category, "Delete confirmed", "Item still exists after delete");
  } else {
    pass(category, "Delete confirmed", `Status ${afterDelete.status}`);
  }

  cleanupIds.splice(cleanupIds.findIndex(c => c.id === id), 1);
}

async function cleanup() {
  for (const item of [...cleanupIds]) {
    try {
      await api("DELETE", `${item.type}/${item.id}`);
    } catch {}
  }
}

async function printReport() {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║              TEST RESULTS                    ║");
  console.log("╚══════════════════════════════════════════════╝");

  const passes = results.filter(r => r.status === "PASS");
  const fails = results.filter(r => r.status === "FAIL");
  const warns = results.filter(r => r.status === "WARN");

  console.log(`\n  PASS: ${passes.length}  |  FAIL: ${fails.length}  |  WARN: ${warns.length}  |  TOTAL: ${results.length}\n`);

  if (fails.length > 0) {
    console.log("┌──────────────────────────────────────────────┐");
    console.log("│  FAILURES                                    │");
    console.log("└──────────────────────────────────────────────┘");
    for (const f of fails) {
      console.log(`  FAIL [${f.category}] ${f.test}`);
      console.log(`       ${f.detail}`);
      if (f.httpStatus !== undefined) console.log(`       HTTP ${f.httpStatus} | ${f.responseTime}ms`);
      console.log("");
    }
  }

  if (warns.length > 0) {
    console.log("┌──────────────────────────────────────────────┐");
    console.log("│  WARNINGS                                    │");
    console.log("└──────────────────────────────────────────────┘");
    for (const w of warns) {
      console.log(`  WARN [${w.category}] ${w.test}`);
      console.log(`       ${w.detail}`);
      console.log("");
    }
  }

  const fs = await import("fs");
  const reportPath = `qa-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    target: BASE_URL,
    summary: { total: results.length, passed: passes.length, failed: fails.length, warnings: warns.length },
    failures: fails,
    warnings: warns,
    allResults: results,
  }, null, 2));
  console.log(`Full report: ${reportPath}`);

  return fails.length;
}

async function runTests() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║     BGP DASHBOARD — AUTOMATED QA SUITE      ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`Target: ${BASE_URL}`);
  console.log(`Time:   ${new Date().toISOString()}\n`);

  if (!AUTH_HEADER) {
    console.error("ERROR: TEST_AUTH environment variable is required.");
    console.error('Usage: TEST_AUTH="Bearer <token>" npx tsx scripts/qa-test-suite.ts');
    process.exit(2);
  }

  const precheck = await api("GET", "/api/auth/me");
  if (precheck.status !== 200) {
    console.error(`ERROR: Auth precheck failed (HTTP ${precheck.status}). Token may be expired.`);
    process.exit(2);
  }
  console.log(`Authenticated as: ${precheck.body?.name} (${precheck.body?.email})\n`);

  try {
    // ─── 1. AUTH ──────────────────────────────────────
    console.log("  [1/20] Authentication...");
    pass("Auth", "Current user", `${precheck.body?.name}`, precheck.status, precheck.time);

    const noAuth = await api("GET", "/api/crm/contacts?limit=1", undefined, { noAuth: true });
    if (noAuth.status === 401 || noAuth.status === 403) {
      pass("Auth", "Unauthenticated request blocked", `HTTP ${noAuth.status}`);
    } else {
      fail("Auth", "Unauthenticated request blocked", `Expected 401/403, got ${noAuth.status}`);
    }

    // ─── 2. CRM CONTACTS CRUD ────────────────────────
    console.log("  [2/20] CRM Contacts CRUD...");
    await testEndpoint("CRM Contacts", "List", "GET", "/api/crm/contacts?limit=5", undefined, {
      expectArray: true, minItems: 1, expectFields: ["id", "name"],
    });
    await testCrudLifecycle("CRM Contacts", "/api/crm/contacts",
      { name: "QA Test Contact", company: "QA Corp", email: "qa@example.com", phone: "+44 20 1234 5678", type: "other" },
      { name: "QA Updated Contact" },
      "name", "QA Updated Contact"
    );

    // ─── 3. CRM COMPANIES CRUD ───────────────────────
    console.log("  [3/20] CRM Companies CRUD...");
    await testEndpoint("CRM Companies", "List", "GET", "/api/crm/companies?limit=5", undefined, {
      expectArray: true, minItems: 1,
    });
    await testCrudLifecycle("CRM Companies", "/api/crm/companies",
      { name: "QA Test Company Ltd", sector: "Retail" },
      { name: "QA Updated Company Ltd" },
      "name", "QA Updated Company Ltd"
    );

    // ─── 4. CRM PROPERTIES CRUD ──────────────────────
    console.log("  [4/20] CRM Properties CRUD...");
    await testEndpoint("CRM Properties", "List", "GET", "/api/crm/properties?limit=5", undefined, {
      expectArray: true, minItems: 1,
    });
    await testCrudLifecycle("CRM Properties", "/api/crm/properties",
      { name: "QA Test Property", address: "1 Test Street, London W1K 1AA", type: "Retail" },
      { name: "QA Updated Property" },
      "name", "QA Updated Property"
    );

    // ─── 5. CRM DEALS CRUD ──────────────────────────
    console.log("  [5/20] CRM Deals CRUD...");
    await testEndpoint("CRM Deals", "List", "GET", "/api/crm/deals?limit=5", undefined, {
      expectArray: true, minItems: 1,
    });
    await testCrudLifecycle("CRM Deals", "/api/crm/deals",
      { name: "QA Test Deal", status: "Active", groupName: "Letting" },
      { name: "QA Updated Deal" },
      "name", "QA Updated Deal"
    );

    // ─── 6. CRM LINKS & RELATIONS ────────────────────
    console.log("  [6/20] CRM Links & Relations...");
    await testEndpoint("CRM Links", "Company-Property links", "GET", "/api/crm/company-property-links", undefined, { expectArray: true });
    await testEndpoint("CRM Links", "Company-Deal links", "GET", "/api/crm/company-deal-links", undefined, { expectArray: true });
    await testEndpoint("CRM Links", "Property-Deal links", "GET", "/api/crm/property-deal-links", undefined, { expectArray: true });
    await testEndpoint("CRM Links", "Property agents", "GET", "/api/crm/property-agents", undefined, { expectArray: true });
    await testEndpoint("CRM Links", "Property tenants", "GET", "/api/crm/property-tenants", undefined, { expectArray: true });
    await testEndpoint("CRM Links", "Fee allocations", "GET", "/api/crm/fee-allocations");

    // ─── 7. CRM STATS & SEARCH ──────────────────────
    console.log("  [7/20] CRM Stats & Search...");
    await testEndpoint("CRM Stats", "CRM stats", "GET", "/api/crm/stats");
    await testEndpoint("CRM Stats", "Duplicate scan", "GET", "/api/crm/duplicates/scan");
    await testEndpoint("CRM Stats", "CRM search", "GET", "/api/crm/search?q=grosvenor");
    await testEndpoint("CRM Stats", "Global search", "GET", "/api/search?q=grosvenor");

    // ─── 8. WIP REPORT ──────────────────────────────
    console.log("  [8/20] WIP Report...");
    await testEndpoint("WIP", "WIP report", "GET", "/api/wip", undefined, { expectArray: true });
    await testEndpoint("WIP", "Agent summary", "GET", "/api/wip/agent-summary");

    // ─── 9. LETTING TRACKER ─────────────────────────
    console.log("  [9/20] Letting Tracker...");
    await testEndpoint("Letting", "List units", "GET", "/api/available-units", undefined, { expectArray: true });
    await testEndpoint("Letting", "All viewings", "GET", "/api/available-units/all-viewings", undefined, { expectArray: true });
    await testEndpoint("Letting", "All offers", "GET", "/api/available-units/all-offers", undefined, { expectArray: true });
    await testEndpoint("Letting", "All files", "GET", "/api/available-units/all-files", undefined, { expectArray: true });

    // ─── 10. INVESTMENT TRACKER ─────────────────────
    console.log("  [10/20] Investment Tracker...");
    await testEndpoint("Investment", "List items", "GET", "/api/investment-tracker", undefined, { expectArray: true, minItems: 1 });
    await testEndpoint("Investment", "Counts", "GET", "/api/investment-tracker/counts/all");
    await testEndpoint("Investment", "All viewings", "GET", "/api/investment-tracker/all-viewings", undefined, { expectArray: true });
    await testEndpoint("Investment", "All offers", "GET", "/api/investment-tracker/all-offers", undefined, { expectArray: true });
    await testEndpoint("Investment", "All distributions", "GET", "/api/investment-tracker/all-distributions", undefined, { expectArray: true });
    await testEndpoint("Investment", "All marketing files", "GET", "/api/investment-tracker/all-marketing-files");

    // ─── 11. CHAT ────────────────────────────────────
    console.log("  [11/20] Chat...");
    await testEndpoint("Chat", "List threads", "GET", "/api/chat/threads", undefined, { expectArray: true });
    await testEndpoint("Chat", "Notifications", "GET", "/api/chat/notifications", undefined, { expectFields: ["unseenCount"] });
    await testEndpoint("Chat", "Search", "GET", "/api/chat/search?q=test");

    const createThread = await testEndpoint("Chat", "Create thread", "POST", "/api/chat/threads", {
      title: "QA Test Thread", isGroup: true, memberIds: [],
    });
    if (createThread.body?.id) {
      const tid = createThread.body.id;
      cleanupIds.push({ type: "/api/chat/threads", id: tid });

      await testEndpoint("Chat", "Send message", "POST", `/api/chat/threads/${tid}/messages`, {
        content: "QA automated test message",
      });

      const msgs = await testEndpoint("Chat", "Get messages", "GET", `/api/chat/threads/${tid}`);
      if (msgs.body?.messages && Array.isArray(msgs.body.messages)) {
        const userMsg = msgs.body.messages.find((m: any) => m.role === "user");
        if (userMsg) {
          pass("Chat", "Message role correct", `role="${userMsg.role}"`);
        } else {
          fail("Chat", "Message role correct", "No user-role message found");
        }
      }

      await testEndpoint("Chat", "Delete thread", "DELETE", `/api/chat/threads/${tid}`);
      cleanupIds.splice(cleanupIds.findIndex(c => c.id === tid), 1);
    }

    // ─── 11b. CHATBGP 1-ON-1 AI CHAT (SSE) ─────────
    console.log("  [11b/22] ChatBGP 1-on-1 AI Chat...");
    {
      async function sseChat(messages: any[], timeoutMs = 45000): Promise<{ reply: string; toolsUsed?: string[] } | null> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(`${BASE_URL}/api/chatbgp/chat`, {
            method: "POST",
            headers: { "Authorization": AUTH_HEADER, "Content-Type": "application/json" },
            body: JSON.stringify({ messages }),
            signal: controller.signal,
          });
          if (res.status !== 200) return null;
          const text = await res.text();
          const dataLines = text.split("\n").filter(l => l.startsWith("data: "));
          if (dataLines.length === 0) return null;
          return JSON.parse(dataLines[dataLines.length - 1].replace("data: ", ""));
        } catch { return null; } finally { clearTimeout(timeout); }
      }

      const sseStart = Date.now();
      const basicReply = await sseChat([{ role: "user", content: "Reply with just the word PONG" }]);
      if (basicReply?.reply && basicReply.reply.trim().length > 0) {
        pass("AI-1on1", "SSE response", `${(Date.now() - sseStart)}ms — "${basicReply.reply.substring(0, 60)}"`);
      } else {
        fail("AI-1on1", "SSE response", basicReply ? "Empty reply" : "No SSE response within 45s");
      }

      const toolReply = await sseChat([{ role: "user", content: "Search the CRM for Hammerson and tell me what you find" }]);
      if (toolReply?.reply && toolReply.reply.length > 0) {
        const replyLower = toolReply.reply.toLowerCase();
        if (replyLower.includes("hammerson") || replyLower.includes("crm") || replyLower.includes("found") || replyLower.includes("result") || replyLower.includes("deal") || replyLower.includes("contact") || replyLower.includes("property")) {
          pass("AI-1on1", "Tool call (search_crm)", `Reply mentions results: "${toolReply.reply.substring(0, 80)}..."`);
        } else {
          warn("AI-1on1", "Tool call (search_crm)", `Reply doesn't reference search results: "${toolReply.reply.substring(0, 100)}"`);
        }
      } else {
        fail("AI-1on1", "Tool call (search_crm)", toolReply ? "Empty reply" : "No SSE response");
      }

      const edgeCases: { name: string; content: string; check: (r: string) => boolean; desc: string }[] = [
        { name: "Unicode input", content: "Reply with the word café and the emoji 🏠", check: r => r.includes("café") || r.includes("cafe") || r.includes("🏠"), desc: "Reply should contain café or 🏠" },
        { name: "Special chars", content: "What is <script>alert('xss')</script> in HTML?", check: r => !r.includes("<script>alert(") && r.trim().length > 10, desc: "Reply should not echo raw script tag" },
        { name: "Long input", content: "Summarise this in one sentence: " + "The property market in London is very strong. ".repeat(50), check: r => r.trim().length > 10 && r.trim().length < 2000, desc: "Reply should be concise summary" },
      ];
      for (const tc of edgeCases) {
        const ecReply = await sseChat([{ role: "user", content: tc.content }]);
        if (ecReply?.reply && ecReply.reply.trim()) {
          if (tc.check(ecReply.reply)) {
            pass("AI-Edge", tc.name, `OK — ${ecReply.reply.substring(0, 60)}...`);
          } else {
            warn("AI-Edge", tc.name, `${tc.desc}: "${ecReply.reply.substring(0, 100)}"`);
          }
        } else {
          fail("AI-Edge", tc.name, ecReply ? "Empty reply" : "No SSE response");
        }
      }
    }

    // ─── 11c. CHATBGP GROUP RESPONSE ─────────────────
    console.log("  [11c/22] ChatBGP AI Group Chat...");
    {
      const aiThread = await api("POST", "/api/chat/threads", {
        title: "QA AI Test Thread", isGroup: true, isAiChat: false, memberIds: ["__chatbgp__"],
      });
      if (aiThread.status >= 200 && aiThread.status < 300 && aiThread.body?.id) {
        const aiTid = aiThread.body.id;
        cleanupIds.push({ type: "/api/chat/threads", id: aiTid });

        await api("POST", `/api/chat/threads/${aiTid}/messages`, { content: "" });
        await api("POST", `/api/chat/threads/${aiTid}/messages`, { content: "   " });
        const normalMsg = await api("POST", `/api/chat/threads/${aiTid}/messages`, {
          content: "@chatbgp what is 2+2?",
        });

        if (normalMsg.status >= 200 && normalMsg.status < 300) {
          pass("AI-Group", "Send with empty history", "Message sent OK");
        } else {
          fail("AI-Group", "Send with empty history", `HTTP ${normalMsg.status}: ${JSON.stringify(normalMsg.body).substring(0, 200)}`);
        }

        await new Promise(r => setTimeout(r, 15000));

        const aiMsgs = await api("GET", `/api/chat/threads/${aiTid}`);
        if (aiMsgs.body?.messages && Array.isArray(aiMsgs.body.messages)) {
          const assistantMsgs = aiMsgs.body.messages.filter((m: any) => m.role === "assistant");
          if (assistantMsgs.length > 0) {
            const lastAi = assistantMsgs[assistantMsgs.length - 1];
            if (lastAi.content && lastAi.content.trim().length > 0) {
              pass("AI-Group", "ChatBGP responded", `${lastAi.content.substring(0, 80)}...`);
            } else {
              fail("AI-Group", "ChatBGP responded", "Assistant message has empty content");
            }
          } else {
            fail("AI-Group", "ChatBGP responded", `No assistant messages after 15s (${aiMsgs.body.messages.length} total)`);
          }
        } else {
          fail("AI-Group", "ChatBGP responded", "Could not fetch thread messages");
        }

        const emptyCheck = await api("GET", `/api/chat/threads/${aiTid}`);
        if (emptyCheck.body?.messages) {
          const emptyMsgs = emptyCheck.body.messages.filter((m: any) =>
            m.role === "user" && (!m.content || !m.content.trim())
          );
          if (emptyMsgs.length > 0) {
            warn("AI-Group", "Empty messages in thread", `${emptyMsgs.length} empty user messages — these can break AI`);
          } else {
            pass("AI-Group", "No problematic empty msgs", "All messages have content");
          }
        }

        await api("DELETE", `/api/chat/threads/${aiTid}`);
        cleanupIds.splice(cleanupIds.findIndex(c => c.id === aiTid), 1);
      } else {
        fail("AI-Group", "Create AI thread", `HTTP ${aiThread.status}`);
      }
    }

    // ─── 11d. DOC GENERATE CONVERSATIONS ─────────────
    console.log("  [11d/22] Doc Generate AI...");
    {
      const boundary = "----QATestBoundary" + Date.now();
      const fileContent = "BGP Brand Guidelines: Use black and white palette with Helvetica Neue typography.";
      const formBody = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="question"',
        '',
        'What does this document say?',
        `--${boundary}`,
        'Content-Disposition: form-data; name="conversationHistory"',
        '',
        '[]',
        `--${boundary}`,
        'Content-Disposition: form-data; name="documents"; filename="test-brand.txt"',
        'Content-Type: text/plain',
        '',
        fileContent,
        `--${boundary}--`,
      ].join('\r\n');

      const docAskRes = await fetch(`${BASE_URL}/api/doc-templates/ask-claude`, {
        method: "POST",
        headers: {
          "Authorization": AUTH_HEADER,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: formBody,
      });
      const docAskData = await docAskRes.json().catch(() => ({}));

      if (docAskRes.status >= 200 && docAskRes.status < 300 && docAskData.answer) {
        if (docAskData.question?.includes("file")) {
          pass("AI-Docs", "Ask with file upload", `AI received files: ${docAskData.question.substring(0, 80)}`);
        } else {
          warn("AI-Docs", "Ask with file upload", `Answer OK but question doesn't mention files`);
        }
      } else {
        fail("AI-Docs", "Ask with file upload", `HTTP ${docAskRes.status}: ${JSON.stringify(docAskData).substring(0, 200)}`);
      }

      const docTextRes = await api("POST", "/api/doc-templates/ask-claude", {
        question: "What document templates do I have?",
        conversationHistory: [],
      });
      if (docTextRes.status >= 200 && docTextRes.status < 300 && docTextRes.body?.answer) {
        pass("AI-Docs", "Ask without files", `${docTextRes.body.answer.substring(0, 80)}...`);
      } else {
        fail("AI-Docs", "Ask without files", `HTTP ${docTextRes.status}: ${JSON.stringify(docTextRes.body).substring(0, 200)}`);
      }
    }

    // ─── 11e. CHATBGP STATUS & AUTH ──────────────────
    console.log("  [11e/22] ChatBGP Auth & Status...");
    {
      const noAuth = await fetch(`${BASE_URL}/api/chatbgp/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      });
      if (noAuth.status === 401 || noAuth.status === 403) {
        pass("AI-Auth", "Unauthenticated rejected", `HTTP ${noAuth.status}`);
      } else {
        fail("AI-Auth", "Unauthenticated rejected", `HTTP ${noAuth.status} — should be 401/403`);
      }

      const badBody = await fetch(`${BASE_URL}/api/chatbgp/chat`, {
        method: "POST",
        headers: { "Authorization": AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify({ notMessages: "bad" }),
      });
      if (badBody.status === 400) {
        pass("AI-Auth", "Bad request body rejected", `HTTP ${badBody.status}`);
      } else {
        fail("AI-Auth", "Bad request body rejected", `HTTP ${badBody.status} — should be 400`);
      }

      await testEndpoint("AI-Auth", "ChatBGP status endpoint", "GET", "/api/chatbgp/status");
    }

    // ─── 12. DOCUMENT TEMPLATES ─────────────────────
    console.log("  [12/21] Document Templates...");
    await testEndpoint("Documents", "List templates", "GET", "/api/doc-templates", undefined, { expectArray: true });

    // ─── 13. NEWS ────────────────────────────────────
    console.log("  [13/20] News...");
    await testEndpoint("News", "Sources", "GET", "/api/news-feed/sources", undefined, { expectArray: true });
    await testEndpoint("News", "Articles", "GET", "/api/news-feed/articles", undefined, { expectArray: true });

    // ─── 14. MODELS ──────────────────────────────────
    console.log("  [14/20] Models...");
    await testEndpoint("Models", "List templates", "GET", "/api/models/templates", undefined, { expectArray: true });

    // ─── 15. SYSTEM ──────────────────────────────────
    console.log("  [15/20] System...");
    await testEndpoint("System", "Users", "GET", "/api/users", undefined, { expectArray: true, minItems: 1 });
    await testEndpoint("System", "Team members", "GET", "/api/team-members", undefined, { expectArray: true, minItems: 1 });
    await testEndpoint("System", "Projects", "GET", "/api/projects", undefined, { expectArray: true });
    await testEndpoint("System", "Diary", "GET", "/api/diary", undefined, { expectArray: true });
    await testEndpoint("System", "Change requests", "GET", "/api/change-requests", undefined, { expectArray: true });
    await testEndpoint("System", "App feedback", "GET", "/api/app-feedback", undefined, { expectArray: true });
    await testEndpoint("System", "VAPID key", "GET", "/api/push/vapid-key");
    await testEndpoint("System", "ChatBGP learnings", "GET", "/api/chatbgp-learnings", undefined, { expectArray: true });
    await testEndpoint("System", "External requirements", "GET", "/api/external-requirements", undefined, { expectArray: true });

    // ─── 16. INTEGRATIONS ────────────────────────────
    console.log("  [16/20] Integrations...");
    await testEndpoint("Integrations", "ChatBGP status", "GET", "/api/chatbgp/status");
    await testEndpoint("Integrations", "Xero status", "GET", "/api/xero/status");

    // ─── 17. DASHBOARD ──────────────────────────────
    console.log("  [17/20] Dashboard...");
    await testEndpoint("Dashboard", "Intelligence", "GET", "/api/dashboard/intelligence");

    // ─── 18. ERROR HANDLING ─────────────────────────
    console.log("  [18/20] Error Handling...");
    const get404 = await api("GET", "/api/nonexistent-xyz");
    if (get404.status === 404 && typeof get404.body === "object" && get404.body?.message) {
      pass("Errors", "GET /api/... 404 returns JSON", "Correct");
    } else if (typeof get404.body === "string" && get404.body.includes("<html")) {
      fail("Errors", "GET /api/... 404 returns JSON", "Got HTML — SPA catch-all is intercepting API routes");
    } else {
      warn("Errors", "GET /api/... 404 returns JSON", `Status ${get404.status}`);
    }

    const post404 = await api("POST", "/api/nonexistent-xyz", { test: true });
    if (post404.status === 404 && typeof post404.body === "object" && post404.body?.message) {
      pass("Errors", "POST /api/... 404 returns JSON", "Correct");
    } else if (typeof post404.body === "string" && post404.body.includes("<html")) {
      fail("Errors", "POST /api/... 404 returns JSON", "Got HTML — SPA catch-all is intercepting POST requests");
    } else {
      warn("Errors", "POST /api/... 404 returns JSON", `Status ${post404.status}`);
    }

    // ─── 19. FRONTEND PAGES ─────────────────────────
    console.log("  [19/20] Frontend Pages...");
    for (const page of ["/", "/chat", "/contacts", "/deals", "/documents", "/properties", "/settings", "/chatbgp", "/deals/wip-report"]) {
      const r = await api("GET", page);
      if (r.status === 200 && typeof r.body === "string" && r.body.includes("<html")) {
        pass("Pages", `GET ${page}`, "HTML served", r.status, r.time);
      } else if (r.status === 200) {
        pass("Pages", `GET ${page}`, "OK", r.status, r.time);
      } else {
        fail("Pages", `GET ${page}`, `HTTP ${r.status}`, r.status, r.time);
      }
    }

    // ─── 20. PERFORMANCE ────────────────────────────
    console.log("  [20/20] Performance...");
    const perfTargets = [
      { name: "Contacts (50)", path: "/api/crm/contacts?limit=50" },
      { name: "Deals (50)", path: "/api/crm/deals?limit=50" },
      { name: "Properties (50)", path: "/api/crm/properties?limit=50" },
      { name: "Investment tracker", path: "/api/investment-tracker" },
      { name: "WIP report", path: "/api/wip" },
      { name: "Chat threads", path: "/api/chat/threads" },
    ];
    for (const ep of perfTargets) {
      const r = await api("GET", ep.path);
      if (r.status < 200 || r.status >= 300) {
        fail("Perf", `${ep.name}`, `HTTP ${r.status} — endpoint broken`, r.status, r.time);
      } else if (r.time > 5000) {
        fail("Perf", `${ep.name}`, `${r.time}ms (>5s — too slow)`, r.status, r.time);
      } else if (r.time > 2000) {
        warn("Perf", `${ep.name}`, `${r.time}ms (>2s)`, r.status, r.time);
      } else {
        pass("Perf", `${ep.name}`, `${r.time}ms`, r.status, r.time);
      }
    }
  } finally {
    await cleanup();
  }

  const failCount = await printReport();
  if (failCount > 0) process.exit(1);
}

runTests().catch(err => {
  console.error("Test suite crashed:", err);
  cleanup().then(() => process.exit(2));
});
