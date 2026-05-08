// Shared rendering + editing of a (sourceEvidence, sourceUrl, sourceTitle) tuple.
// Used across the Comps schedule, Leads board, and Lease Events tab so the
// behaviour is identical: type pip + clickable link back to wherever the row
// came from (the email, the pathway report, the SharePoint file, etc.).

import { ExternalLink } from "lucide-react";
import { SOURCE_TYPES, SOURCE_LIST, normaliseSource, defaultSourceLabel, type SourceType } from "@shared/source-types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SourceCellProps {
  evidence: string | null | undefined;
  url: string | null | undefined;
  title?: string | null;
  /** When true, only the type pip is rendered (no link). Used in dense tables. */
  compact?: boolean;
}

export function SourceCell({ evidence, url, title, compact }: SourceCellProps) {
  const type = normaliseSource(evidence);
  const meta = type ? SOURCE_TYPES[type] : null;
  const label = title || defaultSourceLabel(type, url);

  if (!type && !url) return null;

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {meta && (
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${meta.badgeClass}`}
          title={meta.description}
          data-testid={`source-pip-${type}`}
        >
          {meta.label}
        </span>
      )}
      {!compact && url && (
        <a
          href={url}
          target={url.startsWith("/") ? "_self" : "_blank"}
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-primary hover:underline truncate"
          title={title || url}
          data-testid="source-link"
        >
          <span className="truncate max-w-[140px]">{label}</span>
          <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      )}
    </div>
  );
}

interface SourcePickerProps {
  evidence: string | null | undefined;
  url: string | null | undefined;
  title: string | null | undefined;
  onChange: (next: { evidence: SourceType | null; url: string | null; title: string | null }) => void;
  /** Hide the URL/title inputs (used when source is pure metadata, no link). */
  noLink?: boolean;
}

/**
 * Lets the user attach a source to a record they're creating or editing.
 * Type dropdown + optional URL + optional title. Empty type clears all three.
 *
 * For "Email" / "Pathway" sources, advise pasting the in-app deep link
 * (e.g. `/mail/<msgId>` or `/property-pathway/<id>`) so clicks stay inside
 * the app rather than bouncing to Outlook web.
 */
export function SourcePicker({ evidence, url, title, onChange, noLink }: SourcePickerProps) {
  const type = normaliseSource(evidence);
  return (
    <div className="space-y-2" data-testid="source-picker">
      <div className="space-y-1.5">
        <Label className="text-xs">Source</Label>
        <Select
          value={type || "_none"}
          onValueChange={(v) => {
            const next = v === "_none" ? null : (v as SourceType);
            onChange({ evidence: next, url: next ? url || null : null, title: next ? title || null : null });
          }}
        >
          <SelectTrigger data-testid="select-source-type"><SelectValue placeholder="No source" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">— No source —</SelectItem>
            {SOURCE_LIST.map((t) => (
              <SelectItem key={t} value={t}>{SOURCE_TYPES[t].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {type && !noLink && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Link (optional)</Label>
            <Input
              placeholder={
                type === "Pathway"  ? "/property-pathway/<id>" :
                type === "Email"    ? "/mail/<message-id> or Outlook web URL" :
                type === "WhatsApp" ? "/whatsapp/<conversation-id>" :
                type === "News"     ? "https://..." :
                "https://..."
              }
              value={url || ""}
              onChange={(e) => onChange({ evidence: type, url: e.target.value || null, title })}
              data-testid="input-source-url"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description (optional)</Label>
            <Input
              placeholder="What this is, e.g. 'Joe Bloggs email re: 12 High St'"
              value={title || ""}
              onChange={(e) => onChange({ evidence: type, url, title: e.target.value || null })}
              data-testid="input-source-title"
            />
          </div>
        </>
      )}
    </div>
  );
}
