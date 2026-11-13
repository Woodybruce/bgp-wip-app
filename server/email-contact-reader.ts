// Contact details from an email (Woody, 2026-11-13: "its really important we
// capture contact details from emails", read automatically, including the
// quoted earlier messages further down a thread).
//
// One reader. It is given an email's text and the people on that email, and
// returns, per person, the job title, direct phone, mobile and company it can
// find in a signature. A signature is only ever given to the person who wrote
// the message it closes: the sender of the email itself, or the person named
// in the From line (or "On ... wrote:" line) that introduces a quoted earlier
// message. Somebody who was only copied, and wrote nothing in the thread, gets
// nothing. Anything that cannot be tied to one person is dropped.
//
// Plain signatures are read by rules. Where the rules cannot read a block
// that is clearly a signature, one Anthropic call per email reads it; every
// value it returns must be in that person's own block or it is dropped. The
// model is given only the signature text and the names and addresses on the
// email, is capped per day (CONTACT_DETAILS_READER_DAILY_CAP, default 300,
// 0 = off), logs its spend as "contact-details" and does nothing with no key.

export interface ReaderPerson { email: string; name?: string | null }

export interface PersonDetails {
  email: string;
  title: string | null;
  phone: string | null;
  mobile: string | null;
  company: string | null;
  /** The email itself, or an earlier message quoted inside it. */
  where: "message" | "quoted";
  how: "rules" | "model";
}

export interface ReadEmailInput {
  /** The full body, HTML or plain text. */
  body: string;
  /** Who sent the email. */
  from: ReaderPerson | null;
  /** Everyone on the email (from, to, cc), with the names the email gives. */
  people: ReaderPerson[];
  /** Whose details are wanted (addresses). Empty or missing = everyone. */
  wanted?: string[];
  /** People whose blocks are read by rules only (the model was asked about them recently). */
  rulesOnly?: string[];
  /** Told which people's blocks were sent to the model, when it is asked. */
  onModel?: (emails: string[]) => void;
}

export interface ContactReaderDeps {
  hasKey(): boolean;
  /** Takes one read from today's allowance; false when it is used up. */
  claim(): Promise<boolean>;
  call(system: string, user: string): Promise<{ text: string; model: string; usage?: any }>;
  log(model: string, usage: any): void;
}

// ── Text ───────────────────────────────────────────────────────────────────

/** An email body as plain lines. Tags go first, entities after, so a quoted
 *  "Name <address>" survives. */
export function emailBodyText(body: string): string {
  let s = String(body || "");
  if (/<\s*(html|body|div|p|br|table|span)\b/i.test(s)) {
    s = s
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, "\n")
      .replace(/<hr[^>]*>/gi, "\n__________\n")
      .replace(/<\/t[dh]>/gi, " ")
      .replace(/<[^>]+>/g, "");
  }
  return s
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, "-")
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c > 31 && c < 65536 ? String.fromCharCode(c) : " "; })
    .replace(/&amp;/gi, "&")
    .replace(/\r\n?/g, "\n")
    .replace(/[  -​ ]/g, " ")
    .replace(/[ \t]+\n/g, "\n");
}

const ADDRESS = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;
const lower = (s: unknown) => String(s || "").trim().toLowerCase();
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\s'-]/gu, " ").split(/\s+/).filter(w => w.length > 0);

// ── Who a name is ──────────────────────────────────────────────────────────

