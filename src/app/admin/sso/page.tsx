"use client";

import { useConfirm } from "@/components/ConfirmProvider";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner, faPlus, faServer } from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "@/store/hooks";
import { reqListSSOProviders, reqDeleteSSOProvider } from "@/services/admin.service";
import type { AdminSSOProvider } from "@/types/auth.types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { FailureState } from "@/components/FailureState";
import { ProviderFormModal } from "@/components/admin/sso/ProviderFormModal";
import { ProviderRow, byLoginOrder } from "@/components/admin/sso/ProviderRow";
import { emptyForm, formFromProvider } from "@/components/admin/sso/providerForm";

// The API origin the login page renders against — its cached icons and the SSO
// callback live there, not on this app's origin.
const API_BASE = (process.env.NEXT_PUBLIC_MONITOR_API_URL || "").replace(/\/+$/, "");

export default function AdminSSOPage() {
    const { user, isLoading } = useAuth();
    const [providers, setProviders] = useState<AdminSSOProvider[]>([]);
    // providersLoaded, not `loading`, is the state — `loading` is DERIVED below.
    // Storing it meant the effect had to write it synchronously for the
    // not-an-admin case (`else if (!isLoading) setLoading(false)`), which is a
    // cascading render (react-hooks/set-state-in-effect) and a second copy of a
    // fact auth already knows.
    const [providersLoaded, setProvidersLoaded] = useState(false);
    // Two errors, because they are two different facts. `loadError` means the
    // LIST could not be read — it replaces the list, so a failed read can never
    // render as "no providers configured" and invite a duplicate. `actionError`
    // is a delete that was refused; the list under it is still true.
    const [loadError, setLoadError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const confirm = useConfirm();

    const [editing, setEditing] = useState<AdminSSOProvider | null>(null);
    const [creating, setCreating] = useState(false);

    const isAdmin = user?.role === "admin";

    // Spin while auth is still resolving, or while an admin's first fetch is in
    // flight. A non-admin never fetches, so once auth settles they fall straight
    // through to the refusal state — which is exactly what the deleted else-branch
    // was doing, minus the write.
    const loading = isLoading || (isAdmin && !providersLoaded);

    const fetchProviders = useCallback(async () => {
        const res = await reqListSSOProviders();
        if (res.success) {
            setProviders(res.data ?? []);
            setLoadError(null);
        } else {
            setLoadError(res.error_message || "Failed to load providers");
        }
        setProvidersLoaded(true);
    }, []);

    useEffect(() => {
        // FALSE POSITIVE, same shape as admin/registry: every setState in
        // fetchProviders runs AFTER `await reqListSSOProviders()`, and the rule
        // cannot see through the call into the async body.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (isAdmin) fetchProviders();
    }, [isAdmin, fetchProviders]);

    const handleDelete = async (slug: string) => {
        // Type-to-confirm: deleting the provider people sign in with can lock
        // every SSO-only account out, including the admin doing it.
        const ok = await confirm({
            title: `Delete SSO provider “${slug}”?`,
            description: "Accounts linked through it lose that sign-in method. Anyone without a password or another linked provider cannot sign in afterwards.",
            confirmLabel: "Delete provider",
            destructive: true,
            typeToConfirm: slug,
        });
        if (!ok) return;
        setDeleting(slug);
        setActionError(null);
        const res = await reqDeleteSSOProvider(slug);
        if (res.success) {
            setProviders((prev) => prev.filter((p) => p.slug !== slug));
        } else {
            setActionError(res.error_message || "Failed to delete provider");
        }
        setDeleting(null);
    };

    const retry = () => {
        setProvidersLoaded(false);
        fetchProviders();
    };

    const onSaved = () => {
        setCreating(false);
        setEditing(null);
        setProvidersLoaded(false);
        fetchProviders();
    };

    const editingForm = useMemo(
        () => (editing ? formFromProvider(editing) : emptyForm),
        [editing]
    );
    // Listed in the order the login page shows them, so this page answers
    // "which button comes first" without a trip to the login page.
    const sorted = useMemo(() => [...providers].sort(byLoginOrder), [providers]);

    // Gate: wait for auth, then require admin.
    if (isLoading) {
        return (
            <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 flex justify-center">
                <FontAwesomeIcon
                    icon={faSpinner}
                    className="text-muted animate-spin text-lg"
                />
            </main>
        );
    }

    if (!isAdmin) {
        return (
            <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
                <div className="text-center py-12 border border-dashed border-border-strong rounded-xl">
                    <FontAwesomeIcon
                        icon={faServer}
                        className="text-3xl text-dimmed mb-3"
                    />
                    <p className="text-sm font-medium text-secondary">
                        Admin only
                    </p>
                    <p className="text-xs text-muted mt-1">
                        You need an administrator role to manage SSO providers.
                    </p>
                </div>
            </main>
        );
    }

    return (
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <div className="space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                        <h1 className="text-2xl font-semibold text-primary">
                            SSO Providers
                        </h1>
                        <p className="text-sm text-muted mt-1">
                            Configure the identity providers users can sign in and link
                            with. Listed in login-page order.
                        </p>
                    </div>
                    <Button
                        size="lg"
                        onClick={() => setCreating(true)}
                        // Creating over a failed read would be creating blind —
                        // the provider may already exist.
                        disabled={loading || loadError !== null}
                        className="gap-2 whitespace-nowrap w-full sm:w-auto"
                    >
                        <FontAwesomeIcon icon={faPlus} className="text-xs" />
                        Add provider
                    </Button>
                </div>

                {actionError && (
                    <Alert variant="error" onDismiss={() => setActionError(null)}>
                        {actionError}
                    </Alert>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-16" role="status" aria-label="Loading providers">
                        <FontAwesomeIcon
                            icon={faSpinner}
                            className="text-muted animate-spin text-lg"
                        />
                    </div>
                ) : loadError !== null ? (
                    <FailureState what="SSO providers" message={loadError} onRetry={retry} />
                ) : sorted.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-border-strong rounded-xl">
                        <FontAwesomeIcon
                            icon={faServer}
                            className="text-3xl text-dimmed mb-3"
                        />
                        <p className="text-sm text-muted">
                            No SSO providers configured
                        </p>
                        <p className="text-xs text-muted mt-1">
                            Add one to let users sign in with an external identity provider.
                        </p>
                    </div>
                ) : (
                    <ul className="space-y-3" aria-label="SSO providers">
                        {sorted.map((p) => (
                            <ProviderRow
                                key={p.slug}
                                provider={p}
                                apiURL={API_BASE}
                                deleting={deleting === p.slug}
                                onEdit={() => setEditing(p)}
                                onDelete={() => handleDelete(p.slug)}
                            />
                        ))}
                    </ul>
                )}
            </div>

            {creating && (
                <ProviderFormModal
                    initial={emptyForm}
                    isCreate
                    hasSecret={false}
                    providers={providers}
                    apiURL={API_BASE}
                    onClose={() => setCreating(false)}
                    onSaved={onSaved}
                />
            )}
            {editing && (
                <ProviderFormModal
                    initial={editingForm}
                    isCreate={false}
                    hasSecret={editing.has_secret}
                    providers={providers}
                    apiURL={API_BASE}
                    onClose={() => setEditing(null)}
                    onSaved={onSaved}
                />
            )}
        </main>
    );
}
