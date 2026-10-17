"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getHealth, reqListZones, reqZoneServices } from "@/services/api";
import type { Zone } from "@/types";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faCopy,
    faCheck,
    faRobot,
    faTerminal,
    faCircleInfo,
    faChevronDown,
    faArrowUpRightFromSquare,
} from "@fortawesome/free-solid-svg-icons";
import { FailureNote } from "@/components/FailureState";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { copyText } from "@/tools/clipboard.tools";

// ─── The tool list ──────────────────────────────────────────────────────────
//
// ⚠️ GENERATED FROM THE PUBLISHED PACKAGE — DO NOT EDIT BY HAND. It used to be a
// hand-kept array that said 32 tools while the package shipped 60, missing
// monitor_get_issue_timeline, which Monitor's own MCP instructions say to call
// first. Source: `npm pack monitor-mcp`, every `server.tool(name, description)`
// in its index.js, grouped by the file's `// ==== SECTION ====` banners, each
// description cut to its first sentence. Regenerate on a monitor-mcp release
// (the script is recorded in the tophat account.docs.md) and bump the version.
// The package is read as TEXT; nothing from it is executed.

const MCP_PACKAGE_VERSION = "1.7.0";

const MCP_TOOLS: { category: string; tools: { name: string; description: string }[] }[] = [
    {
        category: "Health & tenancy",
        tools: [
            { name: "monitor_health", description: "Check Monitor API health" },
            { name: "monitor_list_zones", description: "List the zones the answering process knows about" },
            { name: "monitor_list_projects", description: "List the active projects inside one zone" },
        ],
    },
    {
        category: "Discovery",
        tools: [
            { name: "monitor_list_services", description: "List all services sending events to Monitor" },
            { name: "monitor_list_environments", description: "List all environments (e.g. prod, staging, dev) that have sent events" },
            { name: "monitor_list_event_names", description: "List all event names (e.g. http.request, db.query, user.login)" },
            { name: "monitor_list_levels", description: "List all log levels in use (e.g. info, warn, error, fatal)" },
            { name: "monitor_list_users", description: "List all user IDs that have generated events" },
        ],
    },
    {
        category: "Data fields",
        tools: [
            { name: "monitor_get_data_keys", description: "List all custom data field keys present in events" },
            { name: "monitor_get_data_values", description: "List distinct values for a specific data field key" },
        ],
    },
    {
        category: "Event search",
        tools: [
            { name: "monitor_search_events", description: "Search and filter events" },
            { name: "monitor_trace", description: "Get all events for a specific trace ID" },
            { name: "monitor_request", description: "Get all events for a specific request ID" },
        ],
    },
    {
        category: "Analytics",
        tools: [
            { name: "monitor_count", description: "Count events matching filters" },
            { name: "monitor_analytics", description: "Run an analytics aggregation query with optional grouping" },
            { name: "monitor_timeseries", description: "Get event data as a time series for trend analysis" },
            { name: "monitor_topn", description: "Get the top N values for a field" },
            { name: "monitor_compare", description: "Compare metrics between two time periods" },
        ],
    },
    {
        category: "Quick diagnostics",
        tools: [
            { name: "monitor_recent_errors", description: "Get the most recent error and fatal events" },
            { name: "monitor_error_breakdown", description: "Break down errors by event name or service" },
            { name: "monitor_error_trend", description: "Show error count over time" },
            { name: "monitor_service_overview", description: "Get a high-level overview of a service: total events, error count, error rate, and top event names" },
        ],
    },
    {
        category: "Issues",
        tools: [
            { name: "monitor_list_issues", description: "List error issues grouped by fingerprint" },
            { name: "monitor_get_issue", description: "Get full details of an issue" },
            { name: "monitor_update_issue", description: "Update an issue's triage state" },
            { name: "monitor_bulk_update_issues", description: "Change many issues in a single call" },
            { name: "monitor_get_issue_events", description: "Get individual event occurrences behind a grouped issue, with their full data payloads" },
            { name: "monitor_get_issue_timeline", description: "Get an issue's activity feed, oldest first" },
            { name: "monitor_add_issue_comment", description: "Add a note to an issue's timeline" },
            { name: "monitor_edit_issue_comment", description: "Replace the body of an existing comment" },
            { name: "monitor_delete_issue_comment", description: "Soft-delete a comment" },
            { name: "monitor_get_issue_history", description: "Get per-day occurrence counts for an issue" },
            { name: "monitor_list_issue_links", description: "List the GitHub pull requests, issues and commits linked to an issue, with their cached state (open/closed/merged)" },
            { name: "monitor_link_issue_pr", description: "Link a GitHub pull request, issue or commit to a Monitor issue" },
            { name: "monitor_unlink_issue_pr", description: "Remove a link from an issue" },
        ],
    },
    {
        category: "Service repositories",
        tools: [
            { name: "monitor_list_service_repos", description: "List which source repository each reporting service is built from" },
            { name: "monitor_set_service_repo", description: "Map a service to its source repository" },
            { name: "monitor_delete_service_repo", description: "Remove a service's repository mapping" },
        ],
    },
    {
        category: "API keys",
        tools: [
            { name: "monitor_list_api_keys", description: "List all API keys for the Monitor instance" },
            { name: "monitor_create_api_key", description: "Create a new API key" },
            { name: "monitor_delete_api_key", description: "Delete an API key by ID" },
            { name: "monitor_rename_api_key", description: "Rename an API key" },
        ],
    },
    {
        category: "Alert rules",
        tools: [
            { name: "monitor_list_alert_rules", description: "List all configured alert rules with their current state (enabled/disabled, firing status, thresholds)" },
            { name: "monitor_test_alert_rule", description: "Test an alert rule by evaluating it against current data" },
            { name: "monitor_create_alert_rule", description: "Create a new alert rule" },
            { name: "monitor_update_alert_rule", description: "Update an existing alert rule" },
            { name: "monitor_delete_alert_rule", description: "Delete an alert rule by ID" },
            { name: "monitor_list_alert_history", description: "List alert firing history" },
        ],
    },
    {
        category: "Notification channels",
        tools: [
            { name: "monitor_list_notification_channels", description: "List all notification channels" },
            { name: "monitor_create_notification_channel", description: "Create a notification channel that alert rules can notify" },
            { name: "monitor_delete_notification_channel", description: "Delete a notification channel by ID" },
            { name: "monitor_update_notification_channel", description: "Edit a notification channel" },
        ],
    },
    {
        category: "Accounts & SSO",
        tools: [
            { name: "monitor_get_sso_config", description: "List the public SSO login options" },
            { name: "monitor_list_sso_providers", description: "List all SSO providers with their full admin configuration" },
            { name: "monitor_create_sso_provider", description: "Create an SSO provider" },
            { name: "monitor_update_sso_provider", description: "Update an SSO provider by slug" },
            { name: "monitor_delete_sso_provider", description: "Delete an SSO provider by slug" },
            { name: "monitor_list_accounts", description: "List Monitor accounts with their sign-in providers, pending first" },
            { name: "monitor_update_account", description: "Change a Monitor account's role or active flag" },
            { name: "monitor_get_self", description: "Get the currently authenticated Monitor user and their linked sign-in identities" },
        ],
    },
];

