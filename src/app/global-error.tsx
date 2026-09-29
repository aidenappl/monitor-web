"use client";

import { useEffect } from "react";
import { reportError } from "@/services/monitor.service";

// Replaces the ROOT LAYOUT when the layout itself fails, so it renders its own
// document and cannot rely on the app's stylesheet, fonts or theme cookie. The
// palette mirrors the app's light-first zinc + blue, with the OS preference
// standing in for the `mon-appearance` cookie it cannot read here.
const STYLES = `
  .ge-body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #fafafa; color: #18181b; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .ge-main { max-width: 480px; padding: 32px 16px; }
  .ge-kicker { font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: #a1a1aa; margin: 0 0 8px; }
  .ge-title { font-size: 24px; font-weight: 600; margin: 0 0 8px; }
  .ge-copy { font-size: 14px; line-height: 1.6; color: #71717a; margin: 0 0 24px; }
  .ge-ref { font-size: 12px; font-family: ui-monospace, SFMono-Regular, monospace; color: #a1a1aa; margin: 0 0 24px; }
  .ge-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .ge-btn { height: 40px; padding: 0 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; }
  .ge-primary { border: 1px solid #2563eb; background: #2563eb; color: #ffffff; }
  .ge-primary:hover { background: #1d4ed8; }
  .ge-secondary { border: 1px solid #e4e4e7; background: #ffffff; color: #52525b; }
  .ge-secondary:hover { background: #f4f4f5; }
  @media (prefers-color-scheme: dark) {
    .ge-body { background: #09090b; color: #fafafa; }
    .ge-kicker, .ge-ref { color: #71717a; }
    .ge-copy { color: #a1a1aa; }
    .ge-secondary { border-color: #3f3f46; background: #18181b; color: #a1a1aa; }
    .ge-secondary:hover { background: #27272a; }
  }
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError("client.error.global", error, {
      outcome: "root layout failed; the whole document was replaced",
    });
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Monitor — error</title>
        <style>{STYLES}</style>
      </head>
      <body className="ge-body">
        <main className="ge-main">
          <p className="ge-kicker">Error</p>
          <h1 className="ge-title">Monitor couldn&apos;t load</h1>
          <p className="ge-copy">
            The app failed before it could draw this page. Try again, or reload
            if it keeps happening.
          </p>
          {error.digest && <p className="ge-ref">Reference: {error.digest}</p>}
          <div className="ge-actions">
            <button type="button" className="ge-btn ge-primary" onClick={reset}>
              Try again
            </button>
            <button
              type="button"
              className="ge-btn ge-secondary"
              onClick={() => window.location.reload()}
            >
              Reload the page
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
