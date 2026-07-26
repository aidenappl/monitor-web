"use client";

import { useCallback, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faSpinner,
    faLink,
    faLinkSlash,
    faLock,
    faShieldHalved,
    faCircleCheck,
} from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { useAuth } from "@/store/hooks";
import {
    reqGetIdentities,
    reqGetSSOConfig,
    reqLinkIdentity,
    reqUnlinkIdentity,
    reqUpdateSelf,
} from "@/services/auth.service";
import type { Identity, SSOProviderConfig } from "@/types/auth.types";

const MIN_PASSWORD_LENGTH = 8;

// Prettify a provider slug for display (e.g. "google" → "Google").
function providerLabel(slug: string): string {
    if (slug === "password") return "Password";
    return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function formatDate(dateStr?: string | null): string {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

export default function SecurityPage() {
    const { user } = useAuth();

    const [identities, setIdentities] = useState<Identity[]>([]);
    const [providers, setProviders] = useState<SSOProviderConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Linked-account action state.
    const [unlinking, setUnlinking] = useState<string | null>(null);
    const [linking, setLinking] = useState<string | null>(null);
    const [accountError, setAccountError] = useState<string | null>(null);

    // Password form state.
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [savingPassword, setSavingPassword] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [passwordSuccess, setPasswordSuccess] = useState(false);

    const loadIdentities = useCallback(async () => {
        const res = await reqGetIdentities();
        if (res.success) {
            setIdentities(res.data ?? []);
            return true;
        }
        return false;
    }, []);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const [idsRes, cfgRes] = await Promise.all([
                reqGetIdentities(),
                reqGetSSOConfig(),
            ]);
            if (idsRes.success) {
                setIdentities(idsRes.data ?? []);
            } else {
                setLoadError(idsRes.error_message || "Failed to load linked accounts");
            }
            if (cfgRes.success) {
                setProviders(cfgRes.data ?? []);
            }
            setLoading(false);
        };
        load();
    }, []);

    const hasPasswordIdentity = identities.some((i) => i.provider === "password");
    const linkedSlugs = new Set(identities.map((i) => i.provider));
    const connectable = providers.filter((p) => !linkedSlugs.has(p.slug));

    const handleUnlink = async (slug: string) => {
        setUnlinking(slug);
        setAccountError(null);
        const res = await reqUnlinkIdentity(slug);
        if (res.success) {
            await loadIdentities();
        } else if (res.status === 409) {
            setAccountError(
                "You can't remove your only sign-in method — add another first."
            );
        } else {
            setAccountError(res.error_message || "Failed to disconnect account");
        }
        setUnlinking(null);
    };

    const handleConnect = async (slug: string) => {
        setLinking(slug);
        setAccountError(null);
        const res = await reqLinkIdentity(slug);
        if (res.success) {
            // Full-page redirect into the provider link flow. The callback returns
            // the browser to /settings/security once the identity is attached.
            window.location.href = res.data.authorize_url;
            return;
        }
        setAccountError(res.error_message || "Failed to start the connection");
        setLinking(null);
    };

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError(null);
        setPasswordSuccess(false);

        if (newPassword.length < MIN_PASSWORD_LENGTH) {
            setPasswordError(
                `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
            );
            return;
        }
        if (newPassword !== confirmPassword) {
            setPasswordError("Passwords do not match.");
            return;
        }
        if (hasPasswordIdentity && !currentPassword) {
            setPasswordError("Enter your current password to change it.");
            return;
        }

        setSavingPassword(true);
        const res = await reqUpdateSelf({
            password: newPassword,
            ...(hasPasswordIdentity ? { current_password: currentPassword } : {}),
        });
        if (res.success) {
            setPasswordSuccess(true);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            // The password identity may be newly created — refresh the list.
            await loadIdentities();
        } else {
            setPasswordError(res.error_message || "Failed to update password");
        }
        setSavingPassword(false);
    };

    return (
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <div className="space-y-8">
                <div>
                    <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                        Account &amp; Security
                    </h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Manage how you sign in to Monitor
                        {user?.email ? ` as ${user.email}` : ""}.
                    </p>
                </div>

                {loadError && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                        <p className="text-sm text-red-600 dark:text-red-400">
                            {loadError}
                        </p>
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <FontAwesomeIcon
                            icon={faSpinner}
                            className="text-zinc-400 animate-spin text-lg"
                        />
                    </div>
                ) : (
                    <>
                        {/* Linked accounts */}
                        <section className="space-y-4">
                            <div>
                                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                                    <FontAwesomeIcon
                                        icon={faShieldHalved}
                                        className="text-zinc-400 text-base"
                                    />
                                    Linked accounts
                                </h2>
                                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                                    The sign-in methods currently connected to your account.
                                </p>
                            </div>

                            {accountError && (
                                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                                    <p className="text-sm text-red-600 dark:text-red-400">
                                        {accountError}
                                    </p>
                                </div>
                            )}

                            <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl divide-y divide-zinc-200 dark:divide-zinc-700 overflow-hidden">
                                {identities.map((identity) => {
                                    const isPassword = identity.provider === "password";
                                    const isOnly = identities.length <= 1;
                                    return (
                                        <div
                                            key={identity.id}
                                            className="flex items-center justify-between gap-4 px-4 py-3"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                                                    <FontAwesomeIcon
                                                        icon={isPassword ? faLock : faLink}
                                                    />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                        {providerLabel(identity.provider)}
                                                        {isPassword && (
                                                            <span className="ml-2 inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                                                Password
                                                            </span>
                                                        )}
                                                    </p>
                                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                                        {isPassword
                                                            ? "Email and password sign-in"
                                                            : identity.provider_email ||
                                                              identity.provider_user_id}
                                                        {" · connected "}
                                                        {formatDate(identity.created_at)}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleUnlink(identity.provider)}
                                                disabled={
                                                    unlinking === identity.provider || isOnly
                                                }
                                                title={
                                                    isOnly
                                                        ? "You can't remove your only sign-in method"
                                                        : undefined
                                                }
                                                className="inline-flex flex-shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                            >
                                                <FontAwesomeIcon
                                                    icon={
                                                        unlinking === identity.provider
                                                            ? faSpinner
                                                            : faLinkSlash
                                                    }
                                                    className={
                                                        unlinking === identity.provider
                                                            ? "animate-spin"
                                                            : ""
                                                    }
                                                />
                                                Disconnect
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>

                        {/* Connect an account */}
                        {connectable.length > 0 && (
                            <section className="space-y-4">
                                <div>
                                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                                        <FontAwesomeIcon
                                            icon={faLink}
                                            className="text-zinc-400 text-base"
                                        />
                                        Connect an account
                                    </h2>
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                                        Add another provider you can use to sign in.
                                    </p>
                                </div>

                                <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl divide-y divide-zinc-200 dark:divide-zinc-700 overflow-hidden">
                                    {connectable.map((provider) => (
                                        <div
                                            key={provider.slug}
                                            className="flex items-center justify-between gap-4 px-4 py-3"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                                                    <FontAwesomeIcon icon={faLink} />
                                                </div>
                                                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                                    {provider.button_label}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => handleConnect(provider.slug)}
                                                disabled={linking === provider.slug}
                                                className="inline-flex flex-shrink-0 items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                                            >
                                                {linking === provider.slug && (
                                                    <FontAwesomeIcon
                                                        icon={faSpinner}
                                                        className="animate-spin"
                                                    />
                                                )}
                                                Connect
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Password */}
                        <section className="space-y-4">
                            <div>
                                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                                    <FontAwesomeIcon
                                        icon={faLock}
                                        className="text-zinc-400 text-base"
                                    />
                                    {hasPasswordIdentity ? "Change password" : "Set a password"}
                                </h2>
                                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                                    {hasPasswordIdentity
                                        ? "Update the password you use for email sign-in."
                                        : "Add a password so you can sign in with your email directly."}
                                </p>
                            </div>

                            {passwordError && (
                                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                                    <p className="text-sm text-red-600 dark:text-red-400">
                                        {passwordError}
                                    </p>
                                </div>
                            )}
                            {passwordSuccess && (
                                <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center gap-2">
                                    <FontAwesomeIcon
                                        icon={faCircleCheck}
                                        className="text-emerald-500"
                                    />
                                    <p className="text-sm text-emerald-700 dark:text-emerald-300">
                                        Password updated.
                                    </p>
                                </div>
                            )}

                            <form
                                onSubmit={handlePasswordSubmit}
                                className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 space-y-4 max-w-md"
                            >
                                {hasPasswordIdentity && (
                                    <div>
                                        <label
                                            htmlFor="current-password"
                                            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                                        >
                                            Current password
                                        </label>
                                        <input
                                            id="current-password"
                                            type="password"
                                            autoComplete="current-password"
                                            value={currentPassword}
                                            onChange={(e) =>
                                                setCurrentPassword(e.target.value)
                                            }
                                            className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                )}
                                <div>
                                    <label
                                        htmlFor="new-password"
                                        className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                                    >
                                        New password
                                    </label>
                                    <input
                                        id="new-password"
                                        type="password"
                                        autoComplete="new-password"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                                        At least {MIN_PASSWORD_LENGTH} characters.
                                    </p>
                                </div>
                                <div>
                                    <label
                                        htmlFor="confirm-password"
                                        className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                                    >
                                        Confirm new password
                                    </label>
                                    <input
                                        id="confirm-password"
                                        type="password"
                                        autoComplete="new-password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={savingPassword}
                                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                                >
                                    {savingPassword && (
                                        <FontAwesomeIcon
                                            icon={faSpinner}
                                            className="animate-spin text-xs"
                                        />
                                    )}
                                    {hasPasswordIdentity ? "Update password" : "Set password"}
                                </button>
                            </form>
                        </section>
                    </>
                )}
            </div>
        </main>
    );
}