const MCP_TOOL_COUNT = MCP_TOOLS.reduce((a, c) => a + c.tools.length, 0);

// ─── The snippet ────────────────────────────────────────────────────────────

// SSO and the control-plane zone's public origin. Same value the login page's
// SSO redirect uses.
const PUBLIC_API = (process.env.NEXT_PUBLIC_MONITOR_API_URL || "").replace(/\/+$/, "");
const URL_PLACEHOLDER = "https://YOUR-ZONE-API-URL";
const KEY_PLACEHOLDER = "YOUR_API_KEY_HERE";

/**
 * The mcpServers key. ⚠️ ZONE-SPECIFIC ON PURPOSE: it was always "monitor", so
 * wiring up a second zone pasted a second "monitor" entry that silently replaced
 * the first — the operator ends up with one server, pointed at whichever zone
 * they configured last.
 */
function serverName(zoneSlug: string): string {
    return zoneSlug ? `monitor_${zoneSlug.replace(/[^a-z0-9_-]/gi, "_")}` : "monitor";
}

function mcpJson(name: string, apiUrl: string): string {
    return JSON.stringify(
        {
            mcpServers: {
                [name]: {
                    command: "npx",
                    args: ["-y", "monitor-mcp"],
                    env: { MONITOR_API_URL: apiUrl, MONITOR_API_KEY: KEY_PLACEHOLDER },
                },
            },
        },
        null,
        2
    );
}

