import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import { cookies } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { FortaProvider, LoadingScreen } from "forta-js/react";
import { Navbar } from "@/components/Navbar";

const MONITOR_API_URL = (
  process.env.NEXT_PUBLIC_MONITOR_API_URL || "http://localhost:8080"
).replace(/\/+$/, "");

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Monitor - Events Dashboard",
  description: "Event monitoring and observability dashboard",
  icons: {
    icon: [
      { url: "/favicon/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/favicon/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon/favicon.ico",
    apple: { url: "/favicon/apple-touch-icon.png", sizes: "180x180" },
  },
  manifest: "/favicon/site.webmanifest",
  appleWebApp: {
    title: "Monitor",
  },
};

const fortaConfig = {
  apiUrl: "",
  selfEndpoint: "/api/monitor/self",
  refreshEndpoint: null,
  loginUrl: `${MONITOR_API_URL}/forta/login`,
  logoutUrl: `${MONITOR_API_URL}/forta/logout`,
  redirectOnUnauthenticated: true,
};

const loadingFallback = (
  <LoadingScreen
    logo={
      <div className="flex items-center gap-2">
        <Image
          src="/Monitor-Logo-Transparent.svg"
          alt="Monitor"
          width={48}
          height={48}
          priority
        />
        <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Monitor
        </span>
      </div>
    }
  />
);

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const appearance = cookieStore.get("forta-appearance")?.value;
  // Apply dark class server-side only when explicitly "dark".
  // For "system" or missing cookie the client ThemeProvider reconciles on hydration.
  const isDark = appearance === "dark";

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased${isDark ? " dark" : ""}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>
          <FortaProvider config={fortaConfig} loadingFallback={loadingFallback}>
            <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
              <Navbar />
              {children}
            </div>
          </FortaProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
