// Records that sit in the brand directory but are not a brand anyone would
// pitch to a landlord (Woody, 2026-11-15: "hate junk"): an operating or
// holding company kept under its legal name, a hotel group, a bookmaker or
// amusement arcade, a name that is only a description. Used to keep them out
// of gap lists; they still count as occupiers where they trade.
const LEGAL_NAME = /\b(holdings?|group|plc|ltd|limited|llp|inc|corp(oration)?|restaurants? (uk )?ltd|trading|ventures|enterprises|investments|partners(hip)?|franchis(e|ing|ee)s?|operations|hospitality (group|ltd))\b\.?$/i;
const HOLDING_WORD = /\b(holdings?|franchis(ee|ing)|opco|propco|topco|bidco)\b/i;
const BOOKMAKERS = new Set(["william hill", "coral", "ladbrokes", "paddy power", "betfred", "bet365", "jenningsbet", "merkur", "merkur slots", "cashino", "genting", "admiral"]);
const BETTING = /\b(bookmakers?|betting|casinos?|slots|amusements?)\b/i;
// Real trading names that end in a legal-looking word.
const KEEP = new Set(["the gym group"]);
const HOTEL = /\b(ihg|intercontinental hotels|travelodge|premier inn|holiday inn|hilton|marriott|accor|ibis|novotel|radisson|best western|whitbread|hampton by hilton|doubletree|easyhotel|wyndham|hyatt|staycity|motel one)\b/i;
const GENERIC = new Set(["coffee house", "the coffee house", "restaurant", "the restaurant", "cafe", "the cafe", "café", "food court", "the food court", "kiosk", "bar", "the bar", "takeaway", "food hall", "street food", "unit", "shop"]);

export function isJunkBrand(b: { name: string | null | undefined; companyType?: string | null; industry?: string | null }): boolean {
  const name = String(b.name || "").trim();
  if (!name) return true;
  const key = name.toLowerCase().replace(/\s+/g, " ");
  if (KEEP.has(key)) return false;
  if (GENERIC.has(key) || BOOKMAKERS.has(key)) return true;
  if (HOLDING_WORD.test(name) || LEGAL_NAME.test(name)) return true;
  const about = `${name} ${b.industry || ""} ${b.companyType || ""}`;
  return BETTING.test(about) || HOTEL.test(name) || /\bhotels?\b/i.test(`${b.industry || ""} ${b.companyType || ""}`);
}
