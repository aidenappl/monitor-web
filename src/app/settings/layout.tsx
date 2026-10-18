import type { Metadata } from "next";
import { EcosystemSettingsFrame } from "@/components/settings/SettingsNav";

// The ecosystem settings hub: the person, this browser, and (admins) the
// install. Zone settings are `/{zone}/settings`.
//
// ⚠️ `absolute` + `template`, never a plain string: a plain-string title here
// would end the root template's reach, and every section below would lose its
// "· Monitor". With the template, each section just sets `title: "Users"`.
export const metadata: Metadata = {
  title: { absolute: "Settings · Monitor", template: "%s · Monitor" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <EcosystemSettingsFrame>{children}</EcosystemSettingsFrame>;
}
