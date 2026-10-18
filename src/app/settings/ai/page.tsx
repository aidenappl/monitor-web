"use client";

import { McpTab } from "@/components/settings/McpTab";

export default function AiIntegrationPage() {
    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">AI integration</h1>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Connect an MCP client (Claude, pi, …) to a zone of this Monitor.</p>
            </div>
            <McpTab />
        </div>
    );
}
