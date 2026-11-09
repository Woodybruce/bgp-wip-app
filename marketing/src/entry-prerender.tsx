import { renderToString } from "react-dom/server";
import { Router } from "wouter";
import App, { titleFor } from "./App";

// Build-time render of one route (see scripts/prerender.ts). The content is
// the bundled copy of the site content; the browser swaps in the live feed
// from the dashboard after hydration, exactly as it did before.
export function render(path: string): { html: string; title: string } {
  const html = renderToString(
    <Router ssrPath={path} ssrSearch="">
      <App />
    </Router>,
  );
  return { html, title: titleFor(path) };
}
