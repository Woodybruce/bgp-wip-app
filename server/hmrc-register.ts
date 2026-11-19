// HMRC's Supervised Business Register (Woody, 19 November 2026: build the
// joint agent check BGP's AML policy needs). HMRC publishes it on GOV.UK as
// one spreadsheet (an ODS file, about 70,000 rows), replaced as it is
// updated, so its address changes: the GOV.UK content API names the current
// file. An ODS file is a zip holding one XML file (about 170 MB); it is read
// as a stream, a row at a time, and only the estate and letting agency rows
// are kept (reading it whole took 1.2 GB of memory). Loaded on demand, when
// someone checks an agent, and kept for seven days. The rules are
// shared/agent-aml.ts.

import { PassThrough, Readable } from "stream";
import { registerMatches, type RegisterEntry } from "@shared/agent-aml";

const CONTENT_API = process.env.HMRC_REGISTER_CONTENT_URL
  || "https://www.gov.uk/api/content/guidance/money-laundering-regulations-supervised-business-register";
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;

interface Loaded { entries: RegisterEntry[]; fileUrl: string; updatedAt: string | null; loadedAt: number; rows: number }
let cache: Loaded | null = null;
let loading: Promise<Loaded> | null = null;

/** The register's current file and when GOV.UK says the page was last updated. */
async function currentFile(): Promise<{ url: string; updatedAt: string | null }> {
  const res = await fetch(CONTENT_API, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GOV.UK answered ${res.status} for the register's page`);
  const page: any = await res.json();
  const attachments: any[] = Array.isArray(page?.details?.attachments) ? page.details.attachments : [];
  const pick = attachments.find(a => /\.ods($|\?)/i.test(String(a?.url || ""))) || attachments.find(a => /\.csv($|\?)/i.test(String(a?.url || "")));
  const body = String(page?.details?.body || "");
  const url = pick?.url || (body.match(/https:\/\/assets\.publishing\.service\.gov\.uk[^"\s<]+\.(?:ods|csv)/i) || [])[0];
  if (!url) throw new Error("GOV.UK's page names no register file");
  return { url: String(url), updatedAt: page?.public_updated_at || null };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e.toLowerCase()] ?? m));

/** A cell's text: its paragraphs, with ODS's space and tab marks read. */
function cellText(inner: string): string {
  const paras = inner.match(/<text:p\b[^>]*>[\s\S]*?<\/text:p>|<text:p\b[^>]*\/>/g) || [];
  return paras.map(p => decode(p
    .replace(/<text:s\b[^>]*?text:c="(\d+)"[^>]*\/>/g, (_m, n) => " ".repeat(Math.min(Number(n) || 1, 50)))
    .replace(/<text:s\b[^>]*\/>/g, " ")
    .replace(/<text:tab\b[^>]*\/>/g, " ")
    .replace(/<text:line-break\b[^>]*\/>/g, " ")
    .replace(/<[^>]+>/g, ""))).join(" ").replace(/\s+/g, " ").trim();
}

/** One row's cells, the repeated empty runs expanded up to `width`. */
export function odsRowCells(row: string, width: number): string[] {
  const cells: string[] = [];
  const re = /<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(row)) && cells.length < width) {
    const repeat = Math.max(1, Math.min(Number((/table:number-columns-repeated="(\d+)"/.exec(m[1]) || [])[1]) || 1, width));
    const text = m[2] ? cellText(m[2]) : "";
    for (let i = 0; i < repeat && cells.length < width; i++) cells.push(text);
  }
  return cells;
}

const yes = (v: string | undefined) => /^yes$/i.test(String(v || "").trim());

/**
 * The estate and letting agency rows of the register's content.xml, read from
 * a stream of its text. The header row names the columns.
 */
