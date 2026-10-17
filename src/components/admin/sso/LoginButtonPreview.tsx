"use client";

import { SSOProviderButtons, type SSOProvider } from "@/components/sso-provider-buttons";
import type { AdminSSOProvider } from "@/types/auth.types";
import type { ProviderForm } from "./providerForm";

/** The API path the login page loads a provider's cached icon from. */
export function cachedIconPath(slug: string): string {
    return `/auth/sso/icon/${encodeURIComponent(slug)}`;
}

/**
 * The provider as `GET /auth/sso/config` would describe it, built from a stored row.
 *
 * Mirrors monitor-core's HandleSSOConfig: the label is button_label falling back
 * to display_name, and the icon is the CACHED asset, else the bundled mark
 * (`display_icon` reaches the login page as "bundled:<slug>", which
 * sso-provider-buttons maps to /public/sso/<slug>.svg), else nothing. Keep this in
 * step with the login page — a preview prettier than the real page is worse than
 * none.
 */
function fromRow(p: AdminSSOProvider): SSOProvider {
    return {
        name: p.slug,
        display_name: p.button_label || p.display_name,
        display_icon: p.has_icon ? cachedIconPath(p.slug) : p.display_icon ? `bundled:${p.display_icon}` : null,
        button_color: p.button_color || null,
        button_text_color: p.button_text_color || null,
        login_url: `/auth/sso/${p.slug}/login`,
        sort_order: p.sort_order ?? 0,
    };
}

/**
 * LoginButtonPreview renders the login page's SSO block with the DRAFT in place,
 * among the other enabled providers in their real order.
 *
 * It is the login page's own component (`SSOProviderButtons`), not a lookalike,
 * so the preview cannot drift from what visitors see. `inert` makes the anchors
 * unclickable and unfocusable — they point at real sign-in URLs.
 */
export function LoginButtonPreview({
    form,
    initial,
    others,
    apiURL,
}: {
    form: ProviderForm;
    /** The form as it opened — decides whether the cached icon still applies. */
    initial: ProviderForm;
    /** Every stored provider; the draft's own row is replaced by the draft. */
    others: AdminSSOProvider[];
    apiURL: string;
}) {
    const slug = form.slug.trim() || "draft";
    // The cached icon belongs to the SAVED icon URL. Once the URL is edited the
    // cached bytes are no longer what will be served, and the new one is fetched
    // only on save.
    const iconStillCached = form.has_icon && form.icon_url.trim() === initial.icon_url.trim();
    const order = Number(form.sort_order.trim());

    const draft: SSOProvider = {
        name: slug,
        display_name: form.button_label.trim() || form.display_name.trim() || "Provider",
        display_icon: iconStillCached ? cachedIconPath(slug) : null,
        button_color: form.button_color || null,
        button_text_color: form.button_text_color || null,
        login_url: `/auth/sso/${slug}/login`,
        sort_order: Number.isFinite(order) ? order : 0,
    };

    const rest = others.filter((p) => p.enabled && p.slug !== initial.slug).map(fromRow);
    const shown = form.enabled ? [...rest, draft] : rest;

    return (
        <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-secondary">
                Login page preview
            </p>
            <div
                inert
                aria-label="Preview of the sign-in buttons"
                className="rounded-xl border border-border bg-surface p-4"
            >
                {shown.length > 0 ? (
                    <SSOProviderButtons providers={shown} apiURL={apiURL} />
                ) : (
                    <p className="text-center text-xs text-muted">
                        No SSO buttons — only the email and password form is shown.
                    </p>
                )}
            </div>
            {!form.enabled && (
                <div className="space-y-1.5">
                    <p className="text-xs text-pending">
                        Disabled — this provider is not on the login page. It would look like:
                    </p>
                    <div inert className="rounded-xl border border-dashed border-border-strong p-4 opacity-70">
                        <SSOProviderButtons providers={[draft]} apiURL={apiURL} />
                    </div>
                </div>
            )}
            <p className="text-xs text-muted">
                Shown in the current theme. Bundled icons are not drawn on the login page yet; a
                custom icon URL appears here after it has been saved and fetched.
            </p>
        </div>
    );
}
