"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface CheckboxProps {
  checked: boolean;
  /** Renders the "some, not all" dash. Only meaningful on a select-all box. */
  indeterminate?: boolean;
  /** Receives the click so a list can read `shiftKey` for range selection. */
  onChange: (e: React.MouseEvent<HTMLInputElement>) => void;
  /**
   * The accessible name. Required for a bare checkbox — in a row it announces
   * nothing but "checkbox". Omit it ONLY when the box sits inside a visible
   * <label>, which names it (an aria-label would override that text).
   */
  label?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * The checkbox: bulk-action selection, and every form toggle.
 *
 * Driven by onClick rather than onChange: the change event does not carry
 * `shiftKey`, and shift-click range selection is the reason this exists.
 */
export function Checkbox({ checked, indeterminate, onChange, label, id, disabled, className }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      checked={checked}
      // Controlled through onClick; React still wants a change handler.
      onChange={() => {}}
      onClick={(e) => {
        e.stopPropagation();
        onChange(e);
      }}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "h-4 w-4 shrink-0 cursor-pointer rounded border-zinc-300 accent-blue-600 dark:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    />
  );
}
