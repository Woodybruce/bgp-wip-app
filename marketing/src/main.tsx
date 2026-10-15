import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Pages are prerendered to static HTML at build time (scripts/prerender.ts)
// so crawlers read real content; the browser then takes over that markup.
const root = document.getElementById("root")!;
const app = (
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
if (root.hasChildNodes()) ReactDOM.hydrateRoot(root, app);
else ReactDOM.createRoot(root).render(app);
