import {
  Newspaper,
  FileText,
  Building2,
  ListPlus,
  Mail as MailIcon,
  TrendingUp,
  Users,
  Sparkles,
} from "lucide-react";

export function timeAgo(date: string | Date | null): string {
  if (!date) return "";
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function statusColor(status: string): string {
  switch (status) {
    case "busy": return "bg-red-500";
    case "tentative": return "bg-yellow-500";
    case "oof": return "bg-purple-500";
    case "workingElsewhere": return "bg-blue-500";
    default: return "bg-green-500";
  }
}

export function formatCurrencyShort(amount: number): string {
  if (amount >= 1_000_000) return `£${(amount / 1_000_000).toFixed(1)}m`;
  if (amount >= 1_000) return `£${(amount / 1_000).toFixed(0)}k`;
  return `£${amount.toFixed(0)}`;
}

export function formatCurrencyFull(value: number): string {
  return `£${value.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function parseWipMonth(m: string): { monthNum: number; calendarYear: number } | null {
  const parts = m.split("-");
  if (parts.length !== 2) return null;
  const monthNames: Record<string, number> = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
  };
  const monthNum = monthNames[parts[0]];
  const yr = parseInt(parts[1]);
  if (!monthNum || isNaN(yr)) return null;
  const calendarYear = yr < 50 ? 2000 + yr : 1900 + yr;
  return { monthNum, calendarYear };
}

export function getWipMonthSortKey(m: string): number {
  const parsed = parseWipMonth(m);
  if (!parsed) return 99;
  const fyMonth = parsed.monthNum >= 5 ? parsed.monthNum - 5 : parsed.monthNum + 7;
  return parsed.calendarYear * 12 + fyMonth;
}

export function getConfidenceLevel(score: number): "high" | "medium" | "low" {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export const SOURCE_ICONS: Record<string, typeof Newspaper> = {
  news: Newspaper,
  deal: FileText,
  property: Building2,
  requirement: ListPlus,
  email: MailIcon,
  market: TrendingUp,
  introduction: Users,
};

export const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-emerald-500",
  medium: "bg-amber-500",
  low: "bg-slate-400",
};

export const AREA_OPTIONS = ["Mayfair", "Soho", "Fitzrovia", "Marylebone", "Victoria", "St James's", "Covent Garden", "Knightsbridge", "Chelsea", "City of London", "Shoreditch", "King's Cross", "Paddington"];
export const ASSET_CLASS_OPTIONS = ["Office", "Retail", "Industrial", "Residential", "Mixed Use", "Hospitality", "Healthcare", "Leisure"];
export const DEAL_TYPE_OPTIONS = ["Leasing", "Investment", "Advisory", "Acquisition", "Disposal", "Development", "Asset Management"];
