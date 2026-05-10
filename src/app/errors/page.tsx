"use client";

import { useState, useEffect, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSpinner,
    faArrowsRotate,
    faXmark,
    faCheck,
    faEyeSlash,
    faRotateLeft,
    faChevronRight,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { Issue, Event } from "@/types";
import { reqListIssues, reqUpdateIssue, reqGetIssueEvents } from "@/services/api";
import { formatTimestamp, formatTimeAgo } from "@/tools/format.tools";

type StatusFilter = "unresolved" | "resolved" | "ignored";

interface IssueDetailPanelProps {
    issue: Issue;
    onClose: () => void;
    onUpdateStatus: (id: string, status: string) => void;
}

function IssueDetailPanel({ issue, onClose, onUpdateStatus }: IssueDetailPanelProps) {
    const [events, setEvents] = useState<Event[]>([]);
    const [loadingEvents, setLoadingEvents] = useState(true);

    // Close on Escape key and lock body scroll
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handleEsc);
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", handleEsc);
            document.body.style.overflow = "";
        };
    }, [onClose]);

    useEffect(() => {
        const load = async () => {
            setLoadingEvents(true);
            try {
                const res = await reqGetIssueEvents(issue.id, 20);
                setEvents(res.data || []);
            } catch {
                // ignore
            } finally {
                setLoadingEvents(false);
            }
        };
        load();
    }, [issue.id]);

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/30" onClick={onClose} />
            <div className="relative w-full max-w-xl bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-xl overflow-y-auto">
                <div className="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            {issue.path && (
                                <p className="text-sm font-mono font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                    {issue.path}
                                </p>
                            )}
                            <p className={`text-xs text-zinc-500 dark:text-zinc-400 truncate ${issue.path ? "mt-0.5" : ""}`}>
                                {issue.name}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
                        >
                            <FontAwesomeIcon icon={faXmark} className="text-lg" />
                        </button>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    {/* Meta */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Service</p>
                            <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                                {issue.service}
                            </span>
                        </div>
                        <div>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Status</p>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                issue.status === "unresolved"
                                    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                    : issue.status === "resolved"
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                            }`}>
                                {issue.status}
                            </span>
                        </div>
                        {issue.path && (
                            <div className="col-span-2">
                                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Path</p>
                                <p className="text-sm font-mono text-zinc-900 dark:text-zinc-100">
                                    {issue.path}
                                </p>
                            </div>
                        )}
                        <div>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Occurrences</p>
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                {issue.occurrence_count.toLocaleString()}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">First Seen</p>
                            <p className="text-sm text-zinc-700 dark:text-zinc-300">
                                {formatTimestamp(issue.first_seen)}
                            </p>
                        </div>
                        <div className="col-span-2">
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">Last Seen</p>
                            <p className="text-sm text-zinc-700 dark:text-zinc-300">
                                {formatTimestamp(issue.last_seen)}
                            </p>
                        </div>
                    </div>

                    {/* Message */}
                    <div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">Message</p>
                        <div className="text-sm bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3 whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300 font-mono leading-relaxed">
                            {issue.message}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                        {issue.status !== "resolved" && (
                            <button
                                onClick={() => onUpdateStatus(issue.id, "resolved")}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
                            >
                                <FontAwesomeIcon icon={faCheck} className="text-xs" />
                                Resolve
                            </button>
                        )}
                        {issue.status !== "ignored" && (
                            <button
                                onClick={() => onUpdateStatus(issue.id, "ignored")}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                            >
                                <FontAwesomeIcon icon={faEyeSlash} className="text-xs" />
                                Ignore
                            </button>
                        )}
                        {issue.status !== "unresolved" && (
                            <button
                                onClick={() => onUpdateStatus(issue.id, "unresolved")}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                            >
                                <FontAwesomeIcon icon={faRotateLeft} className="text-xs" />
                                Reopen
                            </button>
                        )}
                    </div>

                    {/* Recent Events */}
                    <div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">Recent Events</p>
                        {loadingEvents ? (
                            <div className="flex items-center justify-center py-8">
                                <FontAwesomeIcon icon={faSpinner} className="text-lg animate-spin text-zinc-400" />
                            </div>
                        ) : events.length === 0 ? (
                            <p className="text-sm text-zinc-400 dark:text-zinc-500 py-4 text-center">No events found</p>
                        ) : (
                            <div className="space-y-2">
                                {events.map((evt, i) => (
                                    <div
                                        key={`${evt.timestamp}-${i}`}
                                        className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg p-3"
                                    >
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
                                                {formatTimestamp(evt.timestamp)}
                                            </span>
                                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                                evt.level === "error" || evt.level === "fatal"
                                                    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400"
                                            }`}>
                                                {evt.level || "info"}
                                            </span>
                                        </div>
                                        {evt.data && Object.keys(evt.data).length > 0 && (
                                            <pre className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 overflow-x-auto">
                                                {JSON.stringify(evt.data, null, 2)}
                                            </pre>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function ErrorsPage() {
    const [issues, setIssues] = useState<Issue[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("unresolved");
    const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const fetchIssues = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await reqListIssues({ status: statusFilter, limit: 100 });
            setIssues(res.data || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to fetch issues");
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        fetchIssues();
    }, [fetchIssues]);

    const handleUpdateStatus = async (id: string, status: string) => {
        try {
            await reqUpdateIssue(id, status);
            if (selectedIssue?.id === id) {
                setSelectedIssue({ ...selectedIssue, status: status as Issue["status"] });
            }
            fetchIssues();
        } catch {
            // ignore
        }
    };

    const handleBulkAction = async (status: string) => {
        const ids = Array.from(selectedIds);
        try {
            await Promise.all(ids.map((id) => reqUpdateIssue(id, status)));
        } catch {
            // Individual failures are acceptable, still refresh the list
        }
        setSelectedIds(new Set());
        fetchIssues();
    };

    const toggleSelect = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === issues.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(issues.map((i) => i.id)));
        }
    };

    const statusTabs: { id: StatusFilter; label: string }[] = [
        { id: "unresolved", label: "Unresolved" },
        { id: "resolved", label: "Resolved" },
        { id: "ignored", label: "Ignored" },
    ];

    return (
        <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <div className="space-y-4 sm:space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                            Errors
                        </h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                            Grouped error tracking and issue management.
                        </p>
                    </div>
                    <button
                        onClick={fetchIssues}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg disabled:opacity-50 transition-colors"
                    >
                        <FontAwesomeIcon
                            icon={loading ? faSpinner : faArrowsRotate}
                            className={`text-sm ${loading ? "animate-spin" : ""}`}
                        />
                    </button>
                </div>

                {/* Status tabs */}
                <div className="border-b border-zinc-200 dark:border-zinc-700">
                    <nav className="flex gap-1 -mb-px">
                        {statusTabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => {
                                    setStatusFilter(tab.id);
                                    setSelectedIds(new Set());
                                }}
                                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                    statusFilter === tab.id
                                        ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                                        : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600"
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Bulk actions */}
                {selectedIds.size > 0 && (
                    <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                        <span className="text-sm text-blue-700 dark:text-blue-300">
                            {selectedIds.size} selected
                        </span>
                        {statusFilter !== "resolved" && (
                            <button
                                onClick={() => handleBulkAction("resolved")}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
                            >
                                <FontAwesomeIcon icon={faCheck} className="text-xs" />
                                Resolve
                            </button>
                        )}
                        {statusFilter !== "ignored" && (
                            <button
                                onClick={() => handleBulkAction("ignored")}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                            >
                                <FontAwesomeIcon icon={faEyeSlash} className="text-xs" />
                                Ignore
                            </button>
                        )}
                    </div>
                )}

                {error && (
                    <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3">
                        <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                    </div>
                )}

                {/* Issues list */}
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin text-zinc-400" />
                        </div>
                    ) : issues.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
                            <svg className="w-12 h-12 mb-3 text-zinc-300 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-sm font-medium">No {statusFilter} issues</p>
                            <p className="text-xs mt-1">
                                {statusFilter === "unresolved" ? "All clear! No unresolved errors." : `No ${statusFilter} issues found.`}
                            </p>
                        </div>
                    ) : (
                        <div>
                            {/* Header row */}
                            <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.size === issues.length && issues.length > 0}
                                    onChange={toggleSelectAll}
                                    className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                    {issues.length} issue{issues.length !== 1 ? "s" : ""}
                                </span>
                            </div>
                            {issues.map((issue) => (
                                <div
                                    key={issue.id}
                                    className={`flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${
                                        issue.status === "resolved" ? "opacity-60" : ""
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(issue.id)}
                                        onChange={() => toggleSelect(issue.id)}
                                        className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500 shrink-0"
                                    />
                                    <div className="w-1 h-8 rounded-full shrink-0 self-stretch my-auto" style={{
                                        backgroundColor: issue.status === "unresolved" ? "var(--color-red-500, #ef4444)" : issue.status === "resolved" ? "var(--color-emerald-500, #10b981)" : "var(--color-zinc-300, #d4d4d8)"
                                    }} />
                                    <div
                                        className="flex-1 min-w-0 cursor-pointer"
                                        onClick={() => setSelectedIssue(issue)}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 shrink-0">
                                                {issue.service}
                                            </span>
                                            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate font-mono">
                                                {issue.path || issue.name}
                                            </span>
                                            {issue.path && (
                                                <span className="text-xs text-zinc-400 dark:text-zinc-500 truncate hidden lg:inline">
                                                    {issue.name}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                                            {issue.message}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 ring-1 ring-inset ring-zinc-200 dark:ring-zinc-700">
                                            {issue.occurrence_count.toLocaleString()}
                                        </span>
                                        <span className="hidden sm:inline text-xs text-zinc-400 dark:text-zinc-500 tabular-nums" title={`Last seen: ${formatTimestamp(issue.last_seen)}`}>
                                            {formatTimeAgo(issue.last_seen)}
                                        </span>
                                        <FontAwesomeIcon
                                            icon={faChevronRight}
                                            className="text-zinc-300 dark:text-zinc-600"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Slide-out detail panel */}
            {selectedIssue && (
                <IssueDetailPanel
                    issue={selectedIssue}
                    onClose={() => setSelectedIssue(null)}
                    onUpdateStatus={handleUpdateStatus}
                />
            )}
        </main>
    );
}