function claudeCli(name: string, apiUrl: string): string {
    return [
        `claude mcp add ${name} --scope user \\`,
        `  -e MONITOR_API_URL=${apiUrl} \\`,
        `  -e MONITOR_API_KEY=${KEY_PLACEHOLDER} \\`,
        `  -- npx -y monitor-mcp`,
    ].join("\n");
}

const CLIENTS = [
    { id: "claude-code", label: "Claude Code" },
    { id: "desktop", label: "Claude Desktop" },
    { id: "json", label: "Cursor & others" },
] as const;
type ClientId = (typeof CLIENTS)[number]["id"];

// ─── Zones ──────────────────────────────────────────────────────────────────

interface ZoneOption {
    slug: string;
    label: string;
    /** The URL an MCP server should talk to, or null when there is none. */
    url: string | null;
    /** Why `url` is null — shown in the picker rather than dropping the zone. */
    reason?: string;
}

/**
 * Every zone in the registry, with an API URL where one can be named.
 *
 * ⚠️ The picker used to keep only zones with a `query_url`, which silently
 * dropped `trailblaze` — the busiest zone, and the one the snippet was first
 * written for. Its row predates the endpoint columns; it is served by the
 * control plane itself (MON_LOCAL_ZONE), so its URL is the control plane's
 * public origin. That is decided by asking the control plane which zone it
 * serves (`/health` on a zone-agnostic page reaches the control plane), not
 * by assuming. Anything else without a URL stays listed, disabled, with why.
 */
function toOptions(zones: Zone[], localZone: string | null): ZoneOption[] {
    return zones.map((z) => {
        const label = z.display_name || z.slug;
        if (z.status !== "active") return { slug: z.slug, label, url: null, reason: "retired" };
        if (z.query_url) return { slug: z.slug, label, url: z.query_url };
        if (localZone === z.slug && PUBLIC_API) return { slug: z.slug, label, url: PUBLIC_API };
        return { slug: z.slug, label, url: null, reason: "no API URL in the registry" };
    });
}

