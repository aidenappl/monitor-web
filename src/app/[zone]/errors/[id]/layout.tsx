import type { Metadata } from "next";

// The document title for this route. The page is a client component and cannot
// export `metadata` itself, so this layout exists only to carry it. The zone is
// in the title so two tabs open on different zones can be told apart; the root
// layout's template appends "· Monitor".
//
// Static on purpose: naming the issue here would mean a second server-side
// fetch of it on every load. The page can sharpen `document.title` once it has
// the issue in hand.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ zone: string }>;
}): Promise<Metadata> {
  const { zone } = await params;
  // `absolute`: the parent errors layout sets a plain-string title, and in Next
  // that ends the root template's reach — without it this read "Issue · appleby"
  // with no product name.
  return { title: { absolute: `Issue · ${zone} · Monitor` } };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
