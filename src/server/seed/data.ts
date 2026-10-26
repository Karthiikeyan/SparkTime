/**
 * Seed data: STRUCTURE, not claims.
 *
 * Content types, fields, a category tree and system pages. The only facts
 * about Karthikeyan are ones that appear in his own previous site's content
 * (current role, stack, founding SparkTribe) and SparkTribe's own published
 * mission; see docs/CONTENT-FACTS.md. Everything else is a visible [TODO].
 */
import type { BlockNode, Doc } from "@/lib/content/blocks";
import type { FieldDefinition, IconName, SchemaType, Template } from "@/lib/content/model";
import { DEFAULT_INTERVIEW_CATEGORIES } from "@/lib/interviews/guide";

type SeedField = Omit<FieldDefinition, "id" | "position" | "showInFacts" | "helpText" | "required" | "options" | "role"> &
  Partial<Pick<FieldDefinition, "showInFacts" | "helpText" | "required" | "options" | "role">>;

export type SeedType = {
  name: string;
  pluralName: string;
  slug: string;
  description: string;
  template: Template;
  schemaType: SchemaType;
  icon: IconName;
  routing?: "type" | "root";
  isSystem?: boolean;
  indexable?: boolean;
  inFeeds?: boolean;
  showInQuickCreate?: boolean;
  fields: SeedField[];
};

const difficulty = { choices: ["Beginner", "Intermediate", "Advanced"].map((v) => ({ value: v.toLowerCase(), label: v })) };

/**
 * Interview Experiences: one document per company × role, at
 * /interviews/{company}-{role} (no role = the company's page). Content
 * arrives through Studio → Import (a company's research import.json), as
 * drafts unless the owner chooses to publish. Live sites install it with
 * scripts/interviews-install.ts.
 */
export const INTERVIEW_TYPE: SeedType = {
  name: "Interview page",
  pluralName: "Interview Experiences",
  slug: "interviews",
  description: "Interview rounds and questions candidates have publicly reported, organised by company and role. The questions that were asked, never answers, ready to practise with an AI assistant.",
  template: "interview",
  schemaType: "Article",
  icon: "briefcase",
  // Not indexable by default: /interviews and the company pages are hubs. A role page the research
  // advises indexing is imported with SEO → Indexing = Index, so it alone enters search and the sitemap.
  indexable: false,
  inFeeds: false,
  showInQuickCreate: false,
  fields: [
    { key: "company", label: "Company", type: "text", role: "interviewCompany", required: true, showInFacts: false, helpText: "As candidates name it, e.g. Amazon. Use the same spelling on every page." },
    { key: "jobRole", label: "Role", type: "text", role: "interviewRole", showInFacts: false, helpText: "e.g. SDE 1. Leave empty on the company's own page." },
    { key: "guide", label: "Interview guide", type: "interview_guide", showInFacts: false, options: { choices: DEFAULT_INTERVIEW_CATEGORIES }, helpText: "Edited below the body." },
  ],
};

