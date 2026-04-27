import * as React from "react";
import { useRef, useState, useCallback, useEffect } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ChevronsUpDown } from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
 * Shared context – lets ComboboxOption close the dropdown on select
 * ──────────────────────────────────────────────────────────────────────────── */

const ComboboxCtx = React.createContext<{ close: () => void }>({ close: () => {} });

/* ────────────────────────────────────────────────────────────────────────────
 * ComboboxOption – a single selectable row inside the dropdown
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ComboboxOptionProps {
  selected?: boolean;
  onSelect: () => void;
  className?: string;
  children: React.ReactNode;
}

export function ComboboxOption({ selected, onSelect, className, children }: ComboboxOptionProps) {
  const { close } = React.useContext(ComboboxCtx);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
        "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none",
        selected && "bg-accent/50",
        className,
      )}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { onSelect(); close(); }}
    >
      {children}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * ComboboxEmpty – shown when there are no results
 * ──────────────────────────────────────────────────────────────────────────── */

export function ComboboxEmpty({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-3 py-5 text-center text-muted-foreground", className)}>
      {children}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * ComboboxLoading – skeleton / spinner while loading
 * ──────────────────────────────────────────────────────────────────────────── */

export function ComboboxLoading({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("px-3 py-2", className)}>
      {children ?? <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Combobox – the main searchable-select atom
 *
 * Uses Radix Popover under the hood so the dropdown:
 *  • renders via a portal (escapes overflow: hidden)
 *  • positions itself intelligently (flips when near edges)
 *  • manages focus correctly inside dialogs
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ComboboxProps {
  /** The text shown in the input */
  value: string;
  /** Called on every keystroke */
  onValueChange: (value: string) => void;
  /** Content rendered inside the dropdown (ComboboxOption, ComboboxEmpty, etc.) */
  children: React.ReactNode;
  /** Input placeholder */
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  /** Element rendered before the input (e.g. an icon) */
  inputPrefix?: React.ReactNode;
  /** Element rendered after the input (e.g. a spinner) */
  inputSuffix?: React.ReactNode;
  /** Whether the dropdown is forced open (for async search where parent controls open state) */
  open?: boolean;
  /** Called when open state changes */
  onOpenChange?: (open: boolean) => void;
}

const PAGE_SIZE = 5;

export function Combobox({
  value,
  onValueChange,
  children,
  placeholder,
  className,
  inputClassName,
  disabled,
  inputPrefix,
  inputSuffix,
  open: controlledOpen,
  onOpenChange,
}: ComboboxProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const inputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Stop wheel events from bubbling to document so react-remove-scroll
  // (used by Dialog) doesn't preventDefault() on portaled content.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener("wheel", stop);
    return () => el.removeEventListener("wheel", stop);
  });

  // Reset pagination when search text changes or dropdown reopens
  const prevValueRef = useRef(value);
  const prevOpenRef = useRef(open);
  if (prevValueRef.current !== value) {
    prevValueRef.current = value;
    if (visibleCount !== PAGE_SIZE) setVisibleCount(PAGE_SIZE);
  }
  if (open && !prevOpenRef.current && visibleCount !== PAGE_SIZE) {
    setVisibleCount(PAGE_SIZE);
  }
  prevOpenRef.current = open;

  const allChildren = React.Children.toArray(children);
  const hasMore = allChildren.length > visibleCount;
  const visibleChildren = hasMore ? allChildren.slice(0, visibleCount) : allChildren;
  const remaining = allChildren.length - visibleCount;
  const hasChildren = allChildren.length > 0;

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onValueChange(e.target.value);
      if (!open) setOpen(true);
    },
    [onValueChange, open, setOpen],
  );

  return (
    <PopoverPrimitive.Root open={open && hasChildren} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild onClick={(e) => e.preventDefault()}>
        <div className={cn("relative", className)}>
          {inputPrefix && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              {inputPrefix}
            </div>
          )}
          <Input
            ref={inputRef}
            value={value}
            onChange={handleInputChange}
            onFocus={() => !disabled && setOpen(true)}
            placeholder={placeholder}
            autoComplete="off"
            disabled={disabled}
            className={cn(
              inputPrefix && "pl-9",
              inputSuffix && "pr-9",
              inputClassName,
            )}
          />
          {inputSuffix && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              {inputSuffix}
            </div>
          )}
        </div>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={contentRef}
          align="start"
          sideOffset={4}
          className="z-50 w-[var(--radix-popover-trigger-width)] rounded-md border bg-popover shadow-md outline-none max-h-[252px] overflow-y-auto overscroll-contain data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <ComboboxCtx.Provider value={{ close: () => setOpen(false) }}>
            <div role="listbox">
              {visibleChildren}
              {hasMore && (
                <button
                  type="button"
                  className="flex w-full items-center justify-center px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-accent/50 border-t border-border"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                >
                  Show {remaining} more
                </button>
              )}
            </div>
          </ComboboxCtx.Provider>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * ComboboxTrigger – a button-style trigger variant (for TeamMemberSelect-like UI)
 *
 * Instead of an input, shows a button that opens a popover with a search input
 * inside the dropdown itself.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ComboboxTriggerProps {
  /** Display text on the button */
  displayValue: string;
  placeholder?: string;
  /** Search value inside the dropdown */
  search: string;
  onSearchChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
  searchPlaceholder?: string;
}

export function ComboboxTrigger({
  displayValue,
  placeholder,
  search,
  onSearchChange,
  children,
  className,
  buttonClassName,
  disabled,
  searchPlaceholder = "Search…",
}: ComboboxTriggerProps) {
  const [open, setOpen] = useState(false);
  const triggerContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = triggerContentRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener("wheel", stop);
    return () => el.removeEventListener("wheel", stop);
  });

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
            "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !displayValue && "text-muted-foreground",
            buttonClassName,
          )}
        >
          <span className="truncate">{displayValue || placeholder}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-2" />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={triggerContentRef}
          align="start"
          sideOffset={4}
          className={cn(
            "z-50 w-[var(--radix-popover-trigger-width)] rounded-md border bg-popover p-2 shadow-md outline-none max-h-72",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            className,
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 text-xs mb-2"
            autoFocus
          />
          <ComboboxCtx.Provider value={{ close: () => setOpen(false) }}>
            <div role="listbox" className="max-h-[200px] overflow-y-auto space-y-0.5">
              {children}
            </div>
          </ComboboxCtx.Provider>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