export async function readRegisterRows(text: AsyncIterable<string>): Promise<{ entries: RegisterEntry[]; rows: number }> {
  let buffer = "";
  let header: string[] | null = null;
  let col: Record<string, number> = {};
  let rows = 0;
  const entries: RegisterEntry[] = [];
  const WIDTH = 40;
  const take = (row: string) => {
    const cells = odsRowCells(row, WIDTH);
    if (!cells.some(Boolean)) return;
    if (!header) {
      header = cells.map(c => c.trim());
      col = Object.fromEntries(header.map((h, i) => [h.toLowerCase(), i]));
      return;
    }
    rows++;
    const at = (name: string) => cells[col[name] ?? -1] || "";
    const estateAgency = yes(at("estate agency business"));
    const lettingAgency = yes(at("letting agency businesses"));
    if (!estateAgency && !lettingAgency) return;
    const number = at("mlr registration number").trim();
    if (!number) return;
    const since = at("agent start date") || at("business start date");
    entries.push({
      number,
      businessName: at("business name").trim(),
      tradingName: at("trading name").trim(),
      postcode: at("postcode").trim(),
      status: at("status").trim(),
      estateAgency,
      lettingAgency,
      since: since && !/no data/i.test(since) ? since : null,
    });
  };
  for await (const chunk of text) {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf("</table:table-row>")) >= 0) {
      const start = buffer.lastIndexOf("<table:table-row", end);
      if (start >= 0) take(buffer.slice(start, end));
      buffer = buffer.slice(end + "</table:table-row>".length);
    }
    // A self-closing empty row, or text between rows, is never kept whole.
    if (buffer.length > 4_000_000) buffer = buffer.slice(-1_000_000);
  }
  if (!header) throw new Error("The register file has no header row");
  return { entries, rows };
}

/** content.xml's text from an ODS file's bytes, as a stream Node can iterate (unzipper's own cannot be). */
export function odsContentText(bytes: NodeJS.ReadableStream, unzipper: any): AsyncIterable<string> {
  const text = new PassThrough();
  text.setEncoding("utf8");
  const entry = bytes.pipe(unzipper.ParseOne(/^content\.xml$/));
  entry.on("error", (e: Error) => text.destroy(e));
  bytes.on("error", (e: Error) => text.destroy(e));
  entry.pipe(text);
  return text as AsyncIterable<string>;
}

async function download(): Promise<Loaded> {
  const { url, updatedAt } = await currentFile();
  if (!/\.ods($|\?)/i.test(url)) throw new Error("The register is no longer published as an ODS file: the reader needs updating");
  const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`The register file answered ${res.status}`);
  const unzipper: any = (await import("unzipper")).default || (await import("unzipper"));
  const { entries, rows } = await readRegisterRows(odsContentText(Readable.fromWeb(res.body as any), unzipper));
  console.log(`[hmrc-register] ${rows} rows read, ${entries.length} estate or letting agency rows kept (${url})`);
  return { entries, fileUrl: url, updatedAt, loadedAt: Date.now(), rows };
}

/** The register, read at most once a week (a failed read is tried again next time). */
export async function loadHmrcRegister(): Promise<Loaded> {
  if (cache && Date.now() - cache.loadedAt < CACHE_MS) return cache;
  if (!loading) {
    loading = download()
      .then(loaded => { cache = loaded; return loaded; })
      .finally(() => { loading = null; });
  }
  return loading;
}

export function hmrcRegisterState(): { loaded: boolean; loading: boolean; updatedAt: string | null; loadedAt: string | null; fileUrl: string | null } {
  return { loaded: !!cache, loading: !!loading, updatedAt: cache?.updatedAt || null, loadedAt: cache ? new Date(cache.loadedAt).toISOString() : null, fileUrl: cache?.fileUrl || null };
}

/** Entries on the register for a firm's name (shared/agent-aml.ts registerMatches). */
export async function searchHmrcRegister(name: string): Promise<{ exact: RegisterEntry[]; near: RegisterEntry[]; updatedAt: string | null; fileUrl: string }> {
  const reg = await loadHmrcRegister();
  return { ...registerMatches(name, reg.entries), updatedAt: reg.updatedAt, fileUrl: reg.fileUrl };
}
