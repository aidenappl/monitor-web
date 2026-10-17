"use client";

import { useState, useEffect, useMemo } from "react";
import { Modal } from "@/components/ui/modal";
import { FailureNote } from "@/components/FailureState";
import { getLabelValues } from "@/services/api";
import { suggestionWindow } from "@/tools/timeRange.tools";
import { reportError } from "@/services/monitor.service";
import { FormFooter } from "./FormFooter";
import { INPUT_CLASS, parseServicesList } from "./notifications.helpers";

export interface ServiceGroupFormData {
    name: string;
    description: string;
    services: string;
}

export const DEFAULT_SG_FORM: ServiceGroupFormData = {
    name: "",
    description: "",
    services: "",
};

export interface ServiceGroupFormModalProps {
    initial?: ServiceGroupFormData;
    title: string;
    onClose: () => void;
    onSubmit: (data: ServiceGroupFormData) => void;
    submitting: boolean;
}

export function ServiceGroupFormModal({
    initial,
    title,
    onClose,
    onSubmit,
    submitting,
}: ServiceGroupFormModalProps) {
    const [form, setForm] = useState<ServiceGroupFormData>(initial || DEFAULT_SG_FORM);

    // Services that have reported recently. A typo in a group makes every
    // policy targeting it match nothing, silently — so names outside this list
    // are flagged (still allowed: a service may simply be quiet this week).
    const [known, setKnown] = useState<string[] | null>(null);
    const [knownError, setKnownError] = useState<string | null>(null);
    const [knownToken, setKnownToken] = useState(0);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await getLabelValues("service", { window: suggestionWindow("labels") });
                if (cancelled) return;
                if (!res.success) {
                    setKnownError(res.error_message || "The request failed.");
                    return;
                }
                setKnownError(null);
                setKnown(res.data ?? []);
            } catch (err) {
                if (cancelled) return;
                reportError("service_group.services.load.failed", err, {
                    outcome: "service names are not checked against reporting services",
                });
                setKnownError("Failed to load services");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [knownToken]);

    const raw = useMemo(
        () => form.services.split(/[\n,]/).map((v) => v.trim()).filter(Boolean),
        [form.services],
    );
    const parsed = useMemo(() => parseServicesList(form.services), [form.services]);
    const duplicates = raw.length - parsed.length;
    const knownSet = useMemo(() => new Set(known ?? []), [known]);
    const addable = (known ?? []).filter((svc) => !parsed.includes(svc));

    const addService = (svc: string) => {
        if (!svc) return;
        setForm((prev) => ({ ...prev, services: [...parseServicesList(prev.services), svc].join("\n") }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(form);
    };

    return (
        <Modal open onClose={onClose} title={title} widthClass="max-w-md" dismissible={!submitting}>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="nf-name-2" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Name</label>
                        <input id="nf-name-2"
                            type="text"
                            value={form.name}
                            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                            required
                            className={INPUT_CLASS}
                            placeholder="e.g. Production Services"
                        />
                    </div>
                    <div>
                        <label htmlFor="nf-description-2" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Description</label>
                        <input id="nf-description-2"
                            type="text"
                            value={form.description}
                            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                            className={INPUT_CLASS}
                            placeholder="Optional description"
                        />
                    </div>
                    <div>
                        <label htmlFor="nf-services-2" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Services</label>
                        <textarea id="nf-services-2"
                            value={form.services}
                            onChange={(e) => setForm((prev) => ({ ...prev, services: e.target.value }))}
                            rows={4}
                            className={INPUT_CLASS}
                            placeholder={"One service per line, or comma-separated:\nkeyring-api\nlattice-api\nmonitor-core"}
                        />
                        <p className="text-xs text-zinc-400 mt-1">
                            One service per line, or comma-separated. Duplicates are removed on save.
                        </p>
                        {known && addable.length > 0 && (
                            <div className="mt-2">
                                <label htmlFor="nf-services-add" className="sr-only">Add a reporting service</label>
                                <select
                                    id="nf-services-add"
                                    value=""
                                    onChange={(e) => addService(e.target.value)}
                                    className={INPUT_CLASS}
                                >
                                    <option value="">Add a service that reported in the last 7 days…</option>
                                    {addable.map((svc) => (
                                        <option key={svc} value={svc}>
                                            {svc}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        {knownError && (
                            <div className="mt-2">
                                <FailureNote
                                    what="reporting services"
                                    message={knownError}
                                    onRetry={() => setKnownToken((t) => t + 1)}
                                />
                            </div>
                        )}
                        {parsed.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1" aria-label="Services in this group">
                                {parsed.map((svc) => {
                                    const unknown = known !== null && !knownSet.has(svc);
                                    return (
                                        <span
                                            key={svc}
                                            title={unknown ? "No events from this service in the last 7 days — check the spelling" : undefined}
                                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                                unknown
                                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                                    : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                                            }`}
                                        >
                                            {svc}
                                            {unknown && " · not seen in 7d"}
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                        {duplicates > 0 && (
                            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                                {duplicates} duplicate{duplicates === 1 ? "" : "s"} will be dropped.
                            </p>
                        )}
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
