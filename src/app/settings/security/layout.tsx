import type { Metadata } from "next";

// The document title for this route. The page is a client component and cannot
// export `metadata` itself, so this layout exists only to carry it; the root
// layout's template appends "· Monitor".
// `absolute`: /settings above sets a plain-string title, which ends the root
// template's reach for this segment.
export const metadata: Metadata = { title: { absolute: "Account security · Monitor" } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
