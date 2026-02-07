"use client";

import { ReactNode } from "react";

interface GaugeCardProps {
  title: string;
  value: number;
  loading?: boolean;
  variant?: "default" | "error" | "success" | "warning";
  icon?: ReactNode;
}

const VARIANTS = {
  default: {
    iconBg: "bg-blue-100 dark:bg-blue-900/30",
    iconColor: "text-blue-600 dark:text-blue-400",
    valueColor: "text-zinc-900 dark:text-zinc-100",
  },
  error: {
    iconBg: "bg-red-100 dark:bg-red-900/30",
    iconColor: "text-red-600 dark:text-red-400",
    valueColor: "text-red-600 dark:text-red-400",
  },
  success: {
    iconBg: "bg-emerald-100 dark:bg-emerald-900/30",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    valueColor: "text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    iconBg: "bg-amber-100 dark:bg-amber-900/30",
    iconColor: "text-amber-600 dark:text-amber-400",
    valueColor: "text-amber-600 dark:text-amber-400",
  },
};

function formatValue(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

export function GaugeCard({
  title,
  value,
  loading = false,
  variant = "default",
  icon,
}: GaugeCardProps) {
  const colors = VARIANTS[variant];

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{title}</p>
          {loading ? (
            <div className="h-8 w-20 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse" />
          ) : (
            <p className={`text-2xl font-semibold ${colors.valueColor}`}>
              {formatValue(value)}
            </p>
          )}
        </div>
        {icon && (
          <div className={`p-2 rounded-lg ${colors.iconBg}`}>
            <div className={colors.iconColor}>{icon}</div>
          </div>
        )}
      </div>
    </div>
  );
}
