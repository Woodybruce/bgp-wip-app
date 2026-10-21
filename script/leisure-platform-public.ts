// Writes the public Leisure Platform page to a file so it can be published
// outside the app (e.g. as a claude.ai artifact). Usage:
//   npx tsx script/leisure-platform-public.ts <out.html> [dataRoomBaseUrl]
import fs from "fs";
import { renderLeisurePlatformPage } from "../server/leisure-platform-public";

const out = process.argv[2] || "leisure-platform.html";
const base = process.argv[3] || null;
fs.writeFileSync(out, renderLeisurePlatformPage({ dataRoomBase: base, fullDocument: false }));
console.log(`wrote ${out}`);
