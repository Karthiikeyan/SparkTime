import { getBrand, loadAllSettings } from "@/server/services/settings";
import { renderOgImage, OG_SIZE } from "@/server/seo/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Free guides, courses and interview experiences";
export const revalidate = 86400;

export default async function Image() {
  const [brand, { home }] = await Promise.all([getBrand(), loadAllSettings()]);
  return renderOgImage({ title: home.hero.headline, eyebrow: "Free guides · Courses · Interview experiences", brand: brand.name, byline: brand.byline });
}
