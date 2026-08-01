"use client";

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
}: {
  providers: SSOProvider[];
  apiURL: string;
}) {
  const sorted = [...providers].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((p) => {
        const href = ssoHref(apiURL, p.login_url);
        if (!href) return null;

        const bg = safeColor(p.button_color);
        const fg = safeColor(p.button_text_color);
        const imgSrc = cachedIconSrc(apiURL, p.display_icon);

        return (
          <a
            key={p.name}
            href={href}
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
              // eslint-disable-next-line @next/next/no-img-element -- served by our
              // own API at an arbitrary path; next/image would need a remote
              // pattern for what is already a same-origin, size-capped, re-encoded
              // PNG.
              <img src={imgSrc} alt="" aria-hidden="true" className="h-4 w-4 object-contain" />
            )}
            {p.display_name}
          </a>
        );
      })}
    </div>
  );
}
