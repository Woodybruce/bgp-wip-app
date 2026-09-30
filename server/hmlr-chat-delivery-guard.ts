export interface HmlrChatMessage { role?: string; content?: unknown }

// Populate only from the actual order_hmlr_official_copy tool result, never
// from model-authored messages or request-body fields.
export interface HmlrDeliveryReceipt {
  titleNumber?: unknown;
  success?: unknown;
  outcome?: unknown;
  orderSubmitted?: unknown;
  requestMessageId?: unknown;
  fault?: unknown;
  summary?: { fault?: unknown; reason?: unknown };
}

interface VerificationOptions {
  messages?: HmlrChatMessage[];
  receipts?: HmlrDeliveryReceipt[];
  readStoredFile: (key: string) => Promise<{ data: Uint8Array } | null>;
}

export interface HmlrDeliveryVerification {
  reply: string;
  verification: "not_applicable" | "verified" | "blocked";
  changed: boolean;
  reason?: "missing_pdf" | "storage_unavailable" | "unconfirmed_order" | "provider_failure" | "invalid_link";
}

const TITLE = /^[A-Z]{0,3}\d{1,8}$/;
const HMLR_CONTEXT = /\b(?:HMLR|land\s+registry|official\s+copy|OC1)\b|\/api\/(?:lr-bg|file-storage\/(?:hmlr-orders|lr-bg))\//i;

function messageText(message: HmlrChatMessage): string {
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) return message.content
    .filter(part => part?.type === "text" && typeof part.text === "string")
    .map(part => part.text).join("\n");
  return "";
}

/** Buffer these turns before streaming: a short "order it" inherits the topic. */
export function shouldBufferHmlrDelivery(messages: HmlrChatMessage[]): boolean {
  return messages.filter(m => m.role === "user" || m.role === "assistant")
    .slice(-6).some(m => HMLR_CONTEXT.test(messageText(m)));
}

function unquotedText(reply: string): string {
  return reply.replace(/```[\s\S]*?(?:```|$)/g, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/^\s*>.*$/gm, "");
}

function assertedText(reply: string): string {
  // Only recognise direct positive assertions. Discussion of an earlier wrong
  // claim, instructions, negation and questions are not delivery assertions.
  return unquotedText(reply).replace(/\*\*|__/g, "").split(/\n|(?<=[.!?])\s+/)
    .filter(line => !/\b(?:not|no|never|cannot|can't|couldn't|failed|failure|rejected|wrong|false|claimed|earlier|previous(?:ly)?|quoted?|example|if|would|should|could|will)\b|\?/i.test(line))
    .join("\n");
}

function isCompaniesHouseDocumentStatement(line: string): boolean {
  // A filed deed is a separate source, even when it names a land title. Only
  // exclude an explicit CH document statement; mixed HMLR/CH delivery claims
  // must still go through the register guard.
  return /\bCompanies\s+House\b|\/api\/companies-house\/document\//i.test(line)
    && /\b(?:deed|filing|document|PDF)\b/i.test(line)
    && !/\b(?:HMLR|land\s+registry|official\s+copy|OC1|register)\b|\/api\/lr-bg\//i.test(line)
    && !/\b(?:ordered|purchased|placed)\b/i.test(line)
    && (line.match(/\b(?:ordered|purchased|placed|delivered|downloaded|saved)\b/gi) || []).length <= 1;
}

