import { createElement, useMemo, useState } from "react";
import { TagChip, type TagType } from "@/components/chat-tags";
import { parseRichText, decodeRichTextText, safeRichTextUrl, isAuthenticatedDownloadUrl, type RichTextToken } from "@shared/chat-rich-text";
import type { Tokens } from "marked";
import { Copy, Check, Download, Loader2 } from "lucide-react";

// Single source of truth for chat-media downloads across desktop chat,
// the standalone /chatbgp page and the mobile PWA. iOS PWA standalone
// mode treats <a href download> with an authenticated binary response
// as a navigation — the WebView tries to render the body, fails, and
// presents the user with a white screen they have to force-quit to
// escape. fetch → blob → URL.createObjectURL → temporary <a> click
// keeps the navigation same-origin to a blob: URL, which the WebView
// treats as a proper file download and surfaces via the native share /
// save sheet.
export function AuthDownloadLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (!href.startsWith("/api/") || href.includes("\\")) throw new Error("Download must use an app file link");
      const token = localStorage.getItem("bgp_addin_token") || localStorage.getItem("bgp_auth_token") || "";
      const registerTitle = href.match(/^\/api\/lr-bg\/register\/([A-Z]{0,3}\d{1,8})(?:\?|$)/i)?.[1];
      const companyDocument = href.match(/^\/api\/companies-house\/document\/([A-Za-z0-9_-]+)(?:[?#]|$)/)?.[1];
      const requestedFilename = companyDocument
        ? new URLSearchParams(href.split("?")[1]?.split("#")[0] || "").get("filename") || ""
        : "";
      const companyFilename = requestedFilename.replace(/[^A-Za-z0-9._-]/g, "_")
        .replace(/^[._-]+/, "").replace(/\.pdf$/i, "").slice(0, 160);
      const filename = registerTitle
        ? `${registerTitle.toUpperCase()}-OC1-Register.pdf`
        : companyDocument
          ? `${companyFilename || `Companies-House-${companyDocument}`}.pdf`
        : href.split("/").pop()?.split("?")[0] || "download";
      const res = await fetch(href, { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) {
        // Try to surface the server-side reason — chat-media returns JSON
        // with { message } on 401, useful for diagnosing token issues.
        let detail = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j?.message || j?.error) detail = `${detail}: ${j.message || j.error}`; } catch {}
        throw new Error(detail);
      }
      const blob = await res.blob();
      if (blob.size === 0) throw new Error("Empty response from server");
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give the browser a beat to start the save before we revoke the
      // blob URL — revoking immediately can race the download on iOS.
      setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
    } catch (e: any) {
      setErr(e?.message || "Download failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-2.5 my-1 rounded-lg bg-muted border border-border text-foreground hover:bg-accent active:bg-accent disabled:opacity-60 transition-colors text-sm font-medium no-underline cursor-pointer min-h-[44px]"
        data-testid="link-download-file"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {children}
      </button>
      {err && (
        <span className="text-[11px] text-destructive mt-0.5 max-w-[280px] break-words" data-testid="download-error">
          Download failed — {err}
        </span>
      )}
    </span>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden border border-border" data-testid="code-block">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/60 border-b border-border">
        <span className="text-xs text-muted-foreground font-mono">{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-background/50"
          data-testid="button-copy-code"
        >
          {copied ? (
            <><Check className="w-3 h-3 text-green-500" /><span className="text-green-500">Copied</span></>
          ) : (
            <><Copy className="w-3 h-3" /><span>Copy</span></>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed font-mono whitespace-pre bg-muted/20">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderTokens(tokens: RichTextToken[], prefix: string, inLink = false): React.ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${prefix}-${index}`;
    const child = () => renderTokens("tokens" in token && Array.isArray(token.tokens) ? token.tokens : [], key, inLink);
    const text = () => decodeRichTextText("text" in token ? String(token.text) : token.raw);
    switch (token.type) {
      case "space": case "def": return null;
      case "text": case "escape": return "tokens" in token && token.tokens?.length ? child() : text();
      case "html": return token.raw; // React escapes it; raw HTML is never mounted.
      case "paragraph": return <p key={key}>{child()}</p>;
      case "heading": return createElement(`h${Math.max(1, Math.min(6, token.depth))}`, { key }, child());
      case "strong": return <strong key={key} className="font-semibold">{child()}</strong>;
      case "em": return <em key={key}>{child()}</em>;
      case "del": return <del key={key}>{child()}</del>;
      case "br": return <br key={key} />;
      case "hr": return <hr key={key} />;
      case "codespan": return <code key={key}>{token.text}</code>;
      case "code": return <CodeBlock key={key} code={token.text} language={token.lang?.split(/\s+/)[0]} />;
      case "blockquote": return <blockquote key={key}>{child()}</blockquote>;
      case "bgp_tag": return inLink ? decodeRichTextText(token.name) : <TagChip key={key} type={token.tagType as TagType} id={token.id} name={decodeRichTextText(token.name)} />;
      case "bgp_download": return inLink ? token.text : <AuthDownloadLink key={key} href={token.href}>{token.text}</AuthDownloadLink>;
      case "image": {
        const url = safeRichTextUrl(token.href, { allowRelative: true, image: true });
        if (!url) return text();
        if (inLink) return <img key={key} src={url} alt={text()} className="rounded-xl max-w-[260px] max-h-[300px] object-cover" />;
        return <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="block my-1">
          <img src={url} alt={text()} className="rounded-xl max-w-[260px] max-h-[300px] object-cover" />
        </a>;
      }
      case "link": {
        const url = safeRichTextUrl(token.href, { allowRelative: true });
        if (!url) return child();
        const label = renderTokens(token.tokens || [], key, true);
        if (isAuthenticatedDownloadUrl(url)) return <AuthDownloadLink key={key} href={url}>{label}</AuthDownloadLink>;
        return <a key={key} href={url} target={url.startsWith("/") ? undefined : "_blank"} rel={url.startsWith("/") ? undefined : "noopener noreferrer"} className="text-primary underline underline-offset-2 break-words">{label}</a>;
      }
      case "list": {
        const list = token as Tokens.List;
        const items = list.items.map((item, itemIndex) => <li key={`${key}-li-${itemIndex}`}>
          {item.task ? <span aria-label={item.checked ? "Completed" : "Not completed"}>{item.checked ? "☑ " : "☐ "}</span> : null}
          {renderTokens(item.tokens, `${key}-li-${itemIndex}`)}
        </li>);
        return list.ordered ? <ol key={key} start={typeof list.start === "number" ? list.start : undefined}>{items}</ol> : <ul key={key}>{items}</ul>;
      }
      case "table": {
        const table = token as Tokens.Table;
        return <div key={key} className="overflow-x-auto my-2">
          <table className="w-max min-w-full" style={{ width: "max-content", minWidth: "100%" }}>
            <thead><tr>{table.header.map((cell, i) => <th key={`${key}-th-${i}`} scope="col" className="whitespace-nowrap text-left align-bottom" style={{ textAlign: table.align[i] || "left" }}>{renderTokens(cell.tokens, `${key}-th-${i}`)}</th>)}</tr></thead>
            <tbody>{table.rows.map((row, ri) => <tr key={`${key}-tr-${ri}`}>{row.map((cell, ci) => <td key={`${key}-td-${ri}-${ci}`} className="break-normal align-top max-w-[280px]" style={{ textAlign: table.align[ci] || "left" }}>{renderTokens(cell.tokens, `${key}-td-${ri}-${ci}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>;
      }
      default: return text();
    }
  });
}

export function ChatBGPMarkdown({ content }: { content: string }) {
  const tokens = useMemo(() => parseRichText(content), [content]);
  return <div className="chatbgp-markdown min-w-0 max-w-full whitespace-normal">{renderTokens(tokens, "md")}</div>;
}
