"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCodeBranch, faPen, faPlus, faTrash, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
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
    "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500";

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
    // Same words as the scope switcher's unset row.
    const projectHeading = project ?? "Default project";
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
            description: `${targets.map((r) => r.service).join(", ")} ${targets.length === 1 ? "stops" : "stop"} linking pull requests automatically. Existing links are kept.`,
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                        Source repositories — {zone} / {projectHeading}
                    </h2>
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        Which GitHub repository each service&apos;s code lives in. Issues show it, and pull requests opened there link to their issues
                        automatically.
                    </p>
                </div>
                {canWrite && editing === null && (
                    <button
                        onClick={() => setEditing("new")}
                        // A zone that cannot list its mappings cannot save one.
                        disabled={loading || error !== null}
                        title={error !== null ? `${zone} is not answering — a mapping could not be saved` : undefined}
                        className="inline-flex self-start shrink-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600 items-center gap-2 whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
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
                // Row-height skeleton rather than a short spinner, so nothing
                // below jumps when the list lands.
                <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700" aria-busy="true" aria-label="Loading source repositories">
                    <div className="h-11 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50" />
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="flex h-[49px] items-center gap-4 border-b border-zinc-200 px-4 last:border-b-0 dark:border-zinc-700">
                            <div className="h-3 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                            <div className="h-3 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                        </div>
                    ))}
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
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
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
                                <th className="hidden px-4 py-3 text-left font-medium text-zinc-500 sm:table-cell dark:text-zinc-400">Default branch</th>
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
                                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                                        <span className="block max-w-[14rem] truncate" title={r.service}>
                                            {r.service}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <RepoLink owner={r.owner} repo={r.repo} />
                                        {/* The branch column is hidden on phones; it rides here instead. */}
                                        {r.default_branch && (
                                            <span className="mt-0.5 block font-mono text-xs text-zinc-500 sm:hidden dark:text-zinc-400">
                                                {r.default_branch}
                                            </span>
                                        )}
                                    </td>
                                    <td className="hidden px-4 py-3 font-mono text-xs text-zinc-600 sm:table-cell dark:text-zinc-400">
                                        {r.default_branch || "—"}
                                    </td>
                                    {canWrite && (
                                        <td className="whitespace-nowrap px-4 py-3 text-right">
                                            {/* Same pattern as the API-keys rows: a pencil icon, then
                                                the destructive verb as red icon + label. */}
                                            <div className="inline-flex items-center gap-1">
                                                <button
                                                    onClick={() => setEditing(r)}
                                                    aria-label={`Edit ${r.service}`}
                                                    title="Edit"
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                                >
                                                    <FontAwesomeIcon icon={faPen} className="text-xs" />
                                                </button>
                                                <button
                                                    onClick={() => void handleDelete(r)}
                                                    aria-label={`Remove mapping for ${r.service}`}
                                                    title={`Remove mapping for ${r.service}`}
                                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                                                >
                                                    <FontAwesomeIcon icon={faTrash} />
                                                    <span className="hidden sm:inline">Remove</span>
                                                </button>
                                            </div>
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

/** GitHub's own rules: owner 1–39 of [A-Za-z0-9-], not starting with "-". */
const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
/** Repo 1–100 of [A-Za-z0-9._-], and never "." or ".." — those resolve the link to github.com itself. */
const REPO_RE = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;

/**
 * Normalise what people actually paste into `owner/repo`:
 *
 *   owner/repo · github.com/owner/repo · https://www.github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/main/src · git@github.com:owner/repo.git
 *
 * Returns null for anything else. The old check was one regex that let "../.."
 * through (saved, and linked to https://github.com/) and refused a scheme-less
 * github.com URL with nothing but a greyed-out button.
 */
function parseRepository(input: string): { owner: string; repo: string } | null {
    let s = input.trim();
    let path: string[];
    const ssh = /^git@github\.com:(.+)$/i.exec(s);
    if (ssh) {
        path = ssh[1].split("/");
    } else {
        s = s.replace(/^https?:\/\//i, "");
        const hosted = /^(?:www\.)?github\.com\/(.*)$/i.exec(s);
        if (hosted) {
            // Anything after owner/repo (/tree/main, /pulls, ?tab=…) is the
            // browser's address bar, not part of the repository.
            path = hosted[1].split(/[?#]/)[0].split("/").slice(0, 2);
        } else {
            path = s.replace(/\/+$/, "").split("/");
            if (path.length !== 2) return null;
        }
    }
    if (path.length < 2) return null;
    const owner = path[0];
    const repo = path[1].replace(/\.git$/i, "");
    if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) return null;
    return { owner, repo };
}

/**
 * A subset of `git check-ref-format`, tightened to the characters a branch name
 * realistically uses — the value is spliced into blob/tree URLs, so anything
 * outside it breaks a link rather than naming a branch. Null when valid.
 */
function branchProblem(branch: string): string | null {
    const b = branch.trim();
    if (!b) return null;
    if (b.length > 255) return "Branch names can be at most 255 characters.";
    if (!/^[A-Za-z0-9._/-]+$/.test(b)) return "Use letters, digits, '.', '_', '-' and '/' only — e.g. main or release/1.2.";
    if (b.startsWith("/") || b.endsWith("/") || b.includes("//")) return "A branch name can't start or end with '/', or contain '//'.";
    if (b.includes("..") || b.endsWith(".") || b.endsWith(".lock") || b.split("/").some((part) => part.startsWith(".")))
        return "Not a valid git branch name.";
    return null;
}

/** A mapping as a link — or, for a row saved before validation existed, as text that says it is broken. */
function RepoLink({ owner, repo }: { owner: string; repo: string }) {
    if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) {
        return (
            <span
                className="inline-flex items-center gap-1.5 font-mono text-xs text-amber-700 dark:text-amber-400"
                title="Not a valid GitHub repository — edit this mapping"
            >
                <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
                {owner}/{repo}
            </span>
        );
    }
    return (
        <a
            href={`https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
        >
            {owner}/{repo}
        </a>
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
    // Errors appear once a field has been left (or on submit), not while the
    // first character is being typed.
    const [touched, setTouched] = useState({ service: false, repository: false, branch: false });
    const [serverError, setServerError] = useState<string | null>(null);

    const parsed = parseRepository(repository);
    const serviceError = service.trim() === "" ? "Enter the service name it reports as." : null;
    const repositoryError = parsed
        ? null
        : repository.trim() === ""
          ? "Enter owner/repo or a GitHub URL."
          : "Use owner/repo or a GitHub URL — e.g. aidenappl/monitor-web.";
    const branchError = branchProblem(branch);
    const valid = !serviceError && !repositoryError && !branchError;

    const save = async () => {
        setTouched({ service: true, repository: true, branch: true });
        if (!valid || !parsed) return;
        setSaving(true);
        setServerError(null);
        // Send the normalised form: the API's own parser accepts less than this one.
        const res = await reqSetServiceRepo(service.trim(), `${parsed.owner}/${parsed.repo}`, branch.trim() || undefined);
        setSaving(false);
        if (!res.success) {
            // Inline, beside the form that is still open — not a toast that fades.
            setServerError(res.error_message || "Could not save the mapping");
            return;
        }
        toast.success(`${service.trim()} → ${res.data.owner}/${res.data.repo}`);
        onSaved();
    };

    const fieldMsg = (id: string, err: string | null, show: boolean, hint?: string) =>
        show && err ? (
            <p id={id} className="mt-1 text-xs text-red-600 dark:text-red-400">
                {err}
            </p>
        ) : hint ? (
            <p id={id} className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {hint}
            </p>
        ) : null;
    const invalidCls = "border-red-500 focus:ring-red-500 dark:border-red-500";

    return (
        <form
            noValidate
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
                        onBlur={() => setTouched((t) => ({ ...t, service: true }))}
                        aria-invalid={touched.service && serviceError ? true : undefined}
                        aria-describedby={touched.service && serviceError ? "repo-service-msg" : undefined}
                        className={`${INPUT} disabled:opacity-60 ${touched.service && serviceError ? invalidCls : ""}`}
                    />
                    <datalist id="repo-service-suggestions">
                        {suggestions.map((s) => (
                            <option key={s} value={s} />
                        ))}
                    </datalist>
                    {fieldMsg("repo-service-msg", serviceError, touched.service)}
                </div>
                <div>
                    <label htmlFor="repo-repository" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Repository
                    </label>
                    <input
                        id="repo-repository"
                        value={repository}
                        onChange={(e) => {
                            setRepository(e.target.value);
                            setServerError(null);
                        }}
                        onBlur={() => setTouched((t) => ({ ...t, repository: true }))}
                        placeholder="owner/repo"
                        autoFocus={Boolean(initial)}
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        aria-invalid={touched.repository && repositoryError ? true : undefined}
                        aria-describedby="repo-repository-msg"
                        className={`${INPUT} font-mono ${touched.repository && repositoryError ? invalidCls : ""}`}
                    />
                    {fieldMsg(
                        "repo-repository-msg",
                        repositoryError,
                        touched.repository,
                        parsed && repository.trim() !== `${parsed.owner}/${parsed.repo}`
                            ? `Saves as ${parsed.owner}/${parsed.repo}`
                            : "owner/repo or a GitHub URL",
                    )}
                </div>
                <div>
                    <label htmlFor="repo-branch" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Default branch <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
                    </label>
                    <input
                        id="repo-branch"
                        value={branch}
                        onChange={(e) => {
                            setBranch(e.target.value);
                            setServerError(null);
                        }}
                        onBlur={() => setTouched((t) => ({ ...t, branch: true }))}
                        placeholder="main"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        aria-invalid={touched.branch && branchError ? true : undefined}
                        aria-describedby={touched.branch && branchError ? "repo-branch-msg" : undefined}
                        className={`${INPUT} font-mono ${touched.branch && branchError ? invalidCls : ""}`}
                    />
                    {fieldMsg("repo-branch-msg", branchError, touched.branch)}
                </div>
            </div>
            {serverError && (
                <p
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
                >
                    {serverError}
                </p>
            )}
            <div className="flex gap-2">
                {/* Enabled even when invalid: pressing it reveals every field's
                    message, where a disabled button only said "no". */}
                <Button type="submit" loading={saving}>
                    {initial ? "Save" : "Map service"}
                </Button>
                <Button type="button" variant="secondary" onClick={onCancel}>
                    Cancel
                </Button>
            </div>
        </form>
    );
}
