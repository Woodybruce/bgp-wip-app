import { jsPDF } from "jspdf";
import { Listing, formatRent, formatSqft } from "./api";
import { CONTACT, LEASING_CONTACTS } from "./content";

// v19-branded property particulars, generated in the browser so it works on
// any device (and for sample listings) without a server round-trip.
const WINE: [number, number, number] = [110, 12, 37];
const INK: [number, number, number] = [29, 29, 27];
const GREY: [number, number, number] = [89, 98, 100];

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 4000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
}

export async function downloadParticulars(listing: Listing) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = 595;
  const M = 48;
  const CW = W - M * 2;

  // Header band
  doc.setFillColor(...WINE);
  doc.rect(0, 0, W, 86, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("times", "italic");
  doc.setFontSize(26);
  doc.text("bgp.", M, 44);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("BRUCE GILLINGHAM POLLARD", M, 62, { charSpace: 1.5 });
  doc.setFontSize(8);
  doc.text("PROPERTY PARTICULARS", W - M, 62, { align: "right", charSpace: 1.5 });

  let y = 128;

  // Title + size headline
  doc.setTextColor(...WINE);
  doc.setFont("times", "normal");
  doc.setFontSize(22);
  const titleLines = doc.splitTextToSize(listing.unitName.replace(/^\[Sample\]\s*/, ""), CW);
  doc.text(titleLines, M, y);
  y += titleLines.length * 24 + 4;
  const headline = [formatSqft(listing.sqft), listing.location, listing.marketingStatus]
    .filter(Boolean)
    .join("  ·  ");
  if (headline) {
    doc.setFont("times", "italic");
    doc.setFontSize(12);
    doc.setTextColor(...GREY);
    doc.text(headline, M, y);
    y += 26;
  }

  // Photo
  const src = listing.image;
  if (src) {
    const img = await loadImage(src);
    if (img) {
      const ih = Math.min(240, (CW * img.naturalHeight) / img.naturalWidth);
      try {
        doc.addImage(img, "JPEG", M, y, CW, ih, undefined, "MEDIUM");
        y += ih + 24;
      } catch {
        /* non-JPEG/cross-origin — skip photo */
      }
    }
  }

  // Key details
  const rows: Array<[string, string]> = [
    ["Address", listing.addressLine || listing.location || listing.postcode || "—"],
    ["Size", formatSqft(listing.sqft) || "On application"],
    ["Rent", formatRent(listing.askingRent) || "On application"],
    ["Rates", listing.ratesPa ? `£${Math.round(listing.ratesPa).toLocaleString("en-GB")} pa` : "To be re-assessed — prospective tenants should confirm any rating liability directly"],
    ["Service charge", listing.serviceChargePa ? `£${Math.round(listing.serviceChargePa).toLocaleString("en-GB")} pa` : "On application"],
    ["Use class", listing.useClass || "—"],
    ["Condition", listing.condition || "—"],
    ["Available", listing.availableDate || "Immediately"],
    ["EPC", listing.epcRating || "Available on request"],
  ];
  doc.setFontSize(8);
  doc.setTextColor(...WINE);
  doc.setFont("helvetica", "bold");
  doc.text("KEY DETAILS", M, y, { charSpace: 1.5 });
  y += 6;
  doc.setDrawColor(...WINE);
  doc.setLineWidth(0.75);
  doc.line(M, y, M + CW, y);
  y += 16;
  for (const [k, v] of rows) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...GREY);
    doc.text(k.toUpperCase(), M, y, { charSpace: 0.8 });
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    const vLines = doc.splitTextToSize(v, CW - 130);
    doc.text(vLines, M + 130, y);
    y += Math.max(vLines.length * 12, 12) + 7;
    doc.setDrawColor(228, 216, 211);
    doc.setLineWidth(0.5);
    doc.line(M, y - 5, M + CW, y - 5);
  }
  y += 14;

  // Contacts
  doc.setFontSize(8);
  doc.setTextColor(...WINE);
  doc.setFont("helvetica", "bold");
  doc.text("VIEWINGS & FURTHER INFORMATION", M, y, { charSpace: 1.5 });
  y += 6;
  doc.setDrawColor(...WINE);
  doc.setLineWidth(0.75);
  doc.line(M, y, M + CW, y);
  y += 16;
  const contacts = LEASING_CONTACTS.slice(0, 3);
  const colW = CW / Math.max(contacts.length, 1);
  contacts.forEach((p, i) => {
    const x = M + i * colW;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(p.name, x, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(p.phone, x, y + 12);
    doc.text(p.email, x, y + 23);
  });
  y += 44;

  // Footer
  doc.setFillColor(252, 248, 244);
  doc.rect(0, 780, W, 62, "F");
  doc.setTextColor(...GREY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(
    `Bruce Gillingham Pollard · ${CONTACT.addressLines.join(", ")} · ${CONTACT.phone} · www.bgp.uk.com`,
    W / 2,
    805,
    { align: "center" },
  );
  doc.setFontSize(6.5);
  doc.text(
    "Misrepresentation Act 1967: these particulars are for guidance only and do not constitute an offer or contract. All figures quoted are exclusive of VAT.",
    W / 2,
    820,
    { align: "center", maxWidth: CW },
  );

  const safe = listing.unitName.replace(/^\[Sample\]\s*/, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  doc.save(`BGP-${safe}-particulars.pdf`);
}
