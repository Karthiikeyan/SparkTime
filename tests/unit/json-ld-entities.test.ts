import { describe, expect, it } from "vitest";
import { founderOrganizationSchema, personId } from "@/lib/seo/json-ld";

const SITE = "https://karthikeyan.example";

describe("founder organisation", () => {
  it("names the organisation, its own site and the site's Person as founder", () => {
    const org = founderOrganizationSchema({ siteUrl: SITE, pageUrl: `${SITE}/sparktribe`, name: "SparkTribe", url: "https://sparktribe.in", description: "Tech-career education in Tamil.", founderName: "Karthikeyan A" });
    expect(org).toEqual({
      "@type": "Organization",
      "@id": `${SITE}/sparktribe#organization`,
      name: "SparkTribe",
      url: "https://sparktribe.in",
      description: "Tech-career education in Tamil.",
      founder: { "@type": "Person", "@id": personId(SITE), name: "Karthikeyan A", url: `${SITE}/about` },
      subjectOf: { "@id": `${SITE}/sparktribe#webpage` },
    });
  });

  it("states nothing it wasn't given", () => {
    const org = founderOrganizationSchema({ siteUrl: SITE, pageUrl: `${SITE}/sparktribe`, name: "SparkTribe", url: "https://sparktribe.in", founderName: "Karthikeyan A" });
    expect(org).not.toHaveProperty("description");
    expect(Object.keys(org)).not.toEqual(expect.arrayContaining(["logo", "numberOfEmployees", "foundingDate", "award"]));
  });
});
