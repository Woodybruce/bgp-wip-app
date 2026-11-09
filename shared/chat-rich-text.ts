import { Marked, type Token, type Tokens } from "marked";
import { decodeHTML } from "entities";

/** One GFM token tree for chat, email clipboard and document exports.
 * Marked only tokenises here. Its HTML renderer is deliberately never used.
 */
export type RichTextToken = Token;

const parser = new Marked({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: "bgp_tag", level: "inline",
      start: (src) => src.indexOf("@["),
      tokenizer(src) {
        const match = /^@\[([^\]]+)\]\(tag:(user|company|property|deal|unit|contact|folder)\/([^)\s]+)\)/.exec(src);
        if (match) return { type: "bgp_tag", raw: match[0], name: match[1], text: match[1], tagType: match[2], id: match[3] };
      },
    },
    {
      name: "bgp_download", level: "inline",
      start: (src) => src.indexOf("/api/lr-bg/register/"),
      tokenizer(src) {
        const match = /^\/api\/lr-bg\/register\/[A-Za-z]{0,3}\d{1,8}(?:[?#][^\s<>"']*)?(?=$|[\s.,;!?])/.exec(src);
        if (match) return { type: "bgp_download", raw: match[0], href: match[0], text: "Download official register" };
      },
    },
    {
      // Saved replies sometimes wrap BETWEEN the label and destination.
      // Re-tokenise just that link; never join paragraphs or URL whitespace.
      name: "bgp_wrapped_link", level: "inline",
      start: (src) => src.search(/!?\[/),
      tokenizer(src) {
        const match = /^(!?\[[^\]\n]*\])(?:[ \t]+|[ \t]*\n[ \t]*)\(((?:[^()\s]|\([^()\s]*\))+)\)/.exec(src);
        if (!match) return;
        const tokens = this.lexer.inlineTokens(`${match[1]}(${match[2]})`);
        if (tokens.length === 1 && (tokens[0].type === "link" || tokens[0].type === "image")) {
          return { ...tokens[0], raw: match[0] };
        }
      },
    },
  ],
});

export function parseRichText(markdown: string): RichTextToken[] {
  const text = markdown.replace(/\r\n?/g, "\n");
  const fallback = (): Token[] => [{ type: "paragraph", raw: text, text, tokens: [{ type: "text", raw: text, text }] }];
  try {
    const tokens = parser.lexer(text);
    // Bound our recursive renderers even for corrupt or adversarial stored
    // messages. Preserve their text inertly rather than crashing the chat.
    const pending: Array<{ tokens: Token[]; depth: number }> = [{ tokens, depth: 0 }];
    while (pending.length) {
      const current = pending.pop()!;
      if (current.depth > 64) return fallback();
      for (const token of current.tokens) {
        if (token.type === "table") {
          const table = token as Tokens.Table;
          for (const cell of [...table.header, ...table.rows.flat()]) pending.push({ tokens: cell.tokens, depth: current.depth + 1 });
        } else if (token.type === "list") {
          for (const item of (token as Tokens.List).items) pending.push({ tokens: item.tokens, depth: current.depth + 1 });
        } else if ("tokens" in token && Array.isArray(token.tokens)) {
          pending.push({ tokens: token.tokens, depth: current.depth + 1 });
        }
      }
    }
    return tokens;
  } catch { return fallback(); }
}

export function decodeRichTextText(text: string): string {
  return decodeHTML(text);
}

