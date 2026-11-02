import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { find, evaluate, ts } = require("./source-harness.cjs");

function mutation(file, name, extra = {}) {
  const requests = [], invalidations = [], notices = [];
  const cache = new Map([[JSON.stringify(["/api/news-feed/articles"]), [{ id: "story-1" }, { id: "story-2" }]]]);
  const queryClient = {
    cancelQueries: async () => {},
    getQueryData: key => cache.get(JSON.stringify(key)),
    setQueryData: (key, update) => cache.set(JSON.stringify(key), typeof update === "function" ? update(cache.get(JSON.stringify(key))) : update),
    invalidateQueries: ({ queryKey }) => invalidations.push(queryKey),
  };
  const declaration = find(file, node => ts.isVariableDeclaration(node) && node.name.getText() === name);
  const api = evaluate(`const ${declaration}; export { ${name} };`, {
    useMutation: options => options,
    apiRequest: async (method, url, body) => {
      requests.push({ method, url, body });
      return { json: async () => ({ briefing: "Current market briefing", generatedAt: "2026-10-27T13:00:00Z" }) };
    },
    queryClient, toast: notice => notices.push(notice), ...extra,
  });
  return { options: api[name], requests, invalidations, notices, queryClient };
}

test("mobile dismissal records a personal preference and rolls back a failed request without deleting the shared article", async () => {
  const h = mutation("client/src/components/mobile-app.tsx", "dismissNewsMutation");
  const context = await h.options.onMutate("story-1");
  assert.deepEqual(h.queryClient.getQueryData(["/api/news-feed/articles"]), [{ id: "story-2" }]);
  await h.options.mutationFn("story-1");
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].method, "POST");
  assert.equal(h.requests[0].url, "/api/news-feed/engage");
  assert.equal(h.requests[0].body.articleId, "story-1");
  assert.equal(h.requests[0].body.action, "dismiss");
  h.options.onError(new Error("network"), "story-1", context);
  assert.deepEqual(h.queryClient.getQueryData(["/api/news-feed/articles"]), [{ id: "story-1" }, { id: "story-2" }]);
  assert.equal(h.notices[0].variant, "destructive");
  h.options.onSettled();
  assert.deepEqual(h.invalidations.flat(), ["/api/news-feed/articles"]);
});

test("desktop saves update the Saved cache and only confirm successful actions", async () => {
  let dismissed = new Set();
  const h = mutation("client/src/pages/news.tsx", "engageMutation", { setDismissedArticles: update => { dismissed = update(dismissed); } });
  await h.options.mutationFn({ articleId: "story-1", action: "save" });
  assert.equal(h.notices.length, 0, "sending a request is not confirmation it saved");
  h.options.onSuccess({}, { articleId: "story-1", action: "save" });
  assert.ok(h.invalidations.some(key => key[0] === "/api/news-feed/saved"));
  assert.equal(h.notices.at(-1).title, "Saved");
  h.options.onSuccess({}, { articleId: "story-2", action: "dismiss" });
  assert.ok(dismissed.has("story-2"));
  assert.equal(h.notices.at(-1).description, "Hidden from your news feed");
  h.options.onError(new Error("network"), { articleId: "story-3", action: "save" });
  assert.equal(h.notices.at(-1).variant, "destructive");
});

test("Tasks refresh regenerates the briefing and shares the fresh result with dashboard and mobile", async () => {
  const h = mutation("client/src/pages/tasks.tsx", "refreshBriefing");
  const fresh = await h.options.mutationFn();
  assert.equal(h.requests[0].method, "GET");
  assert.equal(h.requests[0].url, "/api/ai-briefing?refresh=1");
  h.options.onSuccess(fresh);
  assert.equal(h.queryClient.getQueryData(["/api/ai-briefing"]).briefing, "Current market briefing");
  h.options.onError(new Error("network"));
  assert.equal(h.queryClient.getQueryData(["/api/ai-briefing"]).briefing, "Current market briefing");
  assert.equal(h.notices[0].variant, "destructive");
});

test("Brand watch does not make an unrelated team-feed request", () => {
  const code = find("client/src/pages/news.tsx", node => ts.isCallExpression(node) && node.expression.getText() === "useQuery"
    && node.arguments[0]?.getText().includes('queryKey: ["/api/news-feed/articles", effectiveTeam, search]'));
  for (const selected of ["news", "saved", "insights", "brand-watch"]) {
    const api = evaluate(`export const options = ${code};`, {
      useQuery: options => options, effectiveTeam: "Investment", search: "",
      isSavedTab: selected === "saved", isInsightsTab: selected === "insights", isBrandWatchTab: selected === "brand-watch",
    });
    assert.equal(api.options.enabled, selected === "news");
  }
});
