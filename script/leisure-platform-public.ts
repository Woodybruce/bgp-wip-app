// Writes the public Leisure Platform page to a file so it can be published
// outside the app (e.g. as a claude.ai artifact). Usage:
//   npx tsx script/leisure-platform-public.ts <out.html> [dataRoomBaseUrl] [full]
// "full" writes a complete HTML document (for client/public/share/...);
// without it the file is the artifact body only.
import fs from "fs";
import { renderLeisurePlatformPage } from "../server/leisure-platform-public";

const out = process.argv[2] || "leisure-platform.html";
const base = process.argv[3] || null;
const full = process.argv[4] === "full";
fs.writeFileSync(out, renderLeisurePlatformPage({ dataRoomBase: base, fullDocument: full }));
console.log(`wrote ${out}`);