export const SEED_TYPES: SeedType[] = [
  {
    name: "Article",
    // "Articles", not "Writing": the topic /writing already exists, and two public
    // pages with the same name make a visitor wonder whether they are the same thing.
    pluralName: "Articles",
    slug: "article",
    description: "Long-form essays, lessons and explanations.",
    template: "editorial",
    schemaType: "BlogPosting",
    icon: "pen",
    fields: [
      { key: "takeaways", label: "Key takeaways", type: "long_text", role: "takeaways", helpText: "One per line. Shown as a summary box." },
      { key: "audience", label: "Who this is for", type: "text", role: "audience" },
      { key: "difficulty", label: "Difficulty", type: "select", role: "difficulty", options: difficulty },
      { key: "prerequisites", label: "Prerequisites", type: "long_text", role: "prerequisites" },
      { key: "sources", label: "Sources", type: "long_text", role: "sources", helpText: "One per line. URLs become links." },
    ],
  },
  {
    name: "Guide",
    pluralName: "Guides",
    slug: "guide",
    description: "Step-by-step, practical how-tos.",
    template: "editorial",
    schemaType: "TechArticle",
    icon: "compass",
    fields: [
      { key: "audience", label: "Who this is for", type: "text", role: "audience" },
      { key: "difficulty", label: "Difficulty", type: "select", role: "difficulty", options: difficulty },
      { key: "prerequisites", label: "Prerequisites", type: "long_text", role: "prerequisites" },
      { key: "takeaways", label: "What you'll learn", type: "long_text", role: "takeaways" },
    ],
  },
  {
    name: "Note",
    pluralName: "Notes",
    slug: "note",
    description: "Short thoughts, highlights and things learned.",
    template: "minimal",
    schemaType: "Article",
    icon: "note",
    inFeeds: false,
    fields: [{ key: "source", label: "Source", type: "url", role: "primaryUrl", helpText: "Where the idea came from, if anywhere." }],
  },
  {
    name: "Project",
    pluralName: "Projects",
    slug: "project",
    description: "Things I've built, with the story behind them.",
    template: "project",
    schemaType: "CreativeWork",
    icon: "code",
    fields: [
      { key: "liveUrl", label: "Live site", type: "url", role: "primaryUrl" },
      { key: "repositoryUrl", label: "Source code", type: "url", role: "repositoryUrl" },
      {
        key: "status",
        label: "Status",
        type: "select",
        role: "projectStatus",
        options: { choices: ["Idea", "Building", "Live", "Paused", "Archived"].map((v) => ({ value: v.toLowerCase(), label: v })) },
      },
      { key: "techStack", label: "Tech stack", type: "multi_select", role: "techStack", options: { choices: [], allowCustom: true } },
      { key: "myRole", label: "My role", type: "text" },
      { key: "startDate", label: "Started", type: "date", role: "startDate" },
      { key: "endDate", label: "Finished", type: "date", role: "endDate" },
    ],
  },
  {
    name: "Video",
    pluralName: "Videos",
    slug: "video",
    description: "Videos hosted on YouTube, with notes and context.",
    template: "media",
    schemaType: "VideoObject",
    icon: "video",
    fields: [
      { key: "youtubeUrl", label: "YouTube URL", type: "url", role: "videoUrl", required: true },
      { key: "duration", label: "Duration", type: "text", role: "duration", helpText: "e.g. 12:40" },
      { key: "transcript", label: "Transcript", type: "long_text", role: "transcript", showInFacts: false },
    ],
  },
  {
    name: "Talk",
    // "Talks", not "Speaking": "Speaking" is the menu group that holds Talks and
    // Videos, and the topic /public-speaking is a third, different destination.
    pluralName: "Talks",
    slug: "talk",
    description: "Talks and sessions I've given.",
    template: "media",
    schemaType: "Event",
    icon: "mic",
    fields: [
      { key: "eventName", label: "Event", type: "text", role: "eventName" },
      { key: "eventDate", label: "Date", type: "date", role: "eventDate" },
      { key: "location", label: "Location", type: "text", role: "location" },
      { key: "audience", label: "Audience", type: "text", role: "audience" },
      { key: "youtubeUrl", label: "Recording", type: "url", role: "videoUrl" },
      { key: "slidesUrl", label: "Slides", type: "url", role: "slidesUrl" },
    ],
  },
  {
    name: "Course",
    pluralName: "Courses",
    slug: "course",
    description: "Structured learning paths: modules and lessons.",
    template: "collection",
    schemaType: "Course",
    icon: "graduation",
    fields: [
      { key: "level", label: "Level", type: "select", role: "difficulty", options: difficulty },
      { key: "duration", label: "Duration", type: "text", role: "duration" },
      { key: "prerequisites", label: "Prerequisites", type: "long_text", role: "prerequisites" },
      { key: "courseUrl", label: "Course link", type: "url", role: "primaryUrl" },
    ],
  },
  {
    name: "Resource",
    pluralName: "Resources",
    slug: "resource",
    description: "Tools, books and links worth your time.",
    template: "resource",
    schemaType: "CreativeWork",
    icon: "link",
    fields: [
      { key: "url", label: "Link", type: "url", role: "primaryUrl", required: true },
      {
        key: "kind",
        label: "Kind",
        type: "select",
        options: { choices: ["Tool", "Book", "Course", "Article", "Video", "Podcast", "Newsletter", "Other"].map((v) => ({ value: v.toLowerCase(), label: v })) },
      },
      { key: "audience", label: "Best for", type: "text", role: "audience" },
      { key: "pricing", label: "Pricing", type: "select", options: { choices: ["Free", "Freemium", "Paid"].map((v) => ({ value: v.toLowerCase(), label: v })) } },
    ],
  },
  {
    name: "Experiment",
    pluralName: "Experiments",
    slug: "experiment",
    description: "Things I'm trying, with a hypothesis and an honest result.",
    template: "story",
    schemaType: "CreativeWork",
    icon: "flask",
    fields: [
      { key: "hypothesis", label: "Hypothesis", type: "long_text" },
      { key: "status", label: "Status", type: "select", role: "projectStatus", options: { choices: ["Planned", "Running", "Concluded"].map((v) => ({ value: v.toLowerCase(), label: v })) } },
      { key: "result", label: "Result", type: "long_text" },
      { key: "lessons", label: "Lessons", type: "long_text", role: "takeaways" },
      { key: "startDate", label: "Started", type: "date", role: "startDate" },
      { key: "endDate", label: "Ended", type: "date", role: "endDate" },
    ],
  },
  {
    name: "Book Review",
    pluralName: "Book Reviews",
    slug: "book-review",
    description: "Books I've read and what I took from them.",
    template: "editorial",
    schemaType: "Review",
    icon: "book",
    fields: [
      { key: "bookTitle", label: "Book title", type: "text", role: "itemName", required: true },
      { key: "bookAuthor", label: "Author", type: "text", role: "itemAuthor" },
      { key: "rating", label: "Rating (out of 5)", type: "number", role: "rating", options: { min: 0, max: 5 } },
      { key: "cover", label: "Cover", type: "image", role: "coverImage", showInFacts: false },
      { key: "isbn", label: "ISBN", type: "text", role: "isbn" },
      { key: "purchaseUrl", label: "Where to get it", type: "url", role: "primaryUrl" },
      { key: "takeaways", label: "Key takeaways", type: "long_text", role: "takeaways" },
    ],
  },
  {
    name: "Collection",
    pluralName: "Collections",
    slug: "collection",
    description: "Curated sets: reading lists, paths and resource maps.",
    template: "collection",
    schemaType: "CollectionPage",
    icon: "layers",
    fields: [],
  },
  {
    name: "Journey",
    pluralName: "Journey",
    slug: "journey",
    description: "Chapters of my story: periods, turning points and lessons.",
    template: "story",
    schemaType: "CreativeWork",
    icon: "map",
    inFeeds: false,
    fields: [
      { key: "period", label: "Period", type: "text", role: "period", helpText: "e.g. 2019 – 2021" },
      { key: "startDate", label: "Start", type: "date", role: "startDate" },
      { key: "endDate", label: "End", type: "date", role: "endDate" },
      { key: "turningPoint", label: "Turning point", type: "long_text" },
      { key: "lessons", label: "Lessons", type: "long_text", role: "takeaways" },
    ],
  },
  {
    name: "Page",
    pluralName: "Pages",
    slug: "page",
    description: "Standalone pages at the top level of the site (/about, /now…).",
    template: "minimal",
    schemaType: "WebPage",
    icon: "file",
    routing: "root",
    isSystem: true,
    inFeeds: false,
    showInQuickCreate: false,
    fields: [],
  },
  INTERVIEW_TYPE,
];

