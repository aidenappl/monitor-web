"use client";

import { useState, useEffect, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSpinner,
    faTrash,
    faPlus,
    faCopy,
    faCheck,
    faKey,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { APIKey, APIKeyCreateResult, APIKeyScope } from "@/types";
import { FailureState } from "@/components/FailureState";
import { useScope } from "@/hooks/useScope";
import { reqListAPIKeys, reqCreateAPIKey, reqDeleteAPIKey } from "@/services/api";
import { reportError } from "@/services/monitor.service";

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
    const [keys, setKeys] = useState<APIKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [newKeyName, setNewKeyName] = useState("");
    const [newKeyScope, setNewKeyScope] = useState<APIKeyScope>("admin");
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [createdKey, setCreatedKey] = useState<APIKeyCreateResult | null>(null);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Separate from `error`, which carries create/delete failures. A failed
    // CREATE must not blank the list of keys you already have; a failed LIST
    // must not be shown as "no keys yet". Different facts, different slots.
    const [listError, setListError] = useState<string | null>(null);

    const fetchKeys = useCallback(async () => {
        try {
            const res = await reqListAPIKeys();
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
        } catch (err) {
            reportError("api_key.list.failed", err, {
                outcome: "keys list shows its failure state",
            });
            setListError("Failed to load API keys");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchKeys();
    }, [fetchKeys]);

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
                setNewKeyName("");
                setNewKeyScope("admin");
                setShowCreateForm(false);
                fetchKeys();
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
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
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

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    {/* The scope is in the HEADING, not in a subtitle or a
                        breadcrumb. This list is one tenant's, minting binds a key
                        to that tenant permanently, and a bare "API Keys" over it
                        is exactly how the wrong-project reading survived. */}
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                        API Keys — {zone} / {projectLabel}
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Keys authenticate requests via the <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">X-Api-Key</code> header.
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
                {!showCreateForm && !createdKey && (
                    <button
                        onClick={() => setShowCreateForm(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                    >
                        <FontAwesomeIcon icon={faPlus} className="text-xs" />
                        Create Key
                    </button>
                )}
            </div>

            {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
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
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                                {createdKey.name}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2 text-sm font-mono text-zinc-900 dark:text-zinc-100 break-all select-all">
                            {createdKey.key}
                        </code>
                        <button
                            onClick={() => handleCopy(createdKey.key)}
                            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300 bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
                        >
                            <FontAwesomeIcon
                                icon={copied ? faCheck : faCopy}
                                className="text-xs"
                            />
                            {copied ? "Copied" : "Copy"}
                        </button>
                    </div>
                    <button
                        onClick={() => setCreatedKey(null)}
                        className="text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200 transition-colors"
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {/* Create form */}
            {showCreateForm && (
                <div className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 space-y-3">
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                Key Name
                            </label>
                            <input
                                type="text"
                                value={newKeyName}
                                onChange={(e) => setNewKeyName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleCreate();
                                    if (e.key === "Escape") {
                                        setShowCreateForm(false);
                                        setNewKeyName("");
                                    }
                                }}
                                placeholder="e.g. Claude MCP, CI/CD Pipeline, Grafana"
                                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                Scope
                            </label>
                            <select
                                value={newKeyScope}
                                onChange={(e) => setNewKeyScope(e.target.value as APIKeyScope)}
                                className="px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="admin">Admin (full access)</option>
                                <option value="ingest">Ingest (write-only)</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleCreate}
                            disabled={creating || !newKeyName.trim()}
                            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                            {creating ? (
                                <FontAwesomeIcon
                                    icon={faSpinner}
                                    className="text-xs animate-spin"
                                />
                            ) : (
                                <FontAwesomeIcon icon={faPlus} className="text-xs" />
                            )}
                            Create
                        </button>
                        <button
                            onClick={() => {
                                setShowCreateForm(false);
                                setNewKeyName("");
                                setNewKeyScope("admin");
                            }}
                            className="px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 border border-zinc-300 dark:border-zinc-600 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Keys list */}
            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <FontAwesomeIcon
                        icon={faSpinner}
                        className="text-zinc-400 animate-spin text-lg"
                    />
                </div>
            ) : listError ? (
                <FailureState what="API keys" message={listError} onRetry={fetchKeys} />
            ) : keys.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl">
                    <FontAwesomeIcon
                        icon={faKey}
                        className="text-3xl text-zinc-300 dark:text-zinc-600 mb-3"
                    />
                    {/* Named, because "No API keys yet" over a project-scoped list
                        reads as "this install has none" — and an operator who
                        believes that stops looking for the key that is still
                        posting events. */}
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        No API keys in {projectLabel}
                    </p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                        Other projects in {zone} may still have their own. Create one here to
                        start posting events into {projectLabel}.
                    </p>
                </div>
            ) : (
                <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
                                <th className="text-left px-4 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                                    Name
                                </th>
                                <th className="text-left px-4 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                                    Scope
                                </th>
                                {/* The API has always returned this and nothing
                                    rendered it, so two keys bound to two
                                    different tenants were indistinguishable in
                                    the one place an operator goes to revoke the
                                    right one. */}
                                <th className="text-left px-4 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                                    Project
                                </th>
                                <th className="text-left px-4 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                                    Key
                                </th>
                                <th className="text-left px-4 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                                    Created
                                </th>
                                <th className="text-right px-4 py-3 font-medium text-zinc-500 dark:text-zinc-400">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                            {keys.map((key) => (
                                <tr
                                    key={key.id}
                                    className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                                >
                                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                                        {key.name}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span
                                            className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                                                key.scope === "admin"
                                                    ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                                                    : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                                            }`}
                                        >
                                            {key.scope}
                                        </span>
                                    </td>
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
                                    <td className="px-4 py-3">
                                        <code className="text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-2 py-1 rounded font-mono">
                                            {key.key_prefix}...
                                        </code>
                                    </td>
                                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                                        {formatDate(key.created_at)}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <button
                                            onClick={() => handleDelete(key.id)}
                                            disabled={deleting === key.id}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-50 transition-colors"
                                        >
                                            <FontAwesomeIcon
                                                icon={
                                                    deleting === key.id ? faSpinner : faTrash
                                                }
                                                className={
                                                    deleting === key.id ? "animate-spin" : ""
                                                }
                                            />
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