export function McpTab() {
    const [copied, setCopied] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [client, setClient] = useState<ClientId>("claude-code");
    const snippetRef = useRef<HTMLPreElement>(null);

    // One MCP entry talks to ONE zone (and one project — the key's).
    const [options, setOptions] = useState<ZoneOption[]>([]);
    const [zoneSlug, setZoneSlug] = useState("");
    const [zonesError, setZonesError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const [zonesRes, healthRes] = await Promise.all([reqListZones(), getHealth()]);
            if (cancelled) return;
            if (!zonesRes.success) {
                setZonesError(zonesRes.error_message || "The request failed.");
                return;
            }
            setZonesError(null);
            // A failed /health only costs the local zone its URL; it stays
            // listed with the reason, which is the honest answer.
            const local = healthRes.success ? healthRes.data.zone ?? null : null;
            const list = toOptions(zonesRes.data ?? [], local);
            setOptions(list);
            setZoneSlug((cur) => cur || list.find((o) => o.url)?.slug || "");
        })();
        return () => {
            cancelled = true;
        };
    }, [reloadToken]);
    const zone = options.find((o) => o.slug === zoneSlug);
    const name = serverName(zoneSlug);
    const apiUrl = zone?.url || URL_PLACEHOLDER;
    const hidden = options.filter((o) => !o.url).length;

    // Example prompts name services that actually report to the chosen zone.
    // A failed read falls back to placeholder names — these are illustrations,
    // not data, so there is no "empty" to misreport.
    const [services, setServices] = useState<string[]>([]);
    useEffect(() => {
        if (!zoneSlug) return;
        let cancelled = false;
        void reqZoneServices(zoneSlug).then((res) => {
            if (cancelled) return;
            setServices(res.success ? (res.data ?? []).slice(0, 2) : []);
        });
        return () => {
            cancelled = true;
        };
    }, [zoneSlug]);
    const svcA = services[0] ?? "my-api";
    const svcB = services[1] ?? services[0] ?? "my-worker";

    const snippet = client === "claude-code" ? claudeCli(name, apiUrl) : mcpJson(name, apiUrl);

    const handleCopy = async () => {
        const ok = await copyText(snippet, { label: "MCP config" });
        if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            return;
        }
        // The toast says copy by hand; select it so that is one keystroke.
        const el = snippetRef.current;
        const sel = typeof window !== "undefined" ? window.getSelection() : null;
        if (el && sel) {
            const range = document.createRange();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
            el.focus();
        }
    };

    const toggle = (category: string) =>
        setExpanded((cur) => {
            const next = new Set(cur);
            if (next.has(category)) next.delete(category);
            else next.add(category);
            return next;
        });

    const code = "text-xs bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded font-mono break-all";

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    AI Integration
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    Connect an MCP client — Claude Code, Claude Desktop, Cursor — to
                    Monitor with the <code className={code}>monitor-mcp</code> server.
                    It can then query events, triage issues and diagnose services
                    directly.
                </p>
            </div>

            {/* Setup instructions */}
            <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
                    <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                        <FontAwesomeIcon icon={faTerminal} className="text-blue-500 text-xs" />
                        Setup
                    </h3>
                </div>
                <div className="p-4 space-y-4">
                    <div className="space-y-2">
                        <label
                            htmlFor="mcp-zone"
                            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                        >
                            Zone
                        </label>
                        {zonesError ? (
                            <FailureNote
                                what="the zones"
                                message={zonesError}
                                onRetry={() => setReloadToken((t) => t + 1)}
                            />
                        ) : (
                            <>
                                <select
                                    id="mcp-zone"
                                    value={zoneSlug}
                                    onChange={(e) => setZoneSlug(e.target.value)}
                                    disabled={options.length === 0}
                                    aria-describedby="mcp-zone-hint"
                                    className="w-full sm:w-auto min-h-10 sm:min-h-0 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-base sm:text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                                >
                                    {options.length === 0 && <option value="">Loading…</option>}
                                    {options.map((o) => (
                                        <option key={o.slug} value={o.slug} disabled={!o.url}>
                                            {o.label}
                                            {o.reason ? ` — ${o.reason}` : ""}
                                        </option>
                                    ))}
                                </select>
                                <p id="mcp-zone-hint" className="text-xs text-zinc-500 dark:text-zinc-400">
                                    One server entry talks to one zone. Set up each zone you
                                    use as its own entry — they are named per zone, so they
                                    sit side by side.
                                    {hidden > 0 &&
                                        ` ${hidden} zone${hidden === 1 ? " can't" : "s can't"} be used yet; the reason is shown in the list.`}
                                </p>
                            </>
                        )}
                    </div>

                    <ol className="space-y-3 text-sm text-zinc-600 dark:text-zinc-400 list-decimal pl-5">
                        <li>
                            Open{" "}
                            {zone?.url ? (
                                <Link
                                    href={`/${zoneSlug}/settings`}
                                    className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                                >
                                    {zone.label} → Zone settings
                                </Link>
                            ) : (
                                "the zone's settings"
                            )}
                            , pick the project you want in the header&apos;s scope control,
                            and create an{" "}
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">admin</span>
                            -scope key. A key is bound to the project it was created in,
                            permanently, and reads only that project.
                        </li>
                        <li>
                            Add the server to your client, replacing{" "}
                            <code className={code}>{KEY_PLACEHOLDER}</code> with the key:
                        </li>
                    </ol>

                    <Tabs
                        id="mcp-client"
                        label="MCP client"
                        items={CLIENTS.map((c) => ({ id: c.id, label: c.label }))}
                        value={client}
                        onChange={setClient}
                    />
                    <TabPanel tabsId="mcp-client" value={client} className="space-y-3">
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            {client === "claude-code" && (
                                <>
                                    Run this in a terminal. <code className={code}>--scope user</code>{" "}
                                    makes it available in every project; use{" "}
                                    <code className={code}>--scope project</code> to write it to the
                                    repo&apos;s <code className={code}>.mcp.json</code> instead.
                                </>
                            )}
                            {client === "desktop" && (
                                <>
                                    Add this to <code className={code}>claude_desktop_config.json</code>{" "}
                                    — on macOS{" "}
                                    <code className={code}>~/Library/Application Support/Claude/</code>, on
                                    Windows <code className={code}>%APPDATA%\Claude\</code> (Settings →
                                    Developer → Edit Config opens it).
                                </>
                            )}
                            {client === "json" && (
                                <>
                                    Cursor reads <code className={code}>~/.cursor/mcp.json</code>; a Claude
                                    Code project reads <code className={code}>.mcp.json</code> at the repo
                                    root. Any other MCP client takes the same entry under its{" "}
                                    <code className={code}>mcpServers</code> object.
                                </>
                            )}
                            {client !== "claude-code" && (
                                <>
                                    {" "}
                                    If the file already has <code className={code}>mcpServers</code>, add
                                    just the <code className={code}>{name}</code> entry to it.
                                </>
                            )}
                        </p>

                        <div className="relative">
                            <pre
                                ref={snippetRef}
                                tabIndex={0}
                                aria-label="MCP configuration"
                                className="bg-zinc-900 dark:bg-zinc-950 rounded-lg p-4 pr-24 text-xs sm:text-sm font-mono text-zinc-100 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                            >
                                {snippet}
                            </pre>
                            <button
                                type="button"
                                onClick={handleCopy}
                                aria-label="Copy MCP configuration"
                                title="Copy MCP configuration"
                                className="absolute top-2 right-2 inline-flex min-h-9 items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                            >
                                <FontAwesomeIcon icon={copied ? faCheck : faCopy} className="text-xs" />
                                {copied ? "Copied" : "Copy"}
                            </button>
                        </div>

                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            {client === "claude-code" && (
                                <>
                                    3. Start a new Claude Code session and run{" "}
                                    <code className={code}>/mcp</code> — <code className={code}>{name}</code>{" "}
                                    should be listed as connected.
                                </>
                            )}
                            {client === "desktop" && "3. Quit and reopen Claude Desktop. The Monitor tools appear in the tools menu."}
                            {client === "json" && "3. Restart or reload the client so it picks the server up."}
                        </p>
                    </TabPanel>
                </div>
            </div>

            {/* How to use */}
            <div className="border border-blue-200 dark:border-blue-800/50 rounded-xl bg-blue-50 dark:bg-blue-900/10 p-4">
                <div className="flex items-start gap-3">
                    <FontAwesomeIcon icon={faCircleInfo} className="text-blue-500 mt-0.5" />
                    <div className="space-y-2 min-w-0">
                        <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                            Example prompts
                        </p>
                        <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1 break-words">
                            <li>&quot;What issues are open, and which are new since yesterday?&quot;</li>
                            <li>&quot;Show me the error trend for {svcA} today&quot;</li>
                            <li>&quot;Triage the noisiest open issue — read its timeline first&quot;</li>
                            <li>&quot;Compare error rates this week vs last week&quot;</li>
                            <li>&quot;Give me an overview of the {svcB} service&quot;</li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* Available tools */}
            <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                        <FontAwesomeIcon icon={faRobot} className="text-blue-500 text-xs" />
                        Available tools ({MCP_TOOL_COUNT})
                    </h3>
                    <a
                        href="https://www.npmjs.com/package/monitor-mcp"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-blue-600 dark:text-zinc-400 dark:hover:text-blue-400"
                    >
                        monitor-mcp {MCP_PACKAGE_VERSION}
                        <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="text-[10px]" aria-hidden />
                        <span className="sr-only">(opens in a new tab)</span>
                    </a>
                </div>
                <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                    {MCP_TOOLS.map((category, i) => {
                        const open = expanded.has(category.category);
                        const panelId = `mcp-tools-${i}`;
                        return (
                            <div key={category.category}>
                                <h4>
                                    <button
                                        type="button"
                                        onClick={() => toggle(category.category)}
                                        aria-expanded={open}
                                        aria-controls={panelId}
                                        className="w-full min-h-11 px-4 py-3 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                                    >
                                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                            {category.category}{" "}
                                            <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500 font-normal">
                                                {category.tools.length} {category.tools.length === 1 ? "tool" : "tools"}
                                            </span>
                                        </span>
                                        <FontAwesomeIcon
                                            icon={faChevronDown}
                                            aria-hidden
                                            className={`text-xs text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
                                        />
                                    </button>
                                </h4>
                                {open && (
                                    <ul id={panelId} className="px-4 pb-3 space-y-1">
                                        {category.tools.map((tool) => (
                                            <li
                                                key={tool.name}
                                                className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/30"
                                            >
                                                <code className="text-xs font-mono text-blue-600 dark:text-blue-400 break-all sm:whitespace-nowrap mt-0.5">
                                                    {tool.name}
                                                </code>
                                                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                                    {tool.description}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
