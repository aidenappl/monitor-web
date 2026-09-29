// Importing the service creates the browser Monitor before the app hydrates, so
// an error thrown during hydration is captured too.
//
// ⚠️ Deliberately NO page-load or navigation events (unlike keyring-web). This
// app reports its failures only — a pageview stream would bury them. See
// AGENTS.md §6 "Monitor self-telemetry".
import "@/services/monitor.service";
