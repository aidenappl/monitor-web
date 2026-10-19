"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { FailureNote, FailureState } from "@/components/FailureState";
import {
    faLink,
    faLinkSlash,
    faLock,
    faShieldHalved,
    faCircleCheck,
    faUserShield,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "@/store/hooks";
import {
    reqGetIdentities,
    reqGetSSOConfig,
    reqLinkIdentity,
    reqUnlinkIdentity,
    reqUpdateSelf,
} from "@/services/auth.service";
import type { Identity, SSOProviderConfig } from "@/types/auth.types";
import { reportWarn } from "@/services/monitor.service";
import { useConfirm } from "@/components/ConfirmProvider";
import { ssoHref } from "@/components/sso-provider-buttons";
import { ssoLoginHref } from "@/tools/sso.tools";
import { formatDateTime, useDateTimePrefs } from "@/tools/datetime.tools";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { ButtonSpinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";

const MIN_PASSWORD_LENGTH = 8;

// monitor-core's step-up refusal: adding a FIRST password to an SSO-only
// account needs a sign-in younger than 10 minutes (403, message
// "reauth_required"). An older core never sends it, and the refusal then falls
// through to the ordinary error path.
const ERROR_CODE_REAUTH_REQUIRED = 4011;
// Where the step-up round trip comes back to, and how long its "you're
// confirmed" note stays believable — the server's own window.
const REAUTH_RETURN = "/settings/security";
const REAUTH_KEY = "mon-reauth-started-at";
const REAUTH_WINDOW_MS = 10 * 60_000;

// SSO login is a full-page redirect to the API host (see login/page.tsx).
const API_BASE = (process.env.NEXT_PUBLIC_MONITOR_API_URL || "").replace(/\/+$/, "");

// Prettify a provider slug for display (e.g. "google" → "Google").
function providerLabel(slug: string): string {
    if (slug === "password") return "Password";
    return slug.charAt(0).toUpperCase() + slug.slice(1);
}

// The admin-configured name, not the slug ("Forta", not "forta-prod").
// display_name is usually a whole button label ("Continue with Forta"), so the
// verb is stripped the same way the login page's silent-SSO shell does.
function reauthLabel(p: SSOProviderConfig): string {
    return p.display_name?.replace(/^(continue|sign in) with /i, "").trim() || providerLabel(p.name);
}

/** Notes the step-up start, so the page can say "you're confirmed" on return. */
function markReauthStarted() {
    try {
        sessionStorage.setItem(REAUTH_KEY, String(Date.now()));
    } catch {
        // Only costs the "you're confirmed" note on the way back.
    }
}

type PwField = "current" | "new" | "confirm";

/**
 * A rough strength reading — guidance only, not a rule. The server enforces the
 * minimum length and nothing else, so this never blocks a submit. Deliberately
 * dependency-free (no zxcvbn): it scores length and variety and knocks down the
 * patterns every cracking list starts with.
 */
function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
    if (pw.length < MIN_PASSWORD_LENGTH) return { score: 0, label: "Too short" };
    let score = 1;
    if (pw.length >= 12) score++;
    if (pw.length >= 16) score++;
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
    if (classes >= 3) score++;
    const lower = pw.toLowerCase();
    if (
        /^(.)\1+$/.test(pw) ||
        /(password|qwerty|letmein|monitor|123456|abcdef)/.test(lower) ||
        /^\d+$/.test(pw)
    ) {
        score = 1;
    }
    const s = Math.min(score, 4) as 1 | 2 | 3 | 4;
    return { score: s, label: ["", "Weak", "Fair", "Good", "Strong"][s] };
}

const inputClass = (invalid: boolean) =>
    `w-full min-h-10 px-3 py-2 text-base sm:text-sm rounded-lg border bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 ${
        invalid
            ? "border-red-500 dark:border-red-500 focus:ring-red-500"
            : "border-zinc-300 dark:border-zinc-600 focus:ring-blue-500"
    }`;

export default function SecurityPage() {
    const { user } = useAuth();
    const confirm = useConfirm();
    const prefs = useDateTimePrefs();

    const [identities, setIdentities] = useState<Identity[]>([]);
    const [providers, setProviders] = useState<SSOProviderConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    // Separate from loadError, which is about the identities. A failed SSO config
    // makes the whole "Connect an account" section vanish — silently, because
    // connectable.length is 0 either way — so it reads as "this install has no
    // SSO providers" rather than "we could not ask".
    const [providersError, setProvidersError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);

    // Linked-account action state.
    const [unlinking, setUnlinking] = useState<string | null>(null);
    const [linking, setLinking] = useState<string | null>(null);
    const [accountError, setAccountError] = useState<string | null>(null);

    // Password form state.
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPasswords, setShowPasswords] = useState(false);
    const [savingPassword, setSavingPassword] = useState(false);
    const [passwordError, setPasswordError] = useState<{
        field: PwField | null;
        message: string;
    } | null>(null);
    const [passwordSuccess, setPasswordSuccess] = useState(false);
    const [reauthNeeded, setReauthNeeded] = useState(false);
    // Back from the step-up sign-in: say so, so the user knows the next
    // attempt will go through (and roughly how long they have).
    const [reauthed, setReauthed] = useState(false);
    const currentRef = useRef<HTMLInputElement>(null);
    const newRef = useRef<HTMLInputElement>(null);
    const confirmRef = useRef<HTMLInputElement>(null);

    const loadIdentities = useCallback(async () => {
        const res = await reqGetIdentities();
        if (res.success) {
            setIdentities(res.data ?? []);
            return true;
        }
        return false;
    }, []);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            const [idsRes, cfgRes] = await Promise.all([
                reqGetIdentities(),
                reqGetSSOConfig(),
            ]);
            if (cancelled) return;
            if (idsRes.success) {
                setIdentities(idsRes.data ?? []);
                setLoadError(null);
            } else {
                setLoadError(idsRes.error_message || "Failed to load linked accounts");
            }
            // `.providers` — the body is an envelope, not a bare array. Same
            // mistake here hid every "connect an account" button on this page.
            if (cfgRes.success && Array.isArray(cfgRes.data?.providers)) {
                setProviders(cfgRes.data.providers);
                setProvidersError(null);
            } else if (!cfgRes.success) {
                setProvidersError(cfgRes.error_message || "The request failed.");
            } else {
                // 200 in the wrong shape: the section vanishes with no error
                // anywhere, which is how SSO-only users got locked out once.
                reportWarn("sso_config.load.failed", {
                    expected: "{ providers: [...] }",
                    got_type: Array.isArray(cfgRes.data) ? "array" : typeof cfgRes.data,
                    got_keys:
                        cfgRes.data && typeof cfgRes.data === "object"
                            ? Object.keys(cfgRes.data).slice(0, 10).join(",")
                            : undefined,
                    outcome: "no connect-an-account buttons rendered",
                });
            }
            try {
                const at = Number(sessionStorage.getItem(REAUTH_KEY) ?? 0);
                if (at) {
                    sessionStorage.removeItem(REAUTH_KEY);
                    if (Date.now() - at < REAUTH_WINDOW_MS) setReauthed(true);
                }
            } catch {
                // No storage: the note is a courtesy; the server still decides.
            }
            setLoading(false);
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [reloadToken]);

    const hasPasswordIdentity = identities.some((i) => i.provider === "password");
    const ssoIdentities = identities.filter((i) => i.provider !== "password");
    const linkedSlugs = new Set(identities.map((i) => i.provider));
    const connectable = providers.filter((p) => !linkedSlugs.has(p.name));
    // The providers this account can step up through: ones it is linked to.
    const reauthProviders = providers.filter((p) => linkedSlugs.has(p.name));

    const handleUnlink = async (identity: Identity) => {
        const label = providerLabel(identity.provider);
        const ok = await confirm({
            title: `Disconnect ${label}?`,
            description:
                identity.provider === "password"
                    ? "Your password will be removed and you will no longer be able to sign in with your email and password. You can set a new one later from this page."
                    : `You will no longer be able to sign in to Monitor with ${label}. You can connect it again later from this page.`,
            confirmLabel: `Disconnect ${label}`,
            destructive: true,
        });
        if (!ok) return;
        const slug = identity.provider;
        setUnlinking(slug);
        setAccountError(null);
        const res = await reqUnlinkIdentity(slug);
        if (res.success) {
            if (!(await loadIdentities())) {
                setAccountError(
                    `${label} was disconnected, but the list could not be refreshed. Reload the page to see it.`
                );
            }
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
            // assign(), not `location.href = …`: same navigation, but a method
            // call rather than an assignment to a value React cannot reason about
            // (react-hooks/immutability).
            window.location.assign(res.data.authorize_url);
            return;
        }
        setAccountError(res.error_message || "Failed to start the connection");
        setLinking(null);
    };

    /**
     * Step-up: a full SSO sign-in with prompt=login (the provider must ask for
     * credentials, not reuse its session) that comes back here. The callback
     * stamps a fresh auth time on the session, which is what PUT /auth/self
     * checks.
     */
    const startReauth = (provider: SSOProviderConfig) => {
        const base = ssoHref(API_BASE, provider.login_url);
        if (!base) {
            setPasswordError({ field: null, message: "This provider's sign-in link is invalid." });
            return;
        }
        const u = new URL(ssoLoginHref(base, { next: REAUTH_RETURN }));
        u.searchParams.set("prompt", "login");
        markReauthStarted();
        window.location.assign(u.toString());
    };

    const fail = (field: PwField | null, message: string) => {
        setPasswordError({ field, message });
        // Focus the field that failed, so the error is read with it.
        const ref = field === "current" ? currentRef : field === "new" ? newRef : field === "confirm" ? confirmRef : null;
        ref?.current?.focus();
    };

    // Any edit retires the last verdict: a "Passwords do not match" left under a
    // field the user has since corrected reads as still wrong, and "Password
    // updated" over a half-typed new one reads as already saved. The step-up
    // panel stays — it is an action, not a verdict on the input.
    const edited = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
        set(e.target.value);
        setPasswordError(null);
        setPasswordSuccess(false);
    };

    const handlePasswordSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError(null);
        setPasswordSuccess(false);
        setReauthNeeded(false);

        if (hasPasswordIdentity && !currentPassword) {
            fail("current", "Enter your current password to change it.");
            return;
        }
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
            fail("new", `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
            return;
        }
        if (newPassword !== confirmPassword) {
            fail("confirm", "Passwords do not match.");
            return;
        }

        setSavingPassword(true);
        const res = await reqUpdateSelf({
            password: newPassword,
            ...(hasPasswordIdentity ? { current_password: currentPassword } : {}),
        });
        if (res.success) {
            setPasswordSuccess(true);
            setReauthed(false);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            // The password identity may be newly created — refresh the list.
            await loadIdentities();
        } else if (res.status === 403 && res.error_code === ERROR_CODE_REAUTH_REQUIRED) {
            setReauthNeeded(true);
            setReauthed(false);
        } else if (hasPasswordIdentity && (res.status === 401 || res.status === 400) && /current/i.test(res.error_message || "")) {
            fail("current", res.error_message);
        } else {
            fail(null, res.error_message || "Failed to update password");
        }
        setSavingPassword(false);
    };

    const errorFor = (field: PwField) =>
        passwordError?.field === field ? passwordError.message : null;
    const strength = passwordStrength(newPassword);
    const strengthColor = ["bg-zinc-300 dark:bg-zinc-600", "bg-red-500", "bg-amber-500", "bg-blue-500", "bg-emerald-500"][strength.score];

    return (
        <div>
            <div className="space-y-8">
                <div>
                    <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                        Sign-in &amp; security
                    </h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 break-words">
                        Manage how you sign in to Monitor
                        {user?.email ? ` as ${user.email}` : ""}.
                    </p>
                </div>

                {loading ? (
                    <SecuritySkeleton />
                ) : (
                    <>
                        {/* Linked accounts */}
                        <section className="space-y-4" aria-labelledby="linked-heading">
                            <div>
                                <h2
                                    id="linked-heading"
                                    className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-2"
                                >
                                    <FontAwesomeIcon
                                        icon={faShieldHalved}
                                        className="text-zinc-400 text-base"
                                        aria-hidden
                                    />
                                    Linked accounts
                                </h2>
                                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                                    The sign-in methods currently connected to your account.
                                </p>
                            </div>

                            {accountError && (
                                <div
                                    role="alert"
                                    className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
                                >
                                    <p className="text-sm text-red-600 dark:text-red-400">
                                        {accountError}
                                    </p>
                                </div>
                            )}

                            {/* A failed read REPLACES the list: an empty bordered box
                                under an error banner reads as "no sign-in methods". */}
                            {loadError ? (
                                <FailureState
                                    what="your linked accounts"
                                    message={loadError}
                                    onRetry={() => {
                                        setLoading(true);
                                        setReloadToken((t) => t + 1);
                                    }}
                                />
                            ) : (
                                <ul className="border border-zinc-200 dark:border-zinc-700 rounded-xl divide-y divide-zinc-200 dark:divide-zinc-700 overflow-hidden">
                                    {identities.map((identity) => {
                                        const isPassword = identity.provider === "password";
                                        const isOnly = identities.length <= 1;
                                        const label = providerLabel(identity.provider);
                                        // provider_email is often empty (Forta does not
                                        // send one), and the raw provider_user_id is a
                                        // UUID nobody recognises. With ONE SSO identity
                                        // it is the one the account was provisioned
                                        // from, so the account email is the honest name.
                                        const who = isPassword
                                            ? "Email and password sign-in"
                                            : identity.provider_email ||
                                              (ssoIdentities.length === 1 && user?.email) ||
                                              `${label} account`;
                                        const connected = identity.inserted_at
                                            ? ` · connected ${formatDateTime(identity.inserted_at, prefs, { dateOnly: true })}`
                                            : "";
                                        const fullLine = `${who}${connected}`;
                                        return (
                                            <li
                                                key={identity.id}
                                                className="flex items-center justify-between gap-4 px-4 py-3"
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                                                        <FontAwesomeIcon
                                                            icon={isPassword ? faLock : faLink}
                                                            aria-hidden
                                                        />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                            {label}
                                                        </p>
                                                        <p
                                                            className="text-xs text-zinc-500 dark:text-zinc-400 truncate"
                                                            title={
                                                                isPassword
                                                                    ? fullLine
                                                                    : `${fullLine}\n${label} ID: ${identity.provider_user_id}`
                                                            }
                                                        >
                                                            {fullLine}
                                                        </p>
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleUnlink(identity)}
                                                    disabled={
                                                        unlinking === identity.provider || isOnly
                                                    }
                                                    title={
                                                        isOnly
                                                            ? "You can't remove your only sign-in method"
                                                            : `Disconnect ${label}`
                                                    }
                                                    aria-label={`Disconnect ${label}`}
                                                    className="inline-flex flex-shrink-0 min-h-10 sm:min-h-8 items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                                >
                                                    {unlinking === identity.provider ? (
                                                        <ButtonSpinner />
                                                    ) : (
                                                        <FontAwesomeIcon icon={faLinkSlash} aria-hidden />
                                                    )}
                                                    Disconnect
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>

                        {/* ⚠️ Nothing below renders while the identities read is
                            failing. Every decision in these sections is made FROM
                            that list — `connectable` would offer a provider the
                            account is already linked to, and the password form would
                            read "Set a password" (no current-password field) to an
                            account that has one. The FailureState above owns the
                            whole account area until a retry succeeds. */}
                        {!loadError && (
                        <>
                        {/* Connect an account */}
                        {providersError && connectable.length === 0 && (
                            <section>
                                <FailureNote
                                    what="the sign-in providers"
                                    message={providersError}
                                    onRetry={() => setReloadToken((t) => t + 1)}
                                />
                            </section>
                        )}

                        {connectable.length > 0 && (
                            <section className="space-y-4" aria-labelledby="connect-heading">
                                <div>
                                    <h2
                                        id="connect-heading"
                                        className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-2"
                                    >
                                        <FontAwesomeIcon
                                            icon={faLink}
                                            className="text-zinc-400 text-base"
                                            aria-hidden
                                        />
                                        Connect an account
                                    </h2>
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                                        Add another provider you can use to sign in.
                                    </p>
                                </div>

                                <ul className="border border-zinc-200 dark:border-zinc-700 rounded-xl divide-y divide-zinc-200 dark:divide-zinc-700 overflow-hidden">
                                    {connectable.map((provider) => (
                                        <li
                                            key={provider.name}
                                            className="flex items-center justify-between gap-4 px-4 py-3"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                                                    <FontAwesomeIcon icon={faLink} aria-hidden />
                                                </div>
                                                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                                    {provider.display_name}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleConnect(provider.name)}
                                                disabled={linking === provider.name}
                                                className="inline-flex flex-shrink-0 min-h-10 sm:min-h-8 items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                                            >
                                                {linking === provider.name && <ButtonSpinner />}
                                                Connect
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {/* Password */}
                        <section className="space-y-4" aria-labelledby="password-heading">
                            <div>
                                <h2
                                    id="password-heading"
                                    className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-2"
                                >
                                    <FontAwesomeIcon
                                        icon={faLock}
                                        className="text-zinc-400 text-base"
                                        aria-hidden
                                    />
                                    {hasPasswordIdentity ? "Change password" : "Set a password"}
                                </h2>
                                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                                    {hasPasswordIdentity
                                        ? "Update the password you use for email sign-in."
                                        : "Add a password so you can sign in with your email directly. A password keeps working even if your SSO access is removed, so Monitor may ask you to sign in again first to confirm it's you."}
                                </p>
                            </div>

                            <form
                                onSubmit={handlePasswordSubmit}
                                noValidate
                                aria-labelledby="password-heading"
                                className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 space-y-4 max-w-md"
                            >
                                {/* Status lives INSIDE the form so it lines up with
                                    it, and is announced: role=alert for failures,
                                    role=status for success. */}
                                {passwordError && passwordError.field === null && (
                                    <div
                                        role="alert"
                                        className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
                                    >
                                        <p className="text-sm text-red-600 dark:text-red-400">
                                            {passwordError.message}
                                        </p>
                                    </div>
                                )}
                                {reauthNeeded && (
                                    <div
                                        role="alert"
                                        className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg space-y-2"
                                    >
                                        <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-2">
                                            <FontAwesomeIcon icon={faUserShield} aria-hidden />
                                            Confirm it&apos;s you
                                        </p>
                                        <p className="text-sm text-amber-700 dark:text-amber-300">
                                            Adding a password needs a sign-in from the last 10
                                            minutes. Sign in again and you&apos;ll come back
                                            here to set it — your password was not saved.
                                        </p>
                                        {reauthProviders.length > 0 ? (
                                            <div className="flex flex-wrap gap-2">
                                                {reauthProviders.map((p) => (
                                                    <button
                                                        key={p.name}
                                                        type="button"
                                                        onClick={() => startReauth(p)}
                                                        className="inline-flex min-h-10 sm:min-h-9 items-center px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                                                    >
                                                        Sign in again with {reauthLabel(p)}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-amber-700 dark:text-amber-300">
                                                Sign out and back in, then return to this page.
                                            </p>
                                        )}
                                    </div>
                                )}
                                {reauthed && !reauthNeeded && !passwordSuccess && (
                                    <div
                                        role="status"
                                        className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg"
                                    >
                                        <p className="text-sm text-blue-700 dark:text-blue-300">
                                            You signed in again. Set your password within
                                            the next 10 minutes.
                                        </p>
                                    </div>
                                )}
                                {passwordSuccess && (
                                    <div
                                        role="status"
                                        className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center gap-2"
                                    >
                                        <FontAwesomeIcon
                                            icon={faCircleCheck}
                                            className="text-emerald-500"
                                            aria-hidden
                                        />
                                        <p className="text-sm text-emerald-700 dark:text-emerald-300">
                                            Password updated.
                                        </p>
                                    </div>
                                )}

                                {hasPasswordIdentity && (
                                    <div>
                                        <label
                                            htmlFor="current-password"
                                            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                                        >
                                            Current password
                                        </label>
                                        <input
                                            ref={currentRef}
                                            id="current-password"
                                            type={showPasswords ? "text" : "password"}
                                            autoComplete="current-password"
                                            value={currentPassword}
                                            onChange={edited(setCurrentPassword)}
                                            aria-invalid={errorFor("current") ? true : undefined}
                                            aria-describedby={errorFor("current") ? "current-password-error" : undefined}
                                            className={inputClass(!!errorFor("current"))}
                                        />
                                        {errorFor("current") && (
                                            <p id="current-password-error" role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">
                                                {errorFor("current")}
                                            </p>
                                        )}
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
                                        ref={newRef}
                                        id="new-password"
                                        type={showPasswords ? "text" : "password"}
                                        autoComplete="new-password"
                                        value={newPassword}
                                        onChange={edited(setNewPassword)}
                                        aria-invalid={errorFor("new") ? true : undefined}
                                        aria-describedby={`new-password-hint new-password-strength${errorFor("new") ? " new-password-error" : ""}`}
                                        className={inputClass(!!errorFor("new"))}
                                    />
                                    {errorFor("new") && (
                                        <p id="new-password-error" role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">
                                            {errorFor("new")}
                                        </p>
                                    )}
                                    <p id="new-password-hint" className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                        At least {MIN_PASSWORD_LENGTH} characters. Longer is
                                        stronger — a few unrelated words works well.
                                    </p>
                                    {newPassword && (
                                        <div className="mt-2 flex items-center gap-2" id="new-password-strength">
                                            <div className="flex flex-1 gap-1" aria-hidden>
                                                {[1, 2, 3, 4].map((i) => (
                                                    <span
                                                        key={i}
                                                        className={`h-1.5 flex-1 rounded-full ${
                                                            strength.score >= i
                                                                ? strengthColor
                                                                : "bg-zinc-200 dark:bg-zinc-700"
                                                        }`}
                                                    />
                                                ))}
                                            </div>
                                            <span className="text-xs text-zinc-600 dark:text-zinc-400 w-16 text-right">
                                                <span className="sr-only">Strength: </span>
                                                {strength.label}
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label
                                        htmlFor="confirm-password"
                                        className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                                    >
                                        Confirm new password
                                    </label>
                                    <input
                                        ref={confirmRef}
                                        id="confirm-password"
                                        type={showPasswords ? "text" : "password"}
                                        autoComplete="new-password"
                                        value={confirmPassword}
                                        onChange={edited(setConfirmPassword)}
                                        aria-invalid={errorFor("confirm") ? true : undefined}
                                        aria-describedby={errorFor("confirm") ? "confirm-password-error" : undefined}
                                        className={inputClass(!!errorFor("confirm"))}
                                    />
                                    {errorFor("confirm") && (
                                        <p id="confirm-password-error" role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">
                                            {errorFor("confirm")}
                                        </p>
                                    )}
                                </div>
                                <label className="flex min-h-9 items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
                                    <Checkbox checked={showPasswords} onChange={() => setShowPasswords(!showPasswords)} />
                                    Show passwords
                                </label>
                                <button
                                    type="submit"
                                    disabled={savingPassword}
                                    className="inline-flex min-h-10 items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                                >
                                    {savingPassword && <ButtonSpinner />}
                                    {hasPasswordIdentity ? "Update password" : "Set password"}
                                </button>
                            </form>
                        </section>
                        </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

/**
 * First-load placeholder for the two sections every account has: the linked
 * accounts list and the password form. Built to their real heights (60px
 * identity rows; the three-field "Change password" form, the common case) so
 * nothing below jumps when the reads land — the old centred spinner sat in a
 * 128px box that the ~600px page replaced. The "Linked accounts" heading is
 * static, so it renders for real; the password heading depends on whether a
 * password identity exists, so only its shape is drawn.
 */
function SecuritySkeleton() {
    return (
        <div aria-busy="true" className="space-y-8">
            <section className="space-y-4">
                <div>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                        <FontAwesomeIcon icon={faShieldHalved} className="text-zinc-400 text-base" aria-hidden />
                        Linked accounts
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        The sign-in methods currently connected to your account.
                    </p>
                </div>
                <SkeletonRows
                    rows={2}
                    label="Loading linked accounts"
                    rowClass="h-[60px]"
                    className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden"
                />
            </section>
            <section className="space-y-4" aria-hidden>
                <div>
                    <Skeleton className="h-7 w-44" />
                    <Skeleton className="mt-1 h-5 w-72 max-w-full bg-zinc-100 dark:bg-zinc-800/60" />
                </div>
                <div className="p-4 border border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 space-y-4 max-w-md">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="space-y-1">
                            <Skeleton className="h-5 w-32" />
                            <Skeleton className="h-10 w-full rounded-lg" />
                            {/* The new-password field carries a two-line hint. */}
                            {i === 1 && <Skeleton className="h-9 w-full bg-zinc-100 dark:bg-zinc-800/60" />}
                        </div>
                    ))}
                    <Skeleton className="h-9 w-36" />
                    <Skeleton className="h-10 w-36 rounded-lg" />
                </div>
            </section>
        </div>
    );
}
