import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import ReactDOM from "react-dom";
import { Check, X, ChevronDown, Pencil, Plus, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface InlineTextProps {
  value: string | null | undefined;
  onSave: (value: string) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  maxLines?: number;
}

export function InlineText({ value, onSave, placeholder = "—", className = "", multiline = false, maxLines }: InlineTextProps) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed !== (value || "")) {
      onSave(trimmed);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value || "");
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      save();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  if (editing) {
    const inputClass = "w-full px-1.5 py-0.5 text-xs border border-primary/40 rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 " + className;
    if (multiline) {
      return (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
          className={inputClass + " min-h-[48px] resize-none"}
          data-testid="inline-edit-textarea"
        />
      );
    }
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        className={inputClass}
        data-testid="inline-edit-text"
      />
    );
  }

  const clampStyle = maxLines && !expanded ? {
    display: "-webkit-box",
    WebkitLineClamp: maxLines,
    WebkitBoxOrient: "vertical" as const,
    overflow: "hidden",
  } : undefined;

  return (
    <span
      className={`cursor-pointer hover:bg-muted/60 rounded px-1.5 py-0.5 text-xs inline-block min-w-[2rem] transition-colors ${!value ? "text-muted-foreground italic" : ""} ${className}`}
      data-testid="inline-edit-display"
    >
      <span
        onClick={() => {
          setDraft(value || "");
          setEditing(true);
        }}
        style={clampStyle}
      >
        {value || placeholder}
      </span>
      {maxLines && value && value.length > 60 && !expanded && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
          className="text-[10px] text-blue-500 hover:underline ml-1"
          data-testid="inline-edit-expand"
        >
          more
        </button>
      )}
      {maxLines && expanded && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
          className="text-[10px] text-blue-500 hover:underline ml-1"
          data-testid="inline-edit-collapse"
        >
          less
        </button>
      )}
    </span>
  );
}

interface InlineNumberProps {
  value: number | null | undefined;
  onSave: (value: number | null) => void;
  placeholder?: string;
  className?: string;
  prefix?: string;
  suffix?: string;
  format?: (val: number) => string;
}

export function InlineNumber({ value, onSave, placeholder = "—", className = "", prefix = "", suffix = "", format }: InlineNumberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.toString() || "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const save = () => {
    if (draft.trim() === "") {
      if (value != null) onSave(null);
      setEditing(false);
      return;
    }
    const num = parseFloat(draft.replace(/,/g, ""));
    if (!Number.isFinite(num)) {
      setDraft(value?.toString() || "");
      setEditing(false);
      return;
    }
    if (num !== value) {
      onSave(num);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value?.toString() || "");
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        className={"w-full px-1.5 py-0.5 text-xs border border-primary/40 rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 " + className}
        data-testid="inline-edit-number"
      />
    );
  }

  const displayVal = value != null
    ? `${prefix}${format ? format(value) : value.toLocaleString("en-GB")}${suffix}`
    : null;

  return (
    <span
      onClick={() => {
        setDraft(value?.toString() || "");
        setEditing(true);
      }}
      className={`cursor-pointer hover:bg-muted/60 rounded px-1.5 py-0.5 text-xs inline-block min-w-[2rem] transition-colors ${!displayVal ? "text-muted-foreground italic" : ""} ${className}`}
      data-testid="inline-edit-display"
    >
      {displayVal || placeholder}
    </span>
  );
}

interface InlineSelectProps {
  value: string | null | undefined;
  options: readonly string[] | string[];
  onSave: (value: string) => void;
  placeholder?: string;
  className?: string;
  allowClear?: boolean;
}