function assertsOrder(text: string): boolean {
  return /(?:^|\n)\s*(?:[-*]\s*)?Ordered\b|\b(?:I|we)(?:['’]ve| have)?\s+(?:successfully\s+)?(?:ordered|purchased)\b|\b(?:order|official copy|register)\b.{0,45}\b(?:has been|was|is)\s+(?:ordered|purchased|placed)\b/i.test(text);
}

function assertsDelivery(text: string): boolean {
  return assertsOrder(text)
    || /(?:^|\n)\s*(?:[-*]\s*)?(?:Status\s*:\s*)?Delivered\b|\b(?:PDF|register|official copy|order)\b.{0,50}\b(?:delivered|downloaded|saved|on file)\b|\b(?:I|we)(?:['’]ve| have)?\s+(?:successfully\s+)?(?:downloaded|saved)\b.{0,50}\b(?:register|official copy|PDF)\b/i.test(text);
}

function titleNumbers(text: string): string[] {
  // Avoid treating postcodes (EC3, W1) as title numbers. Short/numeric titles
  // are still supported when they arrive in a canonical link or tool receipt.
  return [...new Set(text.match(/\b[A-Z]{1,3}\d{5,8}\b/g) || [])];
}

function receiptTitle(receipt: HmlrDeliveryReceipt): string | null {
  const title = typeof receipt.titleNumber === "string" ? receipt.titleNumber.toUpperCase() : "";
  return TITLE.test(title) ? title : null;
}

function registerLink(url: string): { url: string; title: string | null } | null {
  const isHmlrPath = /\/api\/(?:lr-bg\/register|file-storage\/(?:hmlr-orders|lr-bg))\//i.test(url);
  let path: string;
  try { path = decodeURIComponent(new URL(url, "https://chatbgp.app").pathname); }
  catch { return isHmlrPath ? { url, title: null } : null; }
  const canonical = path.match(/^\/api\/lr-bg\/register\/([^/]+)$/i);
  if (canonical) {
    const title = canonical[1].toUpperCase();
    return { url, title: TITLE.test(title) ? title : null };
  }
  if (/^\/api\/file-storage\/(?:hmlr-orders|lr-bg)\//i.test(path)) {
    const match = path.match(/(?:^|\/|[-_])([A-Z]{0,3}\d{1,8})-OC1(?:-Register)?\.pdf$/i);
    return { url, title: match ? match[1].toUpperCase() : null };
  }
  return isHmlrPath || /^\/api\/lr-bg\/register\//i.test(path) ? { url, title: null } : null;
}

function safeProviderText(value: unknown): string | null {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").replace(/<[^>]*>/g, "").slice(0, 350) : null;
}

/**
 * Verify the bounded HMLR download surface before saving/sending a final reply.
 * This is not a general natural-language truth checker: it validates recognised
 * register URLs and common direct success assertions, using stored PDF bytes.
 * It never calls a provider, orders a replacement, or writes to storage.
 */
export async function verifyHmlrChatDelivery(reply: string, options: VerificationOptions): Promise<HmlrDeliveryVerification> {
  const visible = unquotedText(reply);
  const links = [...new Set(visible.match(/https?:\/\/[^\s<>)[\]]+|\/api\/[^\s<>)[\]]+/gi) || [])]
    .map(url => registerLink(url.replace(/[.,;:'"]+$/, ""))).filter((link): link is { url: string; title: string | null } => !!link);
  const receipts = options.receipts || [];
  const inContext = HMLR_CONTEXT.test(visible) || links.length > 0 || receipts.length > 0
    || shouldBufferHmlrDelivery(options.messages || []);
  const positive = assertedText(reply).split("\n").filter(line => !isCompaniesHouseDocumentStatement(line)).filter(line =>
    receipts.length > 0 || HMLR_CONTEXT.test(line) || /\bregister\b/i.test(line)
    || titleNumbers(line).length > 0
    || (links.length > 0 && /\b(?:status|ordered|delivered)\b/i.test(line))
  ).join("\n");
  const claimsOrder = inContext && assertsOrder(positive);
  const claimsDelivery = inContext && assertsDelivery(positive);
  if (!links.length && !claimsDelivery) return { reply, verification: "not_applicable", changed: false };

  // A company registration such as Luxembourg B283305 looks like a land
  // title. Ground checks in download links and actual delivery statements,
  // not every identifier in a lender/charges analysis. Keep asserted titles
  // as well as linked ones so a fabricated second delivery cannot slip past.
  const deliveryStatements = positive.split("\n").filter(assertsDelivery).join("\n");
  const explicitTitles = [...new Set([...links.map(link => link.title).filter((title): title is string => !!title), ...titleNumbers(deliveryStatements)])];
  const titles = explicitTitles.length ? explicitTitles : [...new Set(receipts.map(receiptTitle).filter((title): title is string => !!title))];
  const latestReceipts = new Map<string, HmlrDeliveryReceipt>();
  for (const receipt of receipts) { const title = receiptTitle(receipt); if (title) latestReceipts.set(title, receipt); }
  const failedReceipt = titles.map(title => latestReceipts.get(title)).find(receipt => receipt
    && receipt.success === false && receipt.orderSubmitted !== false
    && ["rejected", "failed", "unknown", "pending", "received_not_saved"].includes(String(receipt.outcome)));
  const blocked = (reason: NonNullable<HmlrDeliveryVerification["reason"]>): HmlrDeliveryVerification => {
    const which = titles.length ? ` for ${titles.join(", ")}` : "";
    const fault = safeProviderText(failedReceipt?.fault || failedReceipt?.summary?.fault || failedReceipt?.summary?.reason);
    const reference = safeProviderText(failedReceipt?.requestMessageId);
    let result = `I cannot confirm delivery of the official register${which}.`;
    if (fault) result += ` HM Land Registry reported: ${fault}`;
    if (reference) result += ` Request reference: ${reference}.`;
    if (reason === "storage_unavailable") result += " The saved-file check could not be completed.";
    else if (reason === "unconfirmed_order") result += " There is no confirmed successful order result for this request.";
    else if (reason !== "provider_failure") result += " No verified saved PDF was found for the download offered.";
    result += " Check the existing order status and charges before placing another paid order. This verification did not submit an order.";
    return { reply: result, verification: "blocked", changed: true, reason };
  };
  if (claimsDelivery && failedReceipt) return blocked("provider_failure");
  if (claimsOrder && (!titles.length || titles.some(title => {
    const receipt = latestReceipts.get(title);
    return receipt?.success !== true || receipt.outcome !== "delivered";
  }))) return blocked("unconfirmed_order");
  if (links.some(link => !link.title)) return blocked("invalid_link");
  if (!titles.length || titles.length > 8) return blocked("missing_pdf");

  const verified = new Set<string>();
  let unavailable = false;
  await Promise.all(titles.map(async title => {
    try {
      const file = await options.readStoredFile(`lr-bg/${title}-OC1-Register.pdf`);
      if (file?.data && Buffer.from(file.data).subarray(0, 5).toString("ascii") === "%PDF-") verified.add(title);
    } catch { unavailable = true; }
  }));
  if (verified.size !== titles.length) {
    const failure = blocked(unavailable ? "storage_unavailable" : "missing_pdf");
    if (claimsDelivery) return failure;
    // A correction/error explanation may quote a dead clickable link. Keep
    // that explanation, but make its unavailable URL non-clickable.
    let cleaned = reply;
    for (const link of links) if (!link.title || !verified.has(link.title)) {
      const escaped = link.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      cleaned = cleaned.replace(new RegExp(`\\[([^\\]]*)\\]\\(${escaped}\\)`, "g"), "$1 (unavailable)")
        .split(link.url).join("(unavailable register download)");
    }
    return { ...failure, reply: `${cleaned}\n\n${failure.reply}` };
  }
  let checked = reply;
  for (const link of links) checked = checked.split(link.url).join(`/api/lr-bg/register/${encodeURIComponent(link.title!)}`);
  return { reply: checked, verification: "verified", changed: checked !== reply };
}
