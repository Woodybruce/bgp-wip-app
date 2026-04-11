import { useState } from "react";
import { Copy, Check, Download } from "lucide-react";

function AuthDownloadLink({ href, children }: { href: string; children: React.ReactNode }) {
  // Build a direct download URL with auth token in query string
  // This lets mobile browsers handle the download natively via <a href>
  // instead of JavaScript fetch() which mobile Safari/Chrome block
  const token = localStorage.getItem("bgp_auth_token") || "";
  const separator = href.includes("?") ? "&" : "?";
  const directUrl = token ? `${href}${separator}token=${token}` : href;
  const filename = href.split("/").pop()?.split("?")[0] || "download";

  return (
    <a
      href={directUrl}
      download={filename}
      className="inline-flex items-center gap-1.5 px-3 py-2.5 my-1 rounded-lg bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 active:bg-green-200 transition-colors text-sm font-medium no-underline cursor-pointer min-h-[44px]"
      data-testid="link-download-file"
    >
      <Download className="w-4 h-4" />
      {children}
    </a>
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

function isSafeUrl(url: string) {
  return url.startsWith("/") || url.startsWith("https://") || url.startsWith("http://");
}

function parseInline(text: string, keyPrefix: string): (string | JSX.Element)[] {
  const tokenRegex = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\((\/api\/chat-media\/[^)]+)\)|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\[([^\]]+)\]\((\/[^)]+)\)|\*\*(.+?)\*\*|`([^`]+)`|(https?:\/\/[^\s<>)\]]+)/g;
  const result: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) result.push(text.slice(lastIndex, match.index));

    if (match[1] !== undefined && match[2]) {
      // ![alt](url) — image
      if (isSafeUrl(match[2])) {
        result.push(
          <a key={`${keyPrefix}-${key++}`} href={match[2]} target="_blank" rel="noopener noreferrer" className="block my-1">
            <img src={match[2]} alt={match[1]} className="rounded-xl max-w-[260px] max-h-[300px] object-cover" />
          </a>
        );
      } else {
        result.push(match[0]);
      }
    } else if (match[3] && match[4]) {
      // [text](/api/chat-media/...) — download link
      result.push(
        <AuthDownloadLink key={`${keyPrefix}-${key++}`} href={match[4]}>{match[3]}</AuthDownloadLink>
      );
    } else if (match[5] && match[6]) {
      // [text](https://...) — external link
      result.push(<a key={`${keyPrefix}-${key++}`} href={match[6]} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">{match[5]}</a>);
    } else if (match[7] && match[8]) {
      // [text](/path) — internal app link
      result.push(<a key={`${keyPrefix}-${key++}`} href={match[8]} className="text-primary underline underline-offset-2">{match[7]}</a>);
    } else if (match[9]) {
      // **bold**
      result.push(<strong key={`${keyPrefix}-${key++}`} className="font-semibold">{match[9]}</strong>);
    } else if (match[10]) {
      // `code`
      result.push(<code key={`${keyPrefix}-${key++}`}>{match[10]}</code>);
    } else if (match[11]) {
      // bare https://url
      const url = match[11].replace(/[.,;:!?]+$/, "");
      const trailing = match[11].slice(url.length);
      result.push(<a key={`${keyPrefix}-${key++}`} href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 break-all">{url}</a>);
      if (trailing) result.push(trailing);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) result.push(text.slice(lastIndex));
  return result;
}

function parseTable(lines: string[]): JSX.Element | null {
  if (lines.length < 2) return null;
  const headerLine = lines[0];
  const separatorLine = lines[1];

  if (!separatorLine.match(/^\|[\s-:|]+\|$/)) return null;

  const parseCells = (line: string) =>
    line.replace(/^\||\|$/g, "").split("|").map(c => c.trim());

  const headers = parseCells(headerLine);
  const rows = lines.slice(2).map(parseCells);

  return (
    <div className="overflow-x-auto my-2">
      <table>
        <thead>
          <tr>
            {headers.map((h, i) => <th key={i}>{parseInline(h, `th-${i}`)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => <td key={ci}>{parseInline(cell, `td-${ri}-${ci}`)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChatBGPMarkdown({ content }: { content: string }) {
  const elements: JSX.Element[] = [];
  let key = 0;

  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  const segments: { type: "text" | "code"; content: string; language?: string }[] = [];
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: content.slice(lastIndex, match.index) });
    }
    segments.push({ type: "code", content: match[2].replace(/\n$/, ""), language: match[1] || undefined });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: "text", content: content.slice(lastIndex) });
  }

  for (const segment of segments) {
    if (segment.type === "code") {
      elements.push(<CodeBlock key={key++} code={segment.content} language={segment.language} />);
      continue;
    }

    const lines = segment.content.split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.trim() === "") {
        i++;
        continue;
      }

      if (line.startsWith("|") && i + 1 < lines.length && lines[i + 1].match(/^\|[\s-:|]+\|$/)) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].startsWith("|")) {
          tableLines.push(lines[i]);
          i++;
        }
        const table = parseTable(tableLines);
        if (table) {
          elements.push(<div key={key++}>{table}</div>);
        }
        continue;
      }

      if (line.match(/^---+$/) || line.match(/^\*\*\*+$/) || line.match(/^___+$/)) {
        elements.push(<hr key={key++} />);
        i++;
        continue;
      }

      const h1Match = line.match(/^#\s+(.+)/);
      if (h1Match) {
        elements.push(<h1 key={key++}>{parseInline(h1Match[1], `h1-${key}`)}</h1>);
        i++;
        continue;
      }
      const h2Match = line.match(/^##\s+(.+)/);
      if (h2Match) {
        elements.push(<h2 key={key++}>{parseInline(h2Match[1], `h2-${key}`)}</h2>);
        i++;
        continue;
      }
      const h3Match = line.match(/^###\s+(.+)/);
      if (h3Match) {
        elements.push(<h3 key={key++}>{parseInline(h3Match[1], `h3-${key}`)}</h3>);
        i++;
        continue;
      }
      const h4Match = line.match(/^####\s+(.+)/);
      if (h4Match) {
        elements.push(<h4 key={key++}>{parseInline(h4Match[1], `h4-${key}`)}</h4>);
        i++;
        continue;
      }

      const bqMatch = line.match(/^>\s?(.*)/);
      if (bqMatch) {
        const bqLines: string[] = [bqMatch[1]];
        i++;
        while (i < lines.length && lines[i].match(/^>\s?(.*)/)) {
          bqLines.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        elements.push(<blockquote key={key++}>{parseInline(bqLines.join("\n"), `bq-${key}`)}</blockquote>);
        continue;
      }

      const ulMatch = line.match(/^(\s*)[-*•]\s+(.*)/);
      if (ulMatch) {
        const listItems: string[] = [];
        while (i < lines.length && lines[i].match(/^\s*[-*•]\s+/)) {
          listItems.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
          i++;
        }
        elements.push(
          <ul key={key++}>
            {listItems.map((item, j) => <li key={j}>{parseInline(item, `ul-${key}-${j}`)}</li>)}
          </ul>
        );
        continue;
      }

      const olMatch = line.match(/^(\s*)\d+[.)]\s+(.*)/);
      if (olMatch) {
        const listItems: string[] = [];
        while (i < lines.length && lines[i].match(/^\s*\d+[.)]\s+/)) {
          listItems.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
          i++;
        }
        elements.push(
          <ol key={key++}>
            {listItems.map((item, j) => <li key={j}>{parseInline(item, `ol-${key}-${j}`)}</li>)}
          </ol>
        );
        continue;
      }

      const paraLines: string[] = [line];
      i++;
      while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("#") && !lines[i].startsWith("|") && !lines[i].match(/^[-*•]\s+/) && !lines[i].match(/^\d+[.)]\s+/) && !lines[i].match(/^---/) && !lines[i].startsWith(">")) {
        paraLines.push(lines[i]);
        i++;
      }
      elements.push(<p key={key++}>{parseInline(paraLines.join("\n"), `p-${key}`)}</p>);
    }
  }

  return <div className="chatbgp-markdown">{elements}</div>;
}
