"use client";

import { useState } from "react";
import { ApiKeysTab } from "@/components/settings/ApiKeysTab";
import { McpTab } from "@/components/settings/McpTab";

const tabs = [
    { id: "api-keys", name: "API Keys" },
    { id: "ai", name: "AI Integration" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState<TabId>("api-keys");

    return (
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                        Settings
                    </h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        Manage API keys and integrations.
                    </p>
                </div>

                {/* Tabs */}
                <div className="border-b border-zinc-200 dark:border-zinc-700">
                    <nav className="flex gap-1 -mb-px">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                                    activeTab === tab.id
                                        ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                                        : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600"
                                }`}
                            >
                                {tab.name}
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Tab content */}
                {activeTab === "api-keys" && <ApiKeysTab />}
                {activeTab === "ai" && <McpTab />}
            </div>
        </main>
    );
}
