// Digital business cards and the matching email signature (Woody,
// 2026-09-28: "make mobile business cards … like blinq"). Everything comes
// from People & HR — name, title, mobile, email, LinkedIn, photo,
// specialisms — so nobody types a card and it follows role changes.
//
//   /card/<slug>              public card page (QR / link / NFC target)
//   /card/<slug>/contact.vcf  Save contact
//   /card/<slug>/photo        headshot (only for live cards)
//   /card/<slug>/qr.svg       QR of the card URL
//   POST /api/public/card/<slug>/share-back  their details → CRM + your bell
import type { Express, Request, Response } from "express";
import QRCode from "qrcode";
import { pool } from "./db";

export const CARD_BASE_URL = (process.env.PUBLIC_APP_URL || "https://chatbgp.app").replace(/\/+$/, "");
const OFFICE = { lines: ["First Floor, 55 Wells Street", "London W1T 3PT"], phone: "020 3551 5260", web: "bgp.uk.com" };
const BRAND = { bordeaux: "#6E0C25", ink: "#1D1D1B", cream: "#FCF8F4", blush: "#E4D8D3", stone: "#C2BAA3" };
const LOGO_DARK = `${CARD_BASE_URL}/api/branding/assets/BGP_BlackWordmark_trimmed.png`;
const LOGO_LIGHT = `${CARD_BASE_URL}/api/branding/assets/BGP_WhiteWordmark_trimmed.png`;

export interface BusinessCard {
  userId: string;
  slug: string;
  enabled: boolean;
  name: string;
  title: string | null;
  mobile: string | null;
  email: string | null;
  linkedin: string | null;
  photoUrl: string | null;
  specialisms: string[];
  url: string;
}

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
const slugify = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "bgp";
// "Managing Director - Board" → "Managing Director".
const cleanTitle = (value: string | null | undefined) => String(value || "").split(/\s+[-–—|]\s+/)[0].trim() || null;
const telHref = (phone: string) => `tel:${phone.replace(/\(0\)/g, "").replace(/[^\d+]/g, "")}`;

const CARD_SQL = `
  SELECT u.id, u.name, u.email, u.phone, u.role, u.profile_pic_url, COALESCE(u.is_active, true) AS active,
         sp.title, sp.linkedin_url, sp.cv_specialisms, sp.status,
         bc.slug, COALESCE(bc.enabled, true) AS enabled
    FROM users u
    LEFT JOIN staff_profiles sp ON sp.user_id = u.id
    LEFT JOIN business_cards bc ON bc.user_id = u.id`;

