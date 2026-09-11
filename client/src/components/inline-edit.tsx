import { useState, useRef, useEffect, useMemo, useCallback, useId } from "react";
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

type InlineSave<T> = (value: T) => void | Promise<void>;

function parseInlineNumber(draft: string): number | null {
  const text = draft.trim();
  if (!text) return null;
  // Require the whole value, including valid thousands groups when commas
  // are used. parseFloat silently turns entries such as "120k" into 120.
  if (!/^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)$/.test(text)) {
    throw new Error("Enter a number, such as -1,200.50, or leave blank.");
  }
  const number = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(number)) throw new Error("Enter a finite number or leave blank.");
  return number;
}

function useInlineDraft<T>(initial: string, value: T, onSave: InlineSave<T>, parse: (draft: string) => T, commitOnUnmount = false) {
  const [state, setState] = useState({ editing: false, draft: initial, saving: false, error: null as string | null });
  const stateRef = useRef(state);
  const mounted = useRef(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const errorId = useId();

  const update = (patch: Partial<typeof state>) => {
    // Event handlers can run before React renders (Enter followed by blur,
    // or a popover unmount). Keep the save/cancel guard synchronous.
    stateRef.current = { ...stateRef.current, ...patch };
    if (mounted.current) setState(stateRef.current);
  };
  const close = () => {
    update({ editing: false, saving: false, error: null });
  };
  const save = (draft = stateRef.current.draft, focus = false) => {
    if (!stateRef.current.editing || stateRef.current.saving) return;
    let next: T;
    try {
      next = parse(draft);
    } catch (error) {
      update({ error: error instanceof Error ? error.message : "Check this value and try again." });
      return;
    }
    restoreFocus.current = focus;
    if (next === value) { close(); return; }
    update({ saving: true, error: null });
    const failed = () => update({ saving: false, error: "Could not save. Try again or press Escape to cancel." });
    try {
      const result = onSave(next);
      if (result && typeof result.then === "function") {
        void Promise.resolve(result).then(close, failed);
      } else {
        close();
      }
    } catch {
      failed();
    }
  };
  const unmountRef = useRef({ save, commitOnUnmount });
  unmountRef.current = { save, commitOnUnmount };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = stateRef.current;
      // Number fields inside popovers retain their existing outside-click
      // commit. Never retry a failed save, pending request or cancelled edit.
      if (unmountRef.current.commitOnUnmount && current.editing && !current.saving && !current.error) {
        unmountRef.current.save();
      }
    };
  }, []);
  useEffect(() => {
    if (!state.editing && restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [state.editing]);

  return {
    ...state, triggerRef, errorId, save,
    begin: () => update({ editing: true, draft: initial, error: null }),
    change: (draft: string) => { if (!stateRef.current.saving) update({ draft, error: null }); },
    cancel: () => {
      // A request already sent cannot be cancelled by hiding its editor.
      if (!stateRef.current.saving) { restoreFocus.current = true; update({ draft: initial }); close(); }
    },
    blur: (event: React.FocusEvent<HTMLSpanElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        restoreFocus.current = false;
        if (!stateRef.current.error) save();
      }
    },
  };
}

function InlineEditFeedback({ saving, error, errorId, retry, cancel }: {
  saving: boolean; error: string | null; errorId: string; retry: () => void; cancel: () => void;
}) {
  if (saving) return <span role="status" className="block text-[11px] text-muted-foreground" data-testid="inline-edit-saving">Saving…</span>;
  if (!error) return null;
  return (
    <span className="block text-[11px] text-destructive" data-testid="inline-edit-error">
      <span id={errorId} role="alert">{error}</span>{" "}
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={retry} className="underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" data-testid="inline-edit-retry">Save</button>{" "}
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={cancel} className="underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Cancel</button>
    </span>
  );
}

interface InlineTextProps {
  value: string | null | undefined;
  onSave: InlineSave<string>;
  label?: string;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  maxLines?: number;
}

