"use client";

import { useState, Fragment } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner } from "@awesome.me/kit-c2d31bb269/icons/classic/solid";
import { Event } from "@/types";

interface EventTableProps {
  events: Event[];
  loading: boolean;
}

function getLevelColor(level?: string) {
  switch (level?.toLowerCase()) {
    case "error":
      return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 ring-1 ring-inset ring-red-200 dark:ring-red-900";
    case "warn":
    case "warning":
      return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 ring-1 ring-inset ring-amber-200 dark:ring-amber-900";
    case "debug":
      return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 ring-1 ring-inset ring-zinc-200 dark:ring-zinc-700";
    case "info":
    default:
      return "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 ring-1 ring-inset ring-blue-200 dark:ring-blue-900";
  }
}

function formatTimestamp(ts: string) {
  try {
    const date = new Date(ts);
    return {
      date: date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      time: date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    };
  } catch {
    return { date: ts, time: "" };
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
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <FontAwesomeIcon
          icon={faSpinner}
          className="text-3xl text-blue-600 animate-spin"
        />
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          Loading events...
        </span>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-500">
        <div className="w-16 h-16 mb-4 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
          <svg
            className="w-8 h-8"
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
        </div>
        <p className="text-base font-medium text-zinc-600 dark:text-zinc-400">
          No events found
        </p>
        <p className="text-sm mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/30">
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Time
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Service
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Event
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Level
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                User
              </th>
              <th className="px-4 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {events.map((event, index) => {
              const ts = formatTimestamp(event.timestamp);
              return (
                <Fragment key={`event-${index}`}>
                  <tr
                    className="group hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                    onClick={() => toggleRow(index)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-mono text-xs text-zinc-900 dark:text-zinc-100">
                          {ts.time}
                        </span>
                        <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
                          {ts.date}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2 py-1 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-md">
                        {event.service}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                      {event.name}
                    </td>
                    <td className="px-4 py-3">
                      {event.level && (
                        <span
                          className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-md ${getLevelColor(event.level)}`}
                        >
                          {event.level}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {event.user_id ? event.user_id.slice(0, 8) : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <svg
                        className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${expandedRows.has(index) ? "rotate-180" : ""}`}
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
                    <tr className="bg-zinc-50 dark:bg-zinc-900/50">
                      <td colSpan={6} className="px-4 py-4">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm mb-4">
                          {event.env && (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                Environment
                              </span>
                              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                {event.env}
                              </span>
                            </div>
                          )}
                          {event.job_id && (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                Job ID
                              </span>
                              <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all">
                                {event.job_id}
                              </span>
                            </div>
                          )}
                          {event.request_id && (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                Request ID
                              </span>
                              <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all">
                                {event.request_id}
                              </span>
                            </div>
                          )}
                          {event.trace_id && (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                Trace ID
                              </span>
                              <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all">
                                {event.trace_id}
                              </span>
                            </div>
                          )}
                          {event.user_id && (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                User ID
                              </span>
                              <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all">
                                {event.user_id}
                              </span>
                            </div>
                          )}
                        </div>
                        {event.data && Object.keys(event.data).length > 0 && (
                          <div>
                            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                              Data
                            </span>
                            <pre className="mt-2 p-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-x-auto text-xs font-mono text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                              {JSON.stringify(event.data, null, 2)}
                            </pre>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
        {events.map((event, index) => {
          const ts = formatTimestamp(event.timestamp);
          return (
            <div key={`mobile-${index}`} className="p-4">
              <div className="cursor-pointer" onClick={() => toggleRow(index)}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded">
                        {event.service}
                      </span>
                      {event.level && (
                        <span
                          className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${getLevelColor(event.level)}`}
                        >
                          {event.level}
                        </span>
                      )}
                    </div>
                    <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {event.name}
                    </p>
                  </div>
                  <svg
                    className={`w-5 h-5 text-zinc-400 shrink-0 transition-transform duration-200 ${expandedRows.has(index) ? "rotate-180" : ""}`}
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
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="font-mono">
                    {ts.time} · {ts.date}
                  </span>
                </div>
              </div>

              {expandedRows.has(index) && (
                <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                  <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                    {event.env && (
                      <div>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 block">
                          Environment
                        </span>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {event.env}
                        </span>
                      </div>
                    )}
                    {event.job_id && (
                      <div>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 block">
                          Job ID
                        </span>
                        <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all">
                          {event.job_id}
                        </span>
                      </div>
                    )}
                    {event.request_id && (
                      <div>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 block">
                          Request ID
                        </span>
                        <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all">
                          {event.request_id}
                        </span>
                      </div>
                    )}
                    {event.trace_id && (
                      <div>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 block">
                          Trace ID
                        </span>
                        <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all">
                          {event.trace_id}
                        </span>
                      </div>
                    )}
                    {event.user_id && (
                      <div>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 block">
                          User ID
                        </span>
                        <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all">
                          {event.user_id}
                        </span>
                      </div>
                    )}
                  </div>
                  {event.data && Object.keys(event.data).length > 0 && (
                    <div>
                      <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block mb-2">
                        Data
                      </span>
                      <pre className="p-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-x-auto text-xs font-mono text-zinc-700 dark:text-zinc-300">
                        {JSON.stringify(event.data, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
