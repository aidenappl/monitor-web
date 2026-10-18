"use client";

import { useState, useMemo } from "react";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {

    faPlus,
    faTrash,
    faPen,
    faToggleOn,
    faToggleOff,
    faArrowUp,
    faArrowDown,
    faCopy,
    faChevronDown,
    faChevronRight,
} from "@fortawesome/free-solid-svg-icons";
import { reportError } from "@/services/monitor.service";
import {
    NotificationPolicy,
    ServiceGroup,
    NotificationChannel,
    PolicyMatchers,
    AlertPriority,
    AlertRule,
    PRIORITY_LABELS,
    PRIORITY_COLORS,
} from "@/types";
import {
    reqCreatePolicy,
    reqUpdatePolicy,
    reqDeletePolicy,
    reqReorderPolicies,
} from "@/services/api";
import { FailureState, FailureNote } from "@/components/FailureState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionBar } from "@/components/BulkActionBar";
import { useConfirm } from "@/components/ConfirmProvider";
import { useSelection } from "@/hooks/useSelection";
import { useRole } from "@/hooks/useRole";
import { runBulk, toastBulkResult } from "@/tools/bulk.tools";
import { PolicyFormModal } from "./PolicyFormModal";
import { PolicySkeleton } from "./PolicySkeleton";
import {
    parseJsonSafe,
    getRulesMatchingPolicy,
    priorityBarColor,
    buildMatcherSummary,
    formatMatchCount,
    formToMatchers,
    nameList,
    type PolicyFormData,
} from "./notifications.helpers";

interface PoliciesTabProps {
    policies: NotificationPolicy[];
    /** For the optimistic reorder; the page owns the list because Channels reads it too. */
    setPolicies: (policies: NotificationPolicy[]) => void;
    policiesLoading: boolean;
    policiesError: string | null;
    fetchPolicies: () => void;
    serviceGroups: ServiceGroup[];
    channels: NotificationChannel[];
    alertRules: AlertRule[];
    alertRulesError: string | null;
    fetchAlertRules: () => void;
}

