"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faKey, faPen, faTrash } from "@fortawesome/free-solid-svg-icons";
import type { AdminSSOProvider } from "@/types/auth.types";
import { Badge } from "@/components/ui/badge";
import { ButtonSpinner } from "@/components/ui/spinner";
import { cachedIconPath } from "./LoginButtonPreview";
import { HEX_COLOR } from "./providerForm";

/** The order the login page lists providers in: sort_order, then slug. */
export function byLoginOrder(a: AdminSSOProvider, b: AdminSSOProvider): number {
    return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.slug.localeCompare(b.slug);
}

/**
 * The provider's own mark: its cached icon when the API serves one, otherwise a
 * monogram in its button colours — the same two things the login button is
 * built from, so a row is recognisable as the button it configures.
 */
function ProviderMark({ provider, apiURL }: { provider: AdminSSOProvider; apiURL: string }) {
    if (provider.has_icon) {
        return (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-elevated">
                {/* eslint-disable-next-line @next/next/no-img-element -- a same-origin,
                    size-capped PNG served by the API at an arbitrary path; same as the
                    login page's SSOProviderButtons. */}
                <img
                    src={`${apiURL}${cachedIconPath(provider.slug)}`}
                    alt=""
                    aria-hidden="true"
                    className="h-5 w-5 object-contain"
                />
            </span>
        );
    }
    const bg = provider.button_color && HEX_COLOR.test(provider.button_color) ? provider.button_color : undefined;
    const fg =
        provider.button_text_color && HEX_COLOR.test(provider.button_text_color)
            ? provider.button_text_color
            : undefined;
    return (
        <span
            aria-hidden="true"
            style={bg || fg ? { backgroundColor: bg, color: fg } : undefined}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-elevated text-sm font-semibold uppercase text-secondary"
        >
            {(provider.display_name || provider.slug).charAt(0)}
        </span>
    );
}

export function ProviderRow({
    provider: p,
    apiURL,
    deleting,
    onEdit,
    onDelete,
}: {
    provider: AdminSSOProvider;
    apiURL: string;
    deleting: boolean;
    onEdit: () => void;
    onDelete: () => void;
}) {
    return (
        <li className="flex flex-col gap-3 p-4 border border-border-strong rounded-xl hover:bg-surface-elevated/30 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex items-start gap-3 min-w-0 sm:items-center">
                <ProviderMark provider={p} apiURL={apiURL} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
                        <p className="text-sm font-medium text-primary">{p.display_name}</p>
                        <span className="inline-flex items-center rounded-full bg-surface-elevated px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted">
                            {p.kind}
                        </span>
                        <Badge
                            variant={p.enabled ? "success" : "default"}
                            className={`rounded-full px-2 py-0.5 ${p.enabled ? "bg-healthy/10" : "bg-surface-elevated"}`}
                        >
                            {p.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                        {p.has_secret && (
                            // Not <Badge>: it has no info variant, and overriding its
                            // text colour by className is a cascade-order coin toss.
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info">
                                <FontAwesomeIcon icon={faKey} className="text-[0.625rem]" aria-hidden />
                                Secret set
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-muted mt-1 break-all">
                        <span className="font-mono">{p.slug}</span>
                        {" · "}order {p.sort_order ?? 0}
                        {p.client_id ? (
                            <>
                                {" · "}
                                <span className="font-mono" title="Client ID">
                                    {p.client_id}
                                </span>
                            </>
                        ) : null}
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 border-t border-border pt-2 sm:border-0 sm:pt-0">
                <button
                    type="button"
                    onClick={onEdit}
                    aria-label={`Edit ${p.display_name}`}
                    title={`Edit ${p.display_name}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-secondary hover:bg-surface-elevated rounded-lg transition-colors"
                >
                    <FontAwesomeIcon icon={faPen} aria-hidden />
                    Edit
                </button>
                <button
                    type="button"
                    onClick={onDelete}
                    disabled={deleting}
                    aria-label={`Delete ${p.display_name}`}
                    title={`Delete ${p.display_name}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 rounded-lg disabled:opacity-50 transition-colors"
                >
                    {deleting ? <ButtonSpinner /> : <FontAwesomeIcon icon={faTrash} aria-hidden />}
                    Delete
                </button>
            </div>
        </li>
    );
}
