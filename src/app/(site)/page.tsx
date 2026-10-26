import type { Metadata } from "next";
import { HomePage } from "@/components/home/home-page";
import { JsonLd } from "@/components/seo/json-ld";
import { graph, webPageSchema } from "@/lib/seo/json-ld";
import { siteUrl } from "@/server/env";
import { pageMetadata } from "@/server/seo/metadata";
import { identityJsonLd } from "@/server/seo/person";
import { getHomeData } from "@/server/services/home";
import { getBrand } from "@/server/services/settings";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  // The title already names the product, so the title template leaves it as is.
  const brand = await getBrand();
  return pageMetadata({ title: brand.homeTitle, description: brand.description, path: "/" });
}

export default async function Home() {
  const [data, identity] = await Promise.all([getHomeData(), identityJsonLd()]);
  const base = siteUrl();
  return (
    <>
      <JsonLd data={graph(identity.website, identity.person, webPageSchema({ siteUrl: base, url: base, name: data.brand.name, description: data.brand.description }))} />
      <HomePage data={data} />
    </>
  );
}
