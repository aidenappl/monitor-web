# AGENTS.md — monitor-web

> The comprehensive working document for this repo. An agent that reads only this
> file should be able to work in monitor-web correctly. Keep it current — see
> **Keeping this file updated** at the bottom.

---

## 1. What this repo is

`monitor-web` is the **observability dashboard** for the Monitor platform
(`monitor.appleby.cloud`) — the Sentry/Datadog-style UI. It is a Next.js app that
renders event search, error/issue triage, performance, live tail, analytics,
dashboards, alerting, and notifications on top of the `monitor-core` API, and hosts the
platform's **native login + account/SSO management** UI.

It **owns**: all UI, the server-side proxy that attaches auth to `monitor-core` calls,
and the SSE bridge routes for live streaming. It **does not** own any data, business
logic, storage, or the auth backend — identity lives in `monitor-core` (accounts,
sessions, SSO); this app is a cookie-driven client of it.

---

## 2. Stack & dependencies

- **Next.js 16.4** (App Router, Turbopack) · **React 19.3** · **TypeScript** (`strict`).
  ⚠️ Not below Next 16.4 — see §5 "Hydration". `eslint-config-next` **16.4.2** brings
  `eslint-plugin-react-hooks` 7.1 and its React Compiler rules, enforced by `npm run lint`:
  no synchronous setState in an effect (derive it, reset it while rendering, or set it from a
  `.then` / event handler), no ref reads during render. ⚠️ The rule treats every setState in
  a `useCallback` called from an effect as synchronous, even after an `await` — so a fetch
  lives INSIDE its effect, re-run by a token that Retry/Refresh bump, and applies its answer
  from `.then` behind a cancel flag. `ApiKeysTab`, the alerts page and notification routing
  are the worked examples.
- **Tailwind CSS v4** (`@tailwindcss/postcss`). Dark/light theming via `ThemeProvider`
  (theme persisted in the `mon-appearance` cookie).
- **Auth (client):** local **Redux Toolkit** — `store/slices/authSlice` (`user`,
  `isLoggedIn`, `isLoading`, `error`) + a `context/AuthContext` `AuthProvider` that hydrates it.
  There is **no identity-provider SDK**. State is gated on the JS-readable `mon-logged-in`
  cookie; the real session JWT is validated server-side by `monitor-core`.
- **HTTP:** **ONE layer** — `axios` via `src/services/api.service.ts`, returning `ApiResult<T>`.
  There were two until 2026-08-09; see the warning box in §3. Do not add a second.
- **Secrets:** `@aidenappleby/keyring-js` — injects env at server startup via
  `src/instrumentation.ts`.
- **Self-telemetry:** `@aidenappleby/monitor-js` `^1.2.0` — this app's OWN errors and warnings
  go to Monitor's **appleby** zone as service `monitor-web`: from the browser through the
  same-origin `/api/telemetry` relay, from the server directly. See §6 "Monitor self-telemetry".
- **Icons:** Font Awesome **free** solid set (`@fortawesome/free-solid-svg-icons`,
  `@fortawesome/fontawesome-svg-core`, `@fortawesome/react-fontawesome`), all from the public
  npm registry. The private `@awesome.me` kit was dropped on 2026-10-16 so installs need no
  token — there is no `.npmrc`. Only solid icons are used; don't reintroduce a Pro/kit
  package without restoring the token plumbing in the Dockerfile and CI.
  ⚠️ **Font Awesome's CSS ships in the root stylesheet, not at runtime.** `app/layout.tsx`
  imports `@fortawesome/fontawesome-svg-core/styles.css`, and `autoAddCss = false` is set
  **twice** — in `app/layout.tsx` (server) and in `instrumentation-client.ts` (the browser
  bundle; the layout is a server module, so its assignment never reaches the client, which
  would otherwise inject a second copy after first paint). Left to the runtime, the
  `.svg-inline--fa` sizing rules arrived after hydration and every server-rendered icon
  painted at its intrinsic size (~600px wide) before the page shifted. The import is
  unlayered, exactly as the runtime injected it, so it still beats Tailwind's layered
  `h-*`/`w-*` utilities on icons — don't move it into a `@layer` without checking every icon.
- **Cookies (client reads):** `js-cookie`. **Toasts:** `react-hot-toast`.
- Path alias `@/*` → `./src/*`.

---

## 3. Project structure

```
src/
  app/
    layout.tsx              # Root layout: ThemeProvider → StoreProvider → AuthProvider → Navbar; the title template
                            # ("%s · Monitor"), Font Awesome's CSS, and the skip link ("Skip to content" → a
                            # <div id="content"> around {children} — pages keep their own <main>)
    **/layout.tsx (metadata-only)  # One per route segment, existing ONLY to set the document <title> (the pages are
                            # client components and cannot export metadata). See §5 "Page titles"
    not-found.tsx           # The 404, INSIDE the root layout. Two cases, read from the x-mon-pathname header proxy.ts sets:
                            # an UNKNOWN ZONE ("There is no zone called …", the slug-is-spent-forever reasoning behind a
                            # disclosure) vs an unknown PAGE in a real zone (links to that zone's Events/Issues/Alerts).
                            # Mounts <NotFoundMarker> so the navbar stops treating a bogus slug as a zone
    error.tsx               # Error boundary under the root layout (navbar survives) — reports client.error.boundary
    global-error.tsx        # Replaces the root layout when IT fails: own <html>/<body>, inline CSS — reports client.error.global
    page.tsx                # REDIRECT-ONLY resolver for bare / → the user's zone. Never 404s.
    [zone]/layout.tsx       # Server component: validates the zone against the registry, notFound() otherwise; mounts <ScopeBoundary> (in <Suspense>) around every zone page.
                            # generateMetadata: { absolute: "Events · {zone} · Monitor", template: "%s · Monitor" } — absolute+template, never a plain string
    [zone]/page.tsx         # Events (home) — table + chart + filters + saved views. ALL query state in the URL: range (preset or
                            # <fromISO>..<toISO>), from/to (brush zoom), level, service, name, q (the other chips as ONE nested
                            # query string), limit, offset, event (open detail panel: timestamp|service|name), refresh.
                            # A deep-link target — see §8 "Events/labels/data". Keys: / j k Enter Esc. Copy-link beside Saved Views
    [zone]/errors/page.tsx  # Issues list + board. ALL filters in the URL (status, view, service, q, has_pr, assignee, sort, order, page).
                            # Board fetches each column by its own status. Bulk → confirm → Undo toast (ids path). Keys: j k x Enter e i a
    [zone]/errors/[id]/page.tsx  # Issue detail — sparkline (7d/30d/90d), recent events (load more to 500, occurrence dialog), linked PRs,
                            # newest-first activity with filter + show older, comment composer (10,000-char cap), assignee (lazy
                            # picker for admins, "Assign to me" for editors), "Seen in" block. Content first in the DOM; the sidebar
                            # is order-first lg:order-none, so phones still see Status at the top
    [zone]/performance/page.tsx  # Latency (p50/p95/p99), throughput and error rate (level error|fatal) by event OR by route (data.path).
                            # ALL state in the URL (range, service, group, sort, dir, timed, compare, q, drill — drill is a history
                            # PUSH so Back closes it). Top 100 groups (asks for 101 to say "more exist"); the percentile, error and
                            # "timed" reads are then filtered to EXACTLY those groups ({field, operator:"in", value: keys}) so every
                            # column describes the same set. "Timed only" (?timed) filters the RANKING query (duration_ms gte 0), so
                            # the top 100 are timed groups, not untimed ones hidden afterwards. A missing percentile is null ("—"), never 0ms. Compare = same queries
                            # over the preceding equal window (disabled past 30-day retention). Phones get cards. Drill-down = stat
                            # strip + volume + p95 (fill_zeros:false → gaps), each chart failing on its own
    [zone]/live/page.tsx    # Live event tail via SSE. service/level/name/q/tz in the URL; a filter change prunes the buffer AND
                            # re-subscribes; Pause HOLDS frames ("Resume (N new)"); rows newest-first by EVENT time. See §6 "SSE"
    [zone]/analytics/page.tsx    # KPI row (events/errors with deltas, error rate, unique users), query bar (measure · field · group by · top N),
                            # two charts with Line/Area/Bar and Overlay/Stack/% views, drill-through Top-N lists (a row toggles an eq
                            # filter), CSV/JSON in each card header. Everything in the URL — see §5 "The analytics page"
    [zone]/dashboard/page.tsx    # Dashboard CRUD, "Manage dashboards" (rename/duplicate/bulk delete, export/import), widget editor
                            # (next/dynamic), template variables, per-widget size + range override, versioned saves with a 409
                            # conflict dialog. ?d=&range=&filters= mirror the view. See §8 "Dashboards"
    [zone]/alerts/page.tsx  # Alert-rule CRUD + duplicate, ?tab/?q/?state/?rule in the URL, bulk enable/disable/test/priority/delete,
                            # incident history, a routing preview that MIRRORS monitor-core's router (see §6 "Alert routing preview")
    [zone]/notifications/page.tsx  # Server redirect → /{zone}/settings/notifications, keeping every param (?project, ?tab)
    [zone]/settings/        # THE ZONE SETTINGS HUB (layout = ZoneSettingsFrame side nav). See §6 "Where settings live"
      page.tsx              # Server redirect → api-keys, keeping ?project
      api-keys/page.tsx     # API keys (create, rename, revoke, bulk revoke, last used, stale) — ApiKeysTab
      repos/page.tsx        # Service → GitHub repo mappings — ServiceReposTab
      notifications/page.tsx  # Notification routing: the four shared reads (policies, groups, channels, rules), the flow
                            # strip, ui/tabs bound to ?tab=. Each tab lives in components/notifications/
      zone/page.tsx         # Read-only: this zone's registry row (URLs, health) + its projects; admins link to the registry
    settings/               # THE ECOSYSTEM SETTINGS HUB (layout = EcosystemSettingsFrame side nav)
      page.tsx              # Server redirect → account; maps the old ?tab=account|preferences|ai|api-keys onto the routes
      account/page.tsx      # Who you are + links to sign-in & security and (remembered zone's) API keys
      preferences/page.tsx  # Date/time display (datetime.tools), per browser
      ai/page.tsx           # McpTab
      security/page.tsx     # Sign-in & security: link/unlink SSO identities (unlink confirms) + set/change password, with the
                            # 4011 step-up re-auth flow (see §6 Auth model)
      admin/sso/page.tsx    # Admin-only SSO provider list (login-page order) + create/edit dialog; FailureState on a failed read
      admin/users/page.tsx  # Admin-only user admin: approve pending SSO accounts, change roles (CONFIRMED + toast with Undo), remove
                            # role (→ pending), block/allow sign-in — singly or in bulk. ?role= and ?q= in the URL; cards below lg
      admin/registry/page.tsx  # Admin-only tenancy registry: zones + their projects, probe-to-verify, retire (never delete), Connect snippets
                            # (old /admin/* page URLs 307 here via next.config.ts redirects())
    login/page.tsx          # Native email/password form + per-provider SSO buttons; silent-SSO shell with a "Sign in another way" escape
    unauthorized/page.tsx   # 403 landing (error_code 4003). Names the signed-in account; "Sign out and use another account"
    pending/page.tsx        # Parked-account landing (error_code 4004). Names the account, re-checks approval every 30 s — see §6
    api/
      monitor/[...path]/route.ts  # Main proxy → ${UPSTREAM}/* (forwards cookies + X-CSRF-Token, relays Set-Cookie)
      monitor-stream/route.ts     # SSE bridge → ${UPSTREAM}/v1/events/stream
      alert-stream/route.ts       # SSE bridge → ${UPSTREAM}/v1/alerts/stream
      health/route.ts             # GET /api/health → {status:"ok"}
      telemetry/route.ts          # POST /api/telemetry → same-origin relay for this app's OWN browser telemetry; adds MON_TELEMETRY_API_KEY server-side. NOT the upstream proxy
  services/
    api.service.ts          # THE HTTP client: axios fetchApi<T>(config) → ApiResult<T> (CSRF, ?project, 401-refresh, 403 routing) + dataOf/firstError
    api.ts                  # Query + admin surface, built on api.service.ts. No transport of its own. Later additions are grouped
                            # under `// ── <surface> ──` banners (notifications, dashboard, account, global-chrome)
    auth.service.ts         # req* for /auth/* (login, register, refresh, logout, self, identities, sso/config)
    admin.service.ts        # req* for /admin/sso-providers CRUD and /admin/users (reqListUsers, reqUpdateUser) (the registry writes live in api.ts, next to its reads)
    registry.server.ts      # SERVER-ONLY zone lookup for [zone]/layout.tsx and the / resolver. Not a second client. zoneRoute() also says WHY a zone is unroutable
    monitor.service.ts      # BROWSER self-telemetry: Monitor → /api/telemetry, attachMonitor(axios) (transport failures only), reportError/reportWarn
  tools/
    routing.tools.ts        # Pure route/scope helpers — zone segment, project param, ?next round-trip,
                            # the TWO predicates (routesToZone vs isZoneScopedPath), publishScope/readScope
    stream.tools.ts         # MAX_STREAM_ATTEMPTS + probeStreamRefusal() — how an SSE refusal becomes visible
    session.tools.ts        # refreshSession() — the ONE refresh single-flight — endSession(), and clearLoggedInFlag()
                            # (removes mon-logged-in host-only AND on every parent domain — see §6 Auth model)
    sso.tools.ts            # silent SSO (prompt=none) on /login, its loop guard, cancelSilentSSO(), SSO login hrefs with return_url,
                            # the "last used" hint (rememberSignInMethod/lastSignInMethod → localStorage mon-last-sign-in)
    telemetry.tools.ts      # Pure self-telemetry helpers: MONITOR_SERVICE, describeError, normalisePath (fingerprint-safe), createCoalescer, isTimeoutError, hostOf
    timeRange.tools.ts      # TIME_RANGES + getTimeRange; relativeFrom (resolve a window spec at request time)
                            # and suggestionWindow/SUGGESTION_WINDOWS (7d labels, 24h data keys/values);
                            # withSelected (a windowed <select> always lists its own value). See §8.
                            # Custom absolute ranges: isCustomRange, customRange, rangeToParam/rangeFromParam (the URL
                            # form), rangeDurationMs, previousPeriodBeyondRetention, EVENT_RETENTION_DAYS, intervalMs
    export.tools.ts         # exportToCSV/JSON(data, filename, { meta }) → boolean (toasts and returns false on an empty
                            # array); seriesExportRows, analyticsExportMeta, exportFilename
    clipboard.tools.ts      # copyText(text, {label}) — Clipboard API → execCommand fallback, toast on success AND failure,
                            # returns boolean. The ONLY way to copy; see §5 "Clipboard"
    datetime.tools.ts       # Date/time display prefs (timezone local/UTC/IANA, readable vs ISO, 12/24h) in localStorage
                            # mon-datetime-prefs; useDateTimePrefs() + formatDateTime(value, prefs, {dateOnly}). Adopt it
                            # anywhere a timestamp is shown. SSR/first render uses the defaults
    cache.tools.ts          # cachedRead — 90 s in-browser cache for the three suggestion reads ONLY. See §8
    bulk.tools.ts           # runBulk (bounded-concurrency fan-out, collects every outcome) + toastBulkResult. NOT for issues — see §5 "Bulk actions"
    issue.tools.ts          # issueTitle(): message, else the route for a bare http.request.end, else the name
  store/
    index.ts hooks.ts StoreProvider.tsx slices/authSlice.ts   # Redux (useAuth, useAppSelector/Dispatch)
  context/AuthContext.tsx   # AuthProvider — hydrates authSlice from mon-logged-in + reqGetSelf ONCE per mount (per-navigation
                            # cookie / public-path / pending checks make no request); logout(). See §5
  context/RememberedZoneContext.tsx  # The last zone visited (written by ScopeBoundary + mon-zone); what zone links use on /settings/*. See §6
  types/
    index.ts                # ApiResponse<T> + dashboard domain types
    auth.types.ts           # User, Identity, SSOProviderConfig, AdminSSOProvider, SSOProviderPayload, ApiResult<T>
  components/               # Navbar (user menu), ThemeProvider, and admin/analytics/dashboard/settings groups
    ScopeBoundary.tsx       # ⚠️ Keys its provider on `{zone}::{project}`, so a scope change REMOUNTS every zone page. The only reason a project switch refetches anything. See §6
    ScopeSwitcher.tsx       # The zone + project control in the navbar. Hand-built menu; renders null on the zone-agnostic pages.
                            # Exports zoneSwitchHref/projectSwitchHref/rememberZone/projectLabelOf so the palette applies identical rules
    HealthStatus.tsx        # The navbar pill. Reads its own zone from the path — it sits OUTSIDE ScopeBoundary — and names it in the label. Click → labelled details popover (accepted/pending/dropped/stores).
                            # Polls 10 s while healthy, 30 s then 60 s while failing, not at all while the tab is hidden (usePageVisible)
    Navbar.tsx              # Nav, the phone sheet, every popover (useDismissable), the global keys (Mod+K, ?, g-sequences),
                            # and NotFoundMarker. Zoned links + the logo are prefetch={false} (navPrefetch, §8). See "Navigation" below
    CommandPalette.tsx      # ⌘K / Ctrl+K: go to any page, switch zone/project (via ScopeSwitcher's hrefs), open an issue by UUID or
                            # pasted issue URL (the URL's own zone wins), toggle theme, open shortcut help. NO backend search. On ui/modal
    ShortcutHelp.tsx        # The "?" overlay. Global group from the Navbar; pages register THEIR keys with useRegisterShortcuts — §5
    AutoRefresh.tsx         # Shared by events/dashboard/analytics. Optional controlled interval/onIntervalChange, paused, and
                            # minSeconds (shortest interval offered; one below the floor reads as Off). role=menu + menuitemradio.
                            # Skips a tick while `loading` (in flight); stops while hidden, refreshes once on return — §5
    EventTable.tsx          # No inline expansion — each row is a named "Open event … at …" button (data-event-row). Exports
                            # formatEventTimestamp(ts, prefs, {ms}). The loading placeholder shows only when there are no rows yet.
                            # Renders ONE layout (useMediaQuery(MD_UP, true)): the table from md, cards below
    EventTimeRangeChart.tsx # Takes from/to/zoomed/onZoom/onZoomReset — it no longer computes its own window
    EventDetailPanel.tsx    # Focus moves in on open, Tab is trapped, focus returns on close; prev/next, Copy link, filter-by-id
    QueryInput.tsx          # Chip search; chipProblem() refuses malformed filters inline (role=alert). Ordering ops only for data.*
    sso-provider-buttons.tsx  # The login page's SSO buttons (also the admin preview). Draws bundled:<slug> marks — see §6 Auth model
    admin/ZoneHealth.tsx    # Reachability chip + panel. `mismatched` is the loudest state on the page — see §6. A `healthy` older than 24h renders stale (amber)
    admin/ZoneFormModal.tsx # Record/edit a zone, then probe it. Two steps; branches on whether the ROW exists, not on how it opened
    admin/ProjectFormModal.tsx  # Create/rename a project inside one zone. No probe step — a project has no second box to point at
    admin/RetireDialog.tsx  # The retirement confirmation. Says what is spent (the slug, forever) and what is NOT done (no teardown; ingestion continues)
    FailureState.tsx        # FailureState (block) + FailureNote (inline) — the "DOWN is not EMPTY" vocabulary. See §5.
    ConfirmProvider.tsx     # useConfirm(): promise-based confirm dialog on ui/modal (destructive + type-to-confirm). Mounted in the root layout. NEVER window.confirm
    BulkActionBar.tsx       # The floating "N selected" bar every bulk-capable list uses
    admin/sso/
      providerForm.ts       # Pure model for the SSO provider form: ProviderForm, emptyForm (enabled:false), presets, BUNDLED_ICONS,
                            # validateForm, buildPayload, contrastRatio, callbackURL
      ProviderFormModal.tsx # Create/edit dialog on ui/modal: presets, redirect URI + copy, per-field errors, discard-confirm when dirty
      LoginButtonPreview.tsx  # Live preview using the login page's own SSOProviderButtons (inert); draft among enabled providers in order
      ProviderRow.tsx       # One provider row (cached icon or monogram, badges, labelled Edit/Delete); byLoginOrder
    admin/users/
      roles.ts              # ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, PERMISSIONS matrix, isDemotion — mirrors monitor-core's role_gate.go + RequireAdmin
      RoleHelp.tsx          # "What can each role do?" popover (the permission matrix); compact icon variant for the Role header
    alerts/
      alerts.tools.ts       # Pure: previewRouting (MIRRORS monitor-core's router — see §6), durations, filter parsing, groupIncidents
      RuleFormModal.tsx     # Create/edit rule: AnalyticsFilters builder + "Edit as JSON", duration+unit inputs, inline validation,
                            # fallback channels, routing preview
      RuleRow.tsx           # One rule row: filters/hold/cooldown, last fired/notified, routing line, phone-width ⋯ menu
      AlertHistoryTab.tsx   # History grouped into firing→resolved incidents with durations; deleted rules still filterable
      useNow.ts             # Ticking clock for relative times (keeps render pure)
    analytics/
      TimeSeriesChart.tsx   # Multi-series SVG chart. null/absent buckets are GAPS, never 0 (§5 "Charts"). variant line|area|bar, stacked,
                            # nice ticks, formatValue, log scale, partial-bucket marking, keyboard tooltip + role=img summary + sr-only
                            # table, opt-in drag-to-zoom (onBrush). Exports formatDurationMs, formatCompactNumber, niceTicks
      CardHeader.tsx        # The ONE header every analytics card uses (Gauge, Compare, TopN, TimeSeriesChart, TimeSeriesTable);
                            # every card takes `actions?: ReactNode` into it
      TimeRangePicker.tsx   # Preset buttons (aria-pressed) + "Custom…" popover with two datetime-local inputs
      AnalyticsFilters.tsx  # Labelled add/edit form; Escape closes; "Data field…" (data.* keys + value suggestions, < ≤ > ≥ numeric);
                            # chips: human labels, click to edit, = / ≠ toggle, Clear all
      CompareCard.tsx       # previous === 0 (or previousUnavailable) reads "—" + "No data for the previous period"
      TopNList.tsx          # `total` → % is share of the TOTAL (no total, no %). onSelect/isActive make rows aria-pressed drill toggles
    dashboard/
      dashboard.tools.ts    # DashboardWidget (WidgetConfig + size + range_override), DashboardConfig, VersionedDashboard,
                            # sizeClass/defaultSize, widgetRange, exportDashboard/parseDashboardImport (kind monitor.dashboard, v1)
      WidgetEditor.tsx      # On ui/modal, loaded through next/dynamic. Sends `in` values as arrays
    issue/
      IssueEventDetail.tsx  # StackBlock (library frames folded), EventPayload (tag table), EventDrawer (occurrence dialog, Latest/Newer/
                            # Older/Oldest + ←/→, trace events on demand), distinguishingKeys/eventTags/tagValue/formatEventTime
      eventsHref.ts         # eventsHref({service,name,level,from,to}) → zone-relative tail of a pre-filtered Events link; windowAround()
    live/
      live.tools.ts         # Pure: LiveEvent (id minted on receipt = row key), normaliseLevel/levelBadgeClass, mergeNewestFirst
                            # (time-ordered, capped at MAX_BUFFER), matchesStreamFilters, parseSearch/matchSearch, createRateTracker
      LiveEventRow.tsx      # One row: disclosure <button aria-expanded>, pin button; expanded = View in Events / Open trace / Copy JSON
      RateMeter.tsx         # events/s (10 s avg) + 60 s sparkline stacked by level; own 1 s tick
    notifications/          # The Notification Center, split per tab (was one 2270-line page)
      PoliciesTab.tsx ServiceGroupsTab.tsx ChannelsTab.tsx DesktopTab.tsx
      PolicyFormModal.tsx ServiceGroupFormModal.tsx ChannelFormModal.tsx
      FormFooter.tsx        # Sticky Cancel / Create|Save row shared by the three dialogs
      FlowSummary.tsx       # "N rules → N policies → N channels" + unrouted rules / unused channels. A failed read shows "?", never 0
      PolicySkeleton.tsx    # The policy pipeline's placeholder cards, built on ui/skeleton
      notifications.helpers.ts  # rulesMatchingPolicy, getRulesMatchingPolicy → {active, disabled}, formToMatchers, parseServicesList, computeRoutingFlow
    settings/SettingsShell.tsx  # The frame both settings hubs share: section nav (pill row on phones) + the page's <main>
    settings/SettingsNav.tsx    # ZoneSettingsFrame / EcosystemSettingsFrame: each hub's sections; admin group only for admins
    settings/ApiKeysTab.tsx # API keys on /{zone}/settings/api-keys — see §6 "Where settings live"
    settings/McpTab.tsx     # AI integration. ⚠️ MCP_TOOLS is GENERATED from the published monitor-mcp package — never hand-edit (§5)
    settings/ServiceReposTab.tsx  # Service → GitHub repo mapping CRUD + bulk remove, on /{zone}/settings/repos
    ui/                     # Shared primitives ported from lattice-web — button, input, alert,
                            # badge (+ info variant, pill), modal, switch — plus checkbox (indeterminate,
                            # shift-click aware), tabs and segmented. See "The shared design-token layer" below.
                            # spinner.tsx (Spinner w/ delay, ButtonSpinner, RefetchBar, LoadingBlock) and
                            # skeleton.tsx (Skeleton, SkeletonRows/Table/Cards) are THE loading set — §5 "Loading states"
  lib/utils.ts              # cn() — dependency-free class joiner
  lib/monitor-server.ts     # SERVER self-telemetry: lazy Monitor from MON_TELEMETRY_* (no process handlers), serverError/serverWarn (coalesced), reportServerError (onRequestError)
  hooks/useDesktopNotifications.ts   # Desktop notification bridge over alert-stream SSE; per-browser prefs; useDesktopNotifications(priorityOf?)
  hooks/useUrlState.ts      # Page state in the query string: filters, tabs, offsets. Codecs urlString/urlInt/urlBool/urlEnum/urlCsv.
                            # Keeps every other param (incl. ?project); omits defaults; writes via history.replaceState/pushState
                            # (no RSC round trip). THROWS for "project"/"zone" — those are the scope. See §5 "URL state"
  hooks/useScope.ts         # {zone, project, scopeKey} from ScopeBoundary. THROWS outside it. The only sanctioned way to read the project on a zone page
  hooks/useZoneHref.ts      # Builds intra-app links that keep the zone AND the project selection
  hooks/useRole.ts          # {role, canWrite, isAdmin} — hides write controls from viewers (presentation; the API enforces)
  hooks/useSelection.ts     # Row selection for bulk bars: shift-click ranges, select-all, auto-prunes ids no longer visible
  hooks/useDiscardGuard.ts  # Wraps a form dialog's onClose: a dirty form asks "Discard changes?" first (§5)
  hooks/useHydrated.ts      # False on the server + during hydration. Gate browser-timezone/locale text on it (§5 "Hydration")
  hooks/usePageVisible.ts   # Tab visibility (useSyncExternalStore on visibilitychange; server = visible). Gate every background poll on it — §5
  hooks/useMediaQuery.ts    # matchMedia as state (+ MD_UP = Tailwind's md; server = the given default). Render ONE layout, not two hidden by CSS
  proxy.ts                  # Next.js proxy — gates page navigation on the mon-logged-in cookie; forwards a confirmed session
                            # off /login; redirects legacy flat URLs; sets the x-mon-pathname request header
  instrumentation.ts        # Keyring env injection at server boot (a failure → keyring.inject.failed + console.error) and onRequestError → Monitor
  instrumentation-client.ts # Creates the browser Monitor before hydration (deliberately NO pageview/navigation events) and turns
                            # off Font Awesome's runtime CSS injection in the browser bundle (§2)
