/**
 * The product's defaults, in one place. The site is a product (SparkTime) written
 * by a person (Karthikeyan A). Studio → Settings → Site and → Home page override
 * what is here; whatever has not been saved there reads from this file, so a
 * fresh database shows the same site. Renaming the product is a one-line change
 * here, or a field in Studio.
 *
 * Menus are not here: the header and footer render Studio → Navigation.
 */
import type { ProfilePlatform } from "./settings";

const name = "SparkTime";
const author = "Karthikeyan A";

export type SocialLink = { id: string; platform: ProfilePlatform; label: string; url: string };
/** A "Popular" shortcut under the home search: its page while that page is live, otherwise a search for `query`. */
export type PopularLink = { label: string; href: string; query: string };

export const siteConfig = {
  name,
  author,
  description: `Free courses, real interview experiences and practical guides for freshers and early-career engineers in India, by ${author}, a working software engineer.`,
  promise: "Get hired. Then keep growing as an engineer.",
  /** The footer's line under the name. */
  tagline: `Free, practical guides for engineers in India. Written and kept by ${author}.`,
  social: [
    { id: "youtube", platform: "youtube", label: "YouTube", url: "https://www.youtube.com/@trendiikarthii" },
    { id: "linkedin", platform: "linkedin", label: "LinkedIn", url: "https://www.linkedin.com/in/trendiikarthii" },
    { id: "github", platform: "github", label: "GitHub", url: "https://github.com/Karthiikeyan" },
  ] as SocialLink[],
  popular: [
    { label: "Amazon SDE 1", href: "/interviews/amazon-sde-1", query: "Amazon SDE 1" },
    { label: "Zoho interview", href: "/interviews/zoho", query: "Zoho interview" },
    { label: "Spring Boot", href: "/tag/spring-boot", query: "Spring Boot" },
    { label: "System design", href: "/course/system-design-from-zero-to-interview-ready", query: "System design" },
    { label: "Fresher CTC", href: "/article/off-campus-fresher-offer-maths", query: "Fresher CTC" },
  ] as PopularLink[],
  /** The three topics the home page and Guides feature; every other top-level topic is listed on /notes. */
  featuredTopics: ["technology", "career", "money"] as string[],
  authorPhoto: { src: "/images/karthikeyan-avatar.jpg", width: 800, height: 800 },
  authorSummary: "Software engineer at Capgemini, working on AWS cloud infrastructure. I write down what I learn so it's useful to someone else.",
  speakingHref: "/contact?reason=Speaking",
  shareInterviewHref: "/contact?reason=Interview",
  sparktribeHref: "/sparktribe",
  /**
   * /start-here: what a reader is preparing for, and the course that answers it (matched by the
   * start of the course's slug). The lesson counts and times come from the published course.
   */
  startGoals: [
    { course: "off-campus-placements-with-ai", goal: "Get my first tech job", desc: "Off-campus, without a campus placement: proof of work, resume, referrals, assessments, interviews and offers." },
    { course: "java-from-zero-to-job-ready", goal: "Become a Java backend developer", desc: "From your first program to a tested, secured Spring Boot API you can explain in an interview." },
    { course: "dsa-from-zero-to-job-ready", goal: "Get good at DSA", desc: "Patterns, practice and an interview workflow, explained first and shown in code you can run." },
    { course: "system-design-from-zero-to-interview-ready", goal: "Crack system design rounds", desc: "A repeatable method for SDE-1 and SDE-2 design interviews, worked through case studies." },
    { course: "ai-from-zero-to-productive", goal: "Use AI well for study and work", desc: "Practical habits for learning and working with AI, without letting it do your thinking." },
  ] as Array<{ course: string; goal: string; desc: string }>,
  startInterviewGoal: { goal: "Prepare for a specific company", desc: "The rounds and real questions candidates reported, company by company." },
};

/**
 * A top-level topic with published pieces that isn't featured: it is listed on /notes.
 * `featured` is Studio → Settings → Home page → Topics (see getFeaturedTopics()); it defaults to siteConfig.featuredTopics.
 */
export function isNotesTopic(topic: { slug: string; parentId: string | null; count: number }, featured: readonly string[] = siteConfig.featuredTopics): boolean {
  return !topic.parentId && topic.count > 0 && !featured.includes(topic.slug);
}