export function PoliciesTab({
    policies,
    setPolicies,
    policiesLoading,
    policiesError,
    fetchPolicies,
    serviceGroups,
    channels,
    alertRules,
    alertRulesError,
    fetchAlertRules,
}: PoliciesTabProps) {
    const [showPolicyForm, setShowPolicyForm] = useState(false);
    const [editingPolicy, setEditingPolicy] = useState<NotificationPolicy | null>(null);
    const [policySubmitting, setPolicySubmitting] = useState(false);

    // Expandable matcher detail per policy
    const [expandedPolicies, setExpandedPolicies] = useState<Set<string>>(new Set());

    const confirm = useConfirm();
    const { canWrite } = useRole();
    const [bulkBusy, setBulkBusy] = useState(false);
    const policyIds = useMemo(() => policies.map((p) => p.id), [policies]);
    const policySel = useSelection(policyIds);

    function buildPolicyPayload(form: PolicyFormData): Partial<NotificationPolicy> {
        const matchers = formToMatchers(form);

        return {
            name: form.name,
            description: form.description,
            matchers: JSON.stringify(matchers),
            channel_ids: JSON.stringify(form.channel_ids),
            continue_matching: form.continue_matching,
            enabled: form.enabled,
        };
    }

    function policyToFormData(policy: NotificationPolicy): PolicyFormData {
        const matchers = parseJsonSafe<PolicyMatchers>(policy.matchers, {});
        const channelIds = parseJsonSafe<string[]>(policy.channel_ids, []);
        return {
            name: policy.name,
            description: policy.description,
            priority: matchers.priority || "",
            services: (matchers.services || []).join(", "),
            service_group: matchers.service_group || "",
            status: matchers.status || "",
            env: matchers.env || "",
            rule_name: matchers.rule_name || "",
            channel_ids: channelIds,
            continue_matching: policy.continue_matching,
            enabled: policy.enabled,
        };
    }

    const handleCreatePolicy = async (form: PolicyFormData) => {
        setPolicySubmitting(true);
        try {
            const res = await reqCreatePolicy(buildPolicyPayload(form));
            if (!res.success) {
                toast.error(res.error_message || "Failed to create policy");
                return;
            }
            setShowPolicyForm(false);
            fetchPolicies();
            toast.success("Policy created");
        } catch (err) {
            reportError("notification_policy.create.failed", err, {
                outcome: "policy not created; user toasted",
            });
            toast.error("Failed to create policy");
        } finally {
            setPolicySubmitting(false);
        }
    };

    const handleEditPolicy = async (form: PolicyFormData) => {
        if (!editingPolicy) return;
        setPolicySubmitting(true);
        try {
            const res = await reqUpdatePolicy(editingPolicy.id, buildPolicyPayload(form));
            if (!res.success) {
                toast.error(res.error_message || "Failed to update policy");
                return;
            }
            setEditingPolicy(null);
            fetchPolicies();
            toast.success("Policy updated");
        } catch (err) {
            reportError("notification_policy.save.failed", err, {
                policy_id: editingPolicy?.id,
                outcome: "policy edit not saved; user toasted",
            });
            toast.error("Failed to update policy");
        } finally {
            setPolicySubmitting(false);
        }
    };

    const confirmDeletePolicy = async (policy: NotificationPolicy) => {
        if (policy.is_default) return;
        const ok = await confirm({
            title: `Delete “${policy.name}”?`,
            description: "Alerts this policy matched fall through to the next policy in order — or to none.",
            confirmLabel: "Delete policy",
            destructive: true,
        });
        if (ok) await handleDeletePolicy(policy.id);
    };

    const handleDeletePolicy = async (id: string) => {
        try {
            const res = await reqDeletePolicy(id);
            if (!res.success) {
                toast.error(res.error_message || "Failed to delete policy");
                return;
            }
            fetchPolicies();
            toast.success("Policy deleted");
        } catch (err) {
            reportError("notification_policy.delete.failed", err, {
                policy_id: id,
                outcome: "policy kept; user toasted",
            });
            toast.error("Failed to delete policy");
        }
    };

    const handleDuplicatePolicy = async (policy: NotificationPolicy) => {
        try {
            const matchers = policy.matchers;
            const channelIds = policy.channel_ids;
            const res = await reqCreatePolicy({
                name: `${policy.name} (Copy)`,
                description: policy.description,
                matchers,
                channel_ids: channelIds,
                continue_matching: policy.continue_matching,
                enabled: false,
            });
            if (!res.success) {
                toast.error(res.error_message || "Failed to duplicate policy");
                return;
            }
            fetchPolicies();
            toast.success("Policy duplicated");
        } catch (err) {
            reportError("notification_policy.duplicate.failed", err, {
                policy_id: policy.id,
                outcome: "no copy created; user toasted",
            });
            toast.error("Failed to duplicate policy");
        }
    };

    const handleTogglePolicy = async (policy: NotificationPolicy) => {
        try {
            const res = await reqUpdatePolicy(policy.id, { enabled: !policy.enabled });
            if (!res.success) {
                toast.error(res.error_message || "Failed to toggle policy");
                return;
            }
            fetchPolicies();
            toast.success(policy.enabled ? "Policy disabled" : "Policy enabled");
        } catch (err) {
            reportError("notification_policy.toggle.failed", err, {
                policy_id: policy.id,
                enabling: !policy.enabled,
                outcome: "policy state unchanged; user toasted",
            });
            toast.error("Failed to toggle policy");
        }
    };

    const handleMovePolicy = async (index: number, direction: "up" | "down") => {
        const swapIndex = direction === "up" ? index - 1 : index + 1;
        if (swapIndex < 0 || swapIndex >= policies.length) return;

        const reordered = [...policies];
        const temp = reordered[index];
        reordered[index] = reordered[swapIndex];
        reordered[swapIndex] = temp;
        setPolicies(reordered);

        try {
            // The reorder is applied optimistically above and the catch was the
            // rollback. With a non-2xx arriving as a VALUE that catch never ran,
            // so a rejected reorder left the list showing an order the server
            // had refused — and policy order decides which rule wins. Refetching
            // puts the real order back on screen.
            const res = await reqReorderPolicies(reordered.map((p) => p.id));
            if (!res.success) {
                toast.error(res.error_message || "Failed to reorder policies");
                fetchPolicies();
            }
        } catch (err) {
            reportError("notification_policy.reorder.failed", err, {
                outcome: "list refetched to show the server's order",
            });
            fetchPolicies();
        }
    };

    const bulkPoliciesEnabled = async (enabled: boolean) => {
        const targets = policies.filter((p) => policySel.isSelected(p.id) && p.enabled !== enabled);
        if (targets.length === 0) return;
        setBulkBusy(true);
        const result = await runBulk(targets, (p) => reqUpdatePolicy(p.id, { enabled }));
        setBulkBusy(false);
        toastBulkResult(result, enabled ? "Enabled" : "Disabled", "policy");
        fetchPolicies();
    };

    const bulkDeletePolicies = async () => {
        const selected = policies.filter((p) => policySel.isSelected(p.id));
        const targets = selected.filter((p) => !p.is_default);
        const skipped = selected.length - targets.length;
        if (targets.length === 0) {
            toast.error("System policies cannot be deleted");
            return;
        }
        const ok = await confirm({
            title: `Delete ${targets.length} polic${targets.length === 1 ? "y" : "ies"}?`,
            description: `${nameList(targets.map((p) => p.name))}.${skipped ? ` ${skipped} system polic${skipped === 1 ? "y is" : "ies are"} skipped.` : ""} Alerts they matched fall through to the next policy in order.`,
            confirmLabel: `Delete ${targets.length}`,
            destructive: true,
        });
        if (!ok) return;
        setBulkBusy(true);
        const result = await runBulk(targets, (p) => reqDeletePolicy(p.id));
        setBulkBusy(false);
        toastBulkResult(result, "Deleted", "policy");
        policySel.clear();
        fetchPolicies();
    };

    function toggleExpandPolicy(id: string) {
        setExpandedPolicies((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }

    function renderMatcherBadges(policy: NotificationPolicy) {
        const matchers = parseJsonSafe<PolicyMatchers>(policy.matchers, {});
        const badges: React.ReactNode[] = [];

        if (matchers.priority && ["P0", "P1", "P2", "P3"].includes(matchers.priority)) {
            const priority = matchers.priority as AlertPriority;
            const label = PRIORITY_LABELS[priority] || priority;
            const color = PRIORITY_COLORS[priority] || "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
            badges.push(
                <span key="priority" className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
                    {priority} {label}
                </span>
            );
        }

        if (matchers.services && matchers.services.length > 0) {
            matchers.services.forEach((svc, i) => {
                badges.push(
                    <span key={`svc-${i}`} className="rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        {svc}
                    </span>
                );
            });
        }

        if (matchers.service_group) {
            const sg = serviceGroups.find((g) => g.id === matchers.service_group);
            badges.push(
                <span key="sg" className="rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    {sg ? sg.name : "group"}
                </span>
            );
        }

        if (matchers.status) {
            const statusColor =
                matchers.status === "firing"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
            badges.push(
                <span key="status" className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                    {matchers.status}
                </span>
            );
        }

        if (matchers.env) {
            badges.push(
                <span key="env" className="rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    {matchers.env}
                </span>
            );
        }

        if (matchers.rule_name) {
            badges.push(
                <span key="rule" className="rounded-full px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                    rule: {matchers.rule_name}
                </span>
            );
        }

        if (badges.length === 0) {
            badges.push(
                <span key="any" className="rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    all alerts
                </span>
            );
        }

        return badges;
    }

    function getChannelCount(policy: NotificationPolicy): number {
        const ids = parseJsonSafe<string[]>(policy.channel_ids, []);
        return ids.length;
    }

    return (
        <>
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 min-w-0 flex-1 basis-60">
                                Policies are evaluated top-to-bottom. The first match wins unless &quot;continue matching&quot; is set.
                            </p>
                            <div className="flex flex-wrap items-center gap-3">
                                {/* Partial: the policies themselves loaded, only
                                    the matching-rules preview is missing. A note
                                    beside working data, not a panel over it. */}
                                {alertRulesError && (
                                    <FailureNote
                                        what="matching alert rules"
                                        message={alertRulesError}
                                        onRetry={fetchAlertRules}
                                    />
                                )}
                                {canWrite && (
                                <button
                                    onClick={() => setShowPolicyForm(true)}
                                    className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                                >
                                    <FontAwesomeIcon icon={faPlus} className="text-xs h-[1em] w-[1em]" aria-hidden="true" />
                                    Create Policy
                                </button>
                                )}
                            </div>
                        </div>

                        {policiesLoading ? (
                            <PolicySkeleton rows={4} />
                        ) : policiesError ? (
                            /* Replaces the empty state rather than sitting above
                               it: "no policies" tells an operator their alerts
                               route nowhere, which is precisely what a failed
                               read cannot establish. */
                            <FailureState
                                what="notification policies"
                                message={policiesError}
                                onRetry={fetchPolicies}
                            />
                        ) : policies.length === 0 ? (
                            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                                <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
                                    <svg className="w-12 h-12 mb-3 text-zinc-300 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                    </svg>
                                    <p className="text-sm font-medium">No notification policies</p>
                                    <p className="text-xs mt-1">Create your first policy to route alerts to channels.</p>
                                </div>
                            </div>
                        ) : (
                            <div>
                                {policies.map((policy, index) => {
                                    const matchers = parseJsonSafe<PolicyMatchers>(policy.matchers, {});
                                    const channelCount = getChannelCount(policy);
                                    const matchingRuleCount = getRulesMatchingPolicy(policy, alertRules);
                                    const summary = buildMatcherSummary(matchers, serviceGroups);
                                    const isExpanded = expandedPolicies.has(policy.id);
                                    const barColor = priorityBarColor(matchers);
                                    const isLast = index === policies.length - 1;

                                    return (
                                        <div key={policy.id}>
                                            {/* Policy card row: position circle + priority bar + content */}
                                            <div className="flex items-stretch gap-3">
                                                {/* Position circle */}
                                                <div className="flex flex-col items-center pt-3.5 shrink-0">
                                                    <div className="w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                                                        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{index + 1}</span>
                                                    </div>
                                                </div>

                                                {/* Card with priority left border */}
                                                <div
                                                    className={`flex-1 min-w-0 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm border-l-4 ${barColor} transition-colors ${
                                                        !policy.enabled ? "opacity-60" : ""
                                                    }`}
                                                >
                                                    <div className="px-4 py-3">
                                                        {/* Top row: name + badges + actions */}
                                                        {/* Below sm the six actions take their own row: sharing one
                                                            with them, the truncating name collapsed to 0px and every
                                                            card on a phone read only "System". */}
                                                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 sm:justify-between">
                                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                                                {canWrite && (
                                                                    <Checkbox
                                                                        checked={policySel.isSelected(policy.id)}
                                                                        onChange={(e) => policySel.toggle(policy.id, { shiftKey: e.shiftKey })}
                                                                        label={`Select ${policy.name}`}
                                                                    />
                                                                )}
                                                                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate min-w-0" title={policy.name}>
                                                                    {policy.name}
                                                                </span>
                                                                {policy.is_default && (
                                                                    <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300 shrink-0">
                                                                        System
                                                                    </span>
                                                                )}
                                                                {!policy.enabled && (
                                                                    <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500 shrink-0">
                                                                        disabled
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {canWrite && (
                                                            <div className="flex flex-wrap items-center gap-1 shrink-0 -ml-1.5 sm:ml-0">
                                                                <button
                                                                    onClick={() => handleMovePolicy(index, "up")}
                                                                    disabled={index === 0}
                                                                    className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                                    title="Move up"
                                                                    aria-label={`Move up ${policy.name}`}
                                                                >
                                                                    <FontAwesomeIcon icon={faArrowUp} className="text-xs" />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleMovePolicy(index, "down")}
                                                                    disabled={isLast}
                                                                    className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                                    title="Move down"
                                                                    aria-label={`Move down ${policy.name}`}
                                                                >
                                                                    <FontAwesomeIcon icon={faArrowDown} className="text-xs" />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleTogglePolicy(policy)}
                                                                    className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                                    title={policy.enabled ? "Disable" : "Enable"}
                                                                    aria-label={policy.enabled ? `Disable ${policy.name}` : `Enable ${policy.name}`}
                                                                >
                                                                    <FontAwesomeIcon
                                                                        icon={policy.enabled ? faToggleOn : faToggleOff}
                                                                        className={`text-base ${policy.enabled ? "text-emerald-500" : ""}`}
                                                                    />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDuplicatePolicy(policy)}
                                                                    className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                                    title="Duplicate"
                                                                    aria-label={`Duplicate ${policy.name}`}
                                                                >
                                                                    <FontAwesomeIcon icon={faCopy} className="text-xs" />
                                                                </button>
                                                                <button
                                                                    onClick={() => setEditingPolicy(policy)}
                                                                    className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                                    title="Edit"
                                                                    aria-label={`Edit ${policy.name}`}
                                                                >
                                                                    <FontAwesomeIcon icon={faPen} className="text-xs" />
                                                                </button>
                                                                <button
                                                                    onClick={() => void confirmDeletePolicy(policy)}
                                                                    disabled={policy.is_default}
                                                                    className="p-1.5 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                                    title={policy.is_default ? "Cannot delete default policy" : "Delete"}
                                                                    aria-label={policy.is_default ? "Default policies cannot be deleted" : `Delete ${policy.name}`}
                                                                >
                                                                    <FontAwesomeIcon icon={faTrash} className="text-xs" />
                                                                </button>
                                                            </div>
                                                            )}
                                                        </div>

                                                        {/* Second row: matching rules + channel count */}
                                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                                            {formatMatchCount(matchingRuleCount)}
                                                            {" · "}
                                                            {channelCount} channel{channelCount !== 1 ? "s" : ""}
                                                        </p>

                                                        {/* Third row: compact matcher summary with expand toggle */}
                                                        <div className="mt-1.5 flex items-center gap-1.5">
                                                            <button
                                                                onClick={() => toggleExpandPolicy(policy.id)}
                                                                aria-expanded={isExpanded}
                                                                aria-label={`${isExpanded ? "Hide" : "Show"} matchers for ${policy.name}`}
                                                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                                                            >
                                                                <FontAwesomeIcon
                                                                    icon={isExpanded ? faChevronDown : faChevronRight}
                                                                    className="text-[10px]"
                                                                />
                                                            </button>
                                                            {summary ? (
                                                                <button
                                                                    onClick={() => toggleExpandPolicy(policy.id)}
                                                                    className="text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors text-left"
                                                                >
                                                                    {summary}
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    onClick={() => toggleExpandPolicy(policy.id)}
                                                                    className="text-xs text-zinc-400 dark:text-zinc-500 italic hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                                                                >
                                                                    All alerts
                                                                </button>
                                                            )}
                                                        </div>

                                                        {/* Expanded badges */}
                                                        {isExpanded && (
                                                            <div className="mt-2 flex flex-wrap gap-1.5 pl-5">
                                                                {renderMatcherBadges(policy)}
                                                            </div>
                                                        )}

                                                        {/* Continue matching / stops indicator */}
                                                        {policy.continue_matching ? (
                                                            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-blue-500 dark:text-blue-400">
                                                                <FontAwesomeIcon icon={faChevronDown} className="text-[9px]" />
                                                                <span>continues</span>
                                                            </div>
                                                        ) : (
                                                            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-350 dark:text-zinc-400">
                                                                <span className="inline-block w-2 h-2 rounded-sm bg-zinc-300 dark:bg-zinc-600" />
                                                                <span>stops</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Connector line between cards */}
                                            {!isLast && (
                                                <div className="flex items-center pl-[11px] h-6">
                                                    <div className="w-px h-full border-l-2 border-dashed border-zinc-300 dark:border-zinc-600" />
                                                </div>
                                            )}

                                            {/* Catch-all note after the last policy */}
                                            {isLast && (
                                                <p className="text-xs text-zinc-400 dark:text-zinc-500 italic mt-3 pl-9">
                                                    Alerts not matching any policy above will use direct channel assignments
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <BulkActionBar count={policySel.count} noun="policy" onClear={policySel.clear}>
                        <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void bulkPoliciesEnabled(true)}>Enable</Button>
                        <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void bulkPoliciesEnabled(false)}>Disable</Button>
                        <Button size="sm" variant="destructive" loading={bulkBusy} onClick={() => void bulkDeletePolicies()}>Delete</Button>
                    </BulkActionBar>

            {showPolicyForm && (
                <PolicyFormModal
                    title="Create Policy"
                    onClose={() => setShowPolicyForm(false)}
                    onSubmit={handleCreatePolicy}
                    submitting={policySubmitting}
                    channels={channels}
                    serviceGroups={serviceGroups}
                    alertRules={alertRules}
                />
            )}
            {editingPolicy && (
                <PolicyFormModal
                    title="Edit Policy"
                    initial={policyToFormData(editingPolicy)}
                    onClose={() => setEditingPolicy(null)}
                    onSubmit={handleEditPolicy}
                    submitting={policySubmitting}
                    channels={channels}
                    serviceGroups={serviceGroups}
                    alertRules={alertRules}
                />
            )}
        </>
    );
}
