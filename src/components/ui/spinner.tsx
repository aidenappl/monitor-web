"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * THE LOADING SET, part 1: things that spin. Part 2 is `ui/skeleton.tsx`.
 *
 * Which one to reach for (AGENTS.md §5, "Loading states"):
 *   - FIRST load of content whose shape you know  → a skeleton (`ui/skeleton`)
 *   - first load of content whose shape you don't → `LoadingBlock`
 *   - a REFETCH of content already on screen      → keep it, show `RefetchBar`
 *   - an action in flight inside a button/row     → `ButtonSpinner` (or `Button loading`)
 *   - a refresh button                            → spin its own arrow icon
 *                                                   (`<FontAwesomeIcon icon={faArrowsRotate} spin={busy} />`)
 *
 * ⚠️ `faSpinner` is banned outside this folder (scripts/guards.mjs, guard 3).
 * Twenty one-off `faSpinner animate-spin` blocks, each a different size and
 * colour, in a box shorter than the content that replaced it, were what made
 * every page jump on load. One set, used everywhere, is the fix.
 */

/**
 * Shows its children only after `delay` ms. A load that finishes before then
 * never flashes a spinner, which reads as faster than a spinner that blinks.
 */
function useDelayed(delay: number): boolean {
    const [shown, setShown] = useState(delay <= 0);
    useEffect(() => {
        if (delay <= 0) return;
        const t = window.setTimeout(() => setShown(true), delay);
        return () => window.clearTimeout(t);
    }, [delay]);
    return shown;
}

/** A circular spinner. `delay` (ms) holds it back so quick loads don't flash. */
export function Spinner({
    size = 24,
    label = "Loading",
    delay = 0,
    className,
}: {
    size?: number;
    label?: string;
    delay?: number;
    className?: string;
}) {
    const shown = useDelayed(delay);
    return (
        <span
            className={cn(
                "inline-block rounded-full border-2 border-zinc-300 border-t-blue-600 dark:border-zinc-700 dark:border-t-blue-400",
                shown ? "animate-spin" : "opacity-0",
                className,
            )}
            style={{ width: size, height: size }}
            role="status"
            aria-label={label}
        />
    );
}

/** An inline spinner sized to sit inside a button or a row action without shifting its text. */
export function ButtonSpinner({ className = "" }: { className?: string }) {
    return (
        <svg className={cn("h-3.5 w-3.5 shrink-0 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
        </svg>
    );
}

/**
 * A thin indeterminate bar for a REFETCH. Used instead of swapping content for
 * a spinner: replacing what someone is reading loses their place and reads as
 * slower than it is, even when the request is quick.
 */
export function RefetchBar({ active, className }: { active: boolean; className?: string }) {
    return (
        <div
            className={cn("relative h-0.5 overflow-hidden", className)}
            role="status"
            aria-live="polite"
            aria-label={active ? "Loading" : ""}
        >
            {active && <div className="animate-issue-progress absolute inset-y-0 w-1/3 rounded-full bg-blue-500/80" />}
        </div>
    );
}

/**
 * A centred, delayed spinner in a box that RESERVES HEIGHT, for a first load
 * whose shape isn't known yet (an auth gate, a panel that may hold anything).
 * Set `className` to roughly the height of what replaces it (default min-h-48),
 * so the page below doesn't jump when it lands. Prefer a skeleton whenever the
 * shape IS known.
 */
export function LoadingBlock({ label = "Loading", className }: { label?: string; className?: string }) {
    return (
        <div className={cn("flex min-h-48 flex-col items-center justify-center gap-3", className)}>
            <Spinner label={label} delay={150} />
            <span className="sr-only">{label}</span>
        </div>
    );
}
