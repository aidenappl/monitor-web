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
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
        <div className="w-2 h-2 rounded-full bg-zinc-400 animate-pulse" />
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          Checking...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-900/20 rounded-lg">
        <div className="w-2 h-2 rounded-full bg-red-500" />
        <span className="text-sm text-red-600 dark:text-red-400">Offline</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 px-3 py-1.5 bg-green-50 dark:bg-green-900/20 rounded-lg">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <span className="text-sm text-green-600 dark:text-green-400">
          Online
        </span>
      </div>
      {health && (
        <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <span>Enqueued: {health.enqueued}</span>
          <span>Pending: {health.pending}</span>
          <span>Dropped: {health.dropped}</span>
        </div>
      )}
    </div>
  );
}
