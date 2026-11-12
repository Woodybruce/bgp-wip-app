// ChatBGP's "extract the comparables" (Jack, 2026-11-12). Investment sales
// evidence from a brochure, spreadsheet, email or article goes to
// Investment Comps through the same writer as the tracker's Sold - Comp
// (investment-sale-evidence.ts) — never onto the Purchases / Sales board.
// An evidence row that is already on the tracker is sent through Sold -
// Comp itself, so it leaves the live board and its deal stops counting.
//
// For each comp the result says what is still missing — the buyer (after
// a Green Street / web search) and a photo — so the reply can ask for them in
// one go, with "skip for now" always allowed: an unknown buyer stays TBC.
import { fileSaleEvidence, setCompPhoto, evidenceStatusOf, type EvidenceStatus } from "./investment-sale-evidence";

export interface ChatComp {
  trackerId?: string;
  propertyId?: string;
  propertyName: string;
  address?: string;
  city?: string;
  postcode?: string;
  assetClass?: string;
  evidenceStatus: string;
  price?: number;
  yieldPct?: number;
  pricePsf?: number;
  sqft?: number;
  saleDate?: string;
  buyer?: string;
  seller?: string;
  sellerAgent?: string;
  buyerAgent?: string;
  sourcePage?: string;
  comments?: string;
  photoChatMediaFilename?: string;
  photoFromDocument?: { page: number; region?: { x: number; y: number; w: number; h: number } };
  skipPhoto?: boolean;
  skipBuyer?: boolean;
}

export async function fileCompsFromChat(args: { comps: ChatComp[]; sourceDocument?: string; sourceLabel?: string; userId?: string | null }) {
  const out: any[] = [];
  const askBuyer: string[] = [];
  const askPhoto: string[] = [];
  const conflicts: string[] = [];
  for (const c of (args.comps || []).slice(0, 60)) {
    const name = String(c.propertyName || c.address || "").trim();
    if (!name) { out.push({ error: "A comp needs the property name or address" }); continue; }
    const evidenceStatus: EvidenceStatus | null = evidenceStatusOf(c.evidenceStatus);
    if (!evidenceStatus) { out.push({ propertyName: name, error: `Unclear status "${c.evidenceStatus}" — say sold, exchanged, under offer or quoting` }); continue; }
    const sourceDocument = args.sourceLabel || args.sourceDocument || null;
    try {
      let compId: string, action: string, matchedBy: string | null, status: string, buyer: string | null, buyerFrom: string | null, compConflicts: string[];
      if (c.trackerId) {
        const { markTrackerSoldComp } = await import("./investment-tracker-sold-comp");
        const r = await markTrackerSoldComp(c.trackerId, {
          evidenceStatus, buyer: c.buyer, price: c.price, yieldPct: c.yieldPct, pricePsf: c.pricePsf, saleDate: c.saleDate, assetClass: c.assetClass,
        }, args.userId || null, { requireFullPricing: false, sourceDocument, sourcePage: c.sourcePage || null, comments: c.comments || null });
        if (r.status !== 200) { out.push({ propertyName: name, error: (r.body as any)?.message || "Not filed" }); continue; }
        const b: any = r.body;
        ({ compId, action, matchedBy, conflicts: compConflicts } = b);
        status = b.compStatus; buyer = b.buyer || null; buyerFrom = buyer ? "given or existing" : null;
      } else {
        const r = await fileSaleEvidence({
          propertyId: c.propertyId || null, propertyName: name, address: c.address || null, city: c.city || null, postcode: c.postcode || null,
          assetClass: c.assetClass || null, evidenceStatus, price: c.price ?? null, yieldPct: c.yieldPct ?? null, pricePsf: c.pricePsf ?? null,
          sqft: c.sqft ?? null, saleDate: c.saleDate || null, buyer: c.buyer || null, seller: c.seller || null, sellerBroker: c.sellerAgent || null,
          buyerBroker: c.buyerAgent || null, source: "ChatBGP", sourceDocument, sourcePage: c.sourcePage || null, comments: c.comments || null,
        });
        ({ compId, action, matchedBy, status, buyer, buyerFrom, conflicts: compConflicts } = r);
      }
      const { linkInvestmentCompCompanies } = await import("./investment-comp-sync");
      await linkInvestmentCompCompanies({ compIds: [compId] }).catch(() => null);

      let photo: { image: string; note: string } = { image: "none", note: "" };
      if (c.photoChatMediaFilename || c.photoFromDocument) {
        photo = await setCompPhoto({
          compId, userId: args.userId || null,
          photoChatMediaFilename: c.photoChatMediaFilename || null,
          pdfChatMediaFilename: c.photoFromDocument ? (args.sourceDocument || null) : null,
          page: c.photoFromDocument?.page ?? null, region: c.photoFromDocument?.region ?? null,
        }).catch((e: any) => ({ image: "none", note: e?.message || "Photo not saved" }));
      } else {
        photo = await setCompPhoto({ compId }).catch(() => ({ image: "none", note: "" }));
      }
      const needsBuyer = !buyer && (status === "Sale" || status === "Sale - Pending") && !c.skipBuyer;
      const needsPhoto = photo.image === "none" && !c.skipPhoto;
      if (needsBuyer) askBuyer.push(name);
      if (needsPhoto) askPhoto.push(name);
      for (const x of compConflicts) conflicts.push(`${name} — ${x}`);
      out.push({ propertyName: name, compId, action, matchedExisting: matchedBy, status, buyer: buyer || "TBC", buyerFrom, photo: photo.image, photoNote: photo.note || undefined, conflicts: compConflicts.length ? compConflicts : undefined });
    } catch (e: any) {
      out.push({ propertyName: name, error: e?.message || String(e) });
    }
  }
  const filed = out.filter((r) => r.compId);
  const next: string[] = [];
  if (askBuyer.length) next.push(`No buyer for: ${askBuyer.join("; ")}. If you have not already, search_green_street and web_search (press releases, news, public announcements) for each; file any buyer you find with its source in comments. Then ASK THE USER who bought the rest, saying they can skip for now and the comp stays TBC.`);
  if (askPhoto.length) next.push(`No photo for: ${askPhoto.join("; ")}. If the source document shows a picture of the building, call file_investment_comps again for that comp with photoFromDocument {page, region}. Otherwise ASK THE USER to upload a photo of each, saying they can skip for now.`);
  if (conflicts.length) next.push(`List these disagreements with what was already filed, once, without changing them: ${conflicts.join(" | ")}`);
  return {
    success: filed.length > 0,
    entity: "investment comps",
    filed: filed.length,
    created: filed.filter((r) => r.action === "created").length,
    updatedExisting: filed.filter((r) => r.action !== "created").length,
    comps: out,
    where: "Investment Comps page, under each comp's asset class. Nothing was added to the Investment Tracker's Purchases / Sales board.",
    askUser: next.length ? next : undefined,
  };
}
