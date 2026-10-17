"use client";

import { ssoLoginHref } from "@/tools/sso.tools";
// Brand marks for `bundled:<slug>` icons. google, github, microsoft, gitlab and
// apple are Font Awesome Free brand icons (CC BY 4.0, https://fontawesome.com/license/free);
// okta and forta are plain marks drawn for this app. Each file says so itself.
//
// Imported, not referenced as "/sso/x.svg": an import is served from
// /_next/static/media, which proxy.ts lets through, whereas a raw /public path
// it has not allowlisted 302s a logged-out visitor — i.e. everyone on /login —
// to /login, and the icon silently becomes an HTML page.
import appleIcon from "../../public/sso/apple.svg";
import fortaIcon from "../../public/sso/forta.svg";
import githubIcon from "../../public/sso/github.svg";
import gitlabIcon from "../../public/sso/gitlab.svg";
import googleIcon from "../../public/sso/google.svg";
import microsoftIcon from "../../public/sso/microsoft.svg";
import oktaIcon from "../../public/sso/okta.svg";

/**
 * SSOProvider is one entry from `GET /auth/sso/config`.
 *
 * ⚠️ THE SHAPE IS SHARED across monitor-core, lattice-api and openbucket-api, and
 * this file is a deliberate per-app copy of the same component in lattice-web and
 * openbucket-web. Copying beats publishing a package here: the surface is small,
 * each app styles it in its own idiom, and a shared package would couple three
 * release cadences for ~150 lines. If a field changes, it changes in all three
 * APIs and all three copies.
 *
 * Every nullable field is nullable ON PURPOSE, and null is the DEFAULT rather
 * than an error: a provider with no branding renders a plain text button. That is
 * the state before an administrator configures an icon, and the state it returns
 * to when an icon fetch fails.
 */
export interface SSOProvider {
  name: string;
  display_name: string;
  display_icon: string | null;
  button_color: string | null;
  button_text_color: string | null;
  login_url: string;
  sort_order: number;
}

/**
 * ⚠️ THE THIRD COPY OF THIS CHECK — the API validates on write, again on render,
 * and now the browser validates what it received. Not redundancy for its own
 * sake: this value goes into a style, and a client that trusts whatever the
 * server sent inherits any hole in the server.
 */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function safeColor(c: string | null): string | undefined {
  return c && HEX_COLOR.test(c) ? c : undefined;
}

/**
 * ssoHref turns a provider's login_url into a safe absolute URL, or null.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THIS GUARD DID NOT EXIST ON THIS PAGE BEFORE. login_url was interpolated
 * straight into an href.
 *
 * It is rendered as a clickable anchor on an UNAUTHENTICATED page. Without the
 * check, `javascript:…` executes on click, and an absolute `https://evil.example`
 * is an open redirect wearing your own domain — a phishing lure that survives
 * scrutiny precisely because the page really is yours.
 *
 * The API computes login_url from the slug and never stores it, so this should be
 * unreachable. It is here anyway, because "should be unreachable" describes
 * today's server and this is the last line before a user's click.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function ssoHref(apiURL: string, loginURL: string): string | null {
  if (!loginURL.startsWith("/")) return null;
  // "//evil.example/x" also starts with a slash but is absolute to another
  // origin. Refused explicitly.
  if (loginURL.startsWith("//")) return null;
  return `${apiURL}${loginURL}`;
}

type StaticAsset = { src: string } | string;
const assetSrc = (a: StaticAsset) => (typeof a === "string" ? a : a.src);

/**
 * The bundled marks, keyed by the slug monitor-core emits as `bundled:<slug>`.
 * Must cover BUNDLED_ICONS in components/admin/sso/providerForm.ts (and the
 * server's allowlist): an option there with no asset here renders a text button.
 */
const BUNDLED_ICONS: Record<string, StaticAsset> = {
  apple: appleIcon,
  forta: fortaIcon,
  github: githubIcon,
  gitlab: gitlabIcon,
  google: googleIcon,
  microsoft: microsoftIcon,
  okta: oktaIcon,
};

const BUNDLED_PREFIX = "bundled:";

