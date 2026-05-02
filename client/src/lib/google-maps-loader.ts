// Shared singleton loader for the Google Maps JS API.
// Used by AddressAutocomplete, Street View panorama capture, and anywhere else
// we need `google.maps` in the browser. Ensures we only ever inject the
// <script> tag once, with one set of libraries, per page load.
import { getAuthHeaders } from "@/lib/queryClient";

let loaded = false;
let loading = false;
let failed = false;
let callbacks: Array<(ok: boolean) => void> = [];
let cachedKey: string | null = null;

async function fetchKey(): Promise<string> {
  if (cachedKey !== null) return cachedKey;
  try {
    const res = await fetch("/api/config/maps-key", { credentials: "include", headers: getAuthHeaders() });
    if (res.ok) {
      const data = await res.json();
      const key: string = data.key || "";
      cachedKey = key;
      return key;
    }
  } catch {}
  cachedKey = "";
  return "";
}

export function loadGoogleMaps(): Promise<boolean> {
  return new Promise(async (resolve) => {
    if (loaded) return resolve(true);
    if (failed) return resolve(false);
    callbacks.push(resolve);
    if (loading) return;
    loading = true;

    const key = await fetchKey();
    if (!key) {
      loading = false;
      failed = true;
      callbacks.forEach((cb) => cb(false));
      callbacks = [];
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places,geometry`;
    script.async = true;
    script.onload = () => {
      loaded = true;
      callbacks.forEach((cb) => cb(true));
      callbacks = [];
    };
    script.onerror = () => {
      loading = false;
      failed = true;
      callbacks.forEach((cb) => cb(false));
      callbacks = [];
    };
    document.head.appendChild(script);
  });
}

export function isGoogleMapsLoaded(): boolean {
  return loaded;
}
