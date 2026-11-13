// One rule for every Back control (Woody, 2026-11-13: "back buttons should
// just always take back to the screen before"): Back returns to the previous
// screen in the app; a pill or tab change on the same page replaces the
// entry, so it is never a step; with no previous screen in the app (a pasted
// link, a new tab) Back goes to the page's parent.
//
// The browser's own entry count cannot answer "is there a screen before
// this one in the app": it counts whatever the tab showed before the app.
// So each entry the app makes carries its position, and Back only walks
// the browser history while that position is above zero. wouter re-sends
// pushState / replaceState as window events, which is what this listens to.
import { useCallback, useEffect } from "react";
import { useLocation } from "wouter";

const KEY = "bgpIdx";
let current = 0;
let busy = false;
let pageParent: string | null = null;

const idxOf = (s: unknown): number | null =>
  s && typeof s === "object" && typeof (s as Record<string, unknown>)[KEY] === "number"
    ? ((s as Record<string, unknown>)[KEY] as number)
    : null;

function stamp(i: number) {
  busy = true;
  try {
    const s = window.history.state;
    window.history.replaceState({ ...(s && typeof s === "object" ? s : {}), [KEY]: i }, "");
  } finally {
    busy = false;
  }
  current = i;
}

// Some links in the app are plain anchors, which load the app afresh: the new
// entry carries no position. It still has a screen before it in the app when
// this same tab came here from one of the app's own pages (a pasted or typed
// link has no referrer; a link opened in a new tab has nothing to go back to).
function loadedFromApp(): boolean {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return nav?.type === "navigate" && window.history.length > 1
      && !!document.referrer && new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

// The address without its hash. Setting the hash (the tenancy schedule's
// "view on plan") makes a new entry with no position on the same page: it is
// one step on from the screen before, not a fresh start.
const pageOf = () => window.location.pathname + window.location.search;
let lastPage = "";

let installed = false;
export function installBackTracking() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const first = idxOf(window.history.state);
  if (first === null) stamp(loadedFromApp() ? 1 : 0);
  else current = first;
  lastPage = pageOf();
  window.addEventListener("pushState", () => { if (!busy) stamp(current + 1); lastPage = pageOf(); });
  window.addEventListener("replaceState", () => { if (!busy && idxOf(window.history.state) === null) stamp(current); if (!busy) lastPage = pageOf(); });
  window.addEventListener("popstate", () => {
    const i = idxOf(window.history.state);
    if (i === null) stamp(pageOf() === lastPage ? current + 1 : 0);
    else current = i;
    lastPage = pageOf();
  });
}

export const canGoBackInApp = () => current > 0;

// Deal pages sit under /deals beside the list tabs: these are the tabs.
const DEAL_PAGE = /^\/deals\/(?!(letting|investment|report|properties|list)(\/|$))[^/]+/;
export const isDealPage = (pathname: string) => DEAL_PAGE.test(pathname);

export function backParent(pathname: string): string {
  if (pathname.startsWith("/companies/")) return "/brands";
  if (pathname.startsWith("/contacts/")) return "/contacts";
  if (pathname.startsWith("/properties/")) return "/deals/properties";
  if (isDealPage(pathname)) return "/deals";
  if (pathname.startsWith("/landsec/brand-case/")) return "/landsec/brand-cases";
  return "/";
}

// A page that knows its parent passes it; the shell's own arrow (the phone
// header, the top bar) passes nothing and uses what the open page gave.
export function useGoBack(parent?: string) {
  const [, navigate] = useLocation();
  useEffect(() => {
    if (!parent) return;
    pageParent = parent;
    return () => { if (pageParent === parent) pageParent = null; };
  }, [parent]);
  return useCallback(() => {
    if (canGoBackInApp()) window.history.back();
    else navigate(parent || pageParent || backParent(window.location.pathname), { replace: true });
  }, [parent, navigate]);
}