/** "Whitehead, Toby (Greggs)" → "Toby Whitehead". */
function tidyName(raw: string): string {
  let name = String(raw || "").replace(/["']/g, "").replace(/\s*[([].*?[)\]]\s*/g, " ").replace(/\s+/g, " ").trim();
  const comma = name.match(/^([^,]+),\s*([^,]+)$/);
  if (comma) name = `${comma[2]} ${comma[1]}`;
  return name;
}

// "Steve" signing as steven.jones@: the short form of the same first name.
const SHORT_NAMES: Record<string, string[]> = {
  steve: ["stephen", "steven"], tom: ["thomas"], mike: ["michael"], bill: ["william"], will: ["william"],
  bob: ["robert"], rob: ["robert"], jim: ["james"], jamie: ["james"], dick: ["richard"], rich: ["richard"],
  ted: ["edward"], ed: ["edward", "edmund"], liz: ["elizabeth"], beth: ["elizabeth"], kate: ["katherine", "catherine", "kathryn"],
  katie: ["katherine", "catherine", "kathryn"], tony: ["anthony"], andy: ["andrew"], harry: ["henry", "harold"],
  charlie: ["charles", "charlotte"], jack: ["john"], jon: ["jonathan"], joe: ["joseph"], pete: ["peter"],
  phil: ["philip", "phillip"], greg: ["gregory"], dave: ["david"], nick: ["nicholas"], matt: ["matthew"],
  chris: ["christopher", "christian", "christine"], dan: ["daniel"], ben: ["benjamin"], sam: ["samuel", "samantha"],
  alex: ["alexander", "alexandra"], jen: ["jennifer"], jenny: ["jennifer"], vicky: ["victoria"], tim: ["timothy"],
};
function sameFirstName(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return !!SHORT_NAMES[a]?.includes(b) || !!SHORT_NAMES[b]?.includes(a);
}

/** Whether a written name is this person: by the name the email gives them,
 *  or by a first.last@ (or flast@, firstl@) address. */
export function nameIsPerson(written: string, person: ReaderPerson): boolean {
  const w = words(tidyName(written));
  if (w.length < 2 || w.length > 4) return false;
  const first = w[0], last = w[w.length - 1];
  const given = person.name && !String(person.name).includes("@") ? words(tidyName(String(person.name))) : [];
  if (given.length >= 2 && sameFirstName(given[0], first) && given[given.length - 1] === last) return true;
  const local = lower(person.email).split("@")[0].replace(/\d+/g, "");
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0], b = parts[parts.length - 1];
    return (sameFirstName(a, first) && b === last) || (a === last && sameFirstName(b, first));
  }
  if (parts.length === 1 && parts[0].length >= 4) {
    const l = parts[0];
    return l === first + last || l === first[0] + last || l === first + last[0];
  }
  return false;
}

// ── The thread, split into the messages it quotes ──────────────────────────

export interface ThreadPart {
  senderName: string | null;
  senderEmail: string | null;
  quoted: boolean;
  lines: string[];
}

const HEADER_FROM = /^\s*(?:>\s*)*\*{0,2}(?:from|von|de)\s*:\*{0,2}\s*(.+)$/i;
const HEADER_FOLLOW = /^\s*(?:>\s*)*\*{0,2}(?:sent|date|to|cc|subject|gesendet|envoy[ée])\s*:/i;
const WROTE = /^\s*(?:>\s*)*on\s.{4,160}?\bwrote:\s*$/i;

