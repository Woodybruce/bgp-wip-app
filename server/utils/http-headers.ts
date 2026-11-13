// Node's HTTP writer rejects any character outside Latin-1 in header
// values with ERR_HTTP_INVALID_HEADER_VALUE. Filenames pulled from the
// database or generated from free-text titles routinely contain em
// dashes, smart quotes, accents, £, etc — all of which crash the
// download with a 500 if dropped into Content-Disposition directly.
//
// RFC 5987 solves it: an ASCII-only `filename="..."` for old clients,
// plus a UTF-8 percent-encoded `filename*=UTF-8''...` for modern ones.
// Every browser since 2014 prefers the starred form.

export function contentDispositionFor(
  name: string,
  disposition: "attachment" | "inline" = "attachment"
): string {
  const safe = (name || "download").trim();
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const utf8 = encodeURIComponent(safe);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// Whether an uploaded file may be shown in the browser at the app's own
// address. Anyone who can upload chooses the file and its stated type, so
// only types a browser cannot run a script from are shown in place: plain
// raster images, video, audio and plain text. Everything else (HTML, SVG,
// XML, an unknown or missing type) is a download. Callers also send
// X-Content-Type-Options: nosniff, so a stated "image/png" is never read
// as a page.
const INLINE_MEDIA = /^(image\/(png|jpe?g|gif|webp|avif|bmp|heic|heif|tiff)|video\/(mp4|webm|quicktime|ogg)|audio\/[a-z0-9.+-]+|text\/plain)$/;
export function uploadShownInline(contentType: string | null | undefined): boolean {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  return INLINE_MEDIA.test(type);
}
const INLINE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|heic|heif|tiff?|mp4|webm|mov|mp3|m4a|wav|ogg|txt)$/i;
export const uploadNameShownInline = (name: string | null | undefined): boolean => INLINE_EXT.test(String(name || ""));
