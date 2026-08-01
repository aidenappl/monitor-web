"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";

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

    // Branding — rendered on the login page.
    display_icon: string;
    icon_url: string;
    button_color: string;
    button_text_color: string;
    sort_order: string;

    // ── Read-only status, carried through so the form can report the outcome of
    // the last icon fetch. Not editable and never sent back.
    has_icon: boolean;
    icon_error: string;
}

// The icon slugs the frontend ships an asset for. Mirrors the server's
// allowlist in monitor-core's routes/HandleAdminSSOProviders.router.go.
//
// ⚠️ A SELECT, NOT A TEXT INPUT, and the server enforces the same list. This
// value reaches an unauthenticated login page that turns it into something it
// renders, so free text would let an administrator put a path, a URL or a data:
// URI there. Adding an option here means shipping the asset in the same change.
const BUNDLED_ICONS = [
    "google",
    "github",
    "microsoft",
    "forta",
    "okta",
    "gitlab",
    "apple",
] as const;

// #rrggbb, anchored. Matches the server's check exactly — the server validates on
// write AND again on render, and this is the third copy purely so an admin gets
// told before submitting rather than after.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

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
    display_icon: "",
    icon_url: "",
    button_color: "",
    button_text_color: "",
    sort_order: "0",
    has_icon: false,
    icon_error: "",
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
        display_icon: p.display_icon ?? "",
        icon_url: p.icon_url ?? "",
        button_color: p.button_color ?? "",
        button_text_color: p.button_text_color ?? "",
        sort_order: String(p.sort_order ?? 0),
        has_icon: p.has_icon ?? false,
        icon_error: p.icon_error ?? "",
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
        // ⚠️ jwks_url is deliberately NOT sent for oauth2.
        //
        // It used to be, and the form only ever renders that input for oidc — so
        // switching a provider from oidc to oauth2 silently carried a jwks_url the
        // administrator could no longer see or clear. It is meaningless here
        // regardless: oauth2 has no id_token, so there is nothing to verify against
        // a key set.
    }

    // Branding is always sent, including when cleared, so an administrator can
    // remove an icon or a colour. The server treats an absent field as "leave
    // alone" and an empty string as "clear", which is why these use `optional`
    // only for the values where empty genuinely means unset.
    payload.display_icon = optional(form.display_icon) ?? "";
    payload.icon_url = optional(form.icon_url) ?? "";
    payload.button_color = optional(form.button_color) ?? "";
    payload.button_text_color = optional(form.button_text_color) ?? "";

    const order = parseInt(form.sort_order, 10);
    payload.sort_order = Number.isFinite(order) ? order : 0;

    return payload;
}

/**
 * Classes for the two `<select>` elements on this page.
 *
 * The `Input` primitive covers text fields only, and a select is a different
 * element with its own native affordances — wrapping it just to share a class
 * string would be a component that exists to hold four utilities. These match
 * `Input`'s shell exactly so the two sit on the same grid line without looking
 * like they came from different pages.
 */
const selectClass =
    "h-9 w-full rounded-lg border border-border-strong bg-surface-elevated px-3 text-sm text-primary focus:border-border-emphasis focus:outline-none focus:ring-1 focus:ring-accent/40";
const labelClass =
    "block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5";

