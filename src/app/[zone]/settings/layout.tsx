import type { Metadata } from "next";

// The document title for this route. The page is a client component and cannot
// export `metadata` itself, so this layout exists only to carry it. The zone is
// in the title so two tabs open on different zones can be told apart; the root
// layout's template appends "· Monitor".
//
// Not "Settings": `/settings` is the account page, and two tabs both called
// "Settings" is the confusion this title exists to remove.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ zone: string }>;
}): Promise<Metadata> {
  const { zone } = await params;
  return { title: `Zone settings · ${zone}` };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
