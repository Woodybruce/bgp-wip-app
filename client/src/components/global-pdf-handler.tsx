import { useState, useEffect } from "react";
import PDFViewer from "@/components/pdf-viewer";

// Reuses the existing in-app PDFViewer (pdfjs canvas viewer with page nav /
// zoom / capture) and wires it to landlord-pack links app-wide. Intercepts
// clicks on any anchor pointing at /api/crm/landlord-packs/... — from React
// pages AND raw Leaflet map-popup anchors — and opens it in the in-app viewer
// instead of a browser tab. Download links (?download=1) and anchors with a
// `download` attribute are left alone so they still download.
export function GlobalPdfHandler() {
  const [pdf, setPdf] = useState<{ url: string; name: string } | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as HTMLElement)?.closest?.("a") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (!/\/api\/crm\/landlord-packs\//.test(href)) return;
      if (/[?&]download=1/.test(href) || a.hasAttribute("download")) return; // let downloads through
      e.preventDefault();
      e.stopPropagation();
      const name = a.getAttribute("data-pdf-name") || a.textContent?.trim() || "Landlord pack";
      setPdf({ url: href, name });
    };
    document.addEventListener("click", onClick, true); // capture — beat target="_blank"
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return (
    <PDFViewer
      url={pdf?.url || ""}
      fileName={pdf?.name || "Landlord pack"}
      open={!!pdf}
      onClose={() => setPdf(null)}
    />
  );
}
