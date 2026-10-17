import type {
    AdminSSOProvider,
    SSOProviderKind,
    SSOProviderPayload,
} from "@/types/auth.types";

/**
 * The SSO provider form's model: shape, defaults, presets, validation and the
 * projection to a write payload. Pure — no React — so the modal, the preview and
 * the list page all read the same rules.
 */

// Local, fully-controlled form shape. Every field is a string/bool so inputs stay
// controlled; it is projected to a sparse SSOProviderPayload on submit.
export interface ProviderForm {
    slug: string;
    display_name: string;
    kind: SSOProviderKind;
    issuer_url: string;
    authorize_url: string;
    token_url: string;
    userinfo_url: string;
    jwks_url: string;
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
export const BUNDLED_ICONS = [
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
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// The slug is a URL path segment (/auth/sso/{slug}/login) and is immutable once
// created, so it is held to the same lowercase-and-hyphens shape as every other
// slug in Monitor.
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const OIDC_DEFAULT_SCOPES = "openid email profile";
const OIDC_DEFAULT_VERIFIED_CLAIM = "email_verified";

export const emptyForm: ProviderForm = {
    slug: "",
    display_name: "",
    kind: "oidc",
    issuer_url: "",
    authorize_url: "",
    token_url: "",
    userinfo_url: "",
    jwks_url: "",
    client_id: "",
    client_secret: "",
    scopes: OIDC_DEFAULT_SCOPES,
    email_claim: "email",
    email_verified_claim: OIDC_DEFAULT_VERIFIED_CLAIM,
    subject_claim: "sub",
    button_label: "",
    trust_email_verified: false,
    allow_auto_link: false,
    auto_provision: false,
    // ⚠️ OFF for a new provider. An enabled provider appears on the PUBLIC login
    // page the moment it is created, and a half-configured one there is a broken
    // button every visitor can press. The administrator turns it on deliberately,
    // once the preview looks right.
    enabled: false,
    display_icon: "",
    icon_url: "",
    button_color: "",
    button_text_color: "",
    sort_order: "0",
    has_icon: false,
    icon_error: "",
};

export function formFromProvider(p: AdminSSOProvider): ProviderForm {
    return {
        slug: p.slug,
        display_name: p.display_name,
        kind: p.kind,
        issuer_url: p.issuer_url ?? "",
        authorize_url: p.authorize_url ?? "",
        token_url: p.token_url ?? "",
        userinfo_url: p.userinfo_url ?? "",
        jwks_url: p.jwks_url ?? "",
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

/**
 * Switching kind swaps the protocol defaults — but only the ones still AT the
 * other kind's default. A value the administrator typed is theirs; a default
 * left over from the kind they just left is not, and "openid" on an OAuth2
 * provider is a scope the IdP will reject or ignore.
 */
export function withKind(form: ProviderForm, kind: SSOProviderKind): ProviderForm {
    const next = { ...form, kind };
    if (kind === "oauth2") {
        if (form.scopes.trim() === OIDC_DEFAULT_SCOPES) next.scopes = "";
        if (form.email_verified_claim === OIDC_DEFAULT_VERIFIED_CLAIM) next.email_verified_claim = "";
    } else {
        if (form.scopes.trim() === "") next.scopes = OIDC_DEFAULT_SCOPES;
        if (form.email_verified_claim === "") next.email_verified_claim = OIDC_DEFAULT_VERIFIED_CLAIM;
    }
    return next;
}

// ── Presets ──────────────────────────────────────────────────────────────

export interface ProviderPreset {
    id: string;
    label: string;
    /** Fields the preset fills. Client id/secret are never part of one. */
    fields: Partial<ProviderForm>;
    /** One line on what is still left to do in the IdP's console. */
    note?: string;
}

/**
 * Known identity providers, prefilled so only the client id and secret are left.
 *
 * Placeholders in `{braces}` are deliberate — they cannot be guessed (an Okta org,
 * an Entra tenant) and validation refuses to save them, so a preset can never be
 * half-applied silently.
 *
 * Apple is deliberately absent: Sign in with Apple needs a JWT client secret
 * re-signed every six months and `response_mode=form_post`, neither of which
 * monitor-core's generic OIDC client does.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
    {
        id: "google",
        label: "Google",
        fields: {
            slug: "google",
            display_name: "Google",
            kind: "oidc",
            issuer_url: "https://accounts.google.com",
            scopes: OIDC_DEFAULT_SCOPES,
            email_claim: "email",
            email_verified_claim: "email_verified",
            subject_claim: "sub",
            button_label: "Continue with Google",
            display_icon: "google",
            button_color: "#ffffff",
            button_text_color: "#1f1f1f",
        },
    },
    {
        id: "github",
        label: "GitHub",
        fields: {
            slug: "github",
            display_name: "GitHub",
            kind: "oauth2",
            authorize_url: "https://github.com/login/oauth/authorize",
            token_url: "https://github.com/login/oauth/access_token",
            userinfo_url: "https://api.github.com/user",
            scopes: "read:user user:email",
            email_claim: "email",
            email_verified_claim: "",
            subject_claim: "id",
            button_label: "Continue with GitHub",
            display_icon: "github",
            button_color: "#24292f",
            button_text_color: "#ffffff",
        },
        note: "GitHub asserts no email-verified claim, so its emails are treated as unverified and never auto-link.",
    },
    {
        id: "microsoft",
        label: "Microsoft",
        fields: {
            slug: "microsoft",
            display_name: "Microsoft",
            kind: "oidc",
            issuer_url: "https://login.microsoftonline.com/{tenant-id}/v2.0",
            scopes: OIDC_DEFAULT_SCOPES,
            email_claim: "email",
            email_verified_claim: "email_verified",
            subject_claim: "sub",
            button_label: "Continue with Microsoft",
            display_icon: "microsoft",
            button_color: "#2f2f2f",
            button_text_color: "#ffffff",
        },
        note: "Replace {tenant-id} with your Entra directory (tenant) ID.",
    },
    {
        id: "okta",
        label: "Okta",
        fields: {
            slug: "okta",
            display_name: "Okta",
            kind: "oidc",
            issuer_url: "https://{your-org}.okta.com",
            scopes: OIDC_DEFAULT_SCOPES,
            email_claim: "email",
            email_verified_claim: "email_verified",
            subject_claim: "sub",
            button_label: "Continue with Okta",
            display_icon: "okta",
            button_color: "#007dc1",
            button_text_color: "#ffffff",
        },
        note: "Replace {your-org} with your Okta domain.",
    },
    {
        id: "gitlab",
        label: "GitLab",
        fields: {
            slug: "gitlab",
            display_name: "GitLab",
            kind: "oidc",
            issuer_url: "https://gitlab.com",
            scopes: OIDC_DEFAULT_SCOPES,
            email_claim: "email",
            email_verified_claim: "email_verified",
            subject_claim: "sub",
            button_label: "Continue with GitLab",
            display_icon: "gitlab",
            button_color: "#fc6d26",
            button_text_color: "#171321",
        },
        note: "Self-managed GitLab: change the issuer to your instance's URL.",
    },
    {
        id: "forta",
        label: "Forta",
        fields: {
            slug: "forta",
            display_name: "Forta",
            kind: "oidc",
            issuer_url: "https://auth.appleby.cloud",
            scopes: OIDC_DEFAULT_SCOPES,
            email_claim: "email",
            email_verified_claim: "email_verified",
            subject_claim: "sub",
            button_label: "Continue with Forta",
            display_icon: "forta",
        },
    },
];

/** Applies a preset over the form, keeping the credentials already typed. */
export function applyPreset(form: ProviderForm, preset: ProviderPreset): ProviderForm {
    return { ...form, ...preset.fields, client_id: form.client_id, client_secret: form.client_secret };
}

// ── Validation ───────────────────────────────────────────────────────────

export type FieldKey = keyof ProviderForm;
export type FieldErrors = Partial<Record<FieldKey, string>>;

/**
 * Mirrors monitor-core's ValidateExternalURL closely enough to fail early: https,
 * a hostname, and nothing a URL parser would have to repair. The server's SSRF
 * guard (private ranges, DNS) still runs and its message is what is shown if it
 * disagrees.
 */
function urlError(value: string, required: boolean): string | undefined {
    const v = value.trim();
    if (v === "") return required ? "Required." : undefined;
    if (/[{}]/.test(v)) return "Replace the {placeholder} with your own value.";
    if (/\s|[<>"]/.test(v)) return "Not a valid URL.";
    let parsed: URL;
    try {
        parsed = new URL(v);
    } catch {
        return "Not a valid URL.";
    }
    if (parsed.protocol !== "https:") return "Must be an https:// URL.";
    if (!parsed.hostname) return "Must include a hostname.";
    return undefined;
}

export function validateForm(form: ProviderForm, isCreate: boolean): FieldErrors {
    const errors: FieldErrors = {};

    if (isCreate) {
        const slug = form.slug.trim();
        if (slug === "") errors.slug = "Required.";
        else if (!SLUG.test(slug)) errors.slug = "Lowercase letters, digits and hyphens only.";
    }
    if (form.display_name.trim() === "") errors.display_name = "Required.";

    if (form.kind === "oidc") {
        const e = urlError(form.issuer_url, true);
        if (e) errors.issuer_url = e;
        const j = urlError(form.jwks_url, false);
        if (j) errors.jwks_url = j;
    } else {
        for (const key of ["authorize_url", "token_url"] as const) {
            const e = urlError(form[key], true);
            if (e) errors[key] = e;
        }
        const u = urlError(form.userinfo_url, true);
        if (u) errors.userinfo_url = u;
    }
    const icon = urlError(form.icon_url, false);
    if (icon) errors.icon_url = icon;

    const scopes = form.scopes.trim();
    if (scopes === "") errors.scopes = "At least one scope is required.";
    else if (form.kind === "oidc" && !scopes.split(/\s+/).includes("openid"))
        errors.scopes = "OIDC needs the openid scope.";

    if (form.email_claim.trim() === "") errors.email_claim = "Required.";
    if (form.subject_claim.trim() === "") errors.subject_claim = "Required.";

    for (const key of ["button_color", "button_text_color"] as const) {
        if (form[key] !== "" && !HEX_COLOR.test(form[key])) errors[key] = "Must be #rrggbb.";
    }

    if (!/^-?\d{1,6}$/.test(form.sort_order.trim())) errors.sort_order = "A whole number.";

    return errors;
}

/** The order fields appear in the form, so "first error" means first on screen. */
export const FIELD_ORDER: FieldKey[] = [
    "slug",
    "display_name",
    "issuer_url",
    "jwks_url",
    "authorize_url",
    "token_url",
    "userinfo_url",
    "client_id",
    "client_secret",
    "scopes",
    "email_claim",
    "email_verified_claim",
    "subject_claim",
    "sort_order",
    "icon_url",
    "button_color",
    "button_text_color",
];

/**
 * The server answers a bad field as "issuer_url: URL must use HTTPS…". Pull the
 * field off the front so the message lands on the input it is about instead of
 * in a banner at the top of a scrolling dialog.
 */
export function fieldFromServerError(message: string): { field?: FieldKey; message: string } {
    const m = /^([a-z_]+): (.+)$/.exec(message);
    if (m && (FIELD_ORDER as string[]).includes(m[1])) {
        return { field: m[1] as FieldKey, message: m[2] };
    }
    return { message };
}

// ── Payload ──────────────────────────────────────────────────────────────

// Build the write payload. Always send the scalar/boolean config; only include
// URL / id / secret fields when populated so an edit never blanks an unset value.
// client_secret is omitted when blank ("leave blank to keep") on edit.
export function buildPayload(form: ProviderForm, isCreate: boolean): SSOProviderPayload {
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

    // validateForm has already refused anything that is not a whole number, so
    // this never coerces junk to 0 the way the old parseInt fallback did.
    payload.sort_order = Number(form.sort_order.trim());

    return payload;
}

// ── Colour contrast ──────────────────────────────────────────────────────

function luminance(hex: string): number {
    const channel = (i: number) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG 2 contrast ratio between two #rrggbb colours, or null if either is invalid. */
export function contrastRatio(a: string, b: string): number | null {
    if (!HEX_COLOR.test(a) || !HEX_COLOR.test(b)) return null;
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/** The callback every provider redirects to — one exact URI registered with each IdP. */
export function callbackURL(apiURL: string): string {
    return `${apiURL.replace(/\/+$/, "")}/auth/sso/callback`;
}
