import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

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