export type SeedCategory = { name: string; slug: string; description: string; featured?: boolean; accent?: string; children?: SeedCategory[] };

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    name: "Technology",
    slug: "technology",
    description: "Software engineering, AI and the craft of building on the web.",
    featured: true,
    accent: "ocean",
    children: [
      { name: "Software Engineering", slug: "software-engineering", description: "Architecture, backend, practices and lessons from production." },
      { name: "AI", slug: "ai", description: "Using and building with AI." },
      { name: "Web Development", slug: "web-development", description: "Building for the web." },
    ],
  },
  {
    name: "Money",
    slug: "money",
    description: "Personal finance, investing and the road to financial independence.",
    featured: true,
    accent: "moss",
    children: [
      { name: "Financial Independence", slug: "financial-independence", description: "Working toward FI, one decision at a time." },
      { name: "Investing", slug: "investing", description: "How I think about investing." },
      { name: "Personal Finance", slug: "personal-finance", description: "Saving, spending and planning." },
    ],
  },
  {
    name: "Creator",
    slug: "creator",
    description: "Making videos, writing and speaking — and what I learn doing it.",
    featured: true,
    accent: "ember",
    children: [
      { name: "YouTube", slug: "youtube", description: "Video creation." },
      // "Writing craft", not "Writing": this topic is about the practice of
      // writing in public, while "Writing" is the menu group that holds
      // Articles, Guides and Notes. The slug stays /writing.
      { name: "Writing craft", slug: "writing", description: "Writing in public." },
      { name: "Public Speaking", slug: "public-speaking", description: "Talks, sessions and the craft of speaking." },
    ],
  },
  { name: "Career", slug: "career", description: "Growing as an engineer: jobs, interviews and decisions.", featured: true, accent: "plum" },
  { name: "Entrepreneurship", slug: "entrepreneurship", description: "Founding and building things of my own.", accent: "sand" },
  { name: "Learning", slug: "learning", description: "How I learn, and what I'm learning.", accent: "slate" },
  { name: "Life", slug: "life", description: "Everything else worth writing down.", accent: "sand" },
];

// ---------------------------------------------------------------------------
// Block builders for seeded page bodies
// ---------------------------------------------------------------------------

