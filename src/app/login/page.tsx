"use client";

import { useEffect, useState, Suspense, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEye, faEyeSlash } from "@fortawesome/free-solid-svg-icons";
import { reqLogin, reqGetSSOConfig } from "@/services/auth.service";
import { LastUsedBadge, SSOProviderButtons, ssoHref } from "@/components/sso-provider-buttons";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { FailureNote } from "@/components/FailureState";
import { ApiError, SSOProviderConfig } from "@/types/auth.types";
import { NEXT_PARAM, safeNextPath } from "@/tools/routing.tools";
import { reportWarn } from "@/services/monitor.service";
import {
  cancelSilentSSO,
  lastSignInMethod,
  rememberSignInMethod,
  silentSSOAllowed,
  startSilentSSO,
} from "@/tools/sso.tools";

// SSO login is a full-page redirect (the IdP round-trip and Set-Cookie happen on
// the API host), so it must target the backend directly, not the /api/monitor
// XHR proxy.
const API_BASE = (
  process.env.NEXT_PUBLIC_MONITOR_API_URL || ""
).replace(/\/+$/, "");

// The ?error= codes monitor-core's SSO callback redirects with.
// login_required is absent on purpose: it is the provider's "not signed in"
// answer to a silent attempt, the expected reason to be here.
const SSO_ERROR_MESSAGES: Record<string, string> = {
  sso_denied: "The sign-in request was denied by the provider.",
  sso_account_disabled: "Your account is disabled. Contact an administrator.",
  sso_provision_failed: "No account exists and auto-provisioning is off.",
  sso_state_invalid: "Your sign-in took too long or was started elsewhere. Please try again.",
  sso_missing_params: "Your sign-in took too long or was started elsewhere. Please try again.",
  sso_provider_unavailable: "The identity provider is unavailable. Try again shortly.",
  sso_exchange_failed: "The identity provider could not complete sign-in. Please try again.",
  sso_resolve_failed: "No account could be matched to this sign-in. Contact an administrator.",
  sso_session_failed: "Sign-in could not be completed. Please try again.",
};

// How long the page waits on the SSO config, or on a silent sign-in that has
// not left the page yet, before giving up on it and showing the form. Without
// a bound, a slow provider is a blank screen the user cannot get out of.
const SSO_WAIT_MS = 5_000;

const PASSWORD_METHOD = "password";
const ERROR_ID = "login-error";

/**
 * Written copy for a failed password sign-in. monitor-core answers every
 * wrong-email / wrong-password / no-password-set case with the same 401
 * "invalid credentials" (deliberately — it must not say which half was wrong),
 * so the status is what is mapped; its raw lowercase string is never shown.
 */
/** Storage has no change event worth following here: read, never subscribe. */
const noSubscribe = () => () => {};

/**
 * The loop guard, read ONCE per page load. startSilentSSO() writes the same key
 * just before navigating away; re-reading it on a later render would flip
 * skipSilent mid-attempt.
 */
let loopGuardAtLoad: boolean | null = null;
function readLoopGuardOnce(): boolean {
  if (loopGuardAtLoad === null) loopGuardAtLoad = !silentSSOAllowed();
  return loopGuardAtLoad;
}

