import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// After a deploy the previous build's hashed JS chunks disappear from the
// server, so any lazy-loaded page the browser hasn't visited yet fails with
// "Failed to fetch dynamically imported module". Vite fires this event when
// that happens — reload once to pick up the new build instead of showing the
// error screen. The timestamp guard stops a reload loop if the fetch keeps
// failing for a different reason (e.g. offline).
window.addEventListener("vite:preloadError", (event) => {
  const last = Number(sessionStorage.getItem("bgp-chunk-reload") || 0);
  if (Date.now() - last < 30_000) return;
  sessionStorage.setItem("bgp-chunk-reload", String(Date.now()));
  event.preventDefault();
  window.location.reload();
});

const rootEl = document.getElementById("root")!;

try {
  createRoot(rootEl).render(<App />);
} catch (err: any) {
  // If React fails to mount (e.g. inside a restricted Office webview), the
  // fallback in index.html stays visible and we surface the error there.
  const errEl = document.getElementById("boot-error");
  if (errEl) {
    errEl.textContent = "Mount error: " + (err?.message || String(err));
  }
  throw err;
}
