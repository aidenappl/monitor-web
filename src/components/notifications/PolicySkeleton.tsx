import { Skeleton } from "@/components/ui/skeleton";

/** The policy pipeline's placeholder: numbered cards at the real cards' height. */
export function PolicySkeleton({ rows }: { rows: number }) {
    return (
        <div role="status" aria-label="Loading policies">
            {Array.from({ length: rows }, (_, i) => (
                <div key={i}>
                    <div className="flex items-stretch gap-3">
                        <div className="pt-3.5 shrink-0">
                            <Skeleton className="w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-800" />
                        </div>
                        <div className="flex-1 min-w-0 h-[118px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 space-y-2.5">
                            <Skeleton className="h-3.5 w-2/5 bg-zinc-100" />
                            <Skeleton className="h-3 w-1/3 bg-zinc-100" />
                            <Skeleton className="h-3 w-1/4 bg-zinc-100" />
                        </div>
                    </div>
                    {i < rows - 1 && <div className="h-6" />}
                </div>
            ))}
        </div>
    );
}