function loginErrorMessage(res: ApiError, sso: "available" | "unknown" | "none"): string {
  if (res.status === 401) {
    if (sso === "available")
      return "Incorrect email or password. If you normally use single sign-on, use the button below instead.";
    // Config not loaded or failed: there may be no button to point at, but an
    // SSO-only account has no password either — say so rather than go quiet.
    if (sso === "unknown")
      return "Incorrect email or password. If you normally use single sign-on, its sign-in options are below once they load.";
    return "Incorrect email or password.";
  }
  if (res.status === 400) return "Enter your email and password.";
  if (res.status === 429) return "Too many attempts. Wait a minute, then try again.";
  if (res.status === 0) return "Monitor could not be reached. Check your connection and try again.";
  return "Monitor could not sign you in right now. Try again in a moment.";
}

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [providers, setProviders] = useState<SSOProviderConfig[]>([]);
  // Seeded from ?error= rather than set by an effect. An SSO failure arrives by
  // FULL-PAGE REDIRECT from the provider callback, so the component always
  // mounts fresh with the param already present — the effect this replaces could
  // only ever have fired on that same mount. A lazy initializer expresses that
  // without a synchronous setState inside an effect (react-hooks/set-state-in-effect),
  // which is a cascading render and, here, a redundant one.
  //
  // Kept apart from the password form's error on purpose: an SSO failure shown
  // between the Password field and Sign in reads as "your password was wrong".
  const [ssoError, setSsoError] = useState<string | null>(() => {
    const code = params.get("error");
    if (!code || code === "login_required") return null;
    return SSO_ERROR_MESSAGES[code] ?? "Sign-in failed. Please try again.";
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  // ⚠️ A failed /auth/sso/config is NOT "this install has no SSO". It used to
  // read that way: the section vanished, and the hints below dropped their
  // single-sign-on clauses, so an SSO-only user saw a password-only page with
  // no way in and no sign anything had failed. Kept in state so the SSO slot
  // shows the failure with a Retry instead.
  const [providersError, setProvidersError] = useState<string | null>(null);
  // Bumped by Retry. Only the FIRST load may lead to a silent SSO attempt or
  // the waiting shell; a retry happens with the form already on screen.
  const [ssoLoad, setSsoLoad] = useState(0);
  // Set when the page stops waiting on SSO: the user chose the password, or
  // SSO_WAIT_MS passed with nothing to show.
  const [gaveUpOnSSO, setGaveUpOnSSO] = useState(false);
  // Decided once, at mount: arriving with ?error= (a sign-in just failed, or
  // the provider said login_required) or ?signed_out=1 means no silent attempt,
  // and neither does one made in the last minute (loop guard).
  //
  // ⚠️ THE STORAGE READS GO THROUGH useSyncExternalStore, NEVER useState's
  // initialiser. The server has no sessionStorage (silentSSOAllowed() → false),
  // so a `useState(() => !silentSSOAllowed())` rendered the FORM on the server
  // and the WAITING CARD in a normal browser — a hydration mismatch (#418) on
  // nearly every visit. The server snapshot says "no guard, nothing remembered";
  // hydration renders that, then React re-renders with the browser's answer.
  const loopGuarded = useSyncExternalStore(noSubscribe, readLoopGuardOnce, () => false);
  // ⚠️ The URL half is FROZEN at mount (useState — the server has the same
  // params, so this one is hydration-safe). Read per render it was undone by
  // the effect below that strips ?error from the address bar: the next render
  // saw no ?error and started a silent attempt, hiding the error just shown.
  const [arrivedStopped] = useState(() => params.has("error") || params.has("signed_out"));
  const skipSilent = arrivedStopped || loopGuarded;
  const lastUsed = useSyncExternalStore(noSubscribe, lastSignInMethod, () => null);
  const next = safeNextPath(params.get(NEXT_PARAM));

  // The ?error= has been read into state; drop it from the address bar so a
  // reload (or a bookmark of this tab) does not show the same failure again.
  // `next` and anything else are kept. skipSilent was decided above, so a
  // reload still makes no silent attempt within the loop guard's minute.
  useEffect(() => {
    if (!params.has("error")) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    reqGetSSOConfig().then((res) => {
      if (cancelled) return;
      setProvidersLoaded(true);
      if (!res.success) {
        setProvidersError(res.error_message || "The request failed.");
        return;
      }
      // ⚠️ `.providers`, NOT the body itself. Assigning the envelope straight to
      // this state is what previously hid every SSO button: `providers.length`
      // read undefined off an object, the render guard went falsy, and the whole
      // section disappeared without an error anywhere. Array.isArray keeps a
      // future shape change loud instead of invisible.
      if (Array.isArray(res.data?.providers)) {
        setProviders(res.data.providers);
        setProvidersError(null);
        return;
      }
      setProvidersError("The sign-in options came back in an unexpected shape.");
      // A contract break monitor-core cannot see — it answered 200. Key NAMES
      // only, never the body.
      reportWarn("sso_config.load.failed", {
        expected: "{ providers: [...] }",
        got_type: Array.isArray(res.data) ? "array" : typeof res.data,
        got_keys:
          res.data && typeof res.data === "object"
            ? Object.keys(res.data).slice(0, 10).join(",")
            : undefined,
        outcome: "login page shows a failure note in place of the SSO buttons",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [ssoLoad]);

  const retrySSOConfig = () => {
    setProvidersLoaded(false);
    setProvidersError(null);
    setSsoLoad((n) => n + 1);
  };

  // Whether the account might sign in with SSO. While the config is loading or
  // has failed the answer is unknown, and the copy must not claim "no SSO" —
  // the hints that point an SSO user at the buttons stay in.
  const maybeSSO = providers.length > 0 || !providersLoaded || providersError !== null;

  // Silent SSO: with exactly one provider and nothing telling us not to, try a
  // prompt=none sign-in before showing the form. A user still signed in at the
  // identity provider comes straight back signed in; otherwise the provider
  // answers login_required and this page renders the form.
  const silentPossible = !skipSilent && !gaveUpOnSSO && ssoLoad === 0;
  const silentHref =
    silentPossible && providers.length === 1
      ? ssoHref(API_BASE, providers[0].login_url)
      : null;
  useEffect(() => {
    if (silentHref) startSilentSSO(silentHref, next);
  }, [silentHref, next]);

  // ⚠️ Wait on the config only while a silent attempt could still follow it.
  // On ?signed_out, ?error or inside the loop guard nothing will navigate away,
  // so a password user gets the form at once rather than up to SSO_WAIT_MS of
  // spinner; the SSO slot holds its space until the config lands.
  const waiting = silentPossible && (!providersLoaded || silentHref !== null);
  useEffect(() => {
    if (!waiting) return;
    // A provider that has not answered by now is not going to be quick; stop
    // the navigation and let the user in another way. The loop guard is
    // already set, so this does not retry.
    const timer = setTimeout(() => {
      if (silentHref) cancelSilentSSO();
      setGaveUpOnSSO(true);
    }, SSO_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting, silentHref]);

  const usePasswordInstead = () => {
    if (silentHref) cancelSilentSSO();
    setGaveUpOnSSO(true);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    // A new attempt supersedes the SSO failure the page arrived with.
    setSsoError(null);
    const res = await reqLogin(email, password);
    if (res.success) {
      rememberSignInMethod(PASSWORD_METHOD);
      // Honour the deep link the session check round-tripped through `next`, so
      // a pasted link into a specific issue survives being bounced through
      // login. safeNextPath is the open-redirect guard: `next` is an
      // attacker-supplied query parameter, so only a single-slash same-origin
      // path is ever followed. Anything else falls back to `/`, which resolves
      // to the user's zone.
      //
      // Full reload rather than a router push, so the cookie-driven AuthProvider
      // re-hydrates from scratch.
      window.location.href = next ?? "/";
      return;
    }
    setFormError(
      loginErrorMessage(res, providers.length > 0 ? "available" : maybeSSO ? "unknown" : "none"),
    );
    setSubmitting(false);
  };

  if (waiting) {
    const provider = silentHref ? providers[0].display_name.replace(/^(continue|sign in) with /i, "") : null;
    return (
      <Shell>
        <WaitingCard provider={provider}>
          {provider && (
            <button
              type="button"
              onClick={usePasswordInstead}
              className="cursor-pointer text-sm font-medium text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
            >
              Sign in another way
            </button>
          )}
        </WaitingCard>
      </Shell>
    );
  }

  const invalid = formError !== null;

  return (
    <Shell banner={ssoError && <ErrorAlert title="Single sign-on didn't finish" message={ssoError} />}>
      <div className="flex flex-col gap-5">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field
            id="email"
            label="Email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            invalid={invalid}
          />
          <Field
            id="password"
            label="Password"
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            invalid={invalid}
            labelAside={
              <button
                type="button"
                onClick={() => setShowRecovery((v) => !v)}
                aria-expanded={showRecovery}
                aria-controls="password-recovery"
                className="cursor-pointer text-xs font-medium text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
              >
                Forgot password?
              </button>
            }
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                className="cursor-pointer absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <FontAwesomeIcon icon={showPassword ? faEyeSlash : faEye} className="h-4 w-4" />
              </button>
            }
          />

          {showRecovery && (
            <p id="password-recovery" className="text-xs text-secondary -mt-2">
              Monitor has no self-service reset. Ask a Monitor administrator to reset your
              password{maybeSSO ? ", or sign in with single sign-on below" : ""}.
            </p>
          )}

          {formError && <ErrorAlert id={ERROR_ID} message={formError} />}

          <button
            type="submit"
            disabled={submitting}
            className="cursor-pointer flex items-center justify-center gap-2.5 bg-accent text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {submitting ? "Signing in…" : "Sign in"}
            {!submitting && lastUsed === PASSWORD_METHOD && providers.length > 0 && <LastUsedBadge />}
          </button>
        </form>

        {providersError ? (
          // DOWN is not EMPTY: the SSO slot says it could not ask, with a way
          // to ask again, rather than disappearing.
          <>
            <Divider />
            <div className="flex min-h-[42px] items-center justify-center text-center">
              <FailureNote
                what="single sign-on options"
                message={providersError}
                onRetry={retrySSOConfig}
              />
            </div>
          </>
        ) : !providersLoaded ? (
          // Reached only when no silent attempt is possible (see `waiting`):
          // the form is usable already; this holds one button's height.
          <>
            <Divider />
            <div aria-busy="true">
              <span className="sr-only">Loading single sign-on options</span>
              <Skeleton className="h-[42px] w-full rounded-lg" />
            </div>
          </>
        ) : providers.length > 0 ? (
          <>
            <Divider />
            <SSOProviderButtons
              providers={providers}
              apiURL={API_BASE}
              next={next}
              lastUsed={lastUsed}
              onSelect={rememberSignInMethod}
            />
          </>
        ) : null}
      </div>
    </Shell>
  );
}

// Sub-components

/** The card body while the page waits on SSO — also the Suspense fallback. */
function WaitingCard({ provider, children }: { provider: string | null; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center" aria-live="polite">
      <Spinner label={provider ? `Checking for a ${provider} session` : "Loading sign-in options"} />
      <p className="text-sm text-secondary">
        {provider ? `Checking for an existing ${provider} session…` : "Loading sign-in options…"}
      </p>
      {children}
    </div>
  );
}

/**
 * The shared Appleby Cloud login layout: brand row, bordered card, footer. The
 * footer is IN the flex column rather than absolutely positioned — pinned to
 * the viewport bottom it ran into the card on a 375×667 phone as soon as an
 * error made the card taller.
 */
function Shell({ banner, children }: { banner?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col items-center px-4 sm:px-8 bg-background">
      <div className="w-full max-w-sm flex flex-1 flex-col items-center justify-center py-8">
        <div className="flex items-center gap-3 mb-6">
          <Image
            src="/Monitor-Logo-Dark.svg"
            alt=""
            width={40}
            height={40}
            className="w-10 h-10 shadow-md rounded-xl"
            priority
          />
          <span className="text-xl font-semibold tracking-tight dark:text-white">
            Monitor
          </span>
          <span className="h-4 w-px bg-border-strong" />
          <span className="text-sm text-muted">
            Appleby Cloud
          </span>
        </div>

        {banner && <div className="w-full mb-4">{banner}</div>}

        <div className="w-full bg-surface rounded-xl p-6 shadow-sm border border-border">
          <h1 className="text-sm font-normal text-muted text-center mb-5">
            Sign in to continue
          </h1>
          {children}
        </div>
      </div>

      <footer className="pb-6 text-xs text-muted">
        <span suppressHydrationWarning>© {new Date().getFullYear()}</span> Appleby Cloud
      </footer>
    </main>
  );
}

function Field({
  id,
  label,
  type,
  placeholder,
  autoComplete,
  value,
  onChange,
  invalid,
  labelAside,
  trailing,
}: {
  id: string;
  label: string;
  type: string;
  placeholder: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  labelAside?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label
          htmlFor={id}
          className="text-sm font-medium text-secondary"
        >
          {label}
        </label>
        {labelAside}
      </div>
      <div className="relative">
        <input
          id={id}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? ERROR_ID : undefined}
          // text-base below sm: iOS Safari zooms the page into any input under 16px.
          className={[
            "w-full border bg-surface-elevated text-primary placeholder:text-muted rounded-lg px-3 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-shadow",
            invalid ? "border-red-500 dark:border-red-500" : "border-border-strong",
            trailing ? "pr-10" : "",
          ].join(" ")}
        />
        {trailing}
      </div>
    </div>
  );
}

// role="alert" so a screen reader announces it the moment it appears; the
// password form's alert is also what both inputs' aria-describedby point at.
function ErrorAlert({ id, title, message }: { id?: string; title?: string; message: string }) {
  return (
    <div
      id={id}
      role="alert"
      className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 dark:text-red-300 dark:bg-red-950 dark:border-red-800 rounded-lg p-3"
    >
      <svg
        className="w-4 h-4 mt-0.5 shrink-0"
        fill="currentColor"
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
          clipRule="evenodd"
        />
      </svg>
      <span>
        {title && <span className="block font-medium">{title}</span>}
        {message}
      </span>
    </div>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 h-px bg-border" />
      <span className="text-xs text-muted uppercase tracking-wide">
        or continue with
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}


export default function Page() {
  // useSearchParams requires a Suspense boundary during static generation. The
  // fallback is the branded shell, not null, so first paint is the card rather
  // than a blank page until hydration.
  return (
    <Suspense
      fallback={
        <Shell>
          <WaitingCard provider={null} />
        </Shell>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
