"use client";

import { useState } from "react";
import { IssueLink, ServiceRepo } from "@/types";

/**
 * Linked pull requests, issues and commits, with the state GitHub last reported.
 *
 * State is a cache refreshed by webhook, and it is optional: a link is stored
 * even when GitHub could not be reached, so a chip with no state means "we have
 * not heard" rather than "it is open". They are rendered differently for exactly
 * that reason.
 */
export function IssueLinks({
  links,
  repository,
  onLink,
  onUnlink,
}: {
  links: IssueLink[];
  repository?: ServiceRepo;
  onLink: (url: string) => Promise<void>;
  onUnlink: (link: IssueLink) => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onLink(input.trim());
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {links.length > 0 && (
        <ul className="mb-3 space-y-2">
          {links.map((link) => (
            <li
              key={link.id}
              className="group flex items-center gap-2 rounded-md border border-zinc-200 px-2.5 py-1.5 dark:border-zinc-800"
            >
              <LinkStateDot link={link} />
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-sm text-blue-600 hover:underline dark:text-blue-400"
              >
                {link.owner && link.repo && link.number
                  ? `${link.owner}/${link.repo}#${link.number}`
                  : link.url}
                {link.title ? (
                  <span className="ml-1.5 text-zinc-600 dark:text-zinc-400">
                    {link.title}
                  </span>
                ) : null}
              </a>
              <button
                onClick={() => onUnlink(link)}
                className="shrink-0 text-xs text-zinc-400 opacity-0 transition-opacity hover:text-red-600 focus:opacity-100 group-hover:opacity-100 dark:hover:text-red-400"
                aria-label="Remove link"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            // The shorthand only resolves for a service with a mapped
            // repository, so the placeholder only offers it when it will work.
            repository
              ? `#42, or a GitHub URL (${repository.owner}/${repository.repo})`
              : "Paste a GitHub pull request, issue or commit URL"
          }
          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {busy ? "Linking…" : "Link"}
        </button>
      </form>
      {error && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

function LinkStateDot({ link }: { link: IssueLink }) {
  // merged is checked before state, since a merged PR is also "closed" and the
  // merge is the more useful fact.
  const { color, label } = link.merged
    ? { color: "bg-purple-500", label: "Merged" }
    : link.state === "open"
      ? { color: "bg-emerald-500", label: "Open" }
      : link.state === "closed"
        ? { color: "bg-red-500", label: "Closed" }
        : { color: "bg-zinc-300 dark:bg-zinc-600", label: "State unknown" };

  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${color}`}
      title={label}
      aria-label={label}
    />
  );
}
