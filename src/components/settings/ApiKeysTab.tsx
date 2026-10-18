"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faTrash,
    faPlus,
    faCopy,
    faCheck,
    faKey,
    faPen,
    faXmark,
    faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { APIKey, APIKeyCreateResult, APIKeyScope } from "@/types";
import { FailureState } from "@/components/FailureState";
import { useScope } from "@/hooks/useScope";
import { reqListAPIKeys, reqCreateAPIKey, reqDeleteAPIKey, reqUpdateAPIKey } from "@/services/api";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { SkeletonTable } from "@/components/ui/skeleton";
import { ButtonSpinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionBar } from "@/components/BulkActionBar";
import { useConfirm } from "@/components/ConfirmProvider";
import { useSelection } from "@/hooks/useSelection";
import { useRole } from "@/hooks/useRole";
import { runBulk, toastBulkResult } from "@/tools/bulk.tools";
import { copyText } from "@/tools/clipboard.tools";
import { reportError } from "@/services/monitor.service";

/** Client-side cap on a key's display name. The column is wider; a label longer
 *  than this is not a label, and the server refusing it arrived as a bare 500. */
const KEY_NAME_MAX = 100;

/**
 * When monitor-core started WRITING `last_used_at` (commit 3567ab9, deployed
 * 2026-10-15/16). The column existed long before and nothing filled it, so an
 * empty value on a key created BEFORE this means "we don't know", and on a key
 * created after it means "never used". Those must not read the same.
 */
const USAGE_TRACKING_SINCE = Date.parse("2026-10-16T00:00:00Z");

/** A key with no recorded use in this long is flagged stale. */
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** The one typed phrase every revoke confirmation asks for — single or bulk. */
const REVOKE_PHRASE = "revoke";

type Usage =
    | { kind: "used"; at: string }
    /** Created after tracking began and never authenticated a request. */
    | { kind: "never" }
    /** Created before tracking began and not used since — unknown before that. */
    | { kind: "untracked" };

function usageOf(key: APIKey): Usage {
    if (key.last_used_at) return { kind: "used", at: key.last_used_at };
    return new Date(key.created_at).getTime() >= USAGE_TRACKING_SINCE
        ? { kind: "never" }
        : { kind: "untracked" };
}

/**
 * Stale = no recorded use for STALE_AFTER_MS. The clock starts at the newest of
 * the last use, the key's creation, and the start of tracking — a legacy key is
 * not "unused for a year" just because nothing was recording before October.
 */
function isStale(key: APIKey, now: number): boolean {
    const since = key.last_used_at
        ? new Date(key.last_used_at).getTime()
        : Math.max(new Date(key.created_at).getTime(), USAGE_TRACKING_SINCE);
    return now - since > STALE_AFTER_MS;
}

