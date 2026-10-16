"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { reqListZones } from "@/services/api";
import type { Zone } from "@/types";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faCopy,
    faCheck,
    faRobot,
    faTerminal,
    faCircleInfo,
} from "@fortawesome/free-solid-svg-icons";

const MCP_TOOLS = [
    {
        category: "Discovery",
        tools: [
            { name: "monitor_health", description: "Check API health and queue stats" },
            { name: "monitor_list_services", description: "List all services sending events" },
            { name: "monitor_list_environments", description: "List all environments" },
            { name: "monitor_list_event_names", description: "List event names, optionally by service" },
            { name: "monitor_list_levels", description: "List log levels in use" },
            { name: "monitor_list_users", description: "List user IDs that generated events" },
        ],
    },
    {
        category: "Event Search",
        tools: [
            { name: "monitor_search_events", description: "Search events with Django-style filters" },
            { name: "monitor_trace", description: "Get all events for a trace ID" },
            { name: "monitor_request", description: "Get all events for a request ID" },
        ],
    },
    {
        category: "Data Fields",
        tools: [
            { name: "monitor_get_data_keys", description: "List custom data field keys" },
            { name: "monitor_get_data_values", description: "List values for a data field" },
        ],
    },
    {
        category: "Analytics",
        tools: [
            { name: "monitor_count", description: "Count events matching filters" },
            { name: "monitor_analytics", description: "Aggregation query with grouping" },
            { name: "monitor_timeseries", description: "Time-bucketed trend data" },
            { name: "monitor_topn", description: "Top N values by field" },
            { name: "monitor_compare", description: "Period-over-period comparison" },
        ],
    },
    {
        category: "Issues",
        tools: [
            { name: "monitor_list_issues", description: "Grouped errors with triage status" },
            { name: "monitor_get_issue", description: "Issue detail, links and history" },
            { name: "monitor_update_issue", description: "Status, priority, title, assignee" },
            { name: "monitor_bulk_update_issues", description: "One status over ids or a filter" },
            { name: "monitor_add_issue_comment", description: "Leave an idempotent note (dedupe_key)" },
            { name: "monitor_link_issue_pr", description: "Link a pull request, issue or commit" },
        ],
    },
    {
        category: "Alerting & configuration",
        tools: [
            { name: "monitor_list_alert_rules", description: "Rules with their firing state" },
            { name: "monitor_create_alert_rule", description: "Create a rule (zone-verified)" },
            { name: "monitor_test_alert_rule", description: "Evaluate a rule now" },
            { name: "monitor_list_notification_channels", description: "Delivery channels" },
            { name: "monitor_update_notification_channel", description: "Rename or re-point a channel" },
            { name: "monitor_rename_api_key", description: "Rename an API key" },
        ],
    },
    {
        category: "Quick Diagnostics",
        tools: [
            { name: "monitor_recent_errors", description: "Most recent error/fatal events" },
            { name: "monitor_error_breakdown", description: "Error frequency by name or service" },
            { name: "monitor_error_trend", description: "Error count over time" },
            { name: "monitor_service_overview", description: "Composite service health summary" },
        ],
    },
];

function generateMcpConfig(apiUrl: string, apiKey?: string): string {
    return JSON.stringify(
        {
            mcpServers: {
                monitor: {
                    command: "npx",
                    args: ["-y", "monitor-mcp"],
                    env: {
                        MONITOR_API_URL: apiUrl,
                        MONITOR_API_KEY: apiKey || "YOUR_API_KEY_HERE",
                    },
                },
            },
        },
        null,
        2
    );
}