/**
 * TextField and Toggle are THIN WRAPPERS over the shared primitives, not
 * reimplementations of them.
 *
 * ⚠️ THE WRAPPER IS THE POINT. Both components previously carried their own
 * zinc classes and their own markup, which is what made this page look like a
 * different product from lattice-web's authentication page. Their CALL-SITE API
 * is kept exactly as it was — `onChange` takes a value rather than an event,
 * `Toggle` takes `label`/`hint` — so ~50 call sites below did not have to be
 * rewritten to change how the page looks. Converting the styling and rewriting
 * every call site in one change would have made the styling diff impossible to
 * review.
 */
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
    error,
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
    /** Validation message. Replaces the hint and marks the field invalid. */
    error?: string;
}) {
    return (
        <Input
            id={id}
            type={type}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            label={required ? `${label} *` : label}
            error={error}
            hint={hint}
        />
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
    // A real `role="switch"` rather than the styled checkbox this used to be:
    // a screen reader announces a setting as on/off, not checked/unchecked.
    // `labelledBy` points the switch at the visible text so the name is not
    // announced twice.
    const id = useId();
    return (
        <div className="flex items-start justify-between gap-6">
            <span className="min-w-0">
                <span id={id} className="block text-sm font-medium text-primary">
                    {label}
                </span>
                <span className="block text-xs text-muted mt-0.5 leading-relaxed">
                    {hint}
                </span>
            </span>
            <span className="shrink-0 pt-0.5">
                <Switch checked={checked} onChange={onChange} labelledBy={id} />
            </span>
        </div>
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
            <div className="relative w-full max-w-2xl rounded-2xl border border-border-strong bg-surface shadow-xl">
                <div className="flex items-center justify-between border-b border-border-strong px-5 py-4">
                    <h2 className="text-lg font-semibold text-primary">
                        {isCreate ? "Add SSO provider" : `Edit ${initial.display_name}`}
                    </h2>
                    <button
                        onClick={onClose}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-elevated transition-colors"
                        aria-label="Close"
                    >
                        <FontAwesomeIcon icon={faXmark} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
                    {error && (
                        <Alert variant="error">{error}</Alert>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <TextField
                            id="slug"
                            label="Slug"
                            value={form.slug}
                            onChange={(v) => set("slug", v)}
                            placeholder="google"
                            hint={isCreate ? "URL-safe id, cannot change later." : "Identifier (read-only)."}
                            required={isCreate}
                            disabled={!isCreate}
                        />
                        <TextField
                            id="display_name"
                            label="Display name"
                            value={form.display_name}
                            onChange={(v) => set("display_name", v)}
                            placeholder="Google"
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
                                className={selectClass}
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
                            placeholder="Continue with Google"
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

                    {/* ── Branding ─────────────────────────────────────────
                        What the login page shows. All optional: a provider with
                        none of this renders a plain text button, which is the
                        contractual fallback rather than a degraded state. */}
                    <div className="border-t border-border-strong pt-4 space-y-4">
                        <p className="text-sm font-medium text-primary">
                            Login page appearance
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="display_icon" className={labelClass}>
                                    Bundled icon
                                </label>
                                <select
                                    id="display_icon"
                                    value={form.display_icon}
                                    onChange={(e) => set("display_icon", e.target.value)}
                                    className={selectClass}
                                >
                                    <option value="">None (text button)</option>
                                    {BUNDLED_ICONS.map((slug) => (
                                        <option key={slug} value={slug}>
                                            {slug}
                                        </option>
                                    ))}
                                </select>
                                <p className="mt-1 text-xs text-muted">
                                    An icon this app ships. Overridden by a custom URL below.
                                </p>
                            </div>

                            <TextField
                                id="sort_order"
                                label="Sort order"
                                value={form.sort_order}
                                onChange={(v) => set("sort_order", v)}
                                placeholder="0"
                                hint="Lower appears first; ties break on slug."
                            />
                        </div>

                        <div>
                            <TextField
                                id="icon_url"
                                label="Custom icon URL"
                                value={form.icon_url}
                                onChange={(v) => set("icon_url", v)}
                                placeholder="https://cdn.example.com/logo.png"
                                hint="Fetched once and cached when you save. PNG, JPEG or GIF over https — SVG is not accepted."
                            />
                            {/* Surface the outcome of the last fetch.
                                A failed fetch does NOT block saving the provider — an
                                administrator fixing an issuer URL must not be stopped by a
                                logo that 404s — so without this the failure would be
                                invisible until someone noticed the login page had no icon. */}
                            {form.icon_error !== "" && (
                                <p className="mt-1 text-xs text-destructive">
                                    Last icon fetch failed: {form.icon_error}
                                </p>
                            )}
                            {form.has_icon && form.icon_error === "" && (
                                <p className="mt-1 text-xs text-healthy">
                                    Icon cached and served from this server.
                                </p>
                            )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <TextField
                                id="button_color"
                                label="Button colour"
                                value={form.button_color}
                                onChange={(v) => set("button_color", v)}
                                placeholder="#1a73e8"
                                hint="#rrggbb, or blank for the default."
                                error={
                                    form.button_color !== "" && !HEX_COLOR.test(form.button_color)
                                        ? "Must be #rrggbb"
                                        : undefined
                                }
                            />
                            <TextField
                                id="button_text_color"
                                label="Button text colour"
                                value={form.button_text_color}
                                onChange={(v) => set("button_text_color", v)}
                                placeholder="#ffffff"
                                hint="#rrggbb, or blank for the default."
                                error={
                                    form.button_text_color !== "" &&
                                    !HEX_COLOR.test(form.button_text_color)
                                        ? "Must be #rrggbb"
                                        : undefined
                                }
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 border-t border-border-strong pt-4">
                        <Button type="button" variant="secondary" size="lg" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" size="lg" loading={saving}>
                            {isCreate ? "Create provider" : "Save changes"}
                        </Button>
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
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold text-primary">
                            SSO Providers
                        </h1>
                        <p className="text-sm text-muted mt-1">
                            Configure the identity providers users can sign in and link
                            with.
                        </p>
                    </div>
                    <Button size="lg" onClick={() => setCreating(true)} className="gap-2">
                        <FontAwesomeIcon icon={faPlus} className="text-xs" />
                        Add provider
                    </Button>
                </div>

                {error && (
                    <Alert variant="error">{error}</Alert>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <FontAwesomeIcon
                            icon={faSpinner}
                            className="text-muted animate-spin text-lg"
                        />
                    </div>
                ) : providers.length === 0 ? (
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
                    <div className="space-y-3">
                        {providers.map((p) => (
                            <div
                                key={p.slug}
                                className="flex items-center justify-between gap-4 p-4 border border-border-strong rounded-xl hover:bg-surface-elevated/30 transition-colors"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-surface-elevated text-muted">
                                        <FontAwesomeIcon icon={faServer} />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="text-sm font-medium text-primary">
                                                {p.display_name}
                                            </p>
                                            <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full bg-surface-elevated text-muted uppercase tracking-wider">
                                                {p.kind}
                                            </span>
                                            <span
                                                className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${
                                                    p.enabled
                                                        ? "bg-[#22c55e]/10 text-healthy"
                                                        : "bg-surface-elevated text-muted"
                                                }`}
                                            >
                                                {p.enabled ? "Enabled" : "Disabled"}
                                            </span>
                                            {p.has_secret && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-[#3b82f6]/10 text-info">
                                                    <FontAwesomeIcon
                                                        icon={faKey}
                                                        className="text-[8px]"
                                                    />
                                                    Secret set
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted mt-0.5 truncate">
                                            {p.slug}
                                            {p.client_id ? ` · ${p.client_id}` : ""}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                    <button
                                        onClick={() => setEditing(p)}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-secondary hover:bg-surface-elevated rounded-lg transition-colors"
                                    >
                                        <FontAwesomeIcon icon={faPen} />
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => handleDelete(p.slug)}
                                        disabled={deleting === p.slug}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-[#ef4444]/10 rounded-lg disabled:opacity-50 transition-colors"
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
