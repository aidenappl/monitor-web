"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { reportError } from "@/services/monitor.service";

/**
 * The error boundary for every page under the root layout — the navbar, theme
 * and scope control stay on screen, only the page body is replaced.
 *
 * The copy does not claim the error "has been reported": with MON_TELEMETRY_*
 * unset it has not been, and this app does not assert things it cannot know.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError("client.error.boundary", error, {
      outcome: "page body replaced by the error boundary",
    });
  }, [error]);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Error
        </p>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          This page hit an error
        </h1>
        <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          Something on this page failed while it was rendering. Try again, or
          reload the page if it keeps happening.
        </p>
      </div>

      {error.digest && (
        <p className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
          Reference: {error.digest}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
        <Button size="lg" variant="secondary" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      </div>
    </main>
  );
}
