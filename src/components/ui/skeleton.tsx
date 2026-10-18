import { cn } from "@/lib/utils";

/**
 * THE LOADING SET, part 2: placeholders shaped like what is coming. Part 1
 * (spinners, `RefetchBar`, and when to use which) is `ui/spinner.tsx`.
 *
 * ⚠️ A SKELETON MUST BE THE HEIGHT OF WHAT REPLACES IT. One that settles into
 * a different shape is worse than none — the jump is the thing a skeleton
 * exists to prevent. Size rows to the real row (`rowClass`), and render the
 * page's header and controls for real rather than skeletoning them.
 *
 * Skeletons are for the FIRST answer only. After that, keep the old content on
 * screen and show `RefetchBar`.
 */

/** One placeholder block. Give it a width and height with `className`. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
    return <div className={cn("animate-pulse rounded bg-zinc-200 dark:bg-zinc-800", className)} style={style} aria-hidden />;
}

// Varying widths so a block reads as content rather than a striped graphic.
const WIDE = [62, 78, 45, 70, 55, 84, 50, 66];
const NARROW = [34, 28, 40, 30, 36, 26, 38, 32];

/**
 * A list of rows: an optional leading square, a title line and a subtitle line.
 * `rowClass` sets each row's height — match the real row's.
 */
export function SkeletonRows({
    rows,
    label,
    rowClass = "h-[76px]",
    leading = true,
    className,
}: {
    rows: number;
    label: string;
    rowClass?: string;
    leading?: boolean;
    className?: string;
}) {
    return (
        <div role="status" aria-label={label} className={cn("divide-y divide-zinc-100 dark:divide-zinc-800", className)}>
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} className={cn("flex items-center gap-3 px-4 py-3", rowClass)}>
                    {leading && <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />}
                    <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-3.5" style={{ width: `${WIDE[i % 8]}%` }} />
                        <Skeleton className="h-3 bg-zinc-100 dark:bg-zinc-800/60" style={{ width: `${NARROW[i % 8]}%` }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

/**
 * Table body rows: `columns` cells per row at `rowClass` height. Render the
 * real `<thead>` yourself and put this in place of the body, or use it alone
 * where the header is part of the loaded content.
 */
export function SkeletonTable({
    rows,
    columns,
    label,
    rowClass = "h-12",
    className,
}: {
    rows: number;
    columns: number;
    label: string;
    rowClass?: string;
    className?: string;
}) {
    return (
        <div role="status" aria-label={label} className={cn("divide-y divide-zinc-100 dark:divide-zinc-800", className)}>
            {Array.from({ length: rows }, (_, r) => (
                <div key={r} className={cn("flex items-center gap-4 px-4", rowClass)}>
                    {Array.from({ length: columns }, (_, c) => (
                        <Skeleton
                            key={c}
                            className={cn("h-3", c === 0 ? "flex-[2]" : "flex-1")}
                            style={{ maxWidth: `${c === 0 ? WIDE[(r + c) % 8] : NARROW[(r + c) % 8] * 2}%` }}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}

/**
 * Card placeholders. `className` sets each card's size (match the real card),
 * `gridClass` the layout they sit in.
 */
export function SkeletonCards({
    count,
    label,
    className = "h-28",
    gridClass = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4",
}: {
    count: number;
    label: string;
    className?: string;
    gridClass?: string;
}) {
    return (
        <div role="status" aria-label={label} className={gridClass}>
            {Array.from({ length: count }, (_, i) => (
                <div
                    key={i}
                    className={cn(
                        "space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900",
                        className,
                    )}
                >
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-7 w-1/2" />
                    <Skeleton className="h-2.5 w-2/3 bg-zinc-100 dark:bg-zinc-800/60" />
                </div>
            ))}
        </div>
    );
}