// Headshots in client/public are already public; uploaded photos are
// behind login, so the card serves those itself.
function photoUrlFor(pic: string | null | undefined, slug: string): string | null {
  const value = String(pic || "").trim();
  if (!value) return null;
  if (/^https:\/\//i.test(value)) return value;
  if (/^\/headshots\/[\w.-]+$/.test(value)) return `${CARD_BASE_URL}${value}`;
  if (/^\/uploads\/profile-pics\/[^/?#]+$/.test(value)) return `${CARD_BASE_URL}/card/${slug}/photo`;
  return null;
}

// The card page loads its own images from whichever host served it.
const sameOrigin = (url: string) => url.startsWith(CARD_BASE_URL) ? url.slice(CARD_BASE_URL.length) : url;

function toCard(row: any): BusinessCard {
  const slug = row.slug as string;
  return {
    userId: row.id, slug, enabled: !!row.enabled, name: row.name,
    title: cleanTitle(row.title) || cleanTitle(row.role),
    mobile: row.phone ? String(row.phone).trim() : null,
    email: row.email ? String(row.email).trim().toLowerCase() : null,
    linkedin: row.linkedin_url ? (/^https?:/i.test(row.linkedin_url) ? row.linkedin_url : `https://${row.linkedin_url}`) : null,
    photoUrl: photoUrlFor(row.profile_pic_url, slug),
    specialisms: (Array.isArray(row.cv_specialisms) ? row.cv_specialisms : []).filter(Boolean).slice(0, 4),
    url: `${CARD_BASE_URL}/card/${slug}`,
  };
}

// Staff only (BGP address, active, not a client login); the slug is made once.
export async function cardForUser(userId: string): Promise<BusinessCard | null> {
  let row = (await pool.query(`${CARD_SQL} WHERE u.id = $1`, [userId])).rows[0];
  if (!row || !/@brucegillinghampollard\.com$/i.test(row.email || "")) return null;
  if (!row.slug) {
    const base = slugify(row.name);
    for (let attempt = 0; attempt < 20 && !row.slug; attempt++) {
      const slug = attempt ? `${base}-${attempt + 1}` : base;
      const r = await pool.query(`INSERT INTO business_cards (user_id, slug) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING slug`, [userId, slug]);
      if (r.rows[0]) row.slug = r.rows[0].slug;
      else {
        const existing = await pool.query(`SELECT slug FROM business_cards WHERE user_id = $1`, [userId]);
        if (existing.rows[0]) row.slug = existing.rows[0].slug;
      }
    }
    row = (await pool.query(`${CARD_SQL} WHERE u.id = $1`, [userId])).rows[0];
  }
  return toCard(row);
}

async function liveCardBySlug(slug: string): Promise<(BusinessCard & { profilePic: string | null }) | null> {
  if (!/^[a-z0-9-]{1,48}$/.test(slug)) return null;
  const row = (await pool.query(`${CARD_SQL} WHERE bc.slug = $1`, [slug])).rows[0];
  if (!row || !row.enabled || !row.active || row.status === "leaver") return null;
  return { ...toCard(row), profilePic: row.profile_pic_url || null };
}

export function vcardFor(card: BusinessCard, photo?: { data: Buffer; contentType: string } | null): string {
  const [first, ...rest] = card.name.split(" ");
  const fold = (line: string) => line.match(/.{1,74}/g)!.join("\r\n ");
  const v = (value: string) => value.replace(/\\/g, "\\\\").replace(/[,;]/g, m => `\\${m}`).replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCARD", "VERSION:3.0",
    `N:${v(rest.join(" "))};${v(first)};;;`, `FN:${v(card.name)}`,
    "ORG:Bruce Gillingham Pollard",
    card.title ? `TITLE:${v(card.title)}` : "",
    card.mobile ? `TEL;TYPE=CELL,VOICE:${card.mobile.replace(/\(0\)/g, "").replace(/\s+/g, " ").trim()}` : "",
    `TEL;TYPE=WORK,VOICE:${OFFICE.phone}`,
    card.email ? `EMAIL;TYPE=INTERNET,WORK:${card.email}` : "",
    `ADR;TYPE=WORK:;;${v(OFFICE.lines[0])};London;;W1T 3PT;United Kingdom`,
    `URL:https://${OFFICE.web}`,
    card.linkedin ? `URL;TYPE=LinkedIn:${card.linkedin}` : "",
    photo && photo.data.length < 300_000 ? fold(`PHOTO;ENCODING=b;TYPE=${/png/i.test(photo.contentType) ? "PNG" : "JPEG"}:${photo.data.toString("base64")}`) : "",
    `NOTE:${v(`Card: ${card.url}`)}`,
    "END:VCARD",
  ];
  return lines.filter(Boolean).join("\r\n") + "\r\n";
}

// Table layout + inline styles so Outlook, Gmail and Apple Mail agree.
export function signatureHtml(card: BusinessCard): string {
  const font = "font-family:Helvetica,Arial,sans-serif;";
  const link = `color:${BRAND.ink};text-decoration:none;`;
  const rows = [
    card.mobile ? `<a href="${telHref(card.mobile)}" style="${link}">M&nbsp;&nbsp;${esc(card.mobile)}</a>` : "",
    `<a href="${telHref(OFFICE.phone)}" style="${link}">T&nbsp;&nbsp;${esc(OFFICE.phone)}</a>`,
    card.email ? `<a href="mailto:${esc(card.email)}" style="${link}">E&nbsp;&nbsp;${esc(card.email)}</a>` : "",
  ].filter(Boolean).join("<br>");
  const photo = card.photoUrl
    ? `<td valign="top" style="padding:0 16px 0 0;"><a href="${esc(card.url)}"><img src="${esc(card.photoUrl)}" width="80" height="80" alt="${esc(card.name)}" style="display:block;width:80px;height:80px;border-radius:40px;object-fit:cover;border:0;"></a></td>`
    : "";
  return `<table cellpadding="0" cellspacing="0" border="0" style="${font}color:${BRAND.ink};font-size:13px;line-height:19px;border-collapse:collapse;">
<tr>${photo}<td valign="top" style="padding:0;">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:22px;color:${BRAND.bordeaux};font-weight:bold;">${esc(card.name)}</div>
${card.title ? `<div style="font-size:12px;color:${BRAND.ink};padding:1px 0 8px;">${esc(card.title)}</div>` : `<div style="height:8px;"></div>`}
<div style="font-size:12px;line-height:18px;">${rows}</div>
<table cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;border-collapse:collapse;"><tr>
<td style="background:${BRAND.bordeaux};border-radius:4px;padding:6px 12px;"><a href="${esc(card.url)}" style="${font}color:#ffffff;text-decoration:none;font-size:12px;font-weight:bold;">Save my contact</a></td>
${card.linkedin ? `<td style="padding:0 0 0 12px;font-size:12px;"><a href="${esc(card.linkedin)}" style="color:${BRAND.bordeaux};text-decoration:none;">LinkedIn</a></td>` : ""}
</tr></table>
</td></tr>
<tr><td colspan="${card.photoUrl ? 2 : 1}" style="padding:14px 0 0;border-bottom:1px solid ${BRAND.blush};"></td></tr>
<tr><td colspan="${card.photoUrl ? 2 : 1}" style="padding:12px 0 0;">
<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>
<td valign="middle" style="padding:0 14px 0 0;"><a href="https://${OFFICE.web}"><img src="${LOGO_DARK}" height="30" alt="Bruce Gillingham Pollard" style="display:block;height:30px;border:0;"></a></td>
<td valign="middle" style="font-size:11px;line-height:15px;color:${BRAND.ink};">${esc(OFFICE.lines.join(", "))}<br><a href="https://${OFFICE.web}" style="color:${BRAND.bordeaux};text-decoration:none;">${OFFICE.web}</a></td>
</tr></table>
</td></tr>
</table>`;
}

function cardPage(card: BusinessCard, qrSvg: string, sent: boolean): string {
  const action = (href: string, label: string, primary = false) =>
    `<a class="btn${primary ? " primary" : ""}" href="${esc(href)}">${esc(label)}</a>`;
  const initials = card.name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(card.name)} · Bruce Gillingham Pollard</title>
<meta name="description" content="${esc([card.title, "Bruce Gillingham Pollard"].filter(Boolean).join(" · "))}">
<meta property="og:title" content="${esc(card.name)} · Bruce Gillingham Pollard">
<meta property="og:description" content="${esc(card.title || "Bruce Gillingham Pollard")} — save my contact">
${card.photoUrl ? `<meta property="og:image" content="${esc(card.photoUrl)}">` : ""}
<meta name="theme-color" content="${BRAND.bordeaux}">
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.png">
<style>
*{box-sizing:border-box}body{margin:0;background:${BRAND.cream};color:${BRAND.ink};font:15px/1.5 Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:440px;margin:0 auto;padding:0 16px 40px}
.hero{background:${BRAND.bordeaux};color:#fff;margin:0 -16px;padding:24px 24px 124px;text-align:center}
.hero img.logo{height:40px;display:block;margin:0 auto}
.card{background:#fff;border:1px solid ${BRAND.blush};border-radius:16px;margin-top:-44px;padding:0 20px 20px;text-align:center}
.photo{width:112px;height:112px;border-radius:56px;object-fit:cover;border:4px solid #fff;margin-top:-56px;background:${BRAND.blush};display:inline-flex;align-items:center;justify-content:center;font:bold 34px Georgia,serif;color:${BRAND.bordeaux}}
h1{font:600 26px/1.2 Georgia,'Times New Roman',serif;color:${BRAND.bordeaux};margin:12px 0 2px;letter-spacing:-.01em}
.title{margin:0;color:${BRAND.ink}}.org{margin:2px 0 0;font-size:13px;color:#6b6b66}
.tags{margin:12px 0 0;display:flex;flex-wrap:wrap;gap:6px;justify-content:center}.tags span{font-size:12px;border:1px solid ${BRAND.blush};border-radius:999px;padding:2px 10px}
.btn{display:block;text-align:center;text-decoration:none;border:1px solid ${BRAND.blush};border-radius:10px;padding:13px;margin-top:10px;color:${BRAND.ink};font-weight:600;background:#fff}
.btn.primary{background:${BRAND.bordeaux};border-color:${BRAND.bordeaux};color:#fff}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.row .btn{margin-top:10px}
.section{background:#fff;border:1px solid ${BRAND.blush};border-radius:16px;padding:18px 20px;margin-top:14px}
.label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6b6b66;margin:0 0 10px}
.lines a{color:${BRAND.ink};text-decoration:none;display:block;padding:6px 0;border-bottom:1px solid ${BRAND.cream};word-break:break-word}
form input,form textarea{width:100%;font:inherit;border:1px solid ${BRAND.blush};border-radius:10px;padding:11px 12px;margin-top:8px;background:#fff;color:${BRAND.ink}}
form button{width:100%;font:inherit;font-weight:600;border:0;border-radius:10px;padding:13px;margin-top:12px;background:${BRAND.bordeaux};color:#fff}
.hp{position:absolute;left:-9999px}.fine{font-size:11px;color:#6b6b66;margin:10px 0 0}
.qr{display:flex;justify-content:center}.qr svg{width:170px;height:170px}
.ok{background:#fff;border:1px solid ${BRAND.blush};border-radius:16px;padding:16px 20px;margin-top:14px;text-align:center}
</style></head><body><div class="wrap">
<div class="hero"><img class="logo" src="${sameOrigin(LOGO_LIGHT)}" alt="Bruce Gillingham Pollard"></div>
<div class="card">
${card.photoUrl ? `<img class="photo" src="${esc(sameOrigin(card.photoUrl))}" alt="" onerror="this.outerHTML='<div class=&quot;photo&quot;>${esc(initials)}</div>'">` : `<div class="photo">${esc(initials)}</div>`}
<h1>${esc(card.name)}</h1>
${card.title ? `<p class="title">${esc(card.title)}</p>` : ""}
<p class="org">Bruce Gillingham Pollard</p>
${card.specialisms.length ? `<div class="tags">${card.specialisms.map(s => `<span>${esc(s)}</span>`).join("")}</div>` : ""}
${action(`/card/${card.slug}/contact.vcf`, "Save contact", true)}
<div class="row">${card.mobile ? action(telHref(card.mobile), "Call") : action(telHref(OFFICE.phone), "Call")}${card.email ? action(`mailto:${card.email}`, "Email") : ""}</div>
</div>
${sent ? `<div class="ok"><strong>Thanks — your details are with ${esc(card.name.split(" ")[0])}.</strong></div>` : ""}
<div class="section"><p class="label">Contact</p><div class="lines">
${card.mobile ? `<a href="${telHref(card.mobile)}">Mobile · ${esc(card.mobile)}</a>` : ""}
<a href="${telHref(OFFICE.phone)}">Office · ${esc(OFFICE.phone)}</a>
${card.email ? `<a href="mailto:${esc(card.email)}">${esc(card.email)}</a>` : ""}
${card.linkedin ? `<a href="${esc(card.linkedin)}" rel="noopener">LinkedIn</a>` : ""}
<a href="https://${OFFICE.web}" rel="noopener">${OFFICE.web}</a>
<a href="https://maps.google.com/?q=${encodeURIComponent("55 Wells Street, London W1T 3PT")}" rel="noopener">${esc(OFFICE.lines.join(", "))}</a>
</div></div>
${sent ? "" : `<div class="section"><p class="label">Share your details with ${esc(card.name.split(" ")[0])}</p>
<form method="post" action="/api/public/card/${card.slug}/share-back">
<input name="name" placeholder="Your name" required maxlength="120" autocomplete="name">
<input name="email" type="email" placeholder="Email" maxlength="160" autocomplete="email">
<input name="phone" type="tel" placeholder="Mobile" maxlength="40" autocomplete="tel">
<input name="company" placeholder="Company" maxlength="160" autocomplete="organization">
<input name="role" placeholder="Job title" maxlength="120" autocomplete="organization-title">
<textarea name="note" rows="2" placeholder="Where we met / what you're looking for" maxlength="600"></textarea>
<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<button type="submit">Send my details</button>
<p class="fine">Bruce Gillingham Pollard will keep these details to stay in touch about property. Ask ${esc(card.name.split(" ")[0])} at any time to remove them.</p>
</form></div>`}
<div class="section"><p class="label">Share this card</p><div class="qr">${qrSvg}</div></div>
</div></body></html>`;
}

const recentShares = new Map<string, number[]>();
function allowShare(ip: string): boolean {
  const now = Date.now();
  const hits = (recentShares.get(ip) || []).filter(t => now - t < 3600_000);
  if (hits.length >= 8) return false;
  hits.push(now);
  recentShares.set(ip, hits);
  return true;
}

const clip = (value: unknown, max: number) => String(value ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max);

// Their details become (or find) a CRM contact, logged as a meeting with the
// card's owner, and land in the owner's bell.
async function recordShareBack(card: BusinessCard, body: any, ip: string): Promise<void> {
  const name = clip(body.name, 120);
  const email = clip(body.email, 160).toLowerCase();
  const phone = clip(body.phone, 40);
  const company = clip(body.company, 160);
  const role = clip(body.role, 120);
  const note = clip(body.note, 600);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
  const domain = validEmail.split("@")[1] || "";

  let contactId: string | null = validEmail
    ? (await pool.query(`SELECT id FROM crm_contacts WHERE lower(trim(email)) = $1 ORDER BY created_at LIMIT 1`, [validEmail])).rows[0]?.id || null
    : null;
  let companyId: string | null = null;
  if (!contactId) {
    if (domain && !/^(gmail|googlemail|hotmail|outlook|live|icloud|me|yahoo|aol|btinternet|sky)\./.test(domain)) {
      companyId = (await pool.query(
        `SELECT id FROM crm_companies WHERE merged_into_id IS NULL
            AND lower(regexp_replace(regexp_replace(COALESCE(domain, domain_url, website, ''), '^[a-z]+://', ''), '^www\\.', '')) LIKE $1 || '%'
          ORDER BY created_at LIMIT 1`, [domain])).rows[0]?.id || null;
    }
    const inserted = await pool.query(
      `INSERT INTO crm_contacts (name, email, phone_mobile, role, company_id, company_name, notes, bgp_allocation, enrichment_source)
       VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''), $5, NULLIF($6, ''), NULLIF($7, ''), $8, 'business_card')
       RETURNING id`,
      [name, validEmail, phone, role, companyId, company, note ? `Shared via ${card.name}'s business card: ${note}` : `Shared via ${card.name}'s business card`,
        JSON.stringify([card.name])]);
    contactId = inserted.rows[0].id;
  } else {
    companyId = (await pool.query(`SELECT company_id FROM crm_contacts WHERE id = $1`, [contactId])).rows[0]?.company_id || null;
    if (phone) await pool.query(`UPDATE crm_contacts SET phone_mobile = $2 WHERE id = $1 AND NULLIF(TRIM(COALESCE(phone_mobile, '')), '') IS NULL`, [contactId, phone]);
  }
  await pool.query(
    `INSERT INTO crm_interactions (contact_id, company_id, type, direction, subject, preview, participants, match_method, interaction_date, bgp_user)
     VALUES ($1, $2, 'meeting', 'inbound', $3, $4, $5::jsonb, 'business_card', NOW(), $6)`,
    [contactId, companyId, `Met ${card.name} — shared details via business card`, note || [role, company].filter(Boolean).join(" · ") || null,
      JSON.stringify([validEmail, card.email].filter(Boolean)), card.email]);
  await pool.query(
    `INSERT INTO business_card_leads (user_id, contact_id, name, email, phone, company, role, note, ip) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [card.userId, contactId, name, validEmail || null, phone || null, company || null, role || null, note || null, ip.slice(0, 64)]);
  const { sendPushNotification } = await import("./push-notifications");
  await sendPushNotification(card.userId, {
    title: `${name} shared their details`,
    body: [role, company].filter(Boolean).join(" · ") || validEmail || phone || "From your business card",
    tag: `card-${contactId}`, url: `/contacts/${contactId}`,
  }).catch(() => undefined);
}

export function registerBusinessCardRoutes(app: Express, requireAuth: any) {
  app.get("/api/business-card/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId || (req as any).tokenUserId;
      const card = userId ? await cardForUser(userId) : null;
      if (!card) return res.status(404).json({ message: "Business cards are for BGP staff accounts." });
      const leads = await pool.query(
        `SELECT contact_id, name, company, role, created_at FROM business_card_leads WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [userId]);
      res.json({ card, signatureHtml: signatureHtml(card), leads: leads.rows });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Could not load your card" });
    }
  });

  app.patch("/api/business-card/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId || (req as any).tokenUserId;
      const card = userId ? await cardForUser(userId) : null;
      if (!card) return res.status(404).json({ message: "Business cards are for BGP staff accounts." });
      if (typeof req.body?.enabled === "boolean") await pool.query(`UPDATE business_cards SET enabled = $2 WHERE user_id = $1`, [userId, req.body.enabled]);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Could not update your card" });
    }
  });

  const notFound = (res: Response) => res.status(404).type("html").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Bruce Gillingham Pollard</title><body style="font:15px Helvetica,Arial,sans-serif;padding:40px 16px;text-align:center;color:${BRAND.ink};background:${BRAND.cream}">This card isn't available. Visit <a href="https://${OFFICE.web}" style="color:${BRAND.bordeaux}">${OFFICE.web}</a>.</body>`);

  app.get("/card/:slug", async (req: Request, res: Response) => {
    try {
      const card = await liveCardBySlug(String(req.params.slug));
      if (!card) return notFound(res);
      const qrSvg = await QRCode.toString(card.url, { type: "svg", margin: 1, color: { dark: BRAND.ink, light: "#ffffff" } });
      res.set("Cache-Control", "no-store");
      res.type("html").send(cardPage(card, qrSvg, req.query.sent === "1"));
    } catch (e: any) {
      console.error("[card] page failed:", e?.message);
      res.status(500).type("text").send("Card unavailable");
    }
  });

  app.get("/card/:slug/photo", async (req: Request, res: Response) => {
    try {
      const card = await liveCardBySlug(String(req.params.slug));
      const filename = card?.profilePic?.match(/\/uploads\/profile-pics\/([^/?#]+)$/)?.[1];
      if (!filename || filename.includes("..")) return res.status(404).end();
      const { getFile } = await import("./file-storage");
      const file = await getFile(`profile-pics/${filename}`);
      if (!file) return res.status(404).end();
      res.set("Content-Type", file.contentType);
      res.set("Cache-Control", "public, max-age=86400");
      res.send(file.data);
    } catch { res.status(500).end(); }
  });

  app.get("/card/:slug/contact.vcf", async (req: Request, res: Response) => {
    try {
      const card = await liveCardBySlug(String(req.params.slug));
      if (!card) return res.status(404).end();
      let photo: { data: Buffer; contentType: string } | null = null;
      const filename = card.profilePic?.match(/\/uploads\/profile-pics\/([^/?#]+)$/)?.[1];
      const headshot = card.profilePic?.match(/^\/headshots\/([\w.-]+)$/)?.[1];
      if (filename) {
        const { getFile } = await import("./file-storage");
        photo = await getFile(`profile-pics/${filename}`).catch(() => null);
      } else if (headshot) {
        const fs = await import("fs");
        for (const dir of ["dist/public/headshots", "client/public/headshots"]) {
          const file = `${process.cwd()}/${dir}/${headshot}`;
          if (fs.existsSync(file)) { photo = { data: fs.readFileSync(file), contentType: /\.png$/i.test(headshot) ? "image/png" : "image/jpeg" }; break; }
        }
      }
      res.set("Content-Type", "text/vcard; charset=utf-8");
      res.set("Content-Disposition", `attachment; filename="${card.slug}.vcf"`);
      res.send(vcardFor(card, photo));
    } catch { res.status(500).end(); }
  });

  app.get("/card/:slug/qr.svg", async (req: Request, res: Response) => {
    try {
      const card = await liveCardBySlug(String(req.params.slug));
      if (!card) return res.status(404).end();
      res.type("image/svg+xml").send(await QRCode.toString(card.url, { type: "svg", margin: 1, color: { dark: BRAND.ink, light: "#ffffff" } }));
    } catch { res.status(500).end(); }
  });

  app.post("/api/public/card/:slug/share-back", async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    try {
      const card = await liveCardBySlug(slug);
      if (!card) return notFound(res);
      const body = req.body || {};
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      const name = clip(body.name, 120);
      const hasWay = /\S+@\S+\.\S+/.test(String(body.email || "")) || /\d{6,}/.test(String(body.phone || "").replace(/\D/g, ""));
      // Honeypot and rate limit fail quietly, like a success.
      if (!clip(body.website, 10) && name && hasWay && allowShare(ip)) await recordShareBack(card, body, ip);
      if (req.is("application/json")) return res.json({ ok: true });
      res.redirect(303, `/card/${slug}?sent=1`);
    } catch (e: any) {
      console.error("[card] share-back failed:", e?.message);
      if (req.is("application/json")) return res.status(500).json({ message: "Could not send your details" });
      res.redirect(303, `/card/${slug}`);
    }
  });
}
