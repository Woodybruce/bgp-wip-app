// What the app can show of a stored file in its pop-out viewer (Woody,
// 23 November 2026: "on the files can the app show the files so can check them
// at any point rather than having to download a zip just a thumbnail can clikc
// and it pops out?"). The viewer is client/src/components/file-popout.tsx.
//
// image: drawn in the page (a HEIC or TIFF photo is tried and, where the
//   browser cannot draw it, falls back to a tile with a download);
// pdf: every page drawn by pdf.js, on a phone too;
// text: shown as text;
// office: Word, Excel, PowerPoint and Outlook files: no preview, download;
// other: no preview, download.
export type FilePreviewKind = "image" | "pdf" | "text" | "office" | "other";

export interface FilePreviewInput { name?: string | null; mime?: string | null; url?: string | null }

const IMAGE_EXT = /\.(png|jpe?g|jfif|gif|webp|avif|bmp|heic|heif|tiff?)$/i;
const TEXT_EXT = /\.(txt|csv|json|md|log)$/i;
const OFFICE_EXT = /\.(docx?|xlsx?|xlsm|pptx?|odt|ods|odp|rtf|msg|eml)$/i;

const extOf = (value: string | null | undefined): string => {
  const path = String(value || "").split(/[?#]/)[0];
  const m = /\.([a-z0-9]{1,5})$/i.exec(path);
  return m ? `.${m[1].toLowerCase()}` : "";
};

function kindFromMime(mime: string): FilePreviewKind | null {
  const type = mime.split(";")[0].trim().toLowerCase();
  if (!type || type === "application/octet-stream") return null;
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/") && type !== "image/svg+xml") return "image";
  if (type.startsWith("text/") && type !== "text/html" || type === "application/json") return "text";
  if (/(msword|officedocument|ms-excel|ms-powerpoint|opendocument|rtf|outlook|message\/rfc822)/.test(type)) return "office";
  return null;
}

function kindFromExt(ext: string): FilePreviewKind | null {
  if (!ext) return null;
  if (ext === ".pdf") return "pdf";
  if (IMAGE_EXT.test(ext)) return "image";
  if (TEXT_EXT.test(ext)) return "text";
  if (OFFICE_EXT.test(ext)) return "office";
  return null;
}

/**
 * How a file is shown: by its stored type, else the extension of its name,
 * else of its address. An SVG or HTML file is never drawn (it could run).
 */
export function filePreviewKind(file: FilePreviewInput): FilePreviewKind {
  if (/\.(svg|html?|xml|xhtml)$/i.test(extOf(file.name)) || /^(image\/svg|text\/html|application\/xhtml|text\/xml|application\/xml)/i.test(String(file.mime || ""))) return "other";
  return (file.mime ? kindFromMime(file.mime) : null)
    ?? kindFromExt(extOf(file.name))
    ?? kindFromExt(extOf(file.url))
    ?? "other";
}

/** The file's extension in capitals for a tile ("PDF", "DOCX"), or null. */
export function fileBadge(file: FilePreviewInput): string | null {
  const ext = extOf(file.name) || extOf(file.url);
  return ext ? ext.slice(1).toUpperCase() : null;
}

/**
 * Whether the app may fetch the file itself to show it: an address on this
 * app ("/api/...", "/uploads/..."), never another site's or a protocol-relative
 * one. Anything else opens in a new tab.
 */
export function inAppFileUrl(url: string | null | undefined): boolean {
  const value = String(url || "");
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}
