// Shared rules for files attached to a chat (the ChatBGP side panel and the
// full ChatBGP page both use these — they used to disagree, which is how a
// 100 MB+ OneDrive zip got attached on one surface and rejected outright on
// the other).

export const ACCEPTED_EXTENSIONS = [
  ".docx", ".pdf", ".doc", ".txt", ".xlsx", ".xls", ".csv",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".heic",
  ".mp3", ".mp4", ".m4a", ".wav", ".webm", ".ogg", ".aac", ".mov", ".avi", ".mkv", ".flac",
  ".eml", ".msg", ".zip",
];

// Matches the server's per-request file cap (chat-with-files / chat upload).
export const MAX_CHAT_FILES = 30;

// Zip entries arrive as raw bytes with no type, so a File rebuilt from one
// needs its mime set from the extension or the server can't tell a plan from
// a spreadsheet.
const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".mov": "video/quicktime",
  ".eml": "message/rfc822",
  ".msg": "application/vnd.ms-outlook",
};

export function isAcceptedChatFile(file: File): boolean {
  if (file.type?.startsWith("image/")) return true;
  const ext = "." + (file.name.split(".").pop()?.toLowerCase() || "");
  return ACCEPTED_EXTENSIONS.includes(ext);
}

export function isZip(file: File): boolean {
  return file.name.toLowerCase().endsWith(".zip");
}

// Unpack a ZIP in the browser and return its readable contents as individual
// Files. A OneDrive "download folder" archive of unit plans blows past the
// 100 MB per-file upload limit as one zip, but each plan inside is a few MB —
// and attaching them separately also means PDFs and images get read with
// vision rather than as text buried in an archive.
export async function expandZip(zipFile: File): Promise<{ files: File[]; skipped: number }> {
  const { unzip } = await import("fflate");
  const buf = new Uint8Array(await zipFile.arrayBuffer());
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(buf, (err, data) => (err ? reject(err) : resolve(data)));
  });
  const files: File[] = [];
  let skipped = 0;
  for (const [path, bytes] of Object.entries(entries)) {
    const base = path.split("/").pop() || "";
    if (!base || path.endsWith("/") || bytes.length === 0) continue;
    if (path.startsWith("__MACOSX") || base.startsWith(".")) continue;
    const ext = "." + (base.split(".").pop()?.toLowerCase() || "");
    // Nested archives aren't recursed — one level is what a plans pack needs.
    if (!ACCEPTED_EXTENSIONS.includes(ext) || ext === ".zip") { skipped++; continue; }
    files.push(new File([new Uint8Array(bytes)], base, { type: MIME_BY_EXT[ext] || "application/octet-stream" }));
  }
  return { files, skipped };
}

export type AttachNotice = { title: string; description?: string; error?: boolean };

// Turn a raw drop/pick into the files to attach: zips expanded, unsupported
// formats dropped, plus the notices to toast.
export async function prepareChatFiles(
  incoming: File[],
  opts: { validateTypes?: boolean } = {},
): Promise<{ files: File[]; notices: AttachNotice[] }> {
  const notices: AttachNotice[] = [];
  const zips = incoming.filter(isZip);
  const rest = incoming.filter(f => !isZip(f));
  const kept = opts.validateTypes === false ? rest : rest.filter(isAcceptedChatFile);
  if (kept.length !== rest.length) {
    notices.push({
      title: "Some files skipped",
      description: "Only Word, PDF, Excel, CSV, text, image, audio, video, and ZIP files are supported",
      error: true,
    });
  }

  const fromZips: File[] = [];
  for (const z of zips) {
    try {
      const { files, skipped } = await expandZip(z);
      if (files.length === 0) {
        notices.push({
          title: "Nothing readable in that ZIP",
          description: skipped > 0 ? `${skipped} file(s) inside are in formats ChatBGP can't read.` : "The archive is empty.",
          error: true,
        });
        continue;
      }
      fromZips.push(...files);
      notices.push({
        title: `Unpacked ${files.length} file${files.length !== 1 ? "s" : ""}`,
        description: `From ${z.name}${skipped > 0 ? ` · ${skipped} unreadable file(s) left out` : ""}`,
      });
    } catch (err: any) {
      notices.push({
        title: `Couldn't open ${z.name}`,
        description: err?.message || "The archive may be corrupt or password-protected.",
        error: true,
      });
    }
  }

  return { files: [...kept, ...fromZips], notices };
}