export function McpTab() {
    const [copied, setCopied] = useState(false);
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

    const handleCopy = async (text: string) => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // One MCP entry talks to ONE zone (and one project — the key's). The URL
    // used to be hardcoded to the trailblaze API, so copying the snippet for any
    // other zone produced a server that answered from the wrong backend.
    const [zones, setZones] = useState<Zone[]>([]);
    const [zoneSlug, setZoneSlug] = useState("");
    useEffect(() => {
        let cancelled = false;
        void reqListZones().then((res) => {
            if (cancelled || !res.success) return;
            const list = res.data.filter((z) => z.status === "active" && z.query_url);
            setZones(list);
            if (list.length > 0) setZoneSlug((cur) => cur || list[0].slug);
        });
        return () => {
            cancelled = true;
        };
    }, []);
    const zone = zones.find((z) => z.slug === zoneSlug);
    const mcpConfig = generateMcpConfig(zone?.query_url || "https://YOUR-ZONE-QUERY-URL");

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    AI Integration
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    Connect Claude Code to Monitor via the MCP server. Claude can then
                    query events, analyze errors, and diagnose issues directly.
                </p>
            </div>

            {/* Setup instructions */}
            <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
                    <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                        <FontAwesomeIcon
                            icon={faTerminal}
                            className="text-blue-500 text-xs"
                        />
                        Setup
                    </h3>
                </div>
                <div className="p-4 space-y-4">
                    <div className="space-y-2">
                        {zones.length > 1 && (
                            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                                Zone
                                <select
                                    value={zoneSlug}
                                    onChange={(e) => setZoneSlug(e.target.value)}
                                    className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                                >
                                    {zones.map((z) => (
                                        <option key={z.slug} value={z.slug}>
                                            {z.display_name || z.slug}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            1. Create an <span className="font-medium text-zinc-900 dark:text-zinc-100">admin</span>-scope key in{" "}
                            {zoneSlug ? (
                                <Link href={`/${zoneSlug}/settings`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                                    {zone?.display_name || zoneSlug} → Zone settings
                                </Link>
                            ) : (
                                "the zone's settings"
                            )}
                            . The key reads only the project it was created in.
                        </p>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            2. Add the following to your <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded font-mono">~/.mcp.json</code> file,
                            replacing the API key placeholder:
                        </p>
                    </div>

                    <div className="relative">
                        <pre className="bg-zinc-900 dark:bg-zinc-950 rounded-lg p-4 text-sm font-mono text-zinc-100 overflow-x-auto">
                            {mcpConfig}
                        </pre>
                        <button
                            onClick={() => handleCopy(mcpConfig)}
                            className="absolute top-2 right-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors"
                        >
                            <FontAwesomeIcon
                                icon={copied ? faCheck : faCopy}
                                className="text-xs"
                            />
                            {copied ? "Copied" : "Copy"}
                        </button>
                    </div>

                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        3. Restart Claude Code. The Monitor tools will be available automatically.
                    </p>
                </div>
            </div>

            {/* How to use */}
            <div className="border border-blue-200 dark:border-blue-800/50 rounded-xl bg-blue-50 dark:bg-blue-900/10 p-4">
                <div className="flex items-start gap-3">
                    <FontAwesomeIcon
                        icon={faCircleInfo}
                        className="text-blue-500 mt-0.5"
                    />
                    <div className="space-y-2">
                        <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                            Example prompts for Claude
                        </p>
                        <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                            <li>&quot;What errors happened in the last hour?&quot;</li>
                            <li>&quot;Show me the error trend for keyring-api today&quot;</li>
                            <li>&quot;Trace request abc-123 across services&quot;</li>
                            <li>&quot;Compare error rates this week vs last week&quot;</li>
                            <li>&quot;Give me an overview of the johnnies-api service&quot;</li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* Available tools */}
            <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
                    <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                        <FontAwesomeIcon
                            icon={faRobot}
                            className="text-blue-500 text-xs"
                        />
                        Available Tools ({MCP_TOOLS.reduce((a, c) => a + c.tools.length, 0)})
                    </h3>
                </div>
                <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                    {MCP_TOOLS.map((category) => (
                        <div key={category.category}>
                            <button
                                onClick={() =>
                                    setExpandedCategory(
                                        expandedCategory === category.category
                                            ? null
                                            : category.category
                                    )
                                }
                                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                            >
                                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                    {category.category}
                                    <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500 font-normal">
                                        {category.tools.length} tools
                                    </span>
                                </span>
                                <svg
                                    className={`w-4 h-4 text-zinc-400 transition-transform ${
                                        expandedCategory === category.category
                                            ? "rotate-180"
                                            : ""
                                    }`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M19 9l-7 7-7-7"
                                    />
                                </svg>
                            </button>
                            {expandedCategory === category.category && (
                                <div className="px-4 pb-3 space-y-1">
                                    {category.tools.map((tool) => (
                                        <div
                                            key={tool.name}
                                            className="flex items-start gap-3 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/30"
                                        >
                                            <code className="text-xs font-mono text-blue-600 dark:text-blue-400 whitespace-nowrap mt-0.5">
                                                {tool.name}
                                            </code>
                                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                                {tool.description}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
