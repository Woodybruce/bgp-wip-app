// The Charity Commission for England and Wales's register of charities, read
// from its public download (Woody, 21 November 2026: "We need screening on
// GLEIF and foundations in the uk"). The Commission publishes the whole
// register once a day as zipped JSON, one charity (or trustee, or other name)
// a line: no key, no account. Its API needs a subscription key; the download
// does not, and holds the trustees.
//
// The three files (about 86 MB zipped) are downloaded on the first look-up of
// a day, kept on this machine's disk, and read as a stream for each look-up:
// about eight seconds, little memory. Nothing is loaded at boot or on a timer.
// CHARITY_REGISTER=off stops it; CHARITY_REGISTER_URL moves the download.
// Never throws: a look-up that could not be made says why.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  charityLookedFor, charityMatches, charityNameKey, charityOtherNameFrom, charityRecordFrom, charityTrusteeFrom, pickCharity,
  type CharityQuery, type CharityRecord, type CharityTrustee, type PrecheckCharity,
} from "@shared/charity-register";

const BASE = () => (process.env.CHARITY_REGISTER_URL || "https://ccewuksprdoneregsadata1.blob.core.windows.net/data/json").replace(/\/+$/, "");
export const CHARITY_FILES = { charity: "publicextract.charity.zip", trustee: "publicextract.charity_trustee.zip", other: "publicextract.charity_other_names.zip" } as const;
export type CharityFileKey = keyof typeof CHARITY_FILES;
const DIR = () => process.env.CHARITY_REGISTER_DIR || path.join(os.tmpdir(), "bgp-charity-register");
const FRESH_MS = 24 * 3600_000;
// A copy up to a week old is still used when the day's download fails.
const STALE_MS = 7 * 24 * 3600_000;
const RETRY_MS = 10 * 60_000;
const MAX_TRUSTEES = 60;

export const charityRegisterOn = (): boolean => String(process.env.CHARITY_REGISTER || "").trim().toLowerCase() !== "off";

export interface CharityLookupDeps {
  // The three files, already on disk (tests).
  files?: Record<CharityFileKey, string>;
  fetcher?: typeof fetch;
}

async function age(file: string): Promise<number | null> {
  try {
    const s = await fs.promises.stat(file);
    return s.size > 100 ? Date.now() - s.mtimeMs : null;
  } catch {
    return null;
  }
}

