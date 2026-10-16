"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCodeBranch, faPen, faPlus, faSpinner, faTrash } from "@fortawesome/free-solid-svg-icons";
import { ServiceRepo } from "@/types";
import { getLabelValues, reqDeleteServiceRepo, reqListServiceRepos, reqSetServiceRepo } from "@/services/api";
import { FailureState } from "@/components/FailureState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionBar } from "@/components/BulkActionBar";
import { useConfirm } from "@/components/ConfirmProvider";
import { useSelection } from "@/hooks/useSelection";
import { useRole } from "@/hooks/useRole";
import { useScope } from "@/hooks/useScope";
import { runBulk, toastBulkResult } from "@/tools/bulk.tools";
import { suggestionWindow } from "@/tools/timeRange.tools";

const INPUT =
    "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500";

/**
 * Service → source repository, for ONE project.
 *
 * The issues surface links pull requests and shows "owner/repo" from this
 * mapping, and the GitHub webhook resolves a PR to its issues through it. The
 * API has had full CRUD since the mapping existed and nothing in the app could
 * reach it: the only way to set one was curl or monitor-mcp.
 *
 * Explicit configuration rather than anything derived from the service name —
 * services span more than one GitHub org, and several services share a repo.
 */
export function ServiceReposTab() {
    const { zone, project } = useScope();
    const projectLabel = project ?? "the default project";
    const { canWrite } = useRole();
    const confirm = useConfirm();

    const [repos, setRepos] = useState<ServiceRepo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [services, setServices] = useState<string[]>([]);
    const [editing, setEditing] = useState<ServiceRepo | "new" | null>(null);
    const [busy, setBusy] = useState(false);

    const [reloadToken, setReloadToken] = useState(0);
    const fetchRepos = useCallback(() => {
        setLoading(true);
        setReloadToken((t) => t + 1);
    }, []);

    // Fetched inside the effect with a cancellation flag, every setState after
    // the first await — the shape the issues pages use, for the same reasons.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const [res, labels] = await Promise.all([
                reqListServiceRepos(),
                // Suggestions for the service field: services that reported
                // recently. Optional — a failure leaves the field free-text.
                getLabelValues("service", { window: suggestionWindow("labels") }),
            ]);
            if (cancelled) return;
            setLoading(false);
            if (labels.success) setServices(labels.data);
            if (!res.success) {
                setError(res.error_message || "The request failed.");
                return;
            }
            setError(null);
            setRepos(res.data ?? []);
        })();
        return () => {
            cancelled = true;
        };
    }, [reloadToken]);

    const ids = useMemo(() => repos.map((r) => r.service), [repos]);
    const selection = useSelection(ids);
    const unmapped = services.filter((s) => !repos.some((r) => r.service === s));

    const handleDelete = async (repo: ServiceRepo) => {
        const ok = await confirm({
            title: `Unmap ${repo.service}?`,
            description: `Its issues stop showing ${repo.owner}/${repo.repo}, and pull requests in that repository no longer link to them automatically. Existing links are kept.`,
            confirmLabel: "Remove mapping",
            destructive: true,
        });
        if (!ok) return;
        const res = await reqDeleteServiceRepo(repo.service);
        if (!res.success) {
            toast.error(res.error_message || "Could not remove the mapping");
            return;
        }
        toast.success(`${repo.service} unmapped`);
        fetchRepos();
    };

    const bulkDelete = async () => {
        const targets = repos.filter((r) => selection.isSelected(r.service));
        const ok = await confirm({
            title: `Remove ${targets.length} mapping${targets.length === 1 ? "" : "s"}?`,
            description: `${targets.map((r) => r.service).join(", ")} stop linking pull requests automatically. Existing links are kept.`,
            confirmLabel: `Remove ${targets.length}`,
            destructive: true,
        });
        if (!ok) return;
        setBusy(true);
        const result = await runBulk(targets, (r) => reqDeleteServiceRepo(r.service));
        setBusy(false);
        toastBulkResult(result, "Removed", "mapping");
        selection.clear();
        fetchRepos();
    };

    return (
        <section className="space-y-4">
            <div className="flex items-start justify-between gap-6">
                <div>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                        Source repositories — {zone} / {projectLabel}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        Which GitHub repository each service&apos;s code lives in. Issues show it, and pull requests opened there link to their issues
                        automatically.
                    </p>
                </div>
                {canWrite && editing === null && (
                    <button
                        onClick={() => setEditing("new")}
                        className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                    >
                        <FontAwesomeIcon icon={faPlus} className="text-xs" />
                        Map service
                    </button>
                )}
            </div>

            {editing !== null && (
                <RepoForm
                    key={editing === "new" ? "new" : editing.service}
                    initial={editing === "new" ? undefined : editing}
                    suggestions={unmapped}
                    onCancel={() => setEditing(null)}
                    onSaved={() => {
                        setEditing(null);
                        fetchRepos();
                    }}
                />
            )}

            {loading ? (
                <div className="flex items-center justify-center py-10">
                    <FontAwesomeIcon icon={faSpinner} className="animate-spin text-lg text-zinc-400" />
                </div>
            ) : error ? (
                <FailureState
                    what="source repositories"
                    message={error}
                    onRetry={fetchRepos}
                />
            ) : repos.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-300 py-10 text-center dark:border-zinc-700">
                    <FontAwesomeIcon icon={faCodeBranch} className="mb-3 text-3xl text-zinc-300 dark:text-zinc-400" />
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">No services mapped in {projectLabel}</p>
                    {unmapped.length > 0 && (
                        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                            {unmapped.length} service{unmapped.length === 1 ? "" : "s"} reported recently: {unmapped.slice(0, 5).join(", ")}
                            {unmapped.length > 5 ? "…" : ""}
                        </p>
                    )}
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50">
                                {canWrite && (
                                    <th className="w-10 px-4 py-3">
                                        <Checkbox
                                            checked={selection.allSelected}
                                            indeterminate={selection.someSelected}
                                            onChange={selection.toggleAll}
                                            label="Select all mappings"
                                        />
                                    </th>
                                )}
                                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Service</th>
                                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Repository</th>
                                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Default branch</th>
                                {canWrite && (
                                    <th className="px-4 py-3">
                                        <span className="sr-only">Actions</span>
                                    </th>
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                            {repos.map((r) => (
                                <tr key={r.service} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                                    {canWrite && (
                                        <td className="px-4 py-3">
                                            <Checkbox
                                                checked={selection.isSelected(r.service)}
                                                onChange={(e) => selection.toggle(r.service, { shiftKey: e.shiftKey })}
                                                label={`Select ${r.service}`}
                                            />
                                        </td>
                                    )}
                                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{r.service}</td>
                                    <td className="px-4 py-3">
                                        <a
                                            href={`https://github.com/${r.owner}/${r.repo}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                                        >
                                            {r.owner}/{r.repo}
                                        </a>
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">{r.default_branch || "—"}</td>
                                    {canWrite && (
                                        <td className="whitespace-nowrap px-4 py-3 text-right">
                                            <button
                                                onClick={() => setEditing(r)}
                                                aria-label={`Edit ${r.service}`}
                                                title="Edit"
                                                className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                                            >
                                                <FontAwesomeIcon icon={faPen} className="text-xs" />
                                            </button>
                                            <button
                                                onClick={() => void handleDelete(r)}
                                                aria-label={`Remove mapping for ${r.service}`}
                                                title="Remove"
                                                className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
                                            >
                                                <FontAwesomeIcon icon={faTrash} className="text-xs" />
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <BulkActionBar count={selection.count} noun="mapping" onClear={selection.clear}>
                <Button size="sm" variant="destructive" loading={busy} onClick={() => void bulkDelete()}>
                    Remove
                </Button>
            </BulkActionBar>
        </section>
    );
}

function RepoForm({
    initial,
    suggestions,
    onCancel,
    onSaved,
}: {
    initial?: ServiceRepo;
    suggestions: string[];
    onCancel: () => void;
    onSaved: () => void;
}) {
    const [service, setService] = useState(initial?.service ?? "");
    const [repository, setRepository] = useState(initial ? `${initial.owner}/${initial.repo}` : "");
    const [branch, setBranch] = useState(initial?.default_branch ?? "");
    const [saving, setSaving] = useState(false);

    // "owner/repo", or a pasted GitHub URL, which the API also accepts.
    const valid = service.trim() !== "" && /^(https?:\/\/github\.com\/)?[\w.-]+\/[\w.-]+\/?$/.test(repository.trim());

    const save = async () => {
        if (!valid) return;
        setSaving(true);
        const res = await reqSetServiceRepo(service.trim(), repository.trim(), branch.trim() || undefined);
        setSaving(false);
        if (!res.success) {
            toast.error(res.error_message || "Could not save the mapping");
            return;
        }
        toast.success(`${service.trim()} → ${res.data.owner}/${res.data.repo}`);
        onSaved();
    };

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                void save();
            }}
            className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50"
        >
            <div className="grid gap-3 sm:grid-cols-3">
                <div>
                    <label htmlFor="repo-service" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Service
                    </label>
                    <input
                        id="repo-service"
                        value={service}
                        onChange={(e) => setService(e.target.value)}
                        // The service is the key: renaming it would be a new row.
                        disabled={Boolean(initial)}
                        list="repo-service-suggestions"
                        placeholder="api-gateway"
                        autoFocus={!initial}
                        className={`${INPUT} disabled:opacity-60`}
                    />
                    <datalist id="repo-service-suggestions">
                        {suggestions.map((s) => (
                            <option key={s} value={s} />
                        ))}
                    </datalist>
                </div>
                <div>
                    <label htmlFor="repo-repository" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Repository
                    </label>
                    <input
                        id="repo-repository"
                        value={repository}
                        onChange={(e) => setRepository(e.target.value)}
                        placeholder="owner/repo"
                        autoFocus={Boolean(initial)}
                        className={`${INPUT} font-mono`}
                    />
                </div>
                <div>
                    <label htmlFor="repo-branch" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Default branch <span className="font-normal text-zinc-400">(optional)</span>
                    </label>
                    <input
                        id="repo-branch"
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        placeholder="main"
                        className={`${INPUT} font-mono`}
                    />
                </div>
            </div>
            <div className="flex gap-2">
                <Button type="submit" loading={saving} disabled={!valid}>
                    {initial ? "Save" : "Map service"}
                </Button>
                <Button type="button" variant="secondary" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </form>
    );
}
