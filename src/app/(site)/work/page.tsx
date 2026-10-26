import type { Metadata } from "next";
import { WorkHubView } from "@/components/pages/hub-view";
import { siteUrl } from "@/server/env";
import { pageMetadata } from "@/server/seo/metadata";
import { getWorkPage } from "@/server/services/hub-page";
import { getSiteSections } from "@/server/services/sections";
import { loadAllSettings } from "@/server/services/settings";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const hub = (await getSiteSections()).hub("work");
  return pageMetadata({ title: hub.title, description: hub.intro, path: hub.path, noindex: hub.count === 0 });
}

/** Work: SparkTribe, what's in progress, projects and experiments — for builders and recruiters alike. */
export default async function WorkPage() {
  const [data, settings] = await Promise.all([getWorkPage(), loadAllSettings()]);
  return <WorkHubView data={data} identity={settings.identity} sparktribeUrl={settings.pages.sparktribe.url} siteUrl={siteUrl()} />;
}
