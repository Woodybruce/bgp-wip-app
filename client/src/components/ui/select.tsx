"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

// ── Type-to-filter support ───────────────────────────────────────────────
// Any SelectContent with 10+ items automatically grows a search box at the
// top: type and the list filters live. Opt in/out explicitly with the
// `searchable` prop. Filtering matches on the visible text of each
// SelectItem (groups are recursed into; labels/separators are left alone).

function selectNodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(selectNodeText).join(" ")
  if (React.isValidElement(node)) return selectNodeText((node.props as any).children)
  return ""
}

function countSelectItems(children: React.ReactNode): number {
  let count = 0
  for (const node of React.Children.toArray(children)) {
    if (!React.isValidElement(node)) continue
    if (node.type === SelectItem) count++
    else if ((node.props as any)?.children) count += countSelectItems((node.props as any).children)
  }
  return count
}

function filterSelectChildren(children: React.ReactNode, query: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  for (const node of React.Children.toArray(children)) {
    if (!React.isValidElement(node)) { out.push(node); continue }
    if (node.type === SelectItem) {
      if (selectNodeText((node.props as any).children).toLowerCase().includes(query)) out.push(node)
      continue
    }
    if (node.type === SelectGroup) {
      const inner = filterSelectChildren((node.props as any).children, query)
      // Drop a group whose items all filtered out (a bare label is noise).
      if (inner.some(n => React.isValidElement(n) && n.type === SelectItem)) {
        out.push(React.cloneElement(node as React.ReactElement, undefined, inner))
      }
      continue
    }
    out.push(node)
  }
  return out
}

const SEARCHABLE_AUTO_THRESHOLD = 10

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content> & { searchable?: boolean }
>(({ className, children, position = "popper", searchable, ...props }, ref) => {
  const [query, setQuery] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)
  const enableSearch =
    searchable === true ||
    (searchable !== false && countSelectItems(children) >= SEARCHABLE_AUTO_THRESHOLD)
  const q = query.trim().toLowerCase()
  const shown = enableSearch && q ? filterSelectChildren(children, q) : children
  const nothingShown =
    enableSearch && q && !React.Children.toArray(shown).some(n => React.isValidElement(n) && n.type === SelectItem)

  // Desktop: focus the search box on open so "open then type" just works.
  // Touch devices skip the autofocus — popping the on-screen keyboard over
  // the list would be worse than tapping the box deliberately.
  React.useEffect(() => {
    if (!enableSearch) return
    if (typeof window !== "undefined" && "ontouchstart" in window) return
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [enableSearch])

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          "relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        // Focus on an item + a printable keystroke = the user started typing
        // a search — capture it into the box instead of Radix's prefix-jump.
        onKeyDownCapture={enableSearch ? (e) => {
          const el = inputRef.current
          if (!el || e.target === el) return
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            setQuery(prev => prev + e.key)
            el.focus()
            e.preventDefault()
            e.stopPropagation()
          } else if (e.key === "Backspace") {
            setQuery(prev => prev.slice(0, -1))
            el.focus()
            e.preventDefault()
            e.stopPropagation()
          }
        } : undefined}
        {...props}
      >
        {enableSearch && (
          <div className="sticky top-0 z-10 border-b bg-popover p-1">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to search…"
              className="h-7 w-full rounded-sm border-0 bg-muted/60 px-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
              onKeyDown={(e) => {
                // Keep typing local to the box; let navigation keys reach
                // Radix (arrows move into the list, Escape closes).
                if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Escape" || e.key === "Tab") return
                if (e.key === "Enter") {
                  // Enter from the box steps into the first visible option.
                  const first = (e.currentTarget.closest("[role=listbox]") || e.currentTarget.parentElement?.parentElement)
                    ?.querySelector<HTMLElement>("[role=option]:not([data-disabled])")
                  if (first) { first.focus(); e.preventDefault() }
                  e.stopPropagation()
                  return
                }
                e.stopPropagation()
              }}
            />
          </div>
        )}
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
          )}
        >
          {shown}
          {nothingShown && (
            <div className="px-2 py-3 text-center text-sm text-muted-foreground">No matches</div>
          )}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
})
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>

    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
