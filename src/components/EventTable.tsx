"use client";

import { useState, Fragment } from "react";
import { Event } from "@/types";

interface EventTableProps {
  events: Event[];
  loading: boolean;
}

function getLevelColor(level?: string) {
  switch (level?.toLowerCase()) {
    case "error":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
    case "warn":
    case "warning":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
    case "debug":
      return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
    case "info":
    default:
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
  }
}

function formatTimestamp(ts: string) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export function EventTable({ events, loading }: EventTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRow = (index: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedRows(newExpanded);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-500 dark:text-zinc-400">
        <svg
          className="w-12 h-12 mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
        <p>No events found</p>
        <p className="text-sm mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-700">
            <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">
              Timestamp
            </th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">
              Service
            </th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">
              Name
            </th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">
              Level
            </th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">
              Request
            </th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">
              User
            </th>
            <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400"></th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => (
            <Fragment key={`event-${index}`}>
              <tr
                className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
                onClick={() => toggleRow(index)}
              >
                <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                  {formatTimestamp(event.timestamp)}
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 rounded">
                    {event.service}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium">{event.name}</td>
                <td className="px-4 py-3">
                  {event.level && (
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded ${getLevelColor(event.level)}`}
                    >
                      {event.level}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  {event.request_id
                    ? event.request_id.slice(0, 12) + "..."
                    : "-"}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  {event.user_id ? event.user_id.slice(0, 12) + "..." : "-"}
                </td>
                <td className="px-4 py-3 text-zinc-400">
                  <svg
                    className={`w-4 h-4 transition-transform ${expandedRows.has(index) ? "rotate-180" : ""}`}
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
                </td>
              </tr>
              {expandedRows.has(index) && (
                <tr className="bg-zinc-50 dark:bg-zinc-900">
                  <td colSpan={7} className="px-4 py-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
                      {event.env && (
                        <div>
                          <span className="text-zinc-500 dark:text-zinc-400">
                            Environment:
                          </span>
                          <span className="ml-2 font-medium">{event.env}</span>
                        </div>
                      )}
                      {event.job_id && (
                        <div>
                          <span className="text-zinc-500 dark:text-zinc-400">
                            Job ID:
                          </span>
                          <span className="ml-2 font-mono text-xs">
                            {event.job_id}
                          </span>
                        </div>
                      )}
                      {event.request_id && (
                        <div>
                          <span className="text-zinc-500 dark:text-zinc-400">
                            Request ID:
                          </span>
                          <span className="ml-2 font-mono text-xs">
                            {event.request_id}
                          </span>
                        </div>
                      )}
                      {event.trace_id && (
                        <div>
                          <span className="text-zinc-500 dark:text-zinc-400">
                            Trace ID:
                          </span>
                          <span className="ml-2 font-mono text-xs">
                            {event.trace_id}
                          </span>
                        </div>
                      )}
                      {event.user_id && (
                        <div>
                          <span className="text-zinc-500 dark:text-zinc-400">
                            User ID:
                          </span>
                          <span className="ml-2 font-mono text-xs">
                            {event.user_id}
                          </span>
                        </div>
                      )}
                    </div>
                    {event.data && Object.keys(event.data).length > 0 && (
                      <div>
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                          Data
                        </span>
                        <pre className="mt-2 p-3 bg-zinc-100 dark:bg-zinc-800 rounded-md overflow-x-auto text-xs font-mono">
                          {JSON.stringify(event.data, null, 2)}
                        </pre>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
