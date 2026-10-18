import type { Metadata } from "next";
import { ZoneSettingsFrame } from "@/components/settings/SettingsNav";

// The per-zone settings hub. The zone is in every title so two tabs open on
// different zones can be told apart. Not "Settings": `/settings` is the
// ecosystem hub, and two tabs both called "Settings" is the confusion the
// names exist to remove.
//
// ⚠️ `absolute` + `template`, never a plain string: a plain-string title on
// this layout would end the root template's reach for every section below it.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ zone: string }>;
}): Promise<Metadata> {
  const { zone } = await params;
  return { title: { absolute: `Zone settings · ${zone} · Monitor`, template: "%s · Monitor" } };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ZoneSettingsFrame>{children}</ZoneSettingsFrame>;
}