public/
  sso/*.svg                 # Monochrome marks for bundled:<slug> SSO icons (google, github, microsoft, gitlab, apple from Font
                            # Awesome Free brands, CC BY 4.0; okta, forta drawn here). Each file carries its licence comment
scripts/
  guards.mjs                # Dependency-free static guards run by `npm run lint`. Three recurrence checks; see §5
```

### The shared design-token layer and `components/ui/`

`globals.css` carries a token layer **ported from lattice-web** so the SSO surfaces across
monitor-web, lattice-web and openbucket-web are one design language rather than three. Surface,
border, text, semantic-accent and radius families are defined as CSS custom properties and bridged
into Tailwind utilities through `@theme inline` — `bg-surface`, `text-secondary`,
`border-border-strong`, `text-healthy` and so on.

**⚠️ THE POLARITY IS THE OPPOSITE OF LATTICE-WEB'S, DELIBERATELY.** lattice-web is dark-first: it
defines dark values in `:root` and light in `:root:not(.dark)`. This app is light-first and every
existing page is written as `bg-white dark:bg-zinc-900`. So the same token NAMES carry light values
in `:root` and dark values in `.dark`. Components written against the tokens are portable between
the apps unchanged — which is the point — while pages written against zinc utilities are untouched.
**Do not "fix" this to match lattice.** Flipping it inverts the entire dashboard.

`src/components/ui/` holds the ported primitives: `button`, `input`, `alert`, `badge`, `modal`,
`switch`, and this app's own `checkbox`, `tabs`, `segmented` (§5 "Tabs and segmented
controls"), `spinner` and `skeleton` (§5 "Loading states"). `src/lib/utils.ts` has a dependency-free `cn()` — deliberately not clsx + tailwind-merge,
because the primitives put `className` last in every `cn(...)` call, so a caller's utility already
wins without a merge step.

Two things differ from lattice's originals on purpose:

- `Button`'s `primary` variant is the accent fill, not `bg-white text-black`. White-on-white is
  invisible in a light-first app.
- `Input` generates an `id` when none is passed (lattice's renders `htmlFor={undefined}`, a label
  bound to nothing) and wires `aria-invalid` + `aria-describedby` for its error. It is
  `text-base sm:text-sm`: below 16px iOS Safari zooms the page on focus. Hand-built inputs should
  do the same.

`Badge` adds an `info` variant and a `pill` style (tinted rounded chip) — variants are `default |
success | warning | error | info`. Never override a Badge's colour with `className`; add a variant.

**Light-mode contrast.** `html:not(.dark)` lifts `--color-zinc-400` to `#73737c` (4.5:1 on
zinc-50; it was 2.5 and is the de-emphasised metadata colour on ~130 sites) and `--color-zinc-500`
to `#65656e` (5.3:1 on zinc-100; was 4.4) — the light half of the existing `html.dark` zinc-500
override, keeping 400 < 500 < 600. In the token layer `--text-muted` is `#63636b` and
`--text-dimmed` `#73737c` (it was 2.6:1 and carries text on the login page). The polarity above is
unchanged.

**Scope is bounded on purpose.** The token layer and primitives exist app-wide; only the
**admin pages (SSO, users, registry), login, `/pending` and `/unauthorized`** are converted to
the tokens (the `ui/` primitives themselves are used more widely). Other pages keep working on their current classes
and get converted opportunistically. A full restyle of the dashboard is separate work, not
something to smuggle into an auth change.

Navigation (`components/Navbar.tsx`): primary = Events, **Issues** (the path stays
`/errors`; the label matches the page's H1 and title), Performance, Live, Analytics;
secondary = Dashboard, Alerts, **Zone settings** (`/{zone}/settings/*`) and
**Account** (`/settings/*`). Notification routing is inside zone settings, so it has no nav entry
of its own, but `g n` and ⌘K still reach it (`jumpOnlyItems`). The inline nav shows from **`lg`** (it overflowed into the right
cluster at 768px); the secondary group is inline only from `2xl` and otherwise folds into a
"More" menu that names the active page — inline, "Settings" ran under the health pill at
1280px. Nav destinations are stored as **zone-relative tails** (`""`, `"/errors"`) with a
`zoned` flag, and are resolved against the zone in the current URL at render time —
`Account` is the one `zoned: false` entry. On the zone-agnostic pages the navbar, and every
`useZoneHref` link, falls back to the **remembered zone** (`useRememberedZone()`), then
`FALLBACK_ZONE`. See *The remembered zone* in §6.

Below `lg` the hamburger opens a **sheet portalled to `<body>`**. ⚠️ The header's
`backdrop-filter` makes it the containing block for `position: fixed` children, so anything
"fixed" rendered inside `<header>` is clipped to the header — the same reason the palette and
help dialogs render as siblings of `<header>`, not children. The sheet closes on backdrop tap
and Escape (focus returns to the hamburger), keeps Tab inside, locks body scroll, marks links
`aria-current`, and gives admins an **Admin** group (SSO Providers, Users, Zones & Projects —
the same `adminItems` the avatar menu uses). Every popover (theme, More, user, scope, health)
closes on outside-click AND Escape and returns focus to its trigger (`useDismissable`); the
theme/user/More menus are `role="menu"` with arrow/Home/End.

**404 awareness.** `app/not-found.tsx` mounts `NotFoundMarker` (exported from `Navbar.tsx`; a
tiny external store, because the 404 renders *below* the Navbar). On any 404 no nav item is
active. On an unknown-zone 404 the path's first segment is treated as no zone: the switcher
becomes a zones-only "Choose a zone" picker, the health pill is not rendered (it used to
report "nozone offline" and poll it), and nav links fall back to the remembered zone.

**Keyboard.** Bound in the Navbar: Mod+K palette, `?` help, `g` then
e/i/p/l/y/d/a/n/s (Events, Issues, Performance, Live, anal**y**tics, Dashboard, Alerts,
Notifications, zone Settings). The hotkey is a field on the `NavItem`, so the help sheet and
the binding share one table. Ignored while focus is in an input/textarea/select/contentEditable,
with Ctrl/Alt/Meta held, or with any `aria-modal` dialog open — Mod+K excepted, since it is a
chord nothing types. From `lg` a search button also opens the palette.

`components/ScopeSwitcher.tsx` sits in the navbar's left block, between the logo and
the nav, because it qualifies every destination to its right. It is hand-built — a
button, a `role="menu"` panel, `menuitemradio` rows, arrow/Home/End/Enter/Escape,
outside-click close — and it lists **two groups in one control**: the zones, then the
projects inside the current one. Registry reads are **lazy, on first open**; the trigger
renders the slugs straight off the URL, so it is correct before any request lands. A
failed read shows the error and a retry inside the panel, never an empty list. It reads
the zone from the **path only**, with no `rememberedZone` fallback, so it renders `null`
on `/settings/*` — a scope control on a page that ignores scope is a lie
about what the page shows. Below `sm` the header copy is hidden and the mobile menu
carries its own.

The trigger shows **slugs, never display names** — it used to upgrade "appleby" to "Appleby"
once the lazy registry read landed, so the scope appeared to change when the menu opened. The
unset project row is labelled "Default project" in both the trigger and the menu, with
"Resolves to <name>" as its hint. When the menu opens it probes each zone's `/health`
(`getZoneHealth(zone)` in `api.ts`: explicit `?zone`, 2.5 s timeout, in parallel, never
blocking the menu) and marks a zone that is down with a dot and the word "offline" — picking an
offline zone used to be the only way to find out. A footer row links **Zone settings & API
keys** for the current zone/project. `zoneSwitchHref`, `projectSwitchHref`, `rememberZone` and
`projectLabelOf` are exported so `CommandPalette` applies identical scope rules.

`HealthStatus` polls every 10 s while healthy, **30 s then 60 s while failing**, and not at all
while the tab is hidden (`usePageVisible`; resuming immediately on visibility). The reset (`[zone]`)
and the poll (`[zone, visible]`) are separate effects, so a refocus refreshes in place rather
than flashing "Connecting…". The dot is a ≥36×36 target below
`xl`; the text label shows from `xl`.

The user menu shows the user's role, links `/settings/security` (Sign-in & security) and — for
`role==="admin"` — `/settings/admin/sso` (SSO Providers), `/settings/admin/users` (Users),
`/settings/admin/registry` (Zones & Projects), and calls `logout()`.

> The `/pending` route (for freshly SSO-provisioned accounts awaiting approval, 403
> `error_code 4004`) lives at `src/app/pending/page.tsx`; see §6 Auth model for what it does.

---

## 4. Running, building & testing

Uses the `dev` CLI (`Devfile.yaml`). Prerequisites: Node 20+, `npm ci`, and (for
cookie-based auth locally) mkcert HTTPS on `*.local.appleby.cloud`.

```bash
dev dev           # HTTPS dev server (node server.js / npm run dev:ssl) — needed for cookies
dev dev-http      # plain HTTP dev (Secure cookies won't be set)
dev build         # next build
dev lint          # eslint + the static guards (npm run lint → `eslint && npm run guards`)
dev typecheck     # tsc --noEmit
dev check         # lint + prettier check + typecheck
```

> ⚠️ **`npm run lint` runs `scripts/guards.mjs` as well as ESLint**, and a guard violation
> exits non-zero exactly like a lint error. `npm run guards` runs them alone. They are
> plain Node with no dependencies — there is **no test framework in this repo and none is
> being added**; these checks are about the SHAPE of the source, which a runtime test
> could not see anyway. Each check carries the bug it prevents in a comment above it. See §5.

> ⚠️ **`npm ci` before building.** `node_modules/` is not committed and `next build`/`tsc`
> fail with a misleading "couldn't find next/package.json" error when deps are absent. A
> stale `.next/` may exist from a prior build; don't trust it as verification.


Local dev must be HTTPS (`dev dev`) so the `mon-*` cookies (Secure) are set/sent. The app
proxies to a running `monitor-core` at `NEXT_PUBLIC_MONITOR_API_URL` (default
`http://localhost:8080`).

---

## 5. How code is written here

There is **ONE HTTP layer**: `src/services/api.service.ts`.

`fetchApi<T>(config: AxiosRequestConfig): Promise<ApiResult<T>>` — axios, `baseURL:
"/api/monitor"`, `withCredentials`, `validateStatus: () => true`. It:

- attaches `X-CSRF-Token` (from the JS-readable `mon-csrf` cookie) on every unsafe method —
  the double-submit half the server checks. Several `/v1` query endpoints are POST-with-body
  **reads**, so this is not optional;
- on `401`, runs `refreshSession()` — the **shared** single-flight in `tools/session.tools.ts` —
  and retries once; on failure calls `endSession()`;
- on `403` redirects by `error_code`: `4003` → `/unauthorized`, `4004` → `/pending`.

Consumers: `services/api.ts` (query + admin surface), `services/auth.service.ts`,
`services/admin.service.ts`. Add endpoints to the relevant service file, never a new transport.

⚠️ **`refreshSession` must stay a module-level singleton.** monitor-core rotates refresh tokens
with **reuse detection** — presenting a spent token more than 30s after rotation revokes the
whole family — and a page load fires many requests at once. A singleton per client is not a
singleton, which is exactly how the two-client era failed. Across tabs, the refresh runs under
the `mon-refresh` Web Lock and skips the network if another tab refreshed in the last 10s
(`mon-refreshed-at` in localStorage); monitor-core's grace window covers what the lock cannot
(lost responses, other browsers).

⚠️ **Nothing throws on a non-2xx**, so a `catch` around an API call is dead for HTTP errors.
Check `success` explicitly wherever a failure must be visible. Helpers: `dataOf(res)` for reads
with an empty fallback, `firstError(...)` for `Promise.all` batches.

### DOWN must never render as EMPTY

**An empty result and a failed request are different facts, and they must look different.**
This is the direct consequence of `validateStatus: () => true`: `res.success ? res.data : []`
launders a 500 into a tidy "nothing here", and every `catch` around it is dead code. Commit
`c68b6c4` recorded the cost — on the errors page, "no issues" is the most misleading possible
reading of a 500. The project selector makes it routine rather than rare: *"this project has no
services"* and *"scoping is broken"* are the same empty dropdown unless something says otherwise.

The rules:

- Every call site that consumes a `req*`/`get*` function **branches on `success`**. A fetch
  whose failure is invisible is a bug, not a simplification.
- The failure state **replaces** the empty state — same branch of the same ternary, never
  stacked above it. A banner over "No alert rules" asserts both things at once, and the empty
  state is the louder of the two.
- Use `components/FailureState.tsx`: **`FailureState`** (block, replaces an empty state) and
  **`FailureNote`** (inline, for a filter row or a supporting section where the rest of the page
  is still worth reading). Both name what failed, show `error_message`, and offer a retry.
  The "failed request, not an empty result" sentence is **`FailureState`'s alone**: the proxy's
  `upstream_unreachable` message names the zone and stops, because two copies made the panel say
  it twice. `FailureState` still skips its sentence when a message already says "not an empty
  result".
- Batches use **`firstError(...)`** — never a second helper. See `[zone]/analytics/page.tsx`.
- **Writes count too.** `await reqCreateX(...)` with no branch shows a green toast for a
  rejected write; where the write was applied optimistically, the UI then keeps showing state
  the server refused.
- Partial vs total: a failure that leaves real data on screen gets a `FailureNote` beside it;
  one that leaves nothing gets the `FailureState` panel instead of the content.

The one deliberate exception is `logout()` in `AuthContext` — it ignores its result on purpose,
because a user who asked to log out must not be trapped by a failing endpoint.

### Roles, confirmation and bulk actions

- **Write controls are hidden from viewers** with `useRole().canWrite`. monitor-core refuses
  every `/v1` write from a `viewer` session (403 `4003`, which `fetchApi` turns into a redirect
  to `/unauthorized`) and every request from a `pending` one (`4004`). A visible Delete a viewer
  can only bounce off is a trap. ⚠️ This includes **implicit** writes: the dashboard's autosave
  returns early for viewers, or picking a variable would throw them off the page.
  `POST /v1/alert-rules/{id}/test` is a read server-side and stays visible.
- **Every destructive action confirms**, through `useConfirm()` — never `window.confirm`, never a
  bespoke overlay. Name the thing and what is lost. Use `typeToConfirm` where the blast radius
  is outside the page: revoking **any API key that may be in use** (ingest or admin, single or
  bulk — with the one ASCII phrase `revoke`, never the key's name, which may hold emoji or curly
  quotes), bulk-deleting more than 5 alert rules or all of them (`delete`), deleting an SSO provider (its slug), retiring a zone or project (`RetireDialog`, the
  slug). Only a key that provably never authenticated a request gets a plain confirm.
- **A role change is destructive when it takes something away.** `/settings/admin/users` used to PUT on a
  `<select>`'s `onChange`, so one arrow key on a focused select demoted an admin with no
  confirmation. Every role change now goes through `useConfirm` (destructive when `isDemotion`),
  and every single-row write toasts its result — success with **Undo** (the same PUT with the
  row's previous values), failure with `error_message` — because the row may be far below any
  banner. Bulk options that would change nobody render disabled ("admin (already)"), never as
  silent no-ops. Vocabulary: **Remove role** (→ `pending`; account kept, all access lost until
  re-approved) vs **Block sign-in** (`active:false`; role kept) — the old "Revoke"/"Disable" did
  not say which was which.
- **A dirty form confirms before discarding** (Escape, backdrop and Cancel all go through
  `useConfirm` "Discard changes?") — the zone, project and SSO-provider dialogs do this, and the
  alert-rule, channel, policy and service-group dialogs through `hooks/useDiscardGuard(dirty, onClose)`
  (pass its result to the Modal's `onClose` AND to Cancel).
- **New things that act on their own start disabled**: an SSO provider (enabled = on the public
  login page the moment it is created) and an alert rule ("Create as disabled" / "Create and
  enable"). An API key starts as `ingest`; admin scope is an explicit choice with a warning.
- **Bulk actions**: `useSelection(ids)` + `<Checkbox>` + `<BulkActionBar>` + `runBulk`. Pass the
  ids of the rows ON SCREEN (filtered), so a bulk action can never touch a row the user cannot
  see. `runBulk` never stops at the first failure and `toastBulkResult` reports partial
  success honestly. ⚠️ **Issues are the exception** — they go through `POST /v1/issues/bulk`
  (see "The issues surface"), never a fan-out.
- **Icon-only buttons carry `aria-label`** (and `title`); form labels carry `htmlFor`.

### The static guards (`scripts/guards.mjs`)

Three checks, run by `npm run lint`, plain Node, no dependencies. Each exists because the bug
it catches is **invisible when it comes back** — neither produces a crash, a type error or a
failing request, so a reviewer would have to know the history to spot it.

1. **No hand-rolled project reads under `src/app/[zone]/**`.** Flags
   `useSearchParams().get(PROJECT_PARAM)` and the split form
   (`const sp = useSearchParams()` … `sp.get("project")`). Allowed only in
   `hooks/useScope.ts` and `components/ScopeBoundary.tsx`. **It is not a ban on the param**
   — the live tail must still splice it into an `EventSource` URL by hand, because axios
   interceptors never see that URL. Only *reading the current selection out of the router*
   is flagged.
2. **A notification channel's `config` is never read.** `NotificationChannel` in
   `types/index.ts` must not declare `config`, and no `ch`/`channel`-shaped identifier may
   read `.config`. That field is the credential — a Slack webhook URL whose path *is* the
   secret, a PagerDuty routing key — and `GET /v1/notification-channels` is on the ordinary
   `/v1` subrouter, readable by any session and any admin-scope key. monitor-core now tags
   it `json:"-"` and sends **`config_summary`** instead (built server-side by
   `SummariseChannelConfig`, failing closed). Read that. With the field absent from the
   type, TypeScript enforces every individual read site; check (2) protects the type itself
   so one re-added field cannot re-enable them all at once.

3. **No `faSpinner` outside `components/ui/`.** The one-off spinners it bans were the
   layout-jump-on-load pattern; use the loading set (§5 "Loading states"). Not a crash, not a
   type error — just every page shifting when its data lands, one hand-rolled loader at a time.

`SavedDashboard.config` is a serialised widget layout and is deliberately *not* covered —
check 2 matches channel-shaped identifiers only, because a blanket ban would be noise and
noise is how a guard gets deleted.

**A further guard — "DOWN rendered as EMPTY" — was considered and deliberately NOT shipped.** The
candidate flags `X.success ? X.data : []` / `: null`. It matched ~20 sites on day one, and every
one read so far sits *after* a `firstError(...)` early return, where the ternary is only type
narrowing on a known-good result. Telling those apart needs dataflow, not a regex, and a guard
with twenty false positives teaches people to ignore guards. The way to make it shippable is to
have `firstError` return a narrowed tuple (or add a `dataOrThrow`) so the ternary is never
needed — then the pattern itself becomes the violation.

Other conventions:

- **Data fetching is imperative** — `useEffect` + `useState` + `req*` (or Redux dispatch).
  No data library. **No SWR/React Query.**
- **Scope comes from the route, synchronously** — but on a zone page you read it with
  **`useScope()`**, not `useSearchParams`. `useZoneHref()` for links, `currentProject()` /
  `currentZone()` for the axios interceptor. Never a store hydrated by a fetch; see §6.
  Internal links to a zone-scoped page go through `zoned(...)`, never a literal
  `/errors/...`.
  ⚠️ **A scope change REMOUNTS the page; it does not merely re-render it.** Reading
  `?project` by hand gives you the right string and a component that never remounts —
  which looks scoped and behaves unscoped. `scripts/guards.mjs` fails the build on it.
- **UI is hand-built** — no component library. Tailwind + local components.
- **Auth state comes from `useAuth()`** (`store/hooks.ts`) for `{user, isLoggedIn,
  isLoading, error}` and `useAuthContext()` for `logout()` and `retrySelf()`. `AuthProvider`
  hydrates the slice by checking `mon-logged-in` then calling `reqGetSelf()`; a `pending`
  user is parked. ⚠️ A **5xx or no answer** from `/auth/self` sets `error` and stays put — it
  is not a signed-out user (a 401 is ended by `fetchApi`'s refresh path, 4003/4004 routed by
  it), and sending it to `/login` looped, because the proxy confirms the session and forwards
  straight back. `/settings/account` renders `error` as a `FailureState` with Retry.
  ⚠️ **`reqGetSelf()` runs ONCE per mount** (`selfLoadedRef`), not per navigation. The
  provider lives in the root layout, and every event that can change the answer (login,
  logout, an ended session) is a full page load. The per-`pathname` effect re-checks only
  the cookie, `PUBLIC_PATHS` and the pending redirect, with no request (landing on `/login`
  resets the ref). Don't put the self fetch back on `pathname`: it was one extra request per
  click, on the same six sockets as the page's reads.
- **Response shapes differ on the wire, but not at the call site.** `monitor-core`'s
  `/v1/*` failures carry `message`; the auth/admin envelope carries
  `error`/`error_message`/`error_code`. `toApiResult` in `api.service.ts` normalises both
  (`error_message ?? message`), so a call site holding an `ApiError` can always read
  `error_message` — which is what `FailureState` renders. Don't add a per-layer branch for
  this; there is one shape by the time you see it.
  ⚠️ The wire difference that *does* reach you is **envelope vs no envelope**: `/health`
  answers with a bare object and no `success` key, so `toApiResult` falls back to the HTTP
  status for it. Testing `payload.success === true` directly would read `undefined` on a
  healthy `/health` and render the health page permanently red.

### URL state (`hooks/useUrlState.ts`)

Anything a user would expect a reload, Back or a pasted link to keep — filters, tab, sort, page
offset, a selected range, an open record — lives in the URL. A filter held in `useState` is lost
on reload and in every link someone pastes into chat: the recipient lands on the defaults and sees
a different list from the one being discussed.

```ts
const [status, setStatus] = useUrlState("status", urlEnum(STATUSES), { default: "unresolved" });
const [q, setQ] = useUrlState("q", urlString, { default: "", debounceMs: 300 });
```

- Codecs: `urlString`, `urlInt`, `urlBool`, `urlEnum(values)`, `urlCsv`; pages define their own
  for richer values (the events page's chips, analytics' filter JSON, `rangeToParam`).
- Defaults are **omitted** from the URL, so an untouched page has a clean address. Invalid values
  (`?tab=gone`) read as the default.
- Text inputs use `{ debounceMs: 300 }`. The returned value updates immediately; only the URL
  write waits, so an input never lags its keystrokes.
- Setters called in the same tick share **one** history write. A "clear filters" handler calls
  each setter in turn; there is no `useUrlStates`.
- `history: "push"` only where Back should undo the change (the events page's filters and zoom,
  analytics' range, the performance drill-down, the account tabs). The default is replace.
- Back/forward and link navigation win over an unflushed debounced edit: the edit is dropped
  and its timer cancelled. A write queued for a pathname that has since changed is discarded.
- Returned values are referentially stable per param value, so a `urlCsv` array is safe in an
  effect's deps.
- A zone-agnostic page that uses it needs its own `<Suspense>` (it reads `useSearchParams`).
  `[zone]` pages already sit under one in `[zone]/layout.tsx`.

> ⚠️ **NEVER FOR `project` OR `zone`. The hook throws for either.** They are the scope:
> `ScopeSwitcher` writes them and `useScope()` reads them, so a change REMOUNTS the page. A hook
> that set `?project` in place would relabel the page and refetch nothing — the exact bug guard 1
> exists for. The hook never *reads* `?project` either, so guard 1 holds; it does **preserve** it
> on every write. A project switch keeps the other query params (`ScopeSwitcher` behaviour), so
> after the remount the page re-reads its filters from the URL and they survive. A zone switch
> drops them, as before.

> ⚠️ **It writes with `window.history.replaceState/pushState`, NEVER `router.replace`/`router.push`.**
> Every `[zone]` route is dynamic, so `router.replace` refetched the RSC payload — and re-ran the
> zone layout's registry check — on every keystroke of a search box. Next integrates the native
> calls with `useSearchParams`, so readers still update; switching tabs on alerts makes zero
> `_rsc` requests. The native call also updates `window.location` synchronously, which is what
> makes same-tick batching safe.

### Loading states

One loading set, in `components/ui/spinner.tsx` and `ui/skeleton.tsx`. Which piece, when:

| Situation | Use |
|---|---|
| First load, shape known (a list, a table, cards, a form) | A skeleton: `SkeletonRows` / `SkeletonTable` / `SkeletonCards`, or a page-specific one built from `Skeleton` (`IssueListSkeleton`, `DetailSkeleton`, `PolicySkeleton`) |
| First load, shape unknown (an auth gate, a panel that may hold anything) | `LoadingBlock` with a reserved height — or render the page chrome and skeleton the body |
| Refetch of content already on screen | Keep the content; `RefetchBar` above it (see "Refetches, polling and hidden tabs") |
| An action in flight in a button or a row (save, delete, toggle, test) | `<Button loading>`, or `ButtonSpinner` in place of the row action's icon |
| A refresh button | Its own arrow icon, spinning: `<FontAwesomeIcon icon={faArrowsRotate} spin={busy} />` — no icon swap |

- ⚠️ **A skeleton is the height of what replaces it.** Size rows with `rowClass` to the real row,
  match the real grid (`DetailSkeleton` carries the issue page's 300px sidebar), and render
  headers and controls for real during the load. A skeleton that settles into a different shape
  is the layout jump it was meant to prevent.
- `Spinner`'s `delay` (ms) keeps it invisible for loads that finish quickly; `LoadingBlock` uses 150.
- ⚠️ **`faSpinner` is banned outside `components/ui/`** (`scripts/guards.mjs`, guard 3). Twenty
  one-off `faSpinner animate-spin` loaders, each its own size and colour and most in a box far
  shorter than the content that replaced them, are what this set replaced.

### Refetches, polling and hidden tabs

- **A refetch never swaps content for a spinner.** The skeleton is for "nothing to show yet";
  once a page or panel has an answer, a refetch keeps it on screen with `RefetchBar` above it.
  The issues list, the issue detail, the events page (rows kept, bar while `loading` with rows
  on screen), analytics and the dashboard (a panel shows its skeleton only while it has no
  data; a widget EDIT drops its old answer, since a gauge's number is not a chart's series)
  all follow it.
- ⚠️ **Every background poll is gated on `usePageVisible()`.** Key the interval effect on the
  visibility, so hiding the tab tears the timer down and showing it fetches once, immediately,
  then restarts. If the poll's subject can change (HealthStatus's zone), keep the RESET in its
  own effect keyed on the subject only: merging them blanks the reading on every refocus.
  `/pending`'s approval check predates the hook and checks `visibilityState` itself — same
  effect, no fetch while hidden. Clock ticks (`useNow`, the rate meter) are not fetches.
- ⚠️ **`AutoRefresh`'s `loading` prop must mean "a refresh is in flight".** A tick that comes
  due while it is true is **skipped**, not fired. The events page and the dashboard guard their
  fetch with a latest-wins generation, so a tick that fires mid-request discards the request it
  supersedes, and when a refresh takes at least the interval nothing ever lands. Pass the
  in-flight flag (the events page's `loading`, the dashboard's batch `loading`, analytics'
  `loading`), never a "has data" flag. It also stops while the tab is hidden and refreshes once
  on return (after the pause ends, if `paused`); `onRefresh` is read at tick time, so a page
  recreating the callback does not restart the countdown.
- **Render one layout, not two.** For a list that differs between phone and desktop, pick the
  layout with `useMediaQuery(MD_UP, true)` rather than rendering both behind `hidden md:block`
  / `md:hidden`, which doubles every row in the DOM and in every reconciliation. `EventTable`
  is the worked example. ⚠️ Only for content rendered **after** a client fetch: anything
  server-rendered (a first-load skeleton) keeps the CSS switch, or a phone paints the server
  default until hydration (§5 "Hydration").

### Hydration (React #418)

Every route is server-rendered, so the browser's first render must match the server's.
Production threw #418 on every signed-in page until these were fixed:

- ⚠️ **`StoreProvider` passes `serverState`** (the initial store). Without it react-redux hands
  a late-hydrating Suspense boundary — the Navbar, every zone page — the LIVE store, where
  `AuthProvider` has often already put `user`, so the avatar menu and every `canWrite` control
  existed on the client only.
- ⚠️ **Never read storage, cookies, `window` or the clock in a `useState` initialiser or during
  render.** Use `useSyncExternalStore(subscribe, readBrowser, () => serverValue)` — as
  `/login`'s loop guard and last-used method, the date/time prefs and `/pending` do — or set it
  in an effect. `/login` once rendered the form on the server (no `sessionStorage`) and the
  waiting card in the browser.
- Text that depends on the browser's timezone or locale (its zone name, a time in "local")
  renders a placeholder until `useHydrated()` (`hooks/useHydrated.ts`) is true —
  `/settings/preferences` threw #418 "text" on every load until it did.
- A value that is only *text* and legitimately differs (a year around New Year) may carry
  `suppressHydrationWarning` on that one element. Never on a subtree.
- ⚠️ **Next must be ≥ 16.4** (bundled React 19.3). On 16.1 (React 19.2) a chunk arriving late
  made React suspend mid-hydration and *replay* without rewinding its hydration cursor, so it
  re-read the Navbar's `<Suspense>` marker where `<div id="content">` was: #418 "HTML" on
  roughly every other load of a slow page — reproduced locally with 300 ms chunk delays on the
  `/trailblaze` → `/login` path a lapsed session takes. Fixed upstream in react#35494 (19.3.0),
  not backported to 19.2. A dev-build diff showing `+ <div id="content">` / `- <Suspense>` with
  `replaySuspendedUnitOfWork` in the stack is this bug, not app markup.

### Tabs and segmented controls

- Tab bars use `components/ui/tabs.tsx`: `<Tabs id label items value onChange>` plus
  `<TabPanel tabsId value>` around each conditionally rendered panel. WAI-ARIA tabs — roving
  tabindex, arrows/Home/End — where the hand-rolled button rows had no `role=tab`/`aria-selected`
  and one Tab stop per tab. In an overflowing tab list it scrolls the selected tab into view by
  setting the list's own `scrollLeft` — deliberately not `scrollIntoView`, which also scrolls the
  page.
- It is **controlled on purpose**. There is no `urlKey` prop, because the page also needs the
  active tab, and two readers of one param is the drift we avoid. Bind it with
  `useUrlState("tab", urlEnum(IDS), { default })`. Worked example: `[zone]/alerts/page.tsx`.
- Preset rows (1h/6h/24h/7d/30d, list/board) use `components/ui/segmented.tsx`: `role=group` +
  `aria-pressed`, not a tablist, because they re-parameterise the same content rather than swap it.

### Clipboard

Copy through **`copyText(text, { label })`** (`tools/clipboard.tools.ts`), never a bare
`navigator.clipboard.writeText`. That API is absent on plain HTTP and rejects when the document is
unfocused; bare, the failure was an unhandled rejection and the user saw nothing. `copyText` falls
back to `execCommand`, toasts success **and** failure, and returns a boolean so a caller can react
(the one-time API key secret is auto-selected when the copy fails). `label` names WHAT was copied,
never the value — toasts are on screen and values are often secrets. A copy failure is not
reported to Monitor: it is browser policy, not an app fault. There are no bare call sites left.

### Page titles

- The root layout sets `title: { template: "%s · Monitor", default: "Monitor" }`. Every route
  segment has a metadata-only `layout.tsx`, because the pages are client components and cannot
  export `metadata`. Zone pages use `generateMetadata` → `"Issues · {zone}"`, so tabs on two
  zones can be told apart. The zone home (Events) has no segment of its own and takes its title
  from `[zone]/layout.tsx`.
- ⚠️ **A plain-string title on a parent layout ENDS the root template for its children.**
  `/appleby/errors/abc` read "Issue · appleby" and `/settings/security` read "Account security"
  until both switched to `title: { absolute: "… · Monitor" }`. `[zone]/layout.tsx` uses
  `absolute` + its own `template` for the same reason — a string there would end the template
  for every zone page. A new nested segment under a titled parent must do the same.
- Titles follow the **H1, not the nav label**: `/[zone]/errors` is "Issues". Zone settings
  sections carry the zone ("API keys · appleby"), ecosystem ones don't ("Users"), so two tabs
  never read the same. Both hub layouts use `absolute` + `template` (the rule above).
- A page that knows a better title once its data loads (issue title, dashboard name) may set
  `document.title` itself; Next resets it on the next navigation.

### Skip link

`app/layout.tsx` renders **Skip to content** as the first Tab stop on every navbar page, targeting
a `<div id="content" tabIndex={-1}>` around `{children}`. A wrapper rather than an id on each page's
`<main>`, so no page has to remember it. Every page still needs exactly **one** `<h1>`.

### Keyboard shortcuts

Global keys are bound in the Navbar (§3 "Navigation"). A page that binds its own keys registers
them **beside the handler that binds them**, so the `?` overlay can never list a key that does
nothing:

```ts
const ISSUE_KEYS: Shortcut[] = [{ keys: ["j"], description: "Next issue" }, …]; // module constant
useRegisterShortcuts("Issues", ISSUE_KEYS);
```

Pass a **stable** array (a module constant) or the group re-registers every render. The group is
shown only while the page is mounted. Handlers ignore keydowns from input/textarea/select/
contentEditable, with modifier keys held, and while a dialog is open — the same rules as the
Navbar. Current registrations: Events (`/`, `j`, `k`, Enter, Esc) and Issues (viewers get
`j`/`k`/Enter/`/`; writers also `x`/`e`/`i`/`a`).

### Date and time display

Timestamps format through **`formatDateTime(value, prefs)`** with `useDateTimePrefs()`
(`tools/datetime.tools.ts`): timezone (local/UTC/any IANA zone), readable vs ISO, 12/24h, set on
`/settings/preferences` and stored per browser in `localStorage["mon-datetime-prefs"]`. SSR and
the first render use the defaults. The events table, detail panel, time-range chart and window
label all format through `formatEventTimestamp` (`EventTable.tsx`, seconds and optional ms on top
of the prefs), so they cannot disagree about the zone. Raw ISO stays in `<time dateTime>`/`title`,
copies, JSON and exports.

### Charts — gaps are not zeros

> ⚠️ **An empty bucket of a percentile/average series is "no data", never 0.** The performance
> drill-down asked for p95 with `fill_zeros:true`, so every hour without a sample drew as 0 ms and
> the chart read as latency collapsing from 78 s to 0 and back. Query percentiles with
> `fill_zeros:false` and pass `interval` to `TimeSeriesChart`: an ABSENT bucket then breaks the
> line (`emptyBuckets="gap"`, the default), and a lone bucket between two gaps is drawn as a dot.
> Counts keep `fill_zeros:true` (or pass `emptyBuckets="zero"`). A `null` value always breaks the
> line. monitor-core **omits** empty buckets under `fill_zeros:false`; it does not send nulls.

`TimeSeriesChart` props (all optional except `title`/`series`):

| Prop | Default | Meaning |
|---|---|---|
| `series` | — | `ChartSeries[]` — `TimeSeriesSeries` is assignable; `value` may be `null` |
| `formatValue` | compact count | y-axis, tooltip and summary. `formatDurationMs` → "120 ms", "1.4 s", "80 s", "2 m" |
| `interval` | — | bucket width; enables gap and partial-bucket detection |
| `emptyBuckets` | `"gap"` | what an absent bucket means (needs `interval`) |
| `domain` | — | `{from,to}` actually queried; lays x on real time and makes partial detection exact. Pass it on BOTH charts of a pair so their x-axes line up |
| `partialBuckets` | `"show"` | `"dashed"` (edge segments dashed, tooltip says "Partial bucket") or `"trim"`. Without `domain` both edges are assumed partial |
| `allowLogScale` / `scale` | off / linear | header Log toggle (aria-pressed). Stacking turns log off |
| `variant` / `stacked` | line / false | `"line" \| "area" \| "bar"`. Stacking happens in the chart, so the tooltip, live region and sr table show each series' OWN value plus a Total row. Stack only additive measures (count, sum, shares) |
| `onBrush(from,to)` | — | drag-to-zoom; typically `customRange(from,to)` → set range |
| `seriesLabel` | `title` | name for unnamed series (monitor-core leaves an ungrouped series unnamed) |
| `actions` | — | `CardHeader` slot. **Put export buttons here**, never a hover-only absolute overlay: it covered the Log toggle and was invisible to touch and keyboard users |

Several series render with a palette and a toggleable legend (aria-pressed buttons) and share one
tooltip. Every chart has nice 1/2/5 y-ticks, time labels on x, a `role=img` summary, a keyboard
tooltip (arrows/Home/End/PgUp/PgDn/Esc) and an sr-only data table.

**Other analytics component contracts:**

- **`CardHeader`** is the one header every analytics card uses. The title truncates with a
  `title` attribute; the row wraps so actions drop below the title rather than squeezing it.
- **`TopNList`**: pass `total` — % is the share of the TOTAL. Without it no % is shown (it used
  to be value ÷ top row, so the leader always read 100%). `onSelect`/`isActive`/`selectLabel`
  turn rows into aria-pressed drill-through toggles.
- **`CompareCard`**: a `previous` of 0 renders "—" with "No data for the previous period" —
  monitor-core answers `change_percent: 0` for it, which read as "no change". Pass
  `previousUnavailable` when `previousPeriodBeyondRetention(range)` (the window before `range`
  starts more than `EVENT_RETENTION_DAYS`, 30, ago), with a reason. Read the clock in the fetch,
  not in render.
- **Custom ranges**: a `TimeRange` whose `from`/`to` are ISO timestamps. `getTimeRange` and
  `getIntervalForRange` handle it unchanged (≤2h minute, ≤8d hour, else day);
  `suggestionWindow` falls back to the per-kind default. In the URL it is one param:
  `rangeToParam` → `24h` or `<fromISO>..<toISO>`, parsed by `rangeFromParam` (a preset resolves
  to its `TIME_RANGES` entry so `label` comparisons keep working; malformed → null → the
  caller's default). An absolute range is *meant* to stay put under AutoRefresh — this is not
  the stored-relative-timestamp bug §8 warns about.
- **Exports**: `exportToCSV`/`exportToJSON` toast "No data to export for this range and
  filters." and return `false` on an empty array. With `{ meta }` CSV gets leading
  `# key: value` lines and JSON becomes `{ meta, data }`; without it the file is exactly the
  rows. Build with `seriesExportRows`, `analyticsExportMeta` and `exportFilename("events",
  rangeToParam(range))` → `events-24h-2026-10-16T2359Z`. An all-zero `fill_zeros` series is
  data, not empty.
- **`AnalyticsFilters`**: every control is named; chip buttons are `Edit filter: …`,
  `Negate filter: …`, `Remove filter: …` with 24px targets. Escape closes the editor, stops
  propagation (a surrounding dialog stays open) and returns focus to "Add Filter". "Data field…"
  reads `/v1/data/keys` lazily and `/v1/data/values` for a known key; `< ≤ > ≥` are offered for
  data fields only and send a NUMBER. Duplicates are refused inline. ⚠️ **`in` always sends an
  array** — see §8 "Analytics".

### The analytics page

- **URL params:** `range` (`rangeToParam`; history **push**, so Back undoes a range change),
  `f` (filters as JSON), `agg`, `field`, `group`, `top` (5|10|25|100), `type`/`etype`
  (line|area|bar) and `view`/`eview` (`lines`|`stacked`|`percent`, shown as Overlay/Stack/% —
  % is shares stacked to 100%) for the
  main/errors chart. Defaults are omitted, so a bare `/{zone}/analytics` is the default view.
- **A non-count measure with no field queries and is TITLED as a count** — the page never labels
  a count "p95". An inline hint asks for a field.
- **Stack and % are offered only for additive measures (count, sum) split into 2+ series.**
  Grouped series are capped to Top N; for additive measures the tail folds into "Other (n)", for
  the rest it is dropped, because an "Other p95" would be invented. % leaves a gap for an empty
  bucket, not 0%.
- **Refreshes keep the data on screen.** Skeletons only before the first answer; later loads
  show a progress bar plus `aria-busy` and dim only when the query changed. A generation counter
  drops answers that arrive out of order.
- **Each call fails on its own card.** The 7 reads settle independently: a failed one renders a
  `FailureState` in its card's place (Error rate needs both totals); a failed REFRESH of the same
  query keeps that card's last good answer and names it in one `FailureNote` above the cards. The
  page-level `FailureState` is only for every call failing with nothing earlier to keep. AutoRefresh offers nothing under 30 s on ranges of 7
  days or more (`minSeconds`).
- Clicking a Top-N row toggles that value as an `eq` filter.

### The MCP tab (`components/settings/McpTab.tsx`)

- ⚠️ **The tool list is GENERATED, not maintained.** It drifted to 32 tools while monitor-mcp
  shipped 60, missing `monitor_get_issue_timeline` — which Monitor's own MCP instructions say to
  call first. `MCP_TOOLS` is built from the published package (`MCP_PACKAGE_VERSION`, currently
  1.7.0): `npm pack monitor-mcp`, read its `index.js` **as text** (never execute it), take every
  `server.tool(name, description)`, group by the file's `// ==== SECTION ====` banners, cut each
  description to its first sentence, and paste over the block. Regenerate on every monitor-mcp
  release. The generator script is not committed yet — see §9 known gaps.
- **The `mcpServers` key is `monitor_<zone>`, never `monitor`.** A fixed key made a second
  zone's snippet silently replace the first in the client's config.
- **Every registry zone is listed.** A zone with a `query_url` uses it; an active zone without
  one is checked against `GET /health` (on `/settings`, which has no zone, that answers with the
  control plane's identity) and, if it is the control plane's own zone, uses
  `NEXT_PUBLIC_MONITOR_API_URL`. Anything else stays listed, **disabled with its reason**. A
  failed zones read is a `FailureNote` with retry, never an empty picker — and no snippet.
  While the zones load the snippet is a skeleton, and Copy stays disabled until a zone with a
  real URL is selected: the `https://YOUR-ZONE-API-URL` placeholder is never copyable.
- Client tabs: Claude Code (`claude mcp add … --scope user`), Claude Desktop, Cursor & others.
  Example prompts name two real services from `reqZoneServices(zone)`.

---

## 6. Domain & architecture

### Tenancy: the zone path segment and the project selector

```
/{zone}                        events home
/{zone}/errors?project=atlas   every other zone-scoped page
/{zone}/live · /analytics · /performance · /dashboard · /alerts · /notifications
```

Root-level and **zone-agnostic**, never prefixed: `/login`, `/pending`,
`/unauthorized`, `/settings/*` (including `/settings/admin/*`), `/api/*`. `/admin/*` page
URLs redirect into `/settings/admin/*`; `admin` stays in `ZONE_AGNOSTIC_SEGMENTS` for them.

⚠️ Note `/{zone}/settings/*` **and** `/settings/*` both exist and are different hubs. See
"Where settings live" below — the split is not cosmetic.

**Why the two halves are shaped differently.** A **ZONE** selects which backend
answers, so it has to survive a bookmark and drive the proxy's upstream choice —
that belongs in the identity of the page, i.e. a path segment. A **PROJECT** is a
filter inside one backend and may reasonably become multi-valued, so it is a query
param. This is Sentry's shape: org slug in the path, project as a repeatable query
param.

The query param is also the **only mechanism that works for both transports**.
`EventSource` cannot send custom headers, so a header-based selector would work for
every axios call and silently leave both SSE surfaces — the live tail and the
desktop-alert feed — tailing the wrong project forever, with no error on either
side. One mechanism, not two that agree only while someone remembers to keep them
in step.

> #### ⚠️ THE PROJECT ASYMMETRY — read this before "fixing" the selector
>
> Three credentials reach Monitor and each resolves a project a different way. **Two
> of those resolutions are tenancy boundaries. The third is not, and that is
> deliberate:**
>
> 1. **INGEST** (`X-Api-Key` on `POST /v1/events`) — derived from the `api_keys` row
>    and **overwritten** over whatever the client sent. Unforgeable. A real boundary.
> 2. **API-KEY READS** (an admin key on `/v1/*`) — derived from that key's own row.
>    An admin key reads **only its own project**: "admin" is a scope over **verbs**,
>    never over tenants. Also a real boundary.
> 3. **SESSION READS** (a logged-in human here) — a **selector the user chooses**,
>    validated server-side against the registry. **NOT a boundary.**
>
> (3) reads as a flat contradiction of (1) until the missing premise is stated:
> **Monitor has no per-user project membership table.** There is no row anywhere on
> this install that could say "this user may see payments but not billing" — every
> account belongs to the operator or a colleague — and a check that consults nothing
> is not a boundary. It is a decoration, and the danger of shipping one is that the
> next reader trusts it. **Roles still gate verbs** (admin/editor/viewer/pending),
> which is the authorisation that genuinely exists. Sentry and Grafana both work
> exactly this way.
>
> **The change that turns this into a boundary is a per-user membership table, and
> `middleware.withSessionProject` in monitor-core is where it lands.** Nothing on
> this side of the wire can enforce it; do not add a client-side check that pretends
> otherwise.

**How the scope reaches a request.**

- **Zone** — read from the route, synchronously. `[zone]/layout.tsx` is a **server
  component** that validates the slug against `GET /v1/zones` and calls `notFound()`
  for an unknown one. **An unknown zone is a 404, never a 403:** a 403 tells an
  unauthenticated prober which slugs exist and tells a user who mistyped that they
  need permission rather than a corrected URL.
  `services/registry.server.ts` **fails open** when it cannot read the registry at
  all (expired session, upstream restarting) — a `null` answer is not grounds to
  404, or an unrelated outage presents as "your bookmarks are wrong" on every page
  at once. It fails closed on a definitive miss.
- **Project, in the React tree** — `components/ScopeBoundary.tsx`, mounted by
  `[zone]/layout.tsx`, read with **`hooks/useScope.ts`**.

  > ⚠️ **CHANGING THE PROJECT REMOUNTS THE SUBTREE. IT DOES NOT RE-RENDER IT.** This is
  > the single most load-bearing fact about tenancy on the client, and it exists because
  > the obvious design silently did nothing. `ScopeSwitcher.selectProject` changes the
  > scope with a **searchParams-only `router.push`**, which re-renders the components
  > that *read* the param — and **no page read it**. Every observability page fetches
  > from a `useEffect` whose deps name its own filters
  > (`[status, service, debouncedSearch, hasPR, sort, view, offset, reloadToken]`) or, on
  > alerts and notifications, are literally `[]`. So a project switch moved the label in
  > the navbar and **refetched nothing**: the previous tenant's issues stayed on screen
  > under the new tenant's name, indefinitely, every request 200, nothing in an error
  > state. The second half was worse — the axios interceptor resolves the project at
  > request time, so the *next unrelated* refetch adopted the new project while the rest
  > of the page held the old one's rows. Half the page on each tenant.
  >
  > `ScopeBoundary` keys its provider on `` `${zone}::${project ?? "__default__"}` ``, so
  > React tears the subtree down and rebuilds it. Every `useEffect(…, [])` re-runs
  > **without naming the project**, page-local state starts clean, and in-flight responses
  > are dropped by the `cancelled` flags those effects already carry.
  >
  > **Do not "fix" a scope bug by adding `project` to a dependency array.** That is
  > correct only for as long as everyone remembers it, and every page added afterwards
  > starts wrong by default — with the wrong-data symptom above rather than a crash.
  > `scripts/guards.mjs` fails the build on a hand-rolled `?project` read under
  > `src/app/[zone]/**`.
  >
  > **What it costs, and it is a real cost:** page-local state resets on a scope change —
  > filters, time range, selection, pagination. That is the right trade (a filter is a
  > question about *a tenant*), but it is a trade. The one genuinely dangerous case is the
  > dashboard's **2-second debounced autosave**, which could otherwise fire after the
  > remount and write a half-edited layout into the tenant that replaced it;
  > `[zone]/dashboard/page.tsx` compares the scope the edit was made under against
  > `readScope()` when the timer fires, drops the write and says so if they differ.
  >
  > `HealthStatus` is in the Navbar, in the **root** layout, **outside** the boundary — it
  > cannot use `useScope()` and reads its own zone from the path.

- **Project, on the wire** — a **request interceptor** on the one axios instance
  (`api.service.ts`), reading `currentProject()`. That prefers the scope
  `ScopeBoundary` **published** for the tree currently on screen
  (`publishScope`/`readScope` in `routing.tools.ts`, stamped with the pathname so it
  cannot go stale on a zone-agnostic page) and falls back to `window.location`. The
  mirror exists because `window.location` updates the instant the router navigates while
  React commits some frames later: without it, a request fired by a component that is
  about to unmount goes out with the *new* project and lands in the *old* page's state.
  It is published from `ScopeBoundary`'s **render**, not an effect — effects run
  bottom-up, so a child's mount effect would fetch before the parent had published. The
  `baseURL` is **not** touched: it is frozen at `create()` time, and rebuilding the
  instance to change it re-registers the CSRF interceptor, which is the multi-client
  class of bug commit `c68b6c4` eliminated.
  ⚠️ The interceptor is a **positive allowlist over `/v1/*`, not a denylist.**
  `/auth/*` must never receive the param — the proxy rewrites the refresh cookie's
  Path and `tools/session.tools.ts` hardcodes that URL, so anything appended breaks
  refresh, and the symptom is not an error, it is being randomly logged out.
  `/admin/*` has no tenant dimension. `GET /v1/zones` and
  `GET /v1/zones/{zone}/projects` are excluded **inside** `/v1` because sending a
  stale selection to them 400s the exact request needed to discover a valid one,
  making a bad selection unrecoverable.
- **SSE** — `EventSource` never runs through an axios interceptor, so **both**
  stream URLs splice the param in by hand: `[zone]/live/page.tsx` and
  `hooks/useDesktopNotifications.ts`. Both read it via `useScope()`, so a scope change
  remounts the caller and the stream is torn down by the unmount cleanup rather than by
  a dependency comparison.
  ⚠️ Only **one** of the two is actually filtered by it today. `/v1/events/stream`
  applies the project as a server-derived hub filter; `/v1/alerts/stream` calls
  `AlertHub.Subscribe()` with no filters and an `AlertEvent` carries no project at
  all, so every subscriber sees every rule's state changes. That is consistent
  rather than broken — timer-driven alert evaluation is zone-wide by decision (the
  KNOWN GAP header on monitor-core's `alerts/evaluator.go`), so there is no
  per-project alert to filter to. The client sends the param anyway: it is
  validated on arrival, and the day `alert_rules` gains a project column this half
  is already right. Do not read "the param is on the URL" as "the stream is scoped".
- **Links** — `hooks/useZoneHref.ts` (`zoned("/errors/9f3")`) and `Navbar`'s
  `hrefFor`. Dropping the zone 404s loudly; dropping the project works perfectly
  while quietly resetting the tenant, which is the failure worth a hook.
- **The switcher** — `components/ScopeSwitcher.tsx` is the only thing that *writes*
  the scope, and it writes it by navigating: `router.push` to a new path segment for a
  zone, to a new `?project` for a project. It holds no selection in state, so a copied
  link always reproduces what was on screen. Three rules are load-bearing:

  ⚠️ **The unset row is "Default project", NOT "All projects".** monitor-core's
  `selectedProject` resolves a missing `?project` to `env.DefaultProjectSlug` — **one**
  project — and refuses a repeated param outright. Labelling that state "All projects"
  would put one project's numbers under an all-projects heading: a chart that is wrong
  while looking right, which is exactly what the backend refuses a fallback for. The
  label becomes "All projects" when the backend can answer for a union, and not before.

  ⚠️ **A zone change always drops `?project`.** A project slug is unique only *within*
  its zone, so the same string in the new zone is either a different tenant or nothing
  at all — and "nothing at all" 400s every subsequent request from a param the user
  never typed. It also rewinds a record path (`/{zone}/errors/9f3` → `/{new}/errors`),
  because a zone is a separate ClickHouse instance and an id minted in one means
  nothing in another. Any other tail is kept whole (`/{zone}/settings/notifications`
  stays on that section). Page params are dropped too, through an **allowlist**
  (`ZONE_SWITCH_KEPT_PARAMS`: `tab`, `view`, `range`, `tz`, `type`, `etype`, `eview` —
  where you are and how it is drawn); `service`, `q`, `f`, `event`, `d`… describe one
  zone's data and would filter the next zone down to a false empty. A project change
  leaves the path alone and keeps every other query param: the page's filters are
  orthogonal to which tenant is being read.

  ⚠️ **The unset row renders even when the registry read FAILED.** It is the escape
  hatch: a stale `?project` 400s every other request on the page, and clearing it is
  the one move that always works. This is the client half of why `GET /v1/zones` and
  `GET /v1/zones/{zone}/projects` are excluded from the selector interceptor.

  Selecting a zone also writes the `mon-zone` cookie (host-only, path `/`) that
  `app/page.tsx` reads to resolve bare `/`. It is not the only writer — see below.

**The remembered zone** (`context/RememberedZoneContext.tsx`) is the zone links point into
from a page that has none (`/settings/*`): "the zone you came from".
`ScopeBoundary` calls `remember(zone)` whenever a zone page mounts, which updates the
context **and** writes `mon-zone`; `RememberedZoneProvider` (root layout) is seeded from
the cookie the layout read server-side, so both render passes agree. `Navbar` and
`useZoneHref` both resolve path zone → remembered zone → `FALLBACK_ZONE`.

- ⚠️ **Write it from `ScopeBoundary`, not only from the switchers.** It used to be written
  only by the scope switcher and palette, so a user who reached `/appleby` by URL,
  bookmark, `/` or the login `next` param had no cookie, and every link on `/settings`
  led to trailblaze. `ScopeBoundary` renders only after `[zone]/layout.tsx` has validated
  the slug, so a 404 slug is never remembered — which is also why this is not in `proxy.ts`.
- ⚠️ **Read it from the context, not a prop seeded by the root layout.** The root layout does
  not re-render on a client navigation, so a cookie value passed down from it stays stale
  until a hard reload.

**Scope is never hydrated into a store from a fetch.** App Router hands the route
to every page synchronously, and every page fires its data `useEffect` on mount with
no ordering against an async scope fetch — the first render would go out with the
wrong scope or none.

**Bare `/` is a redirect-only resolver** (`app/page.tsx`), not a page: last-used
zone (`mon-zone` cookie) → the registry's first active zone → `FALLBACK_ZONE`. It
**must never 404** — it is the logo link, the post-login landing, and what a user
types.

**There are TWO live zones**, and this file used to claim there was one — a leftover from
the phase before `appleby` existed, which contradicted §9's own `MON_LOCAL_ZONE`
documentation two sections later:

| Zone | Role | How the proxy reaches it |
|------|------|--------------------------|
| `trailblaze` | **The control plane**, running `MON_ROLE=both` — it serves `/auth`, `/admin`, the registry, **and** its own zone data | `CONTROL_PLANE` (the internal address), via the `MON_LOCAL_ZONE` shortcut — its registry row predates the endpoint columns and has no `query_url` |
| `appleby` | An ordinary zone: own API, own ClickHouse, own MariaDB | `registry.server.ts` → `zoneQueryURL("appleby")` |

The switcher still renders "This install has one zone." **when the registry genuinely
returns one row** — that string is a fact about the install, read at runtime, not a claim
about this codebase. If you see it against a two-zone install, the registry read failed or
a row is retired; that is a bug to investigate, not the expected output.

**Not built:** zone fan-out, cross-zone queries, config pull, per-user memberships.

### Where settings live

Two hubs, one frame (`components/settings/SettingsShell.tsx`), and **the split follows where
the data is stored**, not what it is about:

| Hub | Sections | Why here |
|---|---|---|
| **`/{zone}/settings/*`** (zone settings) | API keys · Source repositories · Notification routing (policies, service groups, channels, desktop) · Zone & projects (read-only) | Each is a row in ONE zone's database (or that zone's registry record). Under `[zone]`, so inside `ScopeBoundary`: the scope control applies and a project switch remounts the section |
| **`/settings/*`** (account / ecosystem) | Account · Sign-in & security · Preferences · AI integration · admin: Users · SSO providers · Zones & projects | The person, this browser, and the install. Control-plane data with no tenant dimension |

- **Alert RULES stay on `/{zone}/alerts`**, next to their firing state and history: they are
  operated, not set up once. Routing — where a firing rule goes — is configuration, so it is
  in the hub. The zone hub's nav links to Alerts, and the Alerts page links to routing.
- Old URLs keep working: `/{zone}/settings` → `api-keys`; `/{zone}/notifications` →
  `settings/notifications` (a server page under `[zone]`, so the zone is validated first and
  every param is kept); `/settings?tab=…` → its route; `/admin/*` → `/settings/admin/*`.
- The ecosystem hub links into **the remembered zone's** settings (§6 "The remembered zone").

- **`/{zone}/settings/api-keys`** — **API keys.** A key belongs to one project inside one zone:
  `apikeys.List` filters by the request's project server-side, and a minted key is bound
  to a project **permanently** (ingest derives an event's project from the key and
  overwrites whatever the sender claimed, so the sender cannot correct it). The page is
  under `[zone]`, so it is inside `ScopeBoundary` and the navbar's scope control applies —
  switching project re-reads the list rather than relabelling it. `reqCreateAPIKey` sends
  **`project_slug` in the BODY**: monitor-core's create handler reads the body, **not** the
  `?project` selector, and falls back to the zone's default project when it is absent.
  - **New keys default to `ingest` scope.** Admin is an explicit choice, a radio card with a
    warning.
  - **The one-time secret** is copied through `copyText`; if the copy fails the secret is
    auto-selected. The banner closes only through "I've saved this key", which asks for
    confirmation if no copy succeeded, and a `beforeunload` guard stays on while it is up.
  - **Last used.** `USAGE_TRACKING_SINCE` (2026-10-16, when monitor-core began recording use)
    separates "Never used" (created after it) from "Not since tracking began" (created before
    it). No recorded use for 30+ days earns a client-side **Stale** badge, the clock starting
    at the newest of last use, creation and the tracking epoch. Only a "Never used" key skips
    the type-to-confirm on revoke (§5).
  - **Rename**: blur never saves — explicit save/cancel, a 100-character cap (the server's own
    limit is 255), server errors inline.
  - **Service → repo**: `parseRepository` normalises pasted GitHub URLs (scheme-less, `www.`,
    `.git`, `/tree/...`, `git@github.com:`) to `owner/repo` and rejects anything else,
    including `../..`; branch names are validated client-side too. monitor-core now validates
    the same fields and answers a field-named 400 (§8). A stored mapping with an invalid
    owner/repo renders as an amber non-link rather than a link to `https://github.com/`.
  - **Create Key and Map service are disabled while their list is loading or failed** — a zone
    that cannot list cannot save.
- **`/settings/*`** — the **ecosystem hub**: Account (who you are, links to sign-in &
  security and the remembered zone's API keys), Preferences (date/time display, §5), AI
  integration (`McpTab`, §5), Sign-in & security, and the admin sections.

  > ⚠️ **API keys used to live at `/settings` and were unreachable for every zone but the
  > control plane.** `settings` is in `ZONE_AGNOSTIC_SEGMENTS`, so `currentZone()` returned
  > null, no `?zone` was sent, and `resolveUpstream` answered from the control plane — the
  > page could only ever show, mint and revoke keys for the control plane's default
  > project. Meanwhile `RetireDialog` told operators that retiring a project does **not**
  > stop ingestion and to "revoke the project's API keys in Settings → API keys", and
  > `ProjectFormModal` said to mint one there. Both instructions named a page that could
  > not do it. `/settings?tab=api-keys` still resolves (to Account, whose card leads into
  > the zone) because those words are in people's heads.

  Both dialogs now build that link **from the row they describe** (`zoneHref(zoneSlug,
  "/settings/api-keys", slug)`), never from the current route: they are opened from
  `/settings/admin/registry`, which is zone-agnostic, so anything route-derived would fall back to
  the remembered zone and hand out a link into a *different* tenant's keys — a link that
  works, lands somewhere real, and shows the wrong thing.

### Managing the registry (`/settings/admin/registry`)

Admin-only, control-plane-only, and **zone-agnostic** — it lives at the root, not under
`[zone]`, because the registry is the map of *all* zones and there is no zone you could
sensibly stand in to retire that zone. `admin` is in `ZONE_AGNOSTIC_SEGMENTS`,
`monitor-core`'s `tools/Slug.tool.go` reserves the slug so no zone can shadow it, and
`ScopeSwitcher` renders null there.

Four things about this page are load-bearing, and each one is a failure mode it exists to
prevent:

1. **A zone row RECORDS infrastructure; it does not create any.** The stack, its
   ClickHouse, its MariaDB, the DNS record and the certificate are provisioned by hand
   first. Nothing reconciles the row against reality, so the row is a *claim*. The copy
   says "record" and "verify", never "create" and "save", and the create dialog opens with
   that sentence rather than burying it in a tooltip.

2. **Verification is a server-side probe, and it necessarily follows the write.**
   `POST /admin/zones/{id}/probe` addresses a *row*: it re-reads the stored URL, re-runs
   the SSRF guard, GETs `/health` then `/ready`, and compares the far end's reported
   `zone` **and** `role` with what the registry expected. There is no endpoint that probes
   a URL which is not yet a row, and a client-side check would test a different path from a
   different place — it would say "reachable" about a host the control plane cannot reach.
   So the dialog records first and does **not close** on the write: step 2 probes
   immediately and stays open on the verdict.

   ⚠️ **An unreachable zone is a `200` from that endpoint.** The probe succeeded; what it
   found was a zone that is down. `res.success` means "we got an answer", never "the zone
   is fine" — the verdict is in the payload. The two are tracked separately everywhere on
   the page, because "we could not ask" is a control-plane fault and rendering it as
   `unreachable` would blame the zone for it.

   **The server backs this up, so the auto-probe is a convenience and not the guarantee.**
   `PUT /admin/zones/{id}` that changes `query_url` resets the row to `unknown` and clears
   `reported_zone` / `last_probe_at` with it, inside `query.UpdateZone`. So if the save
   lands and the probe that follows it does not — a closed tab, a dropped connection, a
   `curl` that never had a step 2 — the row reads "Never checked" rather than keeping the
   old address's `healthy`. Do **not** take that as licence to drop the second step: the
   point of the dialog staying open is that somebody sees the verdict.

3. **`mismatched` is the loudest state on the page** (`components/admin/ZoneHealth.tsx`),
   and it is the reason the whole feature exists: a row pointed at a *different, working*
   zone returns 200 for every request and shows one tenant's data under another tenant's
   name, with nothing anywhere in an error state. It renders filled rather than tinted, so
   it is separable at a glance from a column of warnings. `unknown` (never probed) is never
   styled as health, and no verdict is ever shown without its timestamp — nothing re-probes
   on a timer, so the value is a record of the last look and may be months old.

   **A green verdict expires.** `ZoneHealth.tsx` exports `STALE_AFTER_MS` (24h),
   `isStaleVerdict`, `verdictMeta` and `isFreshHealthy`. A `healthy` older than 24h renders as
   the amber "Healthy · stale" chip and gets the explanatory panel ("press Verify"), like any
   other non-healthy state; only `healthy` decays. Render through `verdictMeta`, not
   `reachabilityMeta`, wherever a verdict is shown. The chip carries no `reachability_detail`
   `title` (it leaked into the row toggle's accessible name); the panel prints the detail.
   `ZoneHealthPanel` takes `showChip={false}` where the chip is already directly above, and
   `children` for a fixing action ("Add query URL"). Light-mode chip foregrounds are darker
   hexes than the shared tokens, which fail 4.5:1 at 11px on a 10% tint.

4. **Nothing deletes.** The API has no DELETE verb on this surface at all; retiring is a
   POST that soft-deletes and keeps the row forever, so the UNIQUE key on slug makes reuse
   structurally impossible. Events carry a 30-day TTL and the occurrence rollup has none,
   so a recycled slug would reattach a month of one tenant's events *and* a permanent daily
   rollup to another. The confirmation therefore says what is spent (the slug, forever) and
   what is **not** done — retiring a zone tears down no infrastructure, and retiring a
   project does not stop a single event arriving until its API key is revoked. Retired rows
   stay listed (`?include_deleted=true`, which only this page passes) precisely so a spent
   slug never looks free.

**Slugs are immutable, and the UI says why rather than greying a box.** The payload types
carry no `slug` field on an update and the server answers `400` to one rather than dropping
it — answering `200` to "rename this zone" having renamed nothing is invisible here and
permanent on the other side. `FixedSlug` renders the value as a fact with its reason
attached and points at the display name, which *is* editable.

**The reserved-slug list is deliberately not mirrored in TypeScript.** It lives in
`monitor-core`'s `tools/Slug.tool.go`, it also protects this app's own routing (a zone named
`settings` would shadow a page), and a second copy would drift. Only the slug *pattern* and
its length bounds are mirrored, to fail early; the server's message is what is shown.
`slugProblem` (exported from `ZoneFormModal`, shared with `ProjectFormModal`) lists **every**
problem (charset, start, end, length), not the first. Both forms also take `existing` (every
zone, or that zone's projects, retired included) and say inline whether a slug is live or
**retired** — a spent slug is caught before the request, not by it.

Also on this page:

- **Retiring is type-to-confirm** (`RetireDialog`): the destructive button stays disabled until
  the slug is typed exactly; focus opens on that field.
- **Verify is per-zone and concurrent** (`probing` is a `Set<number>`); "Verify all" probes every
  active zone that has a query URL. Verify is disabled on a zone with no query URL — it could
  only answer `unconfigured` and would re-stamp "checked just now"; the panel offers "Add query
  URL" instead. A pristine zone edit's button reads "Re-verify" and probes without a PUT; a
  pristine project edit's Save is disabled.
- **Connect drawer per project**: the zone's ingest endpoint (`ingest_url + /v1/events`) as a
  curl (NDJSON; `timestamp`/`service`/`name` required) and a monitor-js snippet, each copyable,
  plus a link to that zone/project's API keys built from the row. ⚠️ **No key ever appears** —
  a placeholder `<ingest key for {slug}>`; the project comes from the key, so it is not in the
  payload.
- Row actions carry contextual `aria-label`s ("Verify zone Hillview", "Retire project Default
  in appleby"). Loading renders skeleton cards rather than a centred spinner (CLS 0.27 → 0.0025).

### Alert routing preview (`[zone]/alerts`)

⚠️ **`previewRouting` in `components/alerts/alerts.tools.ts` MIRRORS monitor-core's router**
(`alerts/router.go`): the routable service/env is the first `eq` string filter; a scoped matcher
does NOT match a rule lacking that dimension; policies are walked in `position` order and the
first match stops unless `continue_matching`; a matched policy with no channels still counts as
matched; the rule's own `notification_channel_ids` ("Fallback channels" in the UI) are used ONLY
when no policy matched; unresolvable ids are skipped. It reads `GET /v1/service-groups` too, for
`service_group` matchers. **Change both or neither.** monitor-core now serves
`POST /v1/alert-rules/preview-routing` (a draft CREATE body, validated like a create, answered by
the router's own `traceRouting`); moving this page onto it removes the copy and is the follow-up
— until then the TypeScript mirror is what the page shows. (monitor-core's AGENTS.md already says
"monitor-web no longer keeps its own copy"; that is not yet true.)

Related rules on that page: the rule form round-trips `notification_channel_ids` (it used to be
absent, so Duplicate created copies with `[]`); `POST /v1/alert-rules/{id}/test` is a dry run that
routes nothing, so bulk Test needs no confirm; `CreateAlertRule` turns `cooldown_seconds: 0` into
300, and the form says so for new rules.

### The notifications surface (`[zone]/notifications`)

- **Rule counts are enabled-only.** "Matches N rules" and the policy dialog's "N of M active alert
  rules" count `enabled` rules; disabled matches are shown separately ("Matches 1 active rule ·
  2 disabled"). Counting disabled rules made a policy look covered when nothing it matched could
  fire.
- **Channel tests read `data.ok`, not `success`.** `reqTestNotificationChannelResult`
  (`services/api.ts`): invalid config → 400 with a field message; delivery failure → **200
  `{ok:false, error}`**; delivered → 200 `{ok:true}` (an older core sends `null` or a 500).
  `success: true` means "the test ran", never "delivered". Rows prefer the persisted
  `last_test_at` / `last_test_ok` / `last_test_error` (`NotificationChannelWithTest`) and fall
  back to a test run in this tab.
- **Channel rows say who routes to them** — policies plus rules that list the channel directly
  (`notification_channel_ids`) — or "Unused".
- **Desktop notifications** have per-browser prefs in `localStorage`
  `monitor-desktop-notifications-prefs` (`{firing, resolved, minPriority}`) beside
  `monitor-desktop-notifications-enabled`. `useDesktopNotifications(priorityOf?)` takes a
  rule→priority lookup because an `AlertNotificationEvent` carries no priority; an unknown
  priority is shown, never dropped. Settings are read with `useSyncExternalStore`
  (`subscribeDesktopSettings`, server snapshot = off), so turning them on opens the stream
  without a reload.
- **Service groups** dedupe their services on save and flag names not reported in the last 7
  days (allowed, with a warning).

### Auth model (native accounts + SSO, cookie-driven)

`monitor-core` owns identity; this app drives it over cookies. There is **no
identity-provider SDK and no provider-specific component** — every IdP configured in
`sso_providers` renders as one more SSO button, driven entirely by `/auth/sso/config`.

> ### ⚠️ ONE HTTP client — `services/api.service.ts`. Do not add a second.
>
> `fetchApi<T>(config): Promise<ApiResult<T>>`, matching lattice-web / keyring-web / forta-web /
> forta-login. `validateStatus: () => true`, so **a non-2xx is a value, never a throw**.
>
> The app used to have two — an axios client for auth/admin and a raw-fetch one for the
> observability pages — so CSRF, 403 routing and 401 refresh were each written twice. Two agreed;
> the third had diverged. The fetch client redirected to `/login` on any 401 *without attempting a
> refresh*, so whichever client fired first after the 15-minute access token expired decided
> whether the user was renewed or logged out. Most pages used that one, which is why it presented
> as "randomly logged out".
>
> ⚠️ **Because nothing throws on a non-2xx, a `catch` around an API call is DEAD for HTTP errors.**
> Any page that relied on `catch` to show an error state must check `success` explicitly, or a
> failing API renders as an empty page — indistinguishable from "nothing to show". Restoring those
> was the bulk of the migration, not the type changes.
>
> Helpers: `dataOf(res)` narrows to the payload for reads with an empty fallback; `firstError(...)`
> returns the first failure in a `Promise.all` batch, reproducing the old all-or-nothing behaviour.
> Rendering partial results instead is a product decision, not a refactor.
>
> ⚠️ **`/health` is not enveloped** — it returns a bare object with no `success` field. The client
> falls back to HTTP status when `success` is absent; removing that makes health checks read as
> permanently failing.

> ### ⚠️ `/auth/sso/config` returns an ENVELOPE, not a bare array
>
> ```json
> { "providers": [ { "name": "forta", "display_name": "Continue with Forta", … } ] }
> ```
>
> Read `res.data.providers`. **Never assign `res.data` straight to a provider list** — that
> shipped, and it locked SSO-only users out of Monitor on 2026-08-07. `providers.length` read
> `undefined` off an object, the `providers.length > 0` render guard went falsy, and every SSO
> button disappeared from the login page with no error, no empty state and nothing in the
> console. The page looked fine; it just had no way in.
>
> Both consumers (`login/page.tsx`, `settings/security/page.tsx`) now check `Array.isArray`
> and report a `sso_config.load.failed` warning to Monitor when the shape is wrong (see
> "Monitor self-telemetry" below), so the next contract change is loud rather than invisible.
>
> `monitor-core` serves **only** this shape. `lattice-api` and `openbucket-api` still emit the
> legacy `enabled` / `button_label` / `login_url` fields alongside it — which is exactly why
> those two logins kept working while Monitor's broke. Do not rely on those legacy fields.
>
> **`display_icon` has three forms:** `null` (a text button), `/auth/sso/icon/{slug}` (a cached
> asset, drawn as an `<img>`), and `bundled:<slug>` — looked up in a fixed table in
> `components/sso-provider-buttons.tsx` and drawn as a CSS mask filled with `currentColor`, so it
> takes the button's text colour (plain outline, dark mode, branded fill). An unknown slug renders
> no icon. That table must cover `BUNDLED_ICONS` in `components/admin/sso/providerForm.ts` **and**
> monitor-core's allowlist — adding an option means shipping its SVG under `public/sso/` in the
> same change. ⚠️ The SVGs are **imported** (served from `/_next/static/media`), not referenced
> as `/sso/x.svg`: a raw `/public` path is subject to the session gate, and an unlisted one 307s
> every logged-out visitor — everyone on `/login` — to `/login`. `/sso/` is now also on
> `proxy.ts`'s allowlist, so a raw reference would work too, but keep the import.

- **Cookies (set by `monitor-core`, relayed through the proxy):** `mon-access-token`
  (HttpOnly, 15m JWT), `mon-refresh-token` (HttpOnly, `Path=/auth/refresh`, 7d),
  `mon_sso_session` (HttpOnly, SSO sign-ins only — the provider-bound session),
  `mon-logged-in` (JS-readable, the client's login gate), `mon-csrf` (JS-readable,
  double-submit token). The browser JS only ever reads `mon-logged-in` and `mon-csrf`.
  ⚠️ **Clearing `mon-logged-in` must hit every parent domain.** monitor-core sets the `mon-*`
  cookies on `MON_COOKIE_DOMAIN` (`appleby.cloud` in production), and a host-only remove cannot
  delete a Domain cookie — a stale flag sends the next visit past `/login`. `clearLoggedInFlag()`
  (`tools/session.tools.ts`) removes it host-only AND on every parent domain of the hostname down
  to the registrable one; `endSession()` and `logout()` both call it (logout because the
  server's `Set-Cookie` does not arrive when the logout request itself fails).
- **An SSO session lasts as long as the identity provider's.** Every `/auth/refresh` (proxied
  with the `Cookie` header, so `mon_sso_session` reaches monitor-core) refreshes the provider's
  tokens; when the provider refuses, the refresh 401s and `endSession()` sends the browser to
  `/login?next=…`, where silent SSO usually signs it straight back in. A 503 from refresh means
  the provider is unreachable, not that the session is over.
- ⚠️ **Refresh is served at `/auth/refresh` (`app/auth/refresh/route.ts`), the refresh
  cookie's own path — NOT under `/api/monitor`.** A browser only sends a cookie to paths
  inside its `Path`. The proxy used to rewrite the Path on cookies it relayed, but SSO
  logins never pass through the proxy (the callback sets cookies straight from
  monitor-core), so every SSO session refreshed without its cookie and was sent to
  `/login` fifteen minutes after signing in. Cookies are now relayed verbatim everywhere.
  `session.tools.ts` falls back to `/api/monitor/auth/refresh` only when the primary call
  reports `no refresh token`, which migrates sessions whose cookie still sits on that
  legacy path; the rotated cookie lands on `/auth/refresh`.
- **Login (`login/page.tsx`):** a native email/password form (`reqLogin` →
  `POST /auth/login`, then a full reload so `AuthProvider` re-hydrates) plus one button
  per provider from `reqGetSSOConfig` (`GET /auth/sso/config`). **SSO is a full-page
  redirect** to `${NEXT_PUBLIC_MONITOR_API_URL}${login_url}` (i.e. straight to
  `monitor-core`, **not** the `/api/monitor` XHR proxy), because the IdP round-trip and
  `Set-Cookie` happen on the API host. The button carries `return_url=<next>` so the deep link
  survives SSO.
  **Silent SSO:** with exactly one provider, the page first navigates to
  `<login_url>?prompt=none&return_url=<next>` (`startSilentSSO` in `tools/sso.tools.ts`),
  showing the brand shell with "Checking for an existing <provider> session…" and a **"Sign in
  another way"** escape (`cancelSilentSSO()` → `window.stop()`); after `SSO_WAIT_MS` (5 s) with
  no answer the page stops waiting and shows the form. A user still signed in at the provider
  comes straight back signed in; otherwise monitor-core redirects to
  `/login?error=login_required&next=…` and the form renders (no error shown for that code).
  Skipped when the page has `?error=` or `?signed_out=1`, and at most once a minute
  (`mon-sso-silent-at` in `sessionStorage`) so a session that will not stick cannot loop.
  When no silent attempt is possible the form renders at once (the SSO slot holds a
  button-height skeleton until the config lands). ⚠️ A failed `/auth/sso/config` shows a
  `FailureNote` with Retry **in the SSO slot** and keeps the SSO hints in the copy — it used
  to drop the section silently, so an SSO-only user saw a password-only page.
  **Errors:** SSO callback errors (`?error=sso_*`) render as a banner ABOVE the card, separate
  from the password form's error, and `?error` is stripped with `history.replaceState` once
  read. Password failures show status-mapped copy (401/400/429/network/5xx), never
  monitor-core's raw string; the form error is `role="alert"` and both inputs carry
  `aria-invalid` + `aria-describedby`. A **"Last used"** hint reads
  `localStorage["mon-last-sign-in"]` (`"password"` or the provider name) — a hint only.
  "Forgot password?" explains there is no self-service reset (ask an admin, or use SSO).
  **Logout** (`AuthContext.logout()`) navigates to `data.redirect_url` from `POST /auth/logout`
  (`/login?signed_out=1` — sign-out ends only this app's session; Forta and other apps stay signed in) or to `/login?signed_out=1`.
  The page uses the **shared Appleby Cloud login layout** — the same structure as
  `forta-login`, `openbucket-web` and `lattice-web`: full-screen centred `<main>`, a brand
  row (40px logo tile + product name + hairline + "Appleby Cloud"), a bordered card holding
  "Sign in to continue" → labelled fields → primary button → `or continue with` divider →
  SSO buttons, and a `© <year> Appleby Cloud` footer (in the flex column, not absolute — it
  overlapped the card on phones). Colours come from the app's own
  palette (zinc + blue focus ring); **the structure and spacing must not diverge** — change
  it in all four repos or not at all. `Navbar` already returns `null` on `/login`.
- **Account & Security (`settings/security/page.tsx`):** lists linked identities
  (`reqGetIdentities`; a failed read is a `FailureState` in place of the list), connects a
  provider via `reqLinkIdentity` (returns an `authorize_url` the page navigates to; the callback
  returns to `/settings/security`), disconnects via `reqUnlinkIdentity` after a destructive
  `useConfirm` (the backend refuses the last identity → `409`), and sets/changes the password
  via `reqUpdateSelf`. Changing an existing password still sends `current_password`.
  ⚠️ **Adding a FIRST password needs a recent sign-in (step-up).** A password outlives the SSO
  grant, so monitor-core refuses a `PUT /auth/self` that adds one unless the session's
  `auth_time` (a JWT claim) is under 10 minutes old: **403 `error_code 4011`**
  (`reauth_required`). `fetchApi` routes only 4003/4004, so the page handles 4011 itself: a
  "Confirm it's you" panel with one button per **linked** SSO provider →
  `${NEXT_PUBLIC_MONITOR_API_URL}${login_url}?return_url=/settings/security&prompt=login`
  (full-page). `sessionStorage["mon-reauth-started-at"]` lets the page say "you signed in again
  — set it within 10 minutes" on return. An older core without 4011 falls through to the
  ordinary error. **Do not add 4011 to `fetchApi`'s 403 routing** — it is not a role denial,
  and redirecting to `/unauthorized` would strand a user one click from success.
- **Admin SSO (`admin/sso/page.tsx`):** full CRUD over `/admin/sso-providers` via
  `admin.service.ts`, in a `ui/modal` dialog with presets, per-field validation and a live
  login-button preview. Client secrets are write-only (never returned — the API sends only
  `has_secret`).
  - New providers default to **disabled**: an enabled provider is on the public login page the
    moment it is created, so enabling is a deliberate act after the preview.
  - The dialog shows the one redirect URI every IdP must register:
    `${NEXT_PUBLIC_MONITOR_API_URL}/auth/sso/callback` (monitor-core `sso.RedirectURL()`).
  - Auto-provisioned accounts are always created `pending` (monitor-core `sso/resolve.go`); the
    UI says so and links `/settings/admin/users`. There is no per-provider default role or domain
    allowlist.
  - ⚠️ **Allow auto-link + Trust email verified is the account-takeover combination**; the form
    warns when both are on.
  - Enter on a `<select>` in the form is swallowed — implicit submit from a select used to
    create the provider.
- **Admin users (`admin/users/page.tsx`):** `/admin/users?role=pending` is a shareable deep link
  to the approval queue. Filter chips carry per-role counts from one unfiltered
  `GET /admin/users?limit=200`; when the install has more users than that, the counts are hidden
  rather than shown partial. Role changes confirm and offer Undo (§5).
- **`/pending`** names the account ("Requested as <email>") and, while `mon-logged-in` is
  present, offers "Sign out" + "Check again". It re-reads `GET /auth/self` every 30 s while the
  tab is visible (and on returning to it) and sends an approved account to `/` with a full load.
  A failed check is shown, never read as "still pending". A visitor with no session gets a
  "Sign in" link; an approved account that opens `/pending` is sent straight in.
  **`/unauthorized`** names the signed-in account and offers "Sign out and use another account"
  (+ "Back to Monitor"); logged out, "Back to sign in". With the `mon-logged-in` cookie present
  but `/auth/self` failing it offers "Try again" + "Sign out" — never "Back to sign in", which
  `/login` would bounce straight back into Monitor.
- **Legacy flat URLs redirect into a zone.** Every observability bookmark moved in this
  change — `/errors` became `/{zone}/errors` — and without a shim each one resolves as a
  zone literally named "errors" and 404s, breaking saved links, links in chat logs, and
  anything linking in from outside, all on the deploy. `proxy.ts` redirects the seven old
  page names (`legacyFlatPage` in `tools/routing.tools.ts`) to `/{zone}/…`, preserving the
  query string so `?project=` on a shared link survives. The zone is the `mon-zone` cookie,
  else — signed in — the registry's first active zone (`GET /v1/zones`, as `app/page.tsx`
  does), else `FALLBACK_ZONE` only when the registry cannot be read (alone, it sent every
  cookieless visitor to trailblaze, the wrong tenant on an install whose users live in
  appleby). It runs **before** the session check, so a logged-out visitor with a `mon-zone`
  cookie round-trips the *new* URL through `next`. Logged out with no cookie, the zone needs a
  session to look up, so the LEGACY path round-trips through `next` and is resolved here once
  they are signed in.
  These names are safe to special-case permanently, not just during a transition:
  monitor-core's `tools/Slug.tool.go` reserves every one of them, so no zone can ever be
  created with a colliding slug and the shim can never shadow a real zone.

- **Page gating:** `proxy.ts` allows `/login`, `/unauthorized`, `/pending`, `/api/`,
  `/auth/refresh`, `/_next/`, `/favicon`, `/Monitor-Logo`, `/sso/` and redirects everything
  else to `/login?next=<path+search>` when `mon-logged-in` is absent. It only gates navigation —
  the JWT is validated server-side. It also stamps the `x-mon-pathname` request header, which
  the root layout (navbar fallback height) and `not-found.tsx` read.
  **A signed-in user on `/login` is forwarded**, not shown the form: when `mon-logged-in` is
  present and the URL has no `?error`/`?signed_out`, the proxy confirms the session with the
  control plane's `GET /auth/self` (1.5 s timeout) and redirects to `safeNextPath(next) ?? "/"`
  (`pending` → `/pending`). ⚠️ **The cookie alone is never trusted for this** — every client
  "session failed" path lands on `/login`, so trusting a stale cookie would loop `/login` ↔
  zone. Any doubt (401, timeout, unreachable) shows the form.
  ⚠️ **The deep link must survive the bounce.** This used to blank the pathname and the
  search, so a pasted link into a specific issue was destroyed by the session check and
  the recipient landed on a generic dashboard with no sign anything had been dropped —
  and the zone and project selector went with it. All three login redirects now
  round-trip it through `next` (`proxy.ts`, `tools/session.tools.ts` `endSession()`,
  `context/AuthContext.tsx` `redirectToLogin()`), and `login/page.tsx` honours it through
  `safeNextPath` — the open-redirect guard, since `next` is attacker-supplied. A
  deliberate sign-out does **not** carry it.
  ⚠️ **`safeNextPath` PARSES; it does not prefix-match.** The WHATWG URL parser strips ASCII
  tab/LF/CR before reading anything, so `?next=/%09/evil.example` passed a `startsWith("//")`
  check and resolved to `https://evil.example` after login. It now refuses any control
  character, whitespace or backslash, resolves the rest against a sentinel origin
  (`https://monitor.invalid`), accepts it only if it stays there, and returns the *normalised*
  `pathname + search + hash` so the caller navigates to what was checked. Never go back to
  string checks. The same value is sent as `return_url` on the SSO links, so monitor-core's SSO
  callback must validate it too.
  **Any `/public` asset referenced by a logged-out page must be allowlisted here.** The
  matcher excludes `_next/static` and `_next/image` but *not* root-level files, and
  `next/image` serves SVGs unoptimized from their raw path — so an unlisted logo 302s to
  `/login`, returns HTML, and renders as a broken image on exactly the pages that show it.

### Request flow (dashboard + auth/admin)

```
page → req*() → /api/monitor/<path>?project=<slug>&zone=<slug>   (same origin, mon-* cookies + X-CSRF-Token)
  → app/api/monitor/[...path]/route.ts (server):
       services/upstream.server.ts resolves WHICH monitor-core answers,
       strips ?zone (it names this hop, not the upstream),
       forwards Cookie + X-CSRF-Token, relays Set-Cookie back VERBATIM
       (session refresh does not come through here — it is app/auth/refresh/route.ts,
        at the refresh cookie's own path /auth/refresh)
  → the control plane        (/auth/*, /admin/*, /v1/zones*)
  → OR the selected zone     (every other /v1/*, AND /health — its registered query_url)
```

**The upstream is resolved PER REQUEST, not per process.** It was a module constant
until the second zone existed, which meant `/appleby/errors` and `/trailblaze/errors`
fetched the same backend and rendered identical rows under two different names — an
unimplemented feature presenting as confidently wrong data.

**`tools/routing.tools.ts` holds TWO predicates, and they are not the same set.**

| Predicate | Answers | Used by |
|-----------|---------|---------|
| **`routesToZone(url)`** | *Which box answers this?* — `isZoneScopedPath \|\| isZoneProbePath` | `resolveUpstream`, and the `?zone` selector in the interceptor |
| **`isZoneScopedPath(url)`** | *Does this carry a tenant?* — under `/v1/` and not `/v1/zones*` | the `?project` selector only |

Its default is **zone-scoped** — a new `/v1/` route routes to the zone, so a wrong guess
404s loudly instead of being answered with another zone's data.

> ⚠️ **ONE PREDICATE USED TO SERVE BOTH, AND THE REASONING WAS RIGHT BUT THE SCOPE WAS
> WRONG.** The argument — a project only exists inside a zone, so "routed to a zone" and
> "carries `?project`" are the same set by construction — still holds for everything under
> `/v1/`. What it missed is that a zone answers for something with **no tenant dimension at
> all: its own liveness.** `/health` is not under `/v1/`, so `isZoneScopedPath` said false,
> so `resolveUpstream` sent it to the **control plane** — and `HealthStatus` polled it every
> ten seconds and rendered a green **"Online"**, with the control plane's queue depth, in
> the navbar of every page of a zone that could be entirely down. Worse than no health
> indicator: an operator staring at an empty issue list had a green light telling them the
> backend was fine.
>
> `ZONE_PROBE_PATHS` (`/health`, `/ready`, exact matches only) is the difference between
> the two predicates and is expected to stay small. **If you find yourself adding a second
> exception, the rule is wrong and needs rewriting, not patching.** Never put `?project` on
> a probe — it is the same category of mistake as putting it on `/auth/refresh`.
>
> `HealthStatus` also reads its own zone from the path and puts it in the **visible** label
> ("trailblaze online" / "appleby offline"), and resets its state on a zone change. It sits
> outside `ScopeBoundary`, so nothing remounts it; without the reset it would show the
> previous zone's numbers under the new zone's name for up to ten seconds.

`services/upstream.server.ts` owns the resolution:
- `CONTROL_PLANE` = `MONITOR_API_INTERNAL_URL || NEXT_PUBLIC_MONITOR_API_URL ||
  localhost:8080` — the container-network address, so the hop never leaves the building.
- `MON_LOCAL_ZONE` (default `trailblaze`) names the zone this deployment's own
  `monitor-core` also serves under `MON_ROLE=both`. That zone takes `CONTROL_PLANE`
  rather than its public `query_url` — keeping the hop internal, and keeping it working
  while its registry row still has no `query_url` (trailblaze's predates the column).
  Set it to `""` on a pure `MON_ROLE=app` control plane.
- Any other zone resolves through `registry.server.ts` → `zoneQueryURL(slug)`.

⚠️ **Only the SLUG comes from the client; the URL is looked up in the registry.**
Accepting a URL from `?zone=` would make the proxy an open SSRF that attaches the
caller's session cookies.

⚠️ **An unresolvable zone is a 502 (`error: "zone_unroutable"`), never a fallback to the
control plane.** `zoneRoute` (and its thin wrapper `zoneQueryURL`) fails CLOSED — unlike
`isKnownZone` next to it, which fails open — because the cost of guessing here is serving
another zone's data under this zone's name, and nobody goes looking for that.

⚠️ **A slug the registry does not have is a 404 (`error: "zone_not_found"`), not a 502.**
`ZoneLookup` carries `known`: the registry was read and the slug is absent, so there is no
such zone — the answer `[zone]/layout.tsx` already gives the page. It used to be a 502, and
because the navbar health pill lives in the root layout (outside the zone 404) and polls on
the 404 page too, every visit to `/nope-zone` was a 502 at the edge and a Monitor issue
(`proxy.request`, monitor.appleby.cloud). Not reported: a mistyped URL is not an incident.
A registered zone with no `query_url`, or an unreadable registry, is still the 502.

**An upstream that cannot be reached at all is a 502 `upstream_unreachable`** in the same
envelope. The proxy's `fetch` throwing (refused, reset, DNS, a connect/headers timeout) used
to escape as Next's bare empty 500, so a page's `FailureState` said "Request failed" with
nothing naming the box; `forward()` in `api/monitor/[...path]/route.ts` now catches it, names
the zone in `error_message`, and reports `proxy.upstream.failed`. Upstream *statuses* are still
relayed untouched.

⚠️ **An expired session is NOT an unroutable zone.** The registry read carries the
caller's cookies, so a lapsed access token 401s it. `resolveUpstream` passes a registry
401/403 through as-is (`error: "unauthenticated"`, monitor-core's `error_code` kept, SSE
header `X-Monitor-Stream-Refusal: unauthenticated`) so the client's refresh and role
routing run. Reporting it as a 502 is what blacked out every non-local zone ~15 minutes
after each refresh.

⚠️ **Routing reads a 30s process-wide registry snapshot** (`ROUTING_TTL_MS` in
`registry.server.ts`). React `cache()` does nothing in route handlers, so without it every
proxied zone request cost a `/v1/zones` round trip (~20 per page load). `/v1/zones` is
install-wide, so one session's successful read is safe to route another's — it never
reaches a response. The snapshot only answers a caller carrying `mon-access-token` (no
logged-out zone enumeration); a slug missing from it, or cached with no `query_url`, reads
live; registry edits reach routing within 30s. Concurrent reads with the same cookies share
one request, bounded by a 5s timeout. Cost: a warm snapshot skips the control plane, so a
disabled or SSO-revoked user keeps zone reads until their access token expires (≤15 min) —
the window monitor-core's zones already accept; the proxy just no longer closes it.

⚠️ **A registry read that gets no answer serves the last good read for up to 5 minutes**
(`REGISTRY_STALE_GRACE_MS`). The redeploy automation recreates monitor-core on every CI
push, and the seconds it is down made every non-local zone 502 `zone_unroutable` and opened
`registry.read.failed` issues. Only a thrown fetch (refused, DNS, timeout) falls back — a
401/403 still passes through, a malformed 2xx still fails — and it reports
`registry.read.stale` (warn) instead. Past 5 minutes it fails closed as before.

The browser never sees the upstream URL or any API key.

### SSE (live tail + desktop alerts)

> ⚠️ **Both bridges send `X-Accel-Buffering: no`.** Production sits behind openresty (Nginx
> Proxy Manager), which buffers proxied responses: without the header monitor-core's frames
> stopped at the proxy, `onopen` never fired, and the live tail sat on "Connecting…" forever
> while monitor-core logged a healthy 200. Vantage's capture proxy buffers SSE too, so tophat
> the stream with `curl -N`, not a Vantage session.

```
[zone]/live/page.tsx    → EventSource(/api/monitor-stream?…&project=<slug>&zone=<slug>) → app/api/monitor-stream → <resolved>/v1/events/stream
useDesktopNotifications → EventSource(/api/alert-stream?project=<slug>&zone=<slug>)     → app/api/alert-stream   → <resolved>/v1/alerts/stream
```

⚠️ **These are the only two `EventSource` calls in the app, and BOTH selectors are
spliced into them by hand** (`withProject`, `withZone`; the live page sets them on its
own `URLSearchParams`). Adding a third stream means adding both there too — no
interceptor will do it for you, because `EventSource` cannot send custom headers and
never passes through axios. That is also why zone and project are query params rather
than a header: one mechanism that works for both transports, instead of two that agree
only while someone remembers to keep them in step. The failure mode of forgetting is
silent — the stream connects, frames arrive, and they are the wrong project's or the
wrong ZONE's.

Both take the scope from **`useScope()`**, so a zone or project change remounts the caller
and the stream is closed by the unmount cleanup rather than by a dependency comparison.

**Live tail behaviour (`[zone]/live/page.tsx`).**

- **Row keys are an id minted on receipt** (`toLiveEvent`), never an index — index keys remounted
  every row on every arrival and snapped expanded payloads shut. Expanded/pinned state is held by
  the page, keyed by that id.
- **Frames are batched into one render per animation frame**, and the pending batch is trimmed
  to `MAX_BUFFER` on every push: rAF does not run in a hidden tab, so it used to grow by every
  frame until the tab was shown. Clear empties the pending batch and cancels the queued frame as
  well as the list.
- **Pause freezes the view; it does not stop collecting.** Frames received while paused go to a
  held queue (capped at `MAX_BUFFER`, overflow counted and shown) and merge on Resume. The
  connection and its retries are unaffected by Pause.
- **The buffer is ordered by EVENT time** (`mergeNewestFirst`), not arrival; ties go to the later
  arrival.
- **A filter change prunes what is on screen** (and the held queue) before re-subscribing, and
  every flushed batch is re-checked against the filters the current subscription was opened
  with.
- **Status has `reconnecting`** (attempt N of 5 + countdown + "Retry now") **and `offline`** (the
  browser's `offline` event closes the stream; `online` resumes it only if offline is what
  stopped it). Any `connect()` clears a pending backoff timer.
- **A terminal refusal is a banner ABOVE a dimmed buffer labelled "Snapshot — stream stopped at
  …"**, not a replacement for it; the header button reads "Try again". This is the one place a
  `FailureState` sits *above* content rather than replacing it, and deliberately: those rows are
  the operator's last evidence, and the dimming plus the "Snapshot" label stop anyone reading
  them as live.
- Search (`q`): whitespace-separated AND; free text matches values of service/name/level, ids
  and payload values (never payload keys); `key:value` targets one field or payload path. A
  match the row does not show renders as a one-line `data.path: value` snippet; free-text terms
  are `<mark>`ed.
- **No heartbeat watchdog**: `EventSource` cannot see SSE comments, and a quiet filtered stream
  would false-alarm. The rate meter's "last event Ns ago" answers "quiet or broken?".
- Row actions: "View in Events" links `/{zone}?event=<timestamp|service|name>` and "Open trace"
  links `/{zone}?q=trace_id%3D<id>` — both are the Events page's own URL state.
- `live_tail.stream.failed` fires once per give-up and is skipped when the stream was superseded
  (a generation check around the probe).

Both bridges forward the caller's full cookie header and relay upstream `Set-Cookie`, so
long-open streams refresh. Consumers read unnamed `data: <json>\n\n` frames via
`es.onmessage`.

> #### ⚠️ A REFUSED STREAM MUST STOP AND SAY WHY — `EventSource` cannot read a non-2xx body
>
> Both bridges refuse an unroutable zone with a **502 naming it**. The browser throws all of
> it away: `EventSource` surfaces every failure as a bare `error` event with no status and
> no body, **and then reconnects.** Forever. So the two surfaces behaved like this:
>
> - the **live tail** backed off to a 30-second retry and sat on *"Disconnected. Click
>   Connect to start streaming."* — an instruction to press a button that cannot work,
>   while the real answer ("this zone has no query endpoint in the registry") sat unread in
>   a body nobody can see;
> - the **desktop-alert feed** retried every 5 seconds with **no UI at all**, so an operator
>   who had deliberately enabled alerts on a broken zone was told nothing, ever, while
>   believing they were covered.
>
> `tools/stream.tools.ts` is the fix, in two halves that are both required. **Stop:**
> `MAX_STREAM_ATTEMPTS` (5) bounds the reconnect, turning an infinite loop into a terminal
> state that can be rendered. **Say why:** `probeStreamRefusal(url)` makes one ordinary
> `fetch` of the same URL — which *can* read a non-2xx body — and recovers the server's own
> sentence. The bridges also set `X-Monitor-Stream-Refusal: zone_unroutable` (or
> `zone_not_found` for a slug the registry lacks, `unauthenticated` when the session was refused), so a client can tell "this zone
> cannot be routed to" from "the upstream blipped" without parsing English. The live tail
> then renders a `FailureState` naming the zone, as a banner above the dimmed buffer (see
> "Live tail behaviour" below); the hook, which has no surface of its own, raises one toast.
>
> Probe **only after the retries are spent** — it opens a second connection to a streaming
> endpoint (cancelled immediately on the success path), and doing it per-reconnect would
> double the connection count for no information. A null result means "it works now", which
> is a different thing from a refusal and must not be reported as one.

### Monitor self-telemetry

monitor-web reports **its own** failures to Monitor's **appleby** zone, as service
`monitor-web`. It is lean on purpose: errors and warnings only, each carrying enough to
diagnose cold — the error (`error`, `error_type`, `stack`, `cause`, `error_code`), what was
being attempted and its ids, the scope (`zone`, `project`, `path`, `method`), and the
consequence (`reason`, `outcome`).

```
browser → services/monitor.service.ts (monitor-js, apiKey "")
            → POST /api/telemetry (same-origin relay; adds X-Api-Key server-side)
            → MON_TELEMETRY_INGEST_URL                       (appleby zone ingest)
server  → lib/monitor-server.ts (monitor-js, captureErrors:false) → MON_TELEMETRY_INGEST_URL directly
```

- **The relay** (`app/api/telemetry/route.ts`) is keyring-web's relay with the names changed:
  same-origin only (`Sec-Fetch-Site` / `Origin` vs `Host`), ≤ 512 KiB and ≤ 500 events per
  batch, `service` overwritten to `monitor-web` (and `env` to `MON_TELEMETRY_ENV` when set),
  Monitor's status passed back so the SDK's retry and bad-line bisection work, **503** when
  Monitor is unreachable, **204** when telemetry is unconfigured. It never forwards the
  caller's cookies. It is **not** `/api/monitor` — that path is the upstream proxy to
  monitor-core. `proxy.ts` lets every `/api/` path through without a session, so the login
  page's own failures are reportable.
- **The server Monitor** is created lazily on first use with `captureErrors: false,
  captureUnhandledRejections: false`: the SDK's process listeners change how Node exits on a
  crash, and Next owns that.
- **`instrumentation-client.ts`** only imports the service, so the browser Monitor exists
  before hydration. **No pageview or navigation events** — keyring-web emits
  `client.page.load` / `client.navigation`; this app deliberately does not.

**Env** — plain, runtime, server-only. Never `NEXT_PUBLIC_*`, and **not in Keyring**:
Keyring's `injectEnv` runs in `instrumentation.ts`, and its failure must itself be reportable.

| Var | Default | Meaning |
|---|---|---|
| `MON_TELEMETRY_INGEST_URL` | — | The appleby zone's ingest endpoint (`…/v1/events`). Unset → telemetry off |
| `MON_TELEMETRY_API_KEY` | — | An ingest key minted on the appleby zone. Unset → telemetry off |
| `MON_TELEMETRY_ENV` | `production` | `env` on server events, and on relayed browser events when set |

Unset URL or key → the relay answers 204, the server helpers no-op, and the app runs normally.

> ⚠️ **`MON_TELEMETRY_*`, NOT `MONITOR_INGEST_URL` / `MONITOR_API_KEY` like keyring-web.** Lattice
> stack 30, which runs this container, carries a stack-level `MONITOR_API_KEY` holding the
> **trailblaze** zone's ingest **master** key — monitor-core reads `MONITOR_API_KEY` for exactly
> that, and the Dockerfile mounts a `MONITOR_API_KEY` build secret. A same-named variable here
> would send this app's telemetry to the wrong zone with a master credential. Do not "align"
> the names.

**Lattice mapping** (stack 30, container `monitor-web`) — whole-value interpolation only, which
is all Lattice supports; an env change needs a Deploy, not a Recreate:

```bash
MON_TELEMETRY_INGEST_URL=${MONITOR_APPLEBY_INGEST_URL}   # Lattice global id 6
MON_TELEMETRY_API_KEY=${MONITOR_APPLEBY_INGEST_KEY}      # Lattice global id 7
```

**Level policy.**

- **`error`** — something broke that someone should fix: a throw this app caught (a client
  `catch`, an error boundary), monitor-core unreachable from the proxy/streams/registry, the
  Keyring injection failing, anything uncaught on the server. `error` events group into issues.
- **`warn`** — a handled, degraded condition that threw nothing: an unroutable zone, a stream
  refusal, a response in the wrong shape, a stream that keeps dropping with no refusal.
- Nothing at `info`/`debug`.

**Volume control.** Server events are coalesced to one per **name + zone** per minute
(`createCoalescer` in `tools/telemetry.tools.ts`); what was dropped rides on the next event as
`suppressed`. The key table is bounded because `?zone=` is caller-controlled: past 200 live keys,
new zones share one bucket per name (`coalesce_overflow: true`). The browser coalesces
`reportError` by name + message and network errors by method + path, same window. Stream frame
failures report once per connection. `server.request.error` is **not** coalesced — each carries
the digest the user sees as "Reference".

**Grouping.** monitor-core fingerprints an error on project | service | name | `data.path` |
the normalised message (`error` → `error_message` → `message`). So `path` is always
**id-normalised** (`normalisePath`: UUID / numeric / long-hex segments → `{id}`) and the raw
pathname goes in `page`; otherwise `/{zone}/errors/{id}` would open one issue per issue page.
Query strings are never reported. (The SDK's own `client.error.uncaught` /
`client.error.unhandled_rejection` carry the raw pathname — an SDK limitation.)

**The axios hook reports transport failures only, never status codes.**
`attachMonitor(axiosApi)` is `attachAxiosMonitor(…, { minStatus: 600, ignorePaths: ["/health"] })`
written out, so the event can carry the zone (it lives in `config.params`, where the SDK's hook
cannot see it) and the consequence. Every status the browser can see was either logged by
monitor-core — it emits one `http.request.end` per request it receives, levelled by status — or
produced by this app's proxy, which reports its own refusals and upstream failures server-side. A
client event per status would duplicate one or the other. `/health` is skipped because the navbar
pill polls it every 10s and already renders that failure. `fetchApi`'s own `catch` does not report
(the hook already did).

**Deliberately NOT reported:**

- HTTP statuses from monitor-core — so no status-based axios events, no `if (!res.success)`
  branch, and no relayed 4xx/5xx in the proxy. monitor-core logged every one.
- Routine 401/403 on the streams (session expiry; the refresh path handles it).
- A client going away: an aborted SSE `fetch`, an axios cancellation, "Request aborted", a
  browser that is offline.
- Pageviews, navigation, successes.
- The relay failing to reach Monitor (there is nowhere to report it).
- Deliberately silent catches, each commented in place: the per-render JSON-parse fallbacks in
  the alerts/notifications routing previews, timestamp-formatting fallbacks
  (`EventTable`, `EventDetailPanel`), `CollapsibleCode`'s non-JSON fallback, `ZoneFormModal`'s
  URL validation, `stream.tools.ts`'s probe internals, `refreshSession`'s non-JSON body, the `/`
  resolver's catch (`registry.server.ts` reports for it), `IssueLinks` (its only throw is the
  parent rethrowing a `!res.success`), and `logout()`.

**Event catalogue.**

| Name | Level | When | Key fields |
|---|---|---|---|
| `keyring.inject.failed` | error | Keyring `injectEnv` threw at boot (also `console.error`) | `error`, `cause`, `stack`, `keyring_host`, `outcome: "running on plain env"` |
| `server.request.error` | error | `onRequestError`: anything uncaught in render / route handler / action (Node only) | `error`, `stack`, `digest`, `method`, `path`, `page`, `zone`, `route`, `route_type`, `render_source` |
| `proxy.zone.unroutable` | warn | `resolveUpstream` refused a zone (all three bridges) — **never** for a 401/403, which is passed through as the session refusal it is | `zone`, `method`, `path`, `reason: "zone_unroutable"`, `registry_read` (`no_query_url` / `registry_unreadable`), `registry_status` (the registry's own status when it could not be read; `0` = no HTTP answer, `null` = it was read fine), `outcome: "returned 502 zone_unroutable"` |
| `proxy.upstream.failed` | error | `/api/monitor/*`: the upstream `fetch` threw | `zone`, `method`, `path`, `upstream_host`, `duration_ms`, `timed_out`, `error`, `cause`, `error_code`, `outcome: "returned 502 upstream_unreachable"` |
| `stream.upstream.failed` | error | an SSE bridge's upstream `fetch` threw (not a client abort) | `stream` (`events`/`alerts`), `zone`, `upstream_host`, `duration_ms`, `timed_out`, `error`, `cause` |
| `stream.upstream.refused` | warn | an SSE upstream answered non-2xx (except 401/403) or without a body | `stream`, `zone`, `status`, `has_body` |
| `registry.read.stale` | warn | `GET /v1/zones` threw, and the last good read (< 5 min old) was served instead | `upstream_host`, `duration_ms`, `timed_out`, `cause`, `snapshot_age_ms` |
| `registry.read.failed` | error | `GET /v1/zones` threw with no recent good read to fall back on (control plane unreachable, non-JSON body) | `upstream_host`, `duration_ms`, `timed_out`, `error`, `cause` |
| `registry.read.malformed` | error | `GET /v1/zones` answered 2xx without a `data` array | `status`, `body_keys` |
| `client.error.boundary` | error | `app/error.tsx` caught a render error | `error`, `stack`, `digest`, `zone`, `path`, `page` |
| `client.error.global` | error | `app/global-error.tsx` — the root layout failed | as above |
| `client.error.uncaught` / `client.error.unhandled_rejection` | error | the SDK's own `window` handlers | SDK-defined (`message`, `stack`, `filename`, `lineno`, raw `path`) |
| `api.request.network_error` | error | an axios transport failure or timeout (never a status) | `method`, `path`, `url`, `zone`, `project`, `error_code`, `timed_out`, `timeout_ms`, `duration_ms` |
| `session.refresh.failed` | error | the refresh `fetch` threw (`doRefresh`), or the cross-tab Web Locks acquisition did — the session then ends either way. A non-2xx is NOT reported: monitor-core answered and logged it | `error`, `url`, `reason` (only on the lock failure), `outcome` |
| `sso_config.load.failed` | warn | `/auth/sso/config` 200 but not `{ providers: [...] }` (login, account security) | `expected`, `got_type`, `got_keys` |
| `live_tail.stream.failed` / `desktop_alerts.stream.failed` | warn | a stream gave up after `MAX_STREAM_ATTEMPTS` and the probe found **no** refusal (a refusal was already reported server-side) | `attempts`, `reason` |
| `live_tail.frame.parse.failed` / `desktop_alerts.frame.failed` | error | a stream frame threw — once per connection | `frame_length` (live) |
| `dashboard.config.parse.failed` | error | a stored dashboard layout is not JSON (renders empty; autosave would persist that) | `dashboard_id`, `config_length` |
| `saved_view.apply.failed` | error | a saved view's stored params are not JSON (the click does nothing) | `view_id`, `view_page` |
| `{resource}.{action}.failed` | error | any other `catch` that handled a throw (below) | the record ids involved + `outcome` |

The `catch` reports, all `error` via `reportError`: `events.load`, `event_chart.load`,
`event_filters.levels.load`, `event_detail.{context,trace,request}.load`,
`saved_view.{list,create,delete}`, `query_input.{labels,data_keys,data_values}.load`,
`health.poll`, `dashboard.{list,variables.load,save,duplicate,delete,widget.load}`,
`widget_editor.options.load`, `analytics.{load,data_keys.load}`,
`analytics_filters.{options,data_keys,data_values}.load`,
`performance.{load,drilldown.load}` (carrying `range` in its URL form and, for the drill-down,
`group_by`), `live_tail.filters.load`,
`alert_rule.{list,create,save,delete,duplicate,toggle,test}`, `alert_history.load`,
`notification_policy.{list,create,save,delete,duplicate,toggle,reorder}`,
`notification_channel.{list,create,delete,test}`,
`service_group.{list,create,save,delete,services.load}`, `issue_event.trace.load`,
`api_key.{list,create,delete}` — each suffixed `.failed`. Because `fetchApi` never throws, these
fire only on a throw in the app's own code around the call, which is exactly what nothing else
would record.

---

## 7. Ecosystem & related repos

| Repo | Relationship |
|---|---|
| `monitor-core` | The API this UI renders **and** authenticates against. Dashboard `req*` map to `/v1/*`; auth/admin `req*` map to `/auth/*` and `/admin/sso-providers`. Its auth model (cookies, JWT, SSO, roles) is documented in `monitor-core/AGENTS.md` §6 — keep the two in sync. |
| `go-monitor` / `monitor-js` | SDKs that produce the events this UI displays. `monitor-js` (`^1.2.0`) is **also a dependency here**: it carries this app's own self-telemetry to the **appleby** zone's ingest (§6 "Monitor self-telemetry"). |
| `monitor-mcp` | MCP server over the same API — an alternate client (dashboard/query surface only). |

---

## 8. Full API call inventory (for backend diffing)

**Dashboard data** (`services/api.ts` → `/api/monitor/*` → `${UPSTREAM}/*`). Every
`/v1/*` call below carries `?project=<slug>` when a project is selected, added by the
`api.service.ts` request interceptor — except the two registry reads:

- **Tenancy registry (reads):** `GET /v1/zones`, `GET /v1/zones/{zone}/projects` — ⚠️ these
  two must NOT carry `?project` (see §6); the interceptor excludes them. Both accept
  `?include_deleted=true`, which only `/settings/admin/registry` passes: a switcher must not offer a
  retired zone, and the admin page must not let a spent slug look free. `/settings` → AI
  integration also reads `GET /v1/zones` (every zone gets a snippet)
- **Tenancy registry (writes, admin only):** `POST /admin/zones`, `PUT /admin/zones/{id}`,
  `POST /admin/zones/{id}/retire`, `POST /admin/zones/{id}/probe`,
  `POST /admin/zones/{id}/projects`, `PUT /admin/projects/{id}`,
  `POST /admin/projects/{id}/retire` — ⚠️ **there is no DELETE verb on this surface and there
  must never be one**; `/settings/admin/*` never carries `?project`
- **Events/labels/data:** `GET /health`; `GET /v1/events` (level/from/to/limit/offset +
  Django `field__op`); `GET /v1/labels/{service|env|name|level}/values?from=`;
  `GET /v1/data/keys?service=&from=`; `GET /v1/data/values?key=&service=&from=`
  - `GET /health?zone=<slug>` is also sent once per zone by the scope switcher when it opens
    (`getZoneHealth`, explicit `zone`, 2.5 s timeout), and once by the AI integration tab to
    learn the control plane's own zone. `GET /v1/labels/service/values?from=&zone=` is read by
    the AI integration tab (`reqZoneServices`, 7d, explicit zone) and, lazily on open, by the
    service-group dialog (7d).
  - **The Events page is a deep-link target.** Plain top-level params `?service=`, `?name=`
    (exact match), `?level=`, and `?from=&to=` (the brush-zoom pair; ISO or epoch ms, both or
    neither; a reversed pair is ignored) — e.g.
    `/{zone}?service=api&level=error&from=2026-10-16T22:00:00Z&to=2026-10-16T23:00:00Z`.
    Every other chip stays inside `q`; `?event=<timestamp|service|name>` opens the detail panel.
    ⚠️ **Don't rename these** — other pages build them: the issue occurrence dialog's "View in
    Events →" (that occurrence's service + name, ±5 minutes — not the issue's lifetime, which can
    exceed retention), alert-history incidents' "View events →" (the rule's `eq`
    service/name/level filters over [start − interval − hold − 1m, resolved/now + 1m]; other
    filters are not carried, so it may show more than the rule counted, never less; no link for a
    deleted rule), analytics Top-N, and the live tail's row actions. Build them with
    `eventsHref(...)` (`components/issue/eventsHref.ts`) through `zoned(...)`. `issue_id` is not
    supported — `/v1/events` has no such filter. An `?event=` not on the current page is looked
    up with `GET /v1/events?service=&name=&from=<ts−1ms>&to=<ts+1ms>&limit=10`.
  - ⚠️ **The events table and the three suggestion reads are never sent unbounded.**
    Without `from`, each one scanned the project's whole 30-day retention — `/v1/data/keys`
    alone took 2.6 s in production — on every events-page load.
    - The events page's `GET /v1/events` always carries **both `from` and `to`**: the zoom
      when one is set, else a custom range's edges, else the preset resolved **inside
      `fetchEvents`** (`relativeFrom`) against an **anchor** — "now" for this query. Paging
      (Next/Prev/page jump) keeps the anchor, so page 2 is the same result set as page 1;
      every other fetch (filter change, Refresh, AutoRefresh, Search) takes a fresh one. The
      resolved window is handed to the chart as props, so **the table and the chart always
      show the same window**. Never store the resolved timestamp in the URL, in `filters` or
      in a saved view: it freezes AutoRefresh/Refresh on the old window.
    - The three suggestion reads send `from` only (no `to` = up to now), over a window
      **spec**: the page's selected range where it has one (performance's service list; the
      dashboard's variables, filter bar and widget editor; the analytics filter bar), else
      `SUGGESTION_WINDOWS` in `tools/timeRange.tools.ts` — **7d for labels, 24h for data
      keys/values**. Calling a getter without `opts` gets that default; every call site still
      passes `{ window: suggestionWindow(kind[, range]) }` so the window is greppable.
    - ⚠️ **A windowed list does not hold every value a filter can hold.** A saved dashboard
      variable, a service picked at 7d before switching to 1h, or a saved view's level can
      name a value with no events in the window. A controlled `<select>` whose value matches
      no `<option>` DISPLAYS the first one ("All") while the filter is still applied — every
      widget renders empty under a control that says nothing is filtered. So every `<select>`
      fed by a suggestion read renders `withSelected(list, value)`, which puts a missing
      selected value first.
  - **The suggestion reads are cached for 90 s in the browser** (`tools/cache.tools.ts`, only these three
    getters — never views, issues, dashboards or service-repos, which change under the
    user's own hand). The key is `zone::project::endpoint::window-spec` — the spec, not the
    resolved `from`, which would miss every time — and the same zone/project are sent
    explicitly so key and request cannot disagree. In-flight requests are shared, failures
    are never cached, and it is bypassed on the server.
  - ⚠️ **Because in-flight promises are shared, never cancel one with an AbortController.**
    It would cancel every other waiter's request too, and `fetchApi` reports a cancel as
    `network_error`. Supersede with a generation/`cancelled` guard at the call site.
  - **The suggestion reads are fetched lazily.** `QueryInput` loads labels + data keys on first focus or
    pointer-enter; `AnalyticsFilters` on the first "Add Filter" (or not at all when the page
    passes `options`, as the dashboard does); `SavedViews` loads `GET /v1/views` on first
    open. The only eager one on the events page is `EventFilters`' level list, which feeds
    a visible `<select>`. Events-page mount = `/auth/self`, `/health`, 2× `/v1/timeseries`,
    `/v1/labels/level/values`, `/v1/events` — six, one per HTTP/1.1 socket (`/auth/self`
    only on a full page load; client navigations do not repeat it — §5).
  - ⚠️ **The Navbar's zoned `<Link>`s (and the logo) are `prefetch={false}`** (`navPrefetch`
    in `components/Navbar.tsx`). Viewport prefetch of the zoned links was two `_rsc` requests
    each per load, queued behind the burst above. In Next 16 (checked on 16.1 and 16.4) `false` also disables the
    hover/touch prefetch, so a nav click fetches its RSC payload on click; navigation is still
    a client-side transition. Unzoned links (Account, the user menu) keep the default.
    Revisit when the edge serves HTTP/2.
- **Analytics (POST):** `/v1/analytics`, `/v1/timeseries`, `/v1/topn`, `/v1/gauge`, `/v1/compare`
  - ⚠️ **The `in` filter operator takes an ARRAY value** (`string[]`). The UI always sends one
    (`AnalyticsFilters` and `WidgetEditor` split, trim and drop empties). A comma string 500'd
    every analytics query on older cores; monitor-core now also accepts `"a, b,"` and answers a
    named 400 for any other shape or an empty list — but the array is the contract.
  - Percentile series go out with `fill_zeros:false` (§5 "Charts — gaps are not zeros").
  - The analytics page issues per load: 2 timeseries, 2 compare, 1 gauge (`count_unique`
    `user_id`) and 2–3 topn. The performance page's reads are bounded by its range; with Compare
    on it issues three more `/v1/analytics` (count, p95, timed count) over `[from − Δ, from]`
    and two more `/v1/timeseries` in the drill-down.
- **API keys:** `GET/POST /v1/api-keys`, `PUT /v1/api-keys/{id}` (rename only), `DELETE /v1/api-keys/{id}`
  — the list carries `last_used_at` (recorded server-side, up to a minute stale)
  — ⚠️ POST takes **`project_slug` in the BODY**, not the `?project` selector: the handler
  reads the body and falls back to the zone's default project when it is absent, so a key
  minted from a page showing `atlas` with nothing in the body is created in the *default*
  project, and nothing says so. The listing returns `project_slug` per row and the UI renders
  it — two keys bound to two tenants are otherwise indistinguishable on the page you revoke
  them from.
  — names are trimmed; blank → 400 `name is required`, over 255 characters → 400 (the UI caps
  renames at 100). An invalid `scope` on POST → 400.
- **Dashboards:** `GET/POST /v1/dashboards`, `GET/PUT/DELETE /v1/dashboards/{id}`
  - **Config shape** `{widgets, variables, range?, filters?}` (types in
    `components/dashboard/dashboard.tools.ts`). `range` is in `rangeToParam` form; older
    configs open on 24h with no filters. Widgets carry `size` (Quarter/Half/Full on a 12-column
    `grid-flow-row-dense` grid) and an optional `range_override`, captioned under the card.
    Duplicate inserts the copy after its source.
  - **The URL mirrors the view:** `?d=<id>&range=<spec>&filters=<json>`. On arrival a link's
    range and filters override the saved defaults of whichever dashboard opens — the one it
    names, the first one when `?d=` is absent or missing, or the empty draft (where the URL is
    normalised to what is on screen). They used to apply only to a named dashboard that
    existed, so `?range=7d` with no dashboards read 7d in the address bar and 24h on the
    picker; the link button
    copies `location.href`. Range and filter changes **do not autosave** — they mark the
    dashboard Unsaved, and Save (or the next autosave of a real edit) persists them as its
    default view. A rename alone does not create a dashboard; it stays "Draft" until the first
    widget or Create.
  - ⚠️ **Versioned saves.** Every dashboard carries an integer `version` (1 on create, +1 per
    update). `reqSaveDashboard` (`api.ts`, `// ── dashboard ──`) sends the `version` last read;
    a stale one is **409** with the CURRENT dashboard (incl. its version) in `data`, and the page
    opens a dialog: Load latest / Overwrite with mine (resend with that version) / Decide later.
    A PUT without `version` is last-write-wins. Saves are **serialised** (`saveChainRef`) and
    read id + version from refs — overlapping saves would otherwise 409 against the same tab
    (the second carries the version the first is about to bump) or double-POST a new
    dashboard. `GET /v1/dashboards/{id}` is read for conflict resolution.
  - ⚠️ **The autosave timer calls `saveDashboardRef.current()`, never a captured
    `saveDashboard`.** `triggerAutoSave` is called by the handler that has just *called*
    `setWidgets`, so any closure in scope there still holds the widgets from before the edit;
    the timer used to save the previous state and then show "Saved" — every PUT one edit
    behind. The ref is updated in an effect after every commit, so two seconds later it
    composes the current widgets/variables. The scope guard (§6) is unchanged.
  - Manage flushes any pending autosave on open and uses the on-screen config for the open
    dashboard. Each row has Export (copies JSON, kind `monitor.dashboard` v1); Import takes a
    paste or a `.json` file and always makes a NEW dashboard.
  - **Widget reads** (the analytics POSTs above, one per panel) are driven by one effect in
    `[zone]/dashboard/page.tsx`, keyed on primitives only: `[currentDashboard?.id,
    widgetIdsKey, selectedRange.label, filtersKey]` (`widgetIdsKey` = the widget ids
    joined; `filtersKey` = `JSON.stringify` of global + variable filters). Opening a
    dashboard, or changing the range or any filter value, fetches every panel once; adding
    or duplicating a widget fetches only the new panel; deleting fetches nothing; editing a
    widget fetches that panel from `handleUpdateWidget`. The first autosave of a new
    dashboard (id `undefined` → assigned) refetches nothing. Refresh/AutoRefresh fetch all;
    AutoRefresh skips a tick while the previous batch is still in flight (§5), which is
    what lets a batch slower than the interval land at all.
  - ⚠️ **Never key it on `widgets` or `allFilters.length`.** `widgets` makes every
    config-only edit refetch the whole dashboard; a length misses a changed filter value
    (the old `fetchWidgetData` deps did exactly that, and nothing fetched on load at all —
    every panel sat on its spinner until Refresh).
  - Each panel's request takes a per-widget generation (`widgetGenRef`); only the latest
    one writes state, so a slow response for an old range, an overtaken AutoRefresh tick
    or a deleted widget's in-flight read never lands. The Refresh spinner is cleared only
    by the newest batch (`batchGenRef`).
- **Saved views:** `GET /v1/views?page=`, `POST /v1/views`, `PUT /v1/views/{id}` (rename / overwrite query), `DELETE /v1/views/{id}`
  — the saved query never includes `offset`. The events page stores
  `{range, from?, to?, level?, limit?, ...chips}`: the range AND any zoom inside it, side by
  side. A legacy view (from/to with no `range`) loads as a custom range, so chart and table
  still agree.
- **Alert rules:** `GET/POST /v1/alert-rules`, `GET/PUT/DELETE /v1/alert-rules/{id}`, `POST /v1/alert-rules/{id}/test`
  — ⚠️ the test answers `{value, firing, threshold, condition, type}`: the field is **`firing`**
  (it was read as `would_fire`, so every test said "OK"). Metrics include `p50`/`p95`/`p99`.
  — 400s now start with the field name (`for_seconds must be a whole number of seconds between
  0 and 86400`, `threshold must be a number`, `threshold is required for threshold and
  rate_change rules`). Send `threshold` as a JSON number; omit it on PUT to leave it unchanged.
  — available but **not yet used here**: `POST /v1/alert-rules/preview-routing` (§6 "Alert
  routing preview").
- **Alert history:** `GET /v1/alert-history?rule_id=&limit=`. The alerts page also reads
  policies, channels and `GET /v1/service-groups` on mount, for the routing preview (one
  failure flag for the three).
- **Notification channels:** `GET/POST /v1/notification-channels`, `PUT …/{id}`, `DELETE …/{id}`, `POST …/{id}/test`
  — the test answers **`{ok, error?}`** in `data`: 400 for invalid config (the message names
  the key), 200 `{ok:false, error}` for a failed delivery, 200 `{ok:true}` when delivered (§6).
  Every channel carries `last_test_at` / `last_test_ok` / `last_test_error` (all null = never
  tested)
  — ⚠️ on `PUT`, **omit `config` to keep the stored credential**; the edit form starts its
  credential fields empty and only sends them when the user types one
  — ⚠️ the response carries **`config_summary`**, never `config`. The raw config is the
  channel's credential and monitor-core tags it `json:"-"`; POST still *sends* a `config`
  body. Reading one back is guarded (§5).
- **Service groups:** `GET/POST /v1/service-groups`, `PUT/DELETE …/{id}`
- **Notification policies:** `GET/POST /v1/notification-policies`, `PUT/DELETE …/{id}`, `PUT …/reorder`
- **Issues:** `GET /v1/issues?status=&service=&assignee=&has_pr=&q=&from=&to=&sort=&order=&history=&limit=&offset=`
  (`history=true` from the list view only — the board draws no activity strip),
  `POST /v1/issues/bulk`,
  `GET|PUT /v1/issues/{id}`, `GET /v1/issues/{id}/events?limit=`,
  `GET /v1/issues/{id}/timeline?limit=&offset=`, `GET /v1/issues/{id}/history?from=`,
  `POST /v1/issues/{id}/comments`, `PATCH|DELETE /v1/issues/{id}/comments/{commentID}`,
  `GET|POST /v1/issues/{id}/links`, `DELETE /v1/issues/{id}/links/{linkID}`
  - The list also issues `GET /v1/issues?status=<s>&limit=1` for the tab counts (same non-status
    filters) — ×3 on a status tab, whose own count is the main list's `pagination.count`, ×4 on
    All or the board; a tab switch re-reads none of them. The board issues `GET /v1/issues?status=<column>&limit=50&offset=`
    per column (there is no single limit=500 fetch any more).
  - After a **write** (status, priority, assignee, comment add/edit/delete, PR link/unlink) and
    on the timeline's Retry the detail page re-reads the issue and the timeline only; `/events`
    is re-read only by its own Retry (and the page-level one), since no write there changes it.
    ⚠️ A failed **re-read** keeps the issue on screen with a `FailureNote` + Retry under the
    `RefetchBar`; the full-page `FailureState` is for the first load of that id only. It used
    to replace the page, erasing the optimistic change the user had just made.
  - `/events`: the detail page starts at 20 and "Load more" grows the limit by 50 up to **500,
    the server clamp**. It sends no cursor, so past 500 it says so rather than offering a
    button (monitor-core now accepts `before=<RFC3339>` — not yet used here).
  - `/timeline` orders **ASC only**. The page reads `pagination.count`; past one page (500) it
    re-reads at `offset = count − 500` so the NEWEST entries show, and "Show older activity"
    pages backwards. Displayed newest-first.
  - `/history?from=` is read only when the 90d sparkline window is picked (`issue.history`
    covers 30d).
  - `GET /v1/events?trace_id=&from=&to=` (±1 day) from the occurrence dialog, on demand.
  - `GET /admin/users?limit=500` on the detail page is read on first focus/hover of the assignee
    picker, not on every view.
- **Service repositories:** `GET /v1/service-repos`, `GET|PUT|DELETE /v1/service-repos/{service}`
  — managed on `/{zone}/settings` (`ServiceReposTab`). `PUT` validates owner, repo and
  `default_branch` against GitHub/git rules (400 with a field message); a blank
  `default_branch` clears it
- **Streams (bypass [...path] proxy):** SSE `GET /v1/events/stream`, `GET /v1/alerts/stream`
- **Not monitor-core's API:** `POST /api/telemetry` is this app's self-telemetry relay to the
  appleby zone's ingest (§6). It never touches the upstream proxy or the session cookies.

**Auth** (`services/auth.service.ts` → `/api/monitor/*`, same client):

- `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh`, `POST /auth/logout`
- `GET /auth/self`, `PUT /auth/self` — the latter can answer **403 `4011 reauth_required`**
  when adding a first password (§6 Auth model). `proxy.ts` also reads `GET /auth/self`
  server-side, straight from the control plane, to forward a signed-in visitor off `/login`;
  `/pending` re-reads it every 30 s
- `GET /auth/self/identities`, `POST /auth/self/identities/{slug}`, `DELETE /auth/self/identities/{slug}`
- `GET /auth/sso/config`
- **Direct-to-backend (full-page redirect, NOT proxied):** `GET /auth/sso/{slug}/login`, also
  with `?prompt=login&return_url=/settings/security` for the step-up re-auth

**Admin** (`services/admin.service.ts` → `/api/monitor/*`, same client):

- `GET/POST /admin/sso-providers`, `PUT/DELETE /admin/sso-providers/{slug}`
- `GET /admin/users?role=&q=&limit=&offset=`, `PUT /admin/users/{id}` (`{role?, active?}`)

The registry writes are in `services/api.ts` rather than here, deliberately: they sit
immediately below `reqListZones`/`reqListProjects`, so the "no DELETE, ever" rule and the
"no slug on an update" rule are read next to the calls they constrain.

---

### The issues surface

`/errors` is Monitor's error tracker, not a log view: errors grouped by fingerprint, carrying
triage state, a comment thread, linked pull requests and occurrence history.

**Status is one four-value axis** — `unresolved`, `in_progress`, `resolved`, `ignored` — and
`unresolved` is also the backlog, which is why the UI labels it **"Open"**. There is no separate
backlog value to add. A recurrence reopens a `resolved` issue as a regression but leaves an
`in_progress` one alone, so picking work up is never undone by the error happening again;
`RegressionBadge` is what surfaces that, since a reopened issue otherwise just reads "Open" again.

**Clearing a field needs an explicit `null`.** `reqUpdateIssue` types its optional properties to
allow it because the API distinguishes `{priority: null}` (unset it) from an omitted key (leave it
alone). Sending `undefined` for a field you meant to clear silently does nothing.

**Bulk actions go through `POST /v1/issues/bulk` (`reqBulkUpdateIssues`), never a fan-out of
PUTs.** One call sets any of status (including back to Open), priority and assignee — an explicit
`null` clears priority/assignee, an omitted key leaves it; the page builds the change in
`bulkApply`. Admins get an assignee picker (the user list is admin-only); everyone else who can
write gets "Assign to me". Selection has two modes. *Ids*: rows ticked individually, Shift-click to extend a range
from the last plain click (the range takes the state the clicked row is moving to), or the
"Select page" header checkbox. *All matching*: once a whole page is selected and the total is
larger, the bar offers "Select all N matching", which switches the request to the list's current
filters (`currentFilter`) instead of ids. That mode always dry-runs first and confirms the
**dry-run** count in a modal (the list total includes issues already at the target status),
then repeats the call until `remaining` is 0 — the API moves at most 1000 per pass. It is not
offered over an unfiltered list, because the API refuses a filter that narrows nothing. Any
filter change or page change clears the selection and the mode.

**Every bulk change confirms, and the ids path offers Undo.** The confirm (`useConfirm`) names the
count, the target and the consequence. Undo replays each issue's prior value from the in-memory
copy taken before the write, grouped by prior value, through `POST /v1/issues/bulk` — one call per
distinct prior value (at most four for a status), never a per-issue PUT. The "all matching" path
keeps its dry-run modal and has no undo.

**The board fetches each column by its own status, with the server's count.** It used to split
one fetch made under the list's status tab, so on the default Open tab the Active and Resolved
columns always read "0 · Nothing here" — a false empty — and it stopped at 500. The status tabs
are hidden in board view; ignored issues are summarised under the board. The header count renders
only after a successful load and shows "—" while a refetch is in flight (the status label changes
on click, and the old total would sit under the new filter's name).

**`?assignee=me` stays `me` in the URL** and resolves to the viewer's id only on the wire, so a
shared "my queue" link opens the recipient's queue. The list waits for the user to load before
fetching rather than briefly showing everyone's issues.

**Keyboard triage:** `j`/`k` move a cursor (it focuses the row's link, so Enter opens natively),
`x` toggles selection, `e`/`i`/`a` resolve/ignore/assign-to-me on the selection or the cursor row —
through the same confirm. Registered with `useRegisterShortcuts` (§5); viewers get only the read
keys.

**Occurrences that look like duplicates usually aren't.** Two events a millisecond apart with the
same message are typically one per container (lattice-api's `container.log.error` fires once per
DB container). The detail page's event rows never dedupe; they show millisecond timestamps, a
`−Nms` gap to the newer row, and the values of the tag keys that differ across the loaded list
(`distinguishingKeys`).

**Timeline status changes render from `metadata.from`/`to`** as status badges, not from the body
sentence, which carries backend enums (`in_progress`). Older entries without metadata get the
enums mapped through `STATUS_LABELS`.

**Comments are capped at 10,000 characters** (`COMMENT_MAX_LENGTH`). The `body` column is MariaDB
TEXT (65,535 bytes); monitor-core now refuses a longer body (or a blank one) with a 400 on create
and edit, and the client cap keeps the user from typing past it.

**Comments can be edited or deleted by their author or an admin only** — monitor-core enforces
it (403); the timeline hides the controls on anyone else's comment via `canModify`.

**An issue's display title** is `issueTitle()` (`tools/issue.tools.ts`): a bare 5xx
`http.request.end` has message == name, so its route becomes the title. Display-only, because
the message feeds monitor-core's fingerprint.

**`dedupe_key` on comments is for automated callers, not the UI.** It makes a comment write
idempotent per key, so a retrying agent updates its note instead of leaving a fifth copy. The UI
deliberately does not send one — a person clicking "Comment" twice means two comments.

**Both pages fetch inside the effect with a cancellation flag**, and every `setState` happens
after the first `await`. That satisfies `react-hooks/set-state-in-effect` and, more usefully,
stops a slow response for old filters overwriting a fast one for new filters. Pagination and
selection reset in the event handler that changed the filter, not in an effect watching it.

**The occurrence sparkline reads a rollup with no retention limit**, so it still has shape for an
issue whose raw events expired weeks ago — that is the point of it. The API omits empty days
rather than zero-filling, so `OccurrenceSparkline` fills the gaps itself; rendering only the
returned days would misread a burst as continuous activity.

## 9. Rules & guardrails + known gaps

**Rules**
- Dashboard endpoints go in `services/api.ts`; auth/admin endpoints in
  `auth.service.ts`/`admin.service.ts`. Both sit on the **same** axios client. Keep
  components imperative.
- Don't introduce SWR/React Query or a component library (house standard).
- ⚠️ **There is exactly ONE HTTP client — `api.service.ts` — and every layer goes through
  it.** `services/api.ts` holds no transport of its own; it is a set of `fetchApi` call
  sites. This is not tidiness. `api.ts` used to carry a private raw-`fetch` client whose
  401 handler redirected straight to `/login` while the axios client refreshed, so
  whichever fired first after the access token expired decided whether the user was
  renewed or logged out — the bug commit `c68b6c4` removed. Every cross-cutting concern
  (CSRF, the 401 refresh single-flight, 403 routing, **and the `?project` selector**) is
  registered on that one instance, so a second transport does not merely duplicate code:
  it silently opts its call sites out of tenancy scoping. Do not reintroduce one, and do
  not rebuild the instance to change its `baseURL` — that re-registers the interceptors.
- Same-origin only for XHR — never call `monitor-core` directly from the browser except
  the deliberate full-page **SSO login redirect** (which must hit the API host so its
  `Set-Cookie` lands).
- Zone-scoped pages live under `src/app/[zone]/`; `/login`, `/pending`, `/unauthorized`,
  `/settings/*` and `/api/*` stay at the root. Adding a page means deciding
  which it is. **If the page reads or writes anything per project — API keys are the
  worked example — it is zone-scoped, and mounting it at the root does not make it
  install-wide, it makes it silently one tenant's.**
- ⚠️ **Never read the project selector by hand on a zone page.** `useScope()` only.
  Reading `?project` gives you the right string and a component that never remounts;
  `scripts/guards.mjs` fails the build on it. Never "fix" a scope bug by adding `project`
  to a dependency array — see §6.
- ⚠️ **Never render a notification channel's `config`.** It is the credential and
  monitor-core does not serialise it; `config_summary` is the safe, server-built,
  fail-closed description. Guarded by `scripts/guards.mjs`.
- Never widen the `?project` interceptor past `/v1/*`, and never turn it into a denylist.
  Never add the param to `GET /v1/zones*`. `routesToZone` is a **different** predicate —
  widening one is not licence to widen the other.
- ⚠️ **Dialogs use `components/ui/modal.tsx`.** A bare fixed-position div with an overlay
  looks identical and is unusable with a keyboard: focus stays behind the backdrop, Tab
  walks into the page underneath, Escape does nothing, and a screen reader announces no
  dialog at all. `ZoneFormModal` and `ProjectFormModal` were both that shape, and their
  backdrops stayed live **while saving** — a stray click discarded a fully typed two-URL
  form mid-request. Any dialog with an in-flight write must neuter `onClose` while it runs.
- ⚠️ **A dialog opened from a zone-agnostic page builds its links from the ROW, not the
  route.** `/settings/admin/registry` has no zone in its path, so `useZoneHref`/`useScope` there
  either throw or fall back to the remembered zone — producing a link that works, lands
  somewhere real, and shows a different tenant's data.
- Don't touch `Dockerfile`/`.github/workflows/` unless asked. Don't create/edit `.env`.
- Any change to the auth surface (cookies, endpoints, roles) must stay in lockstep with
  `monitor-core/AGENTS.md` §6 and be reflected in §6/§8 here.
- ⚠️ **Self-telemetry reads `MON_TELEMETRY_*`, never `MONITOR_*`** — stack 30's
  `MONITOR_API_KEY` is the trailblaze zone's ingest master key (§6). Never put a Monitor key in
  a `NEXT_PUBLIC_*` variable; browser events go through `/api/telemetry`.
- **A new `catch` that swallows a throw reports it:**
  `reportError("{resource}.{action}.failed", err, { …ids, outcome })` — stable, lowercase, ids
  in `data` and never in the name. A deliberately silent catch gets a one-line comment saying
  why. Never pass a request/response body, a form value, a key, or a channel `config`.
- **Do not report `!res.success` branches or status codes** — monitor-core logged them — and
  never add pageview, navigation or success events.
- Server-side events go through `serverError` / `serverWarn` (coalesced), and always carry the
  `zone` when there is one — it is the coalescing scope.
- ⚠️ **Page state that belongs in the URL goes through `useUrlState`, never `router.replace` /
  `router.push`.** On a dynamic `[zone]` route those refetch the RSC payload and re-run the
  registry check on every write (every keystroke of a search box). And **never** use it — or
  any hand-written URL write — for `project` or `zone`; the hook throws for both (§5 "URL
  state").
- **Copy with `copyText`, never `navigator.clipboard` directly**; its toast label names what
  was copied, never the value (§5 "Clipboard").
- **Every route segment gets a metadata-only `layout.tsx` title**, and a segment under a
  titled parent uses `title: { absolute: … }` (§5 "Page titles").
- **A page that binds keys registers them** with `useRegisterShortcuts` beside the handler,
  with a module-constant array (§5 "Keyboard shortcuts").
- ⚠️ **A percentile/average series is never zero-filled** — `fill_zeros:false` + `interval`
  on the chart; an empty bucket is a gap (§5 "Charts").
- ⚠️ **`in` filters send arrays** (§8 "Analytics").
- ⚠️ **`McpTab`'s `MCP_TOOLS` is generated** — regenerate from the published package, never
  hand-edit (§5 "The MCP tab").
- ⚠️ **Don't move `position: fixed` UI inside the navbar's `<header>`** — its
  `backdrop-filter` makes it the containing block; portal to `<body>` or render as a sibling
  (§3 "Navigation").
- **When monitor-core's alert router changes, `previewRouting` changes with it** — or the page
  moves to `POST /v1/alert-rules/preview-routing` (§6 "Alert routing preview").

**Known gaps**

- **Events table sort.** The table is newest-first only. monitor-core now accepts
  `GET /v1/events?order=asc|desc` (default `desc`, anything else 400), but nothing here sends it
  yet; "Oldest first" is a UI change away.
- **Issue events past 500.** monitor-core now accepts `GET /v1/issues/{id}/events?before=<RFC3339>`
  (strictly older than); the detail page still stops at the 500 clamp and says so.
- **Routing preview duplication.** See §6 "Alert routing preview" — the server endpoint exists;
  the TypeScript mirror is still what the page uses.
- **Issue priority cannot be filtered**: `GET /v1/issues` has no `priority` param.
- **The MCP tool-list generator is not committed** — the procedure is in §5 "The MCP tab";
  checking it in as `scripts/mcp-tools.mjs` would make regeneration one command.
- **Most dashboard pages are not on the token layer** (§3); converted opportunistically.

**Zone routing env** — `.env.example` documents both of these, with the reasoning below.

- **`MONITOR_API_INTERNAL_URL`** — the control plane's container-network origin, used by
  every server-side hop. Falls back to `NEXT_PUBLIC_MONITOR_API_URL`, then
  `http://localhost:8080`. Three files read this same expression — `services/upstream.server.ts`,
  `services/registry.server.ts` and `proxy.ts` (the `/login` session check and the legacy-link
  zone lookup); keep them in step. The SSE bridges and `/auth/refresh` import from
  `upstream.server.ts`.
- **`MON_LOCAL_ZONE`** (default `trailblaze`) — the zone this deployment's own
  `monitor-core` also serves under `MON_ROLE=both`. Requests for it use the internal
  `CONTROL_PLANE` address instead of its registered `query_url`. Set it explicitly if the
  control plane's own zone is renamed, or to `""` on a pure `MON_ROLE=app` control plane.
  Getting it wrong is not silent: the zone either hairpins through the public edge or
  502s with `zone_unroutable`.
- **Every other zone needs a `query_url` in the registry** (Admin → Registry). A zone
  with no endpoint recorded is unroutable by design — its pages 502 rather than
  rendering another zone's data.

**Telemetry env** — `MON_TELEMETRY_INGEST_URL`, `MON_TELEMETRY_API_KEY`, `MON_TELEMETRY_ENV`:
see §6 "Monitor self-telemetry" for meaning and the Lattice mapping. Unset → telemetry off, app
unaffected. `.env.example` lists them, commented out.

**Resolved integration notes** (kept for context; all fixed in the auth-overhaul change)
- **`/pending` page** — now exists at `src/app/pending/page.tsx` (403 `error_code 4004` target).
- **`NEXT_PUBLIC_MONITOR_API_URL`** must be the real `monitor-core` origin (the server proxy
  `UPSTREAM` and the login page's SSO full-page-redirect base both read it). `.env.example`
  now documents this correctly and defaults to `http://localhost:8080`.
- **`current_password`** — `reqUpdateSelf` sends it on a password change and `monitor-core`'s
  `HandleUpdateSelf` now verifies it against the existing hash before updating (first-time
  password set on an SSO account does not require it).
- **403 routing** — `monitor-core` now emits `error_code` `4003` (role denial → `/unauthorized`)
  and `4004` (pending → `/pending`) via `responder.ErrorWithCode`, matching the axios/native
  interceptors.

---

## 10. Verification

```bash
npm ci                 # public registry only — no token needed
npx next build         # must succeed (fix TS errors)
npx tsc --noEmit
npm run lint           # eslint + scripts/guards.mjs — a guard violation exits non-zero
npm run guards         # the static guards alone
```

A green guard run prints the file count it examined
(`✔ guards: 3 checks passed (399 files scanned)` as of 2026-10-18). **A sudden drop in that number is worth
looking at even when the run passes** — each guard also enforces a coverage floor and
fails with "THIS GUARD IS BROKEN, NOT THE CODE" if its scan root stops resolving, because
a check that has quietly stopped checking is indistinguishable from a clean codebase.

Every job runs on `[self-hosted, lattice-worker]`: a single-use runner started by
`aidenappl/gh-runner-broker` on the CI host (`aplb-actions`, 10.15.10.78), with the toolchain
provisioned by `TeamTrailblaze/runner-setup` and a shared tool cache for `setup-node`. The
image builds through the host's `lattice-builder` BuildKit (`builder: lattice-builder`), not
`docker/setup-buildx-action`, which races other runners on the shared Docker daemon; its
local layer cache replaces the gha cache, which fails through a remote builder. Jobs stuck
in "Queued" mean the broker or the host is down — check `gh-runner-broker` in Monitor
(zone `appleby`).

CI (`.github/workflows/ci.yml`) gates PRs; `build-and-deploy.yml` deploys on `main` —
it builds the image to `registry.appleby.cloud/monitor-web` and then **triggers the
redeploy itself** via `POST LATTICE_DEPLOY_URL?container=monitor-web&commit=<sha>`, the
same step every other service uses. Keep it identical, with one exception: the build step
also passes `secrets:` because this Dockerfile mounts `MONITOR_API_KEY` via
`--mount=type=secret` for `next build`. Dropping that line to "match" the others breaks the
build. (`npm ci` needs no secret since the FontAwesome Pro kit was removed.)
Two prerequisites live outside this repo: the `LATTICE_DEPLOY_URL` repo secret, and an
active deploy token on the Lattice stack — `monitor-web` and `monitor-core` share one
stack ("Trailblaze Monitor"), so one token and one URL cover both. A green run with no
visible change means checking that token's `last_used_at`. Deploys go through CI, not by
hand from here — and a push/merge that triggers one happens only after asking Aiden and
getting an explicit yes (see `~/CLAUDE.md` *Ask-first actions*); verify it landed afterward.
If your change altered structure, commands, the §8 API call set, or the auth model,
update this `AGENTS.md` and `README.md` in the same change.

---

## 11. Keeping this file updated

Any change to structure, stack, commands, the §8 API call inventory, or the auth model
MUST update this file in the same change. Stale docs mislead every future agent, which is
worse than no docs.
