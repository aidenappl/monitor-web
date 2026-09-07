import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import StoreProvider from "@/store/StoreProvider";
import { AuthProvider } from "@/context/AuthContext";
import { Navbar } from "@/components/Navbar";
import { ToastProvider } from "@/components/ToastProvider";
import { ZONE_COOKIE } from "@/tools/routing.tools";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const appearance = cookieStore.get("mon-appearance")?.value;
  // Last-used zone, for the navbar's links on the zone-agnostic pages. Read here
  // rather than in the client Navbar so the server and client passes agree.
  const rememberedZone = cookieStore.get(ZONE_COOKIE)?.value;
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
          <StoreProvider>
            <AuthProvider>
              <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
                {/* Navbar reads the ?project selector to carry it across
                    navigations, and useSearchParams needs a Suspense boundary
                    during static generation. */}
                <Suspense fallback={null}>
                  <Navbar rememberedZone={rememberedZone} />
                </Suspense>
                {children}
                <ToastProvider />
              </div>
            </AuthProvider>
          </StoreProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
