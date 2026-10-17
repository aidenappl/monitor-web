import type { Metadata } from "next";

// The document title for this route. The page is a client component and cannot
// export `metadata` itself, so this layout exists only to carry it. The zone is
// in the title so two tabs open on different zones can be told apart; the root
// layout's template appends "· Monitor".
export async function generateMetadata({
  params,
}: {
  params: Promise<{ zone: string }>;
}): Promise<Metadata> {
  const { zone } = await params;
  return { title: `Live tail · ${zone}` };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
