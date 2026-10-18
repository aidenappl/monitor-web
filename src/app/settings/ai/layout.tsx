import type { Metadata } from "next";

// Carries the title for a client page; the root template appends "· Monitor".
export const metadata: Metadata = { title: "AI integration" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