function senderOf(text: string): { name: string | null; email: string | null } {
  const t = text.replace(/\bmailto:/gi, "").trim();
  const email = t.match(ADDRESS)?.[0]?.toLowerCase() || null;
  const name = tidyName(t.replace(/[<[(]?\s*[a-z0-9._%+'-]+@[a-z0-9.-]+\s*[>\])]?/gi, " ").replace(/[<>[\]]/g, " "));
  return { name: name && /\p{L}/u.test(name) ? name : null, email };
}

/** The email and each earlier message quoted in it, newest first, each with
 *  the sender its From line (or "On ... wrote:" line) names. */
export function splitThread(text: string, from: ReaderPerson | null): ThreadPart[] {
  const raw = text.split("\n");
  const parts: ThreadPart[] = [{ senderName: from?.name ? String(from.name) : null, senderEmail: from ? lower(from.email) || null : null, quoted: false, lines: [] }];
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    // Outlook: "From: X" with Sent / To / Subject on the lines after, or all on one line.
    const m = line.match(HEADER_FROM);
    if (m) {
      const flat = m[1].match(/^(.+?)\s+(?:sent|date)\s*:\s.*\bto\s*:/i);
      let follows = !!flat;
      for (let k = i + 1; !follows && k <= i + 3 && k < raw.length; k++) follows = HEADER_FOLLOW.test(raw[k]);
      if (follows) {
        const who = senderOf(flat ? flat[1] : m[1]);
        parts.push({ senderName: who.name, senderEmail: who.email, quoted: true, lines: [] });
        if (!flat) {
          // The rest of the header block: through its Subject line, else the run of header lines.
          let end = i;
          for (let k = i + 1; k <= i + 15 && k < raw.length; k++) {
            if (/^\s*(?:>\s*)*\*{0,2}(?:subject|betreff|objet)\s*:/i.test(raw[k])) { end = k; break; }
          }
          if (end === i) while (end + 1 < raw.length && HEADER_FOLLOW.test(raw[end + 1])) end++;
          i = end;
        }
        continue;
      }
    }
    // Gmail and Apple Mail: "On 6 Oct 2026, at 10:15, Name <address> wrote:" (may wrap).
    const joined = /^\s*(?:>\s*)*on\s/i.test(line) && !/wrote:\s*$/i.test(line) && /wrote:\s*$/i.test(raw[i + 1] || "") ? `${line.trim()} ${raw[i + 1].trim()}` : line;
    if (WROTE.test(joined)) {
      const head = joined.replace(/^\s*(?:>\s*)*on\s/i, "").replace(/\s*wrote:\s*$/i, "");
      const email = head.match(ADDRESS)?.[0]?.toLowerCase() || null;
      const beforeAddr = email ? head.slice(0, head.toLowerCase().indexOf(email)) : head;
      const nameText = beforeAddr.split(/,|\bat\b|\d{1,2}:\d{2}(?:\s*[ap]m)?/i).pop() || "";
      const name = tidyName(nameText.replace(/[<>[\]]/g, " "));
      parts.push({ senderName: /\p{L}{2,}\s+\p{L}{2,}/u.test(name) ? name : null, senderEmail: email, quoted: true, lines: [] });
      if (joined !== line) i++;
      continue;
    }
    if (/^\s*(?:>\s*)*-{3,}\s*(original message|forwarded message)\s*-{3,}\s*$/i.test(line)) continue;
    parts[parts.length - 1].lines.push(line.replace(/^\s*(?:>\s?)+/, ""));
  }
  return parts;
}

/** The one person who wrote this part, or null when that is not certain. */
export function writerOf(part: ThreadPart, people: ReaderPerson[]): ReaderPerson | null {
  if (part.senderEmail) return people.find(p => lower(p.email) === part.senderEmail) || null;
  if (!part.senderName) return null;
  const hits = people.filter(p => nameIsPerson(part.senderName!, p));
  return hits.length === 1 ? hits[0] : null;
}

// ── The signature, by rules ────────────────────────────────────────────────

const DISCLAIMER = [
  /confidentiality notice/i, /this (e-?mail|message)( and any attachments)? (is|are|may be) (intended|confidential)/i,
  /if you (have received|are not the intended)/i, /unauthori[sz]ed (use|disclosure|copying)/i,
  /please (notify|consider the environment)/i, /the contents of this e-?mail/i, /registered (in|office|number|no\b)/i,
  /company (number|no\b|registration)/i, /\bvat (number|no\b|reg)/i, /^_{8,}\s*$/,
];
const SIGN_OFF = /^(?:many |kind |best |warm |with |with best |with kind )?(?:regards|thanks|thank you|wishes|best|cheers|yours(?: sincerely| faithfully)?|sincerely|speak soon|all the best|kind regards|br|kr)[\s,.!]*$/i;
const TITLE_WORD = /\b(manager|director|head|officer|executive|partner|associate|surveyor|analyst|assistant|consultant|lead|president|chief|ceo|cfo|coo|cto|founder|owner|principal|agent|co-?ordinator|administrator|advis[eo]r|specialist|controller|buyer|solicitor|counsel|paralegal|architect|engineer|chair(?:man|woman)?|secretary|negotiator|trainee|graduate|apprentice|supervisor|planner|accountant|lawyer|md|vp|estates|acquisitions?)\b/i;
const COMPANY_WORD = /\b(ltd|limited|plc|llp|inc|group|holdings|partners|& co)\b\.?/i;
const PHONE = /\+?\(?\d[\d\s().-]{7,18}\d/g;
const MOBILE_LABEL = /\b(m|mob|mobile|cell)\b/;
const DIRECT_LABEL = /\b(t|tel|telephone|d|dd|ddi|dl|direct|o|office|p|ph|phone|w|work|landline)\b/;
const OTHER_LABEL = /\b(f|fax|switchboard|main|reception|general|helpline|customer|head office|pa|ea)\b/;
const POST_NOMINALS = /\s+(?:\(?(?:he|she|they)\/(?:him|her|them)\)?|\(hons\)|MRICS|FRICS|AssocRICS|MRTPI|ACA|FCA|ACCA|FCCA|CFA|BSc|MSc|BA|MA|LLB|LLM|MBA|PhD)(?=\s|$|,)/g;

const digitsOf = (s: string) => s.replace(/\D/g, "");
const isUkMobile = (digits: string) => /^(?:0|44|440)7\d{9}$/.test(digits);
const plausiblePhone = (written: string) => {
  const d = digitsOf(written);
  return d.length >= 10 && d.length <= 15 && /^(\+|\(?0|\(?44|00)/.test(written.trim());
};

interface Found { title: string | null; phone: string | null; mobile: string | null; company: string | null }
const none = (): Found => ({ title: null, phone: null, mobile: null, company: null });

function phonesIn(line: string, found: Found) {
  if (/\b(registered|company no|vat)\b/i.test(line)) return;
  for (const piece of line.split(/\||•|·|\t| {2,}|;/)) {
    let last = 0;
    for (const m of piece.matchAll(PHONE)) {
      const written = m[0].trim().replace(/\s+/g, " ").replace(/[.\-(]+$/, "");
      // The label is whatever sits just before the number ("M:", "Direct line").
      const label = piece.slice(last, m.index).toLowerCase().replace(/[^a-z/ ]/g, " ").replace(/\s+/g, " ").trim().slice(-24);
      last = (m.index || 0) + m[0].length;
      if (!plausiblePhone(written) || OTHER_LABEL.test(label)) continue;
      if (MOBILE_LABEL.test(label)) { found.mobile ||= written; continue; }
      if (DIRECT_LABEL.test(label)) { if (isUkMobile(digitsOf(written))) found.mobile ||= written; else found.phone ||= written; continue; }
      // A number after any other words (a helpline, someone else's name) is not taken as this person's.
      if (label) continue;
      if (isUkMobile(digitsOf(written))) found.mobile ||= written; else found.phone ||= written;
    }
  }
}

const looksLikeTitle = (line: string) =>
  line.length >= 2 && line.length <= 70 && line.split(/\s+/).length <= 7 && !/\d|@|www\.|https?:|[.!?]\s|[.!?]$/i.test(line) && TITLE_WORD.test(line) && !SIGN_OFF.test(line) && !/\bhead office\b/i.test(line);

function companyFor(line: string, person: ReaderPerson): boolean {
  if (line.length > 60 || /@|www\.|https?:|\d{3,}/i.test(line)) return false;
  const label = lower(person.email).split("@")[1]?.split(".")[0] || "";
  const flat = line.toLowerCase().replace(/[^a-z0-9]/g, "");
  return COMPANY_WORD.test(line) || (label.length >= 3 && flat.includes(label.replace(/[^a-z0-9]/g, "")));
}

interface Block { lines: string[]; named: boolean; start: number }

/** The signature block that closes a message its writer is known for: from
 *  the line carrying their name, else from the sign-off. */
function signatureBlock(part: ThreadPart, person: ReaderPerson, others: ReaderPerson[]): Block | null {
  let lines = part.lines.map(l => l.trim());
  const cut = lines.findIndex(l => DISCLAIMER.some(re => re.test(l)));
  if (cut >= 0) lines = lines.slice(0, cut);
  let start = -1, named = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const head = lines[i].split(/\s[|–—-]\s|,\s|\s{2,}|\|/)[0].replace(POST_NOMINALS, "").trim();
    if (head && head.length <= 60 && !/\d|@/.test(head) && nameIsPerson(head, person)) { start = i; named = true; break; }
  }
  if (start < 0) {
    // The last sign-off, and only when what follows is short enough to be a
    // signature: "Thanks" opening a long message is not one.
    let off = -1;
    for (let i = lines.length - 1; i >= 0; i--) if (SIGN_OFF.test(lines[i])) { off = i; break; }
    if (off < 0 || lines.slice(off + 1).filter(Boolean).length > 12) return null;
    start = off + 1;
  }
  // The block ends where another message plainly starts: prose again, a
  // second sign-off, a header or quote line, or the name of somebody else on
  // the email standing on a line of its own. What follows is not this person's.
  const block: string[] = [];
  for (const line of lines.slice(start).filter(Boolean)) {
    if (block.length >= 14) break;
    if (block.length > 0 && (
      line.split(/\s+/).length >= 14 || SIGN_OFF.test(line) || NEXT_MESSAGE.test(line)
      || others.some(o => nameIsPerson(line.replace(POST_NOMINALS, "").split(/\s[|–—-]\s|,\s|\s{2,}|\|/)[0].trim(), o))
    )) break;
    block.push(line);
  }
  return block.length ? { lines: block, named, start } : null;
}

const NEXT_MESSAGE = /^(?:>|-{3,}|_{5,}|\*{0,2}(?:from|sent|to|cc|subject|date)\*{0,2}\s*:|begin forwarded message|on\s.+\bwrote:?$)/i;

const firstNameOf = (person: ReaderPerson) =>
  words(tidyName(String(person.name && !String(person.name).includes("@") ? person.name : "")))[0] || lower(person.email).split("@")[0].split(/[._-]+/)[0] || "";

/** What the rules read from the signature closing one message, and the block
 *  itself when something in it was left unread (for the model). The block
 *  must carry its writer's name: their full name on a line, or their first
 *  name alone straight after the sign-off. Otherwise nothing is read. */
export function readSignatureByRules(part: ThreadPart, person: ReaderPerson, others: ReaderPerson[] = []): { found: Found; unread: string | null } {
  const found = none();
  const block = signatureBlock(part, person, others.filter(o => lower(o.email) !== lower(person.email)));
  if (!block) return { found, unread: null };
  let rest = block.lines;
  let titleLine: string | null = null;
  if (block.named) {
    const [, ...after] = rest[0].split(/\s[|–—-]\s|,\s|\s{2,}|\|/);
    const sameLine = after.join(" ").replace(POST_NOMINALS, "").trim();
    if (sameLine && looksLikeTitle(sameLine)) titleLine = sameLine;
    rest = rest.slice(1);
  } else if (rest[0] && words(rest[0]).length === 1 && sameFirstName(words(rest[0])[0], firstNameOf(person))) {
    rest = rest.slice(1);                         // "Thanks,\nToby"
  } else {
    // A block that does not carry its writer's name cannot be tied to them
    // with certainty (a colleague signing on their behalf, a quoted message
    // whose header was not recognised): nothing is read from it.
    return { found, unread: null };
  }
  let odd = 0;
  for (let i = 0; i < rest.length; i++) {
    const line = rest[i];
    const before = `${found.phone}|${found.mobile}`;
    phonesIn(line, found);
    if (`${found.phone}|${found.mobile}` !== before) continue;
    if (ADDRESS.test(line) || /www\.|https?:/i.test(line)) continue;
    if (!titleLine && i <= 1 && looksLikeTitle(line)) { titleLine = line; continue; }
    if (!found.company && i <= 3 && companyFor(line, person)) { found.company = line; continue; }
    if (i <= 1) odd++;
  }
  found.title = titleLine ? titleLine.replace(/\s+/g, " ").trim() : null;
  // Something is still missing and the block holds what looks like it: worth one model read.
  const text = rest.join("\n");
  const numbers = (text.match(PHONE) || []).filter(plausiblePhone).length;
  const unread = (!found.title && (odd > 0 || TITLE_WORD.test(text))) || (!found.phone && !found.mobile && numbers > 0)
    ? block.lines.join("\n") : null;
  return { found, unread };
}

// ── The model, for a block the rules could not read ────────────────────────

const READER_SYSTEM = `You read email signature blocks for BGP, a UK property agency, so that its address book holds people's job titles and phone numbers. You are given the people on one email and, for some of them, the signature text that closes a message that person wrote.

Report only what a block itself says about the person it belongs to. Leave a field null when the block does not give it. A phone number that is a fax, a switchboard or reception line, or belongs to a different person named in the block, is not theirs. Copy each value exactly as it is written.

Reply with JSON only: an array with one object per person you found something for, each with these keys:
"email": the person's address, exactly as listed
"title": their job title, or null
"phone": their direct office number, or null
"mobile": their mobile number, or null
"company": the company the block names as theirs, or null`;

function parseModelReply(reply: string): any[] {
  const start = reply.indexOf("["), end = reply.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try { const parsed = JSON.parse(reply.slice(start, end + 1)); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

const flatText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** A model answer for one person, kept only where each value is in their own block. */
export function checkModelAnswer(item: any, blockText: string): Found {
  const found = none();
  const hay = flatText(blockText);
  const text = (v: unknown, max: number) => {
    const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
    return s && s.length <= max && hay.includes(flatText(s)) ? s : null;
  };
  const title = text(item?.title, 80);
  if (title && !/\d|@/.test(title)) found.title = title;
  const company = text(item?.company, 80);
  if (company && !/@/.test(company)) found.company = company;
  const lineDigits = blockText.split("\n").filter(l => !/\bfax\b/i.test(l)).map(digitsOf);
  const phone = (v: unknown) => {
    const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
    const d = digitsOf(s);
    return s && plausiblePhone(s) && lineDigits.some(l => l.includes(d)) ? s : null;
  };
  const p = phone(item?.phone), m = phone(item?.mobile);
  if (m) found.mobile = m;
  if (p && p !== m) { if (isUkMobile(digitsOf(p)) && !found.mobile) found.mobile = p; else if (!isUkMobile(digitsOf(p))) found.phone = p; }
  return found;
}

const USAGE_KEY = "contact_details_reader_usage";
const DEFAULT_DAILY_CAP = 300;

/** Model reads a day. CONTACT_DETAILS_READER_DAILY_CAP overrides it; 0 switches the model off (rules still run). */
export function contactReaderDailyCap(): number {
  const raw = process.env.CONTACT_DETAILS_READER_DAILY_CAP;
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

const memoryCount = { day: "", calls: 0 };
const londonDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

// Today's count is one row in system_settings, so a restart does not hand out
// a fresh allowance; kept in memory if that table cannot be reached.
async function claimModelRead(): Promise<boolean> {
  const cap = contactReaderDailyCap();
  if (cap <= 0) return false;
  const day = londonDay();
  try {
    const { pool } = await import("./db");
    const claimed = await pool.query(
      `INSERT INTO system_settings (key, value) VALUES ($1, jsonb_build_object('day', $2::text, 'calls', 1))
       ON CONFLICT (key) DO UPDATE SET updated_at = now(), value = CASE
           WHEN system_settings.value->>'day' = $2::text
           THEN jsonb_build_object('day', $2::text, 'calls', coalesce((system_settings.value->>'calls')::int, 0) + 1)
           ELSE jsonb_build_object('day', $2::text, 'calls', 1) END
       WHERE system_settings.value->>'day' IS DISTINCT FROM $2::text OR coalesce((system_settings.value->>'calls')::int, 0) < $3
       RETURNING value`, [USAGE_KEY, day, cap]);
    return claimed.rows.length > 0;
  } catch {
    if (memoryCount.day !== day) { memoryCount.day = day; memoryCount.calls = 0; }
    if (memoryCount.calls >= cap) return false;
    memoryCount.calls++;
    return true;
  }
}

const defaultDeps: ContactReaderDeps = {
  hasKey: () => !!(process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY),
  claim: claimModelRead,
  // The Anthropic client directly, never callClaude: that helper follows the firm-wide provider switch.
  async call(system, user) {
    const { getAnthropicClient, CHATBGP_HELPER_MODEL } = await import("./utils/anthropic-client");
    const response = await getAnthropicClient(true).messages.create({
      model: CHATBGP_HELPER_MODEL, max_tokens: 600, system, messages: [{ role: "user", content: user }],
    });
    const text = response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    return { text, model: response.model || CHATBGP_HELPER_MODEL, usage: response.usage };
  },
  log(model, usage) {
    console.log(`[contact-details] reader call: ${model}, ${usage?.input_tokens ?? "?"} tokens in, ${usage?.output_tokens ?? "?"} out`);
    import("./api-usage").then(m => m.logAiUsage({ provider: "anthropic", model, feature: "contact-details", usage })).catch(() => {});
  },
};

// ── The reader ─────────────────────────────────────────────────────────────

const merge = (into: Found, from: Found) => {
  into.title ||= from.title; into.phone ||= from.phone; into.mobile ||= from.mobile; into.company ||= from.company;
};
const hasAny = (f: Found) => !!(f.title || f.phone || f.mobile || f.company);

/**
 * Reads one email. Returns one entry per person something was found for; a
 * person with no signature of their own anywhere in the thread is left out.
 */
export async function readEmailContactDetails(input: ReadEmailInput, deps: ContactReaderDeps = defaultDeps): Promise<PersonDetails[]> {
  const people = input.people.filter(p => ADDRESS.test(String(p.email || ""))).map(p => ({ email: lower(p.email), name: p.name || null }));
  const wanted = new Set((input.wanted?.length ? input.wanted : people.map(p => p.email)).map(lower));
  const parts = splitThread(emailBodyText(input.body), input.from);

  const byPerson = new Map<string, { found: Found; where: "message" | "quoted"; how: "rules" | "model"; unread: string[] }>();
  for (const part of parts) {                       // newest first: the most recent signature wins
    const writer = writerOf(part, people);
    if (!writer || !wanted.has(writer.email)) continue;
    const read = readSignatureByRules(part, writer, people);
    const entry = byPerson.get(writer.email) || { found: none(), where: part.quoted ? "quoted" as const : "message" as const, how: "rules" as const, unread: [] };
    if (!hasAny(entry.found) && hasAny(read.found)) entry.where = part.quoted ? "quoted" : "message";
    merge(entry.found, read.found);
    if (read.unread) entry.unread.push(read.unread);
    byPerson.set(writer.email, entry);
  }

  const rulesOnly = new Set((input.rulesOnly || []).map(lower));
  const forModel = [...byPerson.entries()].filter(([email, e]) => !rulesOnly.has(email) && e.unread.length && (!e.found.title || (!e.found.phone && !e.found.mobile)));
  if (forModel.length && deps.hasKey()) {
    try {
      if (await deps.claim()) {
        input.onModel?.(forModel.map(([email]) => email));
        const listed = people.map(p => `- ${p.name ? `${p.name} ` : ""}<${p.email}>`).join("\n");
        const blocks = forModel.map(([email, e]) => {
          const p = people.find(x => x.email === email)!;
          return `[Signature text from a message written by ${p.name ? `${p.name} ` : ""}<${email}>]\n${e.unread.join("\n---\n").slice(0, 1500)}`;
        }).join("\n\n");
        const reply = await deps.call(READER_SYSTEM, `People on this email:\n${listed}\n\n${blocks}`);
        deps.log(reply.model, reply.usage);
        for (const item of parseModelReply(reply.text)) {
          const entry = byPerson.get(lower(item?.email));
          if (!entry || !entry.unread.length) continue;
          const checked = checkModelAnswer(item, entry.unread.join("\n"));
          const before = JSON.stringify(entry.found);
          const hadRules = hasAny(entry.found);
          merge(entry.found, checked);
          if (JSON.stringify(entry.found) !== before && !hadRules) entry.how = "model";
        }
      }
    } catch (e: any) {
      console.warn("[contact-details] reader call failed:", e?.message || e);
    }
  }

  const out: PersonDetails[] = [];
  for (const [email, e] of byPerson) {
    if (hasAny(e.found)) out.push({ email, ...e.found, where: e.where, how: e.how });
  }
  return out;
}
