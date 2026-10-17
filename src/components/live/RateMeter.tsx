"use client";

import { useEffect, useState } from "react";
import { averageRate, formatSpan, RATE_WINDOW_SECONDS, type RateTracker } from "./live.tools";

const BAR_W = 2;
const GAP = 1;
const HEIGHT = 20;

/**
 * Events/s and a 60-second sparkline, stacked by level band, beside the stream
 * title. It answers "is it quiet, or is it broken?" at a glance: a flat strip
 * under "Connected" with "last event 4m ago" is a quiet zone; a strip that was
 * busy and stopped dead is worth a look.
 *
 * Owns its own one-second tick so the rest of the page does not re-render on it.
 */
export function RateMeter({ tracker }: { tracker: RateTracker }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    const series = tracker.series(now);
    const rate = averageRate(series);
    const lastAt = tracker.lastAt();
    const max = Math.max(1, ...series.map((b) => b.error + b.warn + b.other));
    const total = series.reduce((n, b) => n + b.error + b.warn + b.other, 0);
    const errors = series.reduce((n, b) => n + b.error, 0);
    const width = RATE_WINDOW_SECONDS * (BAR_W + GAP) - GAP;

    const scale = (n: number) => (n === 0 ? 0 : Math.max(1, (n / max) * HEIGHT));

    return (
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
            <svg
                width={width}
                height={HEIGHT}
                viewBox={`0 0 ${width} ${HEIGHT}`}
                role="img"
                aria-label={`${total} events in the last ${RATE_WINDOW_SECONDS} seconds, ${errors} of them errors`}
                className="hidden sm:block shrink-0 rounded-sm bg-zinc-100 dark:bg-zinc-800"
            >
                {series.map((b, i) => {
                    const x = i * (BAR_W + GAP);
                    const hErr = scale(b.error);
                    const hWarn = scale(b.warn);
                    const hOther = scale(b.other);
                    return (
                        <g key={i}>
                            <rect x={x} y={HEIGHT - hOther} width={BAR_W} height={hOther} className="fill-blue-400 dark:fill-blue-500" />
                            <rect x={x} y={HEIGHT - hOther - hWarn} width={BAR_W} height={hWarn} className="fill-amber-400" />
                            <rect x={x} y={HEIGHT - hOther - hWarn - hErr} width={BAR_W} height={hErr} className="fill-red-500" />
                        </g>
                    );
                })}
            </svg>
            <span className="whitespace-nowrap" title="Average over the last 10 seconds, counted while paused too">
                {rate < 10 ? rate.toFixed(1) : Math.round(rate)}/s
            </span>
            <span className="hidden md:inline whitespace-nowrap">
                · {lastAt === null ? "no events yet" : `last event ${formatSpan(now - lastAt)} ago`}
            </span>
        </div>
    );
}
