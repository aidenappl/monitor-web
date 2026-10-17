"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCopy, faKey } from "@fortawesome/free-solid-svg-icons";
import { reqCreateSSOProvider, reqUpdateSSOProvider } from "@/services/admin.service";
import type { AdminSSOProvider, SSOProviderKind } from "@/types/auth.types";
import { useConfirm } from "@/components/ConfirmProvider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { copyText } from "@/tools/clipboard.tools";
import { cn } from "@/lib/utils";
import { LoginButtonPreview } from "./LoginButtonPreview";
import {
    BUNDLED_ICONS,
    FIELD_ORDER,
    HEX_COLOR,
    PROVIDER_PRESETS,
    applyPreset,
    buildPayload,
    callbackURL,
    contrastRatio,
    fieldFromServerError,
    validateForm,
    withKind,
    type FieldKey,
    type ProviderForm,
} from "./providerForm";

const FORM_ID = "sso-provider-form";
// Field ids are prefixed: the dialog renders over a page, and a bare id="slug"
// is one collision away from a label bound to the wrong input.
const fieldId = (key: FieldKey) => `sso-${key}`;

/**
 * Classes for the `<select>` elements in this form.
 *
 * The `Input` primitive covers text fields only, and a select is a different
 * element with its own native affordances — wrapping it just to share a class
 * string would be a component that exists to hold four utilities. These match
 * `Input`'s shell exactly so the two sit on the same grid line without looking
 * like they came from different pages.
 */
const selectClass =
    "h-9 w-full rounded-lg border border-border-strong bg-surface-elevated px-3 text-base sm:text-sm text-primary focus:border-border-emphasis focus:outline-none focus:ring-1 focus:ring-accent/40";
const labelClass = "block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5";

/**
 * TextField and Toggle are THIN WRAPPERS over the shared primitives, not
 * reimplementations of them: the call-site API (`onChange` takes a value,
 * `Toggle` takes `label`/`hint`) keeps ~40 call sites below short.
 */