export function InlineText({ value, onSave, label, placeholder = "—", className = "", multiline = false, maxLines }: InlineTextProps) {
  const editor = useInlineDraft(value || "", value || "", onSave, (draft) => draft.trim());
  const { editing, draft, saving, error, errorId } = editor;
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      editor.save(undefined, true);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      editor.cancel();
    }
  };

  if (editing) {
    const inputClass = "w-full px-1.5 py-0.5 text-xs border border-primary/40 rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 " + className;
    const inputProps = {
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => editor.change(e.target.value),
      onKeyDown: handleKeyDown,
      readOnly: saving,
      "aria-label": label || "Text",
      "aria-invalid": !!error,
      "aria-describedby": error ? errorId : undefined,
    };
    return (
      <span className="inline-block w-full align-middle" onBlur={editor.blur} aria-busy={saving}>
        {multiline ? (
          <textarea
            {...inputProps}
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            className={inputClass + " min-h-[48px] resize-none"}
            data-testid="inline-edit-textarea"
          />
        ) : (
          <input
            {...inputProps}
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            className={inputClass}
            data-testid="inline-edit-text"
          />
        )}
        <InlineEditFeedback {...editor} retry={() => editor.save(undefined, true)} cancel={editor.cancel} />
      </span>
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
      className={`cursor-pointer hover:bg-muted/60 rounded px-1.5 py-0.5 text-xs inline-block max-w-full align-bottom min-w-[2rem] transition-colors ${!value ? "text-muted-foreground italic" : ""} ${className}`}
      data-testid="inline-edit-display"
    >
      <button
        type="button"
        ref={editor.triggerRef}
        onClick={editor.begin}
        aria-label={label ? `Edit ${label}` : "Edit text"}
        className="text-left max-w-full rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        style={clampStyle}
        data-testid="inline-edit-trigger"
      >
        {value || placeholder}
      </button>
      {maxLines && value && value.length > 60 && !expanded && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
          className="text-[10px] text-primary hover:underline ml-1"
          data-testid="inline-edit-expand"
        >
          more
        </button>
      )}
      {maxLines && expanded && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
          className="text-[10px] text-primary hover:underline ml-1"
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
  onSave: InlineSave<number | null>;
  label?: string;
  placeholder?: string;
  className?: string;
  prefix?: string;
  suffix?: string;
  format?: (val: number) => string;
}

export function InlineNumber({ value, onSave, label, placeholder = "—", className = "", prefix = "", suffix = "", format }: InlineNumberProps) {
  const editor = useInlineDraft(value?.toString() || "", value ?? null, onSave, parseInlineNumber, true);
  const { editing, draft, saving, error, errorId } = editor;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") { e.preventDefault(); editor.save(undefined, true); }
    if (e.key === "Escape") { e.preventDefault(); editor.cancel(); }
  };

  if (editing) {
    return (
      <span className="inline-block w-full align-middle" onBlur={editor.blur} aria-busy={saving}>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => editor.change(e.target.value)}
          onKeyDown={handleKeyDown}
          readOnly={saving}
          aria-label={label || "Number"}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className={"w-full px-1.5 py-0.5 text-xs font-mono tabular-nums border border-primary/40 rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 " + className}
          data-testid="inline-edit-number"
        />
        <InlineEditFeedback {...editor} retry={() => editor.save(undefined, true)} cancel={editor.cancel} />
      </span>
    );
  }

  const displayVal = value != null
    ? `${prefix}${format ? format(value) : value.toLocaleString("en-GB")}${suffix}`
    : null;

  return (
    <button
      type="button"
      ref={editor.triggerRef}
      onClick={editor.begin}
      aria-label={label ? `Edit ${label}` : "Edit number"}
      className={`cursor-pointer hover:bg-muted/60 rounded px-1.5 py-0.5 text-xs text-left font-mono tabular-nums inline-block min-w-[2rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${!displayVal ? "text-muted-foreground italic" : ""} ${className}`}
      data-testid="inline-edit-display"
    >
      {displayVal || placeholder}
    </button>
  );
}

interface InlineSelectProps {
  value: string | null | undefined;
  options: readonly string[] | string[];
  onSave: InlineSave<string>;
  label?: string;
  placeholder?: string;
  className?: string;
  allowClear?: boolean;
}

export function InlineSelect({ value, options, onSave, label, placeholder = "—", className = "", allowClear = true }: InlineSelectProps) {
  const editor = useInlineDraft(value || "", value || "", onSave, (draft) => draft);
  const { editing, draft, saving, error, errorId } = editor;
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (editing && selectRef.current) {
      selectRef.current.focus();
    }
  }, [editing]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newVal = e.target.value;
    editor.change(newVal);
    editor.save(newVal, true);
  };

  if (editing) {
    return (
      <span className="inline-block w-full align-middle" onBlur={editor.blur} aria-busy={saving}>
        <select
          ref={selectRef}
          value={draft}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Escape") { e.preventDefault(); editor.cancel(); }
            if (e.key === "Enter") { e.preventDefault(); editor.save(undefined, true); }
          }}
          disabled={saving}
          aria-label={label || "Selection"}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className={"w-full px-1 py-0.5 text-xs border border-primary/40 rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 " + className}
          data-testid="inline-edit-select"
        >
          {allowClear && <option value="">— Clear —</option>}
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        <InlineEditFeedback {...editor} retry={() => editor.save(undefined, true)} cancel={editor.cancel} />
      </span>
    );
  }

  return (
    <button
      type="button"
      ref={editor.triggerRef}
      onClick={editor.begin}
      aria-label={label ? `Edit ${label}` : "Edit selection"}
      className={`cursor-pointer hover:bg-muted/60 rounded px-1.5 py-0.5 text-xs text-left inline-block max-w-full align-bottom min-w-[2rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${!value ? "text-muted-foreground italic" : ""} ${className}`}
      data-testid="inline-edit-display"
    >
      {value || placeholder}
    </button>
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
    <div className="relative min-w-0 max-w-full">
      {value ? (
        <button
          ref={triggerRef}
          onClick={openDropdown}
          className={`${bg} text-white font-medium rounded-full cursor-pointer hover:opacity-90 transition-opacity whitespace-nowrap overflow-hidden text-ellipsis max-w-full inline-block align-middle ${compact ? "text-[10px] px-2 py-0.5" : "text-[11px] px-2.5 py-1"}`}
          data-testid="inline-label-display"
          title={(value && labelMap?.[value]) || value}
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
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const dateStr = value ? value.split("T")[0] : "";

  // Commit on blur / Enter, not on change — a native date input fires
  // change per segment while typing, so saving there wrote half-formed
  // dates and closed the editor out from under the user.
  const commit = () => {
    setEditing(false);
    const newVal = draft || null;
    if (newVal !== (dateStr || null)) {
      onSave(newVal);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setDraft(dateStr); setEditing(false); }
        }}
        className={"px-1 py-0.5 text-xs border border-primary/40 rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary/30 " + className}
        data-testid="inline-edit-date"
      />
    );
  }

  const display = value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

  return (
    <span
      onClick={() => { setDraft(dateStr); setEditing(true); }}
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
          <DropdownMenuItem key={opt.value} onSelect={e => { e.preventDefault(); toggle(opt.value); }}>
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
    <div className="flex items-center gap-1 min-w-0 max-w-full">
      {!compact && selectedName && href ? (
        <Link href={href} className="min-w-0 flex-1">
          <span className="text-xs text-primary hover:underline cursor-pointer truncate block" title={selectedName}>
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
