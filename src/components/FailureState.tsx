"use client";

import { cn } from "@/lib/utils";

/**
 * DOWN MUST NEVER RENDER AS EMPTY.
 *
 * An empty result and a failed request are different facts about the world, and
 * they must look different. The shared axios client sets
 * `validateStatus: () => true`, so a 500 arrives as a VALUE rather than a throw
 * — which means every `res.success ? res.data : []` quietly launders a broken
 * backend into a tidy "nothing here", and the catch block underneath it is dead
 * code for HTTP failures.
 *
 * Commit c68b6c4 recorded the cost on the errors page: "no issues" is the most
 * misleading possible reading of a 500. The scope dimension makes that routine
 * rather than rare — "this project has no services" and "the project selector is
 * broken" are the same empty dropdown unless something says otherwise.
 *
 * So these render INSTEAD of an empty state, never beside it. Both name what
 * failed and offer a way to try again; a dead end the user cannot retry is only
 * marginally better than a lie.
 */

interface FailureStateProps {
  /** What could not be loaded, as a plural noun: "issues", "alert rules". */
  what: string;
  /** `error_message` off the ApiError. Shown verbatim — it is the only fact. */
  message?: string | null;
  onRetry?: () => void;
  className?: string;
}

/**
 * The block form. Occupies the space an empty state would have taken, so the two
 * can never appear together — the caller picks one branch or the other.
 */
export function FailureState({
  what,
  message,
  onRetry,
  className,
}: FailureStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-2 border border-[#ef4444]/20 bg-[#ef4444]/5 rounded-xl px-6 py-12 text-center",
        className,
      )}
    >
      <span className="h-2 w-2 rounded-full bg-[#ef4444]" aria-hidden />
      <p className="text-sm font-medium text-red-600 dark:text-red-400">
        Couldn&apos;t load {what}
      </p>
      {/* The distinction the whole component exists for, said out loud: this is
          a failed request, not an absence of data. Without the second line a red
          box still leaves "…so there are none?" open. */}
      <p className="max-w-md text-xs text-zinc-500 dark:text-zinc-400">
        {message || "The request failed."} This is a failed request, not an empty
        result — the data may still be there.
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 rounded-md px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-[#ef4444]/10 dark:text-red-400"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * The inline form, for surfaces too small to give a panel to — a filter row, a
 * dropdown, a supporting section on a page that is otherwise fine.
 *
 * Used where the failure is PARTIAL: the page still has something worth reading,
 * and blanking it would trade one lie for another.
 */
export function FailureNote({
  what,
  message,
  onRetry,
  className,
}: FailureStateProps) {
  return (
    <span
      role="alert"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400",
        className,
      )}
      title={message || undefined}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[#ef4444]" aria-hidden />
      Couldn&apos;t load {what}
      {onRetry && (
        <button
          onClick={onRetry}
          className="underline underline-offset-2 transition-colors hover:text-red-500"
        >
          Retry
        </button>
      )}
    </span>
  );
}
