import { useEffect, useState } from "react";

// Draft mode shows copy that is written but not yet signed off, on the real
// site, so the directors can review it in place. Open any page with
// ?draft=1 to switch it on for this browser; ?draft=0 switches it off.
const KEY = "bgp_draft";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function applyQuery(): boolean | null {
  const q = new URLSearchParams(window.location.search);
  if (!q.has("draft")) return null;
  const on = q.get("draft") !== "0";
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
  return on;
}

export function useDraftMode(): boolean {
  const [on, setOn] = useState<boolean>(() => applyQuery() ?? read());
  useEffect(() => {
    const fromQuery = applyQuery();
    if (fromQuery !== null) setOn(fromQuery);
  }, []);
  return on;
}

export function DraftNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="label-caps text-bgp-red border border-bgp-red/50 px-3 py-2 inline-block">
      Draft — {children}
    </p>
  );
}
