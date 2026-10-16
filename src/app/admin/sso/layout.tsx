import type { Metadata } from "next";

// The document title for this route. The page is a client component and cannot
// export `metadata` itself, so this layout exists only to carry it; the root
// layout's template appends "· Monitor".
export const metadata: Metadata = { title: "SSO providers" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
