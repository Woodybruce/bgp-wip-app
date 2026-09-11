import { Building2, Briefcase, BarChart3, LayoutGrid, User as UserIcon, Sparkles, Folder } from "lucide-react";
import { useLocation } from "wouter";

// Smart tags travel inside message text as @[Name](tag:type/id) — the same
// markdown-link shape the chat renderers already tokenise, so old clients
// degrade to readable text. This module is the single source of truth for
// the token grammar, the per-type look, and the deep-link targets. Used by
// the chat panel, the mobile PWA renderer and ChatPaveMarkdown.

export type TagType = "user" | "company" | "property" | "deal" | "unit" | "contact" | "folder";

export const TAG_TOKEN_SOURCE = "@\\[([^\\]]+)\\]\\(tag:(user|company|property|deal|unit|contact|folder)\\/([^)\\s]+)\\)";

export function buildTagToken(type: TagType, id: string, name: string): string {
  return `@[${name}](tag:${type}/${id})`;
}

export function tagPath(type: TagType, id: string): string | null {
  switch (type) {
    case "property": return `/properties/${id}`;
    case "deal": return `/deals/${id}`;
    case "company": return `/companies/${id}`;
    case "contact": return `/contacts/${id}`;
    case "unit": return "/available";
    default: return null;
  }
}

export const TAG_META: Record<TagType, { icon: typeof Building2; label: string; chip: string }> = {
  property: { icon: Building2, label: "Property", chip: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
  company: { icon: Briefcase, label: "Brand", chip: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300" },
  deal: { icon: BarChart3, label: "Deal", chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  unit: { icon: LayoutGrid, label: "Letting unit", chip: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  contact: { icon: UserIcon, label: "Contact", chip: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
  user: { icon: UserIcon, label: "Person", chip: "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200" },
  folder: { icon: Folder, label: "SharePoint folder", chip: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300" },
};

// Folder tag ids carry the SharePoint URL base64url-encoded (URLs contain
// characters the token grammar forbids). Decode defensively — a corrupt id
// just renders a non-clickable chip.
function decodeFolderUrl(id: string): string | null {
  try {
    const b64 = id.replace(/-/g, "+").replace(/_/g, "/");
    const url = atob(b64);
    return url.startsWith("https://") ? url : null;
  } catch { return null; }
}

export function TagChip({ type, id, name }: { type: TagType; id: string; name: string }) {
  const [, navigate] = useLocation();
  const meta = TAG_META[type] || TAG_META.user;
  const Icon = type === "user" && id === "__chatbgp__" ? Sparkles : meta.icon;
  const folderUrl = type === "folder" ? decodeFolderUrl(id) : null;
  const path = type === "folder" ? null : tagPath(type, id);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (folderUrl) window.open(folderUrl, "_blank", "noopener");
        else if (path) navigate(path);
      }}
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium align-baseline mx-0.5 ${meta.chip} ${(path || folderUrl) ? "cursor-pointer hover:opacity-80" : "cursor-default"} transition-opacity`}
      title={(path || folderUrl) ? `Open ${meta.label.toLowerCase()}: ${name}` : name}
      data-testid={`tag-chip-${type}-${id}`}
    >
      <Icon className="w-2.5 h-2.5 shrink-0" />
      <span className="truncate max-w-[180px]">{name}</span>
    </button>
  );
}
