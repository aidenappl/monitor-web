"use client";

import { useState, useMemo } from "react";
import { NotificationChannel, ServiceGroup, AlertRule } from "@/types";
import { Modal } from "@/components/ui/modal";
import { FormFooter } from "./FormFooter";
import {
    INPUT_CLASS,
    typeBadgeClass,
    getRulesMatchingFormData,
    DEFAULT_POLICY_FORM,
    type PolicyFormData,
} from "./notifications.helpers";

export interface PolicyFormModalProps {
    initial?: PolicyFormData;
    title: string;
    onClose: () => void;
    onSubmit: (data: PolicyFormData) => void;
    submitting: boolean;
    channels: NotificationChannel[];
    serviceGroups: ServiceGroup[];
    alertRules: AlertRule[];
}

export function PolicyFormModal({
    initial,
    title,
    onClose,
    onSubmit,
    submitting,
    channels,
    serviceGroups,
    alertRules,
}: PolicyFormModalProps) {
    const [form, setForm] = useState<PolicyFormData>(initial || DEFAULT_POLICY_FORM);

    const handleChange = (field: keyof PolicyFormData, value: string | string[] | boolean) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    const toggleChannel = (id: string) => {
        const next = form.channel_ids.includes(id)
            ? form.channel_ids.filter((c) => c !== id)
            : [...form.channel_ids, id];
        handleChange("channel_ids", next);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(form);
    };

    const matchCount = useMemo(() => getRulesMatchingFormData(form, alertRules), [form, alertRules]);
    // "Active" means enabled: a disabled rule never fires, so it is neither a
    // match nor part of the total — it is reported beside them.
    const totalRules = alertRules.filter((r) => r.enabled).length;

    return (
        <Modal open onClose={onClose} title={title} widthClass="max-w-lg" dismissible={!submitting}>
                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label htmlFor="nf-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Name</label>
                        <input id="nf-name"
                            type="text"
                            value={form.name}
                            onChange={(e) => handleChange("name", e.target.value)}
                            required
                            className={INPUT_CLASS}
                            placeholder="e.g. Critical PagerDuty"
                        />
                    </div>
                    <div>
                        <label htmlFor="nf-description" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Description</label>
                        <input id="nf-description"
                            type="text"
                            value={form.description}
                            onChange={(e) => handleChange("description", e.target.value)}
                            className={INPUT_CLASS}
                            placeholder="Optional description"
                        />
                    </div>

                    {/* Channels */}
                    {channels.length > 0 && (
                        <div>
                            <p id="nf-channels-label" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Notification Channels</p>
                            <p className="text-xs text-zinc-400 mb-2">Where a matching alert is delivered.</p>
                            <div role="group" aria-labelledby="nf-channels-label" className="space-y-1">
                                {channels.map((ch) => (
                                    <label key={ch.id} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                                        <input
                                            type="checkbox"
                                            checked={form.channel_ids.includes(ch.id)}
                                            onChange={() => toggleChannel(ch.id)}
                                            className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                                        />
                                        {ch.name}
                                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeClass(ch.type)}`}>
                                            {ch.type}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* When Section */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                When should this trigger?
                            </h4>
                        </div>
                        <div className="grid grid-cols-2 gap-3 pl-4">
                            <div>
                                <label htmlFor="nf-priority" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Priority</label>
                                <select id="nf-priority"
                                    value={form.priority}
                                    onChange={(e) => handleChange("priority", e.target.value)}
                                    className={INPUT_CLASS}
                                >
                                    <option value="">Any</option>
                                    <option value="P0">P0 Critical</option>
                                    <option value="P1">P1 High</option>
                                    <option value="P2">P2 Medium</option>
                                    <option value="P3">P3 Low</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="nf-status" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Status</label>
                                <select id="nf-status"
                                    value={form.status}
                                    onChange={(e) => handleChange("status", e.target.value)}
                                    className={INPUT_CLASS}
                                >
                                    <option value="">Any</option>
                                    <option value="firing">Firing</option>
                                    <option value="resolved">Resolved</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Where Section */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                            <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                Which alerts should it match?
                            </h4>
                        </div>
                        <div className="space-y-3 pl-4">
                            <div>
                                <label htmlFor="nf-services" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Services</label>
                                <input id="nf-services"
                                    type="text"
                                    value={form.services}
                                    onChange={(e) => handleChange("services", e.target.value)}
                                    className={INPUT_CLASS}
                                    placeholder="Comma-separated service names"
                                />
                                <p className="text-xs text-zinc-400 mt-1">e.g. keyring-api, lattice-api, monitor-core</p>
                            </div>

                            <div>
                                <label htmlFor="nf-service-group" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Service Group</label>
                                <select id="nf-service-group"
                                    value={form.service_group}
                                    onChange={(e) => handleChange("service_group", e.target.value)}
                                    className={INPUT_CLASS}
                                >
                                    <option value="">None</option>
                                    {serviceGroups.map((sg) => (
                                        <option key={sg.id} value={sg.id}>
                                            {sg.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="nf-environment" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Environment</label>
                                    <input id="nf-environment"
                                        type="text"
                                        value={form.env}
                                        onChange={(e) => handleChange("env", e.target.value)}
                                        className={INPUT_CLASS}
                                        placeholder="e.g. production"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="nf-rule-name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Rule Name</label>
                                    <input id="nf-rule-name"
                                        type="text"
                                        value={form.rule_name}
                                        onChange={(e) => handleChange("rule_name", e.target.value)}
                                        className={INPUT_CLASS}
                                        placeholder="Substring match"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Live match preview */}
                    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                        This policy would match{" "}
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">{matchCount.active}</span>{" "}
                        of {totalRules} active alert rule{totalRules !== 1 ? "s" : ""}
                        {matchCount.disabled > 0 && (
                            <> · {matchCount.disabled} disabled rule{matchCount.disabled !== 1 ? "s" : ""} also match, but will not fire</>
                        )}
                    </div>

                    {/* Toggles */}
                    <div className="flex items-center gap-6 pt-2">
                        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.continue_matching}
                                onChange={(e) => handleChange("continue_matching", e.target.checked)}
                                className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                            />
                            Continue matching
                        </label>
                        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.enabled}
                                onChange={(e) => handleChange("enabled", e.target.checked)}
                                className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                            />
                            Enabled
                        </label>
                    </div>

                    <FormFooter
                        isEdit={Boolean(initial)}
                        submitting={submitting}
                        disabled={!form.name.trim()}
                        onCancel={onClose}
                    />
                </form>
        </Modal>
    );
}
