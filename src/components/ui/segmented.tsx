"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Segmented — a row of mutually exclusive preset buttons: time ranges
 * (1h · 6h · 24h · 7d · 30d), a list/board switch, a group-by.
 *
 *   <Segmented label="Time range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
 *
 * Each page used to hand-roll this as bare buttons whose only "selected" signal
 * was a blue fill — invisible to a screen reader, which heard five unrelated
 * buttons. This is `role=group` named by `label`, with `aria-pressed` on every
 * button so the current choice is announced, and a visible focus ring.
 *
 * ⚠️ NOT A TABLIST. Use `ui/tabs.tsx` when the choice swaps a whole panel of
 * content; use this when it re-parameterises the same content (a range, a
 * view mode). Every segment stays its own Tab stop, as buttons do.
 *
 * Pair it with `useUrlState` when the choice should survive a reload.
 */

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Tooltip, and the accessible name when `label` is an icon. */
  title?: string;
}

interface SegmentedProps<T extends string> {
  /** Accessible name of the group, e.g. "Time range". Required. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "sm",
  disabled,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700",
        className,
      )}
    >
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            title={option.title}
            aria-label={option.title && typeof option.label !== "string" ? option.title : undefined}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "border-r border-zinc-200 font-medium transition-colors last:border-r-0 dark:border-zinc-700",
              "focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500",
              "disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm" ? "px-3 py-2 text-xs" : "px-4 py-2 text-sm",
              pressed
                ? "bg-blue-600 text-white"
                : "bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
