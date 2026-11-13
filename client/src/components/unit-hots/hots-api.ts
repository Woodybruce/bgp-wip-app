// Calls and small helpers for the Heads of Terms workspace
// (client/src/components/unit-hots/hots-workspace.tsx; routes in
// server/unit-hots.ts). hotsCall keeps the server's whole answer on a
// refusal (the code, and the latest workspace on a stale save), which
// apiRequest throws away.
import { getAuthHeaders } from "@/lib/queryClient";

export class HotsError extends Error {
  status: number;
  code: string | null;
  data: Record<string, unknown> | null;
  constructor(status: number, message: string, data: Record<string, unknown> | null) {
    super(message);
    this.name = "HotsError";
    this.status = status;
    this.code = data && typeof data.code === "string" ? data.code : null;
    this.data = data;
  }
}

const readJson = async (res: Response): Promise<Record<string, unknown> | null> => {
  const raw = await res.text();
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
};
const refusal = (res: Response, data: Record<string, unknown> | null): HotsError => {
  const said = data && (typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : "");
  return new HotsError(res.status, said || `The server answered ${res.status}. Try again.`, data);
};

export async function hotsCall<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: { ...getAuthHeaders(), ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  const data = await readJson(res);
  if (!res.ok) throw refusal(res, data);
  return data as T;
}

// A download that carries the login (a plain link would not send the
// bearer token). The file keeps the name the server gave it.
export async function downloadWithAuth(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
  if (!res.ok) throw refusal(res, await readJson(res));
  const disposition = res.headers.get("Content-Disposition") || "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const plain = /filename="([^"]+)"/i.exec(disposition);
  let name = fallbackName;
  try { if (star) name = decodeURIComponent(star[1]); else if (plain) name = plain[1]; } catch { name = fallbackName; }
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1500);
}

export const MICRO_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
export const CHIP = "rounded-full border px-2 py-px text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap";
export const TONE_GOOD = "text-emerald-700 dark:text-emerald-400";
export const TONE_WARN = "text-amber-700 dark:text-amber-400";

// "12 Nov 2026"
export const fmtDate = (d: string | null | undefined): string => {
  if (!d) return "";
  // A plain yyyy-mm-dd is a calendar date, not a moment in a time zone.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  const dt = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
// "12 Nov 2026, 14:05"
export const fmtWhen = (d: string | null | undefined): string => {
  if (!d) return "";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "" : `${fmtDate(d)}, ${dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};
// "£95,000"
export const fmtMoney = (n: number | null | undefined): string =>
  n === null || n === undefined ? "" : `£${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
export const listNames = (names: string[]): string =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