export function InlineSelect({ value, options, onSave, placeholder = "—", className = "", allowClear = true }: InlineSelectProps) {
  const [editing, setEditing] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (editing && selectRef.current) {
      selectRef.current.focus();
    }
  }, [editing]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newVal = e.target.value;
    if (newVal !== (value || "")) {
      onSave(newVal);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <select
        ref={selectRef}
        value={value || ""}
        onChange={handleChange}
        onBlur={() => setEditing(false)}
        className={"w-full px-1 py-0.5 text-xs border border-primary/40 rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 " + className}
        data-testid="inline-edit-select"
      >
        {allowClear && <option value="">— Clear —</option>}
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-pointer hover:bg-muted/60 rounded px-1.5 py-0.5 text-xs inline-block min-w-[2rem] transition-colors ${!value ? "text-muted-foreground italic" : ""} ${className}`}
      data-testid="inline-edit-display"
    >
      {value || placeholder}
    </span>
  );
}

interface InlineLabelSelectProps {
  value: string | null | undefined;
  options: readonly string[] | string[];
  colorMap?: Record<string, string>;
  labelMap?: Record<string, string>;
  onSave: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  compact?: boolean;
}

export function InlineLabelSelect({ value, options, colorMap, labelMap, onSave, placeholder = "Set label", allowClear = true, compact = false }: InlineLabelSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const openDropdown = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const dropdownHeight = (options.length * 36) + (allowClear ? 40 : 0) + 12;
      const showAbove = rect.top > dropdownHeight + 8;
      if (showAbove) {
        setPos({ top: rect.top - 4, left: rect.left, above: true });
      } else {
        setPos({ top: rect.bottom + 4, left: rect.left, above: false });
      }
    }
    setOpen(o => !o);
  }, [options.length, allowClear]);

  const handleSelect = (opt: string) => {
    if (opt !== (value || "")) {
      onSave(opt);
    }
    setOpen(false);
  };

  const handleClear = () => {
    if (value) onSave("");
    setOpen(false);
  };

  const bg = value && colorMap?.[value] ? colorMap[value] : value ? "bg-gray-500" : "";

  return (
    <div className="relative">
      {value ? (
        <button
          ref={triggerRef}
          onClick={openDropdown}
          className={`${bg} text-white font-medium rounded-full cursor-pointer hover:opacity-90 transition-opacity whitespace-nowrap ${compact ? "text-[10px] px-2 py-0.5" : "text-[11px] px-2.5 py-1"}`}
          data-testid="inline-label-display"
        >
          {(value && labelMap?.[value]) || value}
        </button>
      ) : (
        <button
          ref={triggerRef}
          onClick={openDropdown}
          className={`text-muted-foreground italic cursor-pointer hover:bg-muted/60 rounded px-1.5 py-0.5 transition-colors ${compact ? "text-[10px]" : "text-[11px]"}`}
          data-testid="inline-label-display"
        >
          {placeholder}
        </button>
      )}

      {open && pos && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] w-[180px] bg-popover border rounded-lg shadow-lg p-1.5"
          style={{ top: pos.top, left: pos.left, transform: pos.above ? "translateY(-100%)" : undefined }}
          data-testid="inline-label-dropdown"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {options.map((opt) => {
            const optBg = colorMap?.[opt] || "bg-gray-500";
            const isActive = opt === value;
            return (
              <button
                key={opt}
                onClick={() => handleSelect(opt)}
                className={`w-full flex items-center justify-center py-1.5 px-2 rounded-md mb-0.5 transition-all ${
                  isActive ? "ring-2 ring-primary ring-offset-1" : "hover:scale-[1.02]"
                }`}
                data-testid={`label-option-${opt}`}
              >
                <span className={`${optBg} text-white text-[11px] font-medium px-3 py-1 rounded-full w-full text-center`}>
                  {labelMap?.[opt] ?? opt}
                </span>
              </button>
            );
          })}
          {allowClear && value && (
            <>
              <div className="border-t my-1" />
              <button
                onClick={handleClear}
                className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground py-1.5 rounded-md hover:bg-muted transition-colors"
                data-testid="label-option-clear"
              >
                Clear label
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

interface InlineMultiLabelSelectProps {
  value: string[] | null | undefined;
  options: readonly string[] | string[];
  colorMap?: Record<string, string>;
  onSave: (value: string[]) => void;
  placeholder?: string;
}

export function InlineMultiLabelSelect({ value, options, colorMap, onSave, placeholder = "Set teams" }: InlineMultiLabelSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const selected = value || [];

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const openDropdown = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const dropdownHeight = (options.length * 36) + 12;
      const showAbove = rect.top > dropdownHeight + 8;
      if (showAbove) {
        setPos({ top: rect.top - 4, left: rect.left, above: true });
      } else {
        setPos({ top: rect.bottom + 4, left: rect.left, above: false });
      }
    }
    setOpen(o => !o);
  }, [options.length]);

  const handleToggle = (opt: string) => {
    const next = selected.includes(opt)
      ? selected.filter(s => s !== opt)
      : [...selected, opt];
    onSave(next);
  };

  return (
    <div className="relative">
      {selected.length > 0 ? (
        <button
          ref={triggerRef}
          onClick={openDropdown}
          className="flex flex-wrap gap-1 cursor-pointer"
          data-testid="inline-multi-label-display"
        >
          {selected.map(s => {
            const bg = colorMap?.[s] || "bg-gray-500";
            return (
              <span key={s} className={`${bg} text-white text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap`}>
                {s}
              </span>
            );
          })}
        </button>
      ) : (
        <button
          ref={triggerRef}
          onClick={openDropdown}
          className="text-[11px] text-muted-foreground italic cursor-pointer hover:bg-muted/60 rounded px-1.5 py-0.5 transition-colors"
          data-testid="inline-multi-label-display"
        >
          {placeholder}
        </button>
      )}

      {open && pos && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] w-[180px] bg-popover border rounded-lg shadow-lg p-1.5"
          style={{ top: pos.top, left: pos.left, transform: pos.above ? "translateY(-100%)" : undefined }}
          data-testid="inline-multi-label-dropdown"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {options.map((opt) => {
            const optBg = colorMap?.[opt] || "bg-gray-500";
            const isActive = selected.includes(opt);
            return (
              <button
                key={opt}
                onClick={() => handleToggle(opt)}
                className={`w-full flex items-center justify-center py-1.5 px-2 rounded-md mb-0.5 transition-all ${
                  isActive ? "ring-2 ring-primary ring-offset-1" : "hover:scale-[1.02] opacity-70 hover:opacity-100"
                }`}
                data-testid={`multi-label-option-${opt}`}
              >
                <span className={`${optBg} text-white text-[11px] font-medium px-3 py-1 rounded-full w-full text-center`}>
                  {opt}
                </span>
              </button>
            );
          })}
          {selected.length > 0 && (
            <>
              <div className="border-t my-1" />
              <button
                onClick={() => { onSave([]); setOpen(false); }}
                className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground py-1.5 rounded-md hover:bg-muted transition-colors"
                data-testid="multi-label-option-clear"
              >
                Clear all
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

interface InlineDateProps {
  value: string | null | undefined;
  onSave: (value: string | null) => void;
  placeholder?: string;
  className?: string;
}

export function InlineDate({ value, onSave, placeholder = "—", className = "" }: InlineDateProps) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value || null;
    if (newVal !== (value || null)) {
      onSave(newVal);
    }
    setEditing(false);
  };

  const dateStr = value ? value.split("T")[0] : "";

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        value={dateStr}
        onChange={handleChange}
        onBlur={() => setEditing(false)}
        className={"px-1 py-0.5 text-xs border border-primary/40 rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 " + className}
        data-testid="inline-edit-date"
      />
    );
  }

  const display = value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-pointer hover:bg-muted/60 rounded px-1.5 py-0.5 text-xs inline-block min-w-[2rem] transition-colors ${!display ? "text-muted-foreground italic" : ""} ${className}`}
      data-testid="inline-edit-display"
    >
      {display || placeholder}
    </span>
  );
}

