"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSpinner,
    faPlus,
    faPen,
    faTrash,
    faKey,
    faServer,
    faXmark,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { useAuth } from "@/store/hooks";
import {
    reqListSSOProviders,
    reqCreateSSOProvider,
    reqUpdateSSOProvider,
    reqDeleteSSOProvider,
} from "@/services/admin.service";
import type {
    AdminSSOProvider,
    SSOProviderKind,
    SSOProviderPayload,
} from "@/types/auth.types";

// Local, fully-controlled form shape. Every field is a string/bool so inputs stay
// controlled; it is projected to a sparse SSOProviderPayload on submit.
interface ProviderForm {
    slug: string;
    display_name: string;
    kind: SSOProviderKind;
    issuer_url: string;
    authorize_url: string;
    token_url: string;
    userinfo_url: string;
    jwks_url: string;
    introspect_url: string;
    client_id: string;
    client_secret: string;
    scopes: string;
    email_claim: string;
    email_verified_claim: string;
    subject_claim: string;
    button_label: string;
    trust_email_verified: boolean;
    allow_auto_link: boolean;
    auto_provision: boolean;
    enabled: boolean;
}

const emptyForm: ProviderForm = {
    slug: "",
    display_name: "",
    kind: "oidc",
    issuer_url: "",
    authorize_url: "",
    token_url: "",
    userinfo_url: "",
    jwks_url: "",
    introspect_url: "",
    client_id: "",
    client_secret: "",
    scopes: "openid email profile",
    email_claim: "email",
    email_verified_claim: "email_verified",
    subject_claim: "sub",
    button_label: "",
    trust_email_verified: false,
    allow_auto_link: false,
    auto_provision: false,
    enabled: true,
};

function formFromProvider(p: AdminSSOProvider): ProviderForm {
    return {
        slug: p.slug,
        display_name: p.display_name,
        kind: p.kind,
        issuer_url: p.issuer_url ?? "",
        authorize_url: p.authorize_url ?? "",
        token_url: p.token_url ?? "",
        userinfo_url: p.userinfo_url ?? "",
        jwks_url: p.jwks_url ?? "",
        introspect_url: p.introspect_url ?? "",
        client_id: p.client_id ?? "",
        client_secret: "",
        scopes: p.scopes,
        email_claim: p.email_claim,
        email_verified_claim: p.email_verified_claim,
        subject_claim: p.subject_claim,
        button_label: p.button_label ?? "",
        trust_email_verified: p.trust_email_verified,
        allow_auto_link: p.allow_auto_link,
        auto_provision: p.auto_provision,
        enabled: p.enabled,
    };
}

// Build the write payload. Always send the scalar/boolean config; only include
// URL / id / secret fields when populated so an edit never blanks an unset value.
// client_secret is omitted when blank ("leave blank to keep") on edit.
function buildPayload(form: ProviderForm, isCreate: boolean): SSOProviderPayload {
    const trimmed = (v: string) => v.trim();
    const optional = (v: string): string | undefined =>
        trimmed(v) === "" ? undefined : trimmed(v);

    const payload: SSOProviderPayload = {
        display_name: trimmed(form.display_name),
        kind: form.kind,
        scopes: trimmed(form.scopes),
        email_claim: trimmed(form.email_claim),
        email_verified_claim: trimmed(form.email_verified_claim),
        subject_claim: trimmed(form.subject_claim),
        trust_email_verified: form.trust_email_verified,
        allow_auto_link: form.allow_auto_link,
        auto_provision: form.auto_provision,
        enabled: form.enabled,
        client_id: optional(form.client_id),
        button_label: optional(form.button_label),
        client_secret: optional(form.client_secret),
    };

    if (isCreate) payload.slug = trimmed(form.slug);

    if (form.kind === "oidc") {
        payload.issuer_url = optional(form.issuer_url);
        payload.jwks_url = optional(form.jwks_url);
    } else {
        payload.authorize_url = optional(form.authorize_url);
        payload.token_url = optional(form.token_url);
        payload.userinfo_url = optional(form.userinfo_url);
        payload.introspect_url = optional(form.introspect_url);
        payload.jwks_url = optional(form.jwks_url);
    }

    return payload;
}

