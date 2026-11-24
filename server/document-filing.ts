// The documents the app makes are filed into their record's Folders on the
// app's own Microsoft 365 token (Woody, 24 November 2026: "go ahead with the
// folder suggestion"; docs/folders-review-2026-11-20.md, 4.4: a person's own
// token for their folder actions, the app's for its own work). The engine
// (server/folders/) never takes a token itself: this file hands it the app's,
// for filing only. A person's own actions in Folders never come through here.
import type { FolderRecordType } from "@shared/folders";
import type { FilingDocument, FilingResult } from "./folders/filing";

/** A document the app made, into its record's folder (server/folders/filing.ts). Never throws. */
export async function fileAppDocument(doc: FilingDocument): Promise<FilingResult> {
  const [{ pool }, { getAppGraphToken }, { fileRecordDocument }] = await Promise.all([import("./db"), import("./microsoft"), import("./folders/filing")]);
  return fileRecordDocument(pool, getAppGraphToken, doc);
}

/** Before a document is made: the words to show when it will not be filed (no folder linked), else null. Reads the app's database only. */
export async function appFilingNote(record: { type: FolderRecordType; id: string }): Promise<string | null> {
  const [{ pool }, { filingPlace }] = await Promise.all([import("./db"), import("./folders/filing")]);
  const place = await filingPlace(pool, record).catch(() => null);
  return place && !place.link ? place.note : null;
}
