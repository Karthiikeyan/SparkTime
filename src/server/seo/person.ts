import "server-only";
import { absoluteUrl } from "@/lib/content/paths";
import { personSchema, websiteSchema, type JsonLd } from "@/lib/seo/json-ld";
import { siteUrl } from "../env";
import { getMediaAssets } from "../services/media";
import { getBrand, loadAllSettings } from "../services/settings";

/**
 * The Person entity for "Karthikeyan A". sameAs lists ONLY enabled profiles
 * flagged as the owner's own — consistent identity signals, never invented.
 */
export async function identityJsonLd(): Promise<{ person: JsonLd; website: JsonLd; imageUrl: string | null }> {
  const [settings, brand] = await Promise.all([loadAllSettings(), getBrand()]);
  const base = siteUrl();
  const { identity } = settings;
  const media = identity.imageMediaId ? await getMediaAssets([identity.imageMediaId]) : new Map();
  const image = identity.imageMediaId ? media.get(identity.imageMediaId) : undefined;
  const imageUrl = image ? absoluteUrl(base, image.url) : null;
  const person = personSchema({
    siteUrl: base,
    name: identity.name || "Karthikeyan A",
    alternateNames: identity.alternateNames.filter(Boolean),
    description: identity.description,
    jobTitle: identity.jobTitle,
    worksFor: identity.worksFor,
    knowsAbout: identity.knowsAbout.filter(Boolean),
    imageUrl,
    // The owner's enabled Studio profiles plus the product's own social links, each once.
    sameAs: [...new Set([...settings.profiles.filter((p) => p.enabled && p.sameAs && p.url).map((p) => p.url), ...brand.social.map((s) => s.url)])],
    location: identity.location,
  });
  // The website is the product; its author and publisher stay the Person above.
  return { person, website: websiteSchema(base, brand.name, brand.description), imageUrl };
}
