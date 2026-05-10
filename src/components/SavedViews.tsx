"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar, faSpinner } from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { SavedView } from "@/types";
import { reqListViews, reqCreateView, reqDeleteView } from "@/services/api";

interface SavedViewsProps {
    page: string;
    currentFilters: Record<string, unknown>;
    onLoadView: (queryParams: Record<string, unknown>) => void;
}

export function SavedViews({ page, currentFilters, onLoadView }: SavedViewsProps) {
    const [open, setOpen] = useState(false);
    const [views, setViews] = useState<SavedView[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showNameInput, setShowNameInput] = useState(false);
    const [newName, setNewName] = useState("");
    const dropdownRef = useRef<HTMLDivElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const viewsLoadedRef = useRef(false);

    const fetchViews = useCallback(async () => {
        setLoading(true);
        try {
            const res = await reqListViews(page);
            setViews(res.data || []);
            viewsLoadedRef.current = true;
        } catch {
            // Silently fail — views are supplementary
        } finally {
            setLoading(false);
        }
    }, [page]);

    // Fetch once on mount
    useEffect(() => {
        fetchViews();
    }, [fetchViews]);

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
            await reqCreateView(newName.trim(), JSON.stringify(currentFilters), page);
            setNewName("");
            setShowNameInput(false);
            await fetchViews();
        } catch {
            // silent
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await reqDeleteView(id);
            setViews((prev) => prev.filter((v) => v.id !== id));
        } catch {
            // silent
        }
    };

    const handleLoad = (view: SavedView) => {
        try {
            const params = JSON.parse(view.query_params);
            onLoadView(params);
            setOpen(false);
        } catch {
            // invalid JSON
        }
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setOpen(!open)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg transition-colors"
            >
                <FontAwesomeIcon icon={faStar} className="text-xs" />
                <span className="hidden sm:inline">Saved Views</span>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {open && (
                <div className="absolute left-0 mt-1 w-64 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-50 overflow-hidden">
                    {/* Save current */}
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

                    {/* Views list */}
                    <div className="max-h-64 overflow-y-auto">
                        {loading ? (
                            <div className="p-4 text-center">
                                <FontAwesomeIcon icon={faSpinner} className="animate-spin text-zinc-400" />
                            </div>
                        ) : views.length === 0 ? (
                            <div className="p-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
                                No saved views yet
                            </div>
                        ) : (
                            views.map((view) => (
                                <button
                                    key={view.id}
                                    onClick={() => handleLoad(view)}
                                    className="w-full text-left px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center justify-between group transition-colors"
                                >
                                    <span className="truncate">{view.name}</span>
                                    <button
                                        onClick={(e) => handleDelete(view.id, e)}
                                        className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-400 hover:text-red-500 transition-all"
                                        title="Delete view"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