const text = (t: string): BlockNode => ({ type: "text", text: t });
export const p = (t: string): BlockNode => ({ type: "paragraph", content: [text(t)] });
export const h = (level: 1 | 2 | 3, t: string): BlockNode => ({ type: "heading", attrs: { level }, content: [text(t)] });
export const todo = (t: string): BlockNode => ({ type: "callout", attrs: { variant: "important" }, content: [p(`[TODO] ${t}`)] });
export const doc = (...nodes: BlockNode[]): Doc => ({ type: "doc", content: nodes });

export type SeedPage = { slug: string; title: string; excerpt: string; status: "published" | "draft"; content: Doc; notes: string };

export const SEED_PAGES: SeedPage[] = [
  {
    slug: "about",
    title: "About Karthikeyan A",
    excerpt: "Software engineer, content creator, public speaker and founder of SparkTribe.",
    status: "published",
    notes: "Facts here come from your previous site: Senior Analyst at Capgemini; AWS, TypeScript, Java, Spring Boot; founder of SparkTribe. Confirm them. [TODO] Add your story and what you are working toward in your own words.",
    content: doc(
      p("I'm Karthikeyan A — a software engineer, content creator, public speaker and founder. I build things, share what I learn, and help people build better careers."),
      h(1, "What I do today"),
      p("I work as a Senior Analyst at Capgemini, building software with AWS, TypeScript, Java and Spring Boot. Outside of work I build my own projects, create content, speak, and run SparkTribe."),
    ),
  },
  {
    slug: "sparktribe",
    title: "SparkTribe",
    excerpt: "SparkTribe is an initiative I founded to make tech-career education accessible in Tamil.",
    status: "published",
    notes: "The mission sentence is taken from SparkTribe's own About page. [TODO] Add official links in Settings → Pages (SparkTribe URL), current programs and updates before promoting this page.",
    content: doc(
      p("SparkTribe is an initiative I founded. It is its own brand, separate from this personal site — this page explains what it is and how the two connect."),
      h(1, "What it is"),
      p("SparkTribe's mission is to help Tamil-speaking students and professionals prepare for top tech companies, with DSA and System Design education in their mother tongue."),
    ),
  },
  {
    slug: "contact",
    title: "Contact",
    excerpt: "Speaking, collaboration, or a thoughtful note — get in touch.",
    status: "published",
    notes: "",
    content: doc(p("Speaking invitations, collaboration ideas, questions about something I've written — send a note below. I read every message.")),
  },
  {
    slug: "now",
    title: "Now",
    excerpt: "What I'm focused on right now.",
    status: "draft",
    notes: "A /now page is a snapshot that changes over time. Fill it in and publish.",
    content: doc(
      p("A snapshot of what has my attention at the moment."),
      h(1, "Building"),
      todo("What are you building?"),
      h(1, "Learning"),
      todo("What are you learning?"),
      h(1, "Reading"),
      todo("What are you reading?"),
      h(1, "Experimenting with"),
      todo("What are you trying out?"),
      h(1, "Creating"),
      todo("What content are you making?"),
      h(1, "Thinking about"),
      todo("What questions are on your mind?"),
    ),
  },
  {
    slug: "uses",
    title: "Uses",
    excerpt: "The tools and resources I actually use — and why.",
    status: "draft",
    notes: "Only list tools you genuinely use. Each tool can be a Resource document added to the Toolkit collection (Settings → Pages).",
    content: doc(
      p("The tools, services and resources I rely on, with a note on why each one earns its place."),
      todo("Add Resource documents for the tools you use, add them to the Toolkit collection, and group them (Development, Content creation, Audio & video, Productivity, AI tools, Learning, Finance, Books)."),
    ),
  },
  {
    slug: "start-here",
    title: "Start here",
    excerpt: "New here? The shortest path to understanding what I do and where to begin.",
    status: "draft",
    notes: "Curate the 'Start here' collection (Settings → Pages) with your best pieces, then publish.",
    content: doc(
      p("New here? This is the shortest path to understanding who I am, what I'm building, and where to begin."),
      todo("Add your best writing, your journey, what you're building, your most useful resources and videos to the Start here collection."),
    ),
  },
];

export const SEED_JOURNEY: Array<{ slug: string; title: string; excerpt: string; content: Doc }> = [
  {
    slug: "software-engineering",
    title: "Software engineering",
    excerpt: "Working as a Senior Analyst at Capgemini, building with AWS, TypeScript, Java and Spring Boot.",
    content: doc(todo("Describe this chapter: when it began, what you were doing, what you learned and what came next. Add the period in the properties panel.")),
  },
  {
    slug: "content-creation",
    title: "Creating content",
    excerpt: "Sharing what I learn through writing and video.",
    content: doc(todo("How and why did you start creating content?")),
  },
  {
    slug: "founding-sparktribe",
    title: "Founding SparkTribe",
    excerpt: "Starting SparkTribe.",
    content: doc(todo("Why did you found SparkTribe, and what has it grown into?")),
  },
];