/**
 * API keys, for ONE project inside ONE zone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THIS WAS UNREACHABLE FOR EVERY ZONE BUT THE CONTROL PLANE, AND TWO DIALOGS
 * TOLD OPERATORS TO COME HERE ANYWAY.
 *
 * It used to be mounted only at `/settings`. "settings" is in
 * ZONE_AGNOSTIC_SEGMENTS, so `currentZone()` returned null, so no `?zone` was
 * sent, so `resolveUpstream` answered from the CONTROL PLANE — and
 * `apikeys.List` is project-scoped server-side, so what rendered was the control
 * plane's default project's keys. There was no URL anywhere in the app that
 * could show, mint, or revoke a key for `appleby`'s `atlas`.
 *
 * Meanwhile `RetireDialog` told operators that retiring a project does not stop
 * ingestion and to "revoke the project's API keys in Settings → API keys", and
 * `ProjectFormModal` told them to mint one there. Both instructions named a page
 * that could not do it. An instruction that cannot be followed is worse than
 * silence: it ends the investigation.
 *
 * So this component now REQUIRES a scope (`useScope` throws without one) and is
 * mounted at `/{zone}/settings`. Every request it makes carries the zone and the
 * project, and every label on it names them — because "API Keys" over a list
 * that is silently one tenant's is how the original bug stayed invisible.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function ApiKeysTab() {
    // ⚠️ THE SCOPE IS NOT DECORATION HERE. The list is filtered by it server-side
    // and a minted key is BOUND to it permanently — ingest derives an event's
    // project from the key and overwrites what the sender claimed, so a key
    // created under the wrong project cannot be corrected from the sending side.
    const { zone, project } = useScope();
    const projectLabel = project ?? "the default project";
    // Same words as the scope switcher's unset row.
    const projectHeading = project ?? "Default project";
    const [keys, setKeys] = useState<APIKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [newKeyName, setNewKeyName] = useState("");
    // Least privilege by default: most keys are for producers, and an admin key
    // can read every event in the project and revoke other keys.
    const [newKeyScope, setNewKeyScope] = useState<APIKeyScope>("ingest");
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [createdKey, setCreatedKey] = useState<APIKeyCreateResult | null>(null);
    // `copied` drives the transient "Copied" label; `everCopied` is whether the
    // one-time secret has left this page at all, which gates dismissing it.
    const [copied, setCopied] = useState(false);
    const [everCopied, setEverCopied] = useState(false);
    const secretRef = useRef<HTMLElement>(null);
    const [error, setError] = useState<string | null>(null);
    // Separate from `error`, which carries create/delete failures. A failed
    // CREATE must not blank the list of keys you already have; a failed LIST
    // must not be shown as "no keys yet". Different facts, different slots.
    const [listError, setListError] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [renameError, setRenameError] = useState<string | null>(null);
    const [renameBusy, setRenameBusy] = useState(false);
    const [bulkBusy, setBulkBusy] = useState(false);
    const confirm = useConfirm();
    const { canWrite } = useRole();
    const keyIds = useMemo(() => keys.map((k) => k.id), [keys]);
    const selection = useSelection(keyIds);
    // Captured once per list load: `Date.now()` in render is impure, and a stale
    // flag does not need to tick over while the page is open.
    const [now, setNow] = useState(0);

    // Bumped to re-read the list (after a create, or Retry). The read lives in
    // the effect rather than in a callback the effect calls, so a superseded
    // read is cancelled by the cleanup instead of landing over a newer one.
    const [keysToken, setKeysToken] = useState(0);
    const reloadKeys = useCallback(() => setKeysToken((t) => t + 1), []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const res = await reqListAPIKeys();
                if (cancelled) return;
                // The failure branch was missing entirely: `if (res.success)` with no
                // else left `error` null and `keys` empty, so a 500 rendered "No API
                // keys yet". On a credentials page that reads as "your keys were
                // revoked", which is a far more alarming false statement than most.
                if (!res.success) {
                    setListError(res.error_message || "The request failed.");
                    return;
                }
                setListError(null);
                setKeys(res.data);
                setNow(Date.now());
            } catch (err) {
                reportError("api_key.list.failed", err, {
                    outcome: "keys list shows its failure state",
                });
                if (!cancelled) setListError("Failed to load API keys");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [keysToken]);

    // The secret exists only in this component's state. Closing the tab or
    // reloading while it is on screen loses it for good, so ask first.
    useEffect(() => {
        if (!createdKey) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [createdKey]);

    const resetCreateForm = () => {
        setShowCreateForm(false);
        setNewKeyName("");
        setNewKeyScope("ingest");
    };

    const handleCreate = async () => {
        if (!newKeyName.trim()) return;
        setCreating(true);
        setError(null);
        try {
            // The project rides the BODY, not the `?project` selector — see the
            // note on reqCreateAPIKey for why the selector is not enough and what
            // a key minted into the wrong tenant costs.
            const res = await reqCreateAPIKey(newKeyName.trim(), newKeyScope, project);
            if (res.success) {
                setCreatedKey(res.data);
                setCopied(false);
                setEverCopied(false);
                resetCreateForm();
                reloadKeys();
            } else {
                setError(res.error_message || "Failed to create API key");
            }
        } catch (err) {
            // Scope and tenant only — never the key name or the minted secret.
            reportError("api_key.create.failed", err, {
                key_scope: newKeyScope,
                key_project: project,
                outcome: "no key minted; error shown inline",
            });
            setError("Failed to create API key");
        } finally {
            setCreating(false);
        }
    };

    /**
     * ⚠️ This was a single unconfirmed click, then a typed NAME for ingest keys
     * only — which left admin keys (the MCP server, automation) on one click and
     * made the ingest guard hard to satisfy for names with emoji or curly quotes.
     * Every key with any chance of being in use now asks for the same ASCII
     * word, single or bulk. Only a key that provably never authenticated a
     * request skips it.
     */
    const confirmDelete = async (key: APIKey) => {
        const usage = usageOf(key);
        const lastUsed = usage.kind === "used" ? ` — it was last used ${relativeTime(usage.at)}` : "";
        const ok = await confirm({
            title: `Revoke “${key.name}”?`,
            description:
                key.scope === "ingest"
                    ? `Anything sending events with this key stops being accepted immediately${lastUsed}. This cannot be undone; a replacement is a new key.`
                    : `Any client querying with this key — an MCP server, a script, a dashboard — loses access immediately${lastUsed}. This cannot be undone.`,
            confirmLabel: "Revoke key",
            destructive: true,
            typeToConfirm: usage.kind === "never" ? undefined : REVOKE_PHRASE,
        });
        if (ok) await handleDelete(key.id);
    };

    const startRename = (key: APIKey) => {
        setRenamingId(key.id);
        setRenameValue(key.name);
        setRenameError(null);
    };

    const cancelRename = () => {
        setRenamingId(null);
        setRenameError(null);
    };

    const handleRename = async (key: APIKey) => {
        const name = renameValue.trim();
        if (!name || name === key.name) {
            cancelRename();
            return;
        }
        if (name.length > KEY_NAME_MAX) {
            setRenameError(`Names can be at most ${KEY_NAME_MAX} characters.`);
            return;
        }
        setRenameBusy(true);
        const res = await reqUpdateAPIKey(key.id, name);
        setRenameBusy(false);
        if (!res.success) {
            // Inline, beside the field that is still open: a toast that fades
            // left the input sitting there with no word on whether it saved.
            setRenameError(res.error_message || "Could not rename the key — the name was not saved.");
            return;
        }
        setKeys((prev) => prev.map((k) => (k.id === key.id ? { ...k, name: res.data.name } : k)));
        cancelRename();
        toast.success("Key renamed");
    };

    const bulkRevoke = async () => {
        const targets = keys.filter((k) => selection.isSelected(k.id));
        const ingest = targets.filter((k) => k.scope === "ingest");
        const admin = targets.length - ingest.length;
        const anyMaybeInUse = targets.some((k) => usageOf(k).kind !== "never");
        const ok = await confirm({
            title: `Revoke ${targets.length} key${targets.length === 1 ? "" : "s"}?`,
            description: `${targets.map((k) => k.name).join(", ")}.${ingest.length ? ` ${ingest.length} ${ingest.length === 1 ? "is an ingest key" : "are ingest keys"}: producers using ${ingest.length === 1 ? "it" : "them"} stop being accepted immediately.` : ""}${admin ? ` ${admin} ${admin === 1 ? "is an admin key" : "are admin keys"}: clients querying with ${admin === 1 ? "it" : "them"} lose access immediately.` : ""} This cannot be undone.`,
            confirmLabel: `Revoke ${targets.length}`,
            destructive: true,
            typeToConfirm: anyMaybeInUse ? REVOKE_PHRASE : undefined,
        });
        if (!ok) return;
        setBulkBusy(true);
        const result = await runBulk(targets, (k) => reqDeleteAPIKey(k.id));
        setBulkBusy(false);
        toastBulkResult(result, "Revoked", "key");
        const revoked = new Set(result.succeeded.map((k) => k.id));
        setKeys((prev) => prev.filter((k) => !revoked.has(k.id)));
        selection.clear();
    };

    const handleDelete = async (id: string) => {
        setDeleting(id);
        setError(null);
        try {
            const res = await reqDeleteAPIKey(id);
            if (res.success) {
                setKeys((prev) => prev.filter((k) => k.id !== id));
                if (createdKey?.id === id) setCreatedKey(null);
            } else {
                setError(res.error_message || "Failed to delete API key");
            }
        } catch (err) {
            reportError("api_key.delete.failed", err, {
                api_key_id: id,
                outcome: "key NOT revoked; error shown inline",
            });
            setError("Failed to delete API key");
        } finally {
            setDeleting(null);
        }
    };

    const handleCopy = async (text: string) => {
        // copyText toasts either outcome. On failure the secret is selected so
        // ⌘C / Ctrl+C is the only step left.
        const ok = await copyText(text, { label: "API key" });
        if (!ok) {
            const el = secretRef.current;
            const sel = typeof window !== "undefined" ? window.getSelection() : null;
            if (el && sel) {
                const range = document.createRange();
                range.selectNodeContents(el);
                sel.removeAllRanges();
                sel.addRange(range);
            }
            return;
        }
        setCopied(true);
        setEverCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const dismissCreated = async () => {
        if (!everCopied) {
            const ok = await confirm({
                title: "Close without copying the key?",
                description:
                    "The Copy button was never used. Once this panel closes the key cannot be shown again — the only fix is revoking it and creating another. If you copied it by hand, carry on.",
                confirmLabel: "Close anyway",
                destructive: true,
            });
            if (!ok) return;
        }
        setCreatedKey(null);
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    // Shown only when the rows disagree with each other or with the scope:
    // otherwise it repeats the project the heading already names on every row.
    const showProjectColumn = useMemo(() => {
        const slugs = new Set(keys.map((k) => k.project_slug || ""));
        return slugs.size > 1 || (project != null && keys.some((k) => k.project_slug !== project));
    }, [keys, project]);

    const createDisabledReason = loading
        ? "Loading keys…"
        : listError
          ? `${zone} is not answering — a new key could not be saved`
          : null;

    const renderName = (key: APIKey, where: "card" | "row") =>
        renamingId === key.id ? (
            <div className="space-y-1">
                <div className="flex items-center gap-1">
                    <input
                        autoFocus
                        value={renameValue}
                        maxLength={KEY_NAME_MAX}
                        onChange={(e) => {
                            setRenameValue(e.target.value);
                            setRenameError(null);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void handleRename(key);
                            if (e.key === "Escape") cancelRename();
                        }}
                        aria-label={`New name for ${key.name}`}
                        aria-invalid={renameError ? true : undefined}
                        aria-describedby={`rename-msg-${where}-${key.id}`}
                        disabled={renameBusy}
                        className={`w-full min-w-[10rem] rounded-md border bg-white px-2 py-1 text-base sm:text-sm dark:bg-zinc-900 ${
                            renameError ? "border-red-500" : "border-zinc-300 dark:border-zinc-600"
                        }`}
                    />
                    {/* Explicit Save/Cancel: blur used to SAVE, so a misclick
                        committed a half-typed label onto a live credential.
                        Blur now does nothing at all. */}
                    <button
                        type="button"
                        onClick={() => void handleRename(key)}
                        disabled={renameBusy}
                        aria-label={`Save name for ${key.name}`}
                        title="Save (Enter)"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                    >
                        {renameBusy ? <ButtonSpinner /> : <FontAwesomeIcon icon={faCheck} className="text-xs" />}
                    </button>
                    <button
                        type="button"
                        onClick={cancelRename}
                        aria-label="Cancel rename"
                        title="Cancel (Esc)"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                        <FontAwesomeIcon icon={faXmark} className="text-xs" />
                    </button>
                </div>
                <p
                    id={`rename-msg-${where}-${key.id}`}
                    role={renameError ? "alert" : undefined}
                    className={`text-xs font-normal ${renameError ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}
                >
                    {renameError ?? "Enter to save · Esc to cancel"}
                </p>
            </div>
        ) : (
            <span className="block max-w-[16rem] truncate" title={key.name}>
                {key.name}
            </span>
        );

    const renderScope = (key: APIKey) => (
        <span
            className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                key.scope === "admin"
                    ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                    : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
            }`}
        >
            {key.scope}
        </span>
    );

    const renderPrefix = (key: APIKey) => (
        <code className="text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-2 py-1 rounded font-mono whitespace-nowrap">
            {key.key_prefix}…
        </code>
    );

    const renderLastUsed = (key: APIKey) => {
        const usage = usageOf(key);
        const stale = now > 0 && isStale(key, now);
        return (
            <span className="inline-flex flex-wrap items-center gap-1.5">
                {/* Recorded server-side at most once a minute. */}
                {usage.kind === "used" ? (
                    <span title={formatDate(usage.at)}>{relativeTime(usage.at)}</span>
                ) : usage.kind === "never" ? (
                    <span className="text-zinc-500 dark:text-zinc-400">Never used</span>
                ) : (
                    <span
                        className="text-zinc-500 dark:text-zinc-400"
                        title="This key predates usage tracking (Oct 16, 2026); any use before then was not recorded."
                    >
                        Not since tracking began
                    </span>
                )}
                {stale && (
                    <span
                        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                        title="No recorded use in 30+ days — consider revoking it"
                    >
                        <FontAwesomeIcon icon={faTriangleExclamation} className="text-[10px]" aria-hidden />
                        Stale
                    </span>
                )}
            </span>
        );
    };

    const renderCreated = (key: APIKey) => (
        <span title={formatDate(key.created_at)}>
            {new Date(key.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
        </span>
    );

    const renderActions = (key: APIKey) => (
        <div className="inline-flex items-center gap-1">
            <button
                onClick={() => startRename(key)}
                aria-label={`Rename ${key.name}`}
                title="Rename"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
                <FontAwesomeIcon icon={faPen} className="text-xs" />
            </button>
            <button
                onClick={() => void confirmDelete(key)}
                disabled={deleting === key.id}
                aria-label={`Revoke ${key.name}`}
                title={`Revoke ${key.name}`}
                className="inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-50 transition-colors"
            >
                {deleting === key.id ? <ButtonSpinner /> : <FontAwesomeIcon icon={faTrash} />}
                Revoke
            </button>
        </div>
    );

    const bannerName = createdKey ? (keys.find((k) => k.id === createdKey.id)?.name ?? createdKey.name) : "";

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0">
                    {/* The scope is in the HEADING, not in a subtitle or a
                        breadcrumb. This list is one tenant's, minting binds a key
                        to that tenant permanently, and a bare "API Keys" over it
                        is exactly how the wrong-project reading survived. */}
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                        API Keys — {zone} / {projectHeading}
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Keys authenticate requests via the <code className="text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-1.5 py-0.5 rounded">X-Api-Key</code> header.
                        This list is the keys belonging to{" "}
                        <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                            {projectLabel}
                        </strong>{" "}
                        in zone{" "}
                        <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                            {zone}
                        </strong>
                        , and a new key is bound to it. Ingest derives an event&apos;s project
                        from the key that sent it and overwrites what the sender claimed, so
                        that binding cannot be corrected later — switch project first if this
                        is not the tenant you meant.
                    </p>
                </div>
                {canWrite && !showCreateForm && !createdKey && (
                    <button
                        onClick={() => setShowCreateForm(true)}
                        disabled={createDisabledReason !== null}
                        title={createDisabledReason ?? undefined}
                        className="self-start shrink-0 whitespace-nowrap inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600 rounded-lg transition-colors"
                    >
                        <FontAwesomeIcon icon={faPlus} className="text-xs" />
                        Create Key
                    </button>
                )}
            </div>

            {error && (
                <div role="alert" className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
            )}

            {/* Created key banner — shown once */}
            {createdKey && (
                <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl space-y-3">
                    <div className="flex items-start gap-3">
                        <FontAwesomeIcon
                            icon={faKey}
                            className="text-emerald-500 mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                                API key created — copy it now, it won&apos;t be shown again.
                            </p>
                            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5 truncate">
                                {bannerName} · {createdKey.scope}
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <code
                            ref={secretRef}
                            className="flex-1 bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2 text-sm font-mono text-zinc-900 dark:text-zinc-100 break-all select-all"
                        >
                            {createdKey.key}
                        </code>
                        <button
                            onClick={() => void handleCopy(createdKey.key)}
                            className="flex-shrink-0 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300 bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
                        >
                            <FontAwesomeIcon
                                icon={copied ? faCheck : faCopy}
                                className="text-xs"
                            />
                            {copied ? "Copied" : "Copy"}
                        </button>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-3">
                        {!everCopied && (
                            <span className="text-xs text-emerald-700 dark:text-emerald-400">Not copied yet</span>
                        )}
                        <Button size="sm" onClick={() => void dismissCreated()}>
                            I&apos;ve saved this key
                        </Button>
                    </div>
                </div>
            )}

            {/* Create form */}
            {showCreateForm && (
                <div className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 space-y-4">
                    <div>
                        <label htmlFor="api-key-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                            Key Name
                        </label>
                        <input
                            id="api-key-name"
                            type="text"
                            value={newKeyName}
                            maxLength={KEY_NAME_MAX}
                            onChange={(e) => setNewKeyName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") void handleCreate();
                                if (e.key === "Escape") resetCreateForm();
                            }}
                            placeholder="e.g. Claude MCP, CI/CD Pipeline, Grafana"
                            className="w-full px-3 py-2 text-base sm:text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            autoFocus
                        />
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            Up to {KEY_NAME_MAX} characters. Name it after what will use it.
                        </p>
                    </div>
                    <fieldset>
                        <legend className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                            Scope
                        </legend>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <ScopeOption
                                value="ingest"
                                selected={newKeyScope}
                                onSelect={setNewKeyScope}
                                title="Ingest"
                                body="Send events (POST /v1/events) only. For services, SDKs and log shippers."
                            />
                            <ScopeOption
                                value="admin"
                                selected={newKeyScope}
                                onSelect={setNewKeyScope}
                                title="Admin"
                                body="Read every event in this project and manage keys, alerts and dashboards. For MCP servers and automation."
                            />
                        </div>
                        {newKeyScope === "admin" && (
                            <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                                <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5" aria-hidden />
                                An admin key can read all of {projectLabel}&apos;s data and revoke other keys. Use Ingest for anything that only sends events.
                            </p>
                        )}
                    </fieldset>
                    <div className="flex gap-2">
                        <button
                            onClick={() => void handleCreate()}
                            disabled={creating || !newKeyName.trim()}
                            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                            {creating ? (
                                <ButtonSpinner />
                            ) : (
                                <FontAwesomeIcon icon={faPlus} className="text-xs" />
                            )}
                            Create {newKeyScope} key
                        </button>
                        <button
                            onClick={resetCreateForm}
                            className="px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 border border-zinc-300 dark:border-zinc-600 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Keys list */}
            {loading ? (
                // Skeleton rows at roughly the real row height, so the section
                // below does not jump when the list lands (CLS was 0.49 with a
                // short spinner here).
                <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden" aria-busy="true">
                    <div className="h-11 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700" />
                    <SkeletonTable rows={5} columns={5} rowClass="h-[53px]" label="Loading API keys" className="divide-zinc-200 dark:divide-zinc-700" />
                </div>
            ) : listError ? (
                <FailureState what="API keys" message={listError} onRetry={reloadKeys} />
            ) : keys.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl">
                    <FontAwesomeIcon
                        icon={faKey}
                        className="text-3xl text-zinc-300 dark:text-zinc-400 mb-3"
                    />
                    {/* Named, because "No API keys yet" over a project-scoped list
                        reads as "this install has none" — and an operator who
                        believes that stops looking for the key that is still
                        posting events. */}
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        No API keys in {projectLabel}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                        Other projects in {zone} may still have their own. Create one here to
                        start posting events into {projectLabel}.
                    </p>
                </div>
            ) : (
                <>
                    {/* Phone: one card per key, actions in reach. The table is
                        ~950px wide and put Revoke behind a horizontal scroll. */}
                    <ul className="sm:hidden divide-y divide-zinc-200 dark:divide-zinc-700 border border-zinc-200 dark:border-zinc-700 rounded-xl">
                        {keys.map((key) => (
                            <li
                                key={key.id}
                                className={`space-y-2 p-3 ${selection.isSelected(key.id) ? "bg-blue-50/60 dark:bg-blue-900/10" : ""}`}
                            >
                                <div className="flex items-start gap-3">
                                    {canWrite && (
                                        <div className="pt-0.5">
                                            <Checkbox
                                                checked={selection.isSelected(key.id)}
                                                onChange={(e) => selection.toggle(key.id, { shiftKey: e.shiftKey })}
                                                label={`Select ${key.name}`}
                                            />
                                        </div>
                                    )}
                                    <div className="min-w-0 flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                        {renderName(key, "card")}
                                    </div>
                                    {renderScope(key)}
                                </div>
                                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                                    <dt>Key</dt>
                                    <dd>{renderPrefix(key)}</dd>
                                    {showProjectColumn && (
                                        <>
                                            <dt>Project</dt>
                                            <dd className="font-mono">{key.project_slug || "—"}</dd>
                                        </>
                                    )}
                                    <dt>Last used</dt>
                                    <dd>{renderLastUsed(key)}</dd>
                                    <dt>Created</dt>
                                    <dd>{renderCreated(key)}</dd>
                                </dl>
                                {canWrite && renamingId !== key.id && <div className="flex justify-end">{renderActions(key)}</div>}
                            </li>
                        ))}
                    </ul>
                    <div className="hidden sm:block border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
                                    {canWrite && (
                                        <th className="w-10 px-4 py-3">
                                            <Checkbox
                                                checked={selection.allSelected}
                                                indeterminate={selection.someSelected}
                                                onChange={selection.toggleAll}
                                                label="Select all keys"
                                            />
                                        </th>
                                    )}
                                    <Th>Name</Th>
                                    <Th>Scope</Th>
                                    {/* The API has always returned this and nothing
                                        rendered it, so two keys bound to two
                                        different tenants were indistinguishable in
                                        the one place an operator goes to revoke the
                                        right one. Hidden only when every row is the
                                        project the heading already names. */}
                                    {showProjectColumn && <Th>Project</Th>}
                                    <Th>Key</Th>
                                    <Th>Last used</Th>
                                    <Th>Created</Th>
                                    {canWrite && (
                                        <th className="text-right px-4 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                                            <span className="sr-only">Actions</span>
                                        </th>
                                    )}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                                {keys.map((key) => (
                                    <tr
                                        key={key.id}
                                        className={`transition-colors ${
                                            selection.isSelected(key.id)
                                                ? "bg-blue-50/60 dark:bg-blue-900/10"
                                                : "hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                                        }`}
                                    >
                                        {canWrite && (
                                            <td className="px-4 py-3">
                                                <Checkbox
                                                    checked={selection.isSelected(key.id)}
                                                    onChange={(e) => selection.toggle(key.id, { shiftKey: e.shiftKey })}
                                                    label={`Select ${key.name}`}
                                                />
                                            </td>
                                        )}
                                        <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                                            {renderName(key, "row")}
                                        </td>
                                        <td className="px-4 py-3">{renderScope(key)}</td>
                                        {showProjectColumn && (
                                            <td className="px-4 py-3">
                                                <code className="text-xs font-mono text-zinc-600 dark:text-zinc-400">
                                                    {/* An em dash rather than a blank when a
                                                        zone runs a monitor-core that predates
                                                        the column: "not reported" and "no
                                                        project" must not look the same on the
                                                        page you revoke keys from. */}
                                                    {key.project_slug || "—"}
                                                </code>
                                            </td>
                                        )}
                                        <td className="px-4 py-3">{renderPrefix(key)}</td>
                                        <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                                            {renderLastUsed(key)}
                                        </td>
                                        <td className="px-4 py-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                                            {renderCreated(key)}
                                        </td>
                                        {canWrite && (
                                            <td className="px-4 py-3 text-right whitespace-nowrap">
                                                {renamingId !== key.id && renderActions(key)}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
            <BulkActionBar count={selection.count} noun="key" onClear={selection.clear}>
                <Button size="sm" variant="destructive" loading={bulkBusy} onClick={() => void bulkRevoke()}>
                    Revoke
                </Button>
            </BulkActionBar>
        </div>
    );
}

function Th({ children }: { children: ReactNode }) {
    return (
        <th className="text-left px-4 py-3 font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
            {children}
        </th>
    );
}

/** A radio rendered as a card, so each scope states what it can do. */
function ScopeOption({
    value,
    selected,
    onSelect,
    title,
    body,
}: {
    value: APIKeyScope;
    selected: APIKeyScope;
    onSelect: (v: APIKeyScope) => void;
    title: string;
    body: string;
}) {
    const checked = value === selected;
    return (
        <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                checked
                    ? "border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20"
                    : "border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:hover:border-zinc-500"
            }`}
        >
            <input
                type="radio"
                name="api-key-scope"
                value={value}
                checked={checked}
                onChange={() => onSelect(value)}
                className="mt-0.5 accent-blue-600"
            />
            <span>
                <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
                <span className="block text-xs text-zinc-600 dark:text-zinc-400">{body}</span>
            </span>
        </label>
    );
}

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.round(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
}
