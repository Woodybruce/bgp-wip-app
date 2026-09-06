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