interface InlineMultiSelectProps {
  value: string[] | string | null | undefined;
  options: { label: string; value: string }[];
  colorMap?: Record<string, string>;
  placeholder?: string;
  onSave: (value: string[]) => void;
  testId?: string;
}

export function InlineMultiSelect({ value, options, colorMap, placeholder = "—", onSave, testId }: InlineMultiSelectProps) {
  const selected: string[] = Array.isArray(value) ? value : value ? [value] : [];
  const labelMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of options) m[o.value] = o.label;
    return m;
  }, [options]);

  const toggle = (item: string) => {
    const next = selected.includes(item) ? selected.filter(v => v !== item) : [...selected, item];
    onSave(next);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="cursor-pointer hover:bg-muted/60 rounded px-1 py-0.5 text-xs inline-flex items-center gap-0.5 min-w-[2rem] transition-colors flex-wrap"
          data-testid={testId}
        >
          {selected.length === 0 ? (
            <span className="text-muted-foreground italic">{placeholder}</span>
          ) : (
            selected.map(s => (
              <Badge key={s} className={`text-[10px] px-1.5 py-0 text-white ${colorMap?.[s] || "bg-zinc-500"}`}>{labelMap[s] || s}</Badge>
            ))
          )}
          <ChevronDown className="h-3 w-3 ml-0.5 text-muted-foreground shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56 max-h-64 overflow-y-auto z-[9999]">
        {options.map(opt => (
          <DropdownMenuItem key={opt.value} onClick={() => toggle(opt.value)}>
            <div className={`w-3 h-3 rounded-sm border mr-2 flex items-center justify-center ${selected.includes(opt.value) ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
              {selected.includes(opt.value) && <Check className="h-2 w-2 text-primary-foreground" />}
            </div>
            {colorMap?.[opt.value] && <div className={`w-2 h-2 rounded-full ${colorMap[opt.value]} mr-1`} />}
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface InlineLinkSelectProps {
  value: string | null | undefined;
  options: { id: string; name: string }[];
  href?: string;
  onSave: (val: string | null) => void;
  // If provided, an extra "Create new: <text>" row appears when the typed text
  // doesn't match an existing option. The popover closes after onCreate runs.
  onCreate?: (newName: string) => void;
  placeholder?: string;
  compact?: boolean;
}

export function InlineLinkSelect({ value, options, href, onSave, onCreate, placeholder = "Link...", compact = false }: InlineLinkSelectProps) {
  const [open, setOpen] = useState(false);
  const [filterText, setFilterText] = useState("");

  const filtered = filterText
    ? options.filter(o => o.name.toLowerCase().includes(filterText.toLowerCase()))
    : options;

  const selectedName = value ? options.find(o => o.id === value)?.name : null;

  return (
    <div className="flex items-center gap-1 shrink-0">
      {!compact && selectedName && href ? (
        <Link href={href}>
          <span className="text-xs text-primary hover:underline cursor-pointer truncate max-w-[100px] block">
            {selectedName}
          </span>
        </Link>
      ) : null}
      {compact && selectedName && href ? (
        <Link href={href}>
          <ExternalLink className="w-3 h-3 text-primary hover:text-primary/80" />
        </Link>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            data-testid="inline-link-select-trigger"
          >
            {selectedName ? (
              <Pencil className="w-3 h-3" />
            ) : (
              <span className="text-[10px] flex items-center gap-0.5">
                <Plus className="w-3 h-3" />
                {compact ? "" : placeholder}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          <div className="p-2 border-b">
            <Input
              placeholder="Search..."
              className="h-7 text-xs"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              autoFocus
              data-testid="inline-link-search"
            />
          </div>
          <ScrollArea className="max-h-[200px]">
            <div className="p-1">
              {value && (
                <button
                  type="button"
                  className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent rounded-sm flex items-center gap-1"
                  onClick={() => { onSave(null); setOpen(false); setFilterText(""); }}
                  data-testid="inline-link-clear"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
              {filtered.slice(0, 50).map(o => (
                <button
                  key={o.id}
                  type="button"
                  className={`w-full text-left px-2 py-1.5 text-xs hover:bg-accent rounded-sm truncate ${o.id === value ? "bg-accent font-medium" : ""}`}
                  onClick={() => { onSave(o.id); setOpen(false); setFilterText(""); }}
                  data-testid={`inline-link-option-${o.id}`}
                >
                  {o.name}
                </button>
              ))}
              {filtered.length === 0 && !onCreate && (
                <p className="text-xs text-muted-foreground text-center py-2">No matches</p>
              )}
              {onCreate && filterText.trim() && !filtered.some(o => o.name.toLowerCase() === filterText.trim().toLowerCase()) && (
                <button
                  type="button"
                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-accent rounded-sm flex items-center gap-1 text-primary border-t mt-1 pt-2"
                  onClick={() => { onCreate(filterText.trim()); setOpen(false); setFilterText(""); }}
                  data-testid="inline-link-create"
                >
                  <Plus className="w-3 h-3" /> Create "{filterText.trim()}"
                </button>
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}