/**
 * The shipped asset for a `bundled:<slug>` display_icon, or null. The slug is an
 * opaque key looked up in a fixed table — never interpolated into a path — so
 * an unknown one simply has no icon.
 */
function bundledIconSrc(displayIcon: string | null): string | null {
  if (!displayIcon?.startsWith(BUNDLED_PREFIX)) return null;
  const slug = displayIcon.slice(BUNDLED_PREFIX.length);
  const asset = Object.hasOwn(BUNDLED_ICONS, slug) ? BUNDLED_ICONS[slug] : undefined;
  return asset ? assetSrc(asset) : null;
}

/** A cached icon served by the API, or null. */
function cachedIconSrc(apiURL: string, displayIcon: string | null): string | null {
  // Same-origin API paths only. This becomes an <img src>, and an absolute URL
  // would hot-link a third party from the login page — leaking every visitor's
  // IP, User-Agent and Referer to them.
  if (!displayIcon || !displayIcon.startsWith("/") || displayIcon.startsWith("//")) {
    return null;
  }
  return `${apiURL}${displayIcon}`;
}

export function SSOProviderButtons({
  providers,
  apiURL,
  next,
  lastUsed,
  onSelect,
}: {
  providers: SSOProvider[];
  apiURL: string;
  /** The deep link to return to after sign-in (sent as return_url). */
  next?: string | null;
  /** The provider this browser last signed in with; marked "Last used". */
  lastUsed?: string | null;
  /** Called with the provider's name as its button is followed. */
  onSelect?: (name: string) => void;
}) {
  const sorted = [...providers].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((p) => {
        const base = ssoHref(apiURL, p.login_url);
        if (!base) return null;
        const href = ssoLoginHref(base, { next });

        const bg = safeColor(p.button_color);
        const fg = safeColor(p.button_text_color);
        const imgSrc = cachedIconSrc(apiURL, p.display_icon);
        const markSrc = imgSrc ? null : bundledIconSrc(p.display_icon);

        return (
          <a
            key={p.name}
            href={href}
            onClick={() => onSelect?.(p.name)}
            // Colours are passed as STYLE VALUES, never built into a class string
            // or a stylesheet, so they stay data rather than becoming CSS source.
            style={bg || fg ? { backgroundColor: bg, color: fg } : undefined}
            className={[
              "cursor-pointer w-full flex items-center justify-center gap-2.5",
              "border border-zinc-300 dark:border-zinc-700 rounded-lg py-2.5",
              "text-sm font-medium transition-all",
              bg
                ? "hover:opacity-90"
                : "dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600",
            ].join(" ")}
          >
            {imgSrc && (
              // Served by our own API at an arbitrary path; next/image would need
              // a remote pattern for what is already a same-origin, size-capped,
              // re-encoded PNG.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imgSrc} alt="" aria-hidden="true" className="h-4 w-4 object-contain" />
            )}
            {markSrc && (
              // A monochrome mark drawn as a MASK filled with currentColor, so it
              // takes the button's own text colour: dark on the plain outline,
              // light in dark mode, and the configured text colour on a branded
              // fill. An <img> of a black SVG vanishes on two of those three.
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 bg-current"
                style={{
                  maskImage: `url("${markSrc}")`,
                  WebkitMaskImage: `url("${markSrc}")`,
                  maskSize: "contain",
                  WebkitMaskSize: "contain",
                  maskRepeat: "no-repeat",
                  WebkitMaskRepeat: "no-repeat",
                  maskPosition: "center",
                  WebkitMaskPosition: "center",
                }}
              />
            )}
            {p.display_name}
            {lastUsed === p.name && <LastUsedBadge />}
          </a>
        );
      })}
    </div>
  );
}

/**
 * The "you signed in this way last time" marker, shared by the SSO buttons and
 * the password button. Inherits its colour from the button it sits in, so it
 * reads on a branded fill, the accent fill and a plain outline alike.
 */
export function LastUsedBadge() {
  return (
    <span className="rounded-full border border-current/40 px-2 py-0.5 text-[11px] font-medium leading-none opacity-90">
      Last used
    </span>
  );
}