function TextField({
    field,
    label,
    value,
    onChange,
    error,
    required = false,
    inputRef,
    ...rest
}: {
    field: FieldKey;
    label: string;
    value: string;
    onChange: (v: string) => void;
    error?: string;
    hint?: string;
    required?: boolean;
    inputRef?: React.Ref<HTMLInputElement>;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "required">) {
    return (
        <Input
            ref={inputRef}
            id={fieldId(field)}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            label={required ? `${label} *` : label}
            error={error}
            {...rest}
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
    hint: React.ReactNode;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    // A real `role="switch"`: a screen reader announces a setting as on/off, not
    // checked/unchecked. `labelledBy` points it at the visible text.
    const id = useId();
    return (
        <div className="flex items-start justify-between gap-6">
            <span className="min-w-0">
                <span id={id} className="block text-sm font-medium text-primary">
                    {label}
                </span>
                <span className="block text-xs text-muted mt-0.5 leading-relaxed">{hint}</span>
            </span>
            <span className="shrink-0 pt-0.5">
                <Switch checked={checked} onChange={onChange} labelledBy={id} />
            </span>
        </div>
    );
}

/** A #rrggbb text field with the browser's native picker beside it. */
function ColorField({
    field,
    label,
    value,
    onChange,
    error,
    placeholder,
}: {
    field: FieldKey;
    label: string;
    value: string;
    onChange: (v: string) => void;
    error?: string;
    placeholder: string;
}) {
    return (
        <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
                <TextField
                    field={field}
                    label={label}
                    value={value}
                    onChange={onChange}
                    placeholder={placeholder}
                    hint="#rrggbb, or blank for the default."
                    error={error}
                    spellCheck={false}
                    autoComplete="off"
                />
            </div>
            <input
                type="color"
                // The picker cannot represent "unset", so it shows the placeholder
                // until a real value exists; picking writes a real value.
                value={HEX_COLOR.test(value) ? value.toLowerCase() : placeholder}
                onChange={(e) => onChange(e.target.value)}
                aria-label={`Pick ${label.toLowerCase()}`}
                title={`Pick ${label.toLowerCase()}`}
                className="mt-[1.4rem] h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-border-strong bg-surface-elevated p-1"
            />
        </div>
    );
}

export function ProviderFormModal({
    initial,
    isCreate,
    hasSecret,
    providers,
    apiURL,
    onClose,
    onSaved,
}: {
    initial: ProviderForm;
    isCreate: boolean;
    /** Whether the stored row has a client secret. Never the secret itself. */
    hasSecret: boolean;
    /** Every stored provider, for the login preview's neighbours. */
    providers: AdminSSOProvider[];
    apiURL: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const confirm = useConfirm();
    const [form, setForm] = useState<ProviderForm>(initial);
    const [saving, setSaving] = useState(false);
    // Errors show for a field once it has been edited, and for every field once
    // a submit was attempted — not on open, where a blank form is not a mistake.
    const [touched, setTouched] = useState<Partial<Record<FieldKey, true>>>({});
    const [submitted, setSubmitted] = useState(false);
    // The server's refusal, pinned to the field it names when it names one.
    // Cleared by editing that field (or any field, for an unpinned one), so the
    // message never outlives the value it was about.
    const [serverError, setServerError] = useState<{ field?: FieldKey; message: string } | null>(
        null,
    );
    const [replacingSecret, setReplacingSecret] = useState(!hasSecret);
    const firstFieldRef = useRef<HTMLInputElement>(null);

    const errors = useMemo(() => validateForm(form, isCreate), [form, isCreate]);
    const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

    const errorFor = (key: FieldKey): string | undefined => {
        if (serverError?.field === key) return serverError.message;
        return submitted || touched[key] ? errors[key] : undefined;
    };

    const set = <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) => {
        setForm((prev) => ({ ...prev, [key]: value }));
        setTouched((prev) => ({ ...prev, [key]: true }));
        setServerError((prev) => (prev && (!prev.field || prev.field === key) ? null : prev));
    };

    const setKind = (kind: SSOProviderKind) => {
        setForm((prev) => withKind(prev, kind));
        setServerError(null);
    };

    // Escape, the backdrop and Cancel all come through here. A twenty-field form
    // must not be thrown away by a stray click outside it.
    const requestClose = async () => {
        if (saving) return;
        if (dirty) {
            const ok = await confirm({
                title: "Discard changes?",
                description: isCreate
                    ? "This provider has not been created. Everything typed into the form is lost."
                    : `Your edits to ${initial.display_name} have not been saved and will be lost.`,
                confirmLabel: "Discard changes",
                destructive: true,
            });
            if (!ok) return;
        }
        onClose();
    };

    const focusField = (key: FieldKey) => {
        const el = document.getElementById(fieldId(key));
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        el?.focus({ preventScroll: true });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitted(true);
        setServerError(null);
        const first = FIELD_ORDER.find((k) => errors[k]);
        if (first) {
            focusField(first);
            return;
        }

        setSaving(true);
        const payload = buildPayload(form, isCreate);
        const res = isCreate
            ? await reqCreateSSOProvider(payload)
            : await reqUpdateSSOProvider(form.slug, payload);
        if (res.success) {
            onSaved();
            return;
        }
        const mapped = fieldFromServerError(res.error_message || "Failed to save provider");
        setServerError(mapped);
        setSaving(false);
        if (mapped.field) focusField(mapped.field);
    };

    // ⚠️ Enter on a <select> must not submit. Browsers treat Enter inside a form
    // as "press the default button", and on a native select that fires on the
    // same keystroke that commits the choice — so picking a Kind with the
    // keyboard created the provider. Text inputs keep implicit submission.
    const onFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
        if (e.key === "Enter" && e.target instanceof HTMLSelectElement) e.preventDefault();
    };

    const redirectURI = callbackURL(apiURL);
    const ratio = contrastRatio(form.button_color, form.button_text_color);
    const activePreset = PROVIDER_PRESETS.find((p) => p.fields.slug === form.slug.trim());

    return (
        <Modal
            open
            onClose={requestClose}
            dismissible={!saving}
            widthClass="max-w-3xl"
            initialFocusRef={firstFieldRef}
            title={isCreate ? "Add SSO provider" : `Edit ${initial.display_name}`}
            footer={
                <>
                    <Button type="button" variant="secondary" size="lg" onClick={requestClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button type="submit" form={FORM_ID} size="lg" loading={saving}>
                        {isCreate ? "Create provider" : "Save changes"}
                    </Button>
                </>
            }
        >
            <form
                id={FORM_ID}
                onSubmit={handleSubmit}
                onKeyDown={onFormKeyDown}
                noValidate
                className="space-y-4"
            >
                {serverError && !serverError.field && <Alert variant="error">{serverError.message}</Alert>}
                {submitted && Object.keys(errors).length > 0 && (
                    <p role="alert" className="text-xs text-destructive">
                        Fix the {Object.keys(errors).length === 1 ? "highlighted field" : `${Object.keys(errors).length} highlighted fields`} to {isCreate ? "create" : "save"} this provider.
                    </p>
                )}

                {isCreate && (
                    <fieldset className="space-y-2">
                        <legend className={labelClass}>Start from a preset</legend>
                        <div className="flex flex-wrap gap-2">
                            {PROVIDER_PRESETS.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    aria-pressed={activePreset?.id === p.id}
                                    onClick={() => {
                                        setForm((prev) => applyPreset(prev, p));
                                        // Marked touched so a preset's {placeholder}
                                        // is flagged now, not after a failed submit.
                                        setTouched((prev) => ({
                                            ...prev,
                                            ...Object.fromEntries(Object.keys(p.fields).map((k) => [k, true])),
                                        }));
                                        setServerError(null);
                                    }}
                                    className={cn(
                                        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                                        activePreset?.id === p.id
                                            ? "border-accent bg-accent/10 text-accent"
                                            : "border-border-strong text-secondary hover:bg-surface-elevated",
                                    )}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-muted">
                            {activePreset?.note ??
                                "Fills in the endpoints, scopes, claims and branding — only the client ID and secret are left."}
                        </p>
                    </fieldset>
                )}

                <div className="rounded-lg border border-border bg-surface-elevated/50 px-3 py-2.5">
                    <p className={labelClass}>Redirect URI — register this with the provider</p>
                    <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 break-all text-xs text-primary">{redirectURI}</code>
                        <button
                            type="button"
                            onClick={() => copyText(redirectURI, { label: "Redirect URI" })}
                            aria-label="Copy redirect URI"
                            title="Copy redirect URI"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-elevated hover:text-primary transition-colors"
                        >
                            <FontAwesomeIcon icon={faCopy} />
                        </button>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                        Every provider uses the same callback; it must match exactly.
                    </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <TextField
                        field="slug"
                        label="Slug"
                        inputRef={isCreate ? firstFieldRef : undefined}
                        value={form.slug}
                        onChange={(v) => set("slug", v)}
                        placeholder="google"
                        hint={isCreate ? "Lowercase, URL-safe; cannot change later." : "Identifier (read-only)."}
                        required={isCreate}
                        disabled={!isCreate}
                        error={errorFor("slug")}
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <TextField
                        field="display_name"
                        label="Display name"
                        inputRef={isCreate ? undefined : firstFieldRef}
                        value={form.display_name}
                        onChange={(v) => set("display_name", v)}
                        placeholder="Google"
                        required
                        error={errorFor("display_name")}
                    />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor={fieldId("kind")} className={labelClass}>
                            Kind
                        </label>
                        <select
                            id={fieldId("kind")}
                            value={form.kind}
                            onChange={(e) => setKind(e.target.value as SSOProviderKind)}
                            className={selectClass}
                        >
                            <option value="oidc">OIDC (discovery via issuer)</option>
                            <option value="oauth2">OAuth2 (explicit URLs)</option>
                        </select>
                    </div>
                    <TextField
                        field="button_label"
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
                            field="issuer_url"
                            label="Issuer URL"
                            type="url"
                            required
                            value={form.issuer_url}
                            onChange={(v) => set("issuer_url", v)}
                            placeholder="https://accounts.example.com"
                            hint="Endpoints are discovered from here."
                            error={errorFor("issuer_url")}
                        />
                        <TextField
                            field="jwks_url"
                            label="JWKS URL"
                            type="url"
                            value={form.jwks_url}
                            onChange={(v) => set("jwks_url", v)}
                            placeholder="Optional override"
                            error={errorFor("jwks_url")}
                        />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <TextField
                            field="authorize_url"
                            label="Authorize URL"
                            type="url"
                            required
                            value={form.authorize_url}
                            onChange={(v) => set("authorize_url", v)}
                            placeholder="https://id.example.com/oauth/authorize"
                            error={errorFor("authorize_url")}
                        />
                        <TextField
                            field="token_url"
                            label="Token URL"
                            type="url"
                            required
                            value={form.token_url}
                            onChange={(v) => set("token_url", v)}
                            placeholder="https://id.example.com/oauth/token"
                            error={errorFor("token_url")}
                        />
                        <div className="sm:col-span-2">
                            <TextField
                                field="userinfo_url"
                                label="UserInfo URL"
                                type="url"
                                required
                                value={form.userinfo_url}
                                onChange={(v) => set("userinfo_url", v)}
                                placeholder="https://id.example.com/oauth/userinfo"
                                hint="OAuth2 has no ID token — the identity is read from here."
                                error={errorFor("userinfo_url")}
                            />
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <TextField
                        field="client_id"
                        label="Client ID"
                        value={form.client_id}
                        onChange={(v) => set("client_id", v)}
                        autoComplete="off"
                        spellCheck={false}
                    />
                    {replacingSecret ? (
                        <div>
                            <TextField
                                field="client_secret"
                                label="Client secret"
                                type="password"
                                value={form.client_secret}
                                onChange={(v) => set("client_secret", v)}
                                autoComplete="new-password"
                                hint={
                                    hasSecret
                                        ? "Replaces the stored secret on save. Stored encrypted; never shown again."
                                        : isCreate
                                          ? "Stored encrypted; never shown again."
                                          : "No secret is stored for this provider. Stored encrypted; never shown again."
                                }
                            />
                            {hasSecret && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        set("client_secret", "");
                                        setReplacingSecret(false);
                                    }}
                                    className="mt-1 text-xs text-secondary underline underline-offset-2 hover:text-primary"
                                >
                                    Keep the stored secret
                                </button>
                            )}
                        </div>
                    ) : (
                        <div>
                            <p className={labelClass}>Client secret</p>
                            <div className="flex h-9 items-center justify-between gap-2 rounded-lg border border-border-strong bg-surface-elevated px-3">
                                <span className="inline-flex items-center gap-1.5 text-sm text-healthy">
                                    <FontAwesomeIcon icon={faKey} className="text-xs" />
                                    Secret stored
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setReplacingSecret(true);
                                        // After the input renders.
                                        requestAnimationFrame(() => focusField("client_secret"));
                                    }}
                                    className="text-xs font-medium text-accent hover:underline"
                                >
                                    Replace
                                </button>
                            </div>
                            <p className="mt-1.5 text-xs text-muted">Kept unless you replace it.</p>
                        </div>
                    )}
                </div>

                <TextField
                    field="scopes"
                    label="Scopes"
                    required
                    value={form.scopes}
                    onChange={(v) => set("scopes", v)}
                    placeholder={form.kind === "oidc" ? "openid email profile" : "read:user user:email"}
                    hint="Space-separated."
                    error={errorFor("scopes")}
                    spellCheck={false}
                />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <TextField
                        field="email_claim"
                        label="Email claim"
                        required
                        value={form.email_claim}
                        onChange={(v) => set("email_claim", v)}
                        placeholder="email"
                        error={errorFor("email_claim")}
                        spellCheck={false}
                    />
                    <TextField
                        field="email_verified_claim"
                        label="Email-verified claim"
                        value={form.email_verified_claim}
                        onChange={(v) => set("email_verified_claim", v)}
                        placeholder={form.kind === "oidc" ? "email_verified" : "None"}
                        hint={form.kind === "oauth2" ? "Blank: emails count as unverified." : undefined}
                        spellCheck={false}
                    />
                    <TextField
                        field="subject_claim"
                        label="Subject claim"
                        required
                        value={form.subject_claim}
                        onChange={(v) => set("subject_claim", v)}
                        placeholder={form.kind === "oidc" ? "sub" : "id"}
                        error={errorFor("subject_claim")}
                        spellCheck={false}
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
                        hint="Attach to an existing account whose verified email matches."
                        checked={form.allow_auto_link}
                        onChange={(v) => set("allow_auto_link", v)}
                    />
                    <Toggle
                        label="Auto-provision"
                        hint={
                            <>
                                Create an account on first sign-in. It starts as{" "}
                                <strong className="font-medium text-secondary">Pending</strong> with no
                                access until an admin approves it in{" "}
                                <Link href="/admin/users" className="text-accent hover:underline">
                                    Users
                                </Link>
                                .
                            </>
                        }
                        checked={form.auto_provision}
                        onChange={(v) => set("auto_provision", v)}
                    />
                    <Toggle
                        label="Enabled"
                        hint="Show this provider on the public login page."
                        checked={form.enabled}
                        onChange={(v) => set("enabled", v)}
                    />
                </div>

                {/* ⚠️ The account-takeover combination. Auto-link only links onto
                    an account when the IdP's email counts as verified; "trust email
                    verified" makes EVERY asserted email count, so anyone who can
                    put an arbitrary address on an account at this IdP signs in as
                    the Monitor user who owns it. */}
                {form.allow_auto_link && form.trust_email_verified && (
                    <Alert variant="warning">
                        Auto-link with “Trust email verified” lets anyone who can set an
                        unverified email at this provider sign in as the Monitor account with
                        that email — including an admin. Turn one of them off unless this
                        provider only ever asserts addresses it has verified.
                    </Alert>
                )}

                {/* ── Branding ─────────────────────────────────────────
                    What the login page shows. All optional: a provider with
                    none of this renders a plain text button, which is the
                    contractual fallback rather than a degraded state. */}
                <div className="border-t border-border-strong pt-4">
                    <p className="text-sm font-medium text-primary mb-4">Login page appearance</p>

                    <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
                        <div className="space-y-4 min-w-0">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor={fieldId("display_icon")} className={labelClass}>
                                        Bundled icon
                                    </label>
                                    <select
                                        id={fieldId("display_icon")}
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
                                    <p className="mt-1.5 text-xs text-muted">
                                        Overridden by a custom URL below.
                                    </p>
                                </div>

                                <TextField
                                    field="sort_order"
                                    label="Sort order"
                                    type="number"
                                    step={1}
                                    inputMode="numeric"
                                    value={form.sort_order}
                                    onChange={(v) => set("sort_order", v)}
                                    placeholder="0"
                                    hint="Lower appears first; ties break on slug."
                                    error={errorFor("sort_order")}
                                />
                            </div>

                            <div>
                                <TextField
                                    field="icon_url"
                                    label="Custom icon URL"
                                    type="url"
                                    value={form.icon_url}
                                    onChange={(v) => set("icon_url", v)}
                                    placeholder="https://cdn.example.com/logo.png"
                                    hint="Fetched once and cached when you save. PNG, JPEG or GIF over https — SVG is not accepted."
                                    error={errorFor("icon_url")}
                                />
                                {/* Surface the outcome of the last fetch. A failed fetch
                                    does NOT block saving — an administrator fixing an
                                    issuer URL must not be stopped by a logo that 404s —
                                    so without this it would be invisible until someone
                                    noticed the login page had no icon. */}
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
                                <ColorField
                                    field="button_color"
                                    label="Button colour"
                                    value={form.button_color}
                                    onChange={(v) => set("button_color", v)}
                                    placeholder="#1a73e8"
                                    error={errorFor("button_color")}
                                />
                                <ColorField
                                    field="button_text_color"
                                    label="Button text colour"
                                    value={form.button_text_color}
                                    onChange={(v) => set("button_text_color", v)}
                                    placeholder="#ffffff"
                                    error={errorFor("button_text_color")}
                                />
                            </div>
                            {ratio !== null && (
                                <p
                                    className={cn(
                                        "text-xs",
                                        ratio >= 4.5 ? "text-healthy" : "text-pending",
                                    )}
                                >
                                    Contrast {ratio.toFixed(1)}:1 —{" "}
                                    {ratio >= 4.5
                                        ? "passes WCAG AA for text."
                                        : "below the 4.5:1 WCAG AA minimum; the label may be hard to read."}
                                </p>
                            )}
                        </div>

                        <div className="md:sticky md:top-0 md:self-start">
                            <LoginButtonPreview
                                form={form}
                                initial={initial}
                                others={providers}
                                apiURL={apiURL}
                            />
                        </div>
                    </div>
                </div>
            </form>
        </Modal>
    );
}