const inputClass =
    "w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500";
const labelClass =
    "block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1";

function TextField({
    id,
    label,
    value,
    onChange,
    placeholder,
    hint,
    type = "text",
    required = false,
    disabled = false,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    hint?: string;
    type?: string;
    required?: boolean;
    disabled?: boolean;
}) {
    return (
        <div>
            <label htmlFor={id} className={labelClass}>
                {label}
                {required && <span className="text-red-500"> *</span>}
            </label>
            <input
                id={id}
                type={type}
                value={value}
                disabled={disabled}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                className={`${inputClass} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
            />
            {hint && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">{hint}</p>
            )}
        </div>
    );
}

function Toggle({
    label,
    hint,
    checked,
    onChange,
}: {
    label: string;
    hint: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
            />
            <span>
                <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {label}
                </span>
                <span className="block text-xs text-zinc-400 dark:text-zinc-500">
                    {hint}
                </span>
            </span>
        </label>
    );
}

function ProviderFormModal({
    initial,
    isCreate,
    onClose,
    onSaved,
}: {
    initial: ProviderForm;
    isCreate: boolean;
    hasSecret: boolean;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [form, setForm] = useState<ProviderForm>(initial);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const set = <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
        };
    }, [onClose]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (isCreate && form.slug.trim() === "") {
            setError("Slug is required.");
            return;
        }
        if (form.display_name.trim() === "") {
            setError("Display name is required.");
            return;
        }

        setSaving(true);
        const payload = buildPayload(form, isCreate);
        const res = isCreate
            ? await reqCreateSSOProvider(payload)
            : await reqUpdateSSOProvider(form.slug, payload);
        if (res.success) {
            onSaved();
        } else {
            setError(res.error_message || "Failed to save provider");
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8">
            <div
                className="absolute inset-0"
                onClick={onClose}
                aria-hidden="true"
            />
            <div className="relative w-full max-w-2xl rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl">
                <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 px-5 py-4">
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                        {isCreate ? "Add SSO provider" : `Edit ${initial.display_name}`}
                    </h2>
                    <button
                        onClick={onClose}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        aria-label="Close"
                    >
                        <FontAwesomeIcon icon={faXmark} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
                    {error && (
                        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                            <p className="text-sm text-red-600 dark:text-red-400">
                                {error}
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <TextField
                            id="slug"
                            label="Slug"
                            value={form.slug}
                            onChange={(v) => set("slug", v)}
                            placeholder="forta"
                            hint={isCreate ? "URL-safe id, cannot change later." : "Identifier (read-only)."}
                            required={isCreate}
                            disabled={!isCreate}
                        />
                        <TextField
                            id="display_name"
                            label="Display name"
                            value={form.display_name}
                            onChange={(v) => set("display_name", v)}
                            placeholder="Forta"
                            required
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="kind" className={labelClass}>
                                Kind
                            </label>
                            <select
                                id="kind"
                                value={form.kind}
                                onChange={(e) =>
                                    set("kind", e.target.value as SSOProviderKind)
                                }
                                className={inputClass}
                            >
                                <option value="oidc">OIDC (discovery via issuer)</option>
                                <option value="oauth2">OAuth2 (explicit URLs)</option>
                            </select>
                        </div>
                        <TextField
                            id="button_label"
                            label="Button label"
                            value={form.button_label}
                            onChange={(v) => set("button_label", v)}
                            placeholder="Continue with Forta"
                            hint="Defaults to the display name."
                        />
                    </div>

                    {form.kind === "oidc" ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <TextField
                                id="issuer_url"
                                label="Issuer URL"
                                value={form.issuer_url}
                                onChange={(v) => set("issuer_url", v)}
                                placeholder="https://accounts.example.com"
                                hint="Endpoints are discovered from here."
                            />
                            <TextField
                                id="jwks_url"
                                label="JWKS URL"
                                value={form.jwks_url}
                                onChange={(v) => set("jwks_url", v)}
                                placeholder="Optional override"
                            />
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <TextField
                                id="authorize_url"
                                label="Authorize URL"
                                value={form.authorize_url}
                                onChange={(v) => set("authorize_url", v)}
                                placeholder="https://id.example.com/oauth/authorize"
                            />
                            <TextField
                                id="token_url"
                                label="Token URL"
                                value={form.token_url}
                                onChange={(v) => set("token_url", v)}
                                placeholder="https://id.example.com/oauth/token"
                            />
                            <TextField
                                id="userinfo_url"
                                label="UserInfo URL"
                                value={form.userinfo_url}
                                onChange={(v) => set("userinfo_url", v)}
                                placeholder="https://id.example.com/oauth/userinfo"
                            />
                            <TextField
                                id="introspect_url"
                                label="Introspect URL"
                                value={form.introspect_url}
                                onChange={(v) => set("introspect_url", v)}
                                placeholder="Optional"
                            />
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <TextField
                            id="client_id"
                            label="Client ID"
                            value={form.client_id}
                            onChange={(v) => set("client_id", v)}
                        />
                        <TextField
                            id="client_secret"
                            label="Client secret"
                            type="password"
                            value={form.client_secret}
                            onChange={(v) => set("client_secret", v)}
                            placeholder={
                                !isCreate && initial.slug
                                    ? "Leave blank to keep"
                                    : ""
                            }
                            hint="Stored encrypted; never shown again."
                        />
                    </div>

                    <TextField
                        id="scopes"
                        label="Scopes"
                        value={form.scopes}
                        onChange={(v) => set("scopes", v)}
                        placeholder="openid email profile"
                        hint="Space-separated."
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <TextField
                            id="email_claim"
                            label="Email claim"
                            value={form.email_claim}
                            onChange={(v) => set("email_claim", v)}
                            placeholder="email"
                        />
                        <TextField
                            id="email_verified_claim"
                            label="Email-verified claim"
                            value={form.email_verified_claim}
                            onChange={(v) => set("email_verified_claim", v)}
                            placeholder="email_verified"
                        />
                        <TextField
                            id="subject_claim"
                            label="Subject claim"
                            value={form.subject_claim}
                            onChange={(v) => set("subject_claim", v)}
                            placeholder="sub"
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                        <Toggle
                            label="Trust email verified"
                            hint="Treat asserted emails as verified even without a claim."
                            checked={form.trust_email_verified}
                            onChange={(v) => set("trust_email_verified", v)}
                        />
                        <Toggle
                            label="Allow auto-link"
                            hint="Attach to an existing account with a matching email."
                            checked={form.allow_auto_link}
                            onChange={(v) => set("allow_auto_link", v)}
                        />
                        <Toggle
                            label="Auto-provision"
                            hint="Create a new account on first sign-in."
                            checked={form.auto_provision}
                            onChange={(v) => set("auto_provision", v)}
                        />
                        <Toggle
                            label="Enabled"
                            hint="Show this provider on the login page."
                            checked={form.enabled}
                            onChange={(v) => set("enabled", v)}
                        />
                    </div>

                    <div className="flex justify-end gap-2 border-t border-zinc-200 dark:border-zinc-700 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 border border-zinc-300 dark:border-zinc-600 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                            {saving && (
                                <FontAwesomeIcon
                                    icon={faSpinner}
                                    className="animate-spin text-xs"
                                />
                            )}
                            {isCreate ? "Create provider" : "Save changes"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function AdminSSOPage() {
    const { user, isLoading } = useAuth();
    const [providers, setProviders] = useState<AdminSSOProvider[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);

    const [editing, setEditing] = useState<AdminSSOProvider | null>(null);
    const [creating, setCreating] = useState(false);

    const isAdmin = user?.role === "admin";

    const fetchProviders = useCallback(async () => {
        const res = await reqListSSOProviders();
        if (res.success) {
            setProviders(res.data ?? []);
        } else {
            setError(res.error_message || "Failed to load providers");
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        if (isAdmin) fetchProviders();
        else if (!isLoading) setLoading(false);
    }, [isAdmin, isLoading, fetchProviders]);

    const handleDelete = async (slug: string) => {
        if (
            !window.confirm(
                `Delete SSO provider "${slug}"? Users linked through it will lose that sign-in method.`
            )
        )
            return;
        setDeleting(slug);
        setError(null);
        const res = await reqDeleteSSOProvider(slug);
        if (res.success) {
            setProviders((prev) => prev.filter((p) => p.slug !== slug));
        } else {
            setError(res.error_message || "Failed to delete provider");
        }
        setDeleting(null);
    };

    const onSaved = () => {
        setCreating(false);
        setEditing(null);
        setLoading(true);
        fetchProviders();
    };

    const editingForm = useMemo(
        () => (editing ? formFromProvider(editing) : emptyForm),
        [editing]
    );

    // Gate: wait for auth, then require admin.
    if (isLoading) {
        return (
            <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 flex justify-center">
                <FontAwesomeIcon
                    icon={faSpinner}
                    className="text-zinc-400 animate-spin text-lg"
                />
            </main>
        );
    }

    if (!isAdmin) {
        return (
            <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
                <div className="text-center py-12 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl">
                    <FontAwesomeIcon
                        icon={faServer}
                        className="text-3xl text-zinc-300 dark:text-zinc-600 mb-3"
                    />
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Admin only
                    </p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                        You need an administrator role to manage SSO providers.
                    </p>
                </div>
            </main>
        );
    }

    return (
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                            SSO Providers
                        </h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                            Configure the identity providers users can sign in and link
                            with.
                        </p>
                    </div>
                    <button
                        onClick={() => setCreating(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                    >
                        <FontAwesomeIcon icon={faPlus} className="text-xs" />
                        Add provider
                    </button>
                </div>

                {error && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <FontAwesomeIcon
                            icon={faSpinner}
                            className="text-zinc-400 animate-spin text-lg"
                        />
                    </div>
                ) : providers.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl">
                        <FontAwesomeIcon
                            icon={faServer}
                            className="text-3xl text-zinc-300 dark:text-zinc-600 mb-3"
                        />
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            No SSO providers configured
                        </p>
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                            Add one to let users sign in with an external identity provider.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {providers.map((p) => (
                            <div
                                key={p.slug}
                                className="flex items-center justify-between gap-4 p-4 border border-zinc-200 dark:border-zinc-700 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                                        <FontAwesomeIcon icon={faServer} />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                {p.display_name}
                                            </p>
                                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                                {p.kind}
                                            </span>
                                            <span
                                                className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${
                                                    p.enabled
                                                        ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                                                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                                                }`}
                                            >
                                                {p.enabled ? "Enabled" : "Disabled"}
                                            </span>
                                            {p.has_secret && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                                    <FontAwesomeIcon
                                                        icon={faKey}
                                                        className="text-[8px]"
                                                    />
                                                    Secret set
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
                                            {p.slug}
                                            {p.client_id ? ` · ${p.client_id}` : ""}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                    <button
                                        onClick={() => setEditing(p)}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                                    >
                                        <FontAwesomeIcon icon={faPen} />
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => handleDelete(p.slug)}
                                        disabled={deleting === p.slug}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-50 transition-colors"
                                    >
                                        <FontAwesomeIcon
                                            icon={deleting === p.slug ? faSpinner : faTrash}
                                            className={deleting === p.slug ? "animate-spin" : ""}
                                        />
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {creating && (
                <ProviderFormModal
                    initial={emptyForm}
                    isCreate
                    hasSecret={false}
                    onClose={() => setCreating(false)}
                    onSaved={onSaved}
                />
            )}
            {editing && (
                <ProviderFormModal
                    initial={editingForm}
                    isCreate={false}
                    hasSecret={editing.has_secret}
                    onClose={() => setEditing(null)}
                    onSaved={onSaved}
                />
            )}
        </main>
    );
}
