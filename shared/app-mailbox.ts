// The app's own email addresses. Woody, 17 November 2026: "just use
// chatbgp.app for all emails now". Mail from or to one of them is the app's,
// never a person or a firm, so the mailbox readers never add one as a
// contact, suggest it, or read it as an outside party.
export const APP_DOMAIN = "chatbgp.app";
export const SHARED_MAILBOX_ADDRESS = "chatbgp@brucegillinghampollard.com";

export function isAppAddress(email: string | null | undefined): boolean {
  const e = String(email || "").trim().toLowerCase();
  if (!e.includes("@")) return false;
  const domain = e.slice(e.lastIndexOf("@") + 1);
  return domain === APP_DOMAIN || domain.endsWith(`.${APP_DOMAIN}`) || e === SHARED_MAILBOX_ADDRESS;
}
