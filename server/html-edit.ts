/**
 * Surgical HTML editing for Claude-generated docs.
 *
 * Each editable element in a generated deck/brief is marked with
 * `data-edit-id="<unique-id>"`. The DocumentEditor component lets the
 * user click an image / text element to edit it; the request lands at
 * `applyEdit(html, editId, type, value)` which mutates exactly that
 * element and returns the new HTML.
 *
 * Two edit types in v1:
 *   - "image"  → replace the src attribute of the matching <img>
 *   - "text"   → replace the inner content of the matching element
 *
 * No external HTML parser dep — the markers narrow each edit to a
 * specific tag, and the regex bounds are tight. Conservative on
 * ambiguity (matches the FIRST element with the editId; nested same-
 * tag elements inside an editable element will confuse text edits but
 * Claude's output doesn't do that for our slide layouts).
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type EditType = "image" | "text";

export interface ApplyEditResult {
  html: string;
  changed: boolean;
}

export function applyEdit(html: string, editId: string, type: EditType, value: string): ApplyEditResult {
  if (!editId) return { html, changed: false };
  if (type === "image") return replaceImgSrc(html, editId, value);
  if (type === "text") return replaceText(html, editId, value);
  return { html, changed: false };
}

function replaceImgSrc(html: string, editId: string, newSrc: string): ApplyEditResult {
  // Match every <img …> tag, then check it has the right data-edit-id.
  // <img …> may be self-closing (/>) or just `>`.
  let changed = false;
  const out = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const re = new RegExp(`data-edit-id=["']${escapeRegExp(editId)}["']`, "i");
    if (!re.test(tag)) return tag;
    changed = true;
    if (/\bsrc=["'][^"']*["']/i.test(tag)) {
      return tag.replace(/(\bsrc=["'])[^"']*(["'])/i, `$1${escapeAttr(newSrc)}$2`);
    }
    return tag.replace(/<img\b/i, `<img src="${escapeAttr(newSrc)}"`);
  });
  return { html: out, changed };
}

function replaceText(html: string, editId: string, newText: string): ApplyEditResult {
  // Match <TAG …data-edit-id="X"…>INNER</TAG>. Lazy match on INNER so
  // we stop at the first matching closing tag. Skipped if the editable
  // element contains a same-tag descendant — that would confuse the
  // closing-tag match — but Claude's output for our layouts doesn't.
  const re = new RegExp(
    `(<([a-z][a-z0-9-]*)\\b[^>]*\\bdata-edit-id=["']${escapeRegExp(editId)}["'][^>]*>)([\\s\\S]*?)(</\\2\\s*>)`,
    "i",
  );
  let changed = false;
  const out = html.replace(re, (_full, open, _tag, _inner, close) => {
    changed = true;
    return `${open}${escapeHtml(newText)}${close}`;
  });
  return { html: out, changed };
}
