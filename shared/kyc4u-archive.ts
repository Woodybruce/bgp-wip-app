// Every file on KYC4U's site, kept in the app (Woody, 21 November 2026: "yes
// build it so we keep all documents in the app"). The Send to ChatBGP
// bookmark lists the files in KYC4U's Documents library with the user's own
// login and hands each one to the app's window, which keeps it
// (server/kyc4u-archive.ts). A file in a request folder ("REQ112444 LEGO
// Company Limited") is also filed on the KYC record of the company that
// request is matched to; the rest are kept for matching later. These are the
// rules both ends share.

import { kyc4uPackPlace, type Kyc4uPackPlace } from "./kyc4u-result-pack";

/** The largest file the app keeps; a larger one is listed for downloading by hand. */
export const KYC4U_ARCHIVE_MAX_BYTES = 25 * 1024 * 1024;
/** Files copied at once by the bookmark's window. */
export const KYC4U_ARCHIVE_PARALLEL = 3;
/** The most files one listing may send. */
export const KYC4U_ARCHIVE_LIST_MAX = 30000;

const KYC4U_ORIGIN = "https://kyc4ultd.sharepoint.com";
// The folder KYC4U keeps a request in: "REQ112444 LEGO Company Limited".
const REQ_FOLDER = /^(REQ\d+)[\s_-]*(.*)$/i;

export interface Kyc4uListedFile {
  uniqueId?: string | null;
  path: string;              // the file's place on KYC4U's site ("/sites/customers/CST1092/Shared Documents/REQ…/1.0 HOTs/x.docx")
  name?: string | null;
  web?: string | null;       // the site it was listed from
  modified?: string | null;
  created?: string | null;
  size?: number | null;
}

export interface Kyc4uArchiveFacts {
  reqRef: string | null;     // "REQ112444", or null for a file outside a request folder
  entity: string | null;     // the name on the request folder
  relPath: string;           // its place inside the request folder
  place: Kyc4uPackPlace;     // the heading and document type it is filed under
}

/** Where a file sits: its request folder, and its place inside it. */
export function archiveFileFacts(path: string): Kyc4uArchiveFacts {
  const parts = String(path || "").split("/").map(p => p.trim()).filter(Boolean);
  const name = parts[parts.length - 1] || "file";
  // The request folder, not a file whose own name starts REQ.
  const at = parts.slice(0, -1).findIndex(p => REQ_FOLDER.test(p));
  if (at < 0) return { reqRef: null, entity: null, relPath: name, place: { ...kyc4uPackPlace(name), heading: "Not in a request folder" } };
  const [, ref, rest] = parts[at].match(REQ_FOLDER)!;
  // Some requests hold a folder named just the REQ number: look past it.
  const inner = parts.slice(at + 1).filter((p, i, all) => i === all.length - 1 || !/^REQ\d+$/i.test(p));
  const relPath = inner.join("/");
  return { reqRef: ref.toUpperCase(), entity: rest.replace(/\s+/g, " ").trim() || null, relPath, place: kyc4uPackPlace(relPath) };
}

const iso = (v: unknown): string => {
  const d = v ? new Date(String(v)) : null;
  return d && !isNaN(d.getTime()) ? d.toISOString() : "";
};

/**
 * The one key for a file version: its SharePoint id when the listing gave it,
 * else its place, with the time it was last changed. A file changed on
 * KYC4U's site is a new version and is kept as well as the earlier one.
 */
export function archiveKey(f: Pick<Kyc4uListedFile, "uniqueId" | "path" | "modified">): string {
  const id = String(f.uniqueId || "").replace(/[{}]/g, "").trim().toLowerCase();
  const base = /^[0-9a-f-]{32,36}$/.test(id) ? `uid:${id}` : `path:${String(f.path || "").trim()}`;
  return `${base}|${iso(f.modified)}`.slice(0, 900);
}

/** The site a file was listed from must be KYC4U's own; the path must sit on it. */
export function listedFileProblem(f: Kyc4uListedFile): string | null {
  const path = String(f?.path || "");
  if (!path.startsWith("/") || path.length > 1000 || /[\u0000-\u001f]/.test(path)) return "no file path";
  const web = String(f?.web || "");
  if (web) {
    let u: URL;
    try { u = new URL(web); } catch { return "not KYC4U's site"; }
    if (u.origin !== KYC4U_ORIGIN) return "not KYC4U's site";
    if (!path.startsWith(u.pathname.replace(/\/+$/, "") + "/")) return "not on the site it was listed from";
  }
  return null;
}

export interface Kyc4uArchiveTotals {
  listed: number;      // every file version the bookmark has listed
  copied: number;
  toGo: number;        // listed, not yet copied (failed ones included: they are tried again)
  tooLarge: number;
  failed: number;
  filed: number;       // copied and on a company's KYC record
  notMatched: number;  // copied, in a request folder no company is matched to yet
  noRequest: number;   // copied, outside any request folder
  bytes: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/** One line for the KYC4U page: how much of KYC4U's site is in the app. */
export function archiveSummaryWords(t: Kyc4uArchiveTotals): string {
  if (!t.listed) return "No KYC4U files in the app yet: click the Send to ChatBGP bookmark on KYC4U's site to copy them.";
  const parts = [`${plural(t.copied, "file")} of ${t.listed.toLocaleString("en-GB")} kept in the app`];
  if (t.toGo) parts.push(`${t.toGo.toLocaleString("en-GB")} still to copy`);
  parts.push(`${t.filed.toLocaleString("en-GB")} filed on companies`);
  if (t.notMatched) parts.push(`${t.notMatched.toLocaleString("en-GB")} in request folders not matched to a company yet`);
  if (t.noRequest) parts.push(`${t.noRequest.toLocaleString("en-GB")} outside a request folder`);
  if (t.tooLarge) parts.push(`${plural(t.tooLarge, "file")} too large to copy`);
  if (t.failed) parts.push(`${t.failed.toLocaleString("en-GB")} failed last time and will be tried again`);
  return parts.join(" · ");
}
