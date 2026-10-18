import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ zone: string }>;
}): Promise<Metadata> {
  const { zone } = await params;
  return { title: `Source repositories · ${zone}` };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
