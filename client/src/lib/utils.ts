import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// The equity directors (Woody, 2026-08-22: "me Jack Rupert and Charlotte").
// UI-side gate for the company-finance views — the server enforces the same
// list in requireEquityOrAdmin, this only controls what's offered on screen.
// "1 properties" / "1 results" grammar guard (docs/DESIGN.md §15) —
// counts read naturally everywhere.
export function countLabel(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : plural || `${singular}s`}`;
}

export const EQUITY_EMAILS = [
  "woody@brucegillinghampollard.com",
  "jack@brucegillinghampollard.com",
  "rupert@brucegillinghampollard.com",
  "charlotte@brucegillinghampollard.com",
];

export function isEquityUser(user: { email?: string | null } | null | undefined): boolean {
  const email = (user?.email || "").toLowerCase().trim();
  return !!email && EQUITY_EMAILS.includes(email);
}
