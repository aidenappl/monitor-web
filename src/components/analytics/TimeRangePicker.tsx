"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  TimeRange,
  TIME_RANGES,
  TIME_RANGE_LABELS,
  customRange,
  isCustomRange,
} from "@/tools/timeRange.tools";

interface TimeRangePickerProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  /** Preset buttons. Defaults to TIME_RANGES. */
  presets?: TimeRange[];
  /** Offer "Custom…" (an absolute from/to). Default true. */
  allowCustom?: boolean;
  className?: string;
}

/** A Date as a `datetime-local` value, in local time. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Presets as a row of toggle buttons (aria-pressed, so the selected one is
 * announced, not just coloured) plus a "Custom…" popover with two
 * datetime-local inputs. Pair it with `rangeToParam` / `rangeFromParam` to
 * keep the choice in the URL.
 */
export function TimeRangePicker({
  value,
  onChange,
  presets = TIME_RANGES,
  allowCustom = true,
  className = "",
}: TimeRangePickerProps) {
  const custom = isCustomRange(value);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const close = (refocus = true) => {
    setOpen(false);
    setError(null);
    if (refocus) triggerRef.current?.focus();
  };

  const openCustom = () => {
    // The clock is read here, in the handler, never during render.
    const now = new Date();
    const start = custom ? new Date(value.from) : new Date(now.getTime() - 3_600_000);
    const end = custom ? new Date(value.to) : now;
    setFrom(toLocalInput(start));
    setTo(toLocalInput(end));
    setError(null);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    fromRef.current?.focus();
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
      setError(null);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const apply = () => {
    const range = customRange(from, to);
    if (!range) {
      setError(from && to ? "The end must be after the start." : "Enter both a start and an end.");
      return;
    }
    onChange(range);
    close();
  };

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
      apply();
    }
  };

  const btn = (selected: boolean) =>
    `px-3 py-2 text-xs font-medium transition-colors border-r last:border-r-0 border-zinc-200 dark:border-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
      selected
        ? "bg-blue-600 text-white"
        : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
    }`;

  return (
    <div className={`relative inline-flex ${className}`}>
      <div
        role="group"
        aria-label="Time range"
        className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden"
      >
        {presets.map((range) => {
          const selected = !custom && value.from === range.from && value.to === range.to;
          return (
            <button
              key={range.label}
              type="button"
              aria-pressed={selected}
              title={range.label}
              onClick={() => onChange(range)}
              className={btn(selected)}
            >
              {TIME_RANGE_LABELS[range.from] ?? range.label}
            </button>
          );
        })}
        {allowCustom && (
          <button
            ref={triggerRef}
            type="button"
            aria-pressed={custom}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-controls={open ? `${id}-panel` : undefined}
            title={custom ? `Custom: ${value.label}` : "Custom range"}
            onClick={() => (open ? close() : openCustom())}
            className={`${btn(custom)} max-w-[14rem] truncate`}
          >
            {custom ? value.label : "Custom…"}
          </button>
        )}
      </div>

      {open && (
        <div
          ref={panelRef}
          id={`${id}-panel`}
          role="dialog"
          aria-label="Custom time range"
          onKeyDown={onPanelKeyDown}
          className="absolute right-0 top-full mt-2 z-30 w-72 max-w-[calc(100vw-2rem)] p-3 space-y-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg"
        >
          <div className="space-y-1">
            <label htmlFor={`${id}-from`} className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              From
            </label>
            <input
              ref={fromRef}
              id={`${id}-from`}
              type="datetime-local"
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value);
                setError(null);
              }}
              className="w-full px-2 py-1.5 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${id}-to`} className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              To
            </label>
            <input
              id={`${id}-to`}
              type="datetime-local"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              className="w-full px-2 py-1.5 text-base sm:text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && (
            <p id={`${id}-error`} role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Times are local. Raw events are kept for 30 days.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => close()}
              className="px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
