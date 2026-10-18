/**
 * Placeholder rows while a list loads, at roughly the height of the real rows.
 *
 * A centred spinner was ~150px and the list that replaced it several times
 * that, so everything below it (and the page's scrollbar) jumped when data
 * landed — CLS 0.32 on this page. Reserving the height keeps the swap still.
 */
export function ListSkeleton({ rows, rowClass = "h-[76px]", label }: { rows: number; rowClass?: string; label: string }) {
    return (
        <div role="status" aria-label={label} className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} className={`${rowClass} px-4 py-3 flex items-center gap-3`}>
                    <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse shrink-0" />
                    <div className="flex-1 space-y-2">
                        <div className="h-3 w-1/3 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                        <div className="h-3 w-1/2 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                    </div>
                </div>
            ))}
        </div>
    );
}

/** The policy pipeline's placeholder: numbered cards at the real cards' height. */
export function PolicySkeleton({ rows }: { rows: number }) {
    return (
        <div role="status" aria-label="Loading policies">
            {Array.from({ length: rows }, (_, i) => (
                <div key={i}>
                    <div className="flex items-stretch gap-3">
                        <div className="pt-3.5 shrink-0">
                            <div className="w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-800" />
                        </div>
                        <div className="flex-1 min-w-0 h-[118px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 space-y-2.5">
                            <div className="h-3.5 w-2/5 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                            <div className="h-3 w-1/3 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                            <div className="h-3 w-1/4 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                        </div>
                    </div>
                    {i < rows - 1 && <div className="h-6" />}
                </div>
            ))}
        </div>
    );
}