async function download(key: CharityFileKey, fetcher: typeof fetch): Promise<string> {
  const target = path.join(DIR(), CHARITY_FILES[key]);
  const was = await age(target);
  if (was != null && was < FRESH_MS) return target;
  const tmp = `${target}.${process.pid}.${Date.now()}.part`;
  try {
    const res = await fetcher(`${BASE()}/${CHARITY_FILES[key]}`, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok || !res.body) throw new Error(`the Charity Commission's download answered ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmp));
    await fs.promises.rename(tmp, target);
    return target;
  } catch (e) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    if (was != null && was < STALE_MS) return target;
    throw e;
  }
}

let downloading: Promise<Record<CharityFileKey, string>> | null = null;
let failedAt = 0;
let failedWhy = "";

/** The three files on disk, downloaded at most once a day, one download at a time. */
export async function charityRegisterFiles(deps: CharityLookupDeps = {}): Promise<Record<CharityFileKey, string>> {
  if (deps.files) return deps.files;
  if (failedAt && Date.now() - failedAt < RETRY_MS) throw new Error(failedWhy);
  if (!downloading) {
    downloading = (async () => {
      await fs.promises.mkdir(DIR(), { recursive: true });
      const out = {} as Record<CharityFileKey, string>;
      for (const key of Object.keys(CHARITY_FILES) as CharityFileKey[]) out[key] = await download(key, deps.fetcher || fetch);
      return out;
    })().then(files => { failedAt = 0; return files; }, (e: any) => {
      failedAt = Date.now();
      failedWhy = e?.name === "TimeoutError" ? "the Charity Commission's download did not finish in time" : String(e?.message || e).slice(0, 200);
      throw new Error(failedWhy);
    }).finally(() => { downloading = null; });
  }
  return downloading;
}

/**
 * Each line of the zipped file as an object. `keep` looks at the raw line
 * first, so most lines of the trustee file are never parsed.
 */
export async function eachRegisterLine(file: string, onObject: (o: any) => void, keep?: (line: string) => boolean): Promise<{ extractDate: string | null }> {
  const { default: unzipper } = await import("unzipper");
  const dir = await unzipper.Open.file(file);
  const entry = dir.files.find(f => f.type === "File" && /\.json$/i.test(f.path)) || dir.files.find(f => f.type === "File");
  if (!entry) throw new Error("the register's download was empty");
  const stream = entry.stream();
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let first = true;
  let extractDate: string | null = null;
  for await (const raw of lines) {
    let l = raw;
    if (first) { l = l.replace(/^﻿/, ""); first = false; }
    l = l.trim().replace(/^\[/, "").replace(/^,/, "").replace(/\]$/, "").trim();
    if (!l || (keep && !keep(l))) continue;
    let o: any;
    try { o = JSON.parse(l); } catch { continue; }
    if (!extractDate && o?.date_of_extract) extractDate = String(o.date_of_extract).slice(0, 10);
    onObject(o);
  }
  return { extractDate };
}

const ORG = /"organisation_number":\s*(\d+)/;
const ORGANISATION_TRUSTEE = /"individual_or_organisation":\s*"O"/;

/**
 * Looks each query up on the register: one read of each file for them all.
 * A query's names are also looked for among the organisations the register
 * lists as trustees (THE WELLCOME TRUST LIMITED is the trustee of the WELLCOME
 * TRUST). Returns a result per query, in order. Never throws.
 */
export async function lookupCharities(queries: Array<CharityQuery & { from?: string | null }>, deps: CharityLookupDeps = {}): Promise<PrecheckCharity[]> {
  const blank = (q: CharityQuery & { from?: string | null }, status: PrecheckCharity["status"], error: string | null): PrecheckCharity =>
    ({ status, lookedFor: charityLookedFor(q, q.from || null), via: null, candidates: 0, error, charity: null, otherNames: [], trustees: [], extractDate: null });
  if (!queries.length) return [];
  if (!charityRegisterOn() && !deps.files) return queries.map(q => blank(q, "skipped", "look-ups on the Charity Commission's register are switched off"));
  let files: Record<CharityFileKey, string>;
  try {
    files = await charityRegisterFiles(deps);
  } catch (e: any) {
    return queries.map(q => blank(q, "error", String(e?.message || e).slice(0, 200)));
  }
  try {
    const keysOf = (q: CharityQuery) => [...new Set((q.names || []).map(charityNameKey).filter(Boolean))];
    const keys = new Set(queries.flatMap(keysOf));
    // A working or previous name, and an organisation that is a trustee: the
    // charities each belongs to, by the name's key.
    const orgsByKey = new Map<string, Set<number>>();
    const trusteeOrgsByKey = new Map<string, Set<number>>();
    const note = (map: Map<string, Set<number>>, key: string, org: number) => {
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(org);
    };
    if (keys.size) {
      await Promise.all([
        eachRegisterLine(files.other, o => {
          const n = charityOtherNameFrom(o);
          const key = n && charityNameKey(n.name);
          if (n && key && keys.has(key)) note(orgsByKey, key, n.organisationNumber);
        }),
        eachRegisterLine(files.trustee, o => {
          const t = charityTrusteeFrom(o);
          const key = t?.trustee.organisation ? charityNameKey(t.trustee.name) : "";
          if (t && key && keys.has(key)) note(trusteeOrgsByKey, key, t.organisationNumber);
        }, line => ORGANISATION_TRUSTEE.test(line)),
      ]);
    }
    const otherOrgs = queries.map(q => new Set(keysOf(q).flatMap(k => [...(orgsByKey.get(k) || [])])));
    const trusteeOrgs = queries.map(q => new Set(keysOf(q).flatMap(k => [...(trusteeOrgsByKey.get(k) || [])])));
    const found: CharityRecord[][] = queries.map(() => []);
    const trusteed: CharityRecord[][] = queries.map(() => []);
    const { extractDate } = await eachRegisterLine(files.charity, o => {
      const rec = charityRecordFrom(o);
      if (!rec) return;
      queries.forEach((q, i) => {
        if (charityMatches(rec, q, otherOrgs[i])) found[i].push(rec);
        if (rec.linked === 0 && trusteeOrgs[i].has(rec.organisationNumber)) trusteed[i].push(rec);
      });
    });
    const picks = queries.map((q, i) => pickCharity(q, found[i], otherOrgs[i], trusteed[i]));
    const wanted = new Set(picks.map(p => p.pick?.organisationNumber).filter((n): n is number => !!n));
    const trustees = new Map<number, CharityTrustee[]>();
    const otherNames = new Map<number, string[]>();
    if (wanted.size) {
      const mine = (line: string) => { const m = ORG.exec(line); return !!m && wanted.has(Number(m[1])); };
      await Promise.all([
        eachRegisterLine(files.trustee, o => {
          const t = charityTrusteeFrom(o);
          if (!t || !wanted.has(t.organisationNumber)) return;
          const list = trustees.get(t.organisationNumber) || [];
          if (list.length < MAX_TRUSTEES && !list.some(x => x.name === t.trustee.name)) list.push(t.trustee);
          trustees.set(t.organisationNumber, list);
        }, mine),
        eachRegisterLine(files.other, o => {
          const n = charityOtherNameFrom(o);
          if (!n || !wanted.has(n.organisationNumber)) return;
          const list = otherNames.get(n.organisationNumber) || [];
          if (!list.includes(n.name)) list.push(n.name);
          otherNames.set(n.organisationNumber, list);
        }, mine),
      ]);
    }
    return queries.map((q, i) => {
      const p = picks[i];
      const trusteeOf = trusteed[i].map(r => ({ name: r.name, number: r.number, organisationNumber: r.organisationNumber, status: r.status }));
      const base = { ...blank(q, p.status, null), extractDate, ...(trusteeOf.length ? { trusteeOf } : {}) };
      if (!p.pick) return { ...base, via: p.via, candidates: p.candidates };
      const org = p.pick.organisationNumber;
      return {
        ...base, via: p.via, candidates: 1, charity: p.pick,
        trustees: trustees.get(org) || [],
        otherNames: (otherNames.get(org) || []).filter(n => charityNameKey(n) !== charityNameKey(p.pick!.name)),
      };
    });
  } catch (e: any) {
    return queries.map(q => blank(q, "error", `the register's download could not be read (${String(e?.message || e).slice(0, 160)})`));
  }
}
