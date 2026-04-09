import { useState, useCallback, useEffect } from "react";

export interface RecentItem {
  id: string;
  type: "deal" | "contact" | "company" | "property";
  name: string;
  subtitle?: string;
  team?: string;
  viewedAt: number;
}

const STORAGE_KEY = "bgp_recent_items";
const MAX_ITEMS = 20;

function loadRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveRecent(items: RecentItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function trackRecentItem(item: Omit<RecentItem, "viewedAt">) {
  const items = loadRecent();
  const filtered = items.filter(i => !(i.id === item.id && i.type === item.type));
  const updated = [{ ...item, viewedAt: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
  saveRecent(updated);
  window.dispatchEvent(new Event("bgp_recent_updated"));
}

export function useRecentItems(limit?: number): RecentItem[] {
  const [items, setItems] = useState<RecentItem[]>(() => {
    const all = loadRecent();
    return limit ? all.slice(0, limit) : all;
  });

  useEffect(() => {
    const handler = () => {
      const all = loadRecent();
      setItems(limit ? all.slice(0, limit) : all);
    };
    window.addEventListener("bgp_recent_updated", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("bgp_recent_updated", handler);
      window.removeEventListener("storage", handler);
    };
  }, [limit]);

  return items;
}

export function clearRecentItems() {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("bgp_recent_updated"));
}
