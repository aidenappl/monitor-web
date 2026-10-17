"use client";

import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner } from "@fortawesome/free-solid-svg-icons";
import { Modal } from "@/components/ui/modal";
import { INPUT_CLASS } from "./notifications.helpers";

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
                        <p className="text-xs text-zinc-400 mt-1">One service per line, or comma-separated</p>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                        <button
                            type="submit"
                            disabled={submitting || !form.name.trim()}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors"
                        >
                            {submitting ? (
                                <FontAwesomeIcon icon={faSpinner} className="animate-spin" />
                            ) : (
                                "Save"
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </form>
        </Modal>
    );
}
