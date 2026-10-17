"use client";

import { useState, useMemo } from "react";
import toast from "react-hot-toast";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner, faPlus, faTrash, faPen } from "@fortawesome/free-solid-svg-icons";
import { reportError } from "@/services/monitor.service";
import { NotificationPolicy, ServiceGroup, PolicyMatchers } from "@/types";
import {
    reqCreateServiceGroup,
    reqUpdateServiceGroup,
    reqDeleteServiceGroup,
} from "@/services/api";
import { FailureState } from "@/components/FailureState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionBar } from "@/components/BulkActionBar";
import { useConfirm } from "@/components/ConfirmProvider";
import { useSelection } from "@/hooks/useSelection";
import { useRole } from "@/hooks/useRole";
import { runBulk, toastBulkResult } from "@/tools/bulk.tools";
import { ServiceGroupFormModal, type ServiceGroupFormData } from "./ServiceGroupFormModal";
import { parseJsonSafe } from "./notifications.helpers";

interface ServiceGroupsTabProps {
    serviceGroups: ServiceGroup[];
    serviceGroupsLoading: boolean;
    serviceGroupsError: string | null;
    fetchServiceGroups: () => void;
    policies: NotificationPolicy[];
}

export function ServiceGroupsTab({
    serviceGroups,
    serviceGroupsLoading,
    serviceGroupsError,
    fetchServiceGroups,
    policies,
}: ServiceGroupsTabProps) {
    const [showSGForm, setShowSGForm] = useState(false);
    const [editingSG, setEditingSG] = useState<ServiceGroup | null>(null);
    const [sgSubmitting, setSGSubmitting] = useState(false);

    const confirm = useConfirm();
    const { canWrite } = useRole();
    const [bulkBusy, setBulkBusy] = useState(false);
    const groupIds = useMemo(() => serviceGroups.map((g) => g.id), [serviceGroups]);
    const groupSel = useSelection(groupIds);

    function parseServicesList(input: string): string[] {
        return input
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean);
    }

    const handleCreateSG = async (form: ServiceGroupFormData) => {
        setSGSubmitting(true);
        try {
            const res = await reqCreateServiceGroup({
                name: form.name,
                description: form.description,
                services: JSON.stringify(parseServicesList(form.services)),
            });
            if (!res.success) {
                toast.error(res.error_message || "Failed to create service group");
                return;
            }
            setShowSGForm(false);
            fetchServiceGroups();
            toast.success("Service group created");
        } catch (err) {
            reportError("service_group.create.failed", err, {
                outcome: "service group not created; user toasted",
            });
            toast.error("Failed to create service group");
        } finally {
            setSGSubmitting(false);
        }
    };

    const handleEditSG = async (form: ServiceGroupFormData) => {
        if (!editingSG) return;
        setSGSubmitting(true);
        try {
            const res = await reqUpdateServiceGroup(editingSG.id, {
                name: form.name,
                description: form.description,
                services: JSON.stringify(parseServicesList(form.services)),
            });
            if (!res.success) {
                toast.error(res.error_message || "Failed to update service group");
                return;
            }
            setEditingSG(null);
            fetchServiceGroups();
            toast.success("Service group updated");
        } catch (err) {
            reportError("service_group.save.failed", err, {
                service_group_id: editingSG?.id,
                outcome: "service group edit not saved; user toasted",
            });
            toast.error("Failed to update service group");
        } finally {
            setSGSubmitting(false);
        }
    };

    const confirmDeleteSG = async (sg: ServiceGroup) => {
        const users = policiesReferencingGroup(sg.id).map((p) => p.name);
        const ok = await confirm({
            title: `Delete “${sg.name}”?`,
            description: users.length
                ? `Still targeted by ${users.length} polic${users.length === 1 ? "y" : "ies"}: ${users.join(", ")}. Those matchers will stop matching anything through this group.`
                : "No policy targets this group.",
            confirmLabel: "Delete group",
            destructive: true,
        });
        if (ok) await handleDeleteSG(sg.id);
    };

    const handleDeleteSG = async (id: string) => {
        try {
            const res = await reqDeleteServiceGroup(id);
            if (!res.success) {
                toast.error(res.error_message || "Failed to delete service group");
                return;
            }
            fetchServiceGroups();
            toast.success("Service group deleted");
        } catch (err) {
            reportError("service_group.delete.failed", err, {
                service_group_id: id,
                outcome: "service group kept; user toasted",
            });
            toast.error("Failed to delete service group");
        }
    };

    const policiesReferencingGroup = (groupId: string) =>
        policies.filter((p) => {
            const m = parseJsonSafe<PolicyMatchers>(p.matchers, {});
            return m.service_group === groupId;
        });

    const bulkDeleteGroups = async () => {
        const targets = serviceGroups.filter((g) => groupSel.isSelected(g.id));
        const inUse = targets.filter((g) => policiesReferencingGroup(g.id).length > 0).map((g) => g.name);
        const ok = await confirm({
            title: `Delete ${targets.length} service group${targets.length === 1 ? "" : "s"}?`,
            description: inUse.length
                ? `Still targeted by policies: ${inUse.join(", ")}. Those matchers will stop matching through these groups.`
                : "No policy targets these groups.",
            confirmLabel: `Delete ${targets.length}`,
            destructive: true,
        });
        if (!ok) return;
        setBulkBusy(true);
        const result = await runBulk(targets, (g) => reqDeleteServiceGroup(g.id));
        setBulkBusy(false);
        toastBulkResult(result, "Deleted", "group");
        groupSel.clear();
        fetchServiceGroups();
    };

    return (
        <>
                    <div className="space-y-4">
                        <div className="flex justify-end">
                            {canWrite && (
                            <button
                                onClick={() => setShowSGForm(true)}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                            >
                                <FontAwesomeIcon icon={faPlus} className="text-xs" />
                                Create Group
                            </button>
                            )}
                        </div>

                        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                            {serviceGroupsLoading ? (
                                <div className="flex items-center justify-center py-16">
                                    <FontAwesomeIcon icon={faSpinner} className="text-2xl animate-spin text-zinc-400" />
                                </div>
                            ) : serviceGroupsError ? (
                                <FailureState
                                    what="service groups"
                                    message={serviceGroupsError}
                                    onRetry={fetchServiceGroups}
                                    className="rounded-none border-0"
                                />
                            ) : serviceGroups.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
                                    <svg className="w-12 h-12 mb-3 text-zinc-300 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                    </svg>
                                    <p className="text-sm font-medium">No service groups</p>
                                    <p className="text-xs mt-1">Group services together for easier policy targeting.</p>
                                </div>
                            ) : (
                                <div>
                                    {serviceGroups.map((sg) => {
                                        const services = parseJsonSafe<string[]>(sg.services, []);
                                        return (
                                            <div
                                                key={sg.id}
                                                className="flex items-center gap-4 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                                            >
                                                {canWrite && (
                                                    <Checkbox
                                                        checked={groupSel.isSelected(sg.id)}
                                                        onChange={(e) => groupSel.toggle(sg.id, { shiftKey: e.shiftKey })}
                                                        label={`Select ${sg.name}`}
                                                    />
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                            {sg.name}
                                                        </span>
                                                    </div>
                                                    {sg.description && (
                                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">
                                                            {sg.description}
                                                        </p>
                                                    )}
                                                    <div className="flex flex-wrap gap-1">
                                                        {services.map((svc) => (
                                                            <span
                                                                key={svc}
                                                                className="rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                                                            >
                                                                {svc}
                                                            </span>
                                                        ))}
                                                        {services.length === 0 && (
                                                            <span className="text-xs text-zinc-400 italic">No services</span>
                                                        )}
                                                    </div>
                                                </div>
                                                {canWrite && (
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button
                                                        onClick={() => setEditingSG(sg)}
                                                        className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                        title="Edit"
                                                        aria-label={`Edit ${sg.name}`}
                                                    >
                                                        <FontAwesomeIcon icon={faPen} className="text-sm" />
                                                    </button>
                                                    <button
                                                        onClick={() => void confirmDeleteSG(sg)}
                                                        className="p-2 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                                        title="Delete"
                                                        aria-label={`Delete ${sg.name}`}
                                                    >
                                                        <FontAwesomeIcon icon={faTrash} className="text-sm" />
                                                    </button>
                                                </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    <BulkActionBar count={groupSel.count} noun="group" onClear={groupSel.clear}>
                        <Button size="sm" variant="destructive" loading={bulkBusy} onClick={() => void bulkDeleteGroups()}>Delete</Button>
                    </BulkActionBar>

            {showSGForm && (
                <ServiceGroupFormModal
                    title="Create Service Group"
                    onClose={() => setShowSGForm(false)}
                    onSubmit={handleCreateSG}
                    submitting={sgSubmitting}
                />
            )}
            {editingSG && (
                <ServiceGroupFormModal
                    title="Edit Service Group"
                    initial={{
                        name: editingSG.name,
                        description: editingSG.description,
                        services: parseJsonSafe<string[]>(editingSG.services, []).join("\n"),
                    }}
                    onClose={() => setEditingSG(null)}
                    onSubmit={handleEditSG}
                    submitting={sgSubmitting}
                />
            )}
        </>
    );
}
