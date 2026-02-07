"use client";

import { useEffect, useState } from "react";
import { HealthResponse } from "@/types";
import { getHealth } from "@/services/api";

export function HealthStatus() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const data = await getHealth();
        setHealth(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch health");
        setHealth(null);
      } finally {
        setLoading(false);
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full">
        <div className="w-2 h-2 rounded-full bg-zinc-400 animate-pulse" />
        <span className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
          Connecting...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800/50 rounded-full">
        <div className="relative">
          <div className="w-2 h-2 rounded-full bg-red-500" />
        </div>
        <span className="text-xs sm:text-sm font-medium text-red-600 dark:text-red-400">
          Offline
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 sm:gap-4 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 rounded-full">
      <div className="flex items-center gap-2">
        <div className="relative">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <div className="absolute inset-0 w-2 h-2 rounded-full bg-emerald-500 animate-ping opacity-75" />
        </div>
        <span className="text-xs sm:text-sm font-medium text-emerald-700 dark:text-emerald-400">
          Online
        </span>
      </div>
      {health && (
        <div className="hidden lg:flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400 border-l border-emerald-200 dark:border-emerald-800/50 pl-3">
          <span className="flex items-center gap-1">
            <span className="text-zinc-400 dark:text-zinc-500">Q:</span>
            <span className="font-medium text-zinc-600 dark:text-zinc-300">
              {health.enqueued}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-zinc-400 dark:text-zinc-500">P:</span>
            <span className="font-medium text-zinc-600 dark:text-zinc-300">
              {health.pending}
            </span>
          </span>
          {health.dropped > 0 && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <span>D:</span>
              <span className="font-medium">{health.dropped}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