/** Returns a safe chat destination, never an executable or protocol-relative URL. */
export function safeRichTextUrl(value: string, options: { allowRelative?: boolean; image?: boolean } = {}): string | null {
  const valueDecoded = decodeHTML(value).trim();
  if (!valueDecoded || /[\u0000-\u0020\u007f\\]/.test(valueDecoded) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(valueDecoded)) return null;
  if (valueDecoded.startsWith("/")) {
    return options.allowRelative && !valueDecoded.startsWith("//") ? valueDecoded : null;
  }
  try {
    const url = new URL(valueDecoded);
    if (url.username || url.password) return null;
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    if (!options.image && url.protocol === "mailto:" && /^[^?&#\s]+@[^?&#\s]+$/.test(url.pathname)) return url.href;
    if (!options.image && url.protocol === "tel:" && /^\+?[\d().-]+$/.test(url.pathname)) return url.href;
  } catch { /* Invalid destinations stay readable without becoming links. */ }
  return null;
}

export function isAuthenticatedDownloadUrl(value: string): boolean {
  const url = safeRichTextUrl(value, { allowRelative: true });
  return Boolean(url && /^\/api\/(?:chat-media\/[^\s]+|lr-bg\/register\/[A-Za-z]{0,3}\d{1,8}(?:[?#].*)?|companies-house\/document\/[A-Za-z0-9_-]+(?:[?#].*)?)$/.test(url));
}

function decodeUrlPart(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

const credentialKey = /^(?:(?:access|refresh|id|download|auth|session)[_-]?)?token$|^(?:auth|authorization|api[_-]?key|key|signature|sig|credential|password|secret|session|code)$|(?:^|[-_])(?:token|authorization|credential|signature|secret|password)$/i;

function hasCredentialParameters(value: string): boolean {
  const params = new URLSearchParams(value);
  return Array.from(params.keys()).some(key => credentialKey.test(key));
}

function privateExportDestination(url: URL): boolean {
  const path = decodeUrlPart(decodeUrlPart(url.pathname));
  const fragment = decodeUrlPart(url.hash.slice(1));
  const fragmentQuery = fragment.includes("?") ? fragment.slice(fragment.indexOf("?") + 1) : fragment;
  return Boolean(url.username || url.password || /^\/api(?:\/|$)/i.test(path)
    || hasCredentialParameters(url.search.slice(1))
    || hasCredentialParameters(fragment) || hasCredentialParameters(fragmentQuery));
}

/** Exported content must not carry app-only links or credential-bearing URLs. */
export function safeExportUrl(value: string): string | null {
  const safe = safeRichTextUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (privateExportDestination(url)) return null;
  return safe;
}

export function exportRichTextText(value: string, decode = true): string {
  const text = decode ? decodeHTML(value) : value;
  // Also cover URLs presented as literal text/code/raw HTML, not just links.
  return text.replace(/(?:https?:\/\/|\/\/|\/)[^\s<>"']+/gi, value => {
    try {
      // A base permits checks on bare/encoded app paths and protocol-relative
      // URLs. Ordinary slashes, e.g. "£14/sq ft", remain ordinary text.
      return privateExportDestination(new URL(value, "https://chat.invalid")) ? "[Private link omitted]" : value;
    } catch { return value; }
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function children(token: Token): Token[] {
  return "tokens" in token && Array.isArray(token.tokens) ? token.tokens : [];
}

const paragraphStyle = "margin:0 0 12px;line-height:1.5;";
const cellStyle = "border:1px solid #b8b8b8;padding:8px;text-align:left;vertical-align:top;background-color:transparent;";

function emailTokens(tokens: Token[]): string {
  return tokens.map(token => {
    const child = () => emailTokens(children(token));
    const text = () => escapeHtml(exportRichTextText("text" in token ? String(token.text) : token.raw));
    switch (token.type) {
      case "space": case "def": return "";
      case "text": case "escape": return children(token).length ? child() : text();
      case "html": return escapeHtml(exportRichTextText(token.raw));
      case "paragraph": return `<p style="${paragraphStyle}">${child()}</p>`;
      case "heading": {
        const heading = token as Tokens.Heading;
        const depth = Math.max(1, Math.min(6, heading.depth));
        return `<h${depth} style="margin:16px 0 8px;font-size:${depth === 1 ? 18 : depth === 2 ? 16 : 13}pt;line-height:1.3;font-weight:bold;">${child()}</h${depth}>`;
      }
      case "strong": return `<strong>${child()}</strong>`;
      case "em": return `<em>${child()}</em>`;
      case "del": return `<del>${child()}</del>`;
      case "br": return "<br>";
      case "hr": return '<hr style="border:0;border-top:1px solid #b8b8b8;margin:16px 0;">';
      case "codespan": return `<code style="font-family:Consolas,monospace;background-color:transparent;">${escapeHtml(exportRichTextText(token.text, false))}</code>`;
      case "code": return `<pre style="white-space:pre-wrap;font-family:Consolas,monospace;margin:0 0 12px;background-color:transparent;"><code>${escapeHtml(exportRichTextText(token.text, false))}</code></pre>`;
      case "blockquote": return `<blockquote style="margin:0 0 12px 16px;border-left:2px solid #b8b8b8;padding-left:12px;">${child()}</blockquote>`;
      case "bgp_tag": return escapeHtml(exportRichTextText(String(token.name)));
      case "bgp_download": return escapeHtml(exportRichTextText(String(token.text)));
      case "image": return text(); // Email exports do not add tracking pixels or authenticated images.
      case "link": {
        const url = safeExportUrl(token.href);
        const label = child();
        return url ? `<a href="${escapeHtml(url)}" style="color:#1155cc;text-decoration:underline;">${label}</a>` : label;
      }
      case "list": {
        const list = token as Tokens.List;
        const tag = list.ordered ? "ol" : "ul";
        const start = list.ordered && Number.isSafeInteger(list.start) ? ` start="${list.start}"` : "";
        return `<${tag}${start} style="margin:0 0 12px;padding-left:24px;">${list.items.map(item => `<li style="margin:0 0 4px;">${item.task ? (item.checked ? "☑ " : "☐ ") : ""}${emailTokens(item.tokens)}</li>`).join("")}</${tag}>`;
      }
      case "table": {
        const table = token as Tokens.Table;
        const head = table.header.map(cell => `<th scope="col" style="${cellStyle}font-weight:bold;">${emailTokens(cell.tokens)}</th>`).join("");
        const rows = table.rows.map(row => `<tr>${row.map(cell => `<td style="${cellStyle}">${emailTokens(cell.tokens)}</td>`).join("")}</tr>`).join("");
        return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:11pt;"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
      }
      default: return text();
    }
  }).join("");
}

function plainTokens(tokens: Token[]): string {
  return tokens.map(token => {
    const child = () => plainTokens(children(token));
    const text = () => exportRichTextText("text" in token ? String(token.text) : token.raw);
    switch (token.type) {
      case "space": case "def": return "";
      case "text": case "escape": return children(token).length ? child() : text();
      case "paragraph": case "heading": return `${child()}\n\n`;
      case "strong": case "em": case "del": return child();
      case "br": return "\n";
      case "hr": return "\n";
      case "codespan": return exportRichTextText(token.text, false);
      case "code": return `${exportRichTextText(token.text, false)}\n\n`;
      case "blockquote": return `${child().trim()}\n\n`;
      case "html": return exportRichTextText(token.raw);
      case "bgp_tag": return exportRichTextText(String(token.name));
      case "bgp_download": case "image": return text();
      case "link": {
        const label = child();
        const url = safeExportUrl(token.href);
        return url && url !== label ? `${label} (${url})` : label;
      }
      case "list": {
        const list = token as Tokens.List;
        const start = typeof list.start === "number" ? list.start : 1;
        return list.items.map((item, index) => {
          const prefix = item.task ? (item.checked ? "☑ " : "☐ ") : list.ordered ? `${start + index}. ` : "• ";
          const body = item.tokens.map((part, i) => `${part.type === "list" && i > 0 ? "\n" : ""}${plainTokens([part])}`).join("");
          return prefix + body.trim().replace(/\n/g, "\n  ");
        }).join("\n") + "\n\n";
      }
      case "table": {
        const table = token as Tokens.Table;
        const row = (cells: Tokens.TableCell[]) => cells.map(cell => plainTokens(cell.tokens).replace(/\n/g, " ").trim()).join("\t");
        return [row(table.header), ...table.rows.map(row)].join("\n") + "\n\n";
      }
      default: return text();
    }
  }).join("");
}

export function renderEmailHtml(markdown: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.5;color:#202020;background-color:#ffffff;">${emailTokens(parseRichText(markdown))}</div>`;
}

export function renderPlainText(markdown: string): string {
  return plainTokens(parseRichText(markdown)).replace(/\n{3,}/g, "\n\n").trim();
}
