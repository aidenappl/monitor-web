"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faSpinner, faPen, faTrash, faArrowsRotate, faCheck } from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { SavedView } from "@/types";
import { reqListViews, reqCreateView, reqDeleteView, reqUpdateView } from "@/services/api";
import { useConfirm } from "@/components/ConfirmProvider";
import { useRole } from "@/hooks/useRole";
import { FailureNote } from "@/components/FailureState";
import { reportError } from "@/services/monitor.service";

interface SavedViewsProps {
    page: string;
    currentFilters: Record<string, unknown>;
    onLoadView: (queryParams: Record<string, unknown>) => void;
}

export function SavedViews({ page, currentFilters, onLoadView }: SavedViewsProps) {
    const [open, setOpen] = useState(false);
    const [views, setViews] = useState<SavedView[]>([]);
    const [viewsError, setViewsError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showNameInput, setShowNameInput] = useState(false);
    const [newName, setNewName] = useState("");
    const dropdownRef = useRef<HTMLDivElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const viewsLoadedRef = useRef(false);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);
    const confirm = useConfirm();
    const { canWrite } = useRole();

    // The page offset is where you happened to be, not part of the view: saving
    // it made a loaded view open on page 4 of a result set that may now have 2.
    const savableFilters = () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { offset: _offset, ...rest } = currentFilters;
        return JSON.stringify(rest);
    };

    const fetchViews = useCallback(async () => {
        setLoading(true);
        try {
            const res = await reqListViews(page);
            // "No saved views yet" invites you to save one you may already have.
            // Supplementary is a reason to keep the note small, not a reason to
            // let the dropdown assert something false.
            if (!res.success) {
                setViewsError(res.error_message || "The request failed.");
                return;
            }
            setViewsError(null);
            setViews(res.data);
            viewsLoadedRef.current = true;
        } catch (err) {
            reportError("saved_view.list.failed", err, {
                view_page: page,
                outcome: "saved-views dropdown shows its failure note",
            });
            setViewsError("Failed to load saved views");
        } finally {
            setLoading(false);
        }
    }, [page]);

    // ⚠️ LOADED ON FIRST OPEN, NOT ON MOUNT. The list is only ever read inside
    // the dropdown, and fetching it on mount spent one of the events page's six
    // HTTP/1.1 sockets on every load — in the same burst as the events table
    // the page exists to show. `viewsLoadedRef` is set only on success, so a
    // failed load is retried by the next open as well as by the retry note.
    const handleToggle = () => {
        const next = !open;
        setOpen(next);
        if (next && !viewsLoadedRef.current && !loading) void fetchViews();
    };

    useEffect(() => {
        if (showNameInput && nameInputRef.current) {
            nameInputRef.current.focus();
        }
    }, [showNameInput]);

    // Close on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
                setShowNameInput(false);
                setNewName("");
            }
        };
        if (open) {
            document.addEventListener("mousedown", handleClick);
            return () => document.removeEventListener("mousedown", handleClick);
        }
    }, [open]);

    const handleSave = async () => {
        if (!newName.trim()) return;
        setSaving(true);
        try {
            const res = await reqCreateView(newName.trim(), savableFilters(), page);
            if (!res.success) {
                toast.error(res.error_message || "Failed to save view");
                return;
            }
            setNewName("");
            setShowNameInput(false);
            await fetchViews();
            toast.success("View saved");
        } catch (err) {
            reportError("saved_view.create.failed", err, {
                view_page: page,
                outcome: "view not saved; user toasted",
            });
            toast.error("Failed to save view");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (view: SavedView) => {
        const ok = await confirm({
            title: `Delete “${view.name}”?`,
            description: "The saved view is removed for everyone in this project. The events it matched are not affected.",
            confirmLabel: "Delete view",
            destructive: true,
        });
        if (!ok) return;
        setBusyId(view.id);
        try {
            const res = await reqDeleteView(view.id);
            // The optimistic removal below is why this matters: without the
            // branch a rejected delete still dropped the row from the list and
            // claimed success, and the view reappeared on the next open.
            if (!res.success) {
                toast.error(res.error_message || "Failed to delete view");
                return;
            }
            setViews((prev) => prev.filter((v) => v.id !== view.id));
            toast.success("View deleted");
        } catch (err) {
            reportError("saved_view.delete.failed", err, {
                view_id: view.id,
                view_page: page,
                outcome: "view kept; user toasted",
            });
            toast.error("Failed to delete view");
        } finally {
            setBusyId(null);
        }
    };

    const handleRename = async (view: SavedView) => {
        const name = renameValue.trim();
        if (!name || name === view.name) {
            setRenamingId(null);
            return;
        }
        setBusyId(view.id);
        const res = await reqUpdateView(view.id, { name });
        setBusyId(null);
        if (!res.success) {
            toast.error(res.error_message || "Failed to rename view");
            return;
        }
        setViews((prev) => prev.map((v) => (v.id === view.id ? res.data : v)));
        setRenamingId(null);
        toast.success("View renamed");
    };

    const handleOverwrite = async (view: SavedView) => {
        const ok = await confirm({
            title: `Update “${view.name}”?`,
            description: "Replaces the filters stored in this view with the ones on screen now.",
            confirmLabel: "Update view",
        });
        if (!ok) return;
        setBusyId(view.id);
        const res = await reqUpdateView(view.id, { query_params: savableFilters() });
        setBusyId(null);
        if (!res.success) {
            toast.error(res.error_message || "Failed to update view");
            return;
        }
        setViews((prev) => prev.map((v) => (v.id === view.id ? res.data : v)));
        toast.success("View updated");
    };

    const handleLoad = (view: SavedView) => {
        try {
            const params = JSON.parse(view.query_params);
            onLoadView(params);
            setOpen(false);
        } catch (err) {
            // A stored view that will not parse makes the click do nothing at
            // all — no error, no filter change. Nothing else records it.
            reportError("saved_view.apply.failed", err, {
                view_id: view.id,
                view_page: page,
                outcome: "click did nothing; filters unchanged",
            });
        }
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={handleToggle}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
            >
                <FontAwesomeIcon icon={faStar} className="text-xs" />
                <span className="hidden sm:inline">Saved Views</span>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {open && (
                <div className="absolute right-0 lg:left-auto mt-1 w-72 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-50 overflow-hidden">
                    {/* Save current */}
                    {canWrite && (
                    <div className="p-2 border-b border-zinc-100 dark:border-zinc-800">
                        {showNameInput ? (
                            <div className="flex gap-1.5">
                                <input
                                    ref={nameInputRef}
                                    type="text"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") handleSave();
                                        if (e.key === "Escape") {
                                            setShowNameInput(false);
                                            setNewName("");
                                        }
                                    }}
                                    placeholder="View name..."
                                    className="flex-1 px-2 py-1 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <button
                                    onClick={handleSave}
                                    disabled={saving || !newName.trim()}
                                    className="px-2 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50 transition-colors"
                                >
                                    {saving ? (
                                        <FontAwesomeIcon icon={faSpinner} className="animate-spin" />
                                    ) : (
                                        "Save"
                                    )}
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowNameInput(true)}
                                className="w-full text-left px-2 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors font-medium"
                            >
                                + Save current view
                            </button>
                        )}
                    </div>
                    )}

                    {/* Views list */}
                    <div className="max-h-64 overflow-y-auto">
                        {loading ? (
                            <div className="p-4 text-center">
                                <FontAwesomeIcon icon={faSpinner} className="animate-spin text-zinc-400" />
                            </div>
                        ) : viewsError ? (
                            <div className="p-4 text-center">
                                <FailureNote what="saved views" message={viewsError} onRetry={fetchViews} />
                            </div>
                        ) : views.length === 0 ? (
                            <div className="p-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
                                No saved views yet
                            </div>
                        ) : (
                            views.map((view) => (
                                // A row, not a button: the actions are buttons
                                // of their own, and a button nested in a button
                                // is invalid HTML that screen readers flatten.
                                <div
                                    key={view.id}
                                    className="group flex items-center gap-1 px-1.5 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                                >
                                    {renamingId === view.id ? (
                                        <input
                                            autoFocus
                                            value={renameValue}
                                            onChange={(e) => setRenameValue(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") void handleRename(view);
                                                if (e.key === "Escape") {
                                                    e.stopPropagation();
                                                    setRenamingId(null);
                                                }
                                            }}
                                            aria-label={`New name for ${view.name}`}
                                            className="min-w-0 flex-1 px-2 py-1 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    ) : (
                                        <button
                                            onClick={() => handleLoad(view)}
                                            className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-sm text-zinc-700 dark:text-zinc-300"
                                            title={`Apply “${view.name}”`}
                                        >
                                            {view.name}
                                        </button>
                                    )}
                                    {busyId === view.id ? (
                                        <FontAwesomeIcon icon={faSpinner} className="mx-1.5 animate-spin text-xs text-zinc-400" />
                                    ) : canWrite && renamingId === view.id ? (
                                        <ViewAction label="Save name" onClick={() => void handleRename(view)} icon={faCheck} />
                                    ) : canWrite ? (
                                        // Visible on hover AND on keyboard focus — opacity-0 alone
                                        // hid them from anyone tabbing through the list.
                                        <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                            <ViewAction
                                                label={`Rename ${view.name}`}
                                                icon={faPen}
                                                onClick={() => {
                                                    setRenamingId(view.id);
                                                    setRenameValue(view.name);
                                                }}
                                            />
                                            <ViewAction
                                                label={`Update ${view.name} to the current filters`}
                                                icon={faArrowsRotate}
                                                onClick={() => void handleOverwrite(view)}
                                            />
                                            <ViewAction
                                                label={`Delete ${view.name}`}
                                                icon={faTrash}
                                                destructive
                                                onClick={() => void handleDelete(view)}
                                            />
                                        </div>
                                    ) : null}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function ViewAction({
    label,
    icon,
    onClick,
    destructive,
}: {
    label: string;
    icon: typeof faPen;
    onClick: () => void;
    destructive?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            aria-label={label}
            title={label}
            className={`rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
                destructive ? "hover:text-red-500" : "hover:text-zinc-700 dark:hover:text-zinc-200"
            }`}
        >
            <FontAwesomeIcon icon={icon} className="text-[11px]" />
        </button>
    );
}
