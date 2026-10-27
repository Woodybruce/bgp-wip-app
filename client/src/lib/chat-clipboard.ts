import { renderEmailHtml, renderPlainText } from "@shared/chat-rich-text";

/** The clipboard contains document content only, never the chat bubble DOM. */
export async function copyChatContent(markdown: string, formatted = true): Promise<"formatted" | "plain"> {
  const text = renderPlainText(markdown);
  if (formatted && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([renderEmailHtml(markdown)], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      return "formatted";
    } catch {
      // Safari can reject multi-format writes. A selection-based rich copy
      // still preserves tables, and never copies the surrounding app chrome.
    }
  }
  if (formatted) {
    const target = document.createElement("div");
    target.contentEditable = "true";
    target.style.cssText = "position:fixed;left:-10000px;top:0;background:white;color:black";
    target.innerHTML = renderEmailHtml(markdown);
    const active = document.activeElement as HTMLElement | null;
    const selection = window.getSelection();
    const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
    document.body.append(target);
    try {
      const range = document.createRange();
      range.selectNodeContents(target);
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
        if (document.execCommand("copy")) return "formatted";
      }
    } catch {
      // Fall through to honest plain-text copying when rich selection fails.
    } finally {
      target.remove();
      selection?.removeAllRanges();
      ranges.forEach(range => { try { selection?.addRange(range); } catch {} });
      active?.focus({ preventScroll: true });
    }
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return "plain";
  }
  throw new Error("Copy is unavailable in this browser. Select the text to copy, or download the Word document.");
}
